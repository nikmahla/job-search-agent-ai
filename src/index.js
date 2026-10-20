import fs from "node:fs/promises";

const candidateData = JSON.parse(
  await fs.readFile("./data/candidate-profile.json", "utf-8")
);

const jobData = JSON.parse(
  await fs.readFile("./data/job-profile.json", "utf-8")
);

// ============================================================
// DATA
// ============================================================

const candidate = candidateData.candidate ?? {};
const candidateSkillsData = candidateData.skills ?? {};
const candidateExperience = candidateData.experience ?? [];
const professionalProfile =
  candidateData.professionalProfile ?? {};

const job = jobData.job ?? {};
const requirements = jobData.requirements ?? {};
const jobExperience = jobData.experience ?? {};
const responsibilities =
  jobData.responsibilities ?? {};
const qualifications =
  jobData.qualifications ?? {};

const jobLocation = jobData.location ?? {};

// ============================================================
// NORMALIZATION
// ============================================================

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/\.js\b/g, "js")
    .replace(/\+/g, " ")
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// CANDIDATE SKILLS
// ============================================================

const candidateSkills = new Set(
  Object.values(candidateSkillsData)
    .flat()
    .filter(
      (skill) =>
        typeof skill === "string"
    )
    .map(normalize)
);

// ============================================================
// CANDIDATE ATS KEYWORDS
// ============================================================

const candidateAtsKeywords = new Set(
  (candidateData.atsKeywords ?? [])
    .filter(
      (item) =>
        typeof item === "string"
    )
    .map(normalize)
);

// ============================================================
// CANDIDATE FUNCTIONS
// ============================================================

const candidateFunctions =
  candidateExperience
    .flatMap(
      (experience) =>
        experience.functions ?? []
    )
    .map(normalize);

// ============================================================
// CANDIDATE EVIDENCE
// ============================================================

/*
  Important:
  These are phrases that are explicitly supported
  by the candidate CV/profile.

  We use them for responsibility matching.
*/

const candidateEvidence = [
  ...Object.values(candidateSkillsData)
    .flat()
    .filter(
      (item) =>
        typeof item === "string"
    ),

  ...candidateFunctions,

  ...candidateExperience.flatMap(
    (experience) => [
      experience.role,
      ...(experience.functions ?? [])
    ]
  ),

  "reusable user interfaces",
  "reusable ui",
  "accessible ui",
  "frontend applications",
  "existing frontend code",
  "frontend code",
  "performance optimization",
  "code review"
].map(normalize);

// ============================================================
// EQUIVALENT SKILLS
// ============================================================

const equivalentSkills = {
  redux: ["redux toolkit"],
  "rest apis": ["restful apis"],

  "javascript es5/es6": ["javascript"],
  "javascript es6": ["javascript"],

  javascript: ["javascript es5/es6", "javascript es6"],

  react: ["reactjs"],
  "agile methodologies": ["agile"],
  html5: ["html"],
  css3: ["css"]
};

// ============================================================
// PARTIAL MATCHES
// ============================================================

const partialMatches = {
  jest: [
    "vitest"
  ]
};

// ============================================================
// MATCH SKILL
// ============================================================

function matchSkill(
  jobSkill
) {
  const normalizedJobSkill =
    normalize(jobSkill);

  // ----------------------------------------------------------
  // EXACT
  // ----------------------------------------------------------

  if (
    candidateSkills.has(
      normalizedJobSkill
    )
  ) {
    return {
      status: "EXACT",
      candidateSkill: jobSkill,
      points: 1
    };
  }

  // ----------------------------------------------------------
  // EQUIVALENT
  // ----------------------------------------------------------

  for (
    const [
      jobName,
      equivalents
    ] of Object.entries(
      equivalentSkills
    )
  ) {
    if (
      normalize(jobName) !==
      normalizedJobSkill
    ) {
      continue;
    }

    for (
      const equivalent
      of equivalents
    ) {
      if (
        candidateSkills.has(
          normalize(
            equivalent
          )
        )
      ) {
        return {
          status: "SEMANTIC",
          candidateSkill:
            equivalent,
          points: 0.9
        };
      }
    }
  }

  // ----------------------------------------------------------
  // PARTIAL
  // ----------------------------------------------------------

  for (
    const [
      jobName,
      relatedSkills
    ] of Object.entries(
      partialMatches
    )
  ) {
    if (
      normalize(jobName) !==
      normalizedJobSkill
    ) {
      continue;
    }

    for (
      const related
      of relatedSkills
    ) {
      if (
        candidateSkills.has(
          normalize(
            related
          )
        )
      ) {
        return {
          status: "PARTIAL",
          candidateSkill:
            related,
          points: 0.5
        };
      }
    }
  }

  // ----------------------------------------------------------
  // MISSING
  // ----------------------------------------------------------

  return {
    status: "MISSING",
    candidateSkill: null,
    points: 0
  };
}

