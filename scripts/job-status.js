// Overview of data/job-state.json.
//
//   npm run jobs:status            # counts, last run, open APPLY/MAYBE jobs, applied jobs
//   npm run jobs:status -- --all   # every job with its key
import { STATE_FILE, loadState, summarizeState } from "../src/job-state.js";

const showAll = process.argv.includes("--all");

let state;
try {
  state = await loadState();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const summary = summarizeState(state);
if (!summary.total) {
  console.log(`No jobs in ${STATE_FILE} yet. It is filled by the next "npm start" run.`);
  process.exit(0);
}

const line = (key, entry) => {
  const result = entry.lastResult ? `${entry.lastResult.decision ?? "-"} ${entry.lastResult.jobFitScore ?? "-"}` : "not analysed";
  return `  ${entry.status.padEnd(11)} ${result.padEnd(14)} ${entry.title ?? "?"} — ${entry.company ?? "?"}\n      key: ${key}${entry.url ? `\n      url: ${entry.url}` : ""}${entry.note ? `\n      note: ${entry.note}` : ""}`;
};

console.log(`Job state: ${STATE_FILE}`);
console.log(`  Jobs: ${summary.total} | cached extractions: ${summary.cachedExtractions}`);
console.log(`  By status: ${Object.entries(summary.byStatus).map(([status, count]) => `${status} ${count}`).join(", ")}`);
if (summary.lastRun) {
  const run = summary.lastRun;
  console.log(`  Last run ${run.at}: ${run.newJobs ?? 0} new, ${run.alreadySeen ?? 0} seen, ${run.cacheReused ?? 0} cached, ${run.qwenCalls ?? 0} Qwen call(s), ${run.analysisFailures ?? 0} failed`);
}

const entries = Object.entries(state.jobs);
const byScore = (a, b) => (b[1].lastResult?.jobFitScore ?? -1) - (a[1].lastResult?.jobFitScore ?? -1);

if (showAll) {
  console.log("\nAll jobs:");
  for (const [key, entry] of entries.sort(byScore)) console.log(line(key, entry));
} else {
  const open = entries.filter(([, entry]) => ["ranked", "unreachable"].includes(entry.status) && ["APPLY", "MAYBE"].includes(entry.lastResult?.decision));
  console.log(`\nOpen APPLY / MAYBE (not yet applied or dismissed): ${open.length}`);
  for (const [key, entry] of open.sort(byScore)) console.log(line(key, entry));
  const applied = entries.filter(([, entry]) => entry.status === "applied");
  console.log(`\nApplied: ${applied.length}`);
  for (const [key, entry] of applied) console.log(line(key, entry));
  console.log('\nMark: npm run mark -- <key> applied|dismissed   ·   Everything: npm run jobs:status -- --all');
}
