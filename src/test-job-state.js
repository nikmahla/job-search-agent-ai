// Offline tests for persistent job state and the Qwen extraction cache.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyState,
  computeAnalysisHashes,
  emptyState,
  findEntry,
  getCachedExtraction,
  hashText,
  isCacheableProfile,
  jobKeyAliases,
  loadState,
  recordAnalysis,
  recordAnalysisFailure,
  EXPIRED_RECHECK_DAYS,
  isDueForRecheck,
  mergeUserDecisions,
  recordAvailability,
  resolveJobKey,
  saveStateAtomic,
  saveStateMerged,
  setJobStatus,
  stableJobKey
} from "./job-state.js";
import { analyzeJob } from "./analyze-job.js";
import { normalizeJobProfile } from "./build-job-profile.js";
import { deduplicateJobs } from "./job-pre-ranker.js";
import { scoreJob } from "./job-scorer.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "job-state-"));
const NOW = new Date("2026-10-18T10:00:00Z");
const LATER = new Date("2026-10-19T10:00:00Z");

const DESCRIPTION = "Frontend Developer. Requirements: 3+ years with React and TypeScript. English B2. Nice to have: GraphQL.";
const job = (overrides = {}) => ({
  id: "1", title: "Frontend Developer", company: "Acme SL", location: "Valencia, España",
  description: DESCRIPTION, url: "https://www.adzuna.es/details/123?utm_medium=api&utm_source=abc", source: "adzuna",
  remote: true, hybrid: false, ...overrides
});

const qwenOutput = {
  job: { title: "Frontend Developer", company: "Acme", description: "" },
  requirements: {
    required: [{ type: "skill", item: "React", priority: "critical" }, { type: "skill", item: "TypeScript", priority: "critical" }],
    preferred: [{ type: "skill", item: "GraphQL", priority: "preferred" }]
  },
  experience: { minimumYears: 3, requiredFunctions: ["Frontend development"] },
  responsibilities: { core: ["Build React features"], secondary: [] },
  qualifications: [],
  languages: [{ language: "English", level: "B2", required: true, evidence: "English B2" }],
  workAuthorization: { required: false, eu: false },
  location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" }
};
const PROFILE = normalizeJobProfile(structuredClone(qwenOutput), job());
const CANDIDATE = {
  candidate: { name: "Synthetic", experienceYears: 4, location: { acceptedCities: ["Alicante", "Valencia"] }, workAuthorization: { eu: true },
    languages: [{ language: "English", level: "C1" }] },
  professionalProfile: { targetRoles: ["Frontend Developer"] },
  skills: { primary: ["React", "TypeScript", "HTML", "CSS"] },
  experience: [{ role: "Frontend Developer", functions: ["Frontend development"] }]
};
const HASHES = { model: "qwen3:8b", extractionHash: "ext-1", scorerHash: "score-1" };

// 1. Stable keys and URL normalization.
{
  assert.equal(stableJobKey(job()), "url:www.adzuna.es/details/123", "tracking parameters are removed");
  assert.equal(stableJobKey(job({ url: "https://WWW.adzuna.es/details/123/?utm_source=x#apply" })), "url:www.adzuna.es/details/123");
  assert.equal(stableJobKey(job({ url: "https://jobs.example.com/view?id=42&utm_campaign=x" })), "url:jobs.example.com/view?id=42", "identifying parameters are kept");
  assert.equal(stableJobKey(job()), stableJobKey(structuredClone(job())), "deterministic");
  const long = stableJobKey(job({ url: `https://example.com/${"a".repeat(300)}` }));
  assert.ok(long.length <= 4 + 120 && /~[0-9a-f]{10}$/.test(long), "long keys are capped and hashed");
  assert.notEqual(long, stableJobKey(job({ url: `https://example.com/${"a".repeat(299)}b` })), "capped keys stay unique");
}

// 2. Fallback key without a usable URL: company root + title + location.
{
  const a = stableJobKey(job({ url: null, company: "TXP Technology x People" }));
  assert.equal(a, "job:txp|frontend-developer|valencia-espana");
  assert.equal(stableJobKey(job({ url: "not a url", company: "TXP" })), a, "same company root, title and location → same key");
  assert.notEqual(stableJobKey(job({ url: null, location: "Alicante" })), stableJobKey(job({ url: null })), "different cities are never merged");
  assert.equal(stableJobKey({}), "job:unknown|untitled|unknown");
}

