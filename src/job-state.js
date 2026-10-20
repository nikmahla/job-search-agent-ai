// Persistent job state between runs (data/job-state.json) and the Qwen
// extraction cache.
//
// - Every job gets a deterministic stable key: its normalized URL, or, when no
//   usable URL exists, company root + title + location. Location is always part
//   of the fallback, so the same title in two cities is never merged.
// - A job merged from several sources is matched by any of its source URLs
//   (aliases), so the key survives a different source "winning" the merge.
// - Statuses: new, ranked, applied, dismissed, expired, unreachable.
//   applied/dismissed are user decisions (scripts/mark-job.js) and are never
//   overwritten by a run; applied/dismissed/expired jobs are hidden from runs.
//   A run sets expired only after two consecutive 404/410 checks, and checks a
//   run-expired job again when a search finds it a week later.
// - A run saves with saveStateMerged after every job: it re-reads the file
//   first, so a `npm run mark` made during the run is kept, not overwritten.
// - The cache stores only the Qwen extraction. It is reused only when the
//   description hash AND the extraction-code hash (build-job-profile.js, its
//   rule imports and the model name) are unchanged. The deterministic scorer is
//   always re-run, so a scorer change can never leave a stale decision behind.
// - Writes are atomic: temporary file, then rename.
// This module does not change dedup, filtering, ranking or scoring.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { companyRoot, normalizeUrl } from "./job-pre-ranker.js";

export const STATE_FILE = process.env.JOB_STATE_FILE || "./data/job-state.json";
export const STATE_VERSION = 1;
export const JOB_STATUSES = ["new", "ranked", "applied", "dismissed", "expired", "unreachable"];
// Decisions only a person makes; a run never overwrites them.
export const USER_STATUSES = new Set(["applied", "dismissed"]);
// Jobs with these statuses are not analysed or shown again.
export const HIDDEN_STATUSES = new Set(["applied", "dismissed", "expired"]);
// Statuses a person may set with `npm run mark`. "new" un-hides a job.
export const MARKABLE_STATUSES = ["applied", "dismissed", "expired", "new"];

// A run marks a job expired only after this many consecutive 404/410 checks,
// so one temporary error never hides a live job.
export const EXPIRE_AFTER_INACTIVE_CHECKS = 2;
// A job a run marked expired is checked again when a search finds it this many
// days after its last URL check. A job a person marked expired stays hidden.
export const EXPIRED_RECHECK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_KEY_BODY = 120;
const MAX_RUNS_KEPT = 30;
const MAX_ERROR_LENGTH = 200;

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

// Files whose content decides what Qwen's extraction is. A change to any of
// them re-runs Qwen for every job.
export const EXTRACTION_INPUT_FILES = ["build-job-profile.js", "job-source-rules.js"];
// Files whose content decides the score. Recorded with every analysis; the
// scorer itself is re-run on every job, cached or not.
export const SCORER_INPUT_FILES = ["job-scorer.js", "job-source-rules.js", "tech-lexicon.js", "job-pre-ranker.js"];

export const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? ""), "utf-8").digest("hex");
export const hashText = (value) => sha256(value).slice(0, 16);

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Long keys keep a readable prefix and stay unique through a hash of the full text.
function capKey(prefix, body) {
  if (body.length <= MAX_KEY_BODY) return `${prefix}${body}`;
  return `${prefix}${body.slice(0, MAX_KEY_BODY - 11)}~${sha256(body).slice(0, 10)}`;
}

function urlKey(url) {
  const raw = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  const normalized = normalizeUrl(raw);
  return normalized ? capKey("url:", normalized) : null;
}

const UNKNOWN_COMPANY = new Set(["", "unknown", "n a", "not available"]);

export function stableJobKey(job = {}) {
  const fromUrl = urlKey(job.url);
  if (fromUrl) return fromUrl;
  const company = slug(job.company);
  const root = UNKNOWN_COMPANY.has(company) ? "unknown" : (companyRoot(company) || company);
  const title = slug(job.title) || "untitled";
  const location = slug(typeof job.location === "string" ? job.location : job.location?.display_name) || "unknown";
  return capKey("job:", `${root.replace(/ /g, "-")}|${title.replace(/ /g, "-")}|${location.replace(/ /g, "-")}`);
}

// Every key under which this job may already be stored.
export function jobKeyAliases(job = {}) {
  const keys = new Set([stableJobKey(job)]);
  for (const ref of job.sourceInfoList ?? []) {
    const key = urlKey(ref?.url);
    if (key) keys.add(key);
  }
  return [...keys];
}

