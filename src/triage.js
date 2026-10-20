// Triage records: one per discovered job, saved on its job-state entry as
// `entry.triage` (data/job-state.json), so a job that never reaches Qwen can
// still be audited later: where it stopped, why, and on what evidence.
//
// - The record is only OBSERVATION. Nothing here decides, filters, ranks or
//   scores; it reads the results the existing stages already produced.
// - It describes the latest run that saw the job and replaces the previous
//   record of that job. Analysis results and the Qwen cache are untouched.
// - Fields that are not available are null, never guessed.
// - Only whitelisted fields are copied (no raw API payloads), query-string
//   values that look like credentials are removed from URLs, and the
//   description is truncated to TRIAGE_DESCRIPTION_LIMIT characters with the
//   full length and hash kept next to it.
import { findEntry, hashText } from "./job-state.js";
import { eligibility } from "./shortlist.js";
import { preRankJob } from "./job-pre-ranker.js";

export const TRIAGE_VERSION = 1;
export const TRIAGE_DESCRIPTION_LIMIT = 2000;
// In pipeline order; `stageReached` is the last one a job got to.
export const TRIAGE_STAGES = ["discovered", "filter", "pre-ranker", "enrichment", "analysis", "final"];

const SECRET_PARAM = /(key|token|secret|auth|password|passwd|signature|sig)$/i;

export function sanitizeUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_PARAM.test(name)) url.searchParams.delete(name);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function describeDescription(text, { enriched = null } = {}) {
  const value = typeof text === "string" ? text : "";
  if (!value.trim()) return { available: false, length: 0, hash: null, snapshot: null, truncated: false, enriched };
  return {
    available: true,
    length: value.length,
    hash: hashText(value),
    snapshot: value.slice(0, TRIAGE_DESCRIPTION_LIMIT),
    truncated: value.length > TRIAGE_DESCRIPTION_LIMIT,
    enriched
  };
}

const orNull = (value) => (value === undefined ? null : value);

// Structured work-mode facts exactly as the source gave them; null when absent.
export function workModeOf(job = {}) {
  return {
    remote: typeof job.remote === "boolean" ? job.remote : null,
    hybrid: typeof job.hybrid === "boolean" ? job.hybrid : null,
    searchMode: orNull(job.searchMode),
    sourceCountry: orNull(job.sourceCountry ?? job.country),
    sourceWorkMode: orNull(job.sourceTags?.workMode),
    locationRestrictions: Array.isArray(job.locationRestrictions) ? job.locationRestrictions : null,
    timezoneRestrictions: Array.isArray(job.timezoneRestrictions) ? job.timezoneRestrictions : null,
    restrictionConflict: typeof job.restrictionConflict === "boolean" ? job.restrictionConflict : null,
    timezoneConflict: typeof job.timezoneConflict === "boolean" ? job.timezoneConflict : null
  };
}

const sourcesOf = (job) => [...new Set([job.source, ...(job.sources ?? []), ...(job.sourceInfoList ?? []).map((ref) => ref?.source)].filter(Boolean))];
const locationOf = (job) => (typeof job.location === "string" ? job.location : job.location?.display_name ?? null);
const companyOf = (job) => (typeof job.company === "string" ? job.company : job.company?.display_name ?? null);

function newRecord(job, key, entry) {
  return {
    version: TRIAGE_VERSION,
    key,
    url: sanitizeUrl(job.url),
    source: job.source ?? sourcesOf(job)[0] ?? null,
    sources: sourcesOf(job),
    title: job.title ?? null,
    company: companyOf(job),
    location: locationOf(job),
    firstSeen: entry?.firstSeen ?? null,
    seenAt: entry?.lastSeen ?? null,
    postedAt: job.created ?? null,
    stageReached: "discovered",
    outcome: "discovered",
    excluded: null,
    stages: { discovered: { passed: true, reason: null } },
    preRankScore: null,
    description: describeDescription(job.description),
    workMode: workModeOf(job),
    decision: null,
    jobFitScore: null
  };
}

const reached = (record, stage) => {
  if (TRIAGE_STAGES.indexOf(stage) > TRIAGE_STAGES.indexOf(record.stageReached)) record.stageReached = stage;
};
const exclude = (record, stage, reason) => {
  record.excluded = { stage, reason };
  record.outcome = "excluded";
};

