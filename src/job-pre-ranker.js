
 import {
  structuredRestrictionVerdict,
  LISTING_SPAIN_REGIONS,
  hasExplicitNonSpainRestriction,
  hasExplicitSpainRemote,
  hasExplicitWorldwideRemote,
  hasExplicitEuropeRemote,
  hasHybridWorkSignal
} from "./job-source-rules.js";

import { namesNonJsBackend } from "./tech-lexicon.js";

// Structured restrictions that cover the whole of Europe (Spain included).
// "Worldwide" is deliberately not here: it stays REMOTE_UNKNOWN for review.
const STRUCTURED_EUROPE_REGIONS = new Set(["europe", "european union", "eu", "eea", "european economic area", "emea"]);

// ------------------------------------------------------------
 // JOB PRE-RANKER
 // Deterministic, inexpensive ranking before Qwen analysis.
 //
 // Goals:
 // 1. Prefer frontend / React / Next.js jobs.
 // 2. Prefer Alicante / Valencia, then Spain remote, Europe remote,
 //    and UK remote.
 // 3. Never treat unknown or non-local office jobs as eligible.
 // 4. Exclude clearly unsuitable roles before Qwen.
 // 5. Preserve metadata expected by run-agent.js.
 // ------------------------------------------------------------

const FRONTEND_TITLE_TERMS = [
  "frontend",
  "front-end",
  "front end",
  "ui engineer",
  "ui developer",
  "web frontend",
];

const FULLSTACK_TERMS = ["full stack", "full-stack", "fullstack"];
const JAVASCRIPT_ROLE_TERMS = ["javascript developer", "javascript engineer", "typescript developer", "typescript engineer"];

const REMOTE_TERMS = [
  "remote",
  "remoto",
  "teletrabajo",
  "work from home",
  "working from home",
  "home based",
  "home-based",
  "fully remote",
  "100% remote",
  "remote-first",
  "remote first",
];

const ONSITE_TERMS = ["onsite", "on-site", "on site", "presencial"];

const LOCAL_CITY_TERMS = ["alicante", "valencia"];

const SPAIN_TERMS = [
  "spain", "espana", "españa", "madrid", "barcelona", "sevilla",
  "malaga", "zaragoza", "bilbao", "murcia", "granada", "valladolid",
  "palma de mallorca", "santiago de compostela",
];

const UK_TERMS = [
  "united kingdom", "great britain", "england", "scotland", "wales",
  "northern ireland", "london", "manchester", "birmingham", "liverpool",
  "leeds", "bristol", "glasgow", "edinburgh", "belfast", "uk",
];

const UAE_TERMS = [
  "united arab emirates", "uae", "emirates", "dubai", "abu dhabi",
  "sharjah", "ajman", "ras al khaimah", "fujairah", "umm al quwain",
];

const COUNTRY_LOCATION_TERMS = {
  es: SPAIN_TERMS,
  gb: UK_TERMS,
  ae: UAE_TERMS,
  fr: ["france", "paris", "lyon", "marseille", "toulouse", "bordeaux", "lille", "nantes", "nice"],
  de: ["germany", "deutschland", "berlin", "munich", "munchen", "hamburg", "frankfurt", "cologne", "koln", "stuttgart"],
  nl: ["netherlands", "nederland", "amsterdam", "rotterdam", "utrecht", "eindhoven"],
  be: ["belgium", "belgie", "brussels", "bruxelles", "antwerp", "antwerpen", "ghent", "gent"],
  it: ["italy", "italia", "milan", "milano", "rome", "roma", "turin", "torino", "bologna", "naples", "napoli"],
  at: ["austria", "osterreich", "vienna", "wien", "graz", "linz"],
  pl: ["poland", "polska", "warsaw", "warszawa", "krakow", "wroclaw", "gdansk"],
  ch: ["switzerland", "schweiz", "suisse", "svizzera", "zurich", "zuerich", "geneva", "geneve", "basel", "bern"],
};

const EUROPE_COUNTRY_CODES = new Set(["fr", "de", "nl", "be", "it", "at", "pl", "ch"]);

const SENIORITY_PENALTY_TERMS = [
  "principal", "staff engineer", "staff developer", "architect",
  "director", "head of", "vice president", "vp engineering", "cto",
];

const SENIORITY_GOOD_TERMS = ["senior", "sr.", "mid-level", "mid level"];
const JUNIOR_TERMS = ["intern", "internship", "graduate developer", "junior", "entry-level", "entry level"];

