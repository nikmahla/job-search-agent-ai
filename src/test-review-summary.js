// Offline tests for the human-review lines: built only from saved results.
import assert from "node:assert/strict";
import { reviewSummaryLines } from "./review-summary.js";

const base = {
  decision: "MAYBE",
  gates: {
    roleFit: { status: "PASS", note: "ok" },
    location: { status: "FLAG", note: "Remote scope unclear." }
  },
  sourceInfo: { location: "Valencia" },
  extraction: { status: "complete" },
  requirementMatches: [
    { status: "EXACT", matched: ["React", "TypeScript"] },
    { status: "PARTIAL", matched: ["JavaScript", "react"], missing: ["Preact"] },
    { status: "MISSING", matched: [] }
  ],
  missingRequiredSkills: ["Preact", "Node.js", "GraphQL", "Docker"]
};

{
  const lines = reviewSummaryLines(base);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Valencia · FLAG — Remote scope unclear\./);
  assert.equal(lines[1], "   Matches: React, TypeScript, JavaScript");
  assert.match(lines[2], /Preact; Node\.js; GraphQL; \+1 more required gap\(s\); Location FLAG/);
  assert.doesNotMatch(lines[2], /Role fit/, "passing gates are not concerns");
}

// Nothing is invented when the analysis has no data; falls back to ATS keywords.
{
  const lines = reviewSummaryLines({ decision: "APPLY", ats: { matchedKeywords: ["react"] } });
  assert.deepEqual(lines, ["   Remote/location: unknown", "   Matches: react", "   Gaps/concerns: none found"]);
}

// Incomplete extraction is a visible concern; SKIP jobs get no extra lines.
assert.match(reviewSummaryLines({ ...base, extraction: { status: "partial" } })[2], /extraction incomplete/);
assert.deepEqual(reviewSummaryLines({ ...base, decision: "SKIP" }), []);

console.log("review-summary tests passed");
