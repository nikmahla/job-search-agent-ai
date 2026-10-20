import "dotenv/config";
import { isRemote, isHybrid } from "./job-source-rules.js";
import { deduplicateJobs } from "./job-pre-ranker.js";
import { EUROPE_COUNTRIES, LOCAL_CITIES, SEARCH_TERMS } from "./search-config.js";

const appId = process.env.ADZUNA_APP_ID;
const appKey = process.env.ADZUNA_APP_KEY;


// --------------------------------------------------
// SEARCH CONFIG
// --------------------------------------------------

// Countries, cities and search terms live in search-config.js.

// Number of jobs returned by each API request.
const RESULTS_PER_PAGE = 20;

// Adzuna default limit is 25 requests/minute.
// 2500ms gives us a safe margin.
const REQUEST_DELAY_MS = 2500;

// Retry only temporary API failures.
const MAX_RETRIES = 3;

// Search only recent jobs.
const MAX_JOB_AGE_DAYS = 30;

// We intentionally keep this at 1 for now.
// Later we can increase to 2 after testing API usage.
const MAX_PAGES_PER_QUERY = 1;

// --------------------------------------------------
// REQUEST RATE LIMITER
// --------------------------------------------------

// The local, Europe and UK searches run concurrently (Promise.all in
// run-agent.js) and share one Adzuna quota. Slots are therefore granted from
// a single queue: each caller waits for the previous slot, then for the
// remaining delay, so requests are at least `delayMs` apart across all callers.
export function createRateLimiter(delayMs, { now = () => Date.now(), sleepImpl = sleep } = {}) {
  let queue = Promise.resolve();
  let lastRequestAt = -Infinity;

  return function waitForSlot() {
    const slot = queue.then(async () => {
      const remaining = delayMs - (now() - lastRequestAt);
      if (remaining > 0) await sleepImpl(remaining);
      lastRequestAt = now();
    });
    queue = slot.catch(() => {});
    return slot;
  };
}

const waitForRateLimit = createRateLimiter(REQUEST_DELAY_MS);

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// --------------------------------------------------
// SEARCH URL
// --------------------------------------------------

function buildSearchUrl({
  countryCode,
  term,
  where,
  page
}) {
  const url = new URL(
    `https://api.adzuna.com/v1/api/jobs/${countryCode}/search/${page}`
  );

  url.searchParams.set(
    "app_id",
    appId
  );

  url.searchParams.set(
    "app_key",
    appKey
  );

  url.searchParams.set(
    "results_per_page",
    String(RESULTS_PER_PAGE)
  );

  url.searchParams.set(
    "what",
    term
  );

  url.searchParams.set(
    "content-type",
    "application/json"
  );

  if (where) {
    url.searchParams.set(
      "where",
      where
    );
  }

  return url;
}

// --------------------------------------------------
// REQUEST WITH RETRY
// --------------------------------------------------

const MAX_RETRY_AFTER_MS = 60000;

function retryDelayMs(response, attempt) {
  const raw = response?.headers?.get?.("retry-after");
  const seconds = raw === null || raw === undefined || String(raw).trim() === "" ? NaN : Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  return attempt * 5000;
}

// Retries only temporary failures: HTTP 429, HTTP 5xx and network errors.
// Any other status (400, 401, 403, 404...) fails at once: repeating it cannot
// succeed and would only spend quota. Every attempt goes through the limiter.
export async function requestAdzunaPage(options, {
  fetchImpl = fetch,
  waitForSlot = waitForRateLimit,
  sleepImpl = sleep,
  maxRetries = MAX_RETRIES,
  credentials = { appId, appKey }
} = {}) {
  if (!credentials.appId || !credentials.appKey) {
    throw new Error("Missing ADZUNA_APP_ID or ADZUNA_APP_KEY in .env");
  }

  const label =
    `${options.countryCode}/${options.term}` +
    `${options.where ? ` in ${options.where}` : ""} page ${options.page}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await waitForSlot();

    let response;
    try {
      response = await fetchImpl(buildSearchUrl(options));
    } catch (error) {
      if (attempt === maxRetries) throw error;
      console.log(`  ⚠ Request error → retry ${attempt + 1}/${maxRetries}`);
      await sleepImpl(attempt * 5000);
      continue;
    }

    if (response.ok) {
      const data = await response.json();
      return data.results ?? [];
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maxRetries) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Adzuna ${response.status} for ${label}: ${errorText}`);
    }

    const waitTime = retryDelayMs(response, attempt);
    console.log(`  ⚠ Adzuna ${response.status} → retrying in ${waitTime / 1000}s`);
    await sleepImpl(waitTime);
  }

  return [];
}

