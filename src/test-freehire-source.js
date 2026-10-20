// Offline tests for the FreeHire source. Every request goes to a fake fetch.
import assert from "node:assert/strict";
import { FREEHIRE_CONFIG } from "./search-config.js";
import { buildFreehireUrl, freehireBaseUrl, normalizeFreehireJob, requestFreehire, searchFreehireJobs } from "./sources/freehire.js";
import { JOB_SOURCES, runSources } from "./job-source-registry.js";
import { filterJobs } from "./job-filter.js";
import { preRankJob } from "./job-pre-ranker.js";
import { isRemote } from "./job-source-rules.js";

const recent = new Date(Date.now() - 2 * 86400000).toISOString();
const old = new Date(Date.now() - 90 * 86400000).toISOString();
const noSleep = async () => {};
const quiet = () => {};

const api = (overrides = {}) => ({
  public_slug: "frontend-developer-acme-abc123",
  source: "greenhouse",
  external_id: "123",
  url: "https://boards.greenhouse.io/acme/jobs/123",
  title: "Frontend Developer &amp; React Engineer ",
  company: "Acme",
  company_slug: "acme",
  location: "Remote - Spain",
  description: "We are a remote-first team. This is a fully remote position, remote within Spain.\nRequirements:\n- 3+ years with React and TypeScript\nNice to have:\n- GraphQL",
  skills: ["react", "typescript"],
  work_mode: "remote",
  regions: ["eu"],
  countries: ["ES"],
  cities: [],
  posted_at: recent,
  created_at: recent,
  enrichment: { seniority: "middle", category: "frontend", employment_type: "full_time", salary_min: 40000, salary_max: 50000, salary_currency: "EUR", salary_period: "year" },
  ...overrides
});

const response = (body, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => (body instanceof Error ? Promise.reject(body) : body)
});

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    return handler(new URL(String(url)), calls.length);
  };
  return { impl, calls };
}

// 1. Request shape: endpoint, facets, recency, UA, timeout signal.
{
  const url = buildFreehireUrl({ term: "react", scope: FREEHIRE_CONFIG.scopes[1], baseUrl: "https://freehire.me" });
  assert.equal(url.origin + url.pathname, "https://freehire.me/api/v1/agent/jobs/search");
  assert.equal(url.searchParams.get("q"), "react");
  assert.deepEqual(url.searchParams.getAll("category"), ["frontend", "fullstack"]);
  assert.deepEqual(url.searchParams.getAll("regions"), ["eu"]);
  assert.deepEqual(url.searchParams.getAll("work_mode"), ["remote"]);
  assert.equal(url.searchParams.get("posted_within_days"), "30");
  assert.equal(url.searchParams.get("include_description"), "true");
  assert.equal(url.searchParams.get("description_format"), "text");
  const spain = buildFreehireUrl({ term: "frontend", scope: FREEHIRE_CONFIG.scopes[0], baseUrl: "https://freehire.me" });
  assert.deepEqual(spain.searchParams.getAll("countries"), ["es"]);
  assert.equal(spain.searchParams.get("work_mode"), null, "Spain is searched in every work mode; our location rules decide");
  assert.equal(FREEHIRE_CONFIG.terms.length * FREEHIRE_CONFIG.scopes.length, 6, "bounded: six requests per run");
  assert.equal(freehireBaseUrl("", "https://freehire.me"), "https://freehire.me");
  assert.equal(freehireBaseUrl("http://localhost:8080/"), "http://localhost:8080");
  assert.throws(() => freehireBaseUrl("ftp://x"), /must start with http/);
}

// 2. Successful search: normalized into the internal job shape with provenance.
{
  const { impl, calls } = fakeFetch(() => response({ data: [api()], meta: { total: 1 } }));
  const jobs = await searchFreehireJobs({ fetchImpl: impl, sleepImpl: noSleep, log: quiet });
  assert.equal(calls.length, 6);
  assert.equal(calls[0].init.headers["User-Agent"], FREEHIRE_CONFIG.userAgent);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(jobs.length, 1, "the same posting from six queries is kept once");
  const [job] = jobs;
  for (const key of ["id", "title", "company", "location", "description", "url", "source", "sourceCountry", "searchMode", "remote", "hybrid", "salary", "created", "locationRestrictions", "timezoneRestrictions", "sourceAttribution"]) {
    assert.ok(key in job, `normalized job has ${key}`);
  }
  assert.equal(job.id, "freehire:frontend-developer-acme-abc123");
  assert.equal(job.title, "Frontend Developer & React Engineer");
  assert.equal(job.url, "https://boards.greenhouse.io/acme/jobs/123", "the employer's own posting URL, so it dedups with other sources");
  assert.equal(job.source, "freehire");
  assert.equal(job.sourceCountry, "es");
  assert.equal(job.remote, true);
  assert.equal(job.hybrid, false);
  assert.deepEqual(job.salary, { min: 40000, max: 50000, currency: "EUR", period: "year" });
  assert.deepEqual(job.locationRestrictions, [], "FreeHire facets are never turned into restrictions");
  assert.equal(job.sourceTags.workMode, "remote");
  assert.match(job.description, /Requirements:\n- 3\+ years/, "line structure is preserved");
  assert.equal(job.sourceAttribution, "FreeHire (https://freehire.me)");
}

