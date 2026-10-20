// Extraction validation on SAVED job descriptions: local Qwen, Claude, or an
// A/B comparison of both on the exact same jobs.
//
//   node scripts/qwen-validation.js                      # Qwen only (default)
//   node scripts/qwen-validation.js --extractor claude   # Claude only
//   node scripts/qwen-validation.js --extractor both --reuse-qwen data/qwen-validation.json
//   options: --limit N (default 15)
//
// - Reads saved jobs from data/job-results.json (no job search, no Adzuna,
//   no Himalayas, no page fetches).
// - Qwen: calls ONLY a local Ollama (OLLAMA_URL must point to localhost).
// - Claude: calls only https://api.anthropic.com with ANTHROPIC_API_KEY, and
//   sends only the public posting fields (title, company, location,
//   description). The candidate profile is used locally for scoring only.
// - Every extraction goes through the same normalizer, the same audit and the
//   same scorer/decision engine. Nothing in scoring is changed.
// - Writes data/qwen-validation.json, data/claude-validation.json or
//   data/extraction-ab.json. data/job-results.json is never modified.
import fs from "node:fs/promises";
import { buildJobProfile } from "../src/build-job-profile.js";
import { scoreJob } from "../src/job-scorer.js";
import { isRemote, isHybrid } from "../src/job-source-rules.js";
import { auditExtraction, correctExtraction } from "../src/extraction-audit.js";
import { extractWithClaude, estimateClaudeCostUsd, DEFAULT_CLAUDE_MODEL } from "../src/claude-extractor.js";
import { compareExtractions, profileFromSummary, summarizeExtraction } from "../src/extraction-compare.js";

const OUTPUT = {
  qwen: "./data/qwen-validation.json",
  claude: "./data/claude-validation.json",
  both: "./data/extraction-ab.json"
};

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const mode = argValue("--extractor") ?? "qwen";
if (!["qwen", "claude", "both"].includes(mode)) {
  console.error(`Unknown --extractor "${mode}". Use qwen, claude or both.`);
  process.exit(1);
}
const reuseQwenFile = argValue("--reuse-qwen");
const limit = Math.max(1, Number(argValue("--limit")) || 15);
const runQwenLive = mode === "qwen" || (mode === "both" && !reuseQwenFile);
const runClaude = mode === "claude" || mode === "both";

if (reuseQwenFile && mode !== "both") {
  console.error("--reuse-qwen is only used with --extractor both.");
  process.exit(1);
}

const ollamaUrl = new URL(process.env.OLLAMA_URL ?? "http://localhost:11434/api/chat");
if (runQwenLive && !["localhost", "127.0.0.1", "[::1]", "::1"].includes(ollamaUrl.hostname)) {
  console.error(`Refusing to run: OLLAMA_URL points to ${ollamaUrl.hostname}, not a local Ollama.`);
  process.exit(1);
}
if (runClaude && !process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to .env to run the Claude extraction; nothing was sent.");
  process.exit(1);
}

const candidate = JSON.parse(await fs.readFile("./data/candidate-profile.json", "utf-8"));
const saved = JSON.parse(await fs.readFile("./data/job-results.json", "utf-8"));

// One entry per distinct posting, with its saved (enriched) description.
const seen = new Set();
const jobs = [];
for (const result of saved) {
  const source = result.sourceInfo ?? {};
  const key = `${result.title}|${result.company}`;
  if (seen.has(key) || !source.description) continue;
  seen.add(key);
  jobs.push({ key, title: result.title, company: result.company, source });
}
const selected = jobs.slice(0, limit);

let reusedQwen = null;
if (reuseQwenFile) {
  const reused = JSON.parse(await fs.readFile(reuseQwenFile, "utf-8"));
  reusedQwen = new Map((reused.records ?? []).map((record) => [`${record.title}|${record.company}`, record]));
}

// Same source-of-truth handling as run-agent.js.
function jobContext({ title, company, source }) {
  const rawJob = { title, company, location: source.location, description: source.description };
  const isHimalayas = (source.sources ?? [source.source]).includes("himalayas");
  const adzunaShape = { title, description: source.description, location: { display_name: source.location } };
  return {
    rawJob,
    sourceInfo: {
      ...source,
      remote: isHimalayas ? source.remote === true : isRemote(adzunaShape),
      hybrid: isHimalayas ? source.hybrid === true : isHybrid(adzunaShape),
      locationRestrictions: source.locationRestrictions ?? [],
      timezoneRestrictions: source.timezoneRestrictions ?? []
    }
  };
}

