import { demoInsights } from "@/demo-data/insights";
import { demoJobs } from "@/demo-data/jobs";
import { demoProfile } from "@/demo-data/profile";
import { candidateProfileSchema, insightsSchema, jobResultSchema, preferencesSchema } from "@/lib/schema";
import type { JobSearchApi, SearchProgress } from "./types";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// `?demo=error` / `?demo=empty` let reviewers see the failure and empty states.
function demoFlag(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("demo");
}

async function simulate<T>(value: T, ms = 450): Promise<T> {
  await wait(ms);
  if (demoFlag() === "error") throw new Error("The demo data source is unavailable (simulated). Try again.");
  return value;
}

const STAGES: SearchProgress[] = [
  { stage: "discover", percent: 12, message: "Demo replay: searching Adzuna, Himalayas and FreeHire" },
  { stage: "filter", percent: 30, message: "Demo replay: applying the title and framework filter" },
  { stage: "pre-rank", percent: 48, message: "Demo replay: ranking by location, role and seniority" },
  { stage: "enrich", percent: 64, message: "Demo replay: reading full descriptions for the best matches" },
  { stage: "analyse", percent: 84, message: "Demo replay: extracting requirements from each posting" },
  { stage: "score", percent: 100, message: "Demo replay: scoring against your profile" }
];

export const demoApi: JobSearchApi = {
  mode: "demo",
  getProfile: () => simulate(candidateProfileSchema.parse(demoProfile), 350),
  parseCv: async () => {
    await wait(1400);
    return candidateProfileSchema.parse(demoProfile);
  },
  getDefaultPreferences: async () =>
    preferencesSchema.parse({
      targetRoles: ["Frontend Developer", "React Developer", "Next.js Developer"],
      acceptedCities: ["Alicante", "Valencia"],
      workModes: ["remote", "hybrid", "onsite"],
      remoteScopes: ["spain", "europe", "uk"],
      minScore: 60,
      includeSenior: true
    }),
  listJobs: async () => {
    const jobs = await simulate(demoJobs.map((job) => jobResultSchema.parse(job)));
    return demoFlag() === "empty" ? [] : jobs;
  },
  getJob: async (stateKey) => {
    const jobs = await simulate(demoJobs, 300);
    const job = jobs.find((candidate) => candidate.stateKey === stateKey);
    return job ? jobResultSchema.parse(job) : null;
  },
  getInsights: () => simulate(insightsSchema.parse(demoInsights), 400),
  runSearch: async (_preferences, onProgress) => {
    for (const step of STAGES) {
      await wait(step.stage === "analyse" ? 1100 : 750);
      onProgress(step);
    }
    return { jobs: demoJobs.length };
  }
};
