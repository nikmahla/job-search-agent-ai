// Offline tests: every discovered job gets a triage record on its state entry.
import assert from "node:assert/strict";
import { applyState, emptyState, findEntry, setJobStatus } from "./job-state.js";
import { filterJobs } from "./job-filter.js";
import { selectFinalShortlist } from "./shortlist.js";
import { createTriage, sanitizeUrl, TRIAGE_DESCRIPTION_LIMIT, describeDescription } from "./triage.js";

const NOW = new Date("2026-10-19T10:00:00Z");
const SNIPPET = "Frontend developer role. We build products with React.";
const LONG = `${"Build user interfaces with React and TypeScript. ".repeat(80)}`;

const job = (id, title, overrides = {}) => ({
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
  created: "2026-10-18T08:00:00Z",
  ...overrides
});

// Fake enrichment: full text for everything; job B reveals a 7+ years requirement.
const enrich = async (batch) => batch.map((item) => ({
  ...item,
  description: item.id === "adzuna-B"
    ? `${LONG} Minimum 7 years of experience in frontend development is required.`
    : LONG,
  descriptionEnriched: true
}));

async function runPipeline({ jobs, state = emptyState(), finalSize = 2, poolSize = 3, isCached }) {
  const stateResult = applyState(jobs, state, { now: NOW });
  const triage = createTriage(state);
  triage.discovered(jobs, stateResult.hidden);
  const filterResult = filterJobs(stateResult.fresh);
  triage.filter(filterResult);
  const { selected, stats } = await selectFinalShortlist(filterResult.kept, { finalSize, poolSize, enrich, isCached });
  triage.shortlist(filterResult.kept, stats, selected);
  triage.commit();
  return { state, triage, selected, stats, filterResult };
}

const jobs = () => [
  job("A", "Frontend Developer A"),
  job("B", "Frontend Developer B"),
  job("C", "Frontend Developer C"),
  job("D", "Frontend Developer D"),
  job("E", "Frontend Developer E"),
  job("J", "Java Developer"),
  job("I", "Frontend Developer Intern"),
  job("N", "Frontend Developer N", { location: "Berlin, Germany" }),
  job("M", "Frontend Developer M", { description: undefined, url: undefined, created: undefined, location: undefined, company: undefined })
];
const entryOf = (state, wanted) => findEntry(state, wanted)[1];

const { state, triage, selected, stats } = await runPipeline({ jobs: jobs() });

// 1. Every discovered job has a record, saved on its state entry.
assert.equal(triage.records.size, jobs().length);
for (const entry of Object.values(state.jobs)) assert.equal(entry.triage.key, entry.key);

// 2. Title filter rejection: correct reason, stage and nothing further reached.
{
  const t = entryOf(state, jobs()[5]).triage;
  assert.equal(t.stageReached, "filter");
  assert.equal(t.outcome, "excluded");
  assert.deepEqual(t.excluded, { stage: "filter", reason: "insufficient_frontend_evidence" });
  assert.equal(t.stages.filter.passed, false);
  assert.equal(t.stages["pre-ranker"], undefined);
  assert.equal(t.title, "Java Developer");
  assert.equal(t.url, "https://www.adzuna.example/details/J");
  assert.equal(t.description.snapshot, SNIPPET, "the discovery snippet is kept even for a rejected job");
}

// 3. Pre-ranker rejections: lead/intern title and a non-local onsite location.
{
  const intern = entryOf(state, jobs()[6]).triage;
  assert.equal(intern.stageReached, "pre-ranker");
  assert.equal(intern.excluded.stage, "pre-ranker");
  assert.match(intern.excluded.reason, /ROLE INELIGIBLE/);
  assert.equal(intern.stages["pre-ranker"].roleEligible, false);
  assert.equal(typeof intern.preRankScore, "number");

  const berlin = entryOf(state, jobs()[7]).triage;
  assert.equal(berlin.excluded.stage, "pre-ranker");
  assert.equal(berlin.stages["pre-ranker"].locationEligible, false);
  assert.equal(berlin.stages["pre-ranker"].locationCategory, "ONSITE_NON_LOCAL");
  assert.ok(berlin.stages["pre-ranker"].signals.length > 0);
}

