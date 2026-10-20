import assert from "node:assert/strict";
import { scoreJob, classifyRequirement } from "./job-scorer.js";
import { normalizeJobProfile } from "./build-job-profile.js";

const candidate = {
  candidate: {
    experienceYears: 4,
    location: { acceptedCities: ["Alicante", "Valencia"] },
    workAuthorization: { eu: true },
    languages: [
      { language: "English", level: "C1" },
      { language: "Spanish", level: "B1" }
    ]
  },
  professionalProfile: {
    targetRoles: ["Frontend Developer", "Frontend Engineer", "React Developer", "Next.js Developer"]
  },
  skills: {
    primary: ["React", "Next.js", "TypeScript", "JavaScript"],
    secondary: ["HTML", "CSS", "REST APIs", "Redux Toolkit", "Tailwind CSS"],
    testing: ["Vitest", "React Testing Library"]
  },
  experience: [{
    role: "React & Next.js Developer",
    functions: ["Frontend development", "React development", "Next.js development", "REST API integration", "Testing"]
  }],
  atsKeywords: ["Frontend Developer", "React", "Next.js", "TypeScript", "JavaScript"]
};

function makeJob(overrides = {}) {
  return {
    extraction: {
      status: "complete",
      fields: {},
      warnings: []
    },
    job: {
      title: "Frontend Developer",
      company: "Example Co",
      description: "Develop frontend applications using React, Next.js, TypeScript and JavaScript. Work with REST APIs and write frontend tests."
    },
    requirements: {
      required: ["React", "Next.js", "TypeScript", "JavaScript"],
      preferred: ["REST APIs"]
    },
    experience: { minimumYears: 3, requiredFunctions: ["Frontend development", "React development"] },
    responsibilities: { core: ["Develop frontend applications", "Build reusable UI components"], secondary: ["Write frontend tests"] },
    qualifications: ["React development", "TypeScript"],
    languages: [],
    workAuthorization: { required: false, eu: false },
    location: { type: "remote", city: null, country: null, remoteScope: "worldwide" },
    sourceInfo: {
      location: "Remote",
      description: "This is a fully remote position available worldwide. Develop frontend applications using React, Next.js and TypeScript.",
      searchMode: "remote",
      sourceCountry: "es",
      remote: true,
      hybrid: false
    },
    ...overrides
  };
}

function makeNormalizedProfile(overrides = {}) {
  return {
    job: {
      title: "Model Title",
      company: "Model Company",
      description: "Model description.",
      ...overrides.job
    },
    requirements: { required: [], preferred: [] },
    experience: { minimumYears: null, requiredFunctions: [] },
    responsibilities: { core: [], secondary: [] },
    qualifications: [],
    languages: [],
    workAuthorization: { required: false, eu: false },
    location: {
      type: "unknown",
      city: null,
      country: null,
      remoteScope: "unknown"
    },
    ...overrides
  };
}

const normalizedSparseProfile = normalizeJobProfile(
  {
    job: {
      title: "Frontend Developer",
      company: "Sparse Co",
      description: "Frontend development role."
    },
    requirements: { required: [], preferred: [] },
    experience: { minimumYears: null, requiredFunctions: [] },
    responsibilities: { core: [], secondary: [] },
    qualifications: [],
    languages: [],
    workAuthorization: { required: false, eu: false },
    location: {
      type: "unknown",
      city: null,
      country: null,
      remoteScope: "unknown"
    }
  },
  {
    title: "Frontend Developer",
    company: "Sparse Co",
    description: "Frontend development role."
  }
);
assert.equal(normalizedSparseProfile.extraction.status, "complete");
assert.equal(normalizedSparseProfile.extraction.fields.qualifications, "empty");
assert.equal(normalizedSparseProfile.extraction.fields.languages, "empty");
assert.equal(normalizedSparseProfile.extraction.fields["experience.minimumYears"], "null");
assert.equal(normalizedSparseProfile.extraction.fields["location.remoteScope"], "unknown");

const sourceFallbackProfile = normalizeJobProfile(
  makeNormalizedProfile({ job: {} }),
  {
    title: "Raw Frontend Developer",
    company: "Raw Company",
    description: "Raw description."
  }
);
assert.equal(sourceFallbackProfile.job.title, "Raw Frontend Developer");
assert.equal(sourceFallbackProfile.job.company, "Raw Company");
assert.equal(sourceFallbackProfile.job.description, "Raw description.");
assert.equal(sourceFallbackProfile.extraction.fields["job.title"], "source-fallback");
assert.equal(sourceFallbackProfile.extraction.fields["job.company"], "source-fallback");
assert.equal(sourceFallbackProfile.extraction.fields["job.description"], "source-fallback");

const emptyModelFallbackProfile = normalizeJobProfile(
  makeNormalizedProfile({
    job: {
      title: "",
      company: "Model Company",
      description: "Model description."
    }
  }),
  {
    title: "Raw Frontend Developer",
    company: "Raw Company",
    description: "Raw description."
  }
);
assert.equal(emptyModelFallbackProfile.job.title, "Raw Frontend Developer");
assert.equal(emptyModelFallbackProfile.extraction.fields["job.title"], "source-fallback");

const missingSourceProfile = normalizeJobProfile(
  makeNormalizedProfile({
    job: {
      company: "Model Company",
      description: "Model description."
    }
  }),
  {}
);
assert.equal(missingSourceProfile.job.title, "");
assert.equal(missingSourceProfile.extraction.fields["job.title"], "missing");
assert.equal(missingSourceProfile.extraction.status, "uncertain");
assert.ok(
  missingSourceProfile.extraction.warnings.some(
    (warning) =>
      warning.field === "job.title" &&
      warning.code === "MISSING_FIELD"
  )
);

