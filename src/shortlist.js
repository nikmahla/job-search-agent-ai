// Final shortlist selection with enrichment BEFORE the cut.
//
// Adzuna returns ~500-character snippets. Ranking on a snippet and enriching
// only the final 15 lets a job whose full description adds "7+ years
// required", "hybrid, 3 days in Munich" or "UK residents only" occupy a slot
// that a suitable job should have had. Here a bounded pool of the best
// eligible jobs is enriched first, the same deterministic rules are re-applied
// to the full text, and only then are the final jobs selected.
//
// Bounded: at most `poolSize + maxBackfill` jobs are passed to enrichment, and
// enrichment itself makes at most one GET per short Adzuna description (other
// jobs are passed through without a request). Failed enrichment keeps the job
// with its original snippet; it is never dropped for that reason.
import { preRankJob, selectTopJobs } from "./job-pre-ranker.js";
import { filterJob } from "./job-filter.js";
import { isHybrid, isRemote } from "./job-source-rules.js";
import { enrichShortlistedJobs } from "./description-enrichment.js";

export const SHORTLIST_LIMITS = {
  finalSize: 15,
  poolSize: 30
};

function hasStructuredRemoteSource(job) {
  return [job?.source, ...(job?.sources ?? []), ...(job?.sourceInfoList ?? []).map((ref) => ref?.source)]
    .includes("himalayas");
}

// Re-derives the snippet-based source facts from an enriched description with
// the same rules used at normalization. Jobs without new text are unchanged.
export function recheckEnrichedJob(job) {
  if (job?.descriptionEnriched !== true) return job;

  const raw = {
    title: job.title,
    description: job.description,
    location: { display_name: typeof job.location === "string" ? job.location : job.location?.display_name },
    company: { display_name: typeof job.company === "string" ? job.company : job.company?.display_name }
  };
  // Himalayas publishes remote status as structured data; Adzuna text never overrides it.
  const remote = hasStructuredRemoteSource(job) ? job.remote === true : isRemote(raw);
  const hybrid = hasStructuredRemoteSource(job) ? job.hybrid === true : isHybrid(raw);
  const filter = filterJob({ ...job, remote, hybrid });

  return {
    ...job,
    remote,
    hybrid,
    preFilter: { keep: filter.keep, reason: filter.reason, recheckedAfterEnrichment: true },
    snippetFacts: { remote: job.remote === true, hybrid: job.hybrid === true }
  };
}

export function eligibility(job) {
  if (job?.preFilter?.keep === false) {
    return { eligible: false, reasons: [`filter: ${job.preFilter.reason}`] };
  }
  const { preRank } = preRankJob(job);
  const eligible = preRank.eligible && preRank.roleEligible;
  return {
    eligible,
    reasons: eligible ? [] : preRank.reasons.filter((reason) => /INELIGIBLE/.test(reason)).concat(
      preRank.eligible ? [] : [preRank.locationCategory]
    )
  };
}

