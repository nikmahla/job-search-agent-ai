import "dotenv/config";
import fs from "node:fs/promises";
import { analyzeJob } from "./analyze-job.js";
import { buildJobProfile as buildJobProfileLive } from "./build-job-profile.js";
import { formatSourceReport, runSources } from "./job-source-registry.js";
import { filterJobs } from "./job-filter.js";
import { deduplicateJobs } from "./job-pre-ranker.js";
import { getEnrichmentDiagnostics } from "./description-enrichment.js";
import { selectFinalShortlist, SHORTLIST_LIMITS } from "./shortlist.js";
import { saveRunOutputs, RUN_OUTPUT_PATHS } from "./run-output.js";
import { APPLICATIONS_DIR, writeApplicationPack } from "./application-pack.js";
import { reviewSummaryLines } from "./review-summary.js";
import { createTriage } from "./triage.js";
import {
  STATE_FILE,
  applyState,
  computeAnalysisHashes,
  findEntry,
  hasValidCachedAnalysis,
  loadState,
  recordAnalysis,
  recordAnalysisFailure,
  recordAvailability,
  recordRun,
  saveStateMerged,
  summarizeState
} from "./job-state.js";

const CANDIDATE_FILE =
  "./data/candidate-profile.json";

const MAX_JOBS_TO_ANALYZE = 15;

// Saves the job state once it is loaded (a no-op before that, so a state file
// that failed to load is never overwritten). Merges first, so marks made with
// `npm run mark` while this run is going are kept.
let persistState = async () => {};
async function checkJobUrl(url) {
  if (!url) {
    return { active: null, status: "unverified", reason: "missing-url" };
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(12000)
    });

    if (response.status === 404 || response.status === 410) {
      return { active: false, status: "inactive", reason: `http-${response.status}` };
    }

    if (response.ok) {
      return { active: true, status: "active", reason: `http-${response.status}` };
    }

    // Some job boards block HEAD requests or rate-limit automated checks.
    // Those responses do not prove that the vacancy has closed.
    return { active: null, status: "unverified", reason: `http-${response.status}` };
  } catch (error) {
    return {
      active: null,
      status: "unverified",
      reason: error?.name === "TimeoutError" ? "timeout" : "check-failed"
    };
  }
}