for (const { key, value, rawValue } of [
  { key: "title", value: 123, rawValue: "Raw Frontend Developer" },
  { key: "company", value: false, rawValue: "Raw Company" },
  { key: "description", value: {}, rawValue: "Raw description." }
]) {
  const malformedProfile = normalizeJobProfile(
    makeNormalizedProfile({ job: { [key]: value } }),
    {
      title: "Raw Frontend Developer",
      company: "Raw Company",
      description: "Raw description."
    }
  );
  const field = `job.${key}`;

  assert.equal(malformedProfile.job[key], rawValue);
  assert.equal(malformedProfile.extraction.fields[field], "malformed");
  assert.equal(malformedProfile.extraction.status, "uncertain");
  assert.ok(
    malformedProfile.extraction.warnings.some(
      (warning) =>
        warning.field === field && warning.code === "MALFORMED_FIELD"
    )
  );
}

const malformedWithoutFallbackProfile = normalizeJobProfile(
  makeNormalizedProfile({ job: { company: true } }),
  {}
);
assert.equal(malformedWithoutFallbackProfile.job.company, "");
assert.equal(
  malformedWithoutFallbackProfile.extraction.fields["job.company"],
  "malformed"
);
assert.equal(malformedWithoutFallbackProfile.extraction.status, "uncertain");
assert.ok(
  malformedWithoutFallbackProfile.extraction.warnings.some(
    (warning) =>
      warning.field === "job.company" &&
      warning.code === "MALFORMED_FIELD"
  )
);

const missingSchemaField = normalizeJobProfile(
  {
    job: {
      title: "Frontend Developer",
      company: "Missing Field Co",
      description: "Frontend development role."
    },
    requirements: { required: [], preferred: [] },
    experience: { requiredFunctions: [] },
    responsibilities: { core: [], secondary: [] },
    qualifications: [],
    languages: [],
    workAuthorization: { required: false, eu: false },
    location: {
      type: "unknown",
      city: null,
      country: null,
      remoteScope: "unknown"
    }
  },
  {
    title: "Frontend Developer",
    company: "Missing Field Co",
    description: "Frontend development role."
  }
);
assert.equal(missingSchemaField.extraction.status, "uncertain");
assert.equal(missingSchemaField.extraction.fields["experience.minimumYears"], "missing");

const malformedFields = normalizeJobProfile(
  {
    job: {
      title: "Frontend Developer",
      company: "Malformed Co",
      description: "Frontend development role."
    },
    requirements: { required: "React", preferred: [] },
    experience: { minimumYears: null, requiredFunctions: [] },
    responsibilities: { core: "Build interfaces", secondary: [] },
    qualifications: [{}],
    languages: { language: "German", required: true },
    workAuthorization: { required: false, eu: false },
    location: {
      type: "unknown",
      city: null,
      country: null,
      remoteScope: "unknown"
    }
  },
  {
    title: "Frontend Developer",
    company: "Malformed Co",
    description: "Frontend development role."
  }
);
assert.equal(malformedFields.extraction.status, "uncertain");
assert.equal(malformedFields.extraction.fields.requirements, undefined);
assert.equal(malformedFields.extraction.fields["requirements.required"], "malformed");
assert.equal(malformedFields.extraction.fields["responsibilities.core"], "malformed");
assert.equal(malformedFields.extraction.fields.languages, "malformed");
assert.deepEqual(malformedFields.qualifications, []);
assert.equal(malformedFields.extraction.fields.qualifications, "present");
assert.ok(
  malformedFields.extraction.warnings.some(
    (warning) => warning.field === "qualifications[0]"
  )
);

const worldwide = scoreJob(candidate, makeJob({
  workAuthorization: { required: true, eu: true }
}));
assert.equal(worldwide.gates.location.status, "PASS");
assert.equal(worldwide.decision, "APPLY");
assert.ok(worldwide.scoringCoverage >= 45);
assert.ok(worldwide.jobFitScore >= 75);
assert.equal(worldwide.extraction.status, "complete");

const incompleteHighScore = scoreJob(candidate, makeJob({
  extraction: {
    status: "uncertain",
    fields: {
      "responsibilities.core": "missing",
      qualifications: "missing"
    },
    warnings: [
      { field: "responsibilities.core", code: "MISSING_FIELD" }
    ]
  },
  requirements: { required: ["React"], preferred: [] },
  experience: { minimumYears: 3 },
  responsibilities: { core: [], secondary: [] },
  qualifications: [],
  workAuthorization: { required: true, eu: true }
}));
assert.equal(incompleteHighScore.jobFitScore, 100);
assert.equal(incompleteHighScore.scoringCoverage, 65);
assert.equal(incompleteHighScore.decision, "MAYBE");

const missingExtractionMetadata = scoreJob(candidate, {
  ...makeJob({
    workAuthorization: { required: true, eu: true }
  }),
  extraction: undefined
});
assert.equal(missingExtractionMetadata.decision, "MAYBE");
assert.equal(missingExtractionMetadata.extraction.status, "uncertain");

const nextJsRole = scoreJob(candidate, makeJob({
  job: {
    title: "Next.js Developer",
    company: "Next Co",
    description: "Develop frontend applications using Next.js, React, TypeScript and JavaScript."
  },
  location: { type: "onsite", city: "Alicante", country: "Spain" },
  sourceInfo: {
    location: "Alicante, Provincia de Alicante",
    description: "Office-based frontend role in Alicante using Next.js, React and TypeScript.",
    searchMode: "local",
    sourceCountry: "es",
    remote: false,
    hybrid: false
  }
}));
assert.equal(nextJsRole.gates.roleFit.status, "PASS", "Next.js titles must be recognized after normalization");
assert.equal(nextJsRole.gates.location.status, "PASS");

const optionalLanguage = scoreJob(candidate, makeJob({
  languages: [{ language: "German", level: "B2", required: false }]
}));
assert.equal(optionalLanguage.gates.language.status, "PASS");
assert.notEqual(optionalLanguage.decision, "SKIP", "optional languages must not block a job");

const requiredLanguage = scoreJob(candidate, makeJob({
  languages: [{ language: "German", level: "B2", required: true }]
}));
assert.equal(requiredLanguage.gates.language.status, "FAIL");
assert.equal(requiredLanguage.decision, "SKIP", "missing required languages must still block a job");

