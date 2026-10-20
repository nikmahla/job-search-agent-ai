// Offline tests: the final shortlist is selected AFTER enrichment and a
// re-check of the deterministic rules on the full descriptions.
// Uses the real enrichment code with a mocked fetch; no network.
import assert from "node:assert/strict";
import { selectFinalShortlist, recheckEnrichedJob } from "./shortlist.js";
import { selectTopJobs } from "./job-pre-ranker.js";
import { enrichShortlistedJobs } from "./description-enrichment.js";
import { analyzeJob } from "./analyze-job.js";
import { applyState, emptyState, findEntry, hasValidCachedAnalysis, hashText } from "./job-state.js";
import fs from "node:fs";

const NOW = new Date().toISOString();
const SNIPPET = "Frontend developer role. We build products with React.";
const BODY = [
  "About the role: you will build user interfaces for a frontend product used by thousands of people every day.",
  "Responsibilities: build new features, review code with the team, collaborate with design and improve quality.",
  "Requirements: React and solid JavaScript skills, attention to accessibility and a habit of writing tests.",
  "We offer a friendly team, a modern stack, learning budget and a clear career path inside the company."
].join("\n");
const fullDescription = (extra = "") => `${BODY}\n${BODY}\n${BODY}\n${extra}\n${BODY}`;
const page = (description) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "Frontend Developer", description })}</script></head><body>nav</body></html>`;

const adzuna = (id, title, overrides = {}) => ({
  id: `adzuna-${id}`,
  title,
  company: `Company ${id}`,
  location: "Alicante, Comunidad Valenciana",
  description: SNIPPET,
  url: `https://www.adzuna.example/details/${id}`,
  source: "adzuna",
  sourceCountry: "es",
  searchMode: "local",
  remote: false,
  hybrid: false,
  created: NOW,
  preFilter: { keep: true, reason: "frontend_title" },
  ...overrides
});

// Mock site: URL -> response; counts every request.
function mockSite(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const route = routes[String(url).split("/").pop()];
    if (route instanceof Error) throw route;
    if (typeof route === "number") return { ok: false, status: route, headers: new Map(), text: async () => "" };
    return {
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      text: async () => page(route ?? fullDescription())
    };
  };
  return { calls, enrich: (batch) => enrichShortlistedJobs(batch, { fetchImpl, delayMs: 0 }) };
}

// ------------------------------------------------------------------
// Scenario 1: drop after enrichment, replacement, failure kept, ranking after enrichment.
// Titles tie on the snippet, so the pre-rank order is A, B, C, D, E, F.
// ------------------------------------------------------------------
{
  const jobs = ["A", "B", "C", "D", "E", "F"].map((letter) => adzuna(letter, `Frontend Developer ${letter}`));
  const site = mockSite({
    A: fullDescription("Minimum 7 years of experience in frontend development is required."),
    B: 403,
    C: new TypeError("fetch failed"),
    E: fullDescription("You will work with Next.js and TypeScript every day, plus Redux Toolkit and Tailwind.")
  });

  // Snippet-only ranking (the old behaviour) would keep A in the top 4.
  assert.deepEqual(selectTopJobs(jobs, 4).map((job) => job.id), ["adzuna-A", "adzuna-B", "adzuna-C", "adzuna-D"]);

  const { selected, stats } = await selectFinalShortlist(jobs, { finalSize: 4, poolSize: 5, enrich: site.enrich });
  const ids = selected.map((job) => job.id);

  // 1. Ineligible after enrichment: removed.
  assert.ok(!ids.includes("adzuna-A"), "a 7+ years requirement revealed by the full text removes the job");
  assert.deepEqual(stats.dropped.map((job) => job.id), ["adzuna-A"]);
  assert.match(stats.dropped[0].reasons.join(" "), /requires 7\+ years/);

  // 2. A lower-ranked job replaces it, and ranking uses the enriched text:
  // E (5th on the snippet) now mentions Next.js/TypeScript and ranks first.
  assert.equal(ids[0], "adzuna-E", "the final order is computed after enrichment");
  assert.equal(selected[0].descriptionEnriched, true);
  assert.ok(selected[0].preRank.techScore > selectTopJobs(jobs, 6).find((job) => job.id === "adzuna-E").preRank.techScore);

  // 3. Enrichment failures do not delete jobs: B (HTTP 403) and C (network error) keep their snippet.
  // D (enriched, more evidence) also ranks above the snippet-only B and C.
  assert.deepEqual(ids, ["adzuna-E", "adzuna-D", "adzuna-B", "adzuna-C"]);
  for (const id of ["adzuna-B", "adzuna-C"]) {
    const job = selected.find((item) => item.id === id);
    assert.equal(job.descriptionEnriched, false);
    assert.equal(job.description, SNIPPET);
  }
  assert.equal(selected.find((job) => job.id === "adzuna-B").descriptionEnrichmentReason, "http-403");
  assert.equal(selected.find((job) => job.id === "adzuna-C").descriptionEnrichmentReason, "fetch-failed");

  // 4. Every selected Adzuna snippet was through enrichment before the cut.
  for (const job of selected) assert.notEqual(job.descriptionEnriched, undefined, `${job.id} was enriched or attempted before selection`);

  // 5. Bounded: only the pool of 5 was fetched (F, rank 6, never), one GET each.
  assert.equal(site.calls.length, 5);
  assert.ok(!site.calls.some((url) => url.endsWith("/F")));
  assert.equal(stats.enrichmentAttempts, 5);
  assert.equal(stats.enriched, 3, "A, D and E were enriched");
}

