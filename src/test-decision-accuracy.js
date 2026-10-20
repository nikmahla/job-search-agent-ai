// Offline decision-accuracy regression suite.
// Realistic GOOD / BORDERLINE / BAD jobs for the candidate, run through the real
// deterministic stages (title filter, remote/hybrid detection, pre-ranker, the
// extractor's normaliser fed Qwen-style output, and the scorer). Each expected
// verdict was written from the job's facts before running the engine.
import assert from "node:assert/strict";
import { scoreJob } from "./job-scorer.js";
import { normalizeJobProfile } from "./build-job-profile.js";
import { filterJob } from "./job-filter.js";
import { preRankJob, analyzeYearsRequirements } from "./job-pre-ranker.js";
import { isRemote, isHybrid } from "./job-source-rules.js";
import { namesNonJsBackend } from "./tech-lexicon.js";

const candidate = {
  candidate: { experienceYears: 4, location: { acceptedCities: ["Alicante", "Valencia"] }, workAuthorization: { eu: true },
    languages: [{ language: "English", level: "C1" }, { language: "Spanish", level: "B1" }] },
  professionalProfile: { targetRoles: ["Frontend Developer", "Frontend Engineer", "React Developer", "Next.js Developer"] },
  skills: { primary: ["React", "Next.js", "TypeScript", "JavaScript", "Next.js App Router"],
    secondary: ["HTML", "CSS", "Redux Toolkit", "Zustand", "React Query", "REST APIs", "JWT Authentication", "Tailwind CSS", "Material UI"],
    testing: ["Vitest", "React Testing Library", "Unit Testing", "Integration Testing"],
    performance: ["SSR", "SSG", "Lazy Loading", "Code Splitting", "Frontend Performance Optimization", "Memoization"],
    tools: ["Git", "GitHub", "Vercel", "Cursor", "GitHub Copilot"],
    practices: ["Agile", "Code Review", "Responsive Design", "Accessibility", "WCAG", "Design System Principles"] },
  experience: [{ role: "React & Next.js Developer", functions: ["Frontend development", "React development", "Next.js development", "REST API integration", "Authentication", "Performance optimization", "Testing", "Agile development", "Code review"] }],
  education: [{ degree: "B.Sc. Computer Science" }, { degree: "M.Sc. Computer Engineering (Software)" }],
  atsKeywords: ["Frontend Developer", "React", "Next.js", "TypeScript", "JavaScript", "HTML", "CSS"]
};

async function evaluate(s) {
  const r = s.raw;
  const adzunaShape = { title: r.title, description: r.description, location: { display_name: r.location }, company: { display_name: r.company } };
  const remote = r.remote ?? isRemote(adzunaShape);
  const hybrid = r.hybrid ?? isHybrid(adzunaShape);
  const job = { id: s.id, source: r.source ?? "adzuna", ...r, remote, hybrid, created: new Date().toISOString() };
  const filter = filterJob(job);
  const pre = preRankJob(job).preRank;
  const extracted = { job: { title: r.title, company: r.company, description: r.description }, workAuthorization: { required: false, eu: false }, ...s.ext };
  const profile = normalizeJobProfile(extracted, { title: r.title, company: r.company, location: r.location, description: r.description });
  profile.job = { ...profile.job, title: r.title, company: r.company, description: r.description };
  profile.sourceInfo = { id: s.id, source: job.source, location: r.location, description: r.description, remote, hybrid,
    sourceCountry: r.sourceCountry, searchMode: r.searchMode, locationRestrictions: r.locationRestrictions ?? [], timezoneRestrictions: [] };
  const scored = scoreJob(candidate, profile);
  return { filter, pre, scored };
}

const R = (item, priority = "critical") => ({ type: "skill", item, priority });
const P = (item) => ({ type: "skill", item, priority: "preferred" });
const EN = (level, required = true) => ({ language: "English", level, required, evidence: "" });