const embeddedAtsKeyword = scoreJob(candidate, makeJob({
  job: {
    title: "Frontend Developer",
    company: "ATS Co",
    description: "Build reaction-based systems."
  },
  requirements: { required: [], preferred: [] },
  responsibilities: { core: [], secondary: [] },
  qualifications: []
}));
assert.ok(!embeddedAtsKeyword.ats.matchedKeywords.includes("react"), "React must not match reaction");

const punctuatedAtsKeywords = scoreJob(candidate, makeJob({
  job: {
    title: "Frontend Developer",
    company: "ATS Co",
    description: "Build React/TypeScript interfaces with Next.js."
  },
  requirements: { required: [], preferred: [] },
  responsibilities: { core: [], secondary: [] },
  qualifications: []
}));
assert.ok(punctuatedAtsKeywords.ats.matchedKeywords.includes("react"));
assert.ok(punctuatedAtsKeywords.ats.matchedKeywords.includes("typescript"));
assert.ok(punctuatedAtsKeywords.ats.matchedKeywords.includes("nextjs"));

for (const title of [
  "React Native Mobile Engineer",
  "React-Native Developer",
  "React (Native) Developer"
]) {
  const reactNativeRole = scoreJob(candidate, makeJob({
    job: {
      title,
      company: "Mobile Co",
      description: "Build React Native applications with React, Next.js and TypeScript."
    },
    workAuthorization: { required: true, eu: true }
  }));
  assert.equal(reactNativeRole.gates.roleFit.status, "FAIL", `${title} must not pass the frontend web role gate`);
  assert.equal(reactNativeRole.decision, "SKIP");
}

const unclearRemote = scoreJob(candidate, makeJob({
  location: { type: "remote", city: null, country: "United Kingdom", remoteScope: "unknown" },
  sourceInfo: {
    location: "London, Greater London",
    description: "This role is remote for our engineering team. Applicants should review location eligibility.",
    searchMode: "remote",
    sourceCountry: "gb",
    remote: true,
    hybrid: false
  }
}));
assert.equal(unclearRemote.gates.location.status, "FLAG");
assert.equal(unclearRemote.decision, "MAYBE", "uncertain location must never receive APPLY");

const inferredCountrySpecific = scoreJob(candidate, makeJob({
  location: { type: "remote", city: "London", country: "United Kingdom", remoteScope: "country-specific" },
  sourceInfo: {
    location: "London, Greater London",
    description: "Remote role for the UK engineering team. The posting does not state that UK residency is mandatory.",
    searchMode: "remote",
    sourceCountry: "gb",
    remote: true,
    hybrid: false
  }
}));
assert.equal(inferredCountrySpecific.gates.location.status, "FLAG", "LLM inference alone must not hard-reject country restrictions");
assert.equal(inferredCountrySpecific.decision, "MAYBE");

const ukRestricted = scoreJob(candidate, makeJob({
  location: { type: "remote", city: "London", country: "United Kingdom", remoteScope: "country-specific" },
  sourceInfo: {
    location: "London, Greater London",
    description: "This role is remote within the UK only. Applicants must reside in the UK.",
    searchMode: "remote",
    sourceCountry: "gb",
    remote: true,
    hybrid: false
  }
}));
assert.equal(ukRestricted.gates.location.status, "FAIL");
assert.equal(ukRestricted.decision, "SKIP");

const fullStackRole = scoreJob(candidate, makeJob({
  job: {
    title: "Full Stack Developer | Remote | React",
    company: "Full Stack Co",
    description: "Build frontend and backend features using React, Next.js and TypeScript. This is a fully remote position available worldwide."
  },
  sourceInfo: {
    location: "Remote",
    description: "Build frontend and backend features using React, Next.js and TypeScript. This is a fully remote position available worldwide.",
    searchMode: "remote",
    sourceCountry: "es",
    remote: true,
    hybrid: false
  }
}));
assert.equal(fullStackRole.gates.roleFit.status, "FLAG");
assert.equal(fullStackRole.decision, "MAYBE", "secondary full-stack roles require manual review, not automatic APPLY");

const nonLocalOffice = scoreJob(candidate, makeJob({
  location: { type: "hybrid", city: "Madrid", country: "Spain", remoteScope: "unknown" },
  sourceInfo: {
    location: "Madrid, Comunidad de Madrid",
    description: "Hybrid role with three days per week in the Madrid office.",
    searchMode: "local",
    sourceCountry: "es",
    remote: false,
    hybrid: true
  }
}));
assert.equal(nonLocalOffice.gates.location.status, "FAIL");
assert.equal(nonLocalOffice.decision, "SKIP");

const sourceOverridesLlm = scoreJob(candidate, makeJob({
  location: { type: "remote", city: "Valencia", country: "Spain", remoteScope: "worldwide" },
  sourceInfo: {
    location: "Berlin, Deutschland",
    description: "Office-based role in Berlin. No remote option is mentioned.",
    searchMode: "local",
    sourceCountry: "es",
    remote: false,
    hybrid: false
  }
}));
assert.equal(sourceOverridesLlm.gates.location.status, "FAIL", "LLM must not override source location facts");
assert.equal(sourceOverridesLlm.decision, "SKIP");

const sparseProfile = scoreJob(candidate, {
  extraction: {
    status: "complete",
    fields: {},
    warnings: []
  },
  job: { title: "Frontend Developer", company: "Sparse Co", description: "" },
  requirements: { required: [], preferred: [] },
  experience: {},
  responsibilities: { core: [], secondary: [] },
  qualifications: [],
  languages: [],
  workAuthorization: { required: false },
  location: { type: "onsite", city: "Alicante", country: "Spain" },
  sourceInfo: { location: "Alicante, Spain", description: "", remote: false, hybrid: false, searchMode: "local" }
});
assert.equal(sparseProfile.jobFitScore, null, "career title alone must not produce a numeric job-fit score");
assert.equal(sparseProfile.decision, "MAYBE");
assert.equal(sparseProfile.scoringCoverage, 15);