// ------------------------------------------------------------------
// Scenario 2: work mode and written location restrictions re-checked on the full text.
// ------------------------------------------------------------------
{
  const berlin = adzuna("berlin", "Frontend Developer Berlin", {
    location: "Berlin, Deutschland", sourceCountry: "de", searchMode: "remote", remote: true,
    description: "Remote position. Frontend developer role with React."
  });
  const london = adzuna("london", "Frontend Developer London", {
    location: "London, UK", sourceCountry: "gb", searchMode: "remote", remote: true,
    description: "Remote position. Frontend developer role with React."
  });
  const madrid = adzuna("madrid", "Frontend Developer Madrid", {
    location: "Madrid, España", sourceCountry: "es", searchMode: "remote", remote: true,
    description: "Remote position. Frontend developer role with React."
  });
  const site = mockSite({
    berlin: fullDescription("Hybrid working model: three days per week in our Munich office."),
    london: fullDescription("This remote role is open to UK residents only."),
    madrid: fullDescription("Fully remote position within Spain.")
  });
  const { selected, stats } = await selectFinalShortlist([berlin, london, madrid], { finalSize: 3, poolSize: 3, enrich: site.enrich });
  assert.deepEqual(selected.map((job) => job.id), ["adzuna-madrid"]);
  const reasons = Object.fromEntries(stats.dropped.map((job) => [job.id, job.reasons.join(" ")]));
  assert.match(reasons["adzuna-berlin"], /HYBRID_NON_LOCAL/, "remote snippet but hybrid outside Alicante/Valencia");
  assert.match(reasons["adzuna-london"], /REMOTE_OTHER_REGION/, "written UK-only restriction");

  const rechecked = recheckEnrichedJob({ ...berlin, description: fullDescription("Hybrid working model: three days per week in our Munich office."), descriptionEnriched: true });
  assert.equal(rechecked.remote, false);
  assert.equal(rechecked.hybrid, true);
  assert.deepEqual(rechecked.snippetFacts, { remote: true, hybrid: false });
}

