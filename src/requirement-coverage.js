// Requirement coverage for an APPLY job: every requirement the extraction
// found, whether it is required or preferred, the candidate evidence for it and
// a status (MATCH, PARTIAL, GAP, UNKNOWN).
//
// - Statuses for technical requirements come from the scorer's own
//   requirementMatches (EXACT/SEMANTIC → MATCH, PARTIAL → PARTIAL,
//   MISSING → GAP). Nothing is re-scored differently here.
// - Evidence is quoted ONLY from the candidate profile the scorer uses
//   (skills, experience roles/functions, languages, experienceYears). If the
//   scorer reports a match but no profile entry can be quoted, the row becomes
//   UNKNOWN ("verify"), never a MATCH without evidence.
// - Soft skills, titles and other lines the scorer does not assess are listed
//   as UNKNOWN so nothing is silently dropped.
import { classifyRequirement } from "./job-scorer.js";
import { findMentions } from "./tech-lexicon.js";

export const COVERAGE_STATUSES = ["MATCH", "PARTIAL", "GAP", "UNKNOWN"];

const normalize = (value) => String(value ?? "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9+#.]+/g, " ")
  .trim();
const techIds = (text) => new Set(findMentions(String(text ?? "")).mentions.map((mention) => mention.id));
const itemText = (item) => (typeof item === "string" ? item : item?.item ?? "");

// Every quotable piece of candidate evidence, with where it comes from.
export function candidateEvidenceIndex(candidate = {}) {
  const entries = [];
  for (const [group, values] of Object.entries(candidate.skills ?? {})) {
    for (const value of [].concat(values ?? [])) {
      if (typeof value === "string" && value.trim()) entries.push({ source: `skills.${group}`, text: value });
    }
  }
  (candidate.experience ?? []).forEach((job, index) => {
    const where = [job?.role, job?.company].filter(Boolean).join(" @ ") || `experience ${index + 1}`;
    if (typeof job?.role === "string" && job.role.trim()) entries.push({ source: `experience: ${where} (role)`, text: job.role });
    for (const fn of job?.functions ?? []) {
      if (typeof fn === "string" && fn.trim()) entries.push({ source: `experience: ${where}`, text: fn });
    }
  });
  return entries.map((entry) => ({ ...entry, ids: techIds(entry.text), normalized: normalize(entry.text) }));
}

// Profile entries that name the requirement's technologies (or the scorer's
// matched terms). Plain-text equality is used only for terms the lexicon does
// not know, as whole words.
export function findEvidence(index, { item, matched = [] }) {
  const wantedIds = new Set([...techIds(item), ...matched.flatMap((term) => [...techIds(term)])]);
  const plainTerms = [item, ...matched]
    .filter((term) => techIds(term).size === 0)
    .map(normalize)
    .filter((term) => term.length >= 3);

  const hits = index.filter((entry) =>
    [...entry.ids].some((id) => wantedIds.has(id)) ||
    plainTerms.some((term) => entry.normalized === term || new RegExp(`(^| )${term.replace(/[.+#]/g, "\\$&")}( |$)`).test(entry.normalized))
  );
  const unique = new Map(hits.map((entry) => [`${entry.source}|${entry.text}`, entry]));
  return [...unique.values()].slice(0, 4).map((entry) => `${entry.source}: "${entry.text}"`);
}

const SCORER_STATUS = { EXACT: "MATCH", SEMANTIC: "MATCH", PARTIAL: "PARTIAL", MISSING: "GAP" };

function technicalRow(match, index) {
  const kind = match.required ? "Required" : "Preferred";
  let status = SCORER_STATUS[match.status] ?? "UNKNOWN";
  const evidence = status === "GAP" ? [] : findEvidence(index, { item: match.item, matched: match.matched ?? [] });
  const notes = [];
  if (status === "PARTIAL" && match.missing?.length) notes.push(`missing: ${match.missing.join(", ")}`);
  if (status === "GAP" && match.missing?.length && match.missing[0] !== match.item) notes.push(`missing: ${match.missing.join(", ")}`);
  if ((status === "MATCH" || status === "PARTIAL") && evidence.length === 0) {
    status = "UNKNOWN";
    notes.push(`the scorer matched this (${(match.matched ?? []).join(", ") || match.status}) but no profile entry names it — verify before claiming it`);
  }
  return { requirement: match.item, kind, status, evidence, note: notes.join("; "), basis: `scorer: ${match.status}` };
}

function languageRows(jobProfile, candidate, gates) {
  const known = new Map((candidate.candidate?.languages ?? []).map((language) => [normalize(language.language), language]));
  return (jobProfile.languages ?? []).filter((language) => language?.language).map((language) => {
    const own = known.get(normalize(language.language));
    const wanted = language.level ? ` (${language.level})` : "";
    const kind = language.required === true ? "Required" : "Preferred";
    if (!own) {
      return { requirement: `${language.language}${wanted}`, kind, status: "GAP", evidence: [], note: "language not in the candidate profile", basis: "profile languages" };
    }
    const evidence = [`candidate.languages: "${own.language}${own.level ? ` ${own.level}` : ""}"`];
    const gate = gates?.language;
    const status = gate?.status === "PASS" ? "MATCH" : "UNKNOWN";
    return { requirement: `${language.language}${wanted}`, kind, status, evidence, note: status === "UNKNOWN" ? `language gate: ${gate?.status ?? "not assessed"}${gate?.note ? ` — ${gate.note}` : ""}` : "", basis: "language gate" };
  });
}

function yearsRow(jobProfile, candidate) {
  const minimum = jobProfile.experience?.minimumYears;
  if (!Number.isFinite(minimum)) return [];
  const years = candidate.candidate?.experienceYears;
  if (!Number.isFinite(years)) {
    return [{ requirement: `${minimum}+ years of experience`, kind: "Required", status: "UNKNOWN", evidence: [], note: "experienceYears is not in the candidate profile", basis: "profile experienceYears" }];
  }
  return [{
    requirement: `${minimum}+ years of experience`,
    kind: "Required",
    status: years >= minimum ? "MATCH" : "GAP",
    evidence: [`candidate.experienceYears: ${years}`],
    note: years >= minimum ? "" : `${minimum - years} year(s) short of the stated minimum`,
    basis: "profile experienceYears"
  }];
}

// rows for every requirement; `scored` is scoreJob(candidate, jobProfile).
export function buildRequirementCoverage({ candidate, jobProfile, scored }) {
  const index = candidateEvidenceIndex(candidate);
  const matches = scored?.requirementMatches ?? [];
  const rows = matches.map((match) => technicalRow(match, index));

  const assessed = new Set(matches.map((match) => `${match.required ? "r" : "p"}|${normalize(match.item)}`));
  for (const [list, required] of [[jobProfile.requirements?.required ?? [], true], [jobProfile.requirements?.preferred ?? [], false]]) {
    for (const item of list) {
      const text = itemText(item);
      if (!text || assessed.has(`${required ? "r" : "p"}|${normalize(text)}`)) continue;
      const kind = classifyRequirement(item);
      if (kind === "language" || kind === "empty") continue; // languages: own rows below
      if (kind === "experience" && techIds(text).size === 0) continue; // years: own row below
      rows.push({
        requirement: text,
        kind: required ? "Required" : "Preferred",
        status: "UNKNOWN",
        evidence: [],
        note: `not assessed automatically (${kind}); judge from your own experience`,
        basis: `not scored (${kind})`
      });
    }
  }
  rows.push(...yearsRow(jobProfile, candidate), ...languageRows(jobProfile, candidate, scored?.gates));

  const summary = Object.fromEntries(COVERAGE_STATUSES.map((status) => [status, rows.filter((row) => row.status === status).length]));
  const requiredGaps = rows.filter((row) => row.kind === "Required" && row.status === "GAP").map((row) => row.requirement);
  return { rows, summary, requiredGaps };
}
