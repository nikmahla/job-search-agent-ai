// Skill-gap analysis over the saved job data. Standalone: it reads saved
// extractions and the candidate profile and never touches APPLY/MAYBE/SKIP.
//
// - Jobs come from data/job-state.json (one entry per job, already deduplicated
//   by the state key). Only jobs with a saved Qwen/Claude extraction count;
//   everything else is reported as "not analysed", never as "no skills".
// - Requirement lines are read with the project's own classifyRequirement and
//   the tech lexicon (synonyms normalised, React Native != React, Java !=
//   JavaScript). A skill counts once per job; "required" wins over "preferred".
// - Candidate evidence comes only from candidate-profile.json through the same
//   evidence index the application packs use. Nothing is invented.
import { classifyRequirement } from "./job-scorer.js";
import { buildCandidateTechEvidence, findMentions, techDisplayName, NON_JS_BACKEND_TECH_IDS } from "./tech-lexicon.js";
import { candidateEvidenceIndex } from "./requirement-coverage.js";

export const FULLSTACK_ID = "fullstack";
const FULLSTACK_TITLE = /\bfull[\s-]?stack\b/i;

// Practices and process words are not technical skills for this report.
const IGNORED_IDS = new Set(["agile", "scrum", "kanban", "code-review"]);

// Related-but-not-equivalent evidence. A skill listed here is "partial" when the
// profile shows one of the related skills, with the difference spelled out.
// Anything not listed is never treated as related.
const RELATED = {
  nodejs: { ids: ["rest-apis", "jwt", "authentication"], note: "API and authentication work is not evidence of Node.js itself" },
  graphql: { ids: ["rest-apis"], note: "REST experience is not GraphQL experience" },
  jest: { ids: ["vitest", "react-testing-library"], note: "other JavaScript test tooling, not Jest itself" },
  cypress: { ids: ["vitest", "react-testing-library", "integration-testing"], note: "component/integration testing, not Cypress itself" },
  playwright: { ids: ["vitest", "react-testing-library", "integration-testing"], note: "component/integration testing, not Playwright itself" },
  "e2e-testing": { ids: ["integration-testing", "react-testing-library"], note: "integration testing, not end-to-end testing" },
  sass: { ids: ["css", "tailwind"], note: "CSS tooling, not Sass/SCSS itself" },
  "styled-components": { ids: ["css", "tailwind", "material-ui"], note: "other styling approaches, not styled-components itself" },
  seo: { ids: ["ssr", "ssg"], note: "SSR/SSG supports SEO but is not SEO experience" },
  "ci-cd": { ids: ["github", "vercel"], note: "hosting/repository tools, not pipeline experience" },
  webpack: { ids: ["vite"], note: "another bundler" },
  vite: { ids: ["webpack"], note: "another bundler" }
};

// Names that look like a profile skill but are different technologies.
const NOT_EQUIVALENT = {
  "react-native": "React is not React Native",
  java: "JavaScript is not Java",
  preact: "React is not Preact (the API is similar, the evidence is not)"
};

// Skills outside a JavaScript/React web target: other languages, mobile, data,
// cloud and CMS platforms. They are reported but capped at LOW priority.
const OFF_TARGET_IDS = new Set([
  ...NON_JS_BACKEND_TECH_IDS, "react-native", "dotnet", "snowflake", "salesforce", "wordpress", "shopify",
  "elasticsearch", "kafka", "terraform", "kubernetes", "linux", "aws", "azure", "gcp", "mysql", "postgresql",
  "mongodb", "redis", "sql", "microservices", "backend-development", "electron", "threejs", "webgl", "d3"
]);
// Core of the target role: React / Next.js / TypeScript / JavaScript front end plus Node.js and full-stack.
const CORE_IDS = new Set([
  "react", "nextjs", "nextjs-app-router", "typescript", "javascript", "html", "css", "frontend", FULLSTACK_ID, "nodejs",
  "rest-apis", "graphql", "redux", "redux-toolkit", "zustand", "react-query", "tailwind", "testing", "unit-testing",
  "integration-testing", "react-testing-library", "jest", "vitest", "ssr", "ssg", "performance-optimization",
  "accessibility", "responsive-design", "git", "design-system"
]);