// 3. Different cities with the same title stay separate jobs in the state.
{
  const state = emptyState();
  const { counts } = applyState([job({ url: null }), job({ url: null, location: "Alicante" })], state, { now: NOW });
  assert.equal(counts.new, 2);
  assert.equal(Object.keys(state.jobs).length, 2);
}

// 4. Persistence: atomic save, reload, already-seen on the next run; no temp files left.
{
  const file = path.join(tmp, "state", "job-state.json");
  const state = await loadState({ file });
  assert.deepEqual(state.jobs, {}, "a missing file is an empty state");
  const first = applyState([job(), job({ url: "https://himalayas.app/companies/acme/jobs/fe", id: "h1", source: "himalayas" })], state, { now: NOW });
  assert.equal(first.counts.new, 2);
  await saveStateAtomic(state, { file });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["job-state.json"], "temporary file was renamed");

  const reloaded = await loadState({ file });
  const second = applyState([job()], reloaded, { now: LATER });
  assert.deepEqual([second.counts.new, second.counts.alreadySeen], [0, 1]);
  const [, entry] = findEntry(reloaded, job());
  assert.equal(entry.timesSeen, 2);
  assert.equal(entry.firstSeen, NOW.toISOString());
  assert.equal(entry.lastSeen, LATER.toISOString());

  fs.writeFileSync(file, "{ broken");
  await assert.rejects(loadState({ file }), /not valid JSON.*not overwritten/, "a corrupt file is never silently replaced");
}

// 5. A merged job is found again through any of its source URLs.
{
  const adzuna = job();
  const himalayas = job({ id: "h1", source: "himalayas", url: "https://himalayas.app/companies/acme/jobs/fe", description: `${DESCRIPTION} More text.` });
  const [merged] = deduplicateJobs([{ ...adzuna, remote: true }, { ...himalayas, remote: true, title: adzuna.title }].map((j) => ({ ...j, description: DESCRIPTION.repeat(2) })));
  const state = emptyState();
  applyState([merged], state, { now: NOW });
  assert.ok(jobKeyAliases(merged).length >= 1);
  const next = applyState([adzuna], state, { now: LATER });
  assert.equal(next.counts.alreadySeen, 1, "the Adzuna listing alone matches the merged entry");
}

// 6. Applied and dismissed jobs are hidden and never overwritten by a run.
{
  const state = emptyState();
  const applied = job();
  const dismissed = job({ url: "https://example.com/jobs/2", title: "React Engineer" });
  const other = job({ url: "https://example.com/jobs/3", title: "UI Engineer" });
  applyState([applied, dismissed, other], state, { now: NOW });
  setJobStatus(state, stableJobKey(applied), "applied", { note: "sent CV", now: NOW });
  setJobStatus(state, stableJobKey(dismissed), "dismissed", { now: NOW });
  const run = applyState([applied, dismissed, other], state, { now: LATER });
  assert.deepEqual(run.fresh.map((j) => j.title), ["UI Engineer"]);
  assert.deepEqual([run.counts.applied, run.counts.dismissed, run.counts.hidden], [1, 1, 2]);

  const key = stableJobKey(applied);
  recordAnalysis(state, key, { profile: PROFILE, description: DESCRIPTION, hashes: HASHES, result: { decision: "APPLY", jobFitScore: 80 } }, { now: LATER });
  recordAvailability(state, key, { status: "inactive", reason: "http-404" }, { now: LATER });
  assert.equal(state.jobs[key].status, "applied", "a run never overrides a user decision");
  assert.equal(state.jobs[key].note, "sent CV");
  assert.throws(() => setJobStatus(state, key, "maybe"), /Unknown status/);

  setJobStatus(state, stableJobKey(dismissed), "new", { now: LATER });
  assert.equal(applyState([dismissed], state, { now: LATER }).fresh.length, 1, '"new" un-hides a job');
}

