import type { CandidateProfile, Insights, JobResult, Preferences } from "@/lib/schema";

export type SearchStage = "discover" | "filter" | "pre-rank" | "enrich" | "analyse" | "score";

export type SearchProgress = {
  stage: SearchStage;
  /** 0-100 for the whole run. */
  percent: number;
  message: string;
};

/**
 * Everything the UI needs from the agent. Today it is implemented by the demo
 * adapter (synthetic data). A later phase can implement the same interface over
 * HTTP against the real Node.js agent without touching any component.
 */
export interface JobSearchApi {
  readonly mode: "demo";
  getProfile(): Promise<CandidateProfile>;
  /** Demo: returns the synthetic profile; the file is never read or uploaded. */
  parseCv(fileName: string | null): Promise<CandidateProfile>;
  getDefaultPreferences(): Promise<Preferences>;
  listJobs(): Promise<JobResult[]>;
  getJob(stateKey: string): Promise<JobResult | null>;
  getInsights(): Promise<Insights>;
  runSearch(preferences: Preferences, onProgress: (progress: SearchProgress) => void): Promise<{ jobs: number }>;
}