export function relevanceOf(id) {
  if (OFF_TARGET_IDS.has(id)) return "off-target";
  return CORE_IDS.has(id) ? "core" : "web";
}

const textOf = (item) => (typeof item === "string" ? item : item?.item ?? "");

// Skill ids named by one job's extracted requirements: Map id -> "required" | "preferred".
export function skillsOfRequirements({ required = [], preferred = [] } = {}) {
  const found = new Map();
  for (const [list, kind] of [[preferred, "preferred"], [required, "required"]]) {
    for (const item of list) {
      const type = classifyRequirement(item);
      // Technical lines, and "3+ years of React" style lines that name technologies.
      if (type !== "technical" && type !== "experience") continue;
      for (const { id } of findMentions(textOf(item)).mentions) {
        if (!IGNORED_IDS.has(id)) found.set(id, kind);
      }
    }
  }
  return found;
}

// Normalises the saved data into [{ key, title, company, decision, skills }].
// state: loaded job-state; results: optional parsed job-results.json (fallback for jobs missing from state).
export function collectJobs({ state, results = [] }) {
  const jobs = [];
  const seen = new Set();
  let withoutAnalysis = 0;

  for (const [key, entry] of Object.entries(state?.jobs ?? {})) {
    const profile = entry?.analysis?.profile;
    if (!profile?.requirements) { withoutAnalysis += 1; continue; }
    seen.add(key);
    jobs.push({
      key,
      title: entry.title ?? profile.job?.title ?? "?",
      company: entry.company ?? profile.job?.company ?? "?",
      decision: entry.lastResult?.decision ?? null,
      skills: skillsOfRequirements(profile.requirements)
    });
  }

  let fromResults = 0;
  for (const result of results) {
    const key = result?.stateKey ?? `${result?.title}|${result?.company}`;
    if (seen.has(key) || !Array.isArray(result?.requirementMatches)) continue;
    seen.add(key);
    fromResults += 1;
    const required = result.requirementMatches.filter((m) => m.required).map((m) => m.item);
    const preferred = result.requirementMatches.filter((m) => !m.required).map((m) => m.item);
    jobs.push({ key, title: result.title ?? "?", company: result.company ?? "?", decision: result.decision ?? null, skills: skillsOfRequirements({ required, preferred }) });
  }

  for (const job of jobs) {
    // "Full-stack" is a role, not a lexicon technology: read it from the title only.
    if (FULLSTACK_TITLE.test(job.title) && !job.skills.has(FULLSTACK_ID)) job.skills.set(FULLSTACK_ID, "required");
  }
  return { jobs, withoutAnalysis, fromResults };
}

const displayName = (id) => (id === FULLSTACK_ID ? "Full-stack development" : techDisplayName(id));

// Candidate position for one skill id: { level: "Strong" | "Partial" | "Missing", evidence: [], note }
export function candidateStanding(id, { strengths, index, directIds }) {
  const quote = (ids) => index
    .filter((entry) => [...entry.ids].some((entryId) => ids.includes(entryId)))
    .slice(0, 3)
    .map((entry) => `${entry.source}: "${entry.text}"`);

  if (id === FULLSTACK_ID) {
    const direct = index.filter((entry) => /full[\s-]?stack/i.test(entry.text)).slice(0, 3).map((entry) => `${entry.source}: "${entry.text}"`);
    return direct.length
      ? { level: "Strong", evidence: direct, note: "" }
      : { level: "Missing", evidence: [], note: "The profile names no full-stack role or work; frontend plus API integration is not recorded as full-stack." };
  }

  const strength = strengths.get(id) ?? 0;
  if (strength >= 1) return { level: "Strong", evidence: quote([id]), note: "" };
  if (strength > 0) {
    // Implied by a stronger skill in the profile (explicit lexicon implication).
    const source = directIds.filter((other) => other !== id && buildCandidateTechEvidence([displayName(other)]).get(id) === strength);
    return { level: "Partial", evidence: quote(source), note: `implied by ${source.map(displayName).join(", ") || "a related skill"}, not named in the profile` };
  }
  const related = RELATED[id];
  const relatedHits = related ? related.ids.filter((relatedId) => strengths.get(relatedId) >= 1) : [];
  if (relatedHits.length) {
    return { level: "Partial", evidence: quote(relatedHits), note: `related only: ${related.note}` };
  }
  return { level: "Missing", evidence: [], note: NOT_EQUIVALENT[id] ?? "" };
}