// 7. Run-set statuses: expired (two 404/410 checks) is hidden, unreachable is retried.
{
  const state = emptyState();
  const a = job();
  const b = job({ url: "https://example.com/jobs/9" });
  applyState([a, b], state, { now: NOW });
  recordAnalysis(state, stableJobKey(a), { profile: PROFILE, description: DESCRIPTION, hashes: HASHES, result: { decision: "MAYBE" } }, { now: NOW });
  assert.equal(state.jobs[stableJobKey(a)].status, "ranked");
  recordAvailability(state, stableJobKey(a), { status: "inactive", reason: "http-410" }, { now: NOW });
  assert.equal(state.jobs[stableJobKey(a)].status, "ranked", "one 404/410 does not expire a job");
  recordAvailability(state, stableJobKey(a), { status: "inactive", reason: "http-410" }, { now: NOW });
  recordAvailability(state, stableJobKey(b), { status: "unverified", reason: "timeout" }, { now: NOW });
  assert.equal(state.jobs[stableJobKey(a)].status, "expired");
  assert.equal(state.jobs[stableJobKey(a)].expiredBy, "run");
  assert.equal(state.jobs[stableJobKey(b)].status, "unreachable");
  const run = applyState([a, b], state, { now: LATER });
  assert.deepEqual(run.fresh.map(stableJobKey), [stableJobKey(b)]);
  assert.equal(run.counts.expired, 1);
  recordAvailability(state, stableJobKey(b), { status: "unverified", reason: "http-403" }, { now: LATER });
  assert.equal(state.jobs[stableJobKey(b)].status, "unreachable", "a blocked HEAD request does not change the status");
}

// 8. Cache reuse: same description + same extraction code → no Qwen call;
// the scorer still runs and gives the same result as a live extraction.
{
  const state = emptyState();
  const raw = job();
  applyState([raw], state, { now: NOW });
  const key = stableJobKey(raw);
  let calls = 0;
  const extract = async () => { calls += 1; return normalizeJobProfile(structuredClone(qwenOutput), raw); };

  const live = await analyzeJob(raw, { candidate: CANDIDATE, entry: state.jobs[key], hashes: HASHES, extract });
  assert.equal(live.fromCache, false);
  recordAnalysis(state, key, { profile: live.extraction, description: raw.description, hashes: HASHES, result: live.scored }, { now: NOW });
  const file = path.join(tmp, "cache.json");
  await saveStateAtomic(state, { file });
  const reloaded = await loadState({ file });

  const again = await analyzeJob(raw, { candidate: CANDIDATE, entry: reloaded.jobs[key], hashes: HASHES, extract });
  assert.equal(calls, 1, "Qwen is not called for a cached job");
  assert.equal(again.fromCache, true);
  assert.equal(again.cacheReason, "cached");
  assert.deepEqual(again.scored, live.scored, "a cached extraction (after a JSON round trip) scores identically");
  assert.equal(again.jobProfile.sourceInfo.url, raw.url, "source facts are applied to cached extractions too");
  assert.equal(reloaded.jobs[key].lastResult.decision, live.scored.decision);
}

// 9. Cache invalidation: a changed description or changed extraction code re-runs Qwen.
{
  const entry = { analysis: { descriptionHash: hashText(DESCRIPTION), extractionHash: "ext-1", profile: PROFILE } };
  assert.equal(getCachedExtraction(entry, { description: DESCRIPTION, hashes: HASHES }).reason, "cached");
  assert.equal(getCachedExtraction(entry, { description: `${DESCRIPTION} Remote within Spain.`, hashes: HASHES }).reason, "description-changed");
  assert.equal(getCachedExtraction(entry, { description: DESCRIPTION, hashes: { ...HASHES, extractionHash: "ext-2" } }).reason, "extraction-code-changed");
  assert.equal(getCachedExtraction(null, { description: DESCRIPTION, hashes: HASHES }).reason, "not-cached");

  let calls = 0;
  const extract = async (raw) => { calls += 1; return normalizeJobProfile(structuredClone(qwenOutput), raw); };
  await analyzeJob(job({ description: `${DESCRIPTION} Changed.` }), { candidate: CANDIDATE, entry, hashes: HASHES, extract });
  await analyzeJob(job(), { candidate: CANDIDATE, entry, hashes: { ...HASHES, extractionHash: "ext-2" }, extract });
  assert.equal(calls, 2);
}