// ------------------------------------------------------------------
// Scenario 3: backfill beyond the pool is bounded and also enriched first.
// ------------------------------------------------------------------
{
  const jobs = ["A", "B", "C", "D", "E", "F", "G", "H"].map((letter) => adzuna(letter, `Frontend Developer ${letter}`));
  const tooSenior = fullDescription("At least 6 years of experience with React are required.");
  const site = mockSite({ A: tooSenior, B: tooSenior, D: tooSenior });
  const { selected, stats } = await selectFinalShortlist(jobs, { finalSize: 3, poolSize: 3, maxBackfill: 3, enrich: site.enrich });
  // Pool A,B,C -> A and B drop; backfill D,E -> D drops; budget left 1 -> F.
  assert.deepEqual(selected.map((job) => job.id), ["adzuna-C", "adzuna-E", "adzuna-F"]);
  assert.ok(site.calls.length <= 3 + 3, "requests never exceed poolSize + maxBackfill");
  assert.ok(!site.calls.some((url) => url.endsWith("/G") || url.endsWith("/H")));
  assert.equal(stats.dropped.length, 3);
}

// ------------------------------------------------------------------
// Scenario 4: no request for jobs that do not need enrichment.
// ------------------------------------------------------------------
{
  const himalayas = adzuna("him", "Frontend Developer Himalayas", {
    id: "himalayas:1", source: "himalayas", location: "Remote: Spain", remote: true, searchMode: "remote",
    locationRestrictions: ["Spain"], url: "https://himalayas.example/1"
  });
  const longAdzuna = adzuna("long", "Frontend Developer Long", { description: fullDescription() });
  const site = mockSite({});
  const { selected, stats } = await selectFinalShortlist([himalayas, longAdzuna], { finalSize: 15, poolSize: 30, enrich: site.enrich });
  assert.equal(site.calls.length, 0, "Himalayas and full Adzuna descriptions are never fetched");
  assert.equal(selected.length, 2);
  assert.equal(stats.enrichmentAttempts, 0);
}

// ------------------------------------------------------------------
// Scenario 5: default limits keep the request budget at 30 + 15.
// ------------------------------------------------------------------
{
  const jobs = Array.from({ length: 60 }, (_, index) => adzuna(`n${String(index).padStart(2, "0")}`, `Frontend Developer ${String(index).padStart(2, "0")}`));
  const site = mockSite(Object.fromEntries(jobs.map((job) => [job.id.replace("adzuna-", ""), fullDescription("At least 8 years of experience required.")])));
  const { selected } = await selectFinalShortlist(jobs, { enrich: site.enrich });
  assert.equal(selected.length, 0, "every job is ineligible after enrichment");
  assert.equal(site.calls.length, 45, "worst case is bounded by poolSize (30) + maxBackfill (15)");
}

// ------------------------------------------------------------------
// Cached analyses do not use an analysis slot.
// Full descriptions (nothing to enrich); titles tie, so the rank order is the number.
// ------------------------------------------------------------------
const noEnrich = async (batch) => batch;
const numbered = (count) => Array.from({ length: count }, (_, index) =>
  adzuna(String(index + 1).padStart(2, "0"), `Frontend Developer ${String(index + 1).padStart(2, "0")}`, { description: fullDescription() }));
const ids = (list) => list.map((job) => job.id.replace("adzuna-", ""));
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => String(from + index).padStart(2, "0"));
const HASHES = { model: "qwen3:8b", extractionHash: "ext-1", scorerHash: "score-1" };
const VALID_PROFILE = { extraction: { status: "complete" }, requirements: { required: [], preferred: [] }, job: {} };
const cacheEntry = (job, overrides = {}) => ({
  descriptionHash: hashText(job.description), extractionHash: HASHES.extractionHash, model: HASHES.model,
  extractedAt: "2026-10-18T10:00:00.000Z", profile: structuredClone(VALID_PROFILE), ...overrides
});
// State where the jobs listed in `cachedIds` have a valid cached analysis.
function stateWithCache(jobs, cachedIds) {
  const state = emptyState();
  applyState(jobs, state, { now: new Date("2026-10-18T10:00:00Z") });
  for (const job of jobs) {
    if (cachedIds.includes(job.id.replace("adzuna-", ""))) findEntry(state, job)[1].analysis = cacheEntry(job);
  }
  return state;
}
const withCache = (state) => (job) => hasValidCachedAnalysis(state, job, HASHES);

