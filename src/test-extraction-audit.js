// Offline tests for the deterministic extraction audit used by the real-Qwen
// validation script. Each case is a plausible LLM extraction mistake.
import assert from "node:assert/strict";
import { auditExtraction, correctExtraction, segmentPosting } from "./extraction-audit.js";
import { scoreJob } from "./job-scorer.js";

const R = (item) => ({ type: "skill", item, priority: "critical" });
const P = (item) => ({ type: "skill", item, priority: "preferred" });
const types = (findings) => findings.map((finding) => finding.type).sort();

const POSTING = [
  "Frontend Developer (React) - remote within Spain.",
  "Requirements:",
  "- 3+ years of experience with React and TypeScript",
  "- Solid HTML and CSS",
  "- English B2",
  "Nice to have:",
  "- AWS",
  "- GraphQL",
  "- 5+ years of experience",
  "- German is a plus"
].join("\n");

// 1. Sections are recognised.
{
  const segments = segmentPosting(POSTING);
  const aws = segments.find((segment) => segment.ids.has("aws"));
  const react = segments.find((segment) => segment.ids.has("react") && segment.section === "required");
  assert.equal(aws.optional, true, "items under 'Nice to have:' are optional");
  assert.equal(react.optional, false);
}

// 2. A correct extraction produces no actionable findings.
{
  const findings = auditExtraction(POSTING, {
    requirements: { required: [R("React"), R("TypeScript"), R("HTML and CSS")], preferred: [P("AWS"), P("GraphQL")] },
    experience: { minimumYears: 3 },
    languages: [{ language: "English", level: "B2", required: true }, { language: "German", required: false }]
  });
  assert.deepEqual(findings.filter((finding) => finding.severity !== "info"), []);
}

// 3. Typical mistakes are detected.
const wrong = {
  requirements: {
    required: [R("React"), R("TypeScript"), R("AWS"), R("Kubernetes")],
    preferred: [P("HTML and CSS")]
  },
  experience: { minimumYears: 5 },
  languages: [{ language: "English", level: "B2", required: true }, { language: "German", level: null, required: true }],
  responsibilities: { core: [], secondary: [] }
};
const POSTING_WITHOUT_REQUIRED_YEARS = POSTING.replace("- 3+ years of experience with React and TypeScript", "- React and TypeScript");
{
  const findings = auditExtraction(POSTING_WITHOUT_REQUIRED_YEARS, wrong);
  assert.deepEqual(types(findings.filter((finding) => finding.severity !== "info")), [
    "LANGUAGE_OPTIONAL_AS_REQUIRED", "NOT_IN_POSTING", "PREFERRED_AS_REQUIRED", "REQUIRED_AS_PREFERRED", "YEARS_PREFERRED_AS_MINIMUM"
  ]);
  assert.equal(findings.find((finding) => finding.type === "PREFERRED_AS_REQUIRED").item, "AWS");
  assert.equal(findings.find((finding) => finding.type === "NOT_IN_POSTING").item, "Kubernetes");
  assert.equal(findings.find((finding) => finding.type === "REQUIRED_AS_PREFERRED").item, "HTML and CSS");
  assert.equal(findings.find((finding) => finding.type === "LANGUAGE_OPTIONAL_AS_REQUIRED").item, "German");
}
// A required minimum the extraction missed.
{
  const findings = auditExtraction(POSTING, { requirements: { required: [R("React")], preferred: [] }, experience: { minimumYears: null }, languages: [] });
  assert.ok(findings.some((finding) => finding.type === "YEARS_MISSED" && finding.item === "3+ years"));
}
// Requirement wording that no extracted item covers is reported as info only.
{
  const findings = auditExtraction(POSTING, { requirements: { required: [R("React")], preferred: [] }, experience: { minimumYears: 3 }, languages: [] });
  const info = findings.find((finding) => finding.type === "TECH_NOT_EXTRACTED");
  assert.equal(info.severity, "info");
  assert.match(info.item, /TypeScript/);
}
// Spanish and Italian optional wording.
{
  const es = "Requisitos: React y TypeScript. Se valorará experiencia con AWS.";
  assert.ok(auditExtraction(es, { requirements: { required: [R("AWS")], preferred: [] }, experience: {}, languages: [] })
    .some((finding) => finding.type === "PREFERRED_AS_REQUIRED"));
  const it = "Requisiti: React. Costituisce un plus la conoscenza di GraphQL.";
  assert.ok(auditExtraction(it, { requirements: { required: [R("GraphQL")], preferred: [] }, experience: {}, languages: [] })
    .some((finding) => finding.type === "PREFERRED_AS_REQUIRED"));
}

