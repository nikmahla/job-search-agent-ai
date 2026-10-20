import fs from "node:fs/promises";
import {
  LISTING_SPAIN_REGIONS,
  LISTING_OPEN_REGIONS,
  LISTING_KNOWN_OTHER_COUNTRIES,
  structuredRestrictionVerdict,
  hasExplicitNonSpainRestriction,
  hasExplicitSpainRemote,
  hasExplicitWorldwideRemote,
  hasExplicitEuropeRemote
} from "./job-source-rules.js";
import {
  analyzeTechText,
  buildCandidateTechEvidence,
  findMentions,
  isRequirementSentence,
  namesNonJsBackend,
  pureTechId,
  techDisplayName
} from "./tech-lexicon.js";
import { analyzeYearsRequirements } from "./job-pre-ranker.js";

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\.js\b/g, "js")
    .replace(/\+/g, " ")
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textIncludes(text, phrase) {
  return normalize(text).includes(normalize(phrase));
}

function containsNormalizedPhrase(text, phrase) {
  const normalizedText = normalize(text);
  const normalizedPhrase = normalize(phrase);

  if (!normalizedPhrase) return false;

  const escapedPhrase = normalizedPhrase.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  return new RegExp(
    `(^|[^a-z0-9])${escapedPhrase}(?=$|[^a-z0-9])`,
    "i"
  ).test(normalizedText);
}

function getCandidateSkills(candidate) {
  return Object.values(candidate.skills ?? {})
    .flat()
    .map(normalize)
    .filter(Boolean);
}

function getCandidateFunctions(candidate) {
  return (candidate.experience ?? [])
    .flatMap((item) => item.functions ?? [])
    .map(normalize)
    .filter(Boolean);
}

function getCandidateRoles(candidate) {
  return (candidate.experience ?? [])
    .flatMap((item) => [
      item.role,
      ...(item.functions ?? [])
    ])
    .map(normalize)
    .filter(Boolean);
}

const AI_TOOL_EVIDENCE = [
  "github copilot", "copilot", "cursor", "ai assisted", "ai tools",
  "ai coding", "claude code", "chatgpt"
];
const AI_API_EVIDENCE = [
  "llm", "openai", "ai api", "ai integration", "llm api"
];

// Returns null when the target is not an AI requirement, so normal matching
// applies. Otherwise credit requires matching evidence in the candidate profile.
function matchAiRequirement(target, allEvidence) {
  const hasEvidence = (terms) =>
    allEvidence.some((value) =>
      terms.some((term) => containsNormalizedPhrase(value, term))
    );

  if (/\b(llm|openai|ai api|ai apis|ai integration)\b/.test(target)) {
    return hasEvidence(AI_API_EVIDENCE) ? "SEMANTIC" : "MISSING";
  }
  if (/\bai (assisted|tools?|development|coding)\b/.test(target)) {
    return hasEvidence(AI_TOOL_EVIDENCE) ? "SEMANTIC" : "MISSING";
  }
  if (target === "ai" || target === "artificial intelligence") {
    return hasEvidence([...AI_TOOL_EVIDENCE, ...AI_API_EVIDENCE])
      ? "PARTIAL"
      : "MISSING";
  }
  // Other AI-specific wording (e.g. "Vercel AI SDK") has no evidence category;
  // never let it match unrelated candidate skills by substring.
  if (/\bai\b/.test(target)) return "MISSING";
  return null;
}

// Local to skill matching: fold simple plurals so "design systems" equals
// "design system". The shared normalize() is intentionally not changed.
function foldPlural(token) {
  return token.length > 3 && token.endsWith("s") && !token.endsWith("ss")
    ? token.slice(0, -1)
    : token;
}

function skillTokens(value) {
  return normalize(value)
    .replace(/\bfront end\b/g, "frontend")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(foldPlural)
    .map((token) => (token === "testing" ? "test" : token));
}

// Words that do not make a requirement a different skill ("Next.js 14", "React framework").
// Folded the same way as skill tokens so plural forms ("principles") match.
const GENERIC_QUALIFIERS = new Set([
  "development", "developer", "framework", "library", "api", "web",
  "methodology", "methodologies", "practices", "principles"
].map(foldPlural));

// Requirements that are a core part of a technology, credited as partial only
// when the candidate explicitly lists that technology.
const PARTIAL_SUB_SKILLS = {
  "react hooks": "react",
  "css modules": "css"
};

function findTokenSpan(haystack, needle) {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((token, offset) => haystack[i + offset] === token)) return i;
  }
  return -1;
}

// Token-based comparison instead of character substrings.
function matchSkillTokens(targetTokens, valueTokens) {
  if (!targetTokens.length || !valueTokens.length) return null;

  if (targetTokens.join(" ") === valueTokens.join(" ")) return "SEMANTIC";

  // Broader requirement than the candidate skill: the requirement must cover
  // at least half of the skill ("JWT" vs "JWT Authentication", not "App").
  if (findTokenSpan(valueTokens, targetTokens) !== -1) {
    return targetTokens.length * 2 >= valueTokens.length ? "PARTIAL" : null;
  }

  // More specific requirement than the candidate skill: only versions or
  // generic qualifiers may be added ("WCAG 2.1"; not "E2E testing").
  const start = findTokenSpan(targetTokens, valueTokens);
  if (start !== -1) {
    const extras = [
      ...targetTokens.slice(0, start),
      ...targetTokens.slice(start + valueTokens.length)
    ];
    if (extras.every((token) => /^\d+$/.test(token) || GENERIC_QUALIFIERS.has(token))) {
      return "PARTIAL";
    }
  }

  return null;
}

function hasCandidateSkill(candidate, item) {
  const target = normalize(item);
  if (!target) return "MISSING";

  const skills = getCandidateSkills(candidate);
  const functions = getCandidateFunctions(candidate);
  const roles = getCandidateRoles(candidate);

  const allEvidence = [
    ...skills,
    ...functions,
    ...roles
  ];

  if (allEvidence.some((value) => value === target)) {
    return "EXACT";
  }

  // AI requirements are credited only from candidate evidence, never from
  // substring overlap such as "ai" inside "tailwind" or "maintain".
  const aiMatch = matchAiRequirement(target, allEvidence);
  if (aiMatch) return aiMatch;

  const equivalents = {
    "reactjs": ["react"],
    "react": ["reactjs"],
    "restful apis": ["rest apis"],
    "rest apis": ["restful apis"],
    "javascript": ["javascript es6"],
    "javascript es6": ["javascript"],
    "html5": ["html"],
    "html": ["html5"],
    "css3": ["css"],
    "css": ["css3"],
    "redux": ["redux toolkit"],
    "redux toolkit": ["redux"]
  };

  const equivalentTargets = equivalents[target] ?? [];

  if (
    equivalentTargets.some((equivalent) =>
      allEvidence.includes(normalize(equivalent))
    )
  ) {
    return "SEMANTIC";
  }

  const targetTokens = skillTokens(target);
  let best = null;
  for (const value of allEvidence) {
    const status = matchSkillTokens(targetTokens, skillTokens(value));
    if (status === "SEMANTIC") return status;
    if (status) best = status;
  }
  if (best) return best;

  // Sub-skills of a technology the candidate explicitly lists.
  const base = PARTIAL_SUB_SKILLS[target];
  if (base && allEvidence.some((value) => skillTokens(value).join(" ") === base)) {
    return "PARTIAL";
  }

  return "MISSING";
}