const priorityFor = ({ jobs, required, total, relevance, level }) => {
  if (level === "Strong") return "—";
  if (relevance === "off-target") return "LOW";
  const share = total ? jobs / total : 0;
  if (jobs >= 3 && share >= 0.3 && required >= Math.ceil(jobs / 2)) return "HIGH";
  if (jobs >= 2 && (relevance === "core" || required >= 1)) return "MEDIUM";
  return "LOW";
};

export function buildSkillGapReport({ state, results = [], candidate, generatedAt = new Date().toISOString() }) {
  const { jobs, withoutAnalysis, fromResults } = collectJobs({ state, results });
  const index = candidateEvidenceIndex(candidate);
  const strengths = buildCandidateTechEvidence(index.map((entry) => entry.text));
  const directIds = [...strengths.entries()].filter(([, value]) => value >= 1).map(([id]) => id);

  const bySkill = new Map();
  for (const job of jobs) {
    for (const [id, kind] of job.skills) {
      const row = bySkill.get(id) ?? { id, jobs: [], required: 0, preferred: 0 };
      row.jobs.push({ key: job.key, title: job.title, company: job.company, decision: job.decision, kind });
      row[kind] += 1;
      bySkill.set(id, row);
    }
  }

  const skills = [...bySkill.values()].map((row) => {
    const relevance = relevanceOf(row.id);
    const standing = candidateStanding(row.id, { strengths, index, directIds });
    return {
      id: row.id,
      skill: displayName(row.id),
      relevance,
      count: row.jobs.length,
      percent: jobs.length ? Math.round((row.jobs.length / jobs.length) * 100) : 0,
      required: row.required,
      preferred: row.preferred,
      jobs: row.jobs,
      ...standing,
      priority: priorityFor({ jobs: row.jobs.length, required: row.required, total: jobs.length, relevance, level: standing.level })
    };
  }).sort((a, b) => b.count - a.count || b.required - a.required || a.skill.localeCompare(b.skill));

  return {
    generatedAt,
    analyzed: jobs.length,
    withoutAnalysis,
    fromResults,
    totalInState: Object.keys(state?.jobs ?? {}).length,
    skills
  };
}

const PRIORITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
const jobLine = (job) => `${cell(job.title)} — ${cell(job.company)}${job.decision ? ` (${job.decision})` : ""} [${job.kind}]`;

