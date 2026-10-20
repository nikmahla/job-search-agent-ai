// Offline regression tests for requirement-sentence matching.
// The extractor returns requirement lines as sentences (often in Spanish or
// Italian); these tests pin how those sentences are compared with the
// candidate profile. No network, no data/ files: the candidate is inline.
import assert from "node:assert/strict";
import { scoreJob } from "./job-scorer.js";
import { normalizeJobProfile } from "./build-job-profile.js";
import { analyzeTechText, buildCandidateTechEvidence, findMentions } from "./tech-lexicon.js";

const candidate = {
  candidate: {
    experienceYears: 4,
    location: { acceptedCities: ["Alicante", "Valencia"] },
    workAuthorization: { eu: true },
    languages: [{ language: "English", level: "C1" }, { language: "Spanish", level: "B1" }]
  },
  professionalProfile: { targetRoles: ["Frontend Developer", "Frontend Engineer", "React Developer", "Next.js Developer"] },
  skills: {
    primary: ["React", "Next.js", "TypeScript", "JavaScript"],
    secondary: ["HTML", "CSS", "Redux Toolkit", "Zustand", "React Query", "REST APIs", "Tailwind CSS", "Material UI"],
    testing: ["Vitest", "React Testing Library", "Unit Testing"],
    practices: ["Agile", "Code Review", "Responsive Design", "Accessibility"]
  },
  experience: [{
    role: "React & Next.js Developer",
    functions: ["Frontend development", "React development", "Next.js development", "REST API integration", "Testing", "Code review"]
  }],
  education: [{ degree: "B.Sc. Computer Science" }, { degree: "M.Sc. Computer Engineering (Software)" }],
  atsKeywords: ["Frontend Developer", "React", "Next.js", "TypeScript"]
};

const makeJob = (overrides = {}) => ({
  extraction: { status: "complete", fields: { "workAuthorization.required": "present" }, warnings: [] },
  job: { title: "Frontend Developer", company: "Example Co", description: "" },
  requirements: { required: [], preferred: [] },
  experience: { minimumYears: null, requiredFunctions: [] },
  responsibilities: { core: [], secondary: [] },
  qualifications: [],
  languages: [],
  workAuthorization: { required: false, eu: false },
  location: { type: "remote", city: null, country: null, remoteScope: "worldwide" },
  sourceInfo: { location: "Remote", description: "Fully remote position available worldwide.", remote: true, hybrid: false, searchMode: "remote" },
  ...overrides
});

const required = (...items) => ({ required: items.map((item) => ({ type: "skill", item, priority: "important" })), preferred: [] });
const technical = (item) => scoreJob(candidate, makeJob({ requirements: required(item) })).breakdown.technical;
const ids = (text) => findMentions(text).mentions.map((mention) => mention.id);

// 1. Lexicon: longest match first, no cross-technology substrings.
assert.deepEqual(ids("Tailwind CSS"), ["tailwind"], "Tailwind CSS is not also CSS");
assert.deepEqual(ids("React Native"), ["react-native"], "React Native is not React");
assert.deepEqual(ids("React Testing Library"), ["react-testing-library"]);
assert.deepEqual(ids("Java and JavaScript"), ["java", "javascript"]);
assert.deepEqual(ids("C# .NET and C++"), ["csharp", "dotnet", "cpp"]);
assert.deepEqual(ids("Next.js, React.js and Node.js"), ["nextjs", "react", "nodejs"]);
assert.deepEqual(ids("Familiarità con API REST"), ["rest-apis"]);
assert.deepEqual(ids("Ability to express ideas end to end"), [], "plain English words are not technologies");
const evidence = buildCandidateTechEvidence(["React Testing Library", "Tailwind CSS"]);
assert.equal(evidence.has("react"), false, "React Testing Library is not React evidence");
assert.equal(evidence.has("css"), false, "Tailwind CSS is not CSS evidence");
assert.equal(evidence.get("testing"), 1, "React Testing Library is testing evidence");