function matchScore(status) {
  if (status === "EXACT") return 1;
  if (status === "SEMANTIC") return 0.9;
  if (status === "PARTIAL") return 0.5;
  return 0;
}

// ------------------------------------------------------------
// Requirement-sentence matching
// ------------------------------------------------------------

const candidateTechCache = new WeakMap();

// Technology evidence actually present in the candidate profile (skills,
// experience functions and roles). Never inferred from the job.
function getCandidateTechEvidence(candidate) {
  if (candidate && typeof candidate === "object" && candidateTechCache.has(candidate)) {
    return candidateTechCache.get(candidate);
  }
  const rawEvidence = [
    ...Object.values(candidate?.skills ?? {}).flat(),
    ...(candidate?.experience ?? []).flatMap((item) => [item.role, ...(item.functions ?? [])])
  ].filter((value) => typeof value === "string");
  const evidence = buildCandidateTechEvidence(rawEvidence);
  if (candidate && typeof candidate === "object") candidateTechCache.set(candidate, evidence);
  return evidence;
}

const candidatePureTechCache = new WeakMap();

function getCandidatePureTechIds(candidate) {
  if (candidate && typeof candidate === "object" && candidatePureTechCache.has(candidate)) {
    return candidatePureTechCache.get(candidate);
  }
  const ids = new Set(
    [
      ...Object.values(candidate?.skills ?? {}).flat(),
      ...(candidate?.experience ?? []).flatMap((item) => item.functions ?? [])
    ]
      .filter((value) => typeof value === "string")
      .map(pureTechId)
      .filter(Boolean)
  );
  if (candidate && typeof candidate === "object") candidatePureTechCache.set(candidate, ids);
  return ids;
}

function statusForScore(score) {
  if (score >= 0.9) return "SEMANTIC";
  if (score > 0) return "PARTIAL";
  return "MISSING";
}

// Reads a requirement sentence as groups of technologies: alternatives
// ("Redux, Zustand or similar") need one match; other lists need every item.
// Generic area words ("frontend", "backend development") only count when the
// line names no concrete technology: in "frontend frameworks such as Vue or
// Angular" the requirement is Vue/Angular, not frontend experience in general.
const CONCEPT_TECH_IDS = new Set(["frontend", "backend-development"]);

function evaluateTechSentence(candidate, text) {
  const analyzed = analyzeTechText(text).groups;
  const hasConcrete = analyzed.some((group) => group.ids.some((id) => !CONCEPT_TECH_IDS.has(id)));
  const groups = hasConcrete
    ? analyzed
      .map((group) => ({ ...group, ids: group.ids.filter((id) => !CONCEPT_TECH_IDS.has(id)) }))
      .filter((group) => group.ids.length)
    : analyzed;
  if (!groups.length) return null;

  const evidence = getCandidateTechEvidence(candidate);
  const matched = [];
  const missing = [];

  const groupScores = groups.map((group) => {
    const scores = group.ids.map((id) => evidence.get(id) ?? 0);
    group.ids.forEach((id, index) => {
      if (scores[index] > 0) matched.push(techDisplayName(id));
    });
    if (group.anyOf) {
      const best = Math.max(...scores);
      if (best === 0) missing.push(group.ids.map(techDisplayName).join(" / "));
      return best;
    }
    group.ids.forEach((id, index) => {
      if (scores[index] === 0) missing.push(techDisplayName(id));
    });
    return scores.reduce((sum, value) => sum + value, 0) / scores.length;
  });

  const score = groupScores.reduce((sum, value) => sum + value, 0) / groupScores.length;
  return {
    status: statusForScore(score),
    score,
    matched: [...new Set(matched)],
    missing: [...new Set(missing)],
    method: "sentence"
  };
}

function isAiRequirement(text) {
  return /\b(ai|llm|llms|openai|artificial intelligence)\b/.test(normalize(text));
}

// One evaluator for every place that compares a job item with the candidate.
// Atomic skill names keep the established token matcher; requirement
// sentences are read through the technology lexicon. AI wording always stays
// on the dedicated evidence rules so "Vercel AI SDK" is never credited by Vercel.
function evaluateRequirementItem(candidate, item, { forceSentence = false } = {}) {
  const atomicStatus = hasCandidateSkill(candidate, item);
  const atomic = {
    status: atomicStatus,
    score: matchScore(atomicStatus),
    matched: atomicStatus === "MISSING" ? [] : [String(item)],
    missing: atomicStatus === "MISSING" ? [String(item)] : [],
    method: "atomic"
  };

  if (atomicStatus === "EXACT" || atomicStatus === "SEMANTIC") return atomic;
  if (isAiRequirement(item)) return atomic;

  // Spelling variant of a technology the candidate lists by name
  // ("React JS" for "React"): both sides must be a bare technology name.
  const variantId = pureTechId(item);
  if (variantId && getCandidatePureTechIds(candidate).has(variantId)) {
    return { status: "SEMANTIC", score: matchScore("SEMANTIC"), matched: [String(item)], missing: [], method: "variant" };
  }
  // Read as a sentence when it is one, or when the atomic matcher found
  // nothing although the line names a technology ("modern JavaScript (ES6+)",
  // "Familiarità con API REST"). Atomic partial scores ("React 18") are kept.
  const namesTechnology = findMentions(item).mentions.length > 0;
  const readAsSentence = forceSentence || isRequirementSentence(item) ||
    (atomicStatus === "MISSING" && namesTechnology);
  if (!readAsSentence) return atomic;

  return evaluateTechSentence(candidate, item) ?? atomic;
}

function requirementText(requirement) {
  return typeof requirement === "string" ? requirement : requirement?.item;
}

function getPriorityWeight(priority = "important") {
  const weights = {
    critical: 1,
    important: 0.8,
    secondary: 0.6,
    preferred: 0.4
  };

  return weights[normalize(priority)] ?? 0.6;
}

// Language names in English and in the posting languages the sources return
// (Spanish, Italian, German, French), after accent folding.
const LANGUAGE_NAMES = [
  "english|spanish|french|german|italian|portuguese|dutch|catalan|russian|arabic|polish",
  "ingles|espanol|castellano|frances|aleman|italiano|portugues|catalan|valenciano|ruso",
  "inglese|spagnolo|francese|tedesco|russo",
  "englisch|spanisch|franzosisch|deutsch|italienisch|russisch",
  "anglais|espagnol|allemand|italien"
].join("|");
const NON_TECHNICAL_TYPES = /^(language|soft|soft[ _-]?skill|experience|years|title|role|education|degree|qualification)s?$/;