const REJECT_SENIORITY_TITLE_TERMS = [
  "lead", "principal", "staff", "team leader", "tech leader",
  "technical leader", "intern", "internship",
];

const MAX_ACCEPTED_MINIMUM_YEARS = 4;
const YEARS_PATTERN =
  /(?<![\d.])(\d{1,2})\s*\+?(?:\s*(?:-|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?|anos)\b/g;
const YEARS_STRONG_CUE = /\b(minimum|min|at least|minimo|al menos)\b/;
const YEARS_REQUIREMENT_CUE =
  /\b(required|requires?|requirement|must|mandatory|you (?:have|bring|will have|should have|need)|candidates?|proven|se requiere|requisito)\b|\d\s*\+/;
const YEARS_NON_REQUIREMENT_CUE =
  /\b(preferred|preferably|nice to have|a plus|bonus|desirable|ideally|optional|deseable|valorable|se valorara|up to|less than|fewer than|no more than|under|not required|not necessary|work(?:ing)? with|alongside|mentor\w*)\b|\b(we|our|company|firm|agency)\b[^.]{0,30}\b(has|have|had|been|founded|established|operating|serving|history)\b/;

const HARD_EXCLUDE_TITLE_TERMS = [
  "react native", "react-native", "ios developer", "android developer",
  "flutter developer", "salesforce developer", "marketing cloud",
  "devops engineer", "devops developer", "site reliability engineer",
  "sre engineer", "data engineer", "data scientist", "machine learning engineer",
  "ml engineer", "qa engineer", "quality assurance engineer",
  "test automation engineer", "automation tester", "database administrator",
  "network engineer", "network administrator", "cybersecurity engineer",
  "security engineer", "embedded engineer", "embedded developer",
  "sc cleared", "security cleared", "security clearance", "nato",
];

const NON_TARGET_FRAMEWORK_TERMS = ["vue.js", "vuejs", "vue", "angular", "svelte"];

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasTerm(text, term) {
  const normalizedText = normalizeText(text);
  const normalizedTerm = normalizeText(term);
  if (!normalizedText || !normalizedTerm) return false;

  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(normalizedText);
}

function containsAny(text, terms) {
  return terms.some((term) => hasTerm(text, term));
}

function hasPhrase(text, phrase) {
  return hasTerm(text, phrase);
}

// Gendered title forms ("Desarrollador/a", "Programador(a)", "Entwickler/in")
// are read as the base title, as in job-filter.js.
function getTitleText(job) {
  return normalizeText(job?.title ?? "")
    .replace(/\b(desarrollador|programador|ingeniero|sviluppatore|entwickler)\s*(?:\/\s*(?:a|ora|in|trice)|\((?:a|ora|in)\)|\*in|:in)(?![a-z])/g, "$1");
}

function getLocationText(job) {
  return normalizeText(job?.location ?? job?.city ?? "");
}

function getJobText(job) {
  return normalizeText([job?.title, job?.description].filter(Boolean).join(" "));
}

function hasReact(text) {
  const cleaned = normalizeText(text).replace(/\breact[ -]*native\b/g, " ");
  return /\breact(?:\.js)?\b/.test(cleaned);
}

function hasNextJs(text) {
  return /\bnext(?:\.js|js)\b/.test(normalizeText(text));
}

function hasTypeScript(text) {
  return /\btypescript\b/.test(normalizeText(text));
}

function hasTargetTech(text) {
  return hasReact(text) || hasNextJs(text) || hasTypeScript(text);
}

function inferCountryCode(locationText, fallbackCountry = "") {
  const location = normalizeText(locationText);

  for (const [code, terms] of Object.entries(COUNTRY_LOCATION_TERMS)) {
    if (containsAny(location, terms)) return code;
  }

  const fallback = normalizeText(fallbackCountry);

  const aliases = {
    es: "es", spain: "es", espana: "es", "españa": "es",
    gb: "gb", uk: "gb", "united kingdom": "gb", england: "gb",
    ae: "ae", uae: "ae", "united arab emirates": "ae", dubai: "ae", "abu dhabi": "ae",
    fr: "fr", france: "fr", de: "de", germany: "de", deutschland: "de",
    nl: "nl", netherlands: "nl", be: "be", belgium: "be", it: "it",
    italy: "it", at: "at", austria: "at", pl: "pl", poland: "pl",
    ch: "ch", switzerland: "ch",
  };

  return aliases[fallback] ?? "";
}

function hasRemoteSignal(job) {
  if (job?.remote === true) return true;

  const titleAndLocation = `${getTitleText(job)} ${getLocationText(job)}`.replace(
    /\bremote sensing\b/g,
    " "
  );
  return containsAny(titleAndLocation, REMOTE_TERMS);
}

function hasHybridSignal(job) {
  if (job?.hybrid === true) return true;

  // "Hybrid App Developer" is a technology in the title, not hybrid work.
  return hasHybridWorkSignal(`${getTitleText(job)} ${getLocationText(job)}`);
}

function hasOnsiteSignal(job) {
  const titleAndLocation = `${getTitleText(job)} ${getLocationText(job)}`;
  return containsAny(titleAndLocation, ONSITE_TERMS);
}

function isAlicanteLocation(location) {
  return hasTerm(location, "alicante");
}

function isValenciaLocation(location) {
  return hasTerm(location, "valencia");
}

function isLocalLocation(location) {
  return isAlicanteLocation(location) || isValenciaLocation(location);
}

// ------------------------------------------------------------
// LOCATION ELIGIBILITY
// ------------------------------------------------------------

function getLocationCategory(job) {
  const location = getLocationText(job);
  const fallbackCountry = job?.sourceCountry || job?.country || "";
  const locationCountryCode = inferCountryCode(location);
  const remoteCountryCode =
    locationCountryCode || inferCountryCode("", fallbackCountry);

  const isAlicante = isAlicanteLocation(location);
  const isValencia = isValenciaLocation(location);
  const isRemote = hasRemoteSignal(job);
  const isHybrid = hasHybridSignal(job);

  // Structured restrictions outrank every local-city or remote shortcut below.
  const restrictionVerdict = structuredRestrictionVerdict(job);
  if (restrictionVerdict === "CONFLICT") return "RESTRICTION_CONFLICT";
  if (restrictionVerdict === "EXCLUDES_SPAIN") return "REMOTE_OTHER_REGION";

  if (isAlicante) {
    if (isHybrid) return "LOCAL_HYBRID";
    if (isRemote) return "LOCAL_REMOTE";
    return "LOCAL";
  }

  if (isValencia) {
    if (isHybrid) return "LOCAL_HYBRID";
    if (isRemote) return "LOCAL_REMOTE";
    return "VALENCIA_ONSITE";
  }

  if (isHybrid) return "HYBRID_NON_LOCAL";

  if (isRemote) {
    // Same rule as the scorer's location gate: a written restriction to
    // another country excludes the job unless the posting also allows Spain.
    const description = job?.description ?? "";
    if (hasExplicitNonSpainRestriction(description) && !hasExplicitSpainRemote(description)) {
      return "REMOTE_OTHER_REGION";
    }
    const structuredRegions = (Array.isArray(job?.locationRestrictions) ? job.locationRestrictions : [])
      .map((region) => normalizeText(region));
    if (structuredRegions.some((region) => LISTING_SPAIN_REGIONS.has(region))) return "SPAIN_REMOTE";
    if (structuredRegions.some((region) => STRUCTURED_EUROPE_REGIONS.has(region))) return "EUROPE_REMOTE";
    if (remoteCountryCode === "es") return "SPAIN_REMOTE";
    // Written permission that the scorer's location gate accepts: rank it as
    // the region it opens, not by the country of the job board that listed it.
    if (hasExplicitSpainRemote(description)) return "SPAIN_REMOTE";
    if (hasExplicitEuropeRemote(description) || hasExplicitWorldwideRemote(description)) return "EUROPE_REMOTE";
    if (EUROPE_COUNTRY_CODES.has(remoteCountryCode)) return "EUROPE_REMOTE";
    if (remoteCountryCode === "gb") return "UK_REMOTE";
    if (remoteCountryCode === "ae") return "UAE_REMOTE";
    return "REMOTE_UNKNOWN";
  }

  if (locationCountryCode || hasOnsiteSignal(job)) return "ONSITE_NON_LOCAL";

  return "UNKNOWN";
}

function getLocationScore(job) {
  const category = getLocationCategory(job);

  const scores = {
    LOCAL: {
      score: 27,
      eligible: true,
      reason: "Onsite/local role in Alicante",
    },
    LOCAL_REMOTE: {
      score: 27,
      eligible: true,
      reason: "Remote role based in Alicante or Valencia",
    },
    LOCAL_HYBRID: {
      score: 27,
      eligible: true,
      reason: "Hybrid role in Alicante or Valencia",
    },
    VALENCIA_ONSITE: {
      score: 0,
      eligible: false,
      reason: "Onsite role in Valencia is not eligible; hybrid or remote required",
    },
    SPAIN_REMOTE: {
      score: 24,
      eligible: true,
      reason: "Remote role listed in Spain",
    },
    EUROPE_REMOTE: {
      score: 18,
      eligible: true,
      reason: "Remote role listed in Europe",
    },
    UK_REMOTE: {
      score: 14,
      eligible: true,
      reason: "Remote role listed in the UK",
    },
    UAE_REMOTE: {
      score: 14,
      eligible: true,
      reason: "Remote role listed in the UAE",
    },
    REMOTE_UNKNOWN: {
      score: 10,
      eligible: true,
      reason: "Remote role; country is unclear",
    },
    RESTRICTION_CONFLICT: {
      score: 10,
      eligible: true,
      reason: "Sources give conflicting location restrictions; manual review needed",
    },
    REMOTE_OTHER_REGION: {
      score: 0,
      eligible: false,
      reason: "Remote role is restricted to countries outside the accepted locations",
    },
    HYBRID_NON_LOCAL: {
      score: 0,
      eligible: false,
      reason: "Hybrid role requires presence outside Alicante/Valencia",
    },
    ONSITE_NON_LOCAL: {
      score: 0,
      eligible: false,
      reason: "Non-local role has no confirmed remote option",
    },
    UNKNOWN: {
      score: 0,
      eligible: false,
      reason: "Location and remote compatibility are unclear",
    },
  };

  return { category, ...scores[category] };
}

// ------------------------------------------------------------
// ROLE AND TECHNOLOGY FIT
// ------------------------------------------------------------

function isClearlyExcludedTitle(title) {
  if (containsAny(title, HARD_EXCLUDE_TITLE_TERMS)) return true;

  const hasReactOrNextInTitle = hasReact(title) || hasNextJs(title);
  const hasNonTargetFramework = containsAny(title, NON_TARGET_FRAMEWORK_TERMS);

  return hasNonTargetFramework && !hasReactOrNextInTitle;
}

function getRoleScore(job) {
  const title = getTitleText(job);
  const text = getJobText(job);
  const reasons = [];

  let score = 0;

  const isFrontendTitle = containsAny(title, FRONTEND_TITLE_TERMS);
  const isFullStack = containsAny(title, FULLSTACK_TERMS);
  // "Senior Java Engineer (React)" is a backend role that mentions React; it
  // does not get the React/Next.js title score (the tech score still counts React).
  const isReactNextTitle = (hasReact(title) || hasNextJs(title)) &&
    !(namesNonJsBackend(title) && !isFrontendTitle && !isFullStack);
  const isJavaScriptRole = containsAny(title, JAVASCRIPT_ROLE_TERMS);

  if (isFrontendTitle) {
    score = 35;
    reasons.push("frontend title");
  } else if (isFullStack && hasTargetTech(title)) {
    score = 27;
    reasons.push("full-stack title with target technology");
  } else if (isReactNextTitle) {
    score = 32;
    reasons.push("React/Next.js in title");
  } else if (isJavaScriptRole) {
    score = 20;
    reasons.push("JavaScript role; less specific than React/Next.js");
  } else if (containsAny(title, [
    "web developer", "web engineer", "ui engineer", "ui developer",
    // Same titles in the posting languages the sources return.
    "desarrollador web", "desarrolladora web", "programador web", "programadora web",
    "sviluppatore web", "webentwickler"
  ])) {
    score = 28;
    reasons.push("related web/UI title");
  } else if (hasTargetTech(text)) {
    score = 16;
    reasons.push("target technology appears in job text");
  } else {
    score = 0;
    reasons.push("weak role/title match");
  }

  if (isFullStack) {
    score -= 6;
    reasons.push("full-stack role: lower frontend focus");
  }

  const backendTitleTerms = [
    "backend", "back-end", "back end", "node developer", "node.js developer",
    "nodejs developer", "java developer", "python developer", ".net developer",
    "c# developer", "golang developer", "go developer", "php developer",
  ];

  const titleNamesNonJsBackend = namesNonJsBackend(title);

  const isBackendHeavy =
    (containsAny(title, backendTitleTerms) ||
      titleNamesNonJsBackend ||
      (/\b(node|nodejs)\b/.test(title) && !isFullStack)) &&
    !isFrontendTitle;

  if (isBackendHeavy) {
    score -= 12;
    reasons.push("backend-focused title");
  }

  const hasVueOnly =
    containsAny(title, NON_TARGET_FRAMEWORK_TERMS) && !hasTargetTech(title);

  if (hasVueOnly) {
    score -= 15;
    reasons.push("non-target frontend framework");
  }

  const techReasons = [];
  let techScore = 0;

  if (hasReact(title)) {
    techScore += 12;
    techReasons.push("React in title");
  }

  if (hasNextJs(title)) {
    techScore += 12;
    techReasons.push("Next.js in title");
  }

  if (hasTypeScript(title)) {
    techScore += 5;
    techReasons.push("TypeScript in title");
  }

  if (hasReact(text)) {
    techScore += 5;
    techReasons.push("React in job text");
  }

  if (hasNextJs(text)) {
    techScore += 5;
    techReasons.push("Next.js in job text");
  }

  if (hasTypeScript(text)) {
    techScore += 4;
    techReasons.push("TypeScript in job text");
  }

  const supportingMatches = [
    "javascript", "redux", "redux toolkit", "zustand", "react query",
    "tanstack query", "tailwind", "material ui", "mui", "html", "css",
    "responsive design", "accessibility",
  ].filter((term) => hasPhrase(text, term)).length;

  techScore += Math.min(supportingMatches, 4);

  if (supportingMatches > 0) {
    techReasons.push(
      `${Math.min(supportingMatches, 4)} supporting frontend skill match(es)`,
    );
  }

  return {
    score: Math.max(0, score),
    techScore: Math.min(27, techScore),
    reasons: [...reasons, ...techReasons],
    roleEligible: !isClearlyExcludedTitle(title),
  };
}

// ------------------------------------------------------------
// SENIORITY AND FRESHNESS
// ------------------------------------------------------------

function getSeniorityScore(job) {
  const title = getTitleText(job);

  if (containsAny(title, SENIORITY_PENALTY_TERMS)) {
    return {
      score: -8,
      reason: "principal/staff/architect/leadership level",
    };
  }

  if (containsAny(title, JUNIOR_TERMS)) {
    return {
      score: -4,
      reason: "junior/internship level",
    };
  }

  if (containsAny(title, SENIORITY_GOOD_TERMS) || /\bmid\b/.test(title)) {
    return {
      score: 8,
      reason: "mid/senior level",
    };
  }

  return {
    score: 4,
    reason: "seniority not specified",
  };
}

function hasRejectedSeniorityTitle(job) {
  return containsAny(getTitleText(job), REJECT_SENIORITY_TITLE_TERMS);
}

// Section headings in postings. Lines after an optional heading ("Nice to
// have:", "Se valorará:") are optional until a required heading appears.
const OPTIONAL_HEADINGS = "nice to have|nice-to-have|bonus|bonus points|preferred|preferred qualifications|desirable|ideally|optional|pluses|extra points|deseable|deseables|se valorara|se valora|valorable|valoraremos|plus|gradito|graditi|wunschenswert";
const REQUIRED_HEADINGS = "requirements|required|must have|must-haves|what you bring|what we expect|qualifications|requisitos|requisitos minimos|imprescindible|requisiti|anforderungen|your profile|who you are";
export const OPTIONAL_SECTION_HEADER = new RegExp(`^(${OPTIONAL_HEADINGS})\\b`);
export const REQUIRED_SECTION_HEADER = new RegExp(`^(${REQUIRED_HEADINGS})\\b`);
const OPTIONAL_HEADING_ONLY = new RegExp(`^(${OPTIONAL_HEADINGS})$`);
const REQUIRED_HEADING_ONLY = new RegExp(`^(${REQUIRED_HEADINGS})$`);

// Returns "optional" / "required" when the segment is a section heading: a
// short line ending with ":" ("Nice to have:", "Se valorará:") or the bare
// heading phrase alone. A sentence such as "Se valorará experiencia con AWS."
// is not a heading (its own wording is handled as optional elsewhere).
export function sectionHeading(segment) {
  const raw = String(segment ?? "").trim();
  if (!raw || raw.length > 60 || /\d/.test(raw)) return null;
  const endsWithColon = /[:：]\s*$/.test(raw);
  const heading = raw.replace(/^[-*–—\s]+/, "").replace(/[:：\-–—]+\s*$/, "").trim();
  if (endsWithColon ? OPTIONAL_SECTION_HEADER.test(heading) : OPTIONAL_HEADING_ONLY.test(heading)) return "optional";
  if (endsWithColon ? REQUIRED_SECTION_HEADER.test(heading) : REQUIRED_HEADING_ONLY.test(heading)) return "required";
  return null;
}

const YEARS_OPTIONAL_CUE =
  /\b(preferred|preferably|nice to have|a plus|bonus|desirable|ideally|optional|deseable|valorable|se valorara)\b/;

// Reads years-of-experience statements from a description. `requiredMinimum`
// is the largest explicitly required minimum (null if none); for ranges such
// as "3-5 years" the lower bound counts. `optionalYears` lists numbers that
// only appear in preferred/optional wording ("5+ years preferred").
export function analyzeYearsRequirements(description = "") {
  const segments = String(description ?? "").split(
    /(?<!\d)\.(?!\d)|[\n\r;•]/
  );
  let requiredMinimum = null;
  const optionalYears = new Set();
  let section = null;

  for (const raw of segments) {
    const segment = normalizeText(raw);
    if (!segment) continue;

    const heading = sectionHeading(segment);
    if (heading) {
      section = heading;
      continue;
    }

    // Everything listed under "Nice to have:" / "Se valorará:" is optional,
    // including "5+ years of experience".
    if (section === "optional") {
      for (const match of segment.matchAll(YEARS_PATTERN)) optionalYears.add(Number(match[1]));
      continue;
    }

    if (YEARS_NON_REQUIREMENT_CUE.test(segment)) {
      if (YEARS_OPTIONAL_CUE.test(segment)) {
        for (const match of segment.matchAll(YEARS_PATTERN)) optionalYears.add(Number(match[1]));
      }
      continue;
    }

    const strong = YEARS_STRONG_CUE.test(segment);
    const hasExperience = /\b(experience|experiencia)\b/.test(segment);
    if (!(strong || YEARS_REQUIREMENT_CUE.test(segment)) || !(strong || hasExperience)) {
      continue;
    }

    for (const match of segment.matchAll(YEARS_PATTERN)) {
      const years = Number(match[1]);
      if (requiredMinimum === null || years > requiredMinimum) requiredMinimum = years;
    }
  }

  return { requiredMinimum, optionalYears: [...optionalYears] };
}

// Only an explicit, required minimum counts. For ranges such as "3-5 years"
// the lower bound is the minimum.
function getExplicitMinimumYears(job) {
  return analyzeYearsRequirements(job?.description ?? "").requiredMinimum;
}

function getFreshnessScore(job, now = Date.now()) {
  const created = job?.created ? Date.parse(job.created) : NaN;

  if (!Number.isFinite(created)) {
    return { score: 0, reason: "posting date unavailable" };
  }

  const ageDays = (now - created) / (24 * 60 * 60 * 1000);

  if (ageDays < 0) {
    return {
      score: 0,
      reason: "posting date is in the future; no freshness bonus",
    };
  }

  if (ageDays <= 7) return { score: 3, reason: "posted within 7 days" };
  if (ageDays <= 14) return { score: 2, reason: "posted within 14 days" };
  if (ageDays <= 30) return { score: 1, reason: "posted within 30 days" };

  return { score: 0, reason: "older posting" };
}

// ------------------------------------------------------------
// PUBLIC RANKING API
// ------------------------------------------------------------

export function preRankJob(job = {}) {
  const location = getLocationScore(job);
  const role = getRoleScore(job);
  const seniority = getSeniorityScore(job);
  const freshness = getFreshnessScore(job);
  const seniorityRejected = hasRejectedSeniorityTitle(job);
  const minimumYears = getExplicitMinimumYears(job);
  const experienceRejected =
    minimumYears !== null && minimumYears > MAX_ACCEPTED_MINIMUM_YEARS;
  const roleEligible =
    role.roleEligible && !seniorityRejected && !experienceRejected;

  const rawScore =
    role.score +
    role.techScore +
    location.score +
    seniority.score +
    freshness.score;

  const score = Math.max(0, Math.min(100, rawScore));

  const reasons = [
    ...role.reasons,
    location.reason,
    seniority.reason,
    freshness.reason,
  ];

  if (!location.eligible) reasons.push("LOCATION INELIGIBLE");
  if (!role.roleEligible) reasons.push("ROLE INELIGIBLE");
  if (seniorityRejected) {
    reasons.push("ROLE INELIGIBLE: lead/principal/staff/intern title");
  }
  if (experienceRejected) {
    reasons.push(`ROLE INELIGIBLE: requires ${minimumYears}+ years of experience`);
  }

  return {
    ...job,
    preRank: {
      score,
      eligible: location.eligible,
      roleEligible,
      locationCategory: location.category,
      roleScore: role.score,
      techScore: role.techScore,
      locationScore: location.score,
      seniorityScore: seniority.score,
      freshnessScore: freshness.score,
      reasons,
    },
  };
}

export function preRankJobs(jobs = []) {
  return jobs
    .map((job) => preRankJob(job))
    .sort((a, b) => {
      if (a.preRank.eligible !== b.preRank.eligible) {
        return a.preRank.eligible ? -1 : 1;
      }

      if (a.preRank.roleEligible !== b.preRank.roleEligible) {
        return a.preRank.roleEligible ? -1 : 1;
      }

      if (b.preRank.score !== a.preRank.score) {
        return b.preRank.score - a.preRank.score;
      }

      return getTitleText(a).localeCompare(getTitleText(b));
    });
}

const TRACKING_PARAM = /^(utm_.*|gclid|fbclid|msclkid|mc_cid|mc_eid|ref|refid|referrer|trk|se|v)$/;

// Strips fragments, trailing slashes and tracking parameters only. Other query
// parameters may identify the posting, so they are kept (sorted) in the key.
export function normalizeUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const params = [...url.searchParams.entries()]
      .filter(([name]) => !TRACKING_PARAM.test(name.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, val]) => `${name}=${val}`)
      .join("&");
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.toLowerCase()}${path}${params ? `?${params}` : ""}`;
  } catch {
    return raw.toLowerCase().split("#")[0].split("?")[0].replace(/\/$/, "");
  }
}

// Legal forms and filler words that do not identify a company.
const COMPANY_NOISE_WORDS = new Set([
  "the", "el", "la", "los", "las", "grupo", "group", "groupe", "gruppo",
  "sl", "slu", "sa", "sau", "sll", "s", "l", "a", "u", "ltd", "limited", "llc", "inc", "incorporated",
  "corp", "corporation", "co", "company", "plc", "gmbh", "ag", "kg", "ug", "bv", "nv", "srl", "spa",
  "sas", "sarl", "ab", "oy", "as", "aps", "pty", "lp", "llp"
]);

// First distinctive word of a normalized company name: "txp technology x
// people" -> "txp", "the acme group ltd" -> "acme". Very short roots (1-2
// letters) are not distinctive enough, so the first two words are used.
export function companyRoot(company) {
  const words = String(company ?? "").split(" ").filter((word) => word && !COMPANY_NOISE_WORDS.has(word));
  if (!words.length) return "";
  return words[0].length >= 3 ? words[0] : words.slice(0, 2).join(" ");
}

function getDeduplicationKeys(job) {
  const keys = [];
  const id = normalizeText(job?.id ?? "");
  const url = normalizeUrl(job?.url);
  const title = getTitleText(job).replace(/[^a-z0-9]+/g, " ").trim();
  const company = normalizeText(job?.company ?? "").replace(/[^a-z0-9]+/g, " ").trim();
  const location = getLocationText(job).replace(/[^a-z0-9]+/g, " ").trim();

  if (id) keys.push(`id:${id}`);
  if (url) keys.push(`url:${url}`);
  // The same remote posting is listed on several country-specific job boards with
  // different IDs and URLs. Identical title, company and description text identify it;
  // local and hybrid jobs are excluded so distinct cities are never merged.
  const fingerprint = normalizeText(job?.description ?? "").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 200);
  if (job?.remote === true && job?.hybrid !== true && title && fingerprint.length >= 80 &&
      company && !["unknown", "n a", "not available"].includes(company)) {
    keys.push(`remote-text:${title}|${company}|${fingerprint}`);
    // The same posting is often listed under a short and a long company name
    // ("TXP" / "TXP Technology x People"). With an identical title and an
    // identical description start, the company's root name is enough.
    const root = companyRoot(company);
    if (root) keys.push(`remote-text-root:${title}|${root}|${fingerprint}`);
  }
  // The title fallback applies only when no URL identifies the actual posting.
  if (!url && title && company && !["unknown", "n a", "not available"].includes(company)) {
    keys.push(`role:${title}|${company}|${location}`);
  }

  return keys.length ? keys : [`fallback:${title}|${company}|${location}`];
}

function getSourceReference(job) {
  return { source: job?.source ?? null, id: job?.id ?? null, url: job?.url ?? null };
}

function mergeDuplicate(kept, duplicate) {
  const keptLength = String(kept.description ?? "").length;
  const duplicateLength = String(duplicate.description ?? "").length;
  const richer = duplicateLength > keptLength ? duplicate : kept;
  const references = [...(kept.sourceInfoList ?? [getSourceReference(kept)]), getSourceReference(duplicate)];
  const distinct = new Map(references.map((ref) => [`${ref.source}|${ref.id}|${ref.url}`, ref]));

  // Each source's own restriction list is kept; differing lists are a conflict, never a union.
  const mergeSets = (setsField, listField) => {
    const all = [kept, duplicate].flatMap((job) =>
      job[setsField] ?? (job[listField]?.length ? [job[listField]] : [])
    );
    const distinctSets = new Map(
      all.map((set) => [[...new Set(set.map(normalizeText))].sort().join("|"), set])
    );
    return [...distinctSets.values()];
  };
  const locationSets = mergeSets("locationRestrictionSets", "locationRestrictions");
  const timezoneSets = mergeSets("timezoneRestrictionSets", "timezoneRestrictions");
  const restrictionConflict =
    kept.restrictionConflict === true ||
    duplicate.restrictionConflict === true ||
    locationSets.length > 1;
  // Timezone disagreement is tracked separately so the agreed location list survives.
  const timezoneConflict =
    kept.timezoneConflict === true ||
    duplicate.timezoneConflict === true ||
    timezoneSets.length > 1;
  const attributions = [...new Set([kept.sourceAttribution, duplicate.sourceAttribution].filter(Boolean))];
  const sources = [...new Set([...distinct.values()].map((ref) => ref.source).filter(Boolean))];

  // Structured restrictions and provenance come from every source, never only the richer record.
  return {
    ...richer,
    sourceInfoList: [...distinct.values()],
    sources,
    sourceAttribution: attributions.length ? attributions.join("; ") : null,
    locationRestrictions: restrictionConflict ? [] : (locationSets[0] ?? []),
    timezoneRestrictions: restrictionConflict || timezoneConflict ? [] : (timezoneSets[0] ?? []),
    locationRestrictionSets: locationSets,
    timezoneRestrictionSets: timezoneSets,
    restrictionConflict,
    timezoneConflict
  };
}

// Keeps one record per duplicate group at the position of its first occurrence.
// The record with the longer description wins, and every source reference is kept
// in `sourceInfoList`. Jobs without duplicates are returned unchanged.
export function deduplicateJobs(jobs = []) {
  const indexByKey = new Map();
  const unique = [];

  for (const job of jobs) {
    const keys = getDeduplicationKeys(job);
    const matchKey = keys.find((key) => indexByKey.has(key));

    if (matchKey === undefined) {
      keys.forEach((key) => indexByKey.set(key, unique.length));
      unique.push(job);
      continue;
    }

    const index = indexByKey.get(matchKey);
    unique[index] = mergeDuplicate(unique[index], job);
    keys.forEach((key) => {
      if (!indexByKey.has(key)) indexByKey.set(key, index);
    });
  }

  return unique;
}

export function selectTopJobs(jobs = [], limit = 15) {
  const maxJobs = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 15;

  if (maxJobs === 0) return [];

  const ranked = preRankJobs(jobs);
  const seen = new Set();
  const selected = [];

  for (const job of ranked) {
    if (!job.preRank.eligible || !job.preRank.roleEligible) continue;

    const keys = getDeduplicationKeys(job);

    if (keys.some((key) => seen.has(key))) continue;

    for (const key of keys) seen.add(key);
    selected.push(job);

    if (selected.length >= maxJobs) break;
  }

  return selected;
}

export const preRankerConfig = {
  localCities: ["Alicante", "Valencia"],
  remoteCountryPriority: ["Spain", "Europe", "UK", "UAE", "unknown"],
  hardExcludeTitleTerms: HARD_EXCLUDE_TITLE_TERMS,
};