// 10. The code hashes change when (and only when) the relevant files change.
{
  const files = { "build-job-profile.js": "prompt v1", "job-source-rules.js": "rules", "job-scorer.js": "scorer v1", "tech-lexicon.js": "lex", "job-pre-ranker.js": "pre" };
  const readFile = async (file) => files[path.basename(file)];
  const base = await computeAnalysisHashes({ readFile, model: "qwen3:8b" });
  assert.deepEqual(await computeAnalysisHashes({ readFile, model: "qwen3:8b" }), base, "deterministic");
  files["build-job-profile.js"] = "prompt v2";
  const promptChanged = await computeAnalysisHashes({ readFile, model: "qwen3:8b" });
  assert.notEqual(promptChanged.extractionHash, base.extractionHash, "a prompt/normalizer change invalidates extractions");
  assert.equal(promptChanged.scorerHash, base.scorerHash);
  files["job-scorer.js"] = "scorer v2";
  const scorerChanged = await computeAnalysisHashes({ readFile, model: "qwen3:8b" });
  assert.notEqual(scorerChanged.scorerHash, promptChanged.scorerHash, "a scorer change is detected");
  assert.equal(scorerChanged.extractionHash, promptChanged.extractionHash, "a scorer change does not discard Qwen's extraction: the scorer is re-run instead");
  assert.notEqual((await computeAnalysisHashes({ readFile, model: "qwen3:14b" })).extractionHash, scorerChanged.extractionHash, "a different model invalidates extractions");
  const real = await computeAnalysisHashes();
  assert.match(real.extractionHash, /^[0-9a-f]{16}$/);
}

// 11. A scorer change takes effect on a cached job without calling Qwen.
{
  const entry = { analysis: { descriptionHash: hashText(DESCRIPTION), extractionHash: "ext-1", profile: PROFILE } };
  let calls = 0;
  const extract = async () => { calls += 1; return PROFILE; };
  const changedScorer = (candidate, profile) => ({ ...scoreJob(candidate, profile), decision: "SKIP", jobFitScore: 1 });
  const result = await analyzeJob(job(), { candidate: CANDIDATE, entry, hashes: { ...HASHES, scorerHash: "score-2" }, extract, score: changedScorer });
  assert.equal(calls, 0);
  assert.equal(result.scored.decision, "SKIP", "the current scorer decides, never a stored decision");
}

// 12. A failed extraction is never cached.
{
  const state = emptyState();
  const raw = job();
  applyState([raw], state, { now: NOW });
  const key = stableJobKey(raw);
  await assert.rejects(analyzeJob(raw, { candidate: CANDIDATE, entry: state.jobs[key], hashes: HASHES, extract: async () => { throw new Error("Ollama did not respond within 180s"); } }));
  recordAnalysisFailure(state, key, new Error("Ollama did not respond within 180s"), { now: NOW });
  assert.equal(state.jobs[key].analysis, undefined);
  assert.equal(state.jobs[key].status, "new");
  assert.equal(state.jobs[key].failedAttempts, 1);

  assert.equal(isCacheableProfile({ extraction: { status: "failed" }, requirements: { required: [], preferred: [] } }), false);
  assert.equal(isCacheableProfile({}), false);
  recordAnalysis(state, key, { profile: { requirements: {} }, description: DESCRIPTION, hashes: HASHES, result: {} }, { now: NOW });
  assert.equal(state.jobs[key].analysis, undefined, "a malformed profile is recorded as a failure, not cached");
  assert.equal(state.jobs[key].failedAttempts, 2);

  const poisoned = { analysis: { descriptionHash: hashText(DESCRIPTION), extractionHash: "ext-1", profile: { extraction: { status: "failed" } } } };
  assert.equal(getCachedExtraction(poisoned, { description: DESCRIPTION, hashes: HASHES }).reason, "invalid-cache");
}

// 13. Resolving what a person types.
{
  const state = emptyState();
  applyState([job(), job({ url: "https://example.com/jobs/2" })], state, { now: NOW });
  assert.equal(resolveJobKey(state, "url:www.adzuna.es/details/123").key, "url:www.adzuna.es/details/123");
  assert.equal(resolveJobKey(state, "https://www.adzuna.es/details/123?utm_source=zz").key, "url:www.adzuna.es/details/123");
  assert.equal(resolveJobKey(state, "adzuna").key, "url:www.adzuna.es/details/123");
  assert.deepEqual(resolveJobKey(state, "url:").matches.length, 2);
}

