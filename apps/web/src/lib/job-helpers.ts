import { demoProfile } from "@/demo-data/profile";
import { GATE_KEYS, GATE_LABELS, type JobResult } from "@/lib/schema";

const canonicalSkill = new Map(Object.values(demoProfile.skills).flat().map((skill) => [skill.toLowerCase(), skill]));

/** Matched skills as the profile spells them (same data the CLI summary prints). */
export function matchedSkills(job: JobResult, limit = 5): string[] {
  const names = job.ats.matchedKeywords.map((keyword) => canonicalSkill.get(keyword.toLowerCase()) ?? keyword);
  return [...new Set(names)].slice(0, limit);
}

/** Required gaps first, then any gate that is not a clean PASS. */
export function concerns(job: JobResult, limit = 3): string[] {
  const gaps = job.missingRequiredSkills;
  const gates = GATE_KEYS.filter((key) => job.gates[key].status !== "PASS").map(
    (key) => `${GATE_LABELS[key]} ${job.gates[key].status === "FAIL" ? "failed" : "needs review"}`
  );
  const all = [...gaps, ...gates];
  return all.length > limit ? [...all.slice(0, limit), `+${all.length - limit} more`] : all;
}

export function workMode(job: JobResult): "Remote" | "Hybrid" | "Onsite" {
  if (job.sourceInfo.hybrid) return "Hybrid";
  return job.sourceInfo.remote ? "Remote" : "Onsite";
}

export const jobHref = (job: JobResult) => `/jobs/${encodeURIComponent(job.stateKey)}`;

export function formatDate(value: string | null): string {
  if (!value) return "Date not given";
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export const SOURCE_LABEL: Record<string, string> = { adzuna: "Adzuna", himalayas: "Himalayas", freehire: "FreeHire" };
