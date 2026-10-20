import assert from "node:assert/strict";
import {
  EUROPE_COUNTRIES,
  LOCAL_CITIES,
  SEARCH_TERMS,
  countPlannedRequests,
  findDuplicateTerms,
  findSubsetTerms
} from "./search-config.js";

// Request budget must not grow: 7 terms x (2 cities + 9 countries + UK) = 84.
assert.equal(SEARCH_TERMS.length, 7);
assert.equal(countPlannedRequests(), 84);
assert.equal(countPlannedRequests({ terms: ["a", "b"], cities: ["x"], countries: [], pagesPerQuery: 2 }), 8);

// Target-role coverage.
const has = (term) => SEARCH_TERMS.includes(term);
for (const term of [
  "React Developer",
  "React Engineer",
  "Frontend Developer",
  "Frontend Engineer",
  "Next.js Developer",
  "JavaScript Developer",
  "Full Stack React Developer"
]) {
  assert.ok(has(term), `missing search term: ${term}`);
}

// No redundant terms: no duplicates, and no term that only narrows a broader one
// among the frontend/React family (the intentional full-stack term is allowed).
assert.deepEqual(findDuplicateTerms(), []);
assert.ok(!SEARCH_TERMS.includes("Frontend Software Engineer"));
assert.deepEqual(
  findSubsetTerms().filter(({ narrow }) => narrow !== "Full Stack React Developer"),
  []
);

// Helper behavior.
assert.deepEqual(findDuplicateTerms(["React Developer", "  react   developer ", "Frontend Developer"]), ["  react   developer "]);
assert.deepEqual(findSubsetTerms(["Frontend Engineer", "Frontend Software Engineer"]), [
  { narrow: "Frontend Software Engineer", broad: "Frontend Engineer" }
]);
assert.deepEqual(findSubsetTerms(["React Developer", "Frontend Developer"]), []);

// Only Adzuna-supported countries; the UAE is not available through Adzuna.
const codes = EUROPE_COUNTRIES.map((country) => country.code);
assert.ok(!codes.includes("ae"));
for (const unsupported of ["us", "ca", "au", "nz", "ae"]) assert.ok(!codes.includes(unsupported));
assert.deepEqual(LOCAL_CITIES, ["Alicante", "Valencia"]);

console.log("PASS: search configuration checks passed.");