// 4. Correction measures the decision impact without touching the original.
{
  const candidate = {
    candidate: { experienceYears: 4, location: { acceptedCities: ["Alicante", "Valencia"] }, workAuthorization: { eu: true },
      languages: [{ language: "English", level: "C1" }] },
    professionalProfile: { targetRoles: ["Frontend Developer"] },
    skills: { primary: ["React", "TypeScript", "HTML", "CSS"] },
    experience: [{ role: "Frontend Developer", functions: ["Frontend development"] }]
  };
  const profile = {
    extraction: { status: "complete", fields: { "workAuthorization.required": "present" }, warnings: [] },
    job: { title: "Frontend Developer", company: "X", description: POSTING_WITHOUT_REQUIRED_YEARS },
    requirements: { required: [R("React"), R("TypeScript"), R("AWS"), R("GraphQL")], preferred: [] },
    experience: { minimumYears: 5, requiredFunctions: [] },
    responsibilities: { core: ["Build React features"], secondary: [] },
    qualifications: [], languages: [{ language: "English", level: "B2", required: true }],
    workAuthorization: { required: false, eu: false },
    location: { type: "remote", remoteScope: "country-specific", country: "Spain" },
    sourceInfo: { location: "España", description: POSTING_WITHOUT_REQUIRED_YEARS, remote: true, hybrid: false }
  };
  const before = scoreJob(candidate, profile);
  const findings = auditExtraction(POSTING_WITHOUT_REQUIRED_YEARS, profile);
  const fixed = correctExtraction(profile, findings);
  const after = scoreJob(candidate, fixed);

  assert.notEqual(before.decision, "APPLY", "the mis-extracted AWS/GraphQL requirements and 5+ years block APPLY");
  assert.equal(after.decision, "APPLY", "with optional items moved to preferred and years corrected, the job is an APPLY");
  assert.deepEqual(fixed.requirements.preferred.map((item) => item.item), ["AWS", "GraphQL"]);
  assert.equal(fixed.experience.minimumYears, null);
  assert.equal(profile.requirements.required.length, 4, "the original profile is unchanged");
}

// 5. Years listed under an optional heading are optional everywhere, including
// the pre-ranker's eligibility check (previously such jobs were rejected).
{
  const { analyzeYearsRequirements, preRankJob, sectionHeading } = await import("./job-pre-ranker.js");
  const eligible = (description) => preRankJob({ title: "Frontend Developer", description, location: "Alicante" }).preRank.roleEligible;
  assert.deepEqual(analyzeYearsRequirements("Requirements:\n- React\nNice to have:\n- 5+ years of experience"), { requiredMinimum: null, optionalYears: [5] });
  assert.equal(eligible("Requirements:\n- React and TypeScript\nNice to have:\n- 5+ years of experience\n- AWS"), true);
  assert.equal(eligible("Requisitos:\n- React\nSe valorará:\n- Más de 5+ años de experiencia"), true);
  assert.equal(eligible("Requirements:\n- 5+ years of experience with React"), false, "a required 5+ still rejects");
  assert.equal(eligible("Nice to have:\n- AWS\nRequirements:\n- Minimum 6 years of experience"), false, "a required heading ends the optional section");
  assert.equal(sectionHeading("se valorara experiencia con aws."), null, "a sentence is not a heading");
  assert.equal(sectionHeading("nice to have:"), "optional");
}

// 6. Flattened postings (no line breaks, as Himalayas and enriched pages often
// arrive) must not turn a whole posting into one "optional" sentence. These
// replicate the real postings that produced false findings.
{
  const flattened = "Job Summary We are looking for a Frontend Developer with QA experience. Key Responsibilities: Develop and maintain web applications using React JS Build responsive interfaces using Tailwind CSS or Bootstrap Write E2E tests using Playwright Preferred Qualifications: Experience with API testing tools Bonus: Postman";
  const findings = auditExtraction(flattened, { requirements: { required: [R("React JS"), R("CSS frameworks (Tailwind or Bootstrap)")], preferred: [P("Postman")] }, experience: {}, languages: [] });
  assert.ok(!findings.some((finding) => finding.type === "PREFERRED_AS_REQUIRED"), "responsibilities are not optional because a later heading says 'Preferred'");
}
{
  const merged = "Your profile Strong experience with JavaScript, TypeScript, HTML and CSS Very good knowledge of modern JavaScript frameworks, ideally Vue.js and Nuxt";
  const findings = auditExtraction(merged, { requirements: { required: [R("Strong experience with JavaScript, TypeScript, HTML and CSS")], preferred: [] }, experience: {}, languages: [] });
  assert.ok(!findings.some((finding) => finding.type === "PREFERRED_AS_REQUIRED"), "'ideally' belongs to the next bullet");
}
{
  const essential = "Essential Requirements: The key is to have solid experience in React (preferably NextJS), Python for backend, and LLMs. 4 years Front-End JavaScript (preferred framework: NextJS, or React, Vue.js) 2 years TypeScript Deployment in CSPs (Azure preferred, or AWS, Google) Proficiency in HTML/CSS and Git";
  const findings = auditExtraction(essential, {
    requirements: { required: [R("React"), R("TypeScript"), R("Deployment in CSPs (Azure preferred, or AWS, Google)"), R("HTML/CSS")], preferred: [] },
    experience: { minimumYears: 4 }, languages: []
  });
  assert.deepEqual(findings.filter((finding) => finding.severity !== "info"), [], "a preference among alternatives is not an optional requirement");
}
{
  // Genuine optional wording in a flattened posting is still detected.
  const flattenedOptional = "Requirements: React and TypeScript Nice to have: GraphQL and AWS";
  const findings = auditExtraction(flattenedOptional, { requirements: { required: [R("React"), R("GraphQL")], preferred: [] }, experience: {}, languages: [] });
  assert.deepEqual(findings.filter((finding) => finding.type === "PREFERRED_AS_REQUIRED").map((finding) => finding.item), ["GraphQL"]);
}

console.log("PASS: extraction audit checks passed (offline).");