// ============================================================
// REQUIREMENTS
// ============================================================

const requiredRequirements =
  Array.isArray(
    requirements.required
  )
    ? requirements.required
    : [];

const preferredRequirements =
  Array.isArray(
    requirements.preferred
  )
    ? requirements.preferred
    : [];

const requiredSkills =
  requiredRequirements.filter(
    (item) =>
      item.type === "skill"
  );

const preferredSkills =
  preferredRequirements.filter(
    (item) =>
      item.type === "skill"
  );

// ============================================================
// PRIORITY WEIGHTS
// ============================================================

const priorityWeights = {
  critical: 1.0,
  important: 0.8,
  secondary: 0.6,
  preferred: 0.4
};

// ============================================================
// SKILL ANALYSIS
// ============================================================

function analyzeSkills(
  list
) {
  return list.map(
    (requirement) => {
      const match =
        matchSkill(
          requirement.item
        );

      return {
        jobSkill:
          requirement.item,

        priority:
          requirement.priority ??
          "important",

        ...match
      };
    }
  );
}

const requiredAnalysis =
  analyzeSkills(
    requiredSkills
  );

const preferredAnalysis =
  analyzeSkills(
    preferredSkills
  );

// ============================================================
// WEIGHTED SKILL SCORE
// ============================================================

function calculateWeightedSkillScore(
  analysis
) {
  if (!analysis.length) {
    return null;
  }

  let weightedPoints = 0;
  let totalWeight = 0;

  for (
    const item of analysis
  ) {
    const weight =
      priorityWeights[
        item.priority
      ] ?? 0.5;

    weightedPoints +=
      item.points *
      weight;

    totalWeight +=
      weight;
  }

  return (
    (weightedPoints /
      totalWeight) *
    100
  );
}

const requiredSkillScore =
  calculateWeightedSkillScore(
    requiredAnalysis
  );

const preferredSkillScore =
  calculateWeightedSkillScore(
    preferredAnalysis
  );

// ============================================================
// TECHNICAL SCORE
// ============================================================

let technicalScore;

if (
  requiredSkillScore === null &&
  preferredSkillScore === null
) {
  technicalScore = null;
} else if (
  requiredSkillScore === null
) {
  technicalScore =
    preferredSkillScore;
} else if (
  preferredSkillScore === null
) {
  technicalScore =
    requiredSkillScore;
} else {
  technicalScore =
    requiredSkillScore * 0.8 +
    preferredSkillScore * 0.2;
}

// ============================================================
// EXPERIENCE FUNCTIONS
// ============================================================

const requiredFunctions =
  Array.isArray(
    jobExperience.requiredFunctions
  )
    ? jobExperience.requiredFunctions
    : [];

const functionAliases = {
  "frontend development": [
    "frontend development"
  ],

  "react development": [
    "react development"
  ],

  "next js development": [
    "next js development"
  ],

  "rest api integration": [
    "rest api integration"
  ],

  "performance optimization": [
    "performance optimization"
  ],

  "agile collaboration": [
    "agile development"
  ],
  "javascript development": [
  "frontend development",
  "react development"
],

"software development": [
  "frontend development"
],

"agile development": [
  "agile development",
  "agile collaboration"
],

"code review": [
  "code review"
]
};

function matchFunction(
  functionItem
) {
  const required =
    normalize(
      typeof functionItem ===
        "string"
        ? functionItem
        : functionItem.item
    );

  if (
    candidateFunctions.includes(
      required
    )
  ) {
    return {
      status: "MATCH",
      points: 1
    };
  }

  const aliases =
    functionAliases[
      required
    ];

  if (aliases) {
    const found =
      aliases.some(
        (alias) =>
          candidateFunctions.includes(
            normalize(alias)
          )
      );

    if (found) {
      return {
        status: "MATCH",
        points: 1
      };
    }
  }

  return {
    status: "MISSING",
    points: 0
  };
}

const functionAnalysis =
  requiredFunctions.map(
    (item) => ({
      jobFunction:
        typeof item ===
        "string"
          ? item
          : item.item,

      priority:
        typeof item ===
        "string"
          ? "important"
          : item.priority ??
            "important",

      ...matchFunction(item)
    })
  );

function calculateFunctionScore() {
  if (
    !functionAnalysis.length
  ) {
    return null;
  }

  let points = 0;
  let weight = 0;

  for (
    const item of functionAnalysis
  ) {
    const itemWeight =
      priorityWeights[
        item.priority
      ] ?? 0.8;

    points +=
      item.points *
      itemWeight;

    weight +=
      itemWeight;
  }

  return (
    (points / weight) *
    100
  );
}

const functionScore =
  calculateFunctionScore();

// ============================================================
// EXPERIENCE SCORE
// ============================================================

