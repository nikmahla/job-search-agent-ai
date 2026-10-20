// One job's analysis: a valid cached Qwen extraction, or a live Qwen call,
// followed by the deterministic scorer (always re-run).
//
// The source-of-truth handling (title/company/description and sourceInfo come
// from the source, never from the LLM) is the same code run-agent.js used
// inline before; it moved here unchanged so cached and live analyses are
// treated identically.
import { buildJobProfile } from "./build-job-profile.js";
import { scoreJob } from "./job-scorer.js";
import { getCachedExtraction } from "./job-state.js";

export function buildSourceInfo(rawJob) {
  return {
    id: rawJob.id,
    url: rawJob.url,
    source: rawJob.source,
    sources: rawJob.sourceInfoList
      ? [...new Set(rawJob.sourceInfoList.map((item) => item.source).filter(Boolean))]
      : [rawJob.source ?? "adzuna"],
    sourceInfoList: rawJob.sourceInfoList ?? [],
    sourceAttribution: rawJob.sourceAttribution ?? null,
    country: rawJob.sourceCountry,
    sourceCountry: rawJob.sourceCountry,
    searchMode: rawJob.searchMode,
    location: rawJob.location,
    locationRestrictions: rawJob.locationRestrictions ?? [],
    timezoneRestrictions: rawJob.timezoneRestrictions ?? [],
    restrictionConflict: rawJob.restrictionConflict === true,
    timezoneConflict: rawJob.timezoneConflict === true,
    description: rawJob.description ?? "",
    remote: rawJob.remote === true,
    hybrid: rawJob.hybrid === true,
    created: rawJob.created,
    salary: rawJob.salary
  };
}

// Keep source facts as the source of truth. The LLM may extract skills, but it
// must not rewrite the title/location or invent remote eligibility.
export function applySourceFacts(jobProfile, rawJob) {
  jobProfile.job = {
    ...(jobProfile.job ?? {}),
    title: rawJob.title ?? jobProfile.job?.title ?? "",
    company: rawJob.company ?? jobProfile.job?.company ?? "",
    description: rawJob.description ?? jobProfile.job?.description ?? ""
  };
  jobProfile.sourceInfo = buildSourceInfo(rawJob);
  return jobProfile;
}

// Returns { extraction, jobProfile, scored, fromCache, cacheReason }.
// `extraction` is the bare model output (what may be cached); `jobProfile` is
// that output with the source facts applied (what is scored). Throws when the
// live extraction fails, so a failure is never mistaken for a result.
export async function analyzeJob(rawJob, {
  candidate,
  entry = null,
  hashes,
  extract = buildJobProfile,
  score = scoreJob
}) {
  const cached = hashes ? getCachedExtraction(entry, { description: rawJob.description, hashes }) : { profile: null, reason: "no-cache" };
  const fromCache = Boolean(cached.profile);
  const extraction = fromCache ? cached.profile : await extract(rawJob);
  const jobProfile = applySourceFacts(structuredClone(extraction), rawJob);
  const scored = score(candidate, jobProfile);
  return { extraction, jobProfile, scored, fromCache, cacheReason: cached.reason };
}
