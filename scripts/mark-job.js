// Change a job's state by hand.
//
//   npm run mark -- <job-key|url|part-of-key> applied [note...]
//   npm run mark -- <job-key|url|part-of-key> dismissed [note...]
//   npm run mark -- <job-key|url|part-of-key> expired|new
//
// applied/dismissed/expired jobs are hidden from future runs; "new" un-hides a
// job. Only data/job-state.json is changed (atomically).
import { MARKABLE_STATUSES, STATE_FILE, loadState, resolveJobKey, saveStateAtomic, setJobStatus } from "../src/job-state.js";

const [input, status, ...noteWords] = process.argv.slice(2);
if (!input || !status) {
  console.error(`Usage: npm run mark -- <job-key|url|part-of-key> <${MARKABLE_STATUSES.join("|")}> [note]`);
  process.exit(1);
}
if (!MARKABLE_STATUSES.includes(status)) {
  console.error(`Unknown status "${status}". Use one of: ${MARKABLE_STATUSES.join(", ")}.`);
  process.exit(1);
}

let state;
try {
  state = await loadState();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { key, matches } = resolveJobKey(state, input);
if (!key) {
  if (matches.length > 1) {
    console.error(`"${input}" matches ${matches.length} jobs; use a longer part of the key:`);
    for (const match of matches.slice(0, 20)) console.error(`  ${match}  (${state.jobs[match].title} — ${state.jobs[match].company})`);
  } else {
    console.error(`No job in ${STATE_FILE} matches "${input}". Run "npm run jobs:status -- --all" to list keys.`);
  }
  process.exit(1);
}

const before = state.jobs[key].status;
const entry = setJobStatus(state, key, status, { note: noteWords.join(" ") || undefined });
await saveStateAtomic(state);
console.log(`${entry.title ?? key} — ${entry.company ?? ""}`);
console.log(`  ${before} → ${entry.status}  (${key})`);
