import { demoProfile } from "@/demo-data/profile";

/** Turns a coverage evidence string such as `skills.primary: "React"` into the CV line it came from. */
export function cvQuoteFor(evidence: string): { source: string; quote: string } {
  const match = evidence.match(/^(.*?):\s*"(.*)"$/);
  if (!match) return { source: evidence.split(":")[0] ?? "profile", quote: evidence };
  const [, source, value] = match;
  const line = demoProfile.cvEvidence[value];
  return { source: source.replace(/^skills\./, "skills · ").replace(/^experience:/, "experience ·"), quote: line ?? value };
}