const twoDimensionsOnly = scoreJob(candidate, {
  extraction: {
    status: "complete",
    fields: {},
    warnings: []
  },
  job: { title: "Frontend Developer", company: "Partial Co", description: "" },
  requirements: { required: ["React"], preferred: [] },
  experience: { minimumYears: 3 },
  responsibilities: { core: [], secondary: [] },
  qualifications: [],
  languages: [],
  workAuthorization: { required: false },
  location: { type: "onsite", city: "Alicante", country: "Spain" },
  sourceInfo: { location: "Alicante, Spain", description: "", remote: false, hybrid: false, searchMode: "local" }
});
assert.equal(twoDimensionsOnly.scoringCoverage, 65);
assert.notEqual(twoDimensionsOnly.jobFitScore, null, "technical + experience + career coverage meets the minimum threshold");

// Seniority and explicit-years gates (scorer backstop).
for (const title of [
  "Lead Frontend Developer", "Tech Lead React", "Frontend Team Lead",
  "Principal Frontend Engineer", "Staff Frontend Engineer",
  "Frontend Intern", "Frontend Developer Internship"
]) {
  const result = scoreJob(candidate, makeJob({ job: { title, company: "X", description: "React" } }));
  assert.equal(result.gates.roleFit.status, "FAIL", `${title} role fit`);
  assert.equal(result.decision, "SKIP", `${title} decision`);
}
for (const title of ["Junior Frontend Developer", "Entry-level Frontend Developer", "Mid-level Frontend Developer", "Senior Frontend Developer", "Internal Tools Frontend Developer"]) {
  const result = scoreJob(candidate, makeJob({ job: { title, company: "X", description: "React" } }));
  assert.notEqual(result.gates.roleFit.status, "FAIL", `${title} must not fail role fit`);
}

const yearsDecision = (minimumYears) =>
  scoreJob(candidate, makeJob({ experience: { minimumYears, requiredFunctions: [] } }));
assert.equal(yearsDecision(4).gates.experience.status, "PASS");
assert.notEqual(yearsDecision(4).decision, "SKIP");
assert.equal(yearsDecision(5).gates.experience.status, "FAIL");
assert.equal(yearsDecision(5).decision, "SKIP");
assert.equal(yearsDecision(8).decision, "SKIP");
assert.equal(yearsDecision(null).gates.experience.status, "PASS");
assert.notEqual(yearsDecision(null).decision, "SKIP", "unknown years must not reject");
assert.equal(yearsDecision(undefined).gates.experience.status, "PASS");

// Short-skill and AI matching.
const aiCandidate = {
  ...candidate,
  skills: { ...candidate.skills, tools: ["GitHub Copilot", "Cursor"] },
  experience: [{
    ...candidate.experience[0],
    functions: [...candidate.experience[0].functions, "Maintain component libraries"]
  }]
};
const technicalFor = (profile, item) =>
  scoreJob(profile, makeJob({
    requirements: { required: [{ item, priority: "critical" }], preferred: [] }
  })).breakdown.technical;

assert.equal(technicalFor(candidate, "AI"), 0, "AI must not match tailwind/maintain substrings");
assert.equal(technicalFor(aiCandidate, "AI"), 50, "bare AI needs AI tool evidence and earns only partial credit");
assert.equal(technicalFor(candidate, "AI-assisted coding"), 0, "no evidence, no credit");
assert.equal(technicalFor(aiCandidate, "AI-assisted coding"), 90);
assert.equal(technicalFor(aiCandidate, "AI development tools"), 90);
assert.equal(technicalFor(aiCandidate, "AI/API integration"), 0, "REST/tool evidence must not stand in for LLM API integration");
assert.equal(technicalFor(aiCandidate, "LLM API integration"), 0);
// Unclassified AI requirements must not be credited through unrelated substrings.
const vercelCandidate = {
  ...aiCandidate,
  skills: { ...aiCandidate.skills, tools: [...aiCandidate.skills.tools, "Vercel"] }
};
assert.equal(technicalFor(vercelCandidate, "Vercel AI SDK"), 0, "Vercel hosting is not AI SDK evidence");
assert.equal(technicalFor(vercelCandidate, "AI-powered features"), 0);
assert.equal(technicalFor(vercelCandidate, "Vercel"), 100, "non-AI Vercel requirement is unaffected");

// Token-based skill matching: no character-substring false positives.
const skillCandidate = (skills, functions = []) => ({
  ...candidate,
  skills: { primary: skills },
  experience: [{ role: "Frontend Developer", functions }]
});
const matchProfile = skillCandidate(
  ["React", "Next.js", "Next.js App Router", "JavaScript", "Unit Testing", "Integration Testing", "WCAG",
    "Memoization", "React Testing Library", "Design System Principles", "JWT Authentication", "CSS", "Git", "GitHub", "Agile"],
  ["JWT authentication with refresh-token rotation"]
);
const matchFor = (item) => technicalFor(matchProfile, item);

const veevaRequirementSentences = [
  "Experience with React or another comparable JavaScript framework",
  "Deep understanding of front end technologies, such as JavaScript, HTML, and CSS",
  "Unit test and debugging skills"
];
const veevaRequirementsProfile = normalizeJobProfile(
  makeNormalizedProfile({
    requirements: {
      required: veevaRequirementSentences.map((item) => ({ type: "skill", item, priority: "critical" })),
      preferred: []
    }
  }),
  {}
);
assert.deepEqual(
  veevaRequirementsProfile.requirements.required.map(({ item }) => item),
  ["React", "JavaScript", "HTML", "CSS", "Unit Testing"]
);
for (const requirement of veevaRequirementsProfile.requirements.required) {
  assert.ok(veevaRequirementSentences.includes(requirement.sourceText));
}
const veevaMatchCandidate = skillCandidate(["React", "JavaScript", "HTML", "CSS", "Unit Testing"]);
for (const item of ["React", "JavaScript", "HTML", "CSS", "Unit Testing"]) {
  assert.equal(technicalFor(veevaMatchCandidate, item), 100);
}
const unrelatedFrameworkCandidate = {
  ...skillCandidate(["Angular", "Vue", "Python", "Django"]),
  professionalProfile: { targetRoles: [] },
  atsKeywords: []
};
assert.equal(
  scoreJob(unrelatedFrameworkCandidate, makeJob({ requirements: veevaRequirementsProfile.requirements })).breakdown.technical,
  0,
  "Angular, Vue, Python, and Django must not satisfy the extracted React/web skill requirements"
);
assert.equal(matchFor("React"), 100, "short React requirements continue to match");
assert.equal(technicalFor(skillCandidate(["Node.js"]), "Node.js"), 100, "short Node.js requirements continue to match");