// 6. 10 cached jobs at the top + 20 unanalysed: all 15 slots go to unanalysed jobs.
{
  const jobs = numbered(30);
  const state = stateWithCache(jobs, range(1, 10));
  const { selected, stats } = await selectFinalShortlist(jobs, { enrich: noEnrich, isCached: withCache(state) });
  assert.deepEqual(ids(selected), range(1, 25), "10 cached jobs plus the next 15 unanalysed jobs");
  assert.equal(stats.analysisSlots, 15);
  assert.deepEqual(ids(stats.cachedJobs), range(1, 10));
  assert.ok(!ids(selected).includes("26"), "the 16th unanalysed job is still cut");
  const before = await selectFinalShortlist(jobs, { enrich: noEnrich });
  assert.deepEqual(ids(before.selected), range(1, 15), "without the predicate the cached jobs used 10 of the 15 slots");
}

// 7. Cached jobs trigger no Qwen call; unanalysed jobs trigger exactly one each.
{
  const jobs = numbered(30);
  const state = stateWithCache(jobs, range(1, 10));
  const { selected } = await selectFinalShortlist(jobs, { enrich: noEnrich, isCached: withCache(state) });
  const calls = [];
  const fromCache = [];
  for (const job of selected) {
    const analysis = await analyzeJob(job, {
      candidate: {}, entry: findEntry(state, job)[1], hashes: HASHES,
      extract: async (raw) => { calls.push(raw.id.replace("adzuna-", "")); return structuredClone(VALID_PROFILE); },
      score: () => ({ decision: "MAYBE", jobFitScore: 50 })
    });
    if (analysis.fromCache) fromCache.push(job.id.replace("adzuna-", ""));
  }
  assert.deepEqual(fromCache, range(1, 10), "every cached job is scored from its cache");
  assert.deepEqual(calls, range(11, 25), "Qwen is called once per unanalysed job, never for a cached one");
}

// 8. Rank order is preserved, including cached jobs that are not at the top.
{
  const jobs = numbered(30);
  const state = stateWithCache(jobs, ["03", "07", "20"]);
  const { selected, stats } = await selectFinalShortlist(jobs, { enrich: noEnrich, isCached: withCache(state) });
  const fresh = ids(selected).filter((id) => !["03", "07", "20"].includes(id));
  assert.deepEqual(fresh, range(1, 17).filter((id) => !["03", "07"].includes(id)), "the 15 unanalysed jobs keep their rank order");
  assert.deepEqual(ids(selected), [...ids(selected)].sort(), "the whole shortlist stays in rank order");
  assert.deepEqual(ids(stats.cachedJobs), ["03", "07", "20"], "a valid cached job ranked below the last used slot is carried, free");
  assert.deepEqual(ids(stats.cachedBelowCutoff), ["20"]);
  assert.equal(stats.analysisSlots, 15, "carrying it uses no slot");
  assert.ok(ids(selected).includes("20"));
  assert.ok(!ids(selected).includes("18"), "the 16th unanalysed job is still cut");
}

// 9. Fewer unanalysed jobs than slots: all of them are selected, with the cached ones.
{
  const jobs = numbered(20);
  const state = stateWithCache(jobs, range(1, 12));
  const { selected, stats } = await selectFinalShortlist(jobs, { enrich: noEnrich, isCached: withCache(state) });
  assert.deepEqual(ids(selected), range(1, 20));
  assert.equal(stats.analysisSlots, 8);
  assert.equal(stats.cachedJobs.length, 12);
}

// 10. Missing or invalid cache entries count as unanalysed.
{
  const jobs = numbered(6);
  const state = emptyState();
  applyState(jobs.slice(0, 5), state, { now: new Date("2026-10-18T10:00:00Z") }); // job 06 is not in the state at all
  const entryOf = (index) => findEntry(state, jobs[index])[1];
  entryOf(0).analysis = cacheEntry(jobs[0]);                                                // valid
  entryOf(1).analysis = cacheEntry(jobs[1], { extractionHash: "other-extraction-code" });   // extraction code changed
  entryOf(2).analysis = cacheEntry(jobs[2], { descriptionHash: hashText("a different text") }); // description changed
  entryOf(3).analysis = cacheEntry(jobs[3], { profile: { extraction: { status: "failed" }, requirements: { required: [], preferred: [] } } }); // not cacheable
  // job 05: entry without any analysis
  assert.deepEqual(jobs.map((job) => hasValidCachedAnalysis(state, job, HASHES)), [true, false, false, false, false, false]);
  const { selected, stats } = await selectFinalShortlist(jobs, { enrich: noEnrich, isCached: withCache(state) });
  assert.deepEqual(ids(selected), range(1, 6));
  assert.deepEqual(ids(stats.cachedJobs), ["01"]);
  assert.equal(stats.analysisSlots, 5, "everything else needs a Qwen call");
}

