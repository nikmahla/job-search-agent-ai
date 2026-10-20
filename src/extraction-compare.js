// Pure comparison of two extractions of the same posting (A/B: Qwen vs Claude).
// Works on the extraction summary stored by scripts/qwen-validation.js, so a
// saved Qwen run can be reused without running Qwen again.
import { findMentions, techDisplayName } from "./tech-lexicon.js";

const itemText = (item) => (typeof item === "string" ? item : item?.item ?? "");

// The summary stored per extractor in the validation files.
export function summarizeExtraction(profile = {}) {
  return {
    status: profile.extraction?.status ?? null,
    warnings: profile.extraction?.warnings ?? [],
    required: (profile.requirements?.required ?? []).map(itemText),
    preferred: (profile.requirements?.preferred ?? []).map(itemText),
    minimumYears: profile.experience?.minimumYears ?? null,
    languages: profile.languages ?? [],
    location: profile.location ?? {},
    workAuthorization: profile.workAuthorization ?? {}
  };
}

// Rebuilds the profile fields the audit needs from a stored summary.
export function profileFromSummary(summary = {}) {
  return {
    requirements: {
      required: (summary.required ?? []).map((item) => ({ type: "skill", item, priority: "important" })),
      preferred: (summary.preferred ?? []).map((item) => ({ type: "skill", item, priority: "preferred" }))
    },
    experience: { minimumYears: summary.minimumYears ?? null, requiredFunctions: [] },
    responsibilities: { core: [], secondary: [] },
    languages: summary.languages ?? []
  };
}

const techSet = (items = []) => new Set(items.flatMap((item) => findMentions(itemText(item)).mentions.map((mention) => mention.id)));
const names = (ids) => [...ids].map(techDisplayName).sort();
const minus = (a, b) => new Set([...a].filter((id) => !b.has(id)));
const normalizeName = (value) => String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

function requiredLanguages(summary) {
  return Object.fromEntries(
    (summary.languages ?? [])
      .filter((language) => language?.required === true && language.language)
      .map((language) => [normalizeName(language.language), language.level ?? null])
  );
}

const countBy = (findings = []) => findings.reduce((counts, finding) => {
  if (finding.severity !== "info") counts[finding.type] = (counts[finding.type] ?? 0) + 1;
  return counts;
}, {});

// a / b: { label, summary, findings, decision }
export function compareExtractions(a, b) {
  const aRequired = techSet(a.summary.required);
  const bRequired = techSet(b.summary.required);
  const aPreferred = techSet(a.summary.preferred);
  const bPreferred = techSet(b.summary.preferred);

  const requiredVsPreferred = [
    ...[...aRequired].filter((id) => bPreferred.has(id) && !bRequired.has(id)).map((id) => `${techDisplayName(id)}: ${a.label} required, ${b.label} preferred`),
    ...[...bRequired].filter((id) => aPreferred.has(id) && !aRequired.has(id)).map((id) => `${techDisplayName(id)}: ${b.label} required, ${a.label} preferred`)
  ];

  const aLanguages = requiredLanguages(a.summary);
  const bLanguages = requiredLanguages(b.summary);
  const languageDiffs = [...new Set([...Object.keys(aLanguages), ...Object.keys(bLanguages)])]
    .filter((language) => aLanguages[language] !== bLanguages[language])
    .map((language) => `${language}: ${a.label}=${language in aLanguages ? aLanguages[language] ?? "required" : "not required"}, ${b.label}=${language in bLanguages ? bLanguages[language] ?? "required" : "not required"}`);

  const fieldDiff = (label, left, right) => (left === right ? [] : [`${label}: ${a.label}=${left ?? "null"}, ${b.label}=${right ?? "null"}`]);

  return {
    requiredTechOnly: { [a.label]: names(minus(aRequired, bRequired)), [b.label]: names(minus(bRequired, aRequired)) },
    preferredTechOnly: { [a.label]: names(minus(aPreferred, bPreferred)), [b.label]: names(minus(bPreferred, aPreferred)) },
    requiredVsPreferred,
    itemCounts: {
      [a.label]: { required: a.summary.required.length, preferred: a.summary.preferred.length },
      [b.label]: { required: b.summary.required.length, preferred: b.summary.preferred.length }
    },
    fieldDiffs: [
      ...fieldDiff("minimumYears", a.summary.minimumYears, b.summary.minimumYears),
      ...fieldDiff("location.type", a.summary.location?.type, b.summary.location?.type),
      ...fieldDiff("location.remoteScope", a.summary.location?.remoteScope, b.summary.location?.remoteScope),
      ...fieldDiff("workAuthorization.required", a.summary.workAuthorization?.required, b.summary.workAuthorization?.required),
      ...fieldDiff("extraction.status", a.summary.status, b.summary.status),
      ...languageDiffs
    ],
    auditFindings: { [a.label]: countBy(a.findings), [b.label]: countBy(b.findings) },
    decisions: { [a.label]: a.decision, [b.label]: b.decision },
    decisionsDiffer: a.decision !== b.decision
  };
}
