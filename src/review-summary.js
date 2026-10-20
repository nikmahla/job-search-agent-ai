// Human-review lines for one saved job result (an entry of data/job-results.json).
// Built only from data the analysis already produced — requirementMatches,
// missingRequiredSkills, gates, extraction status and the source's location.
// Nothing is inferred and the decision is never changed.
const MATCHED_STATUSES = new Set(["EXACT", "SEMANTIC", "PARTIAL"]);
const GATE_LABELS = {
  roleFit: "Role fit",
  experience: "Experience",
  language: "Language",
  workAuthorization: "Work authorization",
  location: "Location"
};
const MAX_MATCHES = 8;
const MAX_GAPS = 3;
const MAX_TEXT = 70;

const clip = (text) => {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value;
};

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function reviewMatches(result) {
  const fromRequirements = (result?.requirementMatches ?? [])
    .filter((match) => MATCHED_STATUSES.has(match?.status))
    .flatMap((match) => match.matched ?? []);
  const found = unique(fromRequirements.length ? fromRequirements : result?.ats?.matchedKeywords ?? []);
  return found.slice(0, MAX_MATCHES);
}

export function reviewConcerns(result) {
  const concerns = [];
  const missing = unique(result?.missingRequiredSkills ?? []);
  missing.slice(0, MAX_GAPS).forEach((skill) => concerns.push(clip(skill)));
  if (missing.length > MAX_GAPS) concerns.push(`+${missing.length - MAX_GAPS} more required gap(s)`);
  for (const [key, label] of Object.entries(GATE_LABELS)) {
    const gate = result?.gates?.[key];
    if (gate && gate.status !== "PASS") concerns.push(`${label} ${gate.status}${gate.note ? `: ${clip(gate.note)}` : ""}`);
  }
  if (result?.extraction && result.extraction.status !== "complete") concerns.push("extraction incomplete");
  return concerns;
}

export function reviewLocation(result) {
  const gate = result?.gates?.location;
  const place = result?.sourceInfo?.location;
  const parts = [place, gate ? `${gate.status}${gate.note ? ` — ${clip(gate.note)}` : ""}` : null].filter(Boolean);
  return parts.join(" · ") || "unknown";
}

// Lines to print for APPLY/MAYBE jobs; empty for anything else.
export function reviewSummaryLines(result) {
  if (!["APPLY", "MAYBE"].includes(result?.decision)) return [];
  const matches = reviewMatches(result);
  const concerns = reviewConcerns(result);
  return [
    `   Remote/location: ${reviewLocation(result)}`,
    `   Matches: ${matches.join(", ") || "none found"}`,
    `   Gaps/concerns: ${concerns.join("; ") || "none found"}`
  ];
}