// 11. No cached analyses: the selection is exactly the one made without the predicate.
{
  const jobs = numbered(24);
  const tooSenior = fullDescription("At least 6 years of experience with React are required.");
  const run = async (options) => {
    const site = mockSite({ "03": tooSenior, "05": tooSenior });
    const thin = jobs.map((job) => ({ ...job, description: SNIPPET }));
    const result = await selectFinalShortlist(thin, { finalSize: 15, poolSize: 10, maxBackfill: 6, enrich: site.enrich, ...options });
    return { ids: ids(result.selected), dropped: ids(result.stats.dropped), calls: site.calls.length, backfilled: result.stats.backfilled };
  };
  const plain = await run({});
  const withPredicate = await run({ isCached: () => false });
  assert.deepEqual(withPredicate, plain, "same selection, drops, backfill and request count");
  assert.deepEqual(plain.dropped, ["03", "05"]);
  assert.deepEqual(plain.ids, ids(selectTopJobs(jobs.filter((job) => !["adzuna-03", "adzuna-05"].includes(job.id)).slice(0, 15), 15)).slice(0, plain.ids.length));
}

// 12. Cached jobs found while backfilling do not use up the backfill budget.
{
  const jobs = numbered(12);
  const cachedIds = new Set(range(1, 6).map((id) => `adzuna-${id}`));
  const site = mockSite({});
  const { selected, stats } = await selectFinalShortlist(jobs.map((job) => ({ ...job, description: SNIPPET })), {
    finalSize: 3, poolSize: 4, maxBackfill: 3, enrich: site.enrich, isCached: (job) => cachedIds.has(job.id)
  });
  // Pool 01-04 is all cached; backfill 05,06,07 (2 cached, budget 3 -> 2), then 08,09 (budget 0).
  assert.deepEqual(ids(selected), range(1, 9));
  assert.equal(stats.analysisSlots, 3);
  assert.equal(site.calls.length, 9, "10, 11 and 12 are never requested");
  const none = await selectFinalShortlist(jobs, { finalSize: 3, poolSize: 4, maxBackfill: 3, enrich: noEnrich, isCached: () => true });
  assert.equal(none.selected.length, 12, "all cached: every eligible job is kept for free");
  assert.equal(none.stats.analysisSlots, 0);
}

// 13. run-agent.js hands the predicate to the shortlist and reuses the cache check.
{
  const source = fs.readFileSync(new URL("./run-agent.js", import.meta.url), "utf8");
  assert.match(source, /isCached: \(job\) => hasValidCachedAnalysis\(state, job, hashes\)/);
  assert.match(source, /finalSize: MAX_JOBS_TO_ANALYZE/);
}