// `jobs` are the deduplicated, pre-filtered jobs. Returns the final shortlist
// (pre-ranked on the full text where it was available) plus an audit record.
//
// `finalSize` is the number of analysis slots. With `isCached(job)` (checked on
// the enriched description, which is what the cache is keyed by), a job whose
// cached extraction is still valid is kept in the shortlist for free: it needs
// no Qwen call, so it does not use a slot, and the slots go to the best-ranked
// jobs that still have to be analysed. Without `isCached` every job uses a slot.
export async function selectFinalShortlist(jobs = [], {
  finalSize = SHORTLIST_LIMITS.finalSize,
  poolSize = SHORTLIST_LIMITS.poolSize,
  maxBackfill = finalSize,
  enrich = (batch) => enrichShortlistedJobs(batch),
  isCached = null
} = {}) {
  const ranked = selectTopJobs(jobs, jobs.length);
  const stats = {
    eligibleBeforeEnrichment: ranked.length,
    enrichmentCandidates: 0,
    enrichmentAttempts: 0,
    enriched: 0,
    dropped: [],
    backfilled: 0,
    // Audit-only: the eligible jobs in rank order, and what happened to every
    // job that was sent to enrichment. Nothing here feeds the selection.
    eligibleRanked: ranked,
    enrichment: []
  };

  const enrichAndRecheck = async (batch) => {
    if (!batch.length) return [];
    stats.enrichmentCandidates += batch.length;
    const enrichedBatch = await enrich(batch);
    const kept = [];
    for (const job of enrichedBatch.map(recheckEnrichedJob)) {
      if (job.descriptionEnriched !== undefined) stats.enrichmentAttempts += 1;
      if (job.descriptionEnriched === true) stats.enriched += 1;
      const check = eligibility(job);
      stats.enrichment.push({ job, kept: check.eligible, reasons: check.reasons });
      if (check.eligible) {
        kept.push(job);
      } else {
        stats.dropped.push({ id: job.id, title: job.title, company: job.company, reasons: check.reasons });
      }
    }
    return kept;
  };

  const cached = (job) => Boolean(isCached) && isCached(job) === true;
  // Same ranking and de-duplication as before; only the slot count differs. The
  // result is the top of the ranking down to the job that takes the last slot:
  // cached jobs inside that range are free, those ranked below it are not carried.
  const pick = (candidates) => {
    if (!isCached) return selectTopJobs(candidates, finalSize);
    if (!(finalSize > 0)) return [];
    const picked = [];
    let slots = 0;
    for (const job of selectTopJobs(candidates, candidates.length)) {
      picked.push(job);
      if (!cached(job) && ++slots >= finalSize) break;
    }
    return picked;
  };
  const slotsUsed = (selected) => selected.filter((job) => !cached(job)).length;

  let candidates = await enrichAndRecheck(ranked.slice(0, poolSize));
  let selected = pick(candidates);

  // Backfill slots freed by jobs that dropped out, in pre-rank order, within budget.
  // A cached job found while backfilling does not use up the budget.
  let cursor = poolSize;
  let backfillBudget = Math.max(0, maxBackfill);
  while (slotsUsed(selected) < finalSize && cursor < ranked.length && backfillBudget > 0) {
    const take = Math.min(finalSize - slotsUsed(selected), backfillBudget, ranked.length - cursor);
    const batch = ranked.slice(cursor, cursor + take);
    cursor += take;
    const kept = await enrichAndRecheck(batch);
    backfillBudget -= take - kept.filter(cached).length;
    stats.backfilled += kept.length;
    candidates = [...candidates, ...kept];
    selected = pick(candidates);
  }

  // The slots are filled; what is left of the ranking is not analysed, EXCEPT
  // jobs that already have a still-valid cached extraction for the description
  // they have right now. Such a job needs no Qwen call and no slot, so it is
  // carried into the result instead of silently vanishing from it:
  //   - jobs that were enriched and passed the re-check but come after the last slot;
  //   - eligible jobs ranked below everything that was enriched, only when the
  //     cache matches their current text without a fetch (a source that gives the
  //     full text, or an Adzuna text that was never enriched).
  // Jobs whose cache is keyed by an enriched text and that were never enriched
  // are not checked (that would need a fetch). Ranking, eligibility and the
  // jobs that need Qwen are unchanged.
  stats.analysisSlots = slotsUsed(selected);
  stats.cachedBelowCutoff = [];
  if (isCached && finalSize > 0) {
    // `pick` returns the front of this same ordered, de-duplicated list.
    const afterLastSlot = selectTopJobs(candidates, candidates.length).slice(selected.length);
    stats.cachedBelowCutoff = [
      ...afterLastSlot.filter(cached),
      ...ranked.slice(cursor).filter(cached)
    ];
    selected = [...selected, ...stats.cachedBelowCutoff];
  }
  // Audit-only: which selected jobs were kept for free.
  stats.cachedJobs = selected.filter(cached);

  return { selected, stats };
}