// 14. The mark and status commands work end to end on a temporary state file.
{
  const file = path.join(tmp, "cli", "job-state.json");
  const state = emptyState();
  applyState([job()], state, { now: NOW });
  recordAnalysis(state, stableJobKey(job()), { profile: PROFILE, description: DESCRIPTION, hashes: HASHES, result: { decision: "APPLY", jobFitScore: 77 } }, { now: NOW });
  await saveStateAtomic(state, { file });
  const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");
  const run = (script, args) => spawnSync(process.execPath, [path.join(scripts, script), ...args], {
    cwd: tmp, encoding: "utf-8", env: { PATH: process.env.PATH, JOB_STATE_FILE: file }
  });

  const status = run("job-status.js", []);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Open APPLY \/ MAYBE.*: 1/);
  assert.match(status.stdout, /url:www\.adzuna\.es\/details\/123/);

  const marked = run("mark-job.js", ["adzuna.es/details/123", "applied", "sent", "via", "site"]);
  assert.equal(marked.status, 0, marked.stderr);
  assert.match(marked.stdout, /ranked → applied/);
  const saved = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.equal(saved.jobs["url:www.adzuna.es/details/123"].status, "applied");
  assert.equal(saved.jobs["url:www.adzuna.es/details/123"].note, "sent via site");

  assert.equal(run("mark-job.js", ["adzuna", "maybe"]).status, 1);
  assert.equal(run("mark-job.js", ["nothing-like-this", "dismissed"]).status, 1);
  assert.match(run("job-status.js", []).stdout, /Applied: 1/);
}

const daysAfter = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const analysed = (state, j, now = NOW) =>
  recordAnalysis(state, stableJobKey(j), { profile: PROFILE, description: DESCRIPTION, hashes: HASHES, result: { decision: "APPLY", jobFitScore: 80 } }, { now });

// 15. The 404 count: consecutive 404/410 only; a live check resets it, a check
// that proves nothing (timeout, 403) neither adds to nor resets it.
{
  const state = emptyState();
  const j = job();
  const key = stableJobKey(j);
  applyState([j], state, { now: NOW });
  analysed(state, j);
  recordAvailability(state, key, { status: "inactive", reason: "http-404" }, { now: NOW });
  recordAvailability(state, key, { status: "active", reason: "http-200" }, { now: NOW });
  recordAvailability(state, key, { status: "inactive", reason: "http-404" }, { now: NOW });
  assert.equal(state.jobs[key].status, "ranked", "a live check in between resets the count");
  recordAvailability(state, key, { status: "unverified", reason: "http-403" }, { now: NOW });
  assert.equal(state.jobs[key].inactiveChecks, 1, "a blocked check keeps the count");
  recordAvailability(state, key, { status: "inactive", reason: "http-404" }, { now: NOW });
  assert.equal(state.jobs[key].status, "expired");
  recordAvailability(state, key, { status: "unverified", reason: "timeout" }, { now: NOW });
  assert.equal(state.jobs[key].status, "expired", "a timeout does not turn an expired job into unreachable");
}

// 16. A run-expired job found again is re-checked after EXPIRED_RECHECK_DAYS;
// one a person marked expired never is.
{
  const state = emptyState();
  const runExpired = job();
  const userExpired = job({ url: "https://example.com/jobs/u", title: "React Engineer" });
  applyState([runExpired, userExpired], state, { now: NOW });
  analysed(state, runExpired);
  for (let i = 0; i < 2; i++) recordAvailability(state, stableJobKey(runExpired), { status: "inactive", reason: "http-404" }, { now: NOW });
  setJobStatus(state, stableJobKey(userExpired), "expired", { now: NOW });
  assert.equal(state.jobs[stableJobKey(userExpired)].expiredBy, "user");

  const soon = applyState([runExpired, userExpired], state, { now: daysAfter(NOW, EXPIRED_RECHECK_DAYS - 1) });
  assert.deepEqual([soon.fresh.length, soon.counts.expired, soon.counts.recheckExpired], [0, 2, 0], "hidden within the wait");

  const later = daysAfter(NOW, EXPIRED_RECHECK_DAYS);
  const due = applyState([runExpired, userExpired], state, { now: later });
  assert.deepEqual(due.fresh.map(stableJobKey), [stableJobKey(runExpired)], "only the run-expired job comes back");
  assert.deepEqual([due.counts.recheckExpired, due.counts.expired], [1, 1]);
  assert.equal(isDueForRecheck(state.jobs[stableJobKey(userExpired)], { now: daysAfter(NOW, 365) }), false);

  // Still 404 on the re-check: expired again, and the wait starts over.
  analysed(state, runExpired, later);
  recordAvailability(state, stableJobKey(runExpired), { status: "inactive", reason: "http-404" }, { now: later });
  assert.equal(state.jobs[stableJobKey(runExpired)].status, "expired", "a job that 404'd before expires on the next 404");
  assert.equal(applyState([runExpired], state, { now: daysAfter(later, 1) }).fresh.length, 0);

  // Live on a later re-check: ranked again, count and run flag cleared.
  const muchLater = daysAfter(later, EXPIRED_RECHECK_DAYS);
  assert.equal(applyState([runExpired], state, { now: muchLater }).fresh.length, 1);
  analysed(state, runExpired, muchLater);
  recordAvailability(state, stableJobKey(runExpired), { status: "active", reason: "http-200" }, { now: muchLater });
  const entry = state.jobs[stableJobKey(runExpired)];
  assert.deepEqual([entry.status, entry.inactiveChecks, entry.expiredBy], ["ranked", 0, undefined]);
}

