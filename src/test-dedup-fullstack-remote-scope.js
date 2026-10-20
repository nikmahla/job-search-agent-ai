// Offline regression tests for:
// 1. remote duplicates listed under short/long company names,
// 2. consistent ranking of full-stack titles that name a non-JS backend,
// 3. explicit worldwide/Europe permission used by the pre-ranker.
import assert from "node:assert/strict";
import { deduplicateJobs, preRankJob } from "./job-pre-ranker.js";
import { filterJob } from "./job-filter.js";

// ------------------------------------------------------------------
// 1. Deduplication with company-name variants (replica of the saved TXP pair).
// ------------------------------------------------------------------
const SHARED = "Senior Full Stack Developer (React / C# .NET) Contract: Initial 3-Month Engagement (Long-Term Programme) " +
  "Location: Birmingham (remote). We are seeking experienced interim Senior Full Stack Developers to join a long-term programme.";
const remoteAdzuna = (overrides) => ({
  source: "adzuna", remote: true, hybrid: false, title: "Full Stack Developer (React & C# .NET)",
  description: SHARED, ...overrides
});

{
  const merged = deduplicateJobs([
    remoteAdzuna({ id: "5901795229", url: "https://www.adzuna.co.uk/jobs/land/ad/5901795229", company: "TXP", location: "Balsall Heath, Birmingham" }),
    remoteAdzuna({ id: "5906241112", url: "https://www.adzuna.co.uk/jobs/land/ad/5906241112", company: "TXP Technology x People", location: "Birmingham, West Midlands", description: `${SHARED} Extra detail.` })
  ]);
  assert.equal(merged.length, 1, "short and long company names of the same remote posting merge");
  assert.equal(merged[0].sourceInfoList.length, 2, "both source references are kept");
  assert.match(merged[0].description, /Extra detail/, "the richer description wins");
}
{
  // Legal forms and filler words are ignored when finding the root name.
  const merged = deduplicateJobs([
    remoteAdzuna({ id: "a", url: "https://a.example/1", company: "The Acme Group Ltd" }),
    remoteAdzuna({ id: "b", url: "https://b.example/2", company: "Acme" })
  ]);
  assert.equal(merged.length, 1);
}
// Conservative: everything else stays separate.
for (const [label, first, second] of [
  ["different companies", { company: "TXP" }, { company: "Globant" }],
  ["same root, different description", { company: "TXP" }, { company: "TXP Technology x People", description: "A different posting about a React role in a product team, with its own requirements and benefits." }],
  ["same root, different title", { company: "TXP" }, { company: "TXP Technology x People", title: "Frontend Developer (React)" }],
  ["not remote (distinct offices)", { company: "TXP", remote: false }, { company: "TXP Technology x People", remote: false }],
  ["hybrid", { company: "TXP", hybrid: true }, { company: "TXP Technology x People", hybrid: true }],
  ["two-letter roots use two words", { company: "AB Tech" }, { company: "AB Foods" }],
  ["unknown company", { company: "Unknown" }, { company: "Unknown" }]
]) {
  const jobs = deduplicateJobs([
    remoteAdzuna({ id: "x1", url: "https://x.example/1", location: "Remote", ...first }),
    remoteAdzuna({ id: "x2", url: "https://x.example/2", location: "Remote", ...second })
  ]);
  assert.equal(jobs.length, 2, label);
}

// ------------------------------------------------------------------
// 2. Full-stack titles: same rule whatever the word order; nothing rejected.
// ------------------------------------------------------------------
const DESC = "Build React and TypeScript web applications with HTML and CSS.";
const rank = (title) => preRankJob({ title, description: DESC, location: "España", remote: true, sourceCountry: "es", created: new Date().toISOString() }).preRank;

const frontend = rank("Frontend Developer");
const reactFullStack = rank("Full Stack React Developer");
const nodeFullStack = rank("Full Stack Developer (React/Node.js)");
const jsFullStack = rank("Full Stack JavaScript Developer");
assert.equal(nodeFullStack.score, reactFullStack.score, "a JavaScript backend (Node.js) is not penalised");
assert.ok(!jsFullStack.reasons.includes("backend-focused title"));

for (const title of [
  "Full Stack Developer (React & C# .NET)",
  "Fullstack Developer (React + Python)",
  "Senior Full Stack Developer | Python, React, Snowflake",
  "Full Stack Engineer - Java Spring Boot & React",
  "Full Stack Developer (React, PHP/Laravel)",
  "Full Stack Java Developer",
  "Full Stack C# Developer",
  "Full Stack Python Developer",
  "Full Stack PHP Developer"
]) {
  const result = rank(title);
  assert.ok(result.reasons.includes("backend-focused title"), `${title}: existing backend-title rule applies`);
  assert.ok(result.score < reactFullStack.score, `${title} ranks below a React/JS full-stack role`);
  assert.ok(result.score < frontend.score, `${title} ranks below a frontend role`);
  assert.equal(result.roleEligible, true, `${title} is ranked lower, not rejected`);
  assert.equal(filterJob({ title, description: DESC }).keep, true, `${title} still passes the filter`);
}
// Frontend titles that mention a backend technology are not penalised.
assert.ok(!rank("Frontend Developer (React, some Python scripting)").reasons.includes("backend-focused title"));

// ------------------------------------------------------------------
// 3. Remote scope: explicit permission is used; bare "Worldwide" is unchanged.
// ------------------------------------------------------------------
const scope = (job) => preRankJob({ title: "Frontend Developer", remote: true, hybrid: false, created: new Date().toISOString(), ...job }).preRank.locationCategory;
assert.equal(scope({ source: "himalayas", location: "Remote: Worldwide", sourceCountry: "remote", locationRestrictions: [], description: "React." }),
  "REMOTE_UNKNOWN", "an empty Himalayas restriction list is not proof that Spain is allowed");
assert.equal(scope({ source: "himalayas", location: "Remote: Worldwide", sourceCountry: "remote", locationRestrictions: [], description: "Fully remote, work from anywhere." }),
  "EUROPE_REMOTE", "explicit work-from-anywhere wording opens the role to Spain");
assert.equal(scope({ location: "London, UK", sourceCountry: "gb", description: "Remote position. Work from anywhere." }), "EUROPE_REMOTE");
assert.equal(scope({ location: "Berlin", sourceCountry: "de", description: "Remote role open to candidates across Europe." }), "EUROPE_REMOTE");
assert.equal(scope({ location: "London, UK", sourceCountry: "gb", description: "Remote role. Remote within Spain is also possible." }), "SPAIN_REMOTE");
// Incidental wording and explicit restrictions keep their existing meaning.
assert.equal(scope({ location: "London, UK", sourceCountry: "gb", description: "Remote position. We serve customers worldwide." }), "UK_REMOTE");
assert.equal(scope({ location: "London, UK", sourceCountry: "gb", description: "Fully remote position available worldwide. UK residents only." }), "REMOTE_OTHER_REGION");
assert.equal(scope({ location: "London, UK", sourceCountry: "gb", description: "Remote position. React." }), "UK_REMOTE");

console.log("PASS: dedup company variants, full-stack ranking and remote-scope checks passed (offline).");
