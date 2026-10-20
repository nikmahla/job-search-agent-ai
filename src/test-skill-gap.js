// Offline tests for the skill-gap report (synthetic jobs and a synthetic profile).
import assert from "node:assert/strict";
import { buildSkillGapReport, renderSkillGapReport, skillsOfRequirements } from "./skill-gap.js";

const candidate = {
  candidate: { experienceYears: 4 },
  skills: {
    primary: ["React", "Next.js", "TypeScript"],
    secondary: ["REST APIs", "JWT Authentication", "Tailwind CSS"],
    testing: ["Vitest"]
  },
  experience: [{ role: "React & Next.js Developer", company: "Acme", functions: ["Frontend development"] }]
};

const job = (key, title, required, preferred = []) => ({
  key, title, company: `Co-${key}`, status: "ranked", lastResult: { decision: "MAYBE" },
  analysis: { profile: { requirements: {
    required: required.map((item) => ({ type: "skill", item })),
    preferred: preferred.map((item) => ({ type: "skill", item }))
  } } }
});

const state = { jobs: {
  a: job("a", "Frontend Developer", ["React", "React and TypeScript", "TypeScript", "Node.js", "Teamwork and communication skills", "Madrid"], ["GraphQL"]),
  b: job("b", "Full Stack Developer", ["ReactJS", "Node", "Java", "Docker"], ["Playwright"]),
  c: job("c", "React Native Developer", ["React Native", "JavaScript"]),
  d: job("d", "Backend", ["Python"]),
  e: { key: "e", title: "Not analysed", company: "X", status: "new" }
} };

// Skill extraction: synonyms normalise, soft skills/locations/noise are ignored.
{
  const found = skillsOfRequirements({ required: [{ item: "ReactJS" }, { item: "Node" }, "Teamwork and communication skills", { item: "Competitive salary" }, { item: "Madrid" }], preferred: ["React", { item: "GraphQL" }] });
  assert.equal(found.get("react"), "required", "required wins over preferred");
  assert.equal(found.get("nodejs"), "required");
  assert.equal(found.get("graphql"), "preferred");
  assert.deepEqual([...found.keys()].sort(), ["graphql", "nodejs", "react"]);
}

const report = buildSkillGapReport({ state, candidate, generatedAt: "2026-01-01T00:00:00.000Z" });
const get = (id) => report.skills.find((s) => s.id === id);

// Counts are jobs, not occurrences; unanalysed jobs are reported, not counted.
assert.equal(report.analyzed, 4);
assert.equal(report.withoutAnalysis, 1);
assert.equal(get("react").count, 2, "React in job a (listed twice) and b counts once each");
assert.equal(get("react").required, 2);
assert.equal(get("typescript").count, 1);
assert.deepEqual(report.skills.map((s) => s.count), [...report.skills.map((s) => s.count)].sort((a, b) => b - a), "ranked by job count");
assert.equal(report.skills[0].count, 2);

// React Native is not React; Java is not JavaScript.
assert.equal(get("react-native").count, 1);
assert.equal(get("react-native").level, "Missing");
assert.match(get("react-native").note, /not React Native/);
assert.equal(get("java").level, "Missing");
assert.equal(get("javascript").level, "Partial", "JavaScript is only implied by TypeScript in this profile");
assert.match(get("javascript").note, /implied by TypeScript/);

// Standing: strong, implied/partial, related-only partial, missing.
assert.equal(get("react").level, "Strong");
assert.equal(get("nodejs").level, "Partial");
assert.match(get("nodejs").note, /not evidence of Node\.js/);
assert.ok(get("nodejs").evidence.some((line) => /REST APIs|JWT/.test(line)));
assert.equal(get("graphql").level, "Partial");
assert.equal(get("playwright").level, "Partial");
assert.equal(get("docker").level, "Missing");
assert.equal(get("fullstack").level, "Missing", "full-stack comes from the title and has no profile evidence");
assert.equal(get("fullstack").count, 1);
assert.ok(get("python").priority === "LOW" && get("python").relevance === "off-target");

// Rendering contains every section and the honest limits.
const md = renderSkillGapReport(report);
for (const heading of ["# Skill Gap Report", "## 1. Most Requested Skills", "## 2. Skills I Already Have", "## 3. Skills I Partially Have", "## 4. Skills Missing From My CV", "## 5. Recommended Learning Priorities", "## 6. Job-by-Job Skill Evidence"]) {
  assert.ok(md.includes(heading), heading);
}
assert.match(md, /Jobs analysed:\*\* 4 \(of 5 in job-state\.json; 1 have no saved extraction/);
assert.match(md, /Small sample/);
assert.match(md, /\| 2 \| React \| 2 \| 50% \|/);

// No data: no conclusions.
{
  const empty = renderSkillGapReport(buildSkillGapReport({ state: { jobs: {} }, candidate }));
  assert.match(empty, /No analysed jobs are saved yet/);
}

// job-results.json is only a fallback for jobs missing from state.
{
  const withResults = buildSkillGapReport({
    state: { jobs: { a: state.jobs.a } },
    results: [{ stateKey: "a", title: "dup", requirementMatches: [{ item: "Docker", required: true }] },
              { stateKey: "z", title: "Only in results", company: "Z", decision: "SKIP", requirementMatches: [{ item: "Docker", required: true }] }],
    candidate
  });
  assert.equal(withResults.analyzed, 2);
  assert.equal(withResults.skills.find((s) => s.id === "docker").count, 1, "duplicate state key not counted twice");
}

console.log("PASS: skill gap report checks passed (offline).");