const summarizeResult = (scored) => ({
  decision: scored.decision,
  jobFitScore: scored.jobFitScore,
  decisionReasons: scored.decisionReasons,
  missingRequiredSkills: scored.missingRequiredSkills,
  missingPreferredSkills: scored.missingPreferredSkills,
  gates: Object.fromEntries(Object.entries(scored.gates).map(([key, gate]) => [key, gate.status]))
});

// In A/B mode both extractors are audited from the stored summary (a reused
// Qwen run has nothing more), so both are judged identically. Single-extractor
// runs audit the full profile, as before.
const auditFromSummary = mode === "both";
function auditSummary(description, summary) {
  return auditExtraction(description, profileFromSummary(summary));
}

function evaluate(profile, context) {
  profile.job = { ...(profile.job ?? {}), title: context.rawJob.title, company: context.rawJob.company, description: context.rawJob.description };
  profile.sourceInfo = context.sourceInfo;
  const extraction = summarizeExtraction(profile);
  const scored = scoreJob(candidate, profile);
  const findings = auditFromSummary ? auditSummary(context.rawJob.description, extraction) : auditExtraction(context.rawJob.description, profile);
  const actionable = findings.filter((finding) => finding.severity !== "info");
  const corrected = actionable.length ? scoreJob(candidate, correctExtraction(profile, findings)) : scored;
  // The full normalized extraction (without the copied posting/source info),
  // so later comparisons are not limited to the summary.
  const { sourceInfo, job, ...extracted } = profile;
  return {
    extraction,
    profile: { ...extracted, job: { title: job.title, company: job.company } },
    findings,
    result: summarizeResult(scored),
    resultIfExtractionCorrected: summarizeResult(corrected),
    decisionChangedByCorrection: corrected.decision !== scored.decision
  };
}

async function qwenRecord(job, context) {
  const started = Date.now();
  try {
    const profile = await buildJobProfile(context.rawJob);
    return { ...evaluate(profile, context), seconds: Math.round((Date.now() - started) / 1000) };
  } catch (error) {
    return { error: error.message, seconds: Math.round((Date.now() - started) / 1000) };
  }
}

function reusedQwenRecord(job, context) {
  const record = reusedQwen.get(job.key);
  if (!record) return { error: "No saved Qwen record for this job." };
  if (record.error) return { error: record.error, seconds: record.seconds ?? null, reused: true };
  // The decision is the one saved with the full Qwen profile; the audit is
  // recomputed with the current auditor, exactly as for Claude.
  return {
    extraction: record.extraction,
    findings: auditSummary(context.rawJob.description, record.extraction),
    result: record.result,
    resultIfExtractionCorrected: null,
    decisionChangedByCorrection: null,
    seconds: record.seconds ?? null,
    reused: true
  };
}

async function claudeRecord(job, context) {
  try {
    const { profile, usage, latencyMs, model } = await extractWithClaude(context.rawJob);
    return { ...evaluate(profile, context), seconds: Math.round(latencyMs / 1000), model, usage, estimatedCostUsd: estimateClaudeCostUsd(usage) };
  } catch (error) {
    return { error: error.message };
  }
}

const describe = (record) => (record.error ? `✖ ${record.error}` : `${record.result.decision} | findings: ${record.findings.filter((finding) => finding.severity !== "info").map((finding) => finding.type).join(", ") || "none"}`);

const records = [];
console.log(`Mode: ${mode}${reuseQwenFile ? ` (Qwen reused from ${reuseQwenFile})` : ""} — ${selected.length} saved job(s)\n`);