// 2. Grouping: alternatives need one match, other lists need all.
assert.equal(analyzeTechText("Redux, Redux Toolkit, Zustand, or similar").groups[0].anyOf, true);
assert.equal(analyzeTechText("Vue.js or React").groups[0].anyOf, true);
assert.equal(analyzeTechText("JavaScript, TypeScript, HTML and CSS").groups[0].anyOf, false);
assert.equal(analyzeTechText("HTML/CSS").groups[0].anyOf, false, "a slash pair means both");
assert.equal(analyzeTechText("build tools (Vite, Webpack, Turbopack)").groups[0].anyOf, true);
assert.equal(analyzeTechText("front end technologies, such as JavaScript, HTML, and CSS").groups.at(-1).anyOf, false,
  "examples of a broad area are not alternatives");

// 3. Requirement sentences the candidate meets (the reported defect).
for (const item of [
  "React", "React.js", "React JS", "React and TypeScript", "experience with React and TypeScript",
  "strong knowledge of React", "proficiency in Next.js", "React, Redux Toolkit and Zustand", "HTML/CSS",
  "TypeScript", "frontend development", "Strong TypeScript", "TypeScript avanzato",
  "Strong experience with JavaScript, TypeScript, HTML and CSS",
  "Strong competency in state management (Redux, Redux Toolkit, Zustand, or similar)",
  "Experiencia en desarrollo frontend con React, Next.js y Material UI (MUI)",
  "Almeno 3 anni di esperienza con React.js", "3+ years of experience with React", "Familiarità con API REST",
  "modern JavaScript (ES6+)", "Experience with Jest or Vitest", "Knowledge of REST APIs"
]) {
  assert.ok(technical(item) >= 90, `"${item}" must be credited (got ${technical(item)})`);
}

// 4. Honesty: no credit for skills the candidate does not have.
for (const [item, expected] of [
  ["Strong experience with Angular", 0],
  ["Vue.js and Nuxt", 0],
  ["Java, Spring Boot and Microservices", 0],
  ["Experiencia sólida en desarrollo backend con Python", 0],
  ["Experience with frontend frameworks such as Vue, Angular or Svelte", 0],
  ["Node.js (Express/NestJS) experience", 0],
  ["Experience with Jest and Cypress", 0],
  ["Experience with Vercel AI SDK", 0],
  ["Knowledge of Git", 0],
  ["React and PostgreSQL", 50],
  ["React Native and TypeScript", 50],
  ["5+ years of experience with React and Node.js", 50]
]) {
  assert.equal(Math.round(technical(item)), expected, `"${item}"`);
}

// 5. Languages and soft skills in other languages are not technical gaps.
assert.equal(technical("Buona conoscenza dell'inglese (scritto e parlato)"), null);
assert.equal(technical("Propensione al lavoro in team"), null);
assert.equal(technical("Capacidad de trabajo en equipo"), null);
assert.ok(technical("Strong React y buen nivel de inglés") >= 90, "the React part of a mixed line is still scored");

// 6. Missing-skill reporting: whole line when nothing matches, only the gap otherwise.
const partial = scoreJob(candidate, makeJob({
  requirements: required("React and PostgreSQL", "Strong experience with Angular", "Experience with React and TypeScript")
}));
assert.deepEqual(partial.missingRequiredSkills, ["PostgreSQL", "Strong experience with Angular"]);
const reactLine = partial.requirementMatches.find((match) => match.item === "React and PostgreSQL");
assert.deepEqual(reactLine.matched, ["React"]);
assert.deepEqual(reactLine.missing, ["PostgreSQL"]);
assert.equal(reactLine.method, "sentence");
const preferredOnly = scoreJob(candidate, makeJob({
  requirements: { required: [{ type: "skill", item: "React", priority: "critical" }], preferred: [{ type: "skill", item: "GraphQL", priority: "preferred" }] }
}));
assert.deepEqual(preferredOnly.missingRequiredSkills, [], "a preferred gap is not a missing required skill");

// 7. Responsibilities: technologies decide; Java must not ride on JavaScript.
const responsibility = (line) => scoreJob(candidate, makeJob({
  requirements: required("React"), responsibilities: { core: [line], secondary: [] }
})).breakdown.responsibilities;
assert.equal(responsibility("Develop and maintain backend microservices in Java"), 0);
assert.equal(responsibility("Manage Kubernetes clusters and CI/CD pipelines"), 0);
assert.equal(responsibility("Build responsive user interfaces with React"), 100);
assert.equal(responsibility("Write unit tests for frontend code"), 100);

