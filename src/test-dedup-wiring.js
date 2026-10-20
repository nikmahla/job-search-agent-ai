import assert from "node:assert/strict";
import fs from "node:fs";
import { deduplicateJobs } from "./job-pre-ranker.js";

// run-agent.js runs main() on import and searchAllJobs() performs API calls, so
// the wiring is verified from source: both must use the single shared implementation.
const read = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const sharedImport = /import\s*\{[^}]*\bdeduplicateJobs\b[^}]*\}\s*from\s*"\.\/job-pre-ranker\.js"/;

for (const file of ["job-sources.js", "run-agent.js"]) {
  const source = read(file);
  assert.match(source, sharedImport, `${file} must import the shared deduplicateJobs`);
  assert.ok(!/function\s+deduplicateJobs\b/.test(source), `${file} must not define its own deduplicateJobs`);
  assert.match(source, /\bdeduplicateJobs\(/, `${file} must call deduplicateJobs`);
}

assert.ok(!/from\s+"\.\/job-sources\.js"/.test(read("job-pre-ranker.js")), "no circular import");
assert.match(read("job-sources.js"), /export async function searchAllJobs[\s\S]*?return deduplicateJobs\(/);

// The shared behavior both paths rely on: richest description, all source references, order-independent.
const job = (overrides) => ({
  title: "Frontend Developer",
  company: "Acme",
  location: "Remote: Spain",
  created: new Date().toISOString(),
  ...overrides,
});
const postingUrl = "https://jobs.example/ad/1";
const adzuna = job({ id: "adzuna:1", source: "adzuna", description: "Short.", url: `${postingUrl}?utm_source=x` });
const himalayas = job({ id: "himalayas:1", source: "himalayas", description: "Full description. ".repeat(30), url: postingUrl });

for (const order of [[adzuna, himalayas], [himalayas, adzuna]]) {
  const [merged, ...rest] = deduplicateJobs(order);
  assert.equal(rest.length, 0);
  assert.equal(merged.description, himalayas.description);
  assert.deepEqual(merged.sourceInfoList.map((ref) => ref.source).sort(), ["adzuna", "himalayas"]);
  assert.deepEqual(merged.sourceInfoList.map((ref) => ref.url).sort(), [adzuna.url, himalayas.url].sort());
}

// Same company, different postings stay separate; so do different URLs and IDs even with equal titles.
assert.equal(deduplicateJobs([adzuna, { ...himalayas, id: "himalayas:2", url: "https://jobs.example/ad/2", title: "React Engineer" }]).length, 2);
assert.equal(deduplicateJobs([adzuna, { ...himalayas, url: "https://other.example/ad/9" }]).length, 2);

console.log("PASS: deduplication wiring and shared behavior checks passed.");