function calculateExperienceYears() {
  const candidateYears =
    Number(
      candidate.experienceYears ??
        0
    );

  const requiredYears =
    jobExperience.minimumYears;

  if (
    requiredYears === null ||
    requiredYears ===
      undefined
  ) {
    return null;
  }

  const required =
    Number(
      requiredYears
    );

  if (
    !Number.isFinite(
      required
    ) ||
    required <= 0
  ) {
    return null;
  }

  return Math.min(
    100,
    (candidateYears /
      required) *
      100
  );
}

const experienceYearsScore =
  calculateExperienceYears();

let experienceScore;

if (
  experienceYearsScore ===
    null &&
  functionScore === null
) {
  experienceScore = null;
} else if (
  experienceYearsScore ===
  null
) {
  experienceScore =
    functionScore;
} else if (
  functionScore === null
) {
  experienceScore =
    experienceYearsScore;
} else {
  experienceScore =
    experienceYearsScore *
      0.4 +
    functionScore * 0.6;
}

// ============================================================
// RESPONSIBILITY MATCHING
// ============================================================

const responsibilityRules = [
  {
    responsibility:
      "develop frontend applications",

    evidence: [
      "frontend development",
      "frontend applications",
      "react development"
    ]
  },

  {
    responsibility:
      "build react applications",

    evidence: [
      "react development",
      "react"
    ]
  },

  {
    responsibility:
      "build reusable ui components",

    evidence: [
      "reusable user interfaces",
      "reusable ui",
      "frontend development"
    ]
  },

  {
    responsibility:
      "build reusable user interfaces",

    evidence: [
      "reusable user interfaces",
      "reusable ui",
      "accessible ui"
    ]
  },

  {
    responsibility:
      "develop modern frontend ui",

    evidence: [
      "frontend development",
      "frontend applications",
      "react development"
    ]
  },

  {
    responsibility:
      "write clean javascript",

    evidence: [
      "javascript",
      "frontend development",
      "react development"
    ]
  },

  {
    responsibility:
      "implement automated tests",

    evidence: [
      "testing",
      "vitest",
      "react testing library"
    ]
  },

  {
    responsibility:
      "write frontend tests",

    evidence: [
      "testing",
      "vitest",
      "react testing library"
    ]
  },

  {
    responsibility:
      "participate in code reviews",

    evidence: [
      "code review"
    ]
  },

  {
    responsibility:
      "participate in code review",

    evidence: [
      "code review"
    ]
  },

  {
    responsibility:
      "work with javascript and typescript",

    evidence: [
      "javascript",
      "typescript"
    ]
  },

  {
    responsibility:
      "collaborate within an agile development team",

    evidence: [
      "agile development",
      "agile"
    ]
  },

  {
    responsibility:
      "collaborate with development team",

    evidence: [
      "agile development",
      "agile",
      "code review"
    ]
  },

  {
    responsibility:
      "work with apis",

    evidence: [
      "rest api integration",
      "rest apis"
    ]
  },

  {
    responsibility:
      "maintain and improve existing frontend code",

    evidence: [
      "frontend development",
      "performance optimization",
      "code review",
      "existing frontend code"
    ]
  },

  {
    responsibility:
      "develop javascript solutions",

    evidence: [
      "javascript",
      "frontend development",
      "react development"
    ]
  },

  {
    responsibility:
      "maintain and improve existing projects",

    evidence: [
      "existing frontend code",
      "frontend development",
      "performance optimization",
      "code review"
    ]
  },

  {
    responsibility:
      "participate in code review",

    evidence: [
      "code review"
    ]
  },

  {
    responsibility:
      "work in agile sprints",

    evidence: [
      "agile development",
      "agile"
    ]
  }
];
function matchResponsibility(
  responsibility
) {
  const normalized =
    normalize(
      responsibility
    );

  const rule =
    responsibilityRules.find(
      (item) =>
        normalize(
          item.responsibility
        ) === normalized
    );

  if (!rule) {
    return {
      status: "MISSING",
      points: 0
    };
  }

  const found =
    rule.evidence.some(
      (evidence) =>
        candidateEvidence.includes(
          normalize(evidence)
        )
    );

  if (found) {
    return {
      status: "MATCH",
      points: 1
    };
  }

  return {
    status: "MISSING",
    points: 0
  };
}

const coreResponsibilities =
  Array.isArray(
    responsibilities.core
  )
    ? responsibilities.core
    : [];

const secondaryResponsibilities =
  Array.isArray(
    responsibilities.secondary
  )
    ? responsibilities.secondary
    : [];

const coreResponsibilityAnalysis =
  coreResponsibilities.map(
    (item) => ({
      responsibility: item,
      ...matchResponsibility(
        item
      )
    })
  );

const secondaryResponsibilityAnalysis =
  secondaryResponsibilities.map(
    (item) => ({
      responsibility: item,
      ...matchResponsibility(
        item
      )
    })
  );