// Classifies a requirement line. Only "technical" lines may count towards the
// technical score or the missing technical skills; years, languages, soft skills
// and job titles are handled by their own gates or are not skills at all.
export function classifyRequirement(requirement) {
  const raw = typeof requirement === "string" ? requirement : requirement?.item;
  const type = typeof requirement === "string" ? "" : normalize(requirement?.type ?? "");
  const text = normalize(raw);

  if (!text) return "empty";
  if (NON_TECHNICAL_TYPES.test(type)) return type.includes("language") ? "language" : "non-technical";

  const languageName = new RegExp(`\\b(${LANGUAGE_NAMES})\\b`);
  // A mixed line such as "React y buen nivel de inglés" stays technical so the
  // React part is scored; the language part is handled by the language gate.
  const mentionsTechnology = findMentions(raw).mentions.length > 0;
  if (
    !mentionsTechnology &&
    languageName.test(text) &&
    (text.split(" ").length <= 3 ||
      /\b(language|fluent|fluency|command|proficien\w*|native|bilingual|spoken|written|speaking|level|c1|c2|b1|b2|nivel|idioma|conocimiento|conoscenza|lingua|livello|scritto|parlato|kenntnisse|sprache|niveau|langue|buena|buen|buona|ottima)\b/.test(text))
  ) {
    return "language";
  }

  // "3+ years of experience ..." statements; a skill with a duration suffix
  // such as "React 3 years" is not matched and stays technical.
  if (
    /^(at least |minimum |min |over |more than )?\d+\s*\+?\s*(years?|yrs?)\b/.test(text) ||
    /\b\d+\s*\+?\s*(years?|yrs?) of\b/.test(text) ||
    /\byears? of (professional |relevant |hands on |work |commercial )?experience\b/.test(text)
  ) {
    return "experience";
  }

  if (
    /\b(independent|self (managed|motivated|starter|driven)|motivated|team ?work|team player|collaborat\w*|interpersonal|proactive|attention to detail|time management|adaptab\w*|leadership|passionate|curious|problem solving|(written|verbal|strong|excellent|good) communication|communication skills)\b/.test(text) ||
    // Spanish / Italian / German / French soft-skill wording.
    /\b(trabajo en equipo|capacidad de (trabajo|comunicacion|aprendizaje|analisis)|habilidades (comunicativas|de comunicacion)|proactiv[oa]|autonomia|lavoro (in|di) (team|squadra)|propensione|capacita (di|comunicative|relazionali)|teamfahigkeit|kommunikationsfahigkeit|travail en equipe|esprit d equipe)\b/.test(text)
  ) {
    return "soft-skill";
  }

  const isTitle = /^((senior|junior|lead|mid|principal|staff) )?([a-z]+ ){0,2}(developer|engineer|programmer|architect)$/.test(text) &&
    !/\b(experience|skills?|knowledge|proficien\w*)\b/.test(text);
  if (isTitle) return "title";

  return "technical";
}

// Technical lines are scored as skills. A years-of-experience line that names
// technologies ("3+ years of experience with React") contributes only those
// technologies; the number of years stays with the experience gate.
function technicalRequirementsOnly(items) {
  return items
    .map((item) => {
      const kind = classifyRequirement(item);
      if (kind === "technical") return { requirement: item, forceSentence: false };
      const declaredType = typeof item === "string" ? "" : normalize(item?.type ?? "");
      const isYearsLine = kind === "experience" ||
        (kind === "non-technical" && /^(experience|years?)$/.test(declaredType));
      if (isYearsLine && findMentions(requirementText(item) ?? "").mentions.length) {
        return { requirement: item, forceSentence: true };
      }
      return null;
    })
    .filter(Boolean);
}

function scoreRequirements(candidate, job) {
  const required = technicalRequirementsOnly(job.requirements?.required ?? []);
  const preferred = technicalRequirementsOnly(job.requirements?.preferred ?? []);
  const evaluations = [];

  function weightedScore(entries, isRequired) {
    if (!entries.length) return null;

    let total = 0;
    let possible = 0;

    for (const { requirement, forceSentence } of entries) {
      const item = requirementText(requirement);

      const priority =
        typeof requirement === "string"
          ? "important"
          : requirement.priority;

      if (!item) continue;

      const weight = getPriorityWeight(priority);
      const evaluation = evaluateRequirementItem(candidate, item, { forceSentence });
      evaluations.push({ item, required: isRequired, priority: priority ?? "important", ...evaluation });

      total += evaluation.score * weight;
      possible += weight;
    }

    if (!possible) return null;

    return (total / possible) * 100;
  }

  const requiredScore = weightedScore(required, true);
  const preferredScore = weightedScore(preferred, false);

  let score;

  if (requiredScore !== null && preferredScore !== null) {
    score = requiredScore * 0.8 + preferredScore * 0.2;
  } else {
    score = requiredScore ?? preferredScore;
  }

  return {
    score,
    requiredScore,
    preferredScore,
    required: required.map(({ requirement }) => requirement),
    preferred: preferred.map(({ requirement }) => requirement),
    evaluations
  };
}

function scoreExperience(candidate, job) {
  const minimumYears = job.experience?.minimumYears;

  let yearsScore = null;

  if (typeof minimumYears === "number") {
    const candidateYears =
      candidate.candidate?.experienceYears ?? 0;

    yearsScore = Math.min(
      (candidateYears / minimumYears) * 100,
      100
    );
  }

  const requiredFunctions =
    job.experience?.requiredFunctions ?? [];

  let functionScore = null;

  if (requiredFunctions.length) {
    const matches = requiredFunctions.map((item) => {
      const name =
        typeof item === "string"
          ? item
          : item.item;

      return name ? evaluateRequirementItem(candidate, name).score : 0;
    });

    functionScore =
      (matches.reduce((a, b) => a + b, 0) /
        matches.length) *
      100;
  }

  let score = null;

  if (yearsScore !== null && functionScore !== null) {
    score =
      yearsScore * 0.4 +
      functionScore * 0.6;
  } else {
    score = yearsScore ?? functionScore;
  }

  return {
    score,
    yearsScore,
    functionScore
  };
}

