import { demoApi } from "./demo-api";
import type { JobSearchApi } from "./types";

// Single switch point: replace with an HTTP adapter when the real agent API exists.
export const api: JobSearchApi = demoApi;
export type { JobSearchApi, SearchProgress, SearchStage } from "./types";