function requestPage(options) {
  return requestAdzunaPage(options);
}

// --------------------------------------------------
// SEARCH MULTIPLE PAGES
// --------------------------------------------------

async function fetchAdzunaJobs({
  countryCode,
  term,
  where
}) {
  const allResults = [];

  for (
    let page = 1;
    page <= MAX_PAGES_PER_QUERY;
    page++
  ) {
    const results =
      await requestPage({
        countryCode,
        term,
        where,
        page
      });

    allResults.push(
      ...results
    );

    // If the API returned fewer jobs
    // than requested, there is probably
    // no need to request another page.
    if (
      results.length <
      RESULTS_PER_PAGE
    ) {
      break;
    }
  }

  return allResults;
}

// --------------------------------------------------
// JOB TEXT
// --------------------------------------------------

function getJobText(job) {
  return normalizeText(
    [
      job.title,
      job.description,
      job.location?.display_name,
      job.company?.display_name
    ]
      .filter(Boolean)
      .join(" ")
  );
}

// Remote/hybrid detection lives in job-source-rules.js (includes the
// "Remote Sensing" safeguard).

// --------------------------------------------------
// CLOSED JOB DETECTION
// --------------------------------------------------

function isClosedJob(job) {
  const text =
    getJobText(job);

  const closedKeywords = [
    "job closed",
    "position closed",
    "position has been filled",
    "role has been filled",
    "filled position",
    "no longer accepting applications",
    "no longer available",
    "vacancy closed",
    "applications are closed",
    "this position is closed",
    "this position has been filled",
    "this job is no longer available",
    "job has expired",
    "vacancy has expired"
  ];

  return closedKeywords.some(
    (keyword) =>
      text.includes(
        normalizeText(keyword)
      )
  );
}

// --------------------------------------------------
// RECENT JOB DETECTION
// --------------------------------------------------

function isRecentJob(job) {
  if (!job.created) {
    return true;
  }

  const createdDate =
    new Date(job.created);

  if (
    Number.isNaN(
      createdDate.getTime()
    )
  ) {
    return true;
  }

  const now =
    new Date();

  const ageMs =
    now.getTime() -
    createdDate.getTime();

  const ageDays =
    ageMs /
    (1000 * 60 * 60 * 24);

  return (
    ageDays >= 0 &&
    ageDays <=
      MAX_JOB_AGE_DAYS
  );
}

// --------------------------------------------------
// USABLE JOB
// --------------------------------------------------

export function isUsableJob(job) {
  if (isClosedJob(job)) {
    return false;
  }

  if (!isRecentJob(job)) {
    return false;
  }

  return true;
}

// --------------------------------------------------
// NORMALIZE JOB
// --------------------------------------------------

function normalizeJob(job, sourceCountry, searchMode = "unknown") {
  const location =
    job.location
      ?.display_name ??
    "Unknown";

  const description =
    job.description ??
    "";

  return {
    id: String(
      job.id ??
        job.redirect_url ??
        `${job.title}-${job.company?.display_name}-${location}`
    ),

    title:
      job.title ??
      "Unknown",

    company:
      job.company
        ?.display_name ??
      "Unknown",

    location,

    description,

    url:
      job.redirect_url ??
      null,

    source:
      "adzuna",

  sourceCountry,
searchMode,

remote:
  isRemote(job),

hybrid:
  isHybrid(job),

    salary:
      job.salary_min != null ||
      job.salary_max != null
        ? {
            min:
              job.salary_min ??
              null,
            max:
              job.salary_max ??
              null
          }
        : null,

    created:
      job.created ??
      null
  };
}

// --------------------------------------------------
// DEDUPLICATION
// --------------------------------------------------

// Shared with run-agent.js: see deduplicateJobs in job-pre-ranker.js.

// --------------------------------------------------
// LOCAL JOBS
// Alicante + Valencia
// --------------------------------------------------