function calculateResponsibilityScore() {
  let total = 0;
  let weight = 0;

  for (
    const item of
      coreResponsibilityAnalysis
  ) {
    total +=
      item.points * 1.0;

    weight += 1.0;
  }

  for (
    const item of
      secondaryResponsibilityAnalysis
  ) {
    total +=
      item.points * 0.5;

    weight += 0.5;
  }

  if (!weight) {
    return null;
  }

  return (
    (total / weight) *
    100
  );
}

const responsibilitiesScore =
  calculateResponsibilityScore();

// ============================================================
// QUALIFICATIONS
// ============================================================

const qualificationList =
  Array.isArray(
    qualifications
  )
    ? qualifications
    : [];

function qualificationMatch(
  qualification
) {
  const text =
    normalize(
      qualification.item
    );

  if (
    text.includes("frontend")
  ) {
    return candidateFunctions.includes(
      "frontend development"
    )
      ? 1
      : 0;
  }

  if (
    text.includes("react")
  ) {
    return candidateSkills.has(
      "react"
    )
      ? 1
      : 0;
  }

  if (
    text.includes("javascript")
  ) {
    return candidateSkills.has(
      "javascript"
    )
      ? 1
      : 0;
  }

  if (
    text.includes("typescript")
  ) {
    return candidateSkills.has(
      "typescript"
    )
      ? 1
      : 0;
  }

  return 0;
}

function calculateQualificationScore() {
  if (
    !qualificationList.length
  ) {
    return null;
  }

  let total = 0;
  let weight = 0;

  for (
    const qualification
      of qualificationList
  ) {
    const itemWeight =
      priorityWeights[
        qualification.priority
      ] ?? 0.8;

    total +=
      qualificationMatch(
        qualification
      ) *
      itemWeight;

    weight +=
      itemWeight;
  }

  return (
    (total / weight) *
    100
  );
}

const qualificationScore =
  calculateQualificationScore();

// ============================================================
// CAREER ALIGNMENT
// ============================================================

function calculateCareerScore() {
  const title =
    normalize(
      job.title
    );

  const targetRoles =
    Array.isArray(
      professionalProfile.targetRoles
    )
      ? professionalProfile.targetRoles
      : [];

  if (
    !title ||
    !targetRoles.length
  ) {
    return null;
  }

  const normalizedRoles =
    targetRoles.map(
      normalize
    );

  if (
    normalizedRoles.some(
      (role) =>
        role === title ||
        title.includes(role) ||
        role.includes(title)
    )
  ) {
    return 100;
  }

  const frontendTerms = [
    "frontend",
  "front end",
  "desarrollador frontend",
  "desarrollador front end",
  "ingeniero frontend",
  "ingeniero front end",
  "react",
  "next js",
  "desarrollador a frontend",
"desarrollador a front end"
  ];

  if (
    frontendTerms.some(
      (term) =>
        title.includes(term)
    ) &&
    normalize(
      professionalProfile.primaryDomain
    ) ===
      "frontend development"
  ) {
    return 90;
  }

  return 50;
}

const careerScore =
  calculateCareerScore();

// ============================================================
// LANGUAGE GATE
// ============================================================

const languageLevels = {
  a1: 1,
  a2: 2,
  b1: 3,
  b2: 4,
  c1: 5,
  c2: 6,

  // Useful for job descriptions that use words
  basic: 2,
  elementary: 2,
  intermediate: 3,
  proficient: 4,
  advanced: 5,
  fluent: 5,
  native: 6,
  "native speaker": 6,
  good: 3
};

function normalizeLanguageLevel(level) {
  if (!level) {
    return null;
  }

  const normalized =
    normalize(level);

  return (
    languageLevels[normalized] ??
    null
  );
}

function evaluateLanguageGate() {
  const required =
    Array.isArray(
      jobData.languages
    )
      ? jobData.languages
      : [];

  // ----------------------------------------------------------
  // NO LANGUAGE REQUIREMENT
  // ----------------------------------------------------------

  if (!required.length) {
    return {
      status: "PASS",
      note:
        "No specific language requirement."
    };
  }

  const candidateLanguages =
    Array.isArray(
      candidate.languages
    )
      ? candidate.languages
      : [];

  // ----------------------------------------------------------
  // CHECK EACH REQUIRED LANGUAGE
  // ----------------------------------------------------------

  for (
    const requirement of required
  ) {
    const requiredName =
      typeof requirement ===
      "string"
        ? requirement
        : requirement.language;

    const requiredLevel =
      typeof requirement ===
      "string"
        ? null
        : normalizeLanguageLevel(
            requirement.level
          );

    const candidateLanguage =
      candidateLanguages.find(
        (language) =>
          normalize(
            typeof language ===
              "string"
              ? language
              : language.language
          ) ===
          normalize(
            requiredName
          )
      );

    // --------------------------------------------------------
    // LANGUAGE NOT FOUND
    // --------------------------------------------------------

    if (!candidateLanguage) {
      return {
        status: "FAIL",
        note:
          `Missing required language: ${requiredName}`
      };
    }

    // --------------------------------------------------------
    // NO REQUIRED LEVEL
    // --------------------------------------------------------

    if (
      requiredLevel === null
    ) {
      continue;
    }

    const candidateLevel =
      normalizeLanguageLevel(
        typeof candidateLanguage ===
          "string"
          ? null
          : candidateLanguage.level
      );

    // --------------------------------------------------------
    // CANDIDATE LEVEL UNKNOWN
    // --------------------------------------------------------

    if (
      candidateLevel === null
    ) {
      return {
        status: "FLAG",
        note:
          `${requiredName} is present, but candidate level is unclear.`
      };
    }

    // --------------------------------------------------------
    // LEVEL IS SUFFICIENT
    // --------------------------------------------------------

    if (
      candidateLevel >=
      requiredLevel
    ) {
      continue;
    }

    // --------------------------------------------------------
    // LANGUAGE PRESENT BUT BELOW REQUIREMENT
    // --------------------------------------------------------

    return {
      status: "FLAG",
      note:
        `${requiredName} level may be below the required level.`
    };
  }

  return {
    status: "PASS",
    note:
      "Required languages are present at the required level."
  };
}

