// Builds (or rebuilds) application packs from the last run, without Qwen.
//
//   npm run apply:pack                 # every APPLY job in data/job-results.json
//   npm run apply:pack -- <key|part>   # one job (must still be APPLY)
//   npm run apply:pack -- <key> --force  # one job even if it is not APPLY
//
// For each job the cached Qwen extraction (data/job-state.json) is reused only
// if it is still valid for this description and this extraction code; the
// current scorer is then re-run, so the coverage matches today's rules.
// Jobs without a valid cached extraction are skipped with a reason (run
// `npm start` again to refresh them). Packs go to data/applications/.
import fs from "node:fs/promises";
import { applySourceFacts } from "../src/analyze-job.js";
import { APPLICATIONS_DIR, writeApplicationPack } from "../src/application-pack.js";
import { scoreJob } from "../src/job-scorer.js";
import { computeAnalysisHashes, getCachedExtraction, loadState, resolveJobKey } from "../src/job-state.js";

const RESULTS_FILE = process.env.JOB_RESULTS_FILE || "./data/job-results.json";
const CANDIDATE_FILE = process.env.CANDIDATE_FILE || "./data/candidate-profile.json";

const args = process.argv.slice(2);
const force = args.includes("--force");
const target = args.find((arg) => !arg.startsWith("--"));

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf-8"));

let results;
let candidate;
let state;
try {
  results = await readJson(RESULTS_FILE);
  candidate = await readJson(CANDIDATE_FILE);
  state = await loadState();
} catch (error) {
  console.error(`Cannot build packs: ${error.message}`);
  process.exit(1);
}
const hashes = await computeAnalysisHashes();

let selected = results.filter((result) => result.decision === "APPLY");
if (target) {
  const { key, matches } = resolveJobKey(state, target);
  const wanted = key ? [key] : [];
  selected = results.filter((result) => wanted.includes(result.stateKey));
  if (!selected.length) {
    console.error(key
      ? `${key} is not in ${RESULTS_FILE} (only the last run's jobs can be packed).`
      : matches.length > 1 ? `"${target}" matches ${matches.length} jobs; use a longer part of the key.` : `No job matches "${target}".`);
    process.exit(1);
  }
}
if (!selected.length) {
  console.log(`No APPLY jobs in ${RESULTS_FILE}.`);
  process.exit(0);
}

let written = 0;
for (const result of selected) {
  const info = result.sourceInfo ?? {};
  const label = `${result.title} — ${result.company}`;
  const entry = result.stateKey ? state.jobs[result.stateKey] : null;
  const cached = getCachedExtraction(entry, { description: info.description, hashes });
  if (!cached.profile) {
    console.log(`  ✖ ${label}: skipped — no valid cached extraction (${cached.reason}); run "npm start" to refresh it.`);
    continue;
  }
  const rawJob = {
    id: info.id, url: info.url, source: info.source, sourceInfoList: info.sourceInfoList, sourceAttribution: info.sourceAttribution,
    sourceCountry: info.sourceCountry, searchMode: info.searchMode, location: info.location,
    locationRestrictions: info.locationRestrictions, timezoneRestrictions: info.timezoneRestrictions,
    restrictionConflict: info.restrictionConflict, timezoneConflict: info.timezoneConflict,
    description: info.description, remote: info.remote, hybrid: info.hybrid, created: info.created, salary: info.salary,
    title: result.title, company: result.company
  };
  const jobProfile = applySourceFacts(cached.profile, rawJob);
  const scored = scoreJob(candidate, jobProfile);
  if (scored.decision !== "APPLY" && !force) {
    console.log(`  ✖ ${label}: skipped — the current scorer now says ${scored.decision} (use --force to pack it anyway).`);
    continue;
  }
  const { dir, coverage } = await writeApplicationPack({
    job: { ...rawJob, sources: info.sources, stateKey: result.stateKey },
    candidate, jobProfile, scored
  });
  written += 1;
  console.log(`  ✓ ${label} → ${dir}  (${coverage.summary.MATCH} match, ${coverage.summary.PARTIAL} partial, ${coverage.summary.GAP} gap, ${coverage.summary.UNKNOWN} unknown)`);
}
console.log(`\n${written} application pack(s) in ${APPLICATIONS_DIR}.`);