export async function searchLocalJobs() {
  const jobs = [];

  for (
    const city of
    LOCAL_CITIES
  ) {
    for (
      const term of
      SEARCH_TERMS
    ) {
      console.log(
        `  → ES | ${city} | ${term}`
      );

      try {
        const results =
          await fetchAdzunaJobs({
            countryCode:
              "es",
            term,
            where:
              city
          });

        const normalized =
          results
            .map((job) =>
              normalizeJob(
                job,
                "es",
                "local"
              )
            )
            .filter(
              isUsableJob
            );

        jobs.push(
          ...normalized
        );
      } catch (error) {
        console.log(
          `  ✖ Failed: ES | ${city} | ${term}`
        );

        console.log(
          `    ${error.message}`
        );
      }
    }
  }

  return deduplicateJobs(
    jobs
  );
}

// --------------------------------------------------
// EUROPE REMOTE JOBS
// --------------------------------------------------

export async function searchEuropeRemoteJobs() {
  const jobs = [];

  for (
    const country of
    EUROPE_COUNTRIES
  ) {
    for (
      const term of
      SEARCH_TERMS
    ) {
      console.log(
        `  → ${country.code.toUpperCase()} | REMOTE | ${term}`
      );

      try {
        const results =
          await fetchAdzunaJobs({
            countryCode:
              country.code,
            term
          });

        const normalized =
          results
            .map((job) =>
              normalizeJob(
                job,
                country.code ,
                "remote"
              )
            )
            .filter(
              isUsableJob
            )
            .filter(
              isRemote
            );

        jobs.push(
          ...normalized
        );
      } catch (error) {
        console.log(
          `  ✖ Failed: ${country.name} | ${term}`
        );

        console.log(
          `    ${error.message}`
        );
      }
    }
  }

  return deduplicateJobs(
    jobs
  );
}

// --------------------------------------------------
// UK REMOTE JOBS
// --------------------------------------------------

export async function searchUKRemoteJobs() {
  const jobs = [];

  for (
    const term of
    SEARCH_TERMS
  ) {
    console.log(
      `  → GB | REMOTE | ${term}`
    );

    try {
      const results =
        await fetchAdzunaJobs({
          countryCode:
            "gb",
          term
        });

      const normalized =
        results
          .map((job) =>
            normalizeJob(
              job,
              "gb",
              "remote"
            )
          )
          .filter(
            isUsableJob
          )
          .filter(
            isRemote
          );

      jobs.push(
        ...normalized
      );
    } catch (error) {
      console.log(
        `  ✖ Failed: GB | ${term}`
      );

      console.log(
        `    ${error.message}`
      );
    }
  }

  return deduplicateJobs(
    jobs
  );
}



// --------------------------------------------------
// HIMALAYAS REMOTE JOBS (public API, no API key)
// --------------------------------------------------

const HIMALAYAS_API_URL = "https://himalayas.app/jobs/api/search";
const HIMALAYAS_TIMEOUT_MS = 15000;
const HIMALAYAS_SEARCH_TERMS = ["React", "Frontend", "Next.js"];

const FRONTEND_ROLE_TERMS = [
  "frontend", "front-end", "front end", "react", "next.js", "nextjs",
  "javascript developer", "ui engineer", "web developer"
];