function scoreResponsibilities(candidate, job) {
  const responsibilities = [
    ...(job.responsibilities?.core ?? []),
    ...(job.responsibilities?.secondary ?? [])
  ];

  if (!responsibilities.length) {
    return {
      score: null,
      matches: []
    };
  }

  const candidateEvidence = [
    ...getCandidateSkills(candidate),
    ...getCandidateFunctions(candidate),
    ...getCandidateRoles(candidate)
  ];

  const evidenceText = candidateEvidence.join(" ");

  const responsibilityAliases = {
    "develop frontend applications": [
      "frontend development",
      "frontend developer",
      "react development",
      "next js development"
    ],

    "build reusable ui components": [
      "react",
      "frontend development",
      "reusable user interfaces",
      "reusable ui"
    ],

    "work with apis": [
      "rest apis",
      "restful apis",
      "rest api integration"
    ],

    "participate in code reviews": [
      "code review"
    ],

    "collaborate with an agile development team": [
      "agile",
      "agile development"
    ],

    "work in an agile development team": [
      "agile",
      "agile development"
    ],

    "develop react applications": [
      "react development",
      "react"
    ],

    "build user interfaces": [
      "frontend development",
      "react",
      "next js"
    ],

    "maintain and improve frontend code": [
      "frontend development",
      "performance optimization",
      "code review"
    ],

    "integrate apis": [
      "rest apis",
      "rest api integration"
    ],

    "write automated tests": [
      "vitest",
      "react testing library",
      "testing"
    ],

    "write frontend tests": [
      "vitest",
      "react testing library",
      "testing"
    ]
  };

  // Whole-word stems: "develop" matches "development", but "java" never
  // matches inside "javascript".
  const stem = (word) => word.replace(/(ments?|ing|ed|ers?|s)$/, "") || word;
  const evidenceStems = new Set(
    evidenceText.split(/[^a-z0-9]+/).filter(Boolean).map(stem)
  );

  const matches = responsibilities.map((responsibility) => {
    const normalized = normalize(responsibility);

    // Exact responsibility evidence
    if (evidenceText.includes(normalized)) {
      return {
        responsibility,
        status: "EXACT",
        score: 1
      };
    }

    // A responsibility that names technologies is judged on those
    // technologies: "Build UIs with React" vs "Maintain Java microservices".
    const techResult = findMentions(responsibility).mentions.length
      ? evaluateTechSentence(candidate, responsibility)
      : null;
    if (techResult) {
      return {
        responsibility,
        status: techResult.status,
        score: techResult.score,
        matched: techResult.matched,
        missing: techResult.missing
      };
    }

    // Semantic aliases
    const aliases =
      responsibilityAliases[normalized] ?? [];

    const matchedAliases = aliases.filter((alias) =>
      candidateEvidence.some(
        (evidence) =>
          evidence === normalize(alias) ||
          evidence.includes(normalize(alias)) ||
          normalize(alias).includes(evidence)
      )
    );

    if (matchedAliases.length > 0) {
      return {
        responsibility,
        status: "SEMANTIC",
        score: matchScore("SEMANTIC"),
        matched: matchedAliases
      };
    }

    // Keyword-based partial match on whole-word stems
    const keywords = normalized
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3);

    const matchedKeywords = keywords.filter((word) =>
      evidenceStems.has(stem(word))
    );

    if (
      keywords.length > 0 &&
      matchedKeywords.length >=
        Math.ceil(keywords.length * 0.4)
    ) {
      return {
        responsibility,
        status: "PARTIAL",
        score: matchScore("PARTIAL"),
        matched: matchedKeywords
      };
    }

    return {
      responsibility,
      status: "MISSING",
      score: 0
    };
  });

  const score =
    (matches.reduce(
      (sum, item) => sum + item.score,
      0
    ) /
      matches.length) *
    100;

  return {
    score,
    matches
  };
}

const DEGREE_REQUIREMENT = /\b(degree|bachelor\w*|bsc|b sc|master\w*|msc|m sc|ph ?d|doctorate|university|licenciatura|grado|titulacion|titulo universitario|ingenieria|laurea|diploma|studium|hochschulabschluss)\b/;
const COMPUTING_FIELD = /\b(computer|computing|informatics|informatica|informatik|software|engineering|ingenieria|ingegneria|telecommunication\w*|telecomunicacion\w*|technical|tecnic[oa]|stem|related|equivalent|similar|afin)\b/;

// Degree requirements are checked against the candidate's education entries,
// never against skills. Returns null for non-degree qualifications.
function evaluateDegreeQualification(candidate, item) {
  const degreeText = (value) => normalize(value).replace(/\./g, " ").replace(/\s+/g, " ").trim();
  const text = degreeText(item);
  if (!DEGREE_REQUIREMENT.test(text)) return null;

  const degrees = (Array.isArray(candidate?.education) ? candidate.education : [])
    .map((entry) => degreeText(typeof entry === "string" ? entry : [entry?.degree, entry?.field].filter(Boolean).join(" ")))
    .filter(Boolean);
  if (!degrees.length) return { status: "MISSING", score: 0 };

  const wantsDoctorate = /\b(ph ?d|doctorate|doctorado|dottorato)\b/.test(text);
  const wantsMaster = /\b(master\w*|msc|m sc)\b/.test(text) && !/\b(bachelor\w*|bsc|b sc)\b/.test(text);
  const levelOk = (degree) =>
    wantsDoctorate ? /\b(ph ?d|doctor\w*)\b/.test(degree)
      : wantsMaster ? /\b(master\w*|msc|m sc|ph ?d|doctor\w*)\b/.test(degree)
        : true;
  const fieldOk = (degree) => !COMPUTING_FIELD.test(text) ||
    /\b(computer|computing|informatics|informatica|software|engineering|ingenieria)\b/.test(degree);

  return degrees.some((degree) => levelOk(degree) && fieldOk(degree))
    ? { status: "EXACT", score: 1 }
    : { status: "MISSING", score: 0 };
}

function scoreQualifications(candidate, job) {
  const qualifications =
    job.qualifications ?? [];

  if (!qualifications.length) {
    return {
      score: null,
      matches: []
    };
  }

  // Same honesty rules as the technical score: languages, soft skills and
  // titles are not qualifications to match, years belong to the experience
  // gate, and a prohibition ("No use of CSS libraries") is not a skill.
  const matches = qualifications.flatMap((qualification) => {
    const item =
      typeof qualification === "string"
        ? qualification
        : qualification.item;

    if (typeof item !== "string" || !item.trim()) return [];

    const degree = evaluateDegreeQualification(candidate, item);
    if (degree) return [{ item, ...degree }];

    if (/^\s*(no|not|without|sin|senza|ohne)\b/i.test(item)) return [];
    const [entry] = technicalRequirementsOnly([qualification]);
    if (!entry) return [];

    const evaluation = evaluateRequirementItem(candidate, item, { forceSentence: entry.forceSentence });

    return [{
      item,
      status: evaluation.status,
      score: evaluation.score
    }];
  });

  if (!matches.length) {
    return {
      score: null,
      matches: []
    };
  }

  const score =
    (matches.reduce(
      (sum, item) => sum + item.score,
      0
    ) /
      matches.length) *
    100;

  return {
    score,
    matches
  };
}

function scoreCareer(candidate, job) {
  const title = normalize(job.job?.title);

  if (!title) return null;

  const targetRoles =
    candidate.professionalProfile?.targetRoles ?? [];

  for (const role of targetRoles) {
    const normalizedRole = normalize(role);

    if (
      title === normalizedRole ||
      title.includes(normalizedRole) ||
      normalizedRole.includes(title)
    ) {
      return 100;
    }
  }

  // A backend title that mentions React ("Java Engineer - React") is not a
  // frontend career step; full-stack and frontend titles keep the 90.
  const backendTitle = namesNonJsBackend(job.job?.title ?? "") &&
    !/\b(frontend|front end|full stack|fullstack)\b/.test(title);
  if (
    !backendTitle && (
      title.includes("frontend") ||
      title.includes("front end") ||
      title.includes("react") ||
      title.includes("next js")
    )
  ) {
    return 90;
  }

  return 50;
}