export function emptyState() {
  return { version: STATE_VERSION, updatedAt: null, jobs: {}, runs: [] };
}

// A missing file is an empty state. A corrupt file is an error: overwriting it
// would silently lose every applied/dismissed decision.
export async function loadState({ file = STATE_FILE, readFile = fs.readFile } = {}) {
  let text;
  try {
    text = await readFile(file, "utf-8");
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON. Fix or rename it; it was not overwritten.`);
  }
  if (!state || typeof state !== "object" || typeof state.jobs !== "object" || state.jobs === null) {
    throw new Error(`${file} does not look like a job-state file. Fix or rename it; it was not overwritten.`);
  }
  state.runs = Array.isArray(state.runs) ? state.runs : [];
  return state;
}

export async function saveStateAtomic(state, { file = STATE_FILE, fsImpl = fs } = {}) {
  state.updatedAt = new Date().toISOString();
  await fsImpl.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  await fsImpl.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  try {
    await fsImpl.rename(temp, file);
  } catch (error) {
    await fsImpl.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

// The time of the newest change a person made to an entry (setJobStatus), or "".
const lastUserChange = (entry) => entry?.history?.at(-1)?.at ?? "";
const USER_FIELDS = ["status", "statusChangedAt", "history", "note", "expiredBy", "inactiveChecks"];

// Copies onto `state` every status a person set on disk (npm run mark) after
// `state` was loaded, so a run's save never undoes it. Returns the keys taken.
export function mergeUserDecisions(state, diskState) {
  const taken = [];
  for (const [key, diskEntry] of Object.entries(diskState?.jobs ?? {})) {
    const entry = state.jobs[key];
    if (lastUserChange(diskEntry) <= lastUserChange(entry)) continue;
    if (!entry) {
      state.jobs[key] = structuredClone(diskEntry);
    } else {
      for (const field of USER_FIELDS) {
        if (field in diskEntry) entry[field] = structuredClone(diskEntry[field]);
        else delete entry[field];
      }
    }
    taken.push(key);
  }
  return taken;
}

// Saves a run's state without undoing marks made while the run was going:
// re-reads the file, keeps the newer person-made changes, then writes
// atomically. A corrupt file on disk is an error and is not overwritten.
export async function saveStateMerged(state, { file = STATE_FILE, fsImpl = fs } = {}) {
  const diskState = await loadState({ file, readFile: fsImpl.readFile ?? fs.readFile });
  const taken = mergeUserDecisions(state, diskState);
  await saveStateAtomic(state, { file, fsImpl });
  return taken;
}

// A run-expired job found again by a search, long enough after its last check.
export function isDueForRecheck(entry, { now = new Date() } = {}) {
  if (entry?.status !== "expired" || entry.expiredBy === "user") return false;
  const lastCheck = Date.parse(entry.availability?.checkedAt ?? entry.statusChangedAt ?? "");
  return !Number.isFinite(lastCheck) || now.getTime() - lastCheck >= EXPIRED_RECHECK_DAYS * DAY_MS;
}

// [key, entry] for a job, matching any alias; null when the job is unknown.
export function findEntry(state, job) {
  const aliases = jobKeyAliases(job);
  for (const key of aliases) {
    if (state.jobs[key]) return [key, state.jobs[key]];
  }
  for (const [key, entry] of Object.entries(state.jobs)) {
    if (entry.aliases?.some((alias) => aliases.includes(alias))) return [key, entry];
  }
  return null;
}

const sourcesOf = (job) => [...new Set([
  ...(job.sources ?? []),
  ...(job.sourceInfoList ?? []).map((ref) => ref?.source),
  job.source
].filter(Boolean))];

// Registers this run's jobs in the state (mutates `state`) and splits them into
// jobs to process and jobs hidden by an earlier decision.
export function applyState(jobs = [], state, { now = new Date() } = {}) {
  const timestamp = now.toISOString();
  const fresh = [];
  const hidden = [];
  const counts = { total: jobs.length, new: 0, alreadySeen: 0, hidden: 0, applied: 0, dismissed: 0, expired: 0, recheckExpired: 0 };

  for (const job of jobs) {
    const found = findEntry(state, job);
    const aliases = jobKeyAliases(job);
    let key;
    let entry;
    if (found) {
      [key, entry] = found;
      counts.alreadySeen += 1;
    } else {
      key = aliases[0];
      entry = { key, status: "new", firstSeen: timestamp, timesSeen: 0, aliases: [] };
      state.jobs[key] = entry;
      counts.new += 1;
    }
    entry.aliases = [...new Set([...(entry.aliases ?? []), ...aliases])].filter((alias) => alias !== key);
    entry.title = job.title ?? entry.title ?? null;
    entry.company = job.company ?? entry.company ?? null;
    entry.location = job.location ?? entry.location ?? null;
    entry.url = job.url ?? entry.url ?? null;
    entry.sources = [...new Set([...(entry.sources ?? []), ...sourcesOf(job)])];
    entry.lastSeen = timestamp;
    entry.timesSeen = (entry.timesSeen ?? 0) + 1;

    if (isDueForRecheck(entry, { now })) {
      fresh.push(job);
      counts.recheckExpired += 1;
    } else if (HIDDEN_STATUSES.has(entry.status)) {
      hidden.push({ key, status: entry.status, title: entry.title, company: entry.company });
      counts.hidden += 1;
      counts[entry.status] += 1;
    } else {
      fresh.push(job);
    }
  }
  return { fresh, hidden, counts };
}

// Hashes of the files that decide extraction and scoring.
export async function computeAnalysisHashes({
  model = process.env.OLLAMA_MODEL ?? "qwen3:8b",
  readFile = fs.readFile,
  dir = SRC_DIR,
  extractionFiles = EXTRACTION_INPUT_FILES,
  scorerFiles = SCORER_INPUT_FILES
} = {}) {
  const digest = async (files, extra = "") => {
    const parts = [extra];
    for (const file of files) parts.push(`${file}\n${await readFile(path.join(dir, file), "utf-8")}`);
    return hashText(parts.join("\n\u0000\n"));
  };
  return {
    model,
    extractionHash: await digest(extractionFiles, `model:${model}`),
    scorerHash: await digest(scorerFiles)
  };
}

// Only a successful, well-formed extraction may be cached.
export function isCacheableProfile(profile) {
  return Boolean(profile) && typeof profile === "object" &&
    ["complete", "uncertain"].includes(profile.extraction?.status) &&
    Array.isArray(profile.requirements?.required) &&
    Array.isArray(profile.requirements?.preferred);
}

// { profile } when the cached extraction is still valid, else { profile: null, reason }.
export function getCachedExtraction(entry, { description, hashes }) {
  const cache = entry?.analysis;
  if (!cache?.profile) return { profile: null, reason: "not-cached" };
  if (!isCacheableProfile(cache.profile)) return { profile: null, reason: "invalid-cache" };
  if (cache.descriptionHash !== hashText(description ?? "")) return { profile: null, reason: "description-changed" };
  if (cache.extractionHash !== hashes.extractionHash) return { profile: null, reason: "extraction-code-changed" };
  return { profile: structuredClone(cache.profile), reason: "cached" };
}

// True when `job` (with the description it will be analysed with) already has a
// cached extraction that getCachedExtraction would reuse, i.e. no Qwen call.
export function hasValidCachedAnalysis(state, job, hashes) {
  const entry = findEntry(state, job)?.[1];
  return Boolean(entry) && getCachedExtraction(entry, { description: job?.description, hashes }).profile !== null;
}

const setRunStatus = (entry, status, timestamp) => {
  if (USER_STATUSES.has(entry.status)) return;
  if (entry.status !== status) entry.statusChangedAt = timestamp;
  entry.status = status;
  if (status !== "expired") delete entry.expiredBy;
};

// Stores a successful analysis. A failed or malformed extraction is never cached.
export function recordAnalysis(state, key, { profile, description, hashes, result, fromCache = false }, { now = new Date() } = {}) {
  const entry = state.jobs[key];
  if (!entry) throw new Error(`Unknown job key ${key}`);
  const timestamp = now.toISOString();
  if (!isCacheableProfile(profile)) {
    return recordAnalysisFailure(state, key, new Error("Extraction did not produce a usable profile."), { now });
  }
  if (!fromCache) {
    entry.analysis = {
      descriptionHash: hashText(description ?? ""),
      extractionHash: hashes.extractionHash,
      model: hashes.model,
      extractedAt: timestamp,
      profile: structuredClone(profile)
    };
  }
  entry.lastResult = {
    decision: result?.decision ?? null,
    jobFitScore: result?.jobFitScore ?? null,
    scorerHash: hashes.scorerHash,
    scoredAt: timestamp,
    fromCache
  };
  delete entry.lastError;
  entry.failedAttempts = 0;
  setRunStatus(entry, "ranked", timestamp);
  return entry;
}

export function recordAnalysisFailure(state, key, error, { now = new Date() } = {}) {
  const entry = state.jobs[key];
  if (!entry) throw new Error(`Unknown job key ${key}`);
  entry.failedAttempts = (entry.failedAttempts ?? 0) + 1;
  entry.lastError = String(error?.message ?? error ?? "unknown error").slice(0, MAX_ERROR_LENGTH);
  entry.lastFailureAt = now.toISOString();
  return entry;
}

// URL check outcome: EXPIRE_AFTER_INACTIVE_CHECKS consecutive 404/410 →
// expired; network failure → unreachable; reachable → ranked again. A check
// that proves nothing (timeout, 403) neither adds to nor resets the 404 count.
export function recordAvailability(state, key, availability, { now = new Date() } = {}) {
  const entry = state.jobs[key];
  if (!entry || !availability) return entry;
  const timestamp = now.toISOString();
  entry.availability = { status: availability.status, reason: availability.reason ?? null, checkedAt: timestamp };
  if (availability.status === "inactive") {
    entry.inactiveChecks = (entry.inactiveChecks ?? 0) + 1;
    if (entry.inactiveChecks >= EXPIRE_AFTER_INACTIVE_CHECKS && !USER_STATUSES.has(entry.status)) {
      setRunStatus(entry, "expired", timestamp);
      entry.expiredBy = "run";
    }
  } else if (availability.status === "active") {
    entry.inactiveChecks = 0;
    const expiredByUser = entry.status === "expired" && entry.expiredBy === "user";
    if (entry.lastResult && !expiredByUser) setRunStatus(entry, "ranked", timestamp);
  } else if (availability.status === "unverified" && ["timeout", "check-failed"].includes(availability.reason) &&
    entry.status !== "expired") {
    setRunStatus(entry, "unreachable", timestamp);
  }
  return entry;
}

export function recordRun(state, summary, { now = new Date() } = {}) {
  state.runs = [...(state.runs ?? []), { at: now.toISOString(), ...summary }].slice(-MAX_RUNS_KEPT);
  return state;
}

export function setJobStatus(state, key, status, { note, now = new Date() } = {}) {
  if (!MARKABLE_STATUSES.includes(status)) {
    throw new Error(`Unknown status "${status}". Use one of: ${MARKABLE_STATUSES.join(", ")}.`);
  }
  const entry = state.jobs[key];
  if (!entry) throw new Error(`No job with key ${key}.`);
  const timestamp = now.toISOString();
  entry.history = [...(entry.history ?? []), { at: timestamp, from: entry.status, to: status, ...(note ? { note } : {}) }].slice(-20);
  entry.status = status === "new" ? (entry.lastResult ? "ranked" : "new") : status;
  entry.statusChangedAt = timestamp;
  // A person's "expired" is final; un-hiding a job also forgets its 404 count.
  if (status === "expired") entry.expiredBy = "user";
  else delete entry.expiredBy;
  if (status === "new") entry.inactiveChecks = 0;
  if (note) entry.note = note;
  return entry;
}

// Resolves what a person typed (a key, a URL, or part of a key) to one key.
export function resolveJobKey(state, input) {
  const value = String(input ?? "").trim();
  if (!value) return { key: null, matches: [] };
  if (state.jobs[value]) return { key: value, matches: [value] };
  const fromUrl = urlKey(value);
  if (fromUrl) {
    const match = Object.entries(state.jobs).find(([key, entry]) => key === fromUrl || entry.aliases?.includes(fromUrl));
    return match ? { key: match[0], matches: [match[0]] } : { key: null, matches: [] };
  }
  const needle = value.toLowerCase();
  const matches = Object.keys(state.jobs).filter((key) => key.toLowerCase().includes(needle));
  return { key: matches.length === 1 ? matches[0] : null, matches };
}

export function summarizeState(state) {
  const byStatus = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0]));
  for (const entry of Object.values(state.jobs)) byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
  const cached = Object.values(state.jobs).filter((entry) => entry.analysis?.profile).length;
  return { total: Object.keys(state.jobs).length, byStatus, cachedExtractions: cached, lastRun: state.runs?.at(-1) ?? null };
}