// 3. work_mode is metadata only: the posting text decides remote/hybrid.
{
  const onsite = normalizeFreehireJob(api({ work_mode: "remote", location: "Madrid, Spain", description: "Onsite role in our Madrid office, five days a week. React and TypeScript." }));
  assert.equal(onsite.remote, false, "a 'remote' tag without remote wording is not trusted");
  const { preRank } = preRankJob(onsite);
  assert.equal(preRank.eligible, false, "and the existing location rules make an onsite Madrid job ineligible");
  assert.equal(preRank.locationCategory, "ONSITE_NON_LOCAL");
  assert.equal(filterJobs([onsite]).keptCount, 1, "the title filter itself is unchanged (it never judged location)");

  const hybrid = normalizeFreehireJob(api({ work_mode: "remote", location: "Valencia, Spain", description: "Hybrid role: 2 days per week in our Valencia office. React and TypeScript." }));
  assert.equal(hybrid.hybrid, true, "hybrid wording is detected even when the tag says remote");

  const sensing = normalizeFreehireJob(api({ title: "Remote Sensing Frontend Developer", location: "Munich, Germany", description: "Build React tools for remote sensing satellite data in our Munich office." }));
  assert.equal(sensing.remote, false, "the Remote Sensing safeguard applies to FreeHire too");

  const untagged = normalizeFreehireJob(api({ work_mode: null }));
  assert.equal(untagged.remote, true, "explicit remote wording counts even without a tag");
  const textShape = { title: untagged.title, description: untagged.description, location: { display_name: untagged.location } };
  assert.equal(untagged.remote, isRemote(textShape), "exactly the Adzuna rule");
}

// 4. Normalization edge cases: missing URL, missing fields, old and closed postings.
{
  const noUrl = normalizeFreehireJob(api({ url: null }));
  assert.equal(noUrl.url, "https://freehire.me/jobs/frontend-developer-acme-abc123");
  const sparse = normalizeFreehireJob({ title: null, company: null, description: null });
  assert.deepEqual([sparse.title, sparse.company, sparse.location, sparse.description, sparse.salary], ["Unknown", "Unknown", "Unknown", "", null]);

  const { impl } = fakeFetch(() => response({ data: [
    api({ public_slug: "a", url: "https://x.example/a" }),
    api({ public_slug: "b", url: "https://x.example/b", posted_at: old, created_at: old }),
    api({ public_slug: "c", url: "https://x.example/c", description: "This position has been filled." }),
    api({ public_slug: "d", url: "https://x.example/d", description: "" }),
    null
  ] }));
  const jobs = await searchFreehireJobs({ fetchImpl: impl, sleepImpl: noSleep, log: quiet });
  assert.deepEqual(jobs.map((job) => job.id), ["freehire:a"], "old, closed, empty and malformed entries are dropped");
}

// 5. Malformed responses fail the request clearly.
{
  const url = buildFreehireUrl({ term: "react", scope: FREEHIRE_CONFIG.scopes[0], baseUrl: "https://freehire.me" });
  await assert.rejects(requestFreehire(url, { fetchImpl: async () => response(new SyntaxError("Unexpected token")), sleepImpl: noSleep }), /not valid JSON/);
  await assert.rejects(requestFreehire(url, { fetchImpl: async () => response({ jobs: [] }), sleepImpl: noSleep }), /no data array/);
  await assert.rejects(requestFreehire(url, { fetchImpl: async () => response(null), sleepImpl: noSleep }), /no data array/);
  await assert.rejects(requestFreehire(url, { fetchImpl: async () => response({ error: "not found" }, { status: 404 }), sleepImpl: noSleep }), /404/);
  await assert.rejects(requestFreehire(url, { fetchImpl: async () => response({}, { status: 400 }), sleepImpl: noSleep }), /HTTP 400/);
}

// 6. 429: retried with Retry-After (capped), then succeeds; never more than maxAttempts.
{
  const waits = [];
  const { impl, calls } = fakeFetch((url, n) => (n === 1 ? response({}, { status: 429, headers: { "retry-after": "60" } }) : response({ data: [api()] })));
  const data = await requestFreehire("https://freehire.me/x", { fetchImpl: impl, sleepImpl: async (ms) => waits.push(ms) });
  assert.equal(data.length, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [FREEHIRE_CONFIG.maxRetryAfterMs], "Retry-After is capped");

  const always429 = fakeFetch(() => response({}, { status: 429 }));
  await assert.rejects(requestFreehire("https://freehire.me/x", { fetchImpl: always429.impl, sleepImpl: noSleep }), /HTTP 429 after 3 attempt/);
  assert.equal(always429.calls.length, FREEHIRE_CONFIG.maxAttempts);
}

// 7. 5xx: bounded exponential backoff, then a clear error.
{
  const waits = [];
  const { impl, calls } = fakeFetch(() => response({}, { status: 503 }));
  await assert.rejects(requestFreehire("https://freehire.me/x", { fetchImpl: impl, sleepImpl: async (ms) => waits.push(ms) }), /HTTP 503 after 3 attempt/);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [1000, 2000]);
}

// 8. Timeout: reported, not retried; a real abort is honoured.
{
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const { impl, calls } = fakeFetch(() => { throw timeout; });
  await assert.rejects(requestFreehire("https://freehire.me/x", { fetchImpl: impl, sleepImpl: noSleep }), /no response within 15s/);
  assert.equal(calls.length, 1);

  const keepAlive = setInterval(() => {}, 1000);
  const hanging = async (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  await assert.rejects(requestFreehire("https://freehire.me/x", { fetchImpl: hanging, sleepImpl: noSleep, config: { ...FREEHIRE_CONFIG, timeoutMs: 30 } }), /no response within/);
  clearInterval(keepAlive);

  await assert.rejects(requestFreehire("https://freehire.me/x", { fetchImpl: async () => { throw new TypeError("fetch failed"); } }), /request failed: fetch failed/);
}

// 9. Partial failure keeps the successful requests; total failure throws.
{
  const { impl } = fakeFetch((url) => (url.searchParams.get("q") === "react" ? response({}, { status: 500 }) : response({ data: [api()] })));
  const jobs = await searchFreehireJobs({ fetchImpl: impl, sleepImpl: noSleep, log: quiet });
  assert.equal(jobs.length, 1);

  const down = fakeFetch(() => { throw new TypeError("getaddrinfo ENOTFOUND freehire.me"); });
  await assert.rejects(searchFreehireJobs({ fetchImpl: down.impl, sleepImpl: noSleep, log: quiet }), /all 6 FreeHire request\(s\) failed/);
  assert.equal(down.calls.length, 6, "no retries on a network failure");
}

// 10. Failure isolation and disabling through the registry.
{
  const freehire = JOB_SOURCES.find((source) => source.name === "freehire");
  assert.ok(freehire, "FreeHire is registered");
  assert.equal(freehire.enabled, FREEHIRE_CONFIG.enabled);

  const failing = { ...freehire, search: () => searchFreehireJobs({ fetchImpl: async () => response({}, { status: 503 }), sleepImpl: noSleep, log: quiet }) };
  const other = { name: "himalayas", label: "Himalayas", enabled: true, search: async () => [{ id: "h:1", title: "Frontend Developer", source: "himalayas" }] };
  const { jobs, report } = await runSources([other, failing], { disabled: new Set() });
  assert.deepEqual(jobs.map((job) => job.id), ["h:1"], "the other source's jobs survive a FreeHire outage");
  assert.equal(report.find((row) => row.name === "freehire").status, "failed");
  assert.match(report.find((row) => row.name === "freehire").error, /FreeHire request\(s\) failed/);

  let called = false;
  const spy = { ...freehire, search: async () => { called = true; return []; } };
  const viaEnv = await runSources([other, spy], { disabled: new Set(["freehire"]) });
  assert.equal(called, false);
  assert.equal(viaEnv.report.find((row) => row.name === "freehire").status, "disabled");
  const viaFlag = await runSources([other, { ...spy, enabled: false }], { disabled: new Set() });
  assert.equal(called, false);
  assert.equal(viaFlag.report[1].status, "disabled");
}

console.log("PASS: FreeHire source checks passed (offline, fake fetch).");