function calculateWeightedScore(parts) {
  const weights = {
    technical: 0.30,
    experience: 0.20,
    responsibilities: 0.20,
    qualifications: 0.15,
    career: 0.15
  };

  let total = 0;
  let weightTotal = 0;

  for (const [name, score] of Object.entries(parts)) {
    if (score === null || score === undefined) {
      continue;
    }

    total += score * weights[name];
    weightTotal += weights[name];
  }

  // A single inferred career/title score must not become a 100/100 job fit.
  // Require at least 60% of the original scoring dimensions to be evidenced.
  // This normally means at least three meaningful dimensions are available.
  if (weightTotal < 0.60) return null;

  return total / weightTotal;
}

function evaluateRoleFit(job) {
  const rawTitle = String(job.job?.title ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const title = normalize(job.job?.title ?? "");
  if (!title) return { status: "UNKNOWN", note: "Job title is missing." };

  if (/\breact\s*(?:[-/(]\s*)?native\b/.test(rawTitle)) {
    return { status: "FAIL", note: "React Native roles are mobile-focused and outside the frontend web target." };
  }

  if (/\b(lead|principal|staff|team leader|tech leader|technical leader|intern|internship)\b/.test(rawTitle)) {
    return { status: "FAIL", note: "Lead, principal, staff and intern roles are outside the target seniority." };
  }

  const fullStack = /\b(full stack|fullstack)\b/.test(title);
  const frontendFocused = /\b(frontend|front end|front end engineer|ui developer|ui engineer)\b/.test(title);
  // The raw title is used so a backend technology in parentheses still counts.
  const backendFocused = /\b(backend|back end|node|nodejs|node js|java developer|python developer|\.net developer|php developer)\b/.test(title) ||
    namesNonJsBackend(job.job?.title ?? "");

  if (fullStack && !frontendFocused) {
    return { status: "FLAG", note: "Full-stack is a secondary target; review the frontend/backend balance before applying." };
  }
  if (backendFocused && !frontendFocused) {
    return { status: "FLAG", note: "Title appears backend-focused despite frontend technology mentions." };
  }
  if (/\b(frontend|front end|react|nextjs|next js|ui developer|ui engineer)\b/.test(title)) {
    return { status: "PASS", note: "Title aligns with the frontend/React/Next.js target." };
  }
  return { status: "FLAG", note: "Role title is related but not a direct match for the primary frontend target." };
}

// Language names as postings and the extractor write them, in the languages
// the sources return. Unknown names are compared as written.
const LANGUAGE_ALIASES = {
  english: ["english", "ingles", "inglese", "englisch", "anglais", "engels"],
  spanish: ["spanish", "espanol", "castellano", "castilian", "spagnolo", "spanisch", "espagnol"],
  french: ["french", "frances", "francese", "franzosisch", "francais"],
  german: ["german", "aleman", "tedesco", "deutsch", "allemand"],
  italian: ["italian", "italiano", "italienisch", "italien"],
  portuguese: ["portuguese", "portugues", "portoghese", "portugiesisch"],
  catalan: ["catalan", "catala", "catalano", "valenciano", "valencian"],
  russian: ["russian", "ruso", "russo", "russisch", "russe"],
  dutch: ["dutch", "neerlandes", "olandese", "niederlandisch", "neerlandais"],
  polish: ["polish", "polaco", "polacco", "polnisch", "polonais"]
};
const LANGUAGE_CANONICAL = new Map(
  Object.entries(LANGUAGE_ALIASES).flatMap(([canonical, names]) => names.map((name) => [name, canonical]))
);

function canonicalLanguage(name) {
  const text = normalize(name);
  const direct = LANGUAGE_CANONICAL.get(text);
  if (direct) return direct;
  const word = text.split(" ").find((token) => LANGUAGE_CANONICAL.has(token));
  return word ? LANGUAGE_CANONICAL.get(word) : text;
}

// CEFR scale: A1=1 ... C2=6. Descriptive levels map to the CEFR level they
// usually mean in job postings. Multi-word phrases are checked before single words.
const LEVEL_PHRASES = [
  [/\b(native|mother tongue|nativo|nativa|lengua materna|madrelingua|muttersprache|langue maternelle|bilingual|bilingue|zweisprachig)\b/, 6],
  [/\b(full professional|fluent|fluency|fluido|fluida|fluente|fliessend|courant|advanced|avanzado|avanzada|avanzato|avanzata|excellent|excelente|eccellente|ottimo|ottima|very good|muy bueno|muy buena|high|alto|alta|verhandlungssicher|sehr gut)\b/, 5],
  [/\b(upper intermediate|professional|working proficiency|business|proficient|proficiency|good|strong|solid|buen|bueno|buena|buono|buona|gut|bon|bonne|competent)\b/, 4],
  [/\b(intermediate|intermedio|intermedia|medio|media|conversational|conversacional|mittel|intermediaire)\b/, 3],
  [/\b(basic|elementary|basico|basica|base|grundkenntnisse|notions)\b/, 2]
];

// For a requirement the lowest level mentioned is the minimum ("B2/C1",
// "B2 or higher"); for the candidate the highest stated level counts.
function parseLanguageLevel(value, { pick = "min" } = {}) {
  const text = normalize(value);
  if (!text) return undefined;
  const cefr = [...text.matchAll(/\b([abc])([12])\b/g)].map(([, letter, digit]) =>
    ({ a: 0, b: 2, c: 4 })[letter] + Number(digit)
  );
  if (cefr.length) return pick === "max" ? Math.max(...cefr) : Math.min(...cefr);
  for (const [pattern, level] of LEVEL_PHRASES) {
    if (pattern.test(text)) return level;
  }
  return undefined;
}

function evaluateLanguageGate(candidate, job) {
  const requirements = (job.languages ?? []).filter(
    (requirement) =>
      typeof requirement !== "string" &&
      requirement?.required === true
  );

  if (!requirements.length) {
    return {
      status: "PASS",
      note: "No required language requirement stated."
    };
  }

  const candidateLanguages =
    candidate.candidate?.languages ?? [];

  for (const requirement of requirements) {
    const requiredLanguage = requirement.language;
    const requiredLevel = requirement.level;

    const candidateLanguage =
      candidateLanguages.find(
        (item) =>
          canonicalLanguage(item.language) ===
          canonicalLanguage(requiredLanguage)
      );

    if (!candidateLanguage) {
      return {
        status: "FAIL",
        note: `Required language missing: ${requiredLanguage}`
      };
    }

    if (requiredLevel) {
      const candidateLevel = parseLanguageLevel(candidateLanguage.level, { pick: "max" });
      const minimumLevel = parseLanguageLevel(requiredLevel, { pick: "min" });

      if (
        candidateLevel === undefined ||
        minimumLevel === undefined
      ) {
        return {
          status: "FLAG",
          note: `Language level needs review: ${requiredLanguage}`
        };
      }

      if (candidateLevel < minimumLevel) {
        return {
          status: "FLAG",
          note: `${requiredLanguage} may be below the requested level.`
        };
      }
    }
  }

  return {
    status: "PASS",
    note: "Language requirements are compatible."
  };
}

function evaluateWorkAuthorization(candidate, job) {
  const requirement =
    job.workAuthorization;

  if (requirement?.required === false) {
    // The extractor defaults missing/malformed booleans to false, so "no
    // requirement" is trusted only when the field was actually returned as a
    // boolean in a complete extraction.
    const explicitlyAbsent =
      job.extraction?.status === "complete" &&
      job.extraction.fields?.["workAuthorization.required"] === "present";

    if (
      explicitlyAbsent &&
      candidate.candidate?.workAuthorization?.eu === true
    ) {
      return {
        status: "PASS",
        note: "No work-authorization requirement is stated and the candidate has EU work authorization."
      };
    }

    return {
      status: "UNKNOWN",
      note: "No work-authorization requirement was reliably extracted or the candidate's EU authorization is not confirmed."
    };
  }

  if (requirement?.required !== true) {
  return {
    status: "UNKNOWN",
    note: "The posting does not confirm whether work authorization is required."
  };
}

  if (
    requirement.eu === true &&
    candidate.candidate?.workAuthorization?.eu === true
  ) {
    return {
      status: "PASS",
      note: "EU work authorization is available."
    };
  }

  return {
    status: "UNKNOWN",
    note: "Work authorization requires review."
  };
}

// Evaluates the structured restrictions published by the source (e.g.
// Himalayas). Returns NONE when the listing carries no usable restriction.
function evaluateListingRestrictions(source) {
  const regions = (Array.isArray(source.locationRestrictions) ? source.locationRestrictions : [])
    .map((item) => normalize(item))
    .filter(Boolean);
  const timezones = Array.isArray(source.timezoneRestrictions) ? source.timezoneRestrictions : [];

  // Spain observes UTC+1/+2 (UTC+0/+1 in the Canary Islands). Any unparseable
  // or non-overlapping timezone restriction needs manual review.
  const timezoneCompatible = source.timezoneConflict !== true && (timezones.length === 0 || timezones.some((value) => {
    const match = String(value).trim().match(/^(?:utc|gmt)?\s*([+-]?\d{1,2})$/i);
    return match !== null && Number(match[1]) >= 0 && Number(match[1]) <= 2;
  }));

  if (!regions.length) {
    return timezoneCompatible
      ? { status: "NONE" }
      : { status: "FLAG", note: "The listing restricts remote work to timezones that may not include Spain; verify manually." };
  }

  if (regions.some((region) => LISTING_SPAIN_REGIONS.has(region) || LISTING_OPEN_REGIONS.has(region))) {
    return timezoneCompatible
      ? { status: "PASS", note: `The listing's location restrictions include Spain or a region containing it (${regions.join(", ")}).` }
      : { status: "FLAG", note: "The listing allows Spain but also restricts timezones that may not include it; verify manually." };
  }

  if (regions.every((region) => LISTING_KNOWN_OTHER_COUNTRIES.has(region))) {
    return { status: "FAIL", note: `The listing restricts remote work to countries outside Spain (${regions.join(", ")}).` };
  }

  return { status: "FLAG", note: `The listing's location restrictions (${regions.join(", ")}) could not be matched to Spain; verify manually.` };
}

function evaluateLocation(candidate, job) {
  const location = job.location ?? {};
  const source = job.sourceInfo ?? {};
  const rawLocation = normalize(source.location ?? "");
  const rawDescription = normalize(source.description ?? job.job?.description ?? "");
  const city = normalize(location.city ?? "");
  const acceptedCities = candidate.candidate?.location?.acceptedCities ?? [];
  const acceptedCityNames = acceptedCities.map(normalize).filter(Boolean);

  const containsCity = (text, acceptedCity) => {
    if (!text || !acceptedCity) return false;
    const escaped = acceptedCity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(text);
  };
  const sourceLocationKnown = Boolean(rawLocation && rawLocation !== "unknown");
  const isAlicante = containsCity(rawLocation, "alicante") || (Object.keys(source).length === 0 && containsCity(city, "alicante"));
  const isValencia = containsCity(rawLocation, "valencia") || (Object.keys(source).length === 0 && containsCity(city, "valencia"));
  const localCityIsConfirmed = isAlicante || isValencia;

  // Structured restrictions outrank any local-city or remote shortcut below.
  const restrictionVerdict = structuredRestrictionVerdict(source);
  if (restrictionVerdict === "CONFLICT") {
    return { status: "FLAG", note: "Duplicate sources give conflicting location restrictions; verify eligibility manually." };
  }
  if (restrictionVerdict === "EXCLUDES_SPAIN") {
    return { status: "FAIL", note: `The listing restricts remote work to countries outside Spain (${source.locationRestrictions.join(", ")}).` };
  }

  const modelScope = normalize(location.remoteScope);
  const modelCountry = normalize(location.country);
  const sourceRemote = source.remote === true;
  const sourceHybrid = source.hybrid === true;
  const modelType = normalize(location.type);

  // Eligibility must be tied to the remote work arrangement itself. A bare
  // "customers worldwide" or "offices in Europe" says nothing about where the
  // employee may live, so these patterns require "remote"/"work" to govern the
  // region phrase.
  const explicitWorldwideInDescription = hasExplicitWorldwideRemote(rawDescription);
  const explicitWorldwide = explicitWorldwideInDescription || modelScope === "worldwide";
  const explicitEuropeInDescription = hasExplicitEuropeRemote(rawDescription);
  const explicitEurope = explicitEuropeInDescription || modelScope === "europe" || modelScope === "eu";
  const explicitSpainInDescription = hasExplicitSpainRemote(rawDescription);
  // A country-only location such as "España" can represent a nationwide
  // listing. A city plus country (e.g. "Madrid, Spain") is not enough to prove
  // that an applicant in Alicante can work remotely from there.
  const countryOnlyLocation = /^(remote[ ,:-]*)?(spain|espana)([ ,/-]*remote)?$/.test(rawLocation);
  const explicitSpain = explicitSpainInDescription || countryOnlyLocation;
  const explicitNonSpainRestriction = hasExplicitNonSpainRestriction(rawDescription);

  // The raw listing location and explicit source flags take precedence over
  // the LLM's inferred location type. This prevents a default/hallucinated
  // "remote" value from making an office job appear compatible.
  if (isAlicante) {
    if (sourceHybrid || modelType === "hybrid") {
      return { status: "PASS", note: `${source.location ?? location.city} is an accepted hybrid city.` };
    }
    if (sourceRemote || modelType === "remote") {
      return { status: "PASS", note: `${source.location ?? location.city} is an accepted remote city.` };
    }
    if (modelType === "onsite" || (!sourceRemote && !sourceHybrid && sourceLocationKnown && modelType !== "unknown")) {
      return { status: "PASS", note: `${source.location ?? location.city} is an accepted onsite city.` };
    }
    return { status: "PASS", note: `${source.location ?? location.city} is an accepted city for onsite, hybrid, or remote work.` };
  }

  if (isValencia) {
    if (sourceHybrid || modelType === "hybrid") {
      return { status: "PASS", note: `${source.location ?? location.city} is an accepted hybrid city.` };
    }
    if (sourceRemote || modelType === "remote") {
      return { status: "PASS", note: `${source.location ?? location.city} is an accepted remote city.` };
    }
    if (modelType === "onsite" || (!sourceRemote && !sourceHybrid && sourceLocationKnown && modelType !== "unknown")) {
      return { status: "FAIL", note: "Onsite roles in Valencia are not eligible; hybrid or remote required." };
    }
    return { status: "UNKNOWN", note: "Valencia work mode is unknown or ambiguous; verify whether hybrid or remote before applying." };
  }

  if (sourceHybrid || modelType === "hybrid") {
    if (rawLocation && rawLocation !== "unknown") {
      return { status: "FAIL", note: `Hybrid role is outside accepted cities (${source.location ?? location.city ?? "location unknown"}).` };
    }
    if (city || modelCountry) {
      return { status: "FAIL", note: `${location.city ?? location.country} is outside accepted hybrid locations.` };
    }
    return { status: "UNKNOWN", note: "Hybrid office location could not be verified." };
  }

  if (sourceRemote) {
    // An explicit country restriction outranks any broad worldwide/Europe phrase.
    if (explicitNonSpainRestriction) {
      if (explicitSpain) {
        return { status: "FLAG", note: "The posting mentions both Spain and a restriction to another region; verify eligibility manually." };
      }
      return { status: "FAIL", note: "The posting explicitly restricts remote eligibility to a country outside Spain." };
    }

    // Structured source restrictions are job-specific and outrank generic wording.
    const listingRestrictions = evaluateListingRestrictions(source);
    if (listingRestrictions.status !== "NONE") {
      return { status: listingRestrictions.status, note: listingRestrictions.note };
    }

    if (explicitWorldwide || explicitEurope || explicitSpain) {
      return { status: "PASS", note: explicitWorldwide ? "Posting explicitly permits worldwide remote work." : explicitEurope ? "Posting explicitly permits remote work across Europe/EU." : "Posting indicates remote work from Spain is allowed." };
    }

    if ((modelScope === "country specific" || modelScope === "country-specific") && modelCountry && modelCountry !== "spain" && modelCountry !== "espana") {
      return { status: "FLAG", note: "The extracted profile suggests country-specific remote work outside Spain; verify this against the original posting." };
    }

    // A country name in the search source is not proof that the role is
    // available to someone living in Spain. Unclear remote scope needs review.
    return { status: "FLAG", note: "Remote work is indicated, but the posting does not confirm that applicants based in Spain are eligible." };
  }

  // No confirmed remote signal: the source location beats an LLM-inferred type.
  if (rawLocation && rawLocation !== "unknown") {
    return { status: "FAIL", note: `Non-remote role is outside accepted cities (${source.location ?? location.city ?? "location unknown"}).` };
  }

  if (modelType === "remote") {
    return { status: "UNKNOWN", note: "The model inferred remote work, but the source listing does not confirm it." };
  }

  if ((modelType === "onsite" || modelType === "hybrid") && (city || modelCountry)) {
    return { status: "FAIL", note: `${location.city ?? location.country} is outside accepted onsite/hybrid locations.` };
  }

  return { status: "UNKNOWN", note: "Location type or work location could not be verified from the source listing." };
}

function getAtsKeywords(candidate) {
  return (
    candidate.atsKeywords ??
    []
  )
    .map(normalize)
    .filter(Boolean);
}

function calculateATS(candidate, job) {
  const keywords =
    getAtsKeywords(candidate);

  if (!keywords.length) {
    return null;
  }

  const jobText = normalize(
    [
      job.job?.title ?? "",
      job.job?.description ?? "",
      ...(job.requirements?.required ?? []).map(
        (item) =>
          typeof item === "string"
            ? item
            : item.item
      ),
      ...(job.requirements?.preferred ?? []).map(
        (item) =>
          typeof item === "string"
            ? item
            : item.item
      ),
      ...(job.responsibilities?.core ?? []),
      ...(job.responsibilities?.secondary ?? [])
    ].join(" ")
  );

  // Spelling variants of the same technology ("React.js" for the keyword
  // "React") count, but only for keywords that are a technology name on
  // their own; title keywords such as "Frontend Developer" stay literal.
  const rawJobText = [
    job.job?.title ?? "",
    job.job?.description ?? "",
    ...(job.requirements?.required ?? []).map(requirementText),
    ...(job.requirements?.preferred ?? []).map(requirementText),
    ...(job.responsibilities?.core ?? []),
    ...(job.responsibilities?.secondary ?? [])
  ].filter((value) => typeof value === "string").join(" \n ");
  const jobTechIds = new Set(findMentions(rawJobText).mentions.map((mention) => mention.id));
  const keywordTechId = (keyword) => {
    const { tokens, mentions } = findMentions(keyword);
    return mentions.length === 1 && mentions[0].start === 0 && mentions[0].end === tokens.length
      ? mentions[0].id
      : null;
  };

  const matched = keywords.filter((keyword) =>
    containsNormalizedPhrase(jobText, keyword) ||
    (keywordTechId(keyword) !== null && jobTechIds.has(keywordTechId(keyword)))
  );

  const keywordScore =
    (matched.length / keywords.length) * 100;

  const title =
    normalize(job.job?.title ?? "");

  const targetRoles =
    candidate.professionalProfile?.targetRoles ?? [];

  let titleScore = 0;

  if (
    targetRoles.some((role) => {
      const normalizedRole = normalize(role);
      return (
        title === normalizedRole ||
        title.includes(normalizedRole) ||
        normalizedRole.includes(title)
      );
    })
  ) {
    titleScore = 100;
  } else if (
    title.includes("frontend") ||
    title.includes("front end") ||
    title.includes("react") ||
    title.includes("next js")
  ) {
    titleScore = 70;
  }

  return {
    score:
      keywordScore * 0.8 +
      titleScore * 0.2,
    keywordScore,
    titleScore,
    matchedKeywords: matched
  };
}

function evaluateExperienceGate(job) {
  const minimumYears = job.experience?.minimumYears;

  if (typeof minimumYears === "number" && minimumYears >= 5) {
    // The extractor can copy "5+ years preferred" into minimumYears. The
    // project rule rejects only an explicitly REQUIRED 5+ minimum, so when the
    // posting itself presents that number only as preferred/optional (and no
    // required 5+ statement exists) the job is flagged for review instead.
    const description = job.sourceInfo?.description || job.job?.description || "";
    if (description) {
      const stated = analyzeYearsRequirements(description);
      const requiredInText = stated.requiredMinimum !== null && stated.requiredMinimum >= 5;
      if (!requiredInText && stated.optionalYears.includes(minimumYears)) {
        return {
          status: "FLAG",
          note: `The extracted minimum of ${minimumYears}+ years appears in the posting only as preferred/optional; verify before applying.`
        };
      }
    }
    return { status: "FAIL", note: `Job explicitly requires ${minimumYears}+ years of experience.` };
  }
  return { status: "PASS", note: "No explicit minimum of 5 or more years." };
}

// A job can look strong on the weighted average while missing most of its
// REQUIRED skills: title-based career fit, years, a degree and generic
// responsibilities are full for almost any frontend job. These guards use the
// required-skill coverage the scorer already computes:
// - APPLY needs at least half of the required technical skills;
// - matching none of two or more required technical skills is a SKIP.
const REQUIRED_COVERAGE_FOR_APPLY = 50;

const GATE_LABELS = {
  roleFit: "Role fit",
  experience: "Experience",
  language: "Language",
  workAuthorization: "Work authorization",
  location: "Location"
};

// Returns the decision and the reasons that produced it, in the order the
// rules are applied, so the verdict can always be explained.
function decideJob(jobFitScore, gates, extraction, coverage = {}) {
  const reasons = [];
  const gateEntries = Object.entries(GATE_LABELS).map(([key, label]) => ({
    label,
    status: gates[key]?.status ?? (key === "experience" ? "PASS" : "UNKNOWN"),
    note: gates[key]?.note ?? ""
  }));

  const failed = gateEntries.filter((gate) => gate.status === "FAIL");
  if (failed.length) {
    failed.forEach((gate) => reasons.push(`${gate.label} gate failed: ${gate.note}`));
    return { decision: "SKIP", reasons };
  }

  const { requiredScore = null, requiredCount = 0 } = coverage;
  if (requiredScore === 0 && requiredCount >= 2) {
    reasons.push(`None of the ${requiredCount} required technical skills is supported by the profile.`);
    return { decision: "SKIP", reasons };
  }

  if (jobFitScore === null || jobFitScore === undefined) {
    reasons.push("Too little extracted evidence to compute a job-fit score; review manually.");
    return { decision: "MAYBE", reasons };
  }
  if (jobFitScore < 60) {
    reasons.push(`Job fit ${jobFitScore.toFixed(1)} is below 60.`);
    return { decision: "SKIP", reasons };
  }
  if (jobFitScore < 75) {
    reasons.push(`Job fit ${jobFitScore.toFixed(1)} is between 60 and 75.`);
  }

  if (requiredScore !== null && requiredScore < REQUIRED_COVERAGE_FOR_APPLY) {
    reasons.push(`Only ${Math.round(requiredScore)}% of the required technical skills are covered (APPLY needs ${REQUIRED_COVERAGE_FOR_APPLY}%).`);
  }

  // APPLY requires a sufficiently evidenced score and every eligibility gate
  // to be confirmed. FLAG/UNKNOWN means the user should verify first.
  gateEntries
    .filter((gate) => gate.status !== "PASS")
    .forEach((gate) => reasons.push(`${gate.label} needs review (${gate.status}): ${gate.note}`));
  if (extraction?.status !== "complete") {
    reasons.push("Job extraction was incomplete or uncertain.");
  }

  if (reasons.length) return { decision: "MAYBE", reasons };
  return {
    decision: "APPLY",
    reasons: [`Job fit ${jobFitScore.toFixed(1)} with every eligibility gate confirmed and the required skills covered.`]
  };
}

export function scoreJob(candidate, job) {
  const technical = scoreRequirements(
    candidate,
    job
  );

  const experience = scoreExperience(
    candidate,
    job
  );

  const responsibilities =
    scoreResponsibilities(
      candidate,
      job
    );

  const qualifications =
    scoreQualifications(
      candidate,
      job
    );

  const career = scoreCareer(
    candidate,
    job
  );

  const scoreParts = {
    technical: technical.score,
    experience: experience.score,
    responsibilities: responsibilities.score,
    qualifications: qualifications.score,
    career
  };
  const jobFit = calculateWeightedScore(scoreParts);
  const scoreWeights = { technical: 0.30, experience: 0.20, responsibilities: 0.20, qualifications: 0.15, career: 0.15 };
  const scoringCoverage = Number((Object.entries(scoreParts).reduce((sum, [name, value]) => sum + (value === null || value === undefined ? 0 : scoreWeights[name]), 0) * 100).toFixed(1));

  const gates = {
    roleFit: evaluateRoleFit(job),
    experience: evaluateExperienceGate(job),
    language: evaluateLanguageGate(
      candidate,
      job
    ),
    workAuthorization:
      evaluateWorkAuthorization(
        candidate,
        job
      ),
    location: evaluateLocation(
      candidate,
      job
    )
  };

  const ats = calculateATS(
    candidate,
    job
  );
  const extraction =
    job.extraction ?? {
      status: "uncertain",
      fields: {},
      warnings: [{
        code: "MISSING_METADATA",
        message: "Extraction metadata was not provided."
      }]
    };

  const verdict = decideJob(jobFit, gates, extraction, {
    requiredScore: technical.requiredScore,
    requiredCount: technical.required.length
  });

  return {
    title: job.job?.title ?? "",
    company: job.job?.company ?? "",
    jobFitScore:
      jobFit === null
        ? null
        : Number(jobFit.toFixed(1)),
    atsScore:
      ats?.score === undefined
        ? null
        : Number(ats.score.toFixed(1)),
    scoringCoverage,
    decision: verdict.decision,
    decisionReasons: verdict.reasons,
    extraction,
    gates,
    breakdown: {
      technical: technical.score,
      experience: experience.score,
      responsibilities:
        responsibilities.score,
      qualifications:
        qualifications.score,
      career,
      scoringCoverage
    },
    ats,
    // A fully unmatched requirement is listed as written; for a partially
    // matched sentence only the technologies the candidate lacks are listed.
    missingRequiredSkills: [...new Set(
      technical.evaluations
        .filter((evaluation) => evaluation.required && evaluation.score < 0.9)
        .flatMap((evaluation) =>
          evaluation.score === 0 || evaluation.method === "atomic"
            ? (evaluation.score === 0 ? [evaluation.item] : [])
            : evaluation.missing
        )
    )],
    // Preferred gaps are reported separately and never treated as required.
    missingPreferredSkills: [...new Set(
      technical.evaluations
        .filter((evaluation) => !evaluation.required && evaluation.score < 0.9)
        .flatMap((evaluation) =>
          evaluation.score === 0 || evaluation.method === "atomic"
            ? (evaluation.score === 0 ? [evaluation.item] : [])
            : evaluation.missing
        )
    )],
    requirementMatches: technical.evaluations.map(({ item, required, priority, status, score, matched, missing, method }) => ({
      item,
      required,
      priority,
      status,
      score: Number(score.toFixed(2)),
      matched,
      missing,
      method
    }))
  };
}

// CLI test
if (
  process.argv[1] &&
  /(?:^|[\\/])job-scorer\.js$/.test(process.argv[1])
) {
  const candidate = JSON.parse(
    await fs.readFile(
      "./data/candidate-profile.json",
      "utf-8"
    )
  );

  const job = JSON.parse(
    await fs.readFile(
      "./data/test-job-profile.json",
      "utf-8"
    )
  );

  const result = scoreJob(
    candidate,
    job
  );

  console.log(
    JSON.stringify(result, null, 2)
  );
}