const languageGate =
  evaluateLanguageGate();
// ============================================================
// WORK AUTHORIZATION
// ============================================================


function evaluateWorkAuthorization() {
  const requirement = jobData.workAuthorization?.required;
  const euRequired = jobData.workAuthorization?.eu;

  if (requirement !== true) {
    return {
      status: "UNKNOWN",
      note:
        "The posting does not confirm whether work authorization is required."
    };
  }

  if (euRequired === true) {
    if (candidate.workAuthorization?.eu === true) {
      return {
        status: "PASS",
        note: "EU work authorization confirmed."
      };
    }

    return {
      status: "UNKNOWN",
      note:
        "The role requires EU work authorization; candidate eligibility needs verification."
    };
  }

  return {
    status: "UNKNOWN",
    note: "Work authorization requirements need verification."
  };
}


const workAuthorizationGate =
  evaluateWorkAuthorization();

// ============================================================
// LOCATION
// ============================================================

function evaluateLocation() {
  const type = normalize(jobLocation.type);
  const city = normalize(jobLocation.city);
  const country = normalize(jobLocation.country);
  const remoteScope = normalize(jobLocation.remoteScope);
  const acceptedCities = (candidate.location?.acceptedCities ?? []).map(normalize);

  if (type === "remote") {
    if (["worldwide", "europe", "eu"].includes(remoteScope)) {
      return { status: "PASS", note: `Remote scope is compatible: ${remoteScope}.` };
    }

    if (["country specific", "country-specific"].includes(remoteScope)) {
      if (["spain", "espana"].includes(country)) {
        return { status: "PASS", note: "Remote role is restricted to Spain, where the candidate is based." };
      }
      if (country) {
        return { status: "FAIL", note: `Remote role is country-specific (${jobLocation.country}) and does not confirm eligibility from Spain.` };
      }
    }

    return { status: "FLAG", note: "Remote scope is unknown; verify that applicants based in Spain are eligible." };
  }

  if (type === "hybrid" || type === "onsite") {
    if (city && acceptedCities.includes(city)) {
      return { status: "PASS", note: `${jobLocation.city} is an accepted city.` };
    }
    if (city) {
      return { status: "FAIL", note: `${jobLocation.city} is outside the accepted onsite/hybrid cities.` };
    }
    return { status: "UNKNOWN", note: "Onsite/hybrid city is not specified." };
  }

  return { status: "UNKNOWN", note: "Location type is unclear." };
}

const locationGate =
  evaluateLocation();

function evaluateRoleFit() {
  const title = normalize(job.title ?? "");
  if (!title) return { status: "UNKNOWN", note: "Job title is missing." };

  const fullStack = /\b(full stack|fullstack)\b/.test(title);
  const frontendFocused = /\b(frontend|front end|ui developer|ui engineer)\b/.test(title);
  const backendFocused = /\b(backend|back end|node developer|nodejs developer|node js developer)\b/.test(title);

  if (fullStack && !frontendFocused) {
    return { status: "FLAG", note: "Full-stack is a secondary target and needs manual review." };
  }
  if (backendFocused && !frontendFocused) {
    return { status: "FLAG", note: "Title appears backend-focused despite possible React mentions." };
  }
  if (/\b(frontend|front end|react|nextjs|next js|ui developer|ui engineer)\b/.test(title)) {
    return { status: "PASS", note: "Title aligns with the primary frontend/React/Next.js target." };
  }
  return { status: "FLAG", note: "Role title needs manual review against the primary frontend target." };
}

const roleFitGate = evaluateRoleFit();

// ============================================================
// JOB FIT SCORE
// ============================================================