// Valid matches are preserved.
assert.equal(matchFor("React"), 100);
assert.equal(matchFor("Next.js App Router"), 100);
assert.equal(matchFor("Next.js"), 100);
assert.equal(matchFor("Memoization"), 100);
assert.equal(matchFor("React Testing Library"), 100);
assert.equal(matchFor("WCAG"), 100);
assert.equal(matchFor("WCAG 2.1"), 50, "a version suffix keeps partial credit");
assert.equal(matchFor("React 18"), 50);
assert.equal(matchFor("JWT"), 50);
assert.equal(matchFor("Agile methodology"), 50);

// Generic fragments and character substrings no longer match.
assert.equal(matchFor("App"), 0, "App must not match Next.js App Router");
assert.equal(matchFor("Token"), 0, "Token must not match refresh-token rotation");
assert.equal(matchFor("Refresh Token"), 0);
assert.equal(matchFor("Java"), 0, "Java must not match JavaScript");
assert.equal(matchFor("Script"), 0);
assert.equal(matchFor("Test"), 50, "Test is the same word as Testing: half of Unit Testing");
assert.equal(technicalFor(skillCandidate(["Contest"]), "Test"), 0, "Test must not match inside another word");
assert.equal(matchFor("Design"), 0);
assert.equal(matchFor("System"), 0);

// Generic testing skills do not stand in for E2E testing.
assert.equal(matchFor("E2E testing"), 0);
assert.equal(matchFor("End-to-end testing"), 0);
assert.equal(matchFor("Cypress"), 0);
assert.equal(matchFor("Unit Testing"), 100);

// Singular/plural consistency.
assert.equal(matchFor("Design System"), 50);
assert.equal(matchFor("Design Systems"), 50);
assert.equal(technicalFor(skillCandidate(["Design System"]), "Design Systems"), 90);
assert.equal(technicalFor(skillCandidate(["Design Systems"]), "Design System"), 90);
assert.equal(technicalFor(skillCandidate(["REST APIs"]), "REST API"), 90);

// Individually evaluated phrases.
assert.equal(matchFor("React Hooks"), 50, "React Hooks is core React and keeps partial credit when React is listed");
assert.equal(technicalFor(skillCandidate(["Vue"]), "React Hooks"), 0, "no React evidence, no credit");
assert.equal(matchFor("CSS Modules"), 50, "CSS Modules keeps partial credit when CSS is listed");
assert.equal(technicalFor(skillCandidate(["HTML"]), "CSS Modules"), 0);
assert.equal(matchFor("React Native"), 0, "React Native is a different platform");
assert.equal(matchFor("GitHub Actions"), 0, "GitHub alone is not CI evidence");
assert.equal(technicalFor(skillCandidate(["GitHub", "GitHub Actions"]), "GitHub Actions"), 100);
assert.equal(technicalFor(skillCandidate(["Web Accessibility"]), "Accessibility"), 50);

// Spelling variants of the same skill.
assert.equal(technicalFor(skillCandidate(["Frontend Development"]), "Front-End Development"), 90, "Front-End must equal Frontend");
assert.equal(technicalFor(skillCandidate(["Frontend Development"]), "Front End Development"), 90);
assert.equal(technicalFor(skillCandidate(["Unit Testing"]), "Unit Test"), 90, "Unit Test must match Unit Testing");
assert.equal(technicalFor(skillCandidate(["Unit Testing"]), "Unit Tests"), 90);
// Plural qualifiers are recognised after folding.
assert.equal(technicalFor(skillCandidate(["Accessibility"]), "Accessibility principles"), 50);
assert.equal(technicalFor(skillCandidate(["Agile"]), "Agile practices"), 50);
assert.equal(technicalFor(skillCandidate(["Agile"]), "Agile methodologies"), 50);
const aiApiCandidate = {
  ...aiCandidate,
  experience: [{ role: "Developer", functions: ["OpenAI API integration"] }]
};
assert.equal(technicalFor(aiApiCandidate, "OpenAI API integration"), 100);
assert.equal(technicalFor(aiApiCandidate, "LLM API integration"), 90);
assert.equal(technicalFor(candidate, "Tailwind CSS"), 100, "existing exact matches are unchanged");
assert.equal(technicalFor(candidate, "React"), 100);

// Location eligibility tests
// 1. Alicante: onsite, hybrid, and remote are eligible.
const alicanteOnsite = scoreJob(candidate, makeJob({
  location: { type: "onsite", city: "Alicante", country: "Spain" },
  sourceInfo: { location: "Alicante, Spain", remote: false, hybrid: false, searchMode: "local" }
}));
assert.equal(alicanteOnsite.gates.location.status, "PASS");

const alicanteHybrid = scoreJob(candidate, makeJob({
  location: { type: "hybrid", city: "Alicante", country: "Spain" },
  sourceInfo: { location: "Alicante, Spain", remote: false, hybrid: true, searchMode: "local" }
}));
assert.equal(alicanteHybrid.gates.location.status, "PASS");

const alicanteRemote = scoreJob(candidate, makeJob({
  location: { type: "remote", city: "Alicante", country: "Spain" },
  sourceInfo: { location: "Alicante, Spain", remote: true, hybrid: false, searchMode: "local" }
}));
assert.equal(alicanteRemote.gates.location.status, "PASS");