// 4. A job that reached enrichment stores its description information.
{
  const reachedEnrichment = Object.values(state.jobs).map((e) => e.triage).filter((t) => t.stages.enrichment);
  assert.ok(reachedEnrichment.length >= 3);
  const kept = reachedEnrichment.find((t) => t.stages.enrichment.passed && t.outcome === "selected");
  assert.ok(kept, "a job passed enrichment and was selected");
  assert.equal(kept.stageReached, "enrichment");
  assert.equal(kept.description.enriched, true);
  assert.equal(kept.description.length, LONG.length);
  assert.equal(kept.description.snapshot.length, TRIAGE_DESCRIPTION_LIMIT);
  assert.equal(kept.description.truncated, true);
  assert.match(kept.description.hash, /^[0-9a-f]{16}$/);
  assert.equal(kept.stages.enrichment.enriched, true);

  const dropped = Object.values(state.jobs).map((e) => e.triage).find((t) => t.excluded?.stage === "enrichment" && /7\+? years|7 years/.test(t.excluded.reason));
  assert.ok(dropped, "a job dropped by the full-description re-check records the exact reason");
  assert.equal(dropped.stages.enrichment.passed, false);
  assert.equal(dropped.description.enriched, true);
}

// 5. Eligible jobs that never reached enrichment say where they were cut.
{
  const cut = Object.values(state.jobs).map((e) => e.triage).filter((t) => /outside the enrichment pool/.test(t.excluded?.reason ?? ""));
  assert.ok(cut.length >= 1);
  assert.ok(cut.every((t) => t.stages["pre-ranker"].rank > 0 && !t.stages.enrichment));
}

// 6. An analysed job records the analysis and the final decision.
{
  const pick = selected[0];
  const t = entryOf(state, pick).triage;
  triage.analysis(pick, { fromCache: false, extractionStatus: "complete", model: "qwen3:8b" });
  triage.final(pick, { decision: "MAYBE", jobFitScore: 69.1, decisionReasons: ["Job fit 69.1 is between 60 and 75."] });
  assert.equal(t.stageReached, "final");
  assert.equal(t.outcome, "decided");
  assert.equal(t.decision, "MAYBE");
  assert.equal(t.jobFitScore, 69.1);
  assert.deepEqual(t.stages.analysis, { passed: true, reason: null, fromCache: false, extractionStatus: "complete", model: "qwen3:8b" });
  assert.deepEqual(t.stages.final.decisionReasons, ["Job fit 69.1 is between 60 and 75."]);
  assert.equal(t.excluded, null);
  assert.equal(JSON.parse(JSON.stringify(state)).jobs[t.key].triage.decision, "MAYBE", "saved with the state entry");

  const other = selected[1];
  triage.analysisFailed(other, new Error("Ollama request timed out"));
  const f = entryOf(state, other).triage;
  assert.deepEqual(f.excluded, { stage: "analysis", reason: "Ollama request timed out" });
}

// 7. Missing fields are null/unknown, never invented.
{
  const t = entryOf(state, jobs()[8]).triage ?? Object.values(state.jobs).map((e) => e.triage).find((x) => x.title === "Frontend Developer M");
  assert.equal(t.url, null);
  assert.equal(t.postedAt, null);
  assert.equal(t.company, null);
  assert.equal(t.location, null);
  assert.deepEqual(t.description, { available: false, length: 0, hash: null, snapshot: null, truncated: false, enriched: null });
  assert.equal(t.decision, null);
  assert.equal(t.preRankScore === null || typeof t.preRankScore === "number", true);
  assert.equal(t.workMode.searchMode, "local");
  const bare = createTriage(emptyState());
  assert.equal(bare.summary().total, 0);
  assert.equal(describeDescription(undefined).available, false);
}

// 8. Hidden jobs keep a record that says why.
{
  const hiddenState = emptyState();
  const first = await runPipeline({ jobs: jobs(), state: hiddenState });
  const key = [...first.triage.records.keys()][0];
  setJobStatus(hiddenState, key, "dismissed", { now: NOW });
  const second = await runPipeline({ jobs: jobs(), state: hiddenState });
  assert.deepEqual(hiddenState.jobs[key].triage.excluded, { stage: "discovered", reason: "hidden by an earlier decision: dismissed" });
  assert.equal(hiddenState.jobs[key].status, "dismissed", "the user's decision is untouched");
  assert.equal(second.triage.records.size, jobs().length);
}