function calculateJobFit() {
  const dimensions = [
    {
      name: "Technical",
      score: technicalScore,
      weight: 0.30
    },

    {
      name: "Experience",
      score: experienceScore,
      weight: 0.20
    },

    {
      name: "Responsibilities",
      score:
        responsibilitiesScore,
      weight: 0.20
    },

    {
      name: "Qualifications",
      score:
        qualificationScore,
      weight: 0.15
    },

    {
      name: "Career",
      score: careerScore,
      weight: 0.15
    }
  ];

  const available =
    dimensions.filter(
      (item) =>
        item.score !== null
    );

  if (!available.length) {
    return null;
  }

  const totalWeight =
    available.reduce(
      (sum, item) =>
        sum + item.weight,
      0
    );

  const total =
    available.reduce(
      (sum, item) =>
        sum +
        item.score *
          item.weight,
      0
    );

  // Avoid turning a single inferred career/title score into a misleading 100/100.
  if (totalWeight < 0.60) return null;

  return (
    total /
    totalWeight
  );
}

const jobFitScore = calculateJobFit();

const scoringDimensions = [
  { score: technicalScore, weight: 0.30 },
  { score: experienceScore, weight: 0.20 },
  { score: responsibilitiesScore, weight: 0.20 },
  { score: qualificationScore, weight: 0.15 },
  { score: careerScore, weight: 0.15 }
];
const scoringCoverage = Number((scoringDimensions.reduce((sum, item) => sum + (item.score === null || item.score === undefined ? 0 : item.weight), 0) * 100).toFixed(1));

// ============================================================
// ATS MATCH
// ============================================================

function matchAtsKeyword(
  jobKeyword
) {
  const normalized =
    normalize(
      jobKeyword
    );

  // EXACT
  if (
    candidateAtsKeywords.has(
      normalized
    )
  ) {
    return {
      status: "EXACT",
      points: 1,
      candidateKeyword:
        jobKeyword
    };
  }

  // SEMANTIC
  for (
    const [
      jobName,
      equivalents
    ] of Object.entries(
      equivalentSkills
    )
  ) {
    if (
      normalize(jobName) !==
      normalized
    ) {
      continue;
    }

    for (
      const equivalent
      of equivalents
    ) {
      if (
        candidateSkills.has(
          normalize(
            equivalent
          )
        ) ||
        candidateAtsKeywords.has(
          normalize(
            equivalent
          )
        )
      ) {
        return {
          status: "SEMANTIC",
          points: 0.9,
          candidateKeyword:
            equivalent
        };
      }
    }
  }

  // PARTIAL
  for (
    const [
      jobName,
      relatedSkills
    ] of Object.entries(
      partialMatches
    )
  ) {
    if (
      normalize(jobName) !==
      normalized
    ) {
      continue;
    }

    for (
      const related
      of relatedSkills
    ) {
      if (
        candidateSkills.has(
          normalize(
            related
          )
        )
      ) {
        return {
          status: "PARTIAL",
          points: 0.5,
          candidateKeyword:
            related
        };
      }
    }
  }

  return {
    status: "MISSING",
    points: 0,
    candidateKeyword: null
  };
}

const atsRequiredAnalysis =
  requiredSkills.map(
    (item) => ({
      keyword: item.item,

      priority:
        item.priority ??
        "important",

      ...matchAtsKeyword(
        item.item
      )
    })
  );

const atsPreferredAnalysis =
  preferredSkills.map(
    (item) => ({
      keyword: item.item,

      priority:
        item.priority ??
        "preferred",

      ...matchAtsKeyword(
        item.item
      )
    })
  );

// ============================================================
// ATS SCORE
// ============================================================

function calculateAtsScore() {
  const all = [
    ...atsRequiredAnalysis,
    ...atsPreferredAnalysis
  ];

  if (!all.length) {
    return null;
  }

  let total = 0;
  let weight = 0;

  for (
    const item of all
  ) {
    const itemWeight =
      priorityWeights[
        item.priority
      ] ?? 0.4;

    total +=
      item.points *
      itemWeight;

    weight +=
      itemWeight;
  }

  return (
    (total / weight) *
    100
  );
}

const atsKeywordScore =
  calculateAtsScore();

/// ============================================================
// ATS TITLE
// ============================================================