// 2. Valencia: hybrid and remote are eligible; onsite is ineligible.
const valenciaOnsite = scoreJob(candidate, makeJob({
  location: { type: "onsite", city: "Valencia", country: "Spain" },
  sourceInfo: { location: "Valencia, Spain", remote: false, hybrid: false, searchMode: "local" }
}));
assert.equal(valenciaOnsite.gates.location.status, "FAIL");
assert.equal(valenciaOnsite.decision, "SKIP");

const valenciaHybrid = scoreJob(candidate, makeJob({
  location: { type: "hybrid", city: "Valencia", country: "Spain" },
  sourceInfo: { location: "Valencia, Spain", remote: false, hybrid: true, searchMode: "local" }
}));
assert.equal(valenciaHybrid.gates.location.status, "PASS");

const valenciaRemote = scoreJob(candidate, makeJob({
  location: { type: "remote", city: "Valencia", country: "Spain" },
  sourceInfo: { location: "Valencia, Spain", remote: true, hybrid: false, searchMode: "local" }
}));
assert.equal(valenciaRemote.gates.location.status, "PASS");

// 3. Remote jobs in other European countries (remote only)
const germanyRemote = scoreJob(candidate, makeJob({
  location: { type: "remote", country: "Germany", remoteScope: "europe" },
  sourceInfo: {
    location: "Berlin, Deutschland",
    description: "Fully remote position across Europe.",
    remote: true,
    hybrid: false,
    sourceCountry: "de",
    searchMode: "remote"
  }
}));
assert.equal(germanyRemote.gates.location.status, "PASS");

const germanyOnsite = scoreJob(candidate, makeJob({
  location: { type: "onsite", city: "Berlin", country: "Germany" },
  sourceInfo: { location: "Berlin, Deutschland", remote: false, hybrid: false, sourceCountry: "de", searchMode: "local" }
}));
assert.equal(germanyOnsite.gates.location.status, "FAIL");
assert.equal(germanyOnsite.decision, "SKIP");

const germanyHybrid = scoreJob(candidate, makeJob({
  location: { type: "hybrid", city: "Berlin", country: "Germany" },
  sourceInfo: { location: "Berlin, Deutschland", remote: false, hybrid: true, sourceCountry: "de", searchMode: "local" }
}));
assert.equal(germanyHybrid.gates.location.status, "FAIL");
assert.equal(germanyHybrid.decision, "SKIP");

// 4 & 5. UK and UAE remote jobs (remote only; onsite/hybrid rejected)
const ukWorldwideRemote = scoreJob(candidate, makeJob({
  location: { type: "remote", country: "United Kingdom", remoteScope: "worldwide" },
  sourceInfo: {
    location: "London, UK",
    description: "Fully remote role available worldwide.",
    remote: true,
    hybrid: false,
    sourceCountry: "gb",
    searchMode: "remote"
  }
}));
assert.equal(ukWorldwideRemote.gates.location.status, "PASS");

const ukOnsiteRole = scoreJob(candidate, makeJob({
  location: { type: "onsite", city: "London", country: "United Kingdom" },
  sourceInfo: { location: "London, UK", remote: false, hybrid: false, sourceCountry: "gb", searchMode: "local" }
}));
assert.equal(ukOnsiteRole.gates.location.status, "FAIL");
assert.equal(ukOnsiteRole.decision, "SKIP");

const ukHybridRole = scoreJob(candidate, makeJob({
  location: { type: "hybrid", city: "London", country: "United Kingdom" },
  sourceInfo: { location: "London, UK", remote: false, hybrid: true, sourceCountry: "gb", searchMode: "local" }
}));
assert.equal(ukHybridRole.gates.location.status, "FAIL");
assert.equal(ukHybridRole.decision, "SKIP");

const uaeWorldwideRemote = scoreJob(candidate, makeJob({
  location: { type: "remote", country: "United Arab Emirates", remoteScope: "worldwide" },
  sourceInfo: {
    location: "Dubai, United Arab Emirates",
    description: "Fully remote role open to candidates worldwide.",
    remote: true,
    hybrid: false,
    sourceCountry: "ae",
    searchMode: "remote"
  }
}));
assert.equal(uaeWorldwideRemote.gates.location.status, "PASS");

const uaeUnclearRemote = scoreJob(candidate, makeJob({
  location: { type: "remote", city: "Dubai", country: "United Arab Emirates", remoteScope: "unknown" },
  sourceInfo: {
    location: "Dubai, UAE",
    description: "Remote role for our Dubai tech hub.",
    remote: true,
    hybrid: false,
    sourceCountry: "ae",
    searchMode: "remote"
  }
}));
assert.equal(uaeUnclearRemote.gates.location.status, "FLAG");
assert.equal(uaeUnclearRemote.decision, "MAYBE");

const uaeRestrictedRemote = scoreJob(candidate, makeJob({
  location: { type: "remote", city: "Dubai", country: "United Arab Emirates", remoteScope: "country-specific" },
  sourceInfo: {
    location: "Dubai, UAE",
    description: "Remote position within the UAE only. Must reside in the UAE.",
    remote: true,
    hybrid: false,
    sourceCountry: "ae",
    searchMode: "remote"
  }
}));
assert.equal(uaeRestrictedRemote.gates.location.status, "FAIL");
assert.equal(uaeRestrictedRemote.decision, "SKIP");

const uaeOnsiteRole = scoreJob(candidate, makeJob({
  location: { type: "onsite", city: "Dubai", country: "United Arab Emirates" },
  sourceInfo: { location: "Dubai, UAE", remote: false, hybrid: false, sourceCountry: "ae", searchMode: "local" }
}));
assert.equal(uaeOnsiteRole.gates.location.status, "FAIL");
assert.equal(uaeOnsiteRole.decision, "SKIP");

const uaeHybridRole = scoreJob(candidate, makeJob({
  location: { type: "hybrid", city: "Dubai", country: "United Arab Emirates" },
  sourceInfo: { location: "Dubai, UAE", remote: false, hybrid: true, sourceCountry: "ae", searchMode: "local" }
}));
assert.equal(uaeHybridRole.gates.location.status, "FAIL");
assert.equal(uaeHybridRole.decision, "SKIP");