export function createTriage(state) {
  const records = new Map();
  const recordFor = (job) => {
    const found = findEntry(state, job);
    if (!found) return null;
    const [key, entry] = found;
    if (!records.has(key)) records.set(key, newRecord(job, key, entry));
    return records.get(key);
  };

  return {
    records,

    // Every job of the run, before any rule is applied. Jobs hidden by an
    // earlier decision (applied/dismissed/expired) stop here.
    discovered(jobs, hidden = []) {
      jobs.forEach(recordFor);
      for (const item of hidden) {
        const record = records.get(item.key);
        if (record) exclude(record, "discovered", `hidden by an earlier decision: ${item.status}`);
      }
    },

    // filterJobs() result: kept and rejected jobs carry `preFilter`.
    filter({ kept = [], rejected = [] }) {
      for (const job of [...kept, ...rejected]) {
        const record = recordFor(job);
        if (!record) continue;
        reached(record, "filter");
        record.stages.filter = { passed: job.preFilter?.keep === true, reason: job.preFilter?.reason ?? null };
        if (job.preFilter?.keep !== true) exclude(record, "filter", job.preFilter?.reason ?? "rejected");
      }
    },

    // After selectFinalShortlist(): `kept` went in, `stats` and `selected` came out.
    shortlist(kept, stats, selected) {
      const selectedKeys = new Set(selected.map((job) => findEntry(state, job)?.[0]).filter(Boolean));
      const rankedKeys = (stats.eligibleRanked ?? []).map((job) => findEntry(state, job)?.[0]);
      const enrichmentByKey = new Map((stats.enrichment ?? []).map((item) => [findEntry(state, item.job)?.[0], item]));
      // Selected jobs kept for free because their cached analysis is still valid.
      const cachedKeys = new Set((stats.cachedJobs ?? []).map((job) => findEntry(state, job)?.[0]));
      const cutoffKeys = new Set((stats.cachedBelowCutoff ?? []).map((job) => findEntry(state, job)?.[0]));

      for (const job of kept) {
        const record = recordFor(job);
        if (!record) continue;
        const { preRank } = preRankJob(job);
        const check = eligibility(job);
        reached(record, "pre-ranker");
        record.preRankScore = preRank.score;
        record.stages["pre-ranker"] = {
          passed: check.eligible,
          reason: check.eligible ? null : check.reasons.join("; "),
          score: preRank.score,
          locationCategory: preRank.locationCategory,
          locationEligible: preRank.eligible,
          roleEligible: preRank.roleEligible,
          signals: preRank.reasons
        };
        if (!check.eligible) { exclude(record, "pre-ranker", check.reasons.join("; ")); continue; }

        const position = rankedKeys.indexOf(record.key);
        if (position === -1) { exclude(record, "pre-ranker", "duplicate of a higher-ranked job (pre-ranker deduplication)"); continue; }
        record.stages["pre-ranker"].rank = position + 1;
        record.stages["pre-ranker"].eligibleCount = rankedKeys.length;

        const enrichment = enrichmentByKey.get(record.key);
        if (!enrichment && selectedKeys.has(record.key)) {
          // Below the enrichment cutoff, but its earlier analysis is still valid: reused, no slot.
          record.stages["pre-ranker"].cachedBelowCutoff = true;
          record.outcome = "selected";
          continue;
        }
        if (!enrichment) {
          exclude(record, "pre-ranker", `ranked ${position + 1} of ${rankedKeys.length} eligible jobs; outside the enrichment pool and backfill, so never enriched or analysed`);
          continue;
        }
        reached(record, "enrichment");
        const enriched = enrichment.job.descriptionEnriched;
        record.description = describeDescription(enrichment.job.description, { enriched: enriched === undefined ? null : enriched === true });
        record.workMode = workModeOf(enrichment.job);
        record.stages.enrichment = {
          passed: enrichment.kept,
          reason: enrichment.kept ? null : enrichment.reasons.join("; "),
          attempted: enriched !== undefined,
          enriched: enriched === true
        };
        if (!enrichment.kept) { exclude(record, "enrichment", `dropped after the full-description re-check: ${enrichment.reasons.join("; ")}`); continue; }
        if (!selectedKeys.has(record.key)) {
          exclude(record, "enrichment", "passed the re-check but was outside the final selection after re-ranking on the full description");
          continue;
        }
        record.outcome = "selected";
        if (cutoffKeys.has(record.key)) record.stages["pre-ranker"].cachedBelowCutoff = true;
        if (stats.cachedJobs) record.stages.enrichment.analysisSlot = !cachedKeys.has(record.key);
      }
    },

    analysis(job, { fromCache = false, extractionStatus = null, model = null } = {}) {
      const record = recordFor(job);
      if (!record) return;
      reached(record, "analysis");
      record.stages.analysis = { passed: true, reason: null, fromCache, extractionStatus, model };
      record.outcome = "analysed";
    },

    analysisFailed(job, error) {
      const record = recordFor(job);
      if (!record) return;
      reached(record, "analysis");
      const reason = String(error?.message ?? error ?? "unknown error").slice(0, 200);
      record.stages.analysis = { passed: false, reason, fromCache: false, extractionStatus: null, model: null };
      exclude(record, "analysis", reason);
    },

    final(job, scored) {
      const record = recordFor(job);
      if (!record) return;
      reached(record, "final");
      record.stages.final = { passed: true, reason: null, decision: scored?.decision ?? null, jobFitScore: scored?.jobFitScore ?? null, decisionReasons: scored?.decisionReasons ?? null };
      record.decision = scored?.decision ?? null;
      record.jobFitScore = scored?.jobFitScore ?? null;
      record.outcome = "decided";
    },

    // Attaches the records to their job-state entries (shared objects, so later
    // marks made during the run are saved with the entry).
    commit() {
      for (const [key, record] of records) {
        if (state.jobs[key]) state.jobs[key].triage = record;
      }
      return records.size;
    },

    summary() {
      const byOutcome = {};
      for (const record of records.values()) byOutcome[record.outcome] = (byOutcome[record.outcome] ?? 0) + 1;
      return { total: records.size, byOutcome };
    }
  };
}
