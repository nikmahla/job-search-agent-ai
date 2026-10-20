// Writes data/skill-gap-report.md from the saved job data. Offline: no model and
// no network calls, and it does not change job state, results or decisions.
//
//   npm run skills:report
//   npm run skills:report -- --out some/other/file.md
import fs from "node:fs/promises";
import { loadState } from "../src/job-state.js";
import { RUN_OUTPUT_PATHS } from "../src/run-output.js";
import { buildSkillGapReport, renderSkillGapReport } from "../src/skill-gap.js";

const CANDIDATE_FILE = "./data/candidate-profile.json";
const outIndex = process.argv.indexOf("--out");
const outFile = outIndex !== -1 && process.argv[outIndex + 1] ? process.argv[outIndex + 1] : "./data/skill-gap-report.md";

async function readJson(file, { optional = false } = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw new Error(`Could not read ${file}: ${error.message}`);
  }
}

try {
  const state = await loadState();
  const candidate = await readJson(CANDIDATE_FILE);
  const results = (await readJson(RUN_OUTPUT_PATHS.results, { optional: true })) ?? [];
  const report = buildSkillGapReport({ state, results, candidate });
  await fs.writeFile(outFile, renderSkillGapReport(report), "utf-8");
  console.log(`Skill gap report written to ${outFile}`);
  console.log(`  Jobs analysed: ${report.analyzed} | skills found: ${report.skills.length} | missing: ${report.skills.filter((s) => s.level === "Missing").length} | partial: ${report.skills.filter((s) => s.level === "Partial").length}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