// 6. Unknown location and unknown work mode flagged for review (MAYBE, not PASS or FAIL)
const unknownLocationJob = scoreJob(candidate, makeJob({
  location: { type: "unknown", city: null, country: null },
  sourceInfo: { location: "unknown", description: "Frontend developer role", remote: false, hybrid: false }
}));
assert.equal(unknownLocationJob.gates.location.status, "UNKNOWN");
assert.equal(unknownLocationJob.decision, "MAYBE");

const valenciaUnknownWorkMode = scoreJob(candidate, makeJob({
  location: { type: "unknown", city: "Valencia", country: "Spain" },
  sourceInfo: { location: "Valencia, Spain", description: "Frontend developer position in Valencia office", remote: false, hybrid: false }
}));
assert.equal(valenciaUnknownWorkMode.gates.location.status, "UNKNOWN");
assert.equal(valenciaUnknownWorkMode.decision, "MAYBE");

// 7. Remote eligibility must come from job-specific evidence, not incidental
// "worldwide"/"Europe" mentions, and explicit restrictions must win.
const remoteLocationGate = (location, description, remoteScope = "unknown") => scoreJob(candidate, makeJob({
  workAuthorization: { required: true, eu: true },
  location: { type: "remote", city: null, country: null, remoteScope },
  sourceInfo: { location, description, remote: true, hybrid: false, searchMode: "remote" }
}));

const incidentalWorldwide = remoteLocationGate(
  "Remote: United States",
  "We serve customers worldwide. Remote, US residents."
);
assert.equal(incidentalWorldwide.gates.location.status, "FAIL", "US residents restriction must not be bypassed by 'worldwide'");
assert.equal(incidentalWorldwide.decision, "SKIP");

const incidentalEurope = remoteLocationGate(
  "Remote: United States",
  "Remote role for our US team with an office in Europe, work in Europe optional"
);
assert.notEqual(incidentalEurope.gates.location.status, "PASS", "an office in Europe is not remote eligibility");
assert.equal(incidentalEurope.gates.location.status, "FLAG");
assert.notEqual(incidentalEurope.decision, "APPLY");

const genericWorldwideCompany = remoteLocationGate(
  "Remote",
  "Our company has customers worldwide and a remote role open on the platform team."
);
assert.equal(genericWorldwideCompany.gates.location.status, "FLAG");
assert.notEqual(genericWorldwideCompany.decision, "APPLY");

const worldwideDoesNotOverrideRestriction = remoteLocationGate(
  "Remote",
  "Fully remote position available worldwide. UK residents only."
);
assert.equal(worldwideDoesNotOverrideRestriction.gates.location.status, "FAIL");

const europeDoesNotOverrideRestriction = remoteLocationGate(
  "Remote",
  "Fully remote position across Europe. Must be based in Germany."
);
assert.equal(europeDoesNotOverrideRestriction.gates.location.status, "FAIL");

const explicitSpainRemote = remoteLocationGate(
  "Remote",
  "Fully remote within Spain. Develop frontend applications using React."
);
assert.equal(explicitSpainRemote.gates.location.status, "PASS");
assert.equal(explicitSpainRemote.decision, "APPLY");

// 8. Work-authorization gate: an absent requirement passes only when it was
// explicitly extracted and the candidate has EU authorization.
const presentAuthorizationExtraction = {
  status: "complete",
  fields: { "workAuthorization.required": "present", "workAuthorization.eu": "present" },
  warnings: []
};
const candidateWithoutEu = {
  ...candidate,
  candidate: { ...candidate.candidate, workAuthorization: { eu: false } }
};
const authJob = (workAuthorization, extraction = presentAuthorizationExtraction) =>
  makeJob({ workAuthorization, extraction });

const noRequirementStated = scoreJob(candidate, authJob({ required: false, eu: false }));
assert.equal(noRequirementStated.gates.workAuthorization.status, "PASS");
assert.equal(noRequirementStated.decision, "APPLY");

const noRequirementCandidateWithoutEu = scoreJob(candidateWithoutEu, authJob({ required: false, eu: false }));
assert.equal(noRequirementCandidateWithoutEu.gates.workAuthorization.status, "UNKNOWN");
assert.equal(noRequirementCandidateWithoutEu.decision, "MAYBE");

const euRequirementWithEuCandidate = scoreJob(candidate, authJob({ required: true, eu: true }));
assert.equal(euRequirementWithEuCandidate.gates.workAuthorization.status, "PASS");
assert.equal(euRequirementWithEuCandidate.decision, "APPLY");

const euRequirementWithoutEuCandidate = scoreJob(candidateWithoutEu, authJob({ required: true, eu: true }));
assert.equal(euRequirementWithoutEuCandidate.gates.workAuthorization.status, "UNKNOWN");
assert.equal(euRequirementWithoutEuCandidate.decision, "MAYBE");

const nonEuRequirement = scoreJob(candidate, authJob({ required: true, eu: false }));
assert.equal(nonEuRequirement.gates.workAuthorization.status, "UNKNOWN", "non-EU authorization requirements must never PASS");
assert.equal(nonEuRequirement.decision, "MAYBE");

// Incomplete/uncertain extraction: the default `required: false` is not proof.
const uncertainExtraction = scoreJob(candidate, authJob(
  { required: false, eu: false },
  { status: "uncertain", fields: { "workAuthorization.required": "present" }, warnings: [{ field: "qualifications", code: "MISSING_FIELD" }] }
));
assert.equal(uncertainExtraction.gates.workAuthorization.status, "UNKNOWN");
assert.equal(uncertainExtraction.decision, "MAYBE");

const requiredFieldNotMarkedPresent = scoreJob(candidate, authJob(
  { required: false, eu: false },
  { status: "complete", fields: {}, warnings: [] }
));
assert.equal(requiredFieldNotMarkedPresent.gates.workAuthorization.status, "UNKNOWN");

const missingExtractionObject = scoreJob(candidate, { ...authJob({ required: false, eu: false }), extraction: undefined });
assert.equal(missingExtractionObject.gates.workAuthorization.status, "UNKNOWN");
assert.equal(missingExtractionObject.decision, "MAYBE");