// 14. A valid cached job BELOW the enrichment cutoff is carried into the result for free,
//     found offline (its current text matches the cache), with no request and no Qwen call.
{
  const jobs = numbered(24);
  const state = stateWithCache(jobs, ["15", "20"]);
  const enriched = [];
  const options = { finalSize: 5, poolSize: 6, maxBackfill: 0, enrich: async (batch) => { enriched.push(...batch.map((job) => job.id)); return batch; } };
  const { selected, stats } = await selectFinalShortlist(jobs, { ...options, isCached: withCache(state) });
  assert.deepEqual(ids(selected), [...range(1, 5), "15", "20"], "5 slots for the best unanalysed jobs, then the cached ones in rank order");
  assert.deepEqual(ids(stats.cachedBelowCutoff), ["15", "20"]);
  assert.equal(stats.analysisSlots, 5, "cached jobs do not consume a new analysis slot");
  assert.equal(enriched.length, 6, "only the pool of 6 is enriched; the cached jobs below it cost no fetch");

  // The whole shortlist is analysed: exactly 5 Qwen calls, none for the cached jobs.
  const calls = [];
  const fromCache = [];
  for (const job of selected) {
    const analysis = await analyzeJob(job, {
      candidate: {}, entry: findEntry(state, job)[1], hashes: HASHES,
      extract: async (raw) => { calls.push(raw.id.replace("adzuna-", "")); return structuredClone(VALID_PROFILE); },
      score: () => ({ decision: "MAYBE", jobFitScore: 50 })
    });
    if (analysis.fromCache) fromCache.push(job.id.replace("adzuna-", ""));
  }
  assert.deepEqual(calls, range(1, 5), "Qwen is called only for the 5 slot jobs");
  assert.deepEqual(fromCache, ["15", "20"]);

  // Without the predicate nothing is carried and the selection is the old one.
  const plain = await selectFinalShortlist(jobs, options);
  assert.deepEqual(ids(plain.selected), range(1, 5));
  assert.deepEqual(plain.stats.cachedBelowCutoff, []);
  assert.equal(plain.stats.cachedJobs.length, 0);
  const withPredicateOnlySlotJobs = await selectFinalShortlist(jobs, { ...options, isCached: () => false });
  assert.deepEqual(ids(withPredicateOnlySlotJobs.selected), ids(plain.selected), "no valid cache: identical selection");
}

// 15. A stale or invalid cache below the cutoff is not carried; the slots are unchanged.
{
  const jobs = numbered(24);
  const state = emptyState();
  applyState(jobs, state, { now: new Date("2026-10-18T10:00:00Z") });
  const entryOf = (id) => findEntry(state, jobs.find((job) => job.id === `adzuna-${id}`))[1];
  const job = (id) => jobs.find((candidate) => candidate.id === `adzuna-${id}`);
  entryOf("15").analysis = cacheEntry(job("15"), { descriptionHash: hashText("an older text") });            // description changed
  entryOf("16").analysis = cacheEntry(job("16"), { extractionHash: "other-extraction-code" });               // extraction code changed
  entryOf("17").analysis = cacheEntry(job("17"), { profile: { extraction: { status: "failed" }, requirements: { required: [], preferred: [] } } }); // not cacheable
  entryOf("18").analysis = cacheEntry(job("18"));                                                            // valid
  const { selected, stats } = await selectFinalShortlist(jobs, { finalSize: 5, poolSize: 6, maxBackfill: 0, enrich: noEnrich, isCached: withCache(state) });
  assert.deepEqual(ids(selected), [...range(1, 5), "18"], "only the valid cache is carried");
  assert.deepEqual(ids(stats.cachedBelowCutoff), ["18"]);
  assert.equal(stats.analysisSlots, 5);
}

// 16. A cached job whose cache is keyed by an enriched text is not checked below the cutoff
//     (that would need a request): it is simply not carried, never wrongly reused.
{
  const jobs = numbered(12).map((job) => ({ ...job, description: SNIPPET }));
  const state = emptyState();
  applyState(jobs, state, { now: new Date("2026-10-18T10:00:00Z") });
  const target = jobs.find((job) => job.id === "adzuna-10");
  findEntry(state, target)[1].analysis = cacheEntry({ description: fullDescription() }); // analysed earlier on the enriched text
  const site = mockSite({});
  const { selected, stats } = await selectFinalShortlist(jobs, { finalSize: 3, poolSize: 4, maxBackfill: 0, enrich: site.enrich, isCached: withCache(state) });
  assert.deepEqual(ids(selected), range(1, 3));
  assert.deepEqual(stats.cachedBelowCutoff, []);
  assert.equal(site.calls.length, 4, "no request was made for the cached job below the cutoff");
}

console.log("PASS: shortlist enrichment-before-selection checks passed (offline).");