export function renderSkillGapReport(report) {
  const { skills, analyzed } = report;
  const missing = skills.filter((s) => s.level === "Missing").sort((a, b) =>
    (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3) || b.count - a.count || b.required - a.required);
  const partial = skills.filter((s) => s.level === "Partial");
  const strong = skills.filter((s) => s.level === "Strong");
  const out = ["# Skill Gap Report", ""];

  out.push(
    `- **Generated:** ${report.generatedAt}`,
    `- **Jobs analysed:** ${analyzed} (of ${report.totalInState} in job-state.json; ${report.withoutAnalysis} have no saved extraction and are not counted)${report.fromResults ? `; ${report.fromResults} taken from job-results.json only` : ""}`,
    "- **Counted:** jobs, not keyword occurrences — a skill counts once per job; \"required\" wins over \"preferred\".",
    "- **Source of skills:** requirement lines saved from the extraction (not the raw posting text).",
    "- **CV evidence:** `data/candidate-profile.json` only. \"Missing\" means no evidence there — it may still exist in experience not written down; decide yourself.",
    ""
  );
  if (analyzed === 0) {
    out.push("**No analysed jobs are saved yet, so no conclusions are possible.** Run the agent first.", "");
    return `${out.join("\n")}\n`;
  }
  if (analyzed < 20) {
    out.push(`> **Small sample:** only ${analyzed} job(s) analysed. Percentages move a lot with each added job; treat priorities as indicative, not reliable.`, "");
  }

  out.push("## 1. Most Requested Skills", "", "| Rank | Skill | Jobs requesting it | % of analyzed jobs | Required / Preferred | My CV |", "|------|-------|--------------------|--------------------|----------------------|-------|");
  skills.slice(0, 30).forEach((s, i) => out.push(`| ${i + 1} | ${cell(s.skill)}${s.relevance === "off-target" ? " _(off-target)_" : ""} | ${s.count} | ${s.percent}% | ${s.required} / ${s.preferred} | ${s.level} |`));
  if (skills.length > 30) out.push("", `_${skills.length - 30} less-requested skill(s) not shown._`);

  out.push("", "## 2. Skills I Already Have", "");
  if (!strong.length) out.push("None of the requested skills is directly named in the profile.");
  strong.forEach((s) => out.push(`- **${s.skill}** — ${s.count} job(s), ${s.percent}%. Evidence: ${s.evidence.map(cell).join("; ") || "—"}`));

  out.push("", "## 3. Skills I Partially Have", "");
  if (!partial.length) out.push("None.");
  partial.forEach((s) => out.push(`- **${s.skill}** — ${s.count} job(s), ${s.percent}% (${s.required} required). ${cell(s.note)}. Related evidence: ${s.evidence.map(cell).join("; ") || "—"}`));

  out.push("", "## 4. Skills Missing From My CV", "", "Ordered by priority, then frequency, then how often the skill was required.", "");
  if (!missing.length) out.push("None of the requested skills is missing.");
  missing.forEach((s) => out.push(
    `### ${s.skill}`,
    `- **Skill:** ${s.skill}${s.relevance === "off-target" ? " (off-target for a frontend/React/Next.js role)" : ""}`,
    `- **Requested by:** ${s.count} job(s) (${s.percent}% of ${analyzed})`,
    `- **Required:** ${s.required}`,
    `- **Preferred:** ${s.preferred}`,
    `- **Current CV evidence:** none in candidate-profile.json`,
    `- **Gap:** ${s.note ? cell(s.note) : "Not in the profile; no related skill recorded either."}`,
    `- **Recommended priority:** ${s.priority}`,
    ""
  ));

  out.push("## 5. Recommended Learning Priorities", "", "Based only on how often each skill appears in the saved jobs; no generic advice.", "");
  for (const level of ["HIGH", "MEDIUM", "LOW"]) {
    out.push(`${level}:`);
    const rows = [...missing, ...partial.map((s) => ({ ...s, priority: priorityFor({ jobs: s.count, required: s.required, total: analyzed, relevance: s.relevance, level: "Partial" }) }))]
      .filter((s) => s.priority === level);
    if (!rows.length) out.push("- (none)");
    rows.forEach((s) => out.push(`- ${s.skill} — requested by ${s.count} job(s), ${s.required} as required${s.level === "Partial" ? " (partial: strengthen existing evidence)" : ""}`));
    out.push("");
  }

  out.push("## 6. Job-by-Job Skill Evidence", "");
  const detailed = [...missing, ...partial].filter((s) => s.relevance !== "off-target" || s.count >= 2);
  if (!detailed.length) out.push("No missing or partial skills to detail.");
  detailed.forEach((s) => {
    out.push(`**${s.skill}** (${s.level}) — ${s.count} job(s):`);
    s.jobs.forEach((job) => out.push(`- ${jobLine(job)}`));
    out.push("");
  });

  return `${out.join("\n")}\n`;
}