async function loadCandidate() {
  return JSON.parse(
    await fs.readFile(
      CANDIDATE_FILE,
      "utf-8"
    )
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printJobResult(index, result) {
  const decisionEmoji = {
    APPLY: "🟢",
    MAYBE: "🟡",
    SKIP: "🔴"
  };

  console.log(
    `\n${index}. ${decisionEmoji[result.decision] ?? "⚪"} ${result.title}`
  );

  console.log(
    `   Company: ${result.company}`
  );

  console.log(
    `   Job Fit: ${result.jobFitScore ?? "N/A"}`
  );

  console.log(
    `   ATS: ${result.atsScore ?? "N/A"}`
  );

  console.log(
    `   Evidence Coverage: ${result.scoringCoverage ?? "N/A"}%`
  );

  console.log(
    `   Decision: ${result.decision}`
  );

  console.log(
    `   Role Fit: ${result.gates.roleFit?.status ?? "UNKNOWN"}`
  );

  console.log(
    `   Location: ${result.gates.location.status}`
  );

  console.log(
    `   Language: ${result.gates.language.status}`
  );

  console.log(
    `   Work Authorization: ${result.gates.workAuthorization.status}`
  );

  reviewSummaryLines(result).forEach((line) => console.log(line));

  if (result.stateKey) {
    console.log(`   Key: ${result.stateKey}`);
  }
}

async function main() {
  console.log("\n🚀 JOB SEARCH AGENT STARTING...\n");

  const candidate =
    await loadCandidate();

  console.log("👩‍💻 Candidate loaded:");
  console.log(
    candidate.candidate?.name ?? "Unknown"
  );

  // --------------------------------------------------
  // 1. SEARCH JOBS
  // --------------------------------------------------

  console.log("\n🌍 Searching jobs (all enabled sources)...\n");

  // One list of sources (job-source-registry.js). A source that fails is
  // reported and skipped; the others still run.
  const { jobs: allJobs, report: sourceReport } = await runSources();

  console.log("\n📡 SOURCES");
  console.log(formatSourceReport(sourceReport));
  const failedSources = sourceReport.filter((row) => row.status === "failed");
  if (failedSources.length) {
    console.log(`  ⚠ ${failedSources.length} source(s) failed: ${failedSources.map((row) => row.name).join(", ")}`);
  }
  // --------------------------------------------------
// PRE-FILTER JOBS BEFORE QWEN
// --------------------------------------------------


  // Shared cross-source deduplication: richest description wins and every
  // source reference is kept in sourceInfoList.
  const uniqueJobs = deduplicateJobs(allJobs);

  console.log(
    `\n📦 Jobs found: ${uniqueJobs.length}`
  );

  if (!uniqueJobs.length) {
    console.log(
      "\n❌ No jobs found."
    );
    return;
  }

  // --------------------------------------------------
  // PERSISTENT STATE
  // --------------------------------------------------
  // Jobs already applied to, dismissed or expired are not processed again.
  // A corrupt state file stops the run instead of being overwritten.
  let state;
  try {
    state = await loadState();
  } catch (error) {
    console.error(`\n❌ ${error.message}`);
    process.exitCode = 1;
    return;
  }
  persistState = async () => {
    const kept = await saveStateMerged(state);
    if (kept.length) console.log(`  (kept ${kept.length} job mark(s) made with "npm run mark" during this run)`);
  };
  const hashes = await computeAnalysisHashes();
  const stateResult = applyState(uniqueJobs, state);
  const runStats = {
    found: uniqueJobs.length,
    newJobs: stateResult.counts.new,
    alreadySeen: stateResult.counts.alreadySeen,
    hiddenApplied: stateResult.counts.applied,
    hiddenDismissed: stateResult.counts.dismissed,
    hiddenExpired: stateResult.counts.expired,
    recheckExpired: stateResult.counts.recheckExpired,
    selected: 0,
    cacheReused: 0,
    qwenCalls: 0,
    analysisFailures: 0,
    expired: 0,
    unreachable: 0
  };
  console.log("\n🗂️  JOB STATE");
  console.log(`  New jobs: ${runStats.newJobs}`);
  console.log(`  Already seen: ${runStats.alreadySeen}`);
  console.log(`  Hidden (applied / dismissed / expired): ${runStats.hiddenApplied} / ${runStats.hiddenDismissed} / ${runStats.hiddenExpired}`);
  // Observation only: a triage record per discovered job, saved on its state entry.
  const triage = createTriage(state);
  triage.discovered(uniqueJobs, stateResult.hidden);
  if (runStats.recheckExpired) console.log(`  Expired jobs found again and re-checked: ${runStats.recheckExpired}`);

 console.log("\n🧹 PRE-FILTERING JOBS...");

const filterResult = filterJobs(stateResult.fresh);
triage.filter(filterResult);

console.log(`  Raw unique jobs: ${filterResult.total}`);
console.log(`  Kept after filter: ${filterResult.keptCount}`);
console.log(`  Rejected before Qwen: ${filterResult.rejectedCount}`);

// Rank the filtered jobs, enrich the best eligible pool, re-check it on the
// full descriptions, and only then select the final jobs for Qwen.
console.log("\n🎯 PRE-RANKING + ENRICHING SHORTLIST...");

const { selected: jobsToAnalyze, stats: shortlistStats } = await selectFinalShortlist(
  filterResult.kept,
  {
    finalSize: MAX_JOBS_TO_ANALYZE,
    poolSize: SHORTLIST_LIMITS.poolSize,
    // A job with a still-valid cached extraction needs no Qwen call, so it does
    // not use one of the MAX_JOBS_TO_ANALYZE slots.
    isCached: (job) => hasValidCachedAnalysis(state, job, hashes)
  }
);
console.log(`  Eligible before enrichment: ${shortlistStats.eligibleBeforeEnrichment}`);
console.log(`  Descriptions enriched: ${shortlistStats.enriched}/${shortlistStats.enrichmentAttempts} attempted`);
console.log(`  Dropped after full-description re-check: ${shortlistStats.dropped.length}`);
for (const dropped of shortlistStats.dropped) {
  console.log(`    ✖ ${dropped.title} — ${dropped.company}: ${dropped.reasons.join("; ")}`);
}
if (shortlistStats.backfilled) console.log(`  Backfilled from lower ranks: ${shortlistStats.backfilled}`);

console.log(
  `  Eligible jobs selected for Qwen: ${shortlistStats.analysisSlots}`
);
if (shortlistStats.cachedJobs.length) {
  console.log(`  Already analysed (cached, no Qwen call, no slot used): ${shortlistStats.cachedJobs.length}`);
}
if (shortlistStats.cachedBelowCutoff.length) {
  console.log(`    of which ranked below the analysis cutoff: ${shortlistStats.cachedBelowCutoff.length}`);
}

triage.shortlist(filterResult.kept, shortlistStats, jobsToAnalyze);
triage.commit();
console.log(`  Triage records saved: ${triage.summary().total} ${JSON.stringify(triage.summary().byOutcome)}`);
await persistState();

if (jobsToAnalyze.length === 0) {
  console.log("\n❌ No eligible jobs to analyze.");
  recordRun(state, runStats);
  await persistState();
  return;
}

console.log(
  `🧠 Jobs selected for analysis: ${jobsToAnalyze.length}`
);

  // --------------------------------------------------
  // 2. LIMIT JOBS FOR FIRST RUN
  // --------------------------------------------------

 

  // --------------------------------------------------
  // 3. QWEN + SCORING
  // --------------------------------------------------

  const results = [];
  const debugJobProfiles = [];
  // The scored profile of each result, for its application pack.
  const profilesByResult = new Map();
  for (
    let i = 0;
    i < jobsToAnalyze.length;
    i++
  ) {
    const rawJob =
      jobsToAnalyze[i];
    const qwenCallsBefore = runStats.qwenCalls;

    console.log(
      `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );

    console.log(
      `🔎 Job ${i + 1}/${jobsToAnalyze.length}`
    );

    console.log(
      `📌 ${rawJob.title}`
    );

    console.log(
      `🏢 ${rawJob.company}`
    );

    console.log(
      `📍 ${rawJob.location}`
    );

    const stateKey = findEntry(state, rawJob)?.[0];
    try {
      // ------------------------------
      // QWEN (or a still-valid cached extraction) + SCORER
      // ------------------------------

      const analysis = await analyzeJob(rawJob, {
        candidate,
        entry: stateKey ? state.jobs[stateKey] : null,
        hashes,
        extract: async (job) => {
          console.log(
            "\n🧠 Qwen is reading the job..."
          );
          runStats.qwenCalls += 1;
          return buildJobProfileLive(job);
        }
      });
      const { jobProfile, scored } = analysis;
      triage.analysis(rawJob, { fromCache: analysis.fromCache, extractionStatus: analysis.extraction?.extraction?.status ?? null, model: hashes.model });

      if (analysis.fromCache) {
        runStats.cacheReused += 1;
        console.log("\n♻️  Reusing cached extraction (description and extraction code unchanged)");
      } else if (analysis.cacheReason !== "not-cached") {
        console.log(`   (cache not used: ${analysis.cacheReason})`);
      }

      debugJobProfiles.push({
        title: jobProfile.job?.title ?? "",
        company: jobProfile.job?.company ?? "",
        sourceUrl: jobProfile.sourceInfo?.url ?? null,
        experience: jobProfile.experience ?? {
          minimumYears: null,
          requiredFunctions: []
        },
        responsibilities: jobProfile.responsibilities ?? {
          core: [],
          secondary: []
        },
        qualifications: jobProfile.qualifications ?? [],
        requirements: jobProfile.requirements ?? {
          required: [],
          preferred: []
        },
        location: jobProfile.location ?? {},
        ...getEnrichmentDiagnostics(rawJob)
      });

      console.log(
        "📊 Scoring against candidate..."
      );

      const result = {
        ...scored,
        stateKey: stateKey ?? null,
        sourceInfo:
          jobProfile.sourceInfo
      };
      results.push(result);
      profilesByResult.set(result, jobProfile);

      if (stateKey) {
        recordAnalysis(state, stateKey, {
          profile: analysis.extraction,
          description: rawJob.description,
          hashes,
          result: scored,
          fromCache: analysis.fromCache
        });
      }

      triage.final(rawJob, scored);

      console.log(
        `✅ ${scored.decision} — Job Fit: ${scored.jobFitScore}`
      );

    } catch (error) {
      runStats.analysisFailures += 1;
      triage.analysisFailed(rawJob, error);
      if (stateKey) recordAnalysisFailure(state, stateKey, error);
      console.error(
        `❌ Failed to analyze this job:`
      );

      console.error(
        error.message
      );
    }

    // Small pause so we don't hammer Ollama (not needed for a cached job)
    // Save after every job, so a crash or Ctrl+C loses at most this one.
    await persistState();

    if (runStats.qwenCalls > qwenCallsBefore) await sleep(500);
  }

   // --------------------------------------------------
// 4. VERIFY ACTIVE JOBS
// --------------------------------------------------

console.log("\n🔗 VERIFYING ACTIVE JOBS...");

for (const result of results) {
  if (
    result.decision !== "APPLY" &&
    result.decision !== "MAYBE"
  ) {
    continue;
  }

  const url = result.sourceInfo?.url;

  console.log(
    `  → Checking: ${result.title}`
  );

  const availability = await checkJobUrl(url);

  result.availability = availability;
  if (result.stateKey) {
    const entry = recordAvailability(state, result.stateKey, availability);
    if (entry?.status === "expired") runStats.expired += 1;
    if (entry?.status === "unreachable") runStats.unreachable += 1;
  }

  if (availability.status === "inactive") {
    console.log(`  ✖ INACTIVE — ${availability.reason}`);
    result.decision = "SKIP";
    result.skipReason = "Job URL returned a definitive 404/410 response";
  } else if (availability.status === "active") {
    console.log(`  ✓ ACTIVE — ${availability.reason}`);
  } else {
    console.log(`  ? UNVERIFIED — ${availability.reason}; keeping the job for manual review`);
  }
}

  // --------------------------------------------------
  // 5. SORT RESULTS
  // --------------------------------------------------

  results.sort((a, b) => {
    const decisionRank = {
      APPLY: 3,
      MAYBE: 2,
      SKIP: 1
    };

    const decisionDifference =
      decisionRank[b.decision] -
      decisionRank[a.decision];

    if (decisionDifference !== 0) {
      return decisionDifference;
    }

    return (
      (b.jobFitScore ?? 0) -
      (a.jobFitScore ?? 0)
    );
  });

 
  // --------------------------------------------------
  // 6. PRINT FINAL RESULTS
  // --------------------------------------------------

  console.log(
    "\n\n========================================"
  );

  console.log(
    "🏆 FINAL JOB RANKING"
  );

  console.log(
    "========================================"
  );

  results.forEach(
    (result, index) => {
      printJobResult(
        index + 1,
        result
      );
    }
  );

  // --------------------------------------------------
  // 7. SAVE RESULTS
  // --------------------------------------------------

  // A run where every analysis failed (e.g. Ollama down) must not replace
  // the previous results with an empty list.
  const saved = await saveRunOutputs({
    results,
    debugJobProfiles,
    attempted: jobsToAnalyze.length,
    writeFile: fs.writeFile
  });

  if (saved.written) {
    console.log(
      `\n🧪 Debug job profiles saved to ${RUN_OUTPUT_PATHS.debugProfiles}`
    );
    console.log(
      `\n💾 Results saved to:\n${RUN_OUTPUT_PATHS.results}` +
        (saved.reason === "partial" ? ` (${jobsToAnalyze.length - results.length} job(s) failed to analyse)` : "")
    );
  } else {
    console.error(
      `\n❌ Every job analysis failed; ${RUN_OUTPUT_PATHS.results} was left unchanged. Is Ollama running?`
    );
    process.exitCode = 1;
  }

  // --------------------------------------------------
  // 8. SUMMARY
  // --------------------------------------------------

  const applyCount =
    results.filter(
      (job) =>
        job.decision === "APPLY"
    ).length;

  const maybeCount =
    results.filter(
      (job) =>
        job.decision === "MAYBE"
    ).length;

  const skipCount =
    results.filter(
      (job) =>
        job.decision === "SKIP"
    ).length;

  console.log(
    "\n📊 SUMMARY"
  );

  console.log(
    `🟢 APPLY: ${applyCount}`
  );

  console.log(
    `🟡 MAYBE: ${maybeCount}`
  );

  console.log(
    `🔴 SKIP: ${skipCount}`
  );

  // --------------------------------------------------
  // 9. APPLICATION PACKS (APPLY jobs only; no LLM)
  // --------------------------------------------------
  const applyResults = results.filter((result) => result.decision === "APPLY");
  if (applyResults.length) {
    console.log("\n📁 APPLICATION PACKS");
    for (const result of applyResults) {
      try {
        const { dir, coverage } = await writeApplicationPack({
          job: { ...result.sourceInfo, title: result.title, company: result.company, stateKey: result.stateKey },
          candidate,
          jobProfile: profilesByResult.get(result),
          scored: result
        });
        if (result.stateKey && state.jobs[result.stateKey]) state.jobs[result.stateKey].applicationPack = dir;
        console.log(`  ✓ ${result.title} — ${result.company} → ${dir} (${coverage.summary.GAP} gap, ${coverage.summary.UNKNOWN} to verify)`);
      } catch (error) {
        console.error(`  ✖ ${result.title}: application pack not written — ${error.message}`);
      }
    }
    console.log(`  Review coverage.md before applying. Folder: ${APPLICATIONS_DIR}`);
  }

  runStats.selected = jobsToAnalyze.length;
  recordRun(state, runStats);
  await persistState();
  const stateSummary = summarizeState(state);

  console.log("\n🗂️  JOB STATE THIS RUN");
  console.log(`  New jobs: ${runStats.newJobs} | Already seen: ${runStats.alreadySeen}`);
  console.log(`  Selected for analysis: ${runStats.selected}`);
  console.log(`  Cached analyses reused: ${runStats.cacheReused} | Analysed by Qwen: ${runStats.qwenCalls} | Failed: ${runStats.analysisFailures}`);
  console.log(`  Expired (404/410): ${runStats.expired} | Unreachable: ${runStats.unreachable}`);
  console.log(`  Hidden: applied ${runStats.hiddenApplied}, dismissed ${runStats.hiddenDismissed}, expired ${runStats.hiddenExpired}`);
  console.log(`  State: ${stateSummary.total} job(s) in ${STATE_FILE} — ${JSON.stringify(stateSummary.byStatus)}`);
  console.log("  Mark a job: npm run mark -- <job-key> applied|dismissed   ·   Overview: npm run jobs:status");

  console.log(
    "\n🎉 Agent finished."
  );
}


main().catch(async (error) => {
  console.error(error);
  // Keep what this run already analysed (cached extractions, failures).
  try {
    await persistState();
  } catch (saveError) {
    console.error(`Job state not saved: ${saveError.message}`);
  }
  process.exit(1);
});