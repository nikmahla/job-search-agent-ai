import assert from "node:assert/strict";
import fs from "node:fs";
import { searchHimalayasJobs } from "./job-sources.js";
import { filterJobs } from "./job-filter.js";
import { deduplicateJobs, selectTopJobs } from "./job-pre-ranker.js";
import { scoreJob } from "./job-scorer.js";
import { buildSourceInfo } from "./analyze-job.js";

// Offline integration test: real deduplicateJobs -> filterJobs -> selectTopJobs ->
// sourceInfo assembly -> scoreJob/evaluateLocation. The sourceInfo assembly
// run-agent.js uses now lives in analyze-job.js, so it is imported directly.
const assembleSourceInfo = buildSourceInfo;
const runAgentSource = fs.readFileSync(new URL("./run-agent.js", import.meta.url), "utf8");
assert.ok(runAgentSource.includes("analyzeJob(rawJob"), "run-agent.js analyses jobs through analyze-job.js");

const candidate = {
  candidate: { experienceYears: 4, location: { acceptedCities: ["Alicante", "Valencia"] }, workAuthorization: { eu: true } },
  skills: { primary: ["React"] }
};
const JOB_URL = "https://example.test/jobs/pipeline-1";
const TITLE = "Frontend Developer (React)";
const COMPANY = "Pipeline Co";

const himalayasJob = async (restrictions, timezones = []) => {
  const [job] = await searchHimalayasJobs({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        jobs: [{
          guid: "pipeline-1",
          title: TITLE,
          companyName: COMPANY,
          locationRestrictions: restrictions.map((name) => ({ name })),
          timezoneRestrictions: timezones,
          pubDate: Math.floor(Date.now() / 1000),
          applicationLink: JOB_URL,
          description: "<p>React frontend role.</p>"
        }]
      })
    })
  });
  return job;
};

const adzunaJob = ({ location, remote, restrictions = [], timezones }) => ({
  id: "adzuna-pipeline-1",
  source: "adzuna",
  title: TITLE,
  company: COMPANY,
  location,
  url: `${JOB_URL}?utm_source=adzuna`,
  description: "Long Adzuna description for a React and TypeScript frontend role. ".repeat(20),
  sourceCountry: "es",
  searchMode: "local",
  remote,
  hybrid: false,
  locationRestrictions: restrictions,
  ...(timezones ? { timezoneRestrictions: timezones } : {})
});

// Runs the real stages and scores the first merged job's assembled sourceInfo.
const runPipeline = (records) => {
  const deduped = deduplicateJobs(records);
  assert.equal(deduped.length, 1, "duplicates merge into one job");
  const merged = deduped[0];
  const filtered = filterJobs(deduped);
  assert.equal(filtered.kept.length, 1, "relevant frontend role passes filterJobs");
  const selected = selectTopJobs(filtered.kept, 15);
  const sourceInfo = assembleSourceInfo(merged);
  const gate = scoreJob(candidate, {
    job: { title: merged.title, company: merged.company, description: merged.description },
    location: { type: "remote", city: null, country: null, remoteScope: "unknown" },
    sourceInfo
  }).gates.location;
  return { merged, filtered: filtered.kept[0], selected, sourceInfo, gate };
};

const both = (a, b) => [[a, b], [b, a]];

// Provenance fields reach sourceInfo in every scenario.
const assertProvenance = ({ merged, sourceInfo }) => {
  assert.deepEqual([...merged.sources].sort(), ["adzuna", "himalayas"]);
  assert.equal(merged.sourceInfoList.length, 2);
  assert.match(merged.sourceAttribution, /Himalayas/);
  assert.deepEqual([...sourceInfo.sources].sort(), ["adzuna", "himalayas"]);
  assert.equal(sourceInfo.sourceInfoList.length, 2);
  assert.match(sourceInfo.sourceAttribution, /Himalayas/);
};

// Scenario A: US-only listing plus a local Adzuna copy, both orders.
for (const city of ["Valencia, Spain", "Alicante, Spain"]) {
  const himalayas = await himalayasJob(["United States"], ["UTC-8"]);
  for (const [first, second] of both(himalayas, adzunaJob({ location: city, remote: false }))) {
    const result = runPipeline([first, second]);
    const label = `${city} (${first.source} first)`;
    assert.deepEqual(result.merged.locationRestrictions, ["United States"], label);
    assert.deepEqual(result.merged.locationRestrictionSets, [["United States"]], label);
    assert.deepEqual(result.merged.timezoneRestrictions, ["UTC-8"], label);
    assert.deepEqual(result.merged.timezoneRestrictionSets, [["UTC-8"]], label);
    assert.equal(result.merged.restrictionConflict, false, label);
    assert.equal(result.merged.timezoneConflict, false, label);
    assert.equal(result.sourceInfo.timezoneConflict, false, label);
    assert.equal(result.filtered.preFilter.keep, true, label);
    assert.equal(result.filtered.preRank, undefined, "filterJobs does not rank");
    assert.equal(result.selected.length, 0, `${label}: not selected for analysis`);
    assert.deepEqual(result.sourceInfo.locationRestrictions, ["United States"], label);
    assert.deepEqual(result.sourceInfo.timezoneRestrictions, ["UTC-8"], label);
    assert.equal(result.sourceInfo.restrictionConflict, false, label);
    assert.equal(result.sourceInfo.locationRestrictionSets, undefined, "sets are intentionally not forwarded");
    assert.equal(result.gate.status, "FAIL", `${label}: scorer must not PASS`);
    assertProvenance(result);
  }
}

// Scenario B: Spain-only vs United States-only restrictions, both orders.
{
  const spain = await himalayasJob(["Spain"]);
  const usAdzuna = adzunaJob({ location: "Remote", remote: true, restrictions: ["United States"] });
  for (const [first, second] of both(spain, usAdzuna)) {
    const result = runPipeline([first, second]);
    const label = `conflict (${first.source} first)`;
    assert.equal(result.merged.restrictionConflict, true, label);
    assert.equal(result.merged.timezoneConflict, false, label);
    assert.deepEqual(result.merged.locationRestrictions, [], label);
    assert.deepEqual(result.merged.locationRestrictionSets.map((set) => set[0]).sort(), ["Spain", "United States"], label);
    assert.equal(result.selected.length, 1, `${label}: kept for review`);
    assert.equal(result.selected[0].preRank.locationCategory, "RESTRICTION_CONFLICT", label);
    assert.equal(result.selected[0].preRank.eligible, true, label);
    assert.equal(result.sourceInfo.restrictionConflict, true, "conflict signal reaches the scorer input");
    assert.deepEqual(result.sourceInfo.locationRestrictions, [], label);
    assert.equal(result.gate.status, "FLAG", label);
    assertProvenance(result);
  }
}

// Scenario C: identical restrictions that differ only in capitalization, both orders.
{
  const spain = await himalayasJob(["Spain"]);
  const lowerAdzuna = adzunaJob({ location: "Remote", remote: true, restrictions: ["spain"] });
  for (const [first, second] of both(spain, lowerAdzuna)) {
    const result = runPipeline([first, second]);
    const label = `identical (${first.source} first)`;
    assert.equal(result.merged.restrictionConflict, false, label);
    assert.equal(result.merged.locationRestrictionSets.length, 1, label);
    assert.equal(result.selected.length, 1, label);
    assert.equal(result.selected[0].preRank.locationCategory, "SPAIN_REMOTE", label);
    assert.equal(result.sourceInfo.restrictionConflict, false, label);
    assert.equal(result.gate.status, "PASS", `${label}: Spain-only restriction is eligible`);
    assertProvenance(result);
  }
}

// Scenario D: timezone-only disagreement keeps the agreed Spain restriction and is flagged.
{
  const spainUtcMinus8 = await himalayasJob(["Spain"], ["UTC-8"]);
  const spainUtcPlus1 = adzunaJob({ location: "Remote", remote: true, restrictions: ["Spain"], timezones: ["UTC+1"] });
  for (const [first, second] of both(spainUtcMinus8, spainUtcPlus1)) {
    const result = runPipeline([first, second]);
    const label = `timezone conflict (${first.source} first)`;
    assert.equal(result.merged.restrictionConflict, false, label);
    assert.equal(result.merged.timezoneConflict, true, label);
    assert.deepEqual(result.merged.locationRestrictions, ["Spain"], label);
    assert.deepEqual(result.merged.timezoneRestrictions, [], label);
    assert.equal(result.merged.timezoneRestrictionSets.length, 2, label);
    assert.equal(result.selected.length, 1, label);
    assert.equal(result.selected[0].preRank.locationCategory, "SPAIN_REMOTE", label);
    assert.equal(result.selected[0].preRank.eligible, true, label);
    assert.equal(result.sourceInfo.restrictionConflict, false, label);
    assert.equal(result.sourceInfo.timezoneConflict, true, "timezone conflict signal reaches the scorer input");
    assert.deepEqual(result.sourceInfo.locationRestrictions, ["Spain"], label);
    assert.deepEqual(result.sourceInfo.timezoneRestrictions, [], label);
    assert.equal(result.gate.status, "FLAG", `${label}: not PASS`);
    assertProvenance(result);
  }
}

// Scenario E: identical timezones (different order/case) and a source without timezones do not conflict.
{
  const multi = await himalayasJob(["Spain"], ["UTC+1", "UTC+2"]);
  const reordered = adzunaJob({ location: "Remote", remote: true, restrictions: ["Spain"], timezones: ["utc+2", "utc+1"] });
  const noTimezone = adzunaJob({ location: "Remote", remote: true, restrictions: ["Spain"] });
  for (const other of [reordered, noTimezone]) {
    for (const [first, second] of both(multi, other)) {
      const result = runPipeline([first, second]);
      const label = `no timezone conflict (${first.source} first, ${other === reordered ? "reordered" : "no timezones"})`;
      assert.equal(result.merged.restrictionConflict, false, label);
      assert.equal(result.merged.timezoneConflict, false, label);
      assert.equal(result.merged.timezoneRestrictionSets.length, 1, label);
      assert.deepEqual(result.merged.locationRestrictions, ["Spain"], label);
      assert.equal(result.merged.timezoneRestrictions.length, 2, label);
      assert.equal(result.sourceInfo.timezoneConflict, false, label);
      assert.equal(result.gate.status, "PASS", label);
    }
  }
}

console.log("PASS: restriction pipeline integration checks passed (offline).");