function plainText(value) {
  return String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNonEmpty(...values) {
  return values.find((value) => value != null && String(value).trim() !== "") ?? null;
}

function normalizeHimalayasJob(job) {
  const title = firstNonEmpty(job.title, job.position, job.name) ?? "Unknown";
  const company = firstNonEmpty(job.companyName, job.company, job.organization) ?? "Unknown";
  const descriptionRaw = firstNonEmpty(job.description, job.excerpt, job.descriptionHtml, job.jobDescription) ?? "";
  const description = plainText(descriptionRaw);
  const restrictions = Array.isArray(job.locationRestrictions) ? job.locationRestrictions : [];
  const restrictionNames = restrictions.map((item) => {
    if (typeof item === "string") return item;
    return firstNonEmpty(item?.name, item?.alpha2, item?.slug) ?? "";
  }).filter(Boolean);
  const location = restrictionNames.length ? `Remote: ${restrictionNames.join(", ")}` : "Remote: Worldwide";
  const url = firstNonEmpty(job.applicationLink, job.applicationUrl, job.url, job.jobUrl, job.link);
  const createdValue = firstNonEmpty(job.pubDate, job.publishedAt, job.createdAt, job.datePosted);
  // Himalayas pubDate is Unix seconds or milliseconds depending on API version.
  const created = typeof createdValue === "number"
    ? new Date(createdValue < 1e12 ? createdValue * 1000 : createdValue).toISOString()
    : createdValue;
  const id = firstNonEmpty(job.guid, job.id, job.slug, url, `${title}-${company}-${location}`);
  const normalizedText = normalizeText(`${title} ${description}`);
  const frontendRelevant = FRONTEND_ROLE_TERMS.some((term) => normalizedText.includes(normalizeText(term)));
  const salary = (job.minSalary != null || job.maxSalary != null)
    ? { min: job.minSalary ?? null, max: job.maxSalary ?? null, currency: job.currency ?? null, period: job.salaryPeriod ?? "annual" }
    : null;

  return {
    id: `himalayas:${String(id)}`,
    title,
    company,
    location,
    description,
    url,
    source: "himalayas",
    sourceCountry: restrictionNames[0] ?? "remote",
    searchMode: "remote",
    remote: true,
    hybrid: false,
    salary,
    created,
    descriptionLength: description.length,
    locationRestrictions: restrictionNames,
    timezoneRestrictions: job.timezoneRestrictions ?? job.timezoneRestriction ?? [],
    seniority: job.seniority ?? null,
    employmentType: job.employmentType ?? null,
    sourceAttribution: "Himalayas (https://himalayas.app)"
  };
}

export async function searchHimalayasJobs({ fetchImpl = fetch } = {}) {
  const allJobs = [];
  // Three bounded searches improve title coverage while capping this source at
  // three HTTP requests per run. We deliberately do not retry 429/5xx responses.
  for (const term of HIMALAYAS_SEARCH_TERMS) {
    const url = new URL(HIMALAYAS_API_URL);
    url.searchParams.set("q", term);
    url.searchParams.set("sort", "recent");
    url.searchParams.set("page", "1");

    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(HIMALAYAS_TIMEOUT_MS)
      });
      if (!response.ok) {
        console.warn(`  ⚠ Himalayas search for "${term}" failed: HTTP ${response.status}`);
        continue;
      }
      const payload = await response.json();
      const jobs = Array.isArray(payload) ? payload : (payload.jobs ?? payload.results ?? payload.data ?? []);
      allJobs.push(...jobs.map(normalizeHimalayasJob).filter(isUsableJob));
    } catch (error) {
      console.warn(`  ⚠ Himalayas search for "${term}" failed: ${error.message}`);
    }
  }

  // Source-level dedupe; final cross-source dedupe happens in run-agent.js.
  const seen = new Set();
  return allJobs.filter((job) => {
    const normalizedText = normalizeText(`${job.title} ${job.description}`);
    const frontendRelevant = FRONTEND_ROLE_TERMS.some((term) => normalizedText.includes(normalizeText(term)));
    if (!frontendRelevant) return false;
    const key = `${normalizeText(job.title)}|${normalizeText(job.company)}|${normalizeText(job.location)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --------------------------------------------------
// ALL JOBS
// --------------------------------------------------

// Every source comes from job-source-registry.js (the same list run-agent.js
// uses); a failing source is reported there and does not fail the search.
export async function searchAllJobs(options = {}) {
  const { runSources } = await import("./job-source-registry.js");
  const { jobs } = await runSources(undefined, options);

  return deduplicateJobs(jobs);
}

// --------------------------------------------------
// SEARCH CONFIG
// --------------------------------------------------

export const searchConfig = {
  countries:
    EUROPE_COUNTRIES,

  localCities:
    LOCAL_CITIES,

  searchTerms:
    SEARCH_TERMS,

  resultsPerPage:
    RESULTS_PER_PAGE,

  maxPagesPerQuery:
    MAX_PAGES_PER_QUERY,

  maxJobAgeDays:
    MAX_JOB_AGE_DAYS,

  excludedCountries: [
    "us",
    "ca",
    "au",
    "nz"
  ]
};