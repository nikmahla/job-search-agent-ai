import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ENRICHMENT_LIMITS,
  enrichJobDescription,
  enrichShortlistedJobs,
  getEnrichmentDiagnostics,
  getEnrichmentUrl,
  needsEnrichment
} from "./description-enrichment.js";

const body = "We are hiring a React developer. Responsibilities: build and maintain frontend features. Requirements: experience with React, TypeScript and testing. We offer remote work. ".repeat(8);
const postingHtml = (description) => `<html><body><nav>Jobs Login Register Sitemap</nav>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "React Developer", description })}</script>
<footer>Related jobs Privacy Cookies</footer></body></html>`;

const response = (html, { status = 200, type = "text/html; charset=UTF-8", extra = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => ({ "content-type": type, ...extra }[name.toLowerCase()] ?? null) },
  text: async () => html
});

const adzuna = (overrides = {}) => ({
  id: "adzuna-1",
  source: "adzuna",
  title: "React Developer",
  company: "Example",
  url: "https://www.adzuna.example/details/1?utm_source=x",
  description: "Short snippet ".repeat(40).slice(0, 500),
  ...overrides
});

const mockFetch = (handler) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  };
  return { fetchImpl, calls };
};

// Valid structured description is accepted; the original is preserved.
{
  const { fetchImpl, calls } = mockFetch(() => response(postingHtml(`<p>${body}</p>`)));
  const job = adzuna();
  const enriched = await enrichJobDescription(job, { fetchImpl });
  assert.equal(enriched.descriptionEnriched, true);
  assert.equal(enriched.shortDescription, job.description);
  assert.ok(enriched.description.length >= ENRICHMENT_LIMITS.minEnrichedLength);
  assert.ok(!/Sitemap|Related jobs|Cookies/.test(enriched.description), "navigation/footer text excluded");
  assert.equal(enriched.descriptionEnrichmentReason, "json-ld");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, "follow");
  assert.equal(calls[0].options.method, "GET");
  assert.ok(calls[0].options.signal instanceof AbortSignal, "timeout signal is set");
  assert.equal(job.description.length, 500, "input is not mutated");
}

// A clearly identifiable description section is accepted when no JSON-LD exists.
{
  const html = `<body><nav>Menu</nav><section class="adp-body">${body}</section><div>Related jobs</div></body>`;
  const enriched = await enrichJobDescription(adzuna(), { fetchImpl: async () => response(html) });
  assert.equal(enriched.descriptionEnriched, true);
  assert.equal(enriched.descriptionEnrichmentReason, "description-section");
  assert.ok(!enriched.description.includes("Related jobs"));
}

// Navigation-only HTML (even with lots of visible text) is rejected, never accepted wholesale.
{
  const nav = `<html><body><nav>${"Jobs Salaries Companies Login ".repeat(100)}</nav><ul>${"<li>Related job React Developer</li>".repeat(60)}</ul></body></html>`;
  const job = adzuna();
  const result = await enrichJobDescription(job, { fetchImpl: async () => response(nav) });
  assert.equal(result.descriptionEnriched, false);
  assert.equal(result.descriptionEnrichmentReason, "no-description-section");
  assert.equal(result.description, job.description);
}

// Failure modes keep the original description and record a reason.
const failures = [
  ["http-403", () => response("Forbidden", { status: 403 })],
  ["not-html", () => response("{}", { type: "application/json" })],
  ["response-too-large", () => response(postingHtml(body), { extra: { "content-length": String(ENRICHMENT_LIMITS.maxBytes + 1) } })],
  ["response-too-large", () => response(postingHtml("x".repeat(ENRICHMENT_LIMITS.maxBytes)))],
  ["text-too-short", () => response(postingHtml("Responsibilities and requirements for a React developer."))],
  ["not-job-related", () => response(postingHtml("Lorem ipsum dolor sit amet. ".repeat(60)))],
  ["timeout", () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }],
  ["fetch-failed", () => { throw new Error("network down"); }]
];
for (const [reason, handler] of failures) {
  const job = adzuna();
  const result = await enrichJobDescription(job, { fetchImpl: async () => handler() });
  assert.equal(result.descriptionEnriched, false, reason);
  assert.equal(result.descriptionEnrichmentReason, reason);
  assert.equal(result.description, job.description, `${reason}: original kept`);
  assert.equal(result.shortDescription, undefined);
  assert.equal(result.id, job.id, "job is not dropped");
}

// Streamed responses are cut off at the size cap.
{
  let cancelled = false;
  const chunk = new Uint8Array(200 * 1024);
  let sent = 0;
  const streamed = {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/html" : null) },
    body: {
      getReader: () => ({
        read: async () => (sent++ < 10 ? { done: false, value: chunk } : { done: true }),
        cancel: async () => { cancelled = true; }
      })
    }
  };
  const result = await enrichJobDescription(adzuna(), { fetchImpl: async () => streamed });
  assert.equal(result.descriptionEnrichmentReason, "response-too-large");
  assert.equal(cancelled, true);
  assert.ok(sent <= 4, "stops reading shortly after the cap");
}

// Eligibility: only Adzuna jobs with short descriptions and a usable URL.
assert.equal(needsEnrichment(adzuna()), true);
assert.equal(needsEnrichment(adzuna({ description: "x".repeat(501) })), false);
assert.equal(needsEnrichment(adzuna({ source: "himalayas" })), false);
assert.equal(needsEnrichment(adzuna({ url: null })), false);
assert.equal(getEnrichmentUrl(adzuna({
  sourceInfoList: [
    { source: "himalayas", url: "https://himalayas.example/1" },
    { source: "adzuna", url: "https://www.adzuna.example/a" },
    { source: "adzuna", url: "https://www.adzuna.example/b" }
  ]
})), "https://www.adzuna.example/a", "first Adzuna URL is the single attempt");

// Request limit: one GET per eligible job, never more, and no retry after a failure.
{
  const { fetchImpl, calls } = mockFetch((url) => (url.endsWith("/fail") ? response("no", { status: 429 }) : response(postingHtml(body))));
  const jobs = [
    adzuna({ id: "a", url: "https://www.adzuna.example/ok1" }),
    adzuna({ id: "b", url: "https://www.adzuna.example/fail" }),
    adzuna({ id: "c", description: "x".repeat(900), url: "https://www.adzuna.example/skipped-long" }),
    adzuna({ id: "d", source: "himalayas", url: "https://himalayas.example/skipped" }),
    adzuna({ id: "e", url: "https://www.adzuna.example/ok2" })
  ];
  const result = await enrichShortlistedJobs(jobs, { fetchImpl, delayMs: 0 });
  assert.equal(calls.length, 3, "one request per eligible job");
  assert.deepEqual(calls.map((call) => call.url.split("/").pop()), ["ok1", "fail", "ok2"], "sequential, in order");
  assert.deepEqual(result.map((job) => job.id), ["a", "b", "c", "d", "e"], "no job dropped, order kept");
  assert.deepEqual(result.map((job) => job.descriptionEnriched), [true, false, undefined, undefined, true]);
  assert.equal(result[1].descriptionEnrichmentReason, "http-429");
}

// run-agent wires enrichment between selectTopJobs and Qwen extraction.
const runAgentSource = fs.readFileSync(new URL("./run-agent.js", import.meta.url), "utf8");
// Enrichment now happens inside selectFinalShortlist, before the final cut
// (behaviour covered by test-shortlist.js); Qwen only sees its output.
assert.ok(runAgentSource.includes("selectFinalShortlist("));
// Extraction (live Qwen or a valid cache) happens inside analyzeJob(), after the shortlist.
assert.ok(runAgentSource.indexOf("selectFinalShortlist(") < runAgentSource.indexOf("analyzeJob(rawJob"));
assert.ok(!runAgentSource.includes("enrichShortlistedJobs(selectedJobs)"), "no second enrichment after the cut");

assert.deepEqual(
  getEnrichmentDiagnostics({ descriptionEnriched: true, descriptionEnrichmentReason: "json-ld", url: "https://x.test/a?q=1", description: "text" }),
  { descriptionEnriched: true, descriptionEnrichmentReason: "json-ld" }
);
assert.deepEqual(
  getEnrichmentDiagnostics({ descriptionEnriched: false, descriptionEnrichmentReason: "http-403" }),
  { descriptionEnriched: false, descriptionEnrichmentReason: "http-403" }
);
assert.deepEqual(getEnrichmentDiagnostics({}), { descriptionEnriched: null, descriptionEnrichmentReason: null });
assert.deepEqual(getEnrichmentDiagnostics(undefined), { descriptionEnriched: null, descriptionEnrichmentReason: null });
assert.match(runAgentSource, /debugJobProfiles\.push\(\{[\s\S]*\.\.\.getEnrichmentDiagnostics\(rawJob\)[\s\S]*\}\);/);

console.log("PASS: description enrichment checks passed (offline).");