for (const [index, job] of selected.entries()) {
  console.log(`[${index + 1}/${selected.length}] ${job.title} — ${job.company}`);
  const context = jobContext(job);
  const base = { title: job.title, company: job.company, location: job.source.location, descriptionLength: job.source.description.length };

  if (mode === "qwen") {
    const record = await qwenRecord(job, context);
    records.push({ ...base, ...record, humanVerdict: null });
    console.log(`   ${describe(record)}`);
    continue;
  }
  if (mode === "claude") {
    const record = await claudeRecord(job, context);
    records.push({ ...base, ...record, humanVerdict: null });
    console.log(`   ${describe(record)}`);
    continue;
  }

  const qwen = reuseQwenFile ? reusedQwenRecord(job, context) : await qwenRecord(job, context);
  const claude = await claudeRecord(job, context);
  const comparison = qwen.error || claude.error
    ? null
    : compareExtractions(
      { label: "qwen", summary: qwen.extraction, findings: qwen.findings, decision: qwen.result.decision },
      { label: "claude", summary: claude.extraction, findings: claude.findings, decision: claude.result.decision }
    );
  records.push({ ...base, qwen, claude, comparison, humanVerdict: null });
  console.log(`   qwen:   ${describe(qwen)}`);
  console.log(`   claude: ${describe(claude)}${comparison?.decisionsDiffer ? "   <-- decisions differ" : ""}`);
}

const countFindings = (list) => list.reduce((counts, record) => {
  for (const finding of record?.findings ?? []) if (finding.severity !== "info") counts[finding.type] = (counts[finding.type] ?? 0) + 1;
  return counts;
}, {});

let output;
if (mode === "both") {
  const compared = records.filter((record) => record.comparison);
  const claudeOk = records.filter((record) => !record.claude.error);
  const usage = claudeOk.reduce((total, record) => ({
    input_tokens: total.input_tokens + Number(record.claude.usage?.input_tokens ?? 0),
    output_tokens: total.output_tokens + Number(record.claude.usage?.output_tokens ?? 0)
  }), { input_tokens: 0, output_tokens: 0 });
  output = {
    generatedAt: new Date().toISOString(),
    models: { qwen: process.env.OLLAMA_MODEL ?? "qwen3:8b", claude: process.env.CLAUDE_EXTRACTION_MODEL || DEFAULT_CLAUDE_MODEL },
    qwenSource: reuseQwenFile ? `reused:${reuseQwenFile}` : "live",
    summary: {
      jobs: records.length,
      qwenFailures: records.filter((record) => record.qwen.error).map((record) => record.title),
      claudeFailures: records.filter((record) => record.claude.error).map((record) => record.title),
      compared: compared.length,
      decisionAgreement: compared.filter((record) => !record.comparison.decisionsDiffer).length,
      decisionsDiffer: compared.filter((record) => record.comparison.decisionsDiffer)
        .map((record) => ({ title: record.title, company: record.company, qwen: record.qwen.result.decision, claude: record.claude.result.decision })),
      requiredVsPreferredConflicts: compared.reduce((sum, record) => sum + record.comparison.requiredVsPreferred.length, 0),
      auditFindings: { qwen: countFindings(records.map((record) => record.qwen)), claude: countFindings(records.map((record) => record.claude)) },
      claudeUsage: { ...usage, estimatedCostUsd: Number(estimateClaudeCostUsd(usage).toFixed(4)) }
    },
    records
  };
} else {
  output = {
    generatedAt: new Date().toISOString(),
    model: mode === "qwen" ? process.env.OLLAMA_MODEL ?? "qwen3:8b" : process.env.CLAUDE_EXTRACTION_MODEL || DEFAULT_CLAUDE_MODEL,
    records
  };
}

await fs.writeFile(OUTPUT[mode], JSON.stringify(output, null, 2), "utf-8");
console.log(`\nSaved ${records.length} record(s) to ${OUTPUT[mode]}`);
if (mode === "both") {
  const { summary } = output;
  console.log(`Decisions agree on ${summary.decisionAgreement}/${summary.compared} compared jobs.`);
  console.log(`Audit findings — qwen: ${JSON.stringify(summary.auditFindings.qwen)}  claude: ${JSON.stringify(summary.auditFindings.claude)}`);
  console.log(`Claude tokens: ${summary.claudeUsage.input_tokens} in / ${summary.claudeUsage.output_tokens} out (≈ $${summary.claudeUsage.estimatedCostUsd})`);
} else {
  const allFindings = records.reduce((counts, record) => {
    for (const finding of record.findings ?? []) counts[finding.type] = (counts[finding.type] ?? 0) + 1;
    return counts;
  }, {});
  console.log(`Extraction findings: ${JSON.stringify(allFindings)}`);
  console.log(`Decisions changed by correcting extraction: ${records.filter((record) => record.decisionChangedByCorrection).length}`);
}