function calculateTitleMatch() {
  const jobTitle =
    normalize(
      job.title
    );

  const targetRoles =
    Array.isArray(
      professionalProfile.targetRoles
    )
      ? professionalProfile.targetRoles
      : [];

  if (!jobTitle) {
    return null;
  }

  // ----------------------------------------------------------
  // EXACT TITLE MATCH
  // ----------------------------------------------------------

  if (
    candidateAtsKeywords.has(
      jobTitle
    )
  ) {
    return 100;
  }

  if (
    targetRoles.some(
      (role) =>
        normalize(role) ===
        jobTitle
    )
  ) {
    return 100;
  }

  // ----------------------------------------------------------
  // SEMANTIC TITLE MATCH
  // ----------------------------------------------------------

 const titleAliases = {
  "javascript developer": [
    "frontend developer",
    "frontend engineer",
    "react developer",
    "next js developer"
  ],

  "desarrollador javascript": [
    "frontend developer",
    "frontend engineer",
    "react developer",
    "next js developer"
  ],

  "desarrollador frontend": [
    "frontend developer",
    "frontend engineer",
    "react developer",
    "next js developer"
  ],

  "ingeniero frontend": [
    "frontend developer",
    "frontend engineer",
    "react developer",
    "next js developer"
  ],

  "junior frontend developer": [
    "frontend developer",
    "frontend engineer",
    "react developer",
    "next js developer"
  ],
    "desarrollador a frontend junior": [
    "frontend developer",
    "frontend engineer",
    "react developer",
    "next js developer"
  ],

  "desarrollador a front end junior": [
    "frontend developer",
    "frontend engineer",
    "react developer",
    "next js developer"
  ]
};

  for (
    const [
      jobRole,
      aliases
    ] of Object.entries(
      titleAliases
    )
  ) {
    if (
      normalize(jobRole) !==
      jobTitle
    ) {
      continue;
    }

    const hasRelatedRole =
      aliases.some(
        (role) =>
          targetRoles.some(
            (targetRole) =>
              normalize(targetRole) ===
              normalize(role)
          )
      );

    if (hasRelatedRole) {
      return 70;
    }
  }

  // ----------------------------------------------------------
  // NO MATCH


  return 0;
}

const atsTitleScore =
  calculateTitleMatch();
// ============================================================
// FINAL ATS
// ============================================================

function calculateFinalAtsScore() {
  const dimensions = [
    {
      score: atsKeywordScore,
      weight: 0.80
    },

    {
      score: atsTitleScore,
      weight: 0.20
    }
  ];

  const available =
    dimensions.filter(
      (item) =>
        item.score !== null
    );

  if (!available.length) {
    return null;
  }

  const totalWeight =
    available.reduce(
      (sum, item) =>
        sum + item.weight,
      0
    );

  const total =
    available.reduce(
      (sum, item) =>
        sum +
        item.score *
          item.weight,
      0
    );

  return (
    total /
    totalWeight
  );
}

const atsMatchScore =
  calculateFinalAtsScore();

// ============================================================
// MISSING KEYWORDS
// ============================================================

const missingKeywords = [
  ...atsRequiredAnalysis,
  ...atsPreferredAnalysis
]
  .filter(
    (item) =>
      item.status ===
      "MISSING"
  )
  .sort(
    (a, b) => {
      const weightA =
        priorityWeights[
          a.priority
        ] ?? 0.4;

      const weightB =
        priorityWeights[
          b.priority
        ] ?? 0.4;

      return weightB - weightA;
    }
  );

// ============================================================
// DECISION
// ============================================================

const hardGateFailed =
  languageGate.status === "FAIL" ||
  workAuthorizationGate.status === "FAIL" ||
  locationGate.status === "FAIL" ||
  roleFitGate.status === "FAIL";

function calculateDecision() {
  if (hardGateFailed) {
    return "SKIP";
  }

  if (
    jobFitScore === null
  ) {
    return "MAYBE";
  }

  const allGatesPass = [
    roleFitGate.status,
    languageGate.status,
    workAuthorizationGate.status,
    locationGate.status
  ].every((status) => status === "PASS");

  if (jobFitScore >= 75 && allGatesPass) {
    return "APPLY";
  }

  if (jobFitScore >= 60) {
    return "MAYBE";
  }

  return "SKIP";
}

const decision =
  calculateDecision();

// ============================================================
// PRINT HELPERS
// ============================================================

function printSkillAnalysis(
  title,
  analysis
) {
  console.log(
    `\n━━━━━━━━━━━━━━━━━━━━━━━━`
  );

  console.log(title);

  console.log(
    `━━━━━━━━━━━━━━━━━━━━━━━━`
  );

  if (!analysis.length) {
    console.log("None.");
    return;
  }

  for (
    const item of analysis
  ) {
    const name =
      item.jobSkill ??
      item.keyword;

    const candidate =
      item.candidateSkill ??
      item.candidateKeyword;

    console.log(
      `${item.status.padEnd(11)} | ${name}` +
        (
          candidate
            ? ` → ${candidate}`
            : ""
        )
    );
  }
}

// ============================================================
// OUTPUT
// ============================================================

console.log(
  "\n━━━━━━━━━━━━━━━━━━━━━━━━"
);

console.log(
  "JOB MATCH RESULT"
);

console.log(
  "━━━━━━━━━━━━━━━━━━━━━━━━"
);

console.log(
  `\nJob: ${
    job.title ??
    "Unknown"
  }`
);

console.log(
  `Company: ${
    job.company ??
    "Unknown"
  }`
);

console.log(
  `\nJOB FIT SCORE: ${
    jobFitScore === null
      ? "N/A"
      : `${Math.round(
          jobFitScore
        )}/100`
  }`
);

