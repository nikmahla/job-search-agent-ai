// Schemas for the data the UI shows. They mirror what the existing agent already
// produces; nothing here adds agent behaviour.
//
//  - JobResult        <- entries of data/job-results.json (src/job-scorer.js scoreJob(),
//                        plus stateKey/sourceInfo added in src/run-agent.js)
//  - CoverageRow      <- src/requirement-coverage.js (the application-pack table)
//  - CandidateProfile <- data/candidate-profile.json (what src/job-scorer.js reads)
//  - SkillGapReport   <- src/skill-gap.js buildSkillGapReport()
//  - Funnel           <- run log (src/job-state.js recordRun) + triage records (src/triage.js)
//  - Preferences      <- UI-only. It maps loosely to search-config.js and the candidate
//                        profile (target roles, accepted cities, remote scope) but the
//                        demo does not run a search.
import { z } from "zod";

export const decisionSchema = z.enum(["APPLY", "MAYBE", "SKIP"]);
export type Decision = z.infer<typeof decisionSchema>;

export const gateStatusSchema = z.enum(["PASS", "FLAG", "FAIL", "UNKNOWN"]);
export type GateStatus = z.infer<typeof gateStatusSchema>;

export const GATE_KEYS = ["roleFit", "experience", "language", "workAuthorization", "location"] as const;
export type GateKey = (typeof GATE_KEYS)[number];
export const GATE_LABELS: Record<GateKey, string> = {
  roleFit: "Role fit",
  experience: "Experience",
  language: "Language",
  workAuthorization: "Work authorization",
  location: "Location"
};

const gateSchema = z.object({ status: gateStatusSchema, note: z.string() });
export const gatesSchema = z.object({
  roleFit: gateSchema,
  experience: gateSchema,
  language: gateSchema,
  workAuthorization: gateSchema,
  location: gateSchema
});
export type Gates = z.infer<typeof gatesSchema>;

// src/job-scorer.js calculateWeightedScore(): parts with no data are skipped.
export const BREAKDOWN_KEYS = ["technical", "experience", "responsibilities", "qualifications", "career"] as const;
export type BreakdownKey = (typeof BREAKDOWN_KEYS)[number];
export const BREAKDOWN_WEIGHTS: Record<BreakdownKey, number> = {
  technical: 0.3,
  experience: 0.2,
  responsibilities: 0.2,
  qualifications: 0.15,
  career: 0.15
};
export const BREAKDOWN_LABELS: Record<BreakdownKey, string> = {
  technical: "Technical skills",
  experience: "Experience",
  responsibilities: "Responsibilities",
  qualifications: "Qualifications",
  career: "Career direction"
};

export const breakdownSchema = z.object({
  technical: z.number().nullable(),
  experience: z.number().nullable(),
  responsibilities: z.number().nullable(),
  qualifications: z.number().nullable(),
  career: z.number().nullable(),
  scoringCoverage: z.number().nullable()
});
export type Breakdown = z.infer<typeof breakdownSchema>;

// scorer requirementMatches: EXACT/SEMANTIC/PARTIAL/MISSING
export const requirementMatchSchema = z.object({
  item: z.string(),
  required: z.boolean(),
  priority: z.enum(["critical", "important", "secondary", "preferred"]),
  status: z.enum(["EXACT", "SEMANTIC", "PARTIAL", "MISSING"]),
  score: z.number(),
  matched: z.array(z.string()),
  missing: z.array(z.string()),
  method: z.enum(["atomic", "sentence", "variant"])
});
export type RequirementMatch = z.infer<typeof requirementMatchSchema>;

// requirement-coverage.js rows
export const coverageStatusSchema = z.enum(["MATCH", "PARTIAL", "GAP", "UNKNOWN"]);
export type CoverageStatus = z.infer<typeof coverageStatusSchema>;
export const coverageRowSchema = z.object({
  requirement: z.string(),
  kind: z.enum(["Required", "Preferred"]),
  status: coverageStatusSchema,
  evidence: z.array(z.string()),
  note: z.string()
});
export type CoverageRow = z.infer<typeof coverageRowSchema>;