// 8. Qualifications: degrees against education; languages/soft skills skipped.
const qualification = (...lines) => scoreJob(candidate, makeJob({ requirements: required("React"), qualifications: lines })).breakdown.qualifications;
assert.equal(qualification("Bachelor's degree in Computer Science"), 100);
assert.equal(qualification("Master's degree in Software Engineering or related field"), 100);
assert.equal(qualification("PhD in Computer Science"), 0, "no doctorate in the profile");
assert.equal(qualification("Excellent English communication skills"), null, "a language line is not a qualification gap");
assert.equal(qualification("No use of CSS libraries such as Tailwind"), null, "a prohibition is not a skill to credit");
const noEducation = { ...candidate, education: [] };
assert.equal(scoreJob(noEducation, makeJob({ requirements: required("React"), qualifications: ["Degree in Computer Science"] })).breakdown.qualifications, 0);

// 9. ATS: spelling variants of a technology keyword count; title keywords stay literal.
const ats = scoreJob(candidate, makeJob({
  job: { title: "Web Engineer", company: "X", description: "We build with React.js and Next.js." },
  requirements: required("React")
})).ats;
assert.ok(ats.matchedKeywords.includes("react"), "React.js in the posting matches the React keyword");
assert.ok(!ats.matchedKeywords.includes("frontend developer"), "a title keyword is not matched by technology mentions");

// 10. End to end through the real normalizer with Qwen-style sentence output.
const REACT_DUTIES = {
  functions: ["Develop React applications"],
  core: ["Build user interfaces with React and Next.js", "Participate in code reviews"],
  secondary: ["Write unit and integration tests"]
};
const qwenStyle = (requirementsList, title = "Frontend Engineer", duties = REACT_DUTIES) => {
  const normalized = normalizeJobProfile({
    job: { title, company: "Example Co", description: "" },
    requirements: { required: requirementsList.map((item) => ({ type: "skill", item, priority: "critical" })), preferred: [] },
    experience: { minimumYears: 3, requiredFunctions: duties.functions },
    responsibilities: { core: duties.core, secondary: duties.secondary },
    qualifications: ["Degree in Computer Science or equivalent experience"],
    languages: [{ language: "English", level: "C1", required: true, evidence: "Fluent English" }],
    workAuthorization: { required: false, eu: false },
    location: { type: "remote", city: null, country: null, remoteScope: "worldwide" }
  }, { title, company: "Example Co", location: "Remote", description: "Fully remote position available worldwide." });
  return scoreJob(candidate, { ...normalized, sourceInfo: makeJob().sourceInfo });
};

const ideal = qwenStyle([
  "Strong experience with React and TypeScript",
  "Proficiency in Next.js",
  "Solid knowledge of HTML and CSS",
  "Experience with testing (Vitest or Jest)"
]);
assert.equal(ideal.breakdown.technical, 100);
assert.equal(ideal.decision, "APPLY", "a matching job with every gate passing reaches APPLY");

const vueJob = qwenStyle([
  "Very good knowledge of Vue.js and Nuxt",
  "Strong experience with Vue 3 and Pinia"
], "Frontend Developer", {
  functions: ["Develop Vue.js applications"],
  core: ["Build user interfaces with Vue.js and Nuxt", "Maintain the Vuex/Pinia store"],
  secondary: []
});
assert.equal(vueJob.breakdown.technical, 0);
assert.equal(vueJob.decision, "SKIP", "a Vue job is not recommended to a React candidate");

const backendJob = qwenStyle([
  "Java 11+, Spring Boot and microservices",
  "Experience with React"
], "Full Stack Developer", {
  functions: ["Develop Java backend services"],
  core: ["Design microservices with Spring Boot", "Build React screens"],
  secondary: []
});
assert.ok(backendJob.breakdown.technical <= 50);
assert.notEqual(backendJob.decision, "APPLY", "full-stack Java roles are never auto-APPLY");

console.log("PASS: requirement-sentence matching regression checks passed (offline).");