// End to end through the real normalizer: absent, malformed and valid sections.
const authFromNormalizer = (profileOverrides) => {
  const profile = makeNormalizedProfile(profileOverrides);
  if (profileOverrides.__dropAuthorization) delete profile.workAuthorization;
  delete profile.__dropAuthorization;
  const normalized = normalizeJobProfile(profile, { title: "Frontend Developer", company: "Example Co", description: "React role." });
  return scoreJob(candidate, makeJob({
    extraction: normalized.extraction,
    workAuthorization: normalized.workAuthorization
  }));
};
const normalizedValid = authFromNormalizer({ workAuthorization: { required: false, eu: false } });
assert.equal(normalizedValid.gates.workAuthorization.status, "PASS");

const normalizedMissing = authFromNormalizer({ __dropAuthorization: true });
assert.equal(normalizedMissing.extraction.status, "uncertain");
assert.equal(normalizedMissing.gates.workAuthorization.status, "UNKNOWN");
assert.notEqual(normalizedMissing.decision, "APPLY");

const normalizedMalformed = authFromNormalizer({ workAuthorization: { required: "false", eu: false } });
assert.equal(normalizedMalformed.extraction.fields["workAuthorization.required"], "malformed");
assert.equal(normalizedMalformed.gates.workAuthorization.status, "UNKNOWN");
assert.notEqual(normalizedMalformed.decision, "APPLY");

// 9. Structured source restrictions (Himalayas) and the "Remote: Spain" format.
const listingGate = (sourceOverrides) => scoreJob(candidate, makeJob({
  location: { type: "remote", city: null, country: null, remoteScope: "unknown" },
  sourceInfo: { location: "Remote", description: "Frontend role.", remote: true, hybrid: false, ...sourceOverrides }
})).gates.location;

assert.equal(listingGate({ location: "Remote: Spain" }).status, "PASS", "string-only 'Remote: Spain' is a Spain-wide listing");
assert.equal(listingGate({ location: "Remote: Spain, Germany" }).status, "FLAG", "string lists without structured data stay manual review");
assert.equal(listingGate({ location: "Remote: United States", locationRestrictions: ["United States"] }).status, "FAIL");
assert.equal(
  listingGate({
    location: "Remote: United States",
    locationRestrictions: ["United States"],
    description: "Fully remote position available worldwide."
  }).status,
  "FAIL",
  "worldwide wording must not override a structured restriction"
);
assert.equal(listingGate({ location: "Remote: Atlantis", locationRestrictions: ["Atlantis"] }).status, "FLAG");
assert.equal(listingGate({ location: "Remote: Spain", locationRestrictions: ["Spain"] }).status, "PASS");
assert.equal(listingGate({ location: "Remote: Europe", locationRestrictions: ["Europe"] }).status, "PASS");
assert.equal(listingGate({ location: "Remote: Spain", locationRestrictions: ["Spain"], timezoneRestrictions: ["UTC-8"] }).status, "FLAG");
assert.equal(listingGate({ location: "Remote: Spain", locationRestrictions: ["Spain"], timezoneRestrictions: ["UTC+1"] }).status, "PASS");

// 10. Requirement classification: only technical skills reach the technical score / missing skills.
for (const [item, expected] of [
  ["At least 3+ years of professional experience building scalable and reliable web applications", "experience"],
  ["5 years of experience", "experience"],
  ["Independent, self-managed, and motivated", "soft-skill"],
  ["Strong communication skills", "soft-skill"],
  ["Good command of the English language", "language"],
  ["English", "language"],
  ["Fluent Spanish", "language"],
  ["Front-End Developer", "title"],
  ["Senior Frontend Engineer", "title"],
  ["React", "technical"],
  ["Unit Testing", "technical"],
  ["Next.js 14", "technical"],
  ["React.js 3 years", "technical"],
  ["Agile", "technical"],
  ["Experience with React developer tools", "technical"],
  ["Node.js", "technical"]
]) {
  assert.equal(classifyRequirement(item), expected, `classification of "${item}"`);
}
assert.equal(classifyRequirement({ type: "language", item: "Catalan" }), "language");

// Veeva (saved result): sentence requirements plus non-skill lines.
const veevaSavedRequired = [
  "At least 3+ years of professional experience building scalable and reliable web applications",
  "React", "JavaScript", "HTML", "CSS", "Unit Testing",
  "Independent, self-managed, and motivated",
  "Good command of the English language"
].map((item) => ({ type: "skill", item, priority: "critical" }));
const veevaCandidate = skillCandidate(["React", "JavaScript", "HTML", "CSS", "Unit Testing"]);
const veevaScored = scoreJob(veevaCandidate, makeJob({
  requirements: { required: veevaSavedRequired, preferred: [] }
}));
assert.deepEqual(veevaScored.missingRequiredSkills, [], "years, soft-skill and language lines are not missing technical skills");
assert.equal(veevaScored.breakdown.technical, 100);

// A genuinely missing technical skill is still reported next to the non-technical lines.
const veevaWithGap = scoreJob(veevaCandidate, makeJob({
  requirements: { required: [...veevaSavedRequired, { type: "skill", item: "Angular", priority: "critical" }], preferred: [] }
}));
assert.deepEqual(veevaWithGap.missingRequiredSkills, ["Angular"]);
assert.ok(veevaWithGap.breakdown.technical < 100);

// MRJ (saved result): the only "requirement" is the job title.
const mrjScored = scoreJob(veevaCandidate, makeJob({
  job: { title: "Frontend Developer", company: "MRJ Recruitment", description: "Frontend Developer wanted." },
  requirements: { required: [{ type: "skill", item: "Front-End Developer", priority: "critical" }], preferred: [] }
}));
assert.deepEqual(mrjScored.missingRequiredSkills, []);
assert.equal(mrjScored.breakdown.technical, null, "a title alone is not evidence for or against technical fit");

console.log("PASS: scorer and extraction regression scenarios passed.");
