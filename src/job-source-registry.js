// The single list of job sources used by run-agent.js and searchAllJobs().
//
// Each source is { name, label, enabled, search(options) } and returns jobs in
// the shared internal job shape. Sources run concurrently with
// Promise.allSettled: a source that throws, times out or returns something
// that is not an array is reported as failed and the others still count.
// Jobs are concatenated in registry order (the order the pipeline always used),
// so cross-source deduplication behaves exactly as before.
//
// Disable a source without editing code: DISABLED_SOURCES=freehire,himalayas
import {
  searchEuropeRemoteJobs,
  searchHimalayasJobs,
  searchLocalJobs,
  searchUKRemoteJobs
} from "./job-sources.js";
import { searchFreehireJobs } from "./sources/freehire.js";
import { FREEHIRE_CONFIG } from "./search-config.js";

// search() calls are wrapped so this module never touches a job-sources.js
// binding while the two modules are still loading.
export const JOB_SOURCES = [
  { name: "adzuna-local", label: "Adzuna — Alicante / Valencia", enabled: true, search: () => searchLocalJobs() },
  { name: "adzuna-europe-remote", label: "Adzuna — Europe remote", enabled: true, search: () => searchEuropeRemoteJobs() },
  { name: "adzuna-uk-remote", label: "Adzuna — UK remote", enabled: true, search: () => searchUKRemoteJobs() },
  { name: "himalayas", label: "Himalayas — remote frontend/React", enabled: true, search: (options) => searchHimalayasJobs(options) },
  { name: "freehire", label: "FreeHire — frontend/fullstack (Spain, EU/UK remote)", enabled: FREEHIRE_CONFIG.enabled, search: (options) => searchFreehireJobs(options) }
];

export function disabledFromEnv(value = process.env.DISABLED_SOURCES) {
  return new Set(String(value ?? "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean));
}

export function enabledSources(sources = JOB_SOURCES, { disabled = disabledFromEnv() } = {}) {
  return sources.filter((source) => source.enabled !== false && !disabled.has(source.name));
}

// Returns { jobs, report } where report has one row per source:
// { name, label, status: "ok" | "failed" | "disabled", count, error, ms }.
export async function runSources(sources = JOB_SOURCES, {
  disabled = disabledFromEnv(),
  options = {},
  now = () => Date.now()
} = {}) {
  const active = enabledSources(sources, { disabled });
  const settled = await Promise.allSettled(active.map(async (source) => {
    const started = now();
    const jobs = await source.search(options);
    if (!Array.isArray(jobs)) throw new Error(`returned ${jobs === null ? "null" : typeof jobs} instead of a list of jobs`);
    return { jobs, ms: now() - started };
  }));

  const jobs = [];
  const report = [];
  for (const source of sources) {
    const index = active.indexOf(source);
    if (index === -1) {
      report.push({ name: source.name, label: source.label ?? source.name, status: "disabled", count: 0, error: null, ms: 0 });
      continue;
    }
    const outcome = settled[index];
    if (outcome.status === "fulfilled") {
      jobs.push(...outcome.value.jobs);
      report.push({ name: source.name, label: source.label ?? source.name, status: "ok", count: outcome.value.jobs.length, error: null, ms: outcome.value.ms });
    } else {
      report.push({ name: source.name, label: source.label ?? source.name, status: "failed", count: 0, error: String(outcome.reason?.message ?? outcome.reason ?? "unknown error").slice(0, 300), ms: null });
    }
  }
  return { jobs, report };
}

export function formatSourceReport(report = []) {
  return report.map((row) => {
    if (row.status === "ok") return `  ✓ ${row.label}: ${row.count} job(s)`;
    if (row.status === "disabled") return `  – ${row.label}: disabled`;
    return `  ✖ ${row.label}: FAILED — ${row.error} (other sources continue)`;
  }).join("\n");
}