export const sourceInfoSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  source: z.enum(["adzuna", "himalayas", "freehire"]),
  sources: z.array(z.string()),
  sourceAttribution: z.string().nullable(),
  location: z.string(),
  sourceCountry: z.string(),
  searchMode: z.enum(["local", "remote"]),
  remote: z.boolean(),
  hybrid: z.boolean(),
  created: z.string().nullable()
});
export type SourceInfo = z.infer<typeof sourceInfoSchema>;

export const jobResultSchema = z.object({
  stateKey: z.string(),
  title: z.string(),
  company: z.string(),
  jobFitScore: z.number().nullable(),
  atsScore: z.number().nullable(),
  scoringCoverage: z.number().nullable(),
  decision: decisionSchema,
  decisionReasons: z.array(z.string()),
  gates: gatesSchema,
  breakdown: breakdownSchema,
  ats: z.object({
    score: z.number(),
    keywordScore: z.number(),
    titleScore: z.number(),
    matchedKeywords: z.array(z.string())
  }),
  missingRequiredSkills: z.array(z.string()),
  missingPreferredSkills: z.array(z.string()),
  requirementMatches: z.array(requirementMatchSchema),
  extraction: z.object({ status: z.enum(["complete", "uncertain", "incomplete"]), warnings: z.array(z.string()) }),
  availability: z.object({ active: z.boolean().nullable(), status: z.string(), reason: z.string() }),
  sourceInfo: sourceInfoSchema,
  // From the application pack (requirement-coverage.js): quoted profile evidence per requirement.
  coverage: z.array(coverageRowSchema),
  // Short excerpt of the posting text the pipeline saw.
  excerpt: z.string()
});
export type JobResult = z.infer<typeof jobResultSchema>;

export const candidateProfileSchema = z.object({
  candidate: z.object({
    name: z.string(),
    experienceYears: z.number(),
    location: z.object({ acceptedCities: z.array(z.string()) }),
    workAuthorization: z.object({ eu: z.boolean() }),
    languages: z.array(z.object({ language: z.string(), level: z.string() })),
    remoteWork: z.boolean()
  }),
  professionalProfile: z.object({ targetRoles: z.array(z.string()), primaryDomain: z.string() }),
  skills: z.record(z.string(), z.array(z.string())),
  experience: z.array(z.object({
    role: z.string(),
    company: z.string(),
    durationYears: z.number(),
    functions: z.array(z.string())
  })),
  education: z.array(z.object({ degree: z.string() })),
  atsKeywords: z.array(z.string()),
  // UI-only: the CV line each skill was read from (the agent rule: no skill without evidence).
  cvEvidence: z.record(z.string(), z.string())
});
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;

export const preferencesSchema = z.object({
  targetRoles: z.array(z.string()),
  acceptedCities: z.array(z.string()),
  workModes: z.array(z.enum(["remote", "hybrid", "onsite"])),
  remoteScopes: z.array(z.enum(["spain", "europe", "uk"])),
  minScore: z.number().min(0).max(100),
  includeSenior: z.boolean()
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const skillGapSchema = z.object({
  id: z.string(),
  skill: z.string(),
  relevance: z.enum(["core", "web", "off-target"]),
  count: z.number(),
  percent: z.number(),
  required: z.number(),
  preferred: z.number(),
  level: z.enum(["Strong", "Partial", "Missing"]),
  evidence: z.array(z.string()),
  note: z.string(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW", "—"])
});
export type SkillGap = z.infer<typeof skillGapSchema>;

export const funnelSchema = z.object({
  discovered: z.number(),
  passedFilter: z.number(),
  eligible: z.number(),
  analysed: z.number(),
  cachedReused: z.number(),
  newlyAnalysed: z.number(),
  exclusions: z.array(z.object({
    stage: z.enum(["filter", "pre-ranker", "enrichment", "analysis"]),
    reason: z.string(),
    count: z.number()
  }))
});
export type Funnel = z.infer<typeof funnelSchema>;

export const insightsSchema = z.object({
  generatedAt: z.string(),
  funnel: funnelSchema,
  skillGaps: z.array(skillGapSchema)
});
export type Insights = z.infer<typeof insightsSchema>;
