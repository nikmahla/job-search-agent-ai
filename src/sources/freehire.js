// FreeHire source (https://freehire.me): public JSON API, no key.
// API notes: docs/sources/freehire.md.
//
// - Native fetch, a User-Agent naming this project, a 15 s timeout per request.
// - 429/5xx are retried at most FREEHIRE_CONFIG.maxAttempts times in total,
//   with backoff (Retry-After honoured, capped). Timeouts and network errors
//   are not retried. Nothing loops indefinitely.
// - One failed request is logged and the other requests still count; if every
//   request fails, the source throws so the registry reports it as failed
//   (the other sources are unaffected).
// - Results are normalized to the internal job shape. FreeHire's work_mode tag
//   is kept only as metadata: remote/hybrid is derived from the posting text by
//   the same isRemote/isHybrid rules used for Adzuna.
import { isHybrid, isRemote } from "../job-source-rules.js";
import { deduplicateJobs } from "../job-pre-ranker.js";
import { isUsableJob } from "../job-sources.js";
import { FREEHIRE_CONFIG } from "../search-config.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function freehireBaseUrl(value = process.env.FREEHIRE_API_URL, fallback = FREEHIRE_CONFIG.baseUrl) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (!/^https?:\/\//i.test(raw)) throw new Error(`FREEHIRE_API_URL must start with http:// or https:// (got "${raw}")`);
  return raw.replace(/\/+$/, "");
}

export function buildFreehireUrl({ term, scope, config = FREEHIRE_CONFIG, baseUrl = freehireBaseUrl() }) {
  const url = new URL(`${baseUrl}${config.searchPath}`);
  url.searchParams.set("q", term);
  url.searchParams.set("limit", String(config.limit));
  url.searchParams.set("offset", "0");
  url.searchParams.set("semantic_ratio", "0");
  url.searchParams.set("include_description", "true");
  url.searchParams.set("description_format", "text");
  url.searchParams.set("posted_within_days", String(config.postedWithinDays));
  for (const category of config.categories ?? []) url.searchParams.append("category", category);
  for (const [facet, values] of Object.entries(scope.facets ?? {})) {
    for (const value of [].concat(values)) url.searchParams.append(facet, value);
  }
  return url;
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

// The text format is already plain; this only guards against stray markup and
// keeps the posting's line structure (headings and bullets matter to the audit).
function plainDescription(value) {
  const text = decodeEntities(String(value ?? "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
  return text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const firstNonEmpty = (...values) => values.find((value) => value != null && String(value).trim() !== "") ?? null;

export function normalizeFreehireJob(job, { searchMode = "unknown" } = {}) {
  const title = decodeEntities(firstNonEmpty(job?.title) ?? "Unknown").trim() || "Unknown";
  const company = firstNonEmpty(job?.company) ?? "Unknown";
  const description = plainDescription(job?.description);
  const countries = Array.isArray(job?.countries) ? job.countries.filter(Boolean) : [];
  const location = firstNonEmpty(job?.location, countries.join(", ")) ?? "Unknown";
  const slug = firstNonEmpty(job?.public_slug, job?.external_id);
  const url = firstNonEmpty(job?.url, slug ? `https://freehire.me/jobs/${slug}` : null);
  const enrichment = job?.enrichment ?? {};
  // Same shape and same rules as an Adzuna listing: the text decides.
  const textShape = { title, description, location: { display_name: location }, company: { display_name: company } };

  return {
    id: `freehire:${slug ?? url ?? `${title}-${company}-${location}`}`,
    title,
    company,
    location,
    description,
    url,
    source: "freehire",
    sourceCountry: countries[0] ? String(countries[0]).toLowerCase() : "unknown",
    searchMode,
    remote: isRemote(textShape),
    hybrid: isHybrid(textShape),
    salary: enrichment.salary_min != null || enrichment.salary_max != null
      ? { min: enrichment.salary_min ?? null, max: enrichment.salary_max ?? null, currency: enrichment.salary_currency ?? null, period: enrichment.salary_period ?? null }
      : null,
    created: firstNonEmpty(job?.posted_at, job?.created_at),
    descriptionLength: description.length,
    // FreeHire's facets describe where a job is, not who may apply, and are
    // often incomplete, so they are kept as metadata and never as restrictions.
    locationRestrictions: [],
    timezoneRestrictions: [],
    seniority: enrichment.seniority ?? null,
    employmentType: enrichment.employment_type ?? null,
    sourceTags: {
      workMode: job?.work_mode ?? null,
      regions: Array.isArray(job?.regions) ? job.regions : [],
      countries,
      skills: Array.isArray(job?.skills) ? job.skills : [],
      category: enrichment.category ?? null,
      atsSource: job?.source ?? null
    },
    sourceAttribution: "FreeHire (https://freehire.me)"
  };
}

function retryDelayMs(response, attempt, config) {
  const header = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, config.maxRetryAfterMs);
  return Math.min(1000 * 2 ** (attempt - 1), config.maxRetryAfterMs);
}

// One API request with bounded retries. Returns the array of jobs or throws.
export async function requestFreehire(url, { fetchImpl = fetch, sleepImpl = sleep, config = FREEHIRE_CONFIG } = {}) {
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": config.userAgent },
        signal: AbortSignal.timeout(config.timeoutMs)
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new Error(timedOut ? `no response within ${Math.round(config.timeoutMs / 1000)}s` : `request failed: ${error?.message ?? "network error"}`);
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === config.maxAttempts) throw new Error(`HTTP ${response.status} after ${attempt} attempt(s)`);
      await sleepImpl(retryDelayMs(response, attempt, config));
      continue;
    }
    if (response.status === 404) throw new Error(`HTTP 404 — ${config.searchPath} not found on this FreeHire instance`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("response is not valid JSON");
    }
    if (!payload || !Array.isArray(payload.data)) throw new Error("unexpected response shape (no data array)");
    return payload.data;
  }
  throw new Error("no attempts made");
}

export async function searchFreehireJobs({
  fetchImpl = fetch,
  sleepImpl = sleep,
  config = FREEHIRE_CONFIG,
  log = (message) => console.log(message)
} = {}) {
  const baseUrl = freehireBaseUrl();
  const jobs = [];
  const failures = [];
  let requests = 0;

  for (const scope of config.scopes) {
    for (const term of config.terms) {
      requests += 1;
      const url = buildFreehireUrl({ term, scope, config, baseUrl });
      try {
        const results = await requestFreehire(url, { fetchImpl, sleepImpl, config });
        log(`  → FreeHire | ${scope.name} | ${term}: ${results.length}`);
        jobs.push(...results
          .filter((job) => job && typeof job === "object")
          .map((job) => normalizeFreehireJob(job, { searchMode: scope.searchMode }))
          .filter((job) => job.description && isUsableJob(job)));
      } catch (error) {
        failures.push(`${scope.name}/${term}: ${error.message}`);
        log(`  ✖ FreeHire | ${scope.name} | ${term}: ${error.message}`);
      }
    }
  }

  if (requests > 0 && failures.length === requests) {
    throw new Error(`all ${requests} FreeHire request(s) failed (${failures[0]})`);
  }
  return deduplicateJobs(jobs);
}