// 9. Secrets are not stored; URLs keep their other parameters.
assert.equal(sanitizeUrl("https://x.example/j?id=1&app_key=SECRET&utm_source=a&token=T"), "https://x.example/j?id=1&utm_source=a");
assert.equal(sanitizeUrl(""), null);
assert.ok(!JSON.stringify(state).includes("SECRET"));

// 10. Existing behaviour is unchanged: triage is additive, deterministic, and the
//     selection equals the one made without it.
{
  const plainState = emptyState();
  const plain = applyState(jobs(), plainState, { now: NOW });
  const plainFilter = filterJobs(plain.fresh);
  const plainShortlist = await selectFinalShortlist(plainFilter.kept, { finalSize: 2, poolSize: 3, enrich });
  assert.deepEqual(selected.map((j) => j.id), plainShortlist.selected.map((j) => j.id));
  assert.deepEqual(stats.dropped.map((j) => j.id), plainShortlist.stats.dropped.map((j) => j.id));
  for (const [key, entry] of Object.entries(state.jobs)) {
    const { triage: _ignored, ...rest } = entry;
    assert.deepEqual(rest, plainState.jobs[key], "state entries are identical apart from `triage`");
  }
  const again = await runPipeline({ jobs: jobs() });
  const strip = (s) => JSON.stringify(Object.values(s.jobs).map((e) => e.triage));
  const baseline = await runPipeline({ jobs: jobs() });
  assert.equal(strip(again.state), strip(baseline.state), "same input gives byte-identical triage");
}

// 11. A selected job kept for free (valid cached analysis) says it used no analysis slot.
{
  const run = await runPipeline({
    jobs: [job("A", "Frontend Developer A"), job("C", "Frontend Developer C"), job("D", "Frontend Developer D")],
    finalSize: 1, poolSize: 3, isCached: (j) => j.id === "adzuna-A"
  });
  const slot = (id) => entryOf(run.state, job(id, `Frontend Developer ${id}`)).triage;
  assert.equal(slot("A").outcome, "selected");
  assert.equal(slot("A").stages.enrichment.analysisSlot, false, "cached job: no slot");
  assert.equal(slot("C").stages.enrichment.analysisSlot, true, "unanalysed job: one slot");
  assert.deepEqual(slot("D").excluded, { stage: "enrichment", reason: "passed the re-check but was outside the final selection after re-ranking on the full description" });
  // Without a cache every selected job used a slot.
  const plainSelected = Object.values(state.jobs).map((e) => e.triage).filter((t) => t.outcome === "selected" || t.outcome === "analysed" || t.outcome === "decided");
  assert.ok(plainSelected.length > 0 && plainSelected.every((t) => t.stages.enrichment.analysisSlot === true));
}

// 12. A cached job below the enrichment cutoff is carried: the record says selected, no slot, reused.
{
  const letters = ["A", "B", "C", "D", "E"];
  const run = await createRun(letters);
  async function createRun(list) {
    return runPipeline({
      jobs: list.map((id) => job(id, `Frontend Developer ${id}`)),
      finalSize: 1, poolSize: 2, isCached: (j) => j.id === "adzuna-E"
    });
  }
  const rec = (id) => entryOf(run.state, job(id, `Frontend Developer ${id}`)).triage;
  assert.equal(rec("E").outcome, "selected");
  assert.equal(rec("E").stages["pre-ranker"].cachedBelowCutoff, true);
  assert.equal(rec("E").excluded, null);
  assert.equal(rec("E").stages.enrichment, undefined, "it was never enriched");
  assert.match(rec("C").excluded.reason, /outside the enrichment pool/, "an uncached job below the cutoff is still excluded");
  assert.equal(rec("A").outcome, "selected");
  assert.equal(rec("A").stages.enrichment.analysisSlot, true);
}

console.log("PASS: triage record checks passed (offline).");