const SCENARIOS = [
  // ---------------- clearly strong: APPLY ----------------
  { id: "A1", expect: "APPLY", why: "Alicante onsite React/Next.js role, skills match, 3y",
    raw: { title: "Frontend Developer (React / Next.js)", company: "Alicante Labs", location: "Alicante, Comunidad Valenciana", sourceCountry: "es", searchMode: "local",
      description: "Frontend developer at our office in Alicante. React, Next.js and TypeScript. Requirements: 3+ years of experience with React. Nice to have: Cypress." },
    ext: { requirements: { required: [R("Strong experience with React and TypeScript"), R("Next.js"), R("Solid knowledge of HTML/CSS"), R("Experience with REST APIs")], preferred: [P("Cypress"), P("GraphQL")] },
      experience: { minimumYears: 3, requiredFunctions: ["Develop React applications"] },
      responsibilities: { core: ["Build user interfaces with React and Next.js", "Write unit tests"], secondary: ["Participate in code reviews"] },
      qualifications: ["Degree in Computer Science or equivalent experience"], languages: [EN("B2")],
      location: { type: "onsite", city: "Alicante", country: "Spain", remoteScope: "unknown" } } },
  { id: "A2", expect: "APPLY", why: "Valencia hybrid React role, Redux Toolkit/Zustand, 2y, Spanish B1",
    raw: { title: "React Developer", company: "Valencia Apps", location: "Valencia, Comunidad Valenciana", sourceCountry: "es", searchMode: "local",
      description: "Hybrid role: 2 days per week in our Valencia office. React, Redux Toolkit and Zustand. 2+ years of experience." },
    ext: { requirements: { required: [R("React, Redux Toolkit and Zustand"), R("TypeScript"), R("Experience building responsive web applications")], preferred: [P("React Query")] },
      experience: { minimumYears: 2, requiredFunctions: [] },
      responsibilities: { core: ["Develop new features in React", "Maintain the state management layer with Redux Toolkit"], secondary: [] },
      qualifications: [], languages: [{ language: "Spanish", level: "B1", required: true, evidence: "" }, EN("B2")],
      location: { type: "hybrid", city: "Valencia", country: "Spain", remoteScope: "unknown" } } },
  { id: "A3", expect: "APPLY", why: "Remote within Spain, React/TS/testing, English C1+",
    raw: { title: "Front-End Engineer", company: "Iberia Soft", location: "España", sourceCountry: "es", searchMode: "remote",
      description: "100% remote position within Spain (remote within Spain). React.js and TypeScript, testing with Vitest or Jest." },
    ext: { requirements: { required: [R("Proficiency in React.js"), R("TypeScript"), R("Experience with testing (Vitest or Jest)")], preferred: [P("Storybook")] },
      experience: { minimumYears: 3, requiredFunctions: [] },
      responsibilities: { core: ["Build accessible UI components in React"], secondary: ["Write unit and integration tests"] },
      qualifications: [], languages: [EN("C1 or higher")],
      location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" } } },
  { id: "A4", expect: "APPLY", why: "Himalayas Remote: Europe, Next.js/React/TS/Tailwind, 4y",
    raw: { title: "Next.js Developer", company: "EuroRemote", location: "Remote: Europe", source: "himalayas", sourceCountry: "Europe", searchMode: "remote", remote: true, locationRestrictions: ["Europe"],
      description: "Fully remote. Next.js, React, TypeScript and Tailwind CSS. 4+ years of experience." },
    ext: { requirements: { required: [R("Next.js"), R("React"), R("TypeScript"), R("Tailwind CSS")], preferred: [P("Vercel")] },
      experience: { minimumYears: 4, requiredFunctions: [] },
      responsibilities: { core: ["Build pages with Next.js and server-side rendering"], secondary: [] },
      qualifications: [], languages: [EN("fluent")],
      location: { type: "remote", city: null, country: null, remoteScope: "europe" } } },
  { id: "A5", expect: "APPLY", why: "Senior frontend, no explicit years, remote across Europe stated",
    raw: { title: "Senior Frontend Engineer", company: "Berlin UI GmbH", location: "Berlin, Deutschland", sourceCountry: "de", searchMode: "remote",
      description: "Remote position open to candidates across Europe. Senior frontend engineer with strong React and TypeScript and a focus on accessibility." },
    ext: { requirements: { required: [R("Strong React and TypeScript skills"), R("Accessibility (WCAG)")], preferred: [P("Design systems")] },
      experience: { minimumYears: null, requiredFunctions: [] },
      responsibilities: { core: ["Own frontend features end to end with React"], secondary: ["Mentor other engineers"] },
      qualifications: [], languages: [EN("professional")],
      location: { type: "remote", city: null, country: "Germany", remoteScope: "europe" } } },

  // ---------------- borderline: MAYBE ----------------
  { id: "M1", expect: "MAYBE", why: "Good skills but UK remote without permission for Spain residents",
    raw: { title: "Frontend Developer", company: "London Web", location: "London, UK", sourceCountry: "gb", searchMode: "remote",
      description: "Remote position. React and TypeScript frontend developer." },
    ext: { requirements: { required: [R("React"), R("TypeScript")], preferred: [] }, experience: { minimumYears: 2, requiredFunctions: [] },
      responsibilities: { core: ["Build React features"], secondary: [] }, qualifications: [], languages: [EN("C1")],
      location: { type: "remote", city: "London", country: "United Kingdom", remoteScope: "unknown" } } },
  { id: "M2", expect: "MAYBE", why: "Full-stack React + Node.js + PostgreSQL, Spain remote: partial skill gap",
    raw: { title: "Full Stack Developer (React / Node.js)", company: "Madrid Stack", location: "España", sourceCountry: "es", searchMode: "remote",
      description: "Remote within Spain. React, Node.js and PostgreSQL." },
    ext: { requirements: { required: [R("React"), R("Node.js"), R("TypeScript"), R("PostgreSQL")], preferred: [] }, experience: { minimumYears: 3, requiredFunctions: [] },
      responsibilities: { core: ["Build React UIs", "Build Node.js APIs"], secondary: [] }, qualifications: [], languages: [EN("B2")],
      location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" } } },
  { id: "M3", expect: "MAYBE", why: "Alicante React role but Spanish C1 required (candidate B1)",
    raw: { title: "Desarrollador Frontend React", company: "Alicante Digital", location: "Alicante", sourceCountry: "es", searchMode: "local",
      description: "Puesto presencial en Alicante. React y TypeScript. Español nivel C1." },
    ext: { requirements: { required: [R("Experiencia con React y TypeScript"), R("HTML y CSS")], preferred: [] }, experience: { minimumYears: 2, requiredFunctions: [] },
      responsibilities: { core: ["Desarrollar interfaces con React"], secondary: [] }, qualifications: [],
      languages: [{ language: "Español", level: "C1", required: true, evidence: "" }],
      location: { type: "onsite", city: "Alicante", country: "Spain", remoteScope: "unknown" } } },
  { id: "M4", expect: "MAYBE", why: "Frontend role, React OK but several required gaps (GraphQL, Angular migration)",
    raw: { title: "Frontend Engineer", company: "Gap Co", location: "España", sourceCountry: "es", searchMode: "remote",
      description: "Remote within Spain. React, GraphQL and an Angular legacy app." },
    ext: { requirements: { required: [R("React"), R("TypeScript"), R("GraphQL"), R("Angular")], preferred: [] }, experience: { minimumYears: 3, requiredFunctions: [] },
      responsibilities: { core: ["Build React features", "Maintain Angular legacy app"], secondary: [] }, qualifications: [], languages: [EN("B2")],
      location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" } } },
  { id: "M5", expect: "MAYBE", why: "LLM put minimumYears 5 but the posting says 5+ years is PREFERRED: must not auto-reject",
    raw: { title: "Frontend Developer", company: "Pref Years", location: "España", sourceCountry: "es", searchMode: "remote",
      description: "Remote within Spain. React and TypeScript. 3+ years of experience required. 5+ years of experience preferred." },
    ext: { requirements: { required: [R("React"), R("TypeScript")], preferred: [] }, experience: { minimumYears: 5, requiredFunctions: [] },
      responsibilities: { core: ["Build React features"], secondary: [] }, qualifications: [], languages: [EN("B2")],
      location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" } } },

  // ---------------- clearly unsuitable: SKIP ----------------
  { id: "S1", expect: "SKIP", why: "Backend Java role that mentions React: not a frontend role, major skill gap",
    raw: { title: "Senior Java Engineer (React)", company: "Bank Corp", location: "España", sourceCountry: "es", searchMode: "remote",
      description: "Remote within Spain. Java 17, Spring Boot, microservices; React used by our frontend team." },
    ext: { requirements: { required: [R("Java 17"), R("Spring Boot"), R("Microservices architecture"), R("React")], preferred: [P("Kafka")] }, experience: { minimumYears: 4, requiredFunctions: [] },
      responsibilities: { core: ["Design Java microservices", "Maintain Spring Boot services"], secondary: ["Occasionally fix React screens"] }, qualifications: [], languages: [EN("B2")],
      location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" } } },
  { id: "S2", expect: "SKIP", why: "Vue/Nuxt role",
    raw: { title: "Frontend Developer", company: "Vue Shop", location: "España", sourceCountry: "es", searchMode: "remote",
      description: "Remote within Spain. Vue 3, Nuxt and Pinia." },
    ext: { requirements: { required: [R("Vue 3"), R("Nuxt"), R("Pinia")], preferred: [] }, experience: { minimumYears: 3, requiredFunctions: [] },
      responsibilities: { core: ["Build Vue.js components"], secondary: [] }, qualifications: [], languages: [EN("B2")],
      location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" } } },
  { id: "S3", expect: "SKIP", why: "'available worldwide' but UK residents only",
    raw: { title: "React Developer", company: "UK Only", location: "Remote", sourceCountry: "gb", searchMode: "remote",
      description: "Fully remote position available worldwide. UK residents only. React and TypeScript." },
    ext: { requirements: { required: [R("React"), R("TypeScript")], preferred: [] }, experience: { minimumYears: 2, requiredFunctions: [] },
      responsibilities: { core: ["Build React features"], secondary: [] }, qualifications: [], languages: [EN("C1")],
      location: { type: "remote", city: null, country: "United Kingdom", remoteScope: "worldwide" } } },
  { id: "S4", expect: "SKIP", why: "Lead title (rejected seniority)",
    raw: { title: "Lead Frontend Engineer", company: "Leadership", location: "España", sourceCountry: "es", searchMode: "remote",
      description: "Remote within Spain. Lead a team of React engineers." },
    ext: { requirements: { required: [R("React"), R("TypeScript")], preferred: [] }, experience: { minimumYears: 4, requiredFunctions: [] },
      responsibilities: { core: ["Lead the React team"], secondary: [] }, qualifications: [], languages: [EN("C1")],
      location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" } } },
  { id: "S5", expect: "SKIP", why: "Explicit 6+ years required",
    raw: { title: "Senior React Developer", company: "Six Years", location: "España", sourceCountry: "es", searchMode: "remote",
      description: "Remote within Spain. Minimum 6 years of professional experience with React is required." },
    ext: { requirements: { required: [R("React"), R("TypeScript")], preferred: [] }, experience: { minimumYears: 6, requiredFunctions: [] },
      responsibilities: { core: ["Build React features"], secondary: [] }, qualifications: [], languages: [EN("C1")],
      location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" } } },
  { id: "S6", expect: "SKIP", why: "Onsite in Madrid",
    raw: { title: "Frontend Developer", company: "Madrid Office", location: "Madrid, España", sourceCountry: "es", searchMode: "local",
      description: "On-site role in our Madrid office. React and TypeScript." },
    ext: { requirements: { required: [R("React"), R("TypeScript")], preferred: [] }, experience: { minimumYears: 2, requiredFunctions: [] },
      responsibilities: { core: ["Build React features"], secondary: [] }, qualifications: [], languages: [EN("B2")],
      location: { type: "onsite", city: "Madrid", country: "Spain", remoteScope: "unknown" } } },
  { id: "S7", expect: "SKIP", why: "Valencia onsite only",
    raw: { title: "React Developer", company: "Valencia Onsite", location: "Valencia", sourceCountry: "es", searchMode: "local",
      description: "On-site position in Valencia, 5 days in the office. React." },
    ext: { requirements: { required: [R("React")], preferred: [] }, experience: { minimumYears: 2, requiredFunctions: [] },
      responsibilities: { core: ["Build React features"], secondary: [] }, qualifications: [], languages: [EN("B2")],
      location: { type: "onsite", city: "Valencia", country: "Spain", remoteScope: "unknown" } } },
  { id: "S8", expect: "SKIP", why: "German C1 required, candidate has no German",
    raw: { title: "Frontend Developer", company: "DACH Remote", location: "Remote", sourceCountry: "de", searchMode: "remote",
      description: "Remote across Europe. React and TypeScript. Fließend Deutsch (C1) erforderlich." },
    ext: { requirements: { required: [R("React"), R("TypeScript")], preferred: [] }, experience: { minimumYears: 2, requiredFunctions: [] },
      responsibilities: { core: ["Build React features"], secondary: [] }, qualifications: [],
      languages: [{ language: "Deutsch", level: "C1", required: true, evidence: "Fließend Deutsch" }, EN("B2")],
      location: { type: "remote", city: null, country: "Germany", remoteScope: "europe" } } }
];

const remoteES = (title, description, req, extra = {}) => ({
  raw: { title, company: "Edge Co", location: "España", sourceCountry: "es", searchMode: "remote", description, ...extra.raw },
  ext: { requirements: { required: req.map((x) => typeof x === "string" ? R(x) : x), preferred: extra.preferred ?? [] },
    experience: { minimumYears: extra.years ?? 3, requiredFunctions: [] },
    responsibilities: { core: extra.resp ?? ["Build React features"], secondary: [] }, qualifications: [],
    languages: extra.languages ?? [EN("B2")], location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" } }
});
const EDGE = [
  ["E1", "SKIP", "Java Engineer - React (no parentheses)", remoteES("Java Engineer - React", "Remote within Spain. Java, Spring Boot; React for internal tools.", ["Java", "Spring Boot", "React"], { resp: ["Build Spring Boot services"] })],
  ["E2", "SKIP", "Backend software engineer, frontend only preferred", remoteES("Software Engineer (Backend)", "Remote within Spain. Go and Kubernetes. React used by our frontend team.", ["Go (Golang)", "Kubernetes", "PostgreSQL"], { preferred: [P("Frontend experience")], resp: ["Build Go services"] })],
  ["E3", "APPLY", "2+ years, perfect frontend match", remoteES("React Developer", "Remote within Spain. 2+ years of experience with React.", ["React", "TypeScript"], { years: 2 })],
  ["E4", "SKIP", "5+ years required", remoteES("Frontend Developer", "Remote within Spain. 5+ years of experience required.", ["React"], { years: 5 })],
  ["E5", "APPLY", "remote job mentioning hybrid cloud", remoteES("Frontend Engineer", "Remote within Spain. Build the React UI of our hybrid cloud platform.", ["React", "TypeScript"])],
  ["E6", "SKIP", "Remote Sensing title, onsite Berlin", { raw: { title: "Remote Sensing Frontend Engineer", company: "Geo", location: "Berlin, Deutschland", sourceCountry: "de", searchMode: "remote", description: "On-site in Berlin. React for satellite imagery." },
    ext: { requirements: { required: [R("React")], preferred: [] }, experience: { minimumYears: 2, requiredFunctions: [] }, responsibilities: { core: ["Build React maps"], secondary: [] }, qualifications: [], languages: [EN("B2")], location: { type: "onsite", city: "Berlin", country: "Germany", remoteScope: "unknown" } } }],
  ["E7", "MAYBE", "UK remote, only 'customers worldwide'", { raw: { title: "Frontend Developer", company: "UK Co", location: "London, UK", sourceCountry: "gb", searchMode: "remote", description: "Remote position. We serve customers worldwide. React." },
    ext: { requirements: { required: [R("React")], preferred: [] }, experience: { minimumYears: 2, requiredFunctions: [] }, responsibilities: { core: ["Build React features"], secondary: [] }, qualifications: [], languages: [EN("C1")], location: { type: "remote", city: "London", country: "United Kingdom", remoteScope: "unknown" } } }],
  ["E8", "MAYBE", "conflicting: remote within Spain + must be based in Germany", remoteES("Frontend Developer", "Remote within Spain. Must be based in Germany for payroll.", ["React", "TypeScript"])],
  ["E9", "APPLY", "Himalayas worldwide with explicit work-from-anywhere", { raw: { title: "Frontend Engineer", company: "Anywhere", location: "Remote: Worldwide", source: "himalayas", sourceCountry: "remote", searchMode: "remote", remote: true, locationRestrictions: [], description: "Fully remote. Work from anywhere. React and TypeScript." },
    ext: { requirements: { required: [R("React"), R("TypeScript")], preferred: [] }, experience: { minimumYears: 3, requiredFunctions: [] }, responsibilities: { core: ["Build React features"], secondary: [] }, qualifications: [], languages: [EN("C1")], location: { type: "remote", city: null, country: null, remoteScope: "worldwide" } } }],
  ["E10", "APPLY", "Spanish posting, Inglés avanzado", remoteES("Desarrollador/a Frontend", "100% remoto desde España. React y TypeScript. Inglés avanzado.", ["Experiencia sólida con React y TypeScript"], { languages: [{ language: "Inglés", level: "avanzado", required: true, evidence: "" }], resp: ["Desarrollar interfaces con React"] })],
  ["E11", "MAYBE", "required GraphQL + AWS gaps, React ok, preferred gaps should not dominate", remoteES("Frontend Developer", "Remote within Spain.", ["React", "GraphQL", "AWS"], { preferred: [P("Cypress"), P("Storybook"), P("Figma")] })],
  ["E12", "APPLY", "only preferred gaps (should not behave like mandatory)", remoteES("Frontend Developer", "Remote within Spain.", ["React", "TypeScript", "HTML/CSS"], { preferred: [P("GraphQL"), P("Cypress"), P("Storybook")] })],
  ["E13", "SKIP", "React Native role", remoteES("React Native Developer", "Remote within Spain. React Native mobile apps.", ["React Native", "TypeScript"])],
  ["E14", "MAYBE", "senior Next.js, LLM says 5 years but posting says 'ideally 5+ years'", remoteES("Senior Next.js Developer", "Remote within Spain. Next.js and React. Ideally 5+ years of experience.", ["Next.js", "React"], { years: 5 })],
];

const run = async (id, scenario) => evaluate({ id, ...scenario });

// 1. Core scenarios: 5 APPLY, 5 MAYBE, 8 SKIP.
for (const scenario of SCENARIOS) {
  const { scored } = await evaluate(scenario);
  assert.equal(scored.decision, scenario.expect, `${scenario.id} (${scenario.why}): ${scored.decisionReasons.join(" | ")}`);
  assert.ok(scored.decisionReasons.length > 0, `${scenario.id} explains its verdict`);
}

// 2. Edge cases from the false-positive and consistency checklist.
for (const [id, expect, why, scenario] of EDGE) {
  const { scored } = await run(id, scenario);
  assert.equal(scored.decision, expect, `${id} (${why}): ${scored.decisionReasons.join(" | ")}`);
}

// 3. Required-skill coverage: the weighted average alone must not decide.
const R2 = (item) => ({ type: "skill", item, priority: "critical" });
const gapJob = (required) => ({
  raw: { title: "Frontend Developer", company: "Gap", location: "España", sourceCountry: "es", searchMode: "remote", description: "Remote within Spain." },
  ext: { requirements: { required: required.map(R2), preferred: [] }, experience: { minimumYears: 3, requiredFunctions: ["Frontend development"] },
    responsibilities: { core: ["Build user interfaces", "Participate in code reviews"], secondary: [] },
    qualifications: ["Degree in Computer Science"], languages: [{ language: "English", level: "B2", required: true }],
    location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" } }
});
{
  const { scored } = await run("gap1", gapJob(["React", "GraphQL", "AWS"]));
  assert.ok(scored.jobFitScore >= 75, "the weighted average alone would have said APPLY");
  assert.equal(scored.decision, "MAYBE", "two of three required skills missing is not APPLY");
  assert.match(scored.decisionReasons.join(" "), /required technical skills are covered/);
}
{
  const { scored } = await run("gap2", gapJob(["React", "Angular", "GraphQL", "AWS"]));
  assert.equal(scored.decision, "MAYBE");
}
{
  const { scored } = await run("gap3", gapJob(["Angular", "RxJS", "NgRx"]));
  assert.equal(scored.decision, "SKIP", "none of the required skills is a SKIP even with a frontend title");
  assert.match(scored.decisionReasons[0], /None of the 3 required technical skills/);
}
{
  // A single unmatched required skill is not enough evidence for the SKIP guard.
  const { scored } = await run("gap4", gapJob(["Angular"]));
  assert.notEqual(scored.decisionReasons[0], "None of the 1 required technical skills is supported by the profile.");
}

// 4. Explanations: matched, missing required, missing preferred, failed gate, verdict.
{
  const { scored } = await run("explain", remoteES("Frontend Developer", "Remote within Spain.", ["React and PostgreSQL", "TypeScript"],
    { preferred: [P("GraphQL"), P("Storybook")] }));
  assert.deepEqual(scored.missingRequiredSkills, ["PostgreSQL"]);
  assert.deepEqual(scored.missingPreferredSkills, ["GraphQL", "Storybook"]);
  assert.ok(!scored.missingRequiredSkills.includes("GraphQL"), "a preferred gap is never reported as required");
  const reactLine = scored.requirementMatches.find((match) => match.item === "React and PostgreSQL");
  assert.deepEqual(reactLine.matched, ["React"]);
  assert.equal(reactLine.required, true);
}
{
  const { scored } = await evaluate(SCENARIOS.find((scenario) => scenario.id === "S3"));
  assert.match(scored.decisionReasons[0], /^Location gate failed: .*outside Spain/);
}
{
  const { scored } = await evaluate(SCENARIOS.find((scenario) => scenario.id === "M1"));
  assert.match(scored.decisionReasons.join(" "), /Location needs review \(FLAG\)/);
}
{
  const { scored } = await evaluate(SCENARIOS.find((scenario) => scenario.id === "A1"));
  assert.match(scored.decisionReasons[0], /every eligibility gate confirmed/);
}

// 5. Remote detection: permission statements are remote statements.
const remoteText = (description) => isRemote({ title: "Frontend Developer", description, location: { display_name: "España" } });
for (const text of ["Remote within Spain.", "Remote across Europe.", "Full remote, React.", "100% remoto desde España.",
  "Remote from anywhere in the EU.", "Remote only.", "Work from anywhere."]) {
  assert.equal(remoteText(text), true, text);
}
for (const text of ["This is not a remote position.", "On-site in Madrid.", "Remote sensing analysis with React.", "We serve customers worldwide."]) {
  assert.equal(remoteText(text), false, text);
}

// 6. Years: only an explicitly required 5+ rejects; preferred 5+ is a review flag.
assert.deepEqual(analyzeYearsRequirements("3+ years of experience required. 5+ years of experience preferred."), { requiredMinimum: 3, optionalYears: [5] });
assert.deepEqual(analyzeYearsRequirements("Minimum 6 years of experience."), { requiredMinimum: 6, optionalYears: [] });
assert.deepEqual(analyzeYearsRequirements("Ideally 5+ years of experience."), { requiredMinimum: null, optionalYears: [5] });
assert.deepEqual(analyzeYearsRequirements("We have 20 years of experience as a company."), { requiredMinimum: null, optionalYears: [] });

// 7. Backend titles that mention React are not frontend roles, in any stage.
assert.equal(namesNonJsBackend("Senior Java Engineer (React)"), true);
assert.equal(namesNonJsBackend("Full Stack Developer (React/Node.js)"), false, "Node.js is a JavaScript backend");
const preScore = (title) => preRankJob({ title, description: "React", location: "España", remote: true, sourceCountry: "es", created: new Date().toISOString() }).preRank.score;
assert.ok(preScore("Senior Java Engineer (React)") < preScore("Frontend Developer"));
assert.ok(preScore("Java Engineer - React") < preScore("React Developer"));
for (const id of ["E1", "S1"]) {
  const scenario = id === "S1" ? SCENARIOS.find((s) => s.id === "S1") : { id, ...EDGE.find(([edgeId]) => edgeId === id)[3] };
  const { scored } = await evaluate(scenario);
  assert.equal(scored.gates.roleFit.status, "FLAG", `${id} role fit`);
  assert.equal(scored.breakdown.career, 50, `${id} is not a frontend career step`);
}

console.log(`PASS: decision accuracy checks passed (${SCENARIOS.length} core + ${EDGE.length} edge scenarios, offline).`);
