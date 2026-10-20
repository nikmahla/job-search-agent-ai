
const FRONTEND_TITLE_TERMS = [
  "frontend",
  "front-end",
  "front end",
  "react developer",
  "react engineer",
  "next.js developer",
  "nextjs developer",
  "web developer",
  "web engineer",
  "ui engineer",
  "ui developer",
  // The same "web developer" title in the posting languages the sources return.
  "desarrollador web",
  "desarrolladora web",
  "programador web",
  "programadora web",
  "sviluppatore web",
  "sviluppatrice web",
  "webentwickler",
  "web entwickler",
  "developpeur web"
];

const TARGET_TECH_TERMS = [
  "react",
  "react.js",
  "next.js",
  "nextjs"
];

const BROADER_ROLE_TERMS = [
  "full stack",
  "full-stack",
  "fullstack",
  "software engineer",
  "software developer",
  "application developer",
  "product engineer",
  // JavaScript/TypeScript titles are searched for ("JavaScript Developer") and
  // scored by the pre-ranker; like other broad titles they need React/Next.js
  // and web evidence, so Node-only or unrelated roles are still dropped.
  "javascript developer",
  "javascript engineer",
  "typescript developer",
  "typescript engineer",
  // "Software engineer/developer" in the posting languages the sources return.
  "ingeniero de software",
  "ingeniera de software",
  "desarrollador de software",
  "desarrolladora de software",
  "sviluppatore software",
  "softwareentwickler",
  "software entwickler",
  "developpeur logiciel"
];

const HARD_EXCLUDE_TITLE_TERMS = [
  "salesforce developer",
  "marketing cloud",
  "devops engineer",
  "devops developer",
  "site reliability engineer",
  "sre engineer",
  "data engineer",
  "data scientist",
  "machine learning engineer",
  "ml engineer",
  "qa engineer",
  "quality assurance engineer",
  "test automation engineer",
  "automation tester",
  "database administrator",
  "network engineer",
  "network administrator",
  "cybersecurity engineer",
  "security engineer",
  "embedded engineer",
  "embedded developer",
  "ios developer",
  "android developer",
  "flutter developer",
  "react native",
  "react-native",
  "sc cleared",
  "security cleared",
  "security clearance",
  "nato"
];

const NON_TARGET_FRONTEND_TECHS = [
  "vue.js",
  "vuejs",
  "angular",
  "svelte"
];

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text, terms) {
  return terms.some(term => text.includes(term));
}

// Gendered title forms ("Desarrollador/a", "Programador(a)", "Entwickler/in",
// "Entwickler*in") are read as the base title.
function getTitleText(job) {
  return normalizeText(job.title)
    .replace(/\b(desarrollador|programador|ingeniero|sviluppatore|entwickler)\s*(?:\/\s*(?:a|ora|in|trice)|\((?:a|ora|in)\)|\*in|:in)(?![a-z])/g, "$1");
}

function getDescriptionText(job) {
  return normalizeText(job.description);
}

function hasFrontendTitle(title) {
  return containsAny(title, FRONTEND_TITLE_TERMS);
}

function hasTargetTech(text) {
  return containsAny(text, TARGET_TECH_TERMS);
}

function hasBroaderRole(title) {
  return containsAny(title, BROADER_ROLE_TERMS);
}

function hasWebEvidence(text) {
  const webTerms = [
    "frontend",
    "front-end",
    "front end",
    "next.js",
    "nextjs",
    "react.js",
    "react",
    "typescript",
    "html",
    "css",
    "tailwind",
    "responsive design",
    "web application"
  ];

  return containsAny(text, webTerms);
}

export function filterJob(job) {
  const title = getTitleText(job);
  const description = getDescriptionText(job);

  // 1. Exclude clearly unsuitable titles first.
  if (containsAny(title, HARD_EXCLUDE_TITLE_TERMS)) {
    return {
      keep: false,
      reason: "hard_excluded_title"
    };
  }

  // 2. Exclude roles focused on a different frontend framework
  //    when the title does not mention React or Next.js.
  if (
    containsAny(title, NON_TARGET_FRONTEND_TECHS) &&
    !hasTargetTech(title)
  ) {
    return {
      keep: false,
      reason: "non_target_frontend_framework"
    };
  }

  // 3. Accept relevant frontend titles.
  if (hasFrontendTitle(title)) {
    return {
      keep: true,
      reason: "frontend_title"
    };
  }

  // 4. Broader software roles need React/Next.js and web evidence.
  if (hasBroaderRole(title)) {
    const combinedText = `${title} ${description}`;

    if (
      hasTargetTech(combinedText) &&
      hasWebEvidence(combinedText)
    ) {
      return {
        keep: true,
        reason: "broader_role_with_frontend_evidence"
      };
    }

    return {
      keep: false,
      reason: "no_frontend_evidence_for_broader_role"
    };
  }

  // 5. Other roles must mention target technology in the title.
  if (hasTargetTech(title)) {
    return {
      keep: true,
      reason: "target_technology_in_title"
    };
  }

  return {
    keep: false,
    reason: "insufficient_frontend_evidence"
  };
}

export function filterJobs(jobs = []) {
  const kept = [];
  const rejected = [];

  for (const job of jobs) {
    const result = filterJob(job);

    const enrichedJob = {
      ...job,
      preFilter: {
        keep: result.keep,
        reason: result.reason
      }
    };

    if (result.keep) {
      kept.push(enrichedJob);
    } else {
      rejected.push(enrichedJob);
    }
  }

  return {
    kept,
    rejected,
    total: jobs.length,
    keptCount: kept.length,
    rejectedCount: rejected.length
  };
}
