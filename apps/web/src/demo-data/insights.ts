// Synthetic insights shaped like the skill-gap report (src/skill-gap.js) and the
// run log + triage records (src/job-state.js, src/triage.js).
import { insightsSchema, type Insights, type SkillGap } from "@/lib/schema";
import { demoJobs } from "./jobs";

const ANALYSED = demoJobs.length;

type Row = Omit<SkillGap, "percent" | "priority">;
// src/skill-gap.js priorityFor(): HIGH needs >=3 jobs, >=30% of them, and half required.
function priorityFor(row: Row): SkillGap["priority"] {
  if (row.level === "Strong") return "—";
  if (row.relevance === "off-target") return "LOW";
  const share = ANALYSED ? row.count / ANALYSED : 0;
  if (row.count >= 3 && share >= 0.3 && row.required >= Math.ceil(row.count / 2)) return "HIGH";
  if (row.count >= 2 && (row.relevance === "core" || row.required >= 1)) return "MEDIUM";
  return "LOW";
}

const rows: Row[] = [
  { id: "react", skill: "React", relevance: "core", count: 11, required: 10, preferred: 1, level: "Strong", evidence: ['skills.primary: "React"'], note: "" },
  { id: "typescript", skill: "TypeScript", relevance: "core", count: 8, required: 7, preferred: 1, level: "Strong", evidence: ['skills.primary: "TypeScript"'], note: "" },
  { id: "nextjs", skill: "Next.js", relevance: "core", count: 3, required: 3, preferred: 0, level: "Strong", evidence: ['skills.primary: "Next.js"'], note: "" },
  { id: "nodejs", skill: "Node.js", relevance: "core", count: 4, required: 3, preferred: 1, level: "Partial", evidence: ['skills.secondary: "REST APIs"', 'skills.secondary: "JWT Authentication"'], note: "related only: API and authentication work is not evidence of Node.js itself" },
  { id: "rest-apis", skill: "REST APIs", relevance: "core", count: 4, required: 3, preferred: 1, level: "Strong", evidence: ['skills.secondary: "REST APIs"'], note: "" },
  { id: "testing", skill: "Testing", relevance: "core", count: 4, required: 3, preferred: 1, level: "Strong", evidence: ['skills.testing: "Vitest"'], note: "" },
  { id: "graphql", skill: "GraphQL", relevance: "core", count: 3, required: 0, preferred: 3, level: "Partial", evidence: ['skills.secondary: "REST APIs"'], note: "related only: REST experience is not GraphQL experience" },
  { id: "docker", skill: "Docker", relevance: "web", count: 3, required: 1, preferred: 2, level: "Missing", evidence: [], note: "" },
  { id: "storybook", skill: "Storybook", relevance: "web", count: 2, required: 2, preferred: 0, level: "Missing", evidence: [], note: "" },
  { id: "playwright", skill: "Playwright", relevance: "web", count: 2, required: 1, preferred: 1, level: "Partial", evidence: ['skills.testing: "Vitest"'], note: "related only: component and integration testing, not Playwright itself" },
  { id: "cicd", skill: "CI/CD", relevance: "web", count: 2, required: 0, preferred: 2, level: "Partial", evidence: ['skills.tools: "GitHub"', 'skills.tools: "Vercel"'], note: "related only: hosting and repository tools, not pipeline experience" },
  { id: "postgresql", skill: "PostgreSQL", relevance: "off-target", count: 2, required: 2, preferred: 0, level: "Missing", evidence: [], note: "" },
  { id: "csharp", skill: "C#", relevance: "off-target", count: 1, required: 1, preferred: 0, level: "Missing", evidence: [], note: "" },
  { id: "kubernetes", skill: "Kubernetes", relevance: "off-target", count: 1, required: 1, preferred: 0, level: "Missing", evidence: [], note: "" }
];

export const demoInsights: Insights = insightsSchema.parse({
  generatedAt: "2026-10-19T17:09:43.000Z",
  funnel: {
    discovered: 184,
    passedFilter: 141,
    eligible: 34,
    analysed: ANALYSED,
    cachedReused: 4,
    newlyAnalysed: ANALYSED - 4,
    exclusions: [
      { stage: "filter", reason: "Title excluded (mobile, DevOps, data, clearance)", count: 14 },
      { stage: "filter", reason: "Not enough frontend evidence in the title", count: 11 },
      { stage: "filter", reason: "Different frontend framework (Vue, Angular, Svelte) without React", count: 7 },
      { stage: "filter", reason: "Broader role without React or web evidence", count: 11 },
      { stage: "pre-ranker", reason: "Location not eligible (onsite outside Alicante/Valencia, other regions)", count: 71 },
      { stage: "pre-ranker", reason: "Requires 5 or more years of experience", count: 22 },
      { stage: "pre-ranker", reason: "Lead, principal, staff or intern title", count: 14 },
      { stage: "pre-ranker", reason: "Eligible, but outside the analysis limit", count: 20 },
      { stage: "enrichment", reason: "Dropped after the full-description re-check", count: 2 }
    ]
  },
  skillGaps: rows
    .map((row) => ({ ...row, percent: Math.round((row.count / ANALYSED) * 100), priority: priorityFor(row) }))
    .sort((a, b) => b.count - a.count || b.required - a.required || a.skill.localeCompare(b.skill))
});