// 17. A run's save keeps marks made with `npm run mark` while it was going.
{
  const file = path.join(tmp, "merge", "job-state.json");
  const seed = emptyState();
  const a = job();
  const b = job({ url: "https://example.com/jobs/b", title: "React Engineer" });
  applyState([a, b], seed, { now: NOW });
  await saveStateAtomic(seed, { file });

  // The run loads the state, then a person marks job a with the real CLI.
  const runState = await loadState({ file });
  const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");
  const mark = spawnSync(process.execPath, [path.join(scripts, "mark-job.js"), stableJobKey(a), "applied", "sent"], {
    cwd: tmp, encoding: "utf-8", env: { PATH: process.env.PATH, JOB_STATE_FILE: file }
  });
  assert.equal(mark.status, 0, mark.stderr);

  // The run keeps working on its old copy and saves.
  analysed(runState, a, LATER);
  analysed(runState, b, LATER);
  assert.deepEqual(await saveStateMerged(runState, { file }), [stableJobKey(a)]);
  const saved = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.equal(saved.jobs[stableJobKey(a)].status, "applied", "the mark survives the run's save");
  assert.equal(saved.jobs[stableJobKey(a)].note, "sent");
  assert.equal(saved.jobs[stableJobKey(a)].lastResult.jobFitScore, 80, "the run's analysis is kept too");
  assert.equal(saved.jobs[stableJobKey(b)].status, "ranked");
  assert.equal(runState.jobs[stableJobKey(a)].status, "applied", "the run now sees the mark");

  // A second save with nothing new takes nothing and changes no status.
  assert.deepEqual(await saveStateMerged(runState, { file }), []);
  // A mark the run already has is not taken again; an older disk copy never wins.
  const older = structuredClone(saved);
  older.jobs[stableJobKey(a)].history = [];
  older.jobs[stableJobKey(a)].status = "new";
  assert.deepEqual(mergeUserDecisions(runState, older), []);
  assert.equal(runState.jobs[stableJobKey(a)].status, "applied");

  // A corrupt file on disk is not overwritten by the run.
  fs.writeFileSync(file, "{ broken");
  await assert.rejects(saveStateMerged(runState, { file }), /not valid JSON/);
  assert.equal(fs.readFileSync(file, "utf-8"), "{ broken");
}

// 18. run-agent.js saves through saveStateMerged after every job and on a crash.
{
  const source = fs.readFileSync(new URL("./run-agent.js", import.meta.url), "utf8");
  assert.ok(!source.includes("saveStateAtomic"), "run-agent.js never saves without merging");
  assert.match(source, /persistState = async \(\) => \{\s*const kept = await saveStateMerged\(state\)/);
  assert.match(source, /Save after every job[^\n]*\n\s*await persistState\(\);\s*\n\s*if \(runStats\.qwenCalls/, "saved inside the analysis loop");
  assert.match(source, /main\(\)\.catch\(async \(error\) => \{[\s\S]*await persistState\(\)[\s\S]*process\.exit\(1\)/, "saved on a crash");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("PASS: job state and analysis cache checks passed (offline).");