console.log(
  `SCORING COVERAGE: ${scoringCoverage}%`
);

console.log(
  `ATS MATCH SCORE: ${
    atsMatchScore === null
      ? "N/A"
      : `${Math.round(
          atsMatchScore
        )}/100`
  }`
);

console.log(
  `Decision: ${decision}`
);

// ============================================================
// GATES
// ============================================================

console.log(
  "\n━━━━━━━━━━━━━━━━━━━━━━━━"
);

console.log(
  "GATES"
);

console.log(
  "━━━━━━━━━━━━━━━━━━━━━━━━"
);

console.log(
  `Language           : ${languageGate.status}`
);

console.log(
  `Work Authorization : ${workAuthorizationGate.status}`
);

console.log(
  `Location           : ${locationGate.status}`
);

console.log(
  `Role Fit           : ${roleFitGate.status}`
);

// ============================================================
// JOB FIT SKILLS
// ============================================================

printSkillAnalysis(
  "JOB FIT — REQUIRED SKILLS",
  requiredAnalysis
);

printSkillAnalysis(
  "JOB FIT — PREFERRED SKILLS",
  preferredAnalysis
);

// ============================================================
// RESPONSIBILITIES
// ============================================================

console.log(
  "\n━━━━━━━━━━━━━━━━━━━━━━━━"
);

console.log(
  "RESPONSIBILITIES"
);

console.log(
  "━━━━━━━━━━━━━━━━━━━━━━━━"
);

for (
  const item of
    coreResponsibilityAnalysis
) {
  console.log(
    `${item.status.padEnd(11)} | ${item.responsibility}`
  );
}

for (
  const item of
    secondaryResponsibilityAnalysis
) {
  console.log(
    `${item.status.padEnd(11)} | ${item.responsibility}`
  );
}

// ============================================================
// ATS
// ============================================================

printSkillAnalysis(
  "ATS — REQUIRED KEYWORDS",
  atsRequiredAnalysis
);

printSkillAnalysis(
  "ATS — PREFERRED KEYWORDS",
  atsPreferredAnalysis
);

// ============================================================
// JOB FIT BREAKDOWN
// ============================================================

console.log(
  "\n━━━━━━━━━━━━━━━━━━━━━━━━"
);

console.log(
  "JOB FIT BREAKDOWN"
);

console.log(
  "━━━━━━━━━━━━━━━━━━━━━━━━"
);

console.log(
  `Technical Skills  : ${
    technicalScore === null
      ? "N/A"
      : `${technicalScore.toFixed(
          1
        )}/100`
  }`
);

console.log(
  `Experience        : ${
    experienceScore === null
      ? "N/A"
      : `${experienceScore.toFixed(
          1
        )}/100`
  }`
);

console.log(
  `Responsibilities  : ${
    responsibilitiesScore ===
    null
      ? "N/A"
      : `${responsibilitiesScore.toFixed(
          1
        )}/100`
  }`
);

console.log(
  `Qualifications    : ${
    qualificationScore === null
      ? "N/A"
      : `${qualificationScore.toFixed(
          1
        )}/100`
  }`
);

console.log(
  `Career Alignment  : ${
    careerScore === null
      ? "N/A"
      : `${careerScore.toFixed(
          1
        )}/100`
  }`
);

// ============================================================
// ATS BREAKDOWN
// ============================================================

console.log(
  "\n━━━━━━━━━━━━━━━━━━━━━━━━"
);

console.log(
  "ATS BREAKDOWN"
);

console.log(
  "━━━━━━━━━━━━━━━━━━━━━━━━"
);

console.log(
  `Keyword Match     : ${
    atsKeywordScore === null
      ? "N/A"
      : `${atsKeywordScore.toFixed(
          1
        )}/100`
  }`
);

console.log(
  `Job Title Match   : ${
    atsTitleScore === null
      ? "N/A"
      : `${atsTitleScore.toFixed(
          1
        )}/100`
  }`
);

console.log(
  `Final ATS Match   : ${
    atsMatchScore === null
      ? "N/A"
      : `${atsMatchScore.toFixed(
          1
        )}/100`
  }`
);

// ============================================================
// TOP MISSING KEYWORDS
// ============================================================

console.log(
  "\n━━━━━━━━━━━━━━━━━━━━━━━━"
);

console.log(
  "TOP MISSING KEYWORDS"
);

console.log(
  "━━━━━━━━━━━━━━━━━━━━━━━━"
);

if (
  !missingKeywords.length
) {
  console.log(
    "No important keywords are missing."
  );
} else {
  missingKeywords
    .slice(0, 5)
    .forEach(
      (item, index) => {
        console.log(
          `${index + 1}. ${
            item.keyword
          } [${item.priority}]`
        );
      }
    );
}

console.log(
  "\n━━━━━━━━━━━━━━━━━━━━━━━━"
);