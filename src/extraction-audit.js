// Deterministic audit of an LLM job extraction against the posting text.
//
// The scorer trusts the extractor's required/preferred split, minimum years and
// language requirements. This module checks those fields against the original
// description and reports findings that can be verified from the text alone:
//
// - PREFERRED_AS_REQUIRED: a required item whose technologies appear in the
//   posting only in optional wording ("nice to have", "a plus", "deseable"...).
// - REQUIRED_AS_PREFERRED: a preferred item stated only in mandatory wording.
// - NOT_IN_POSTING: a required item naming technologies the posting never mentions.
// - YEARS_PREFERRED_AS_MINIMUM / YEARS_MISSED: minimumYears disagrees with the text.
// - LANGUAGE_OPTIONAL_AS_REQUIRED: a required language mentioned only as optional.
// - TECH_NOT_EXTRACTED (info): technologies in requirement wording that no
//   extracted requirement covers.
//
// `correctExtraction` applies only the high-confidence findings so the impact
// of an extraction error on APPLY/MAYBE/SKIP can be measured. Pure: no I/O.
import { findMentions, techDisplayName } from "./tech-lexicon.js";
import { analyzeYearsRequirements, sectionHeading } from "./job-pre-ranker.js";

const OPTIONAL_CUE = /\b(nice to have|nice-to-have|a plus|is a plus|are a plus|plus point|bonus|preferred|preferably|desirable|ideally|optional|advantage|advantageous|would be great|deseable|deseables|valorable|valorables|se valorara|se valora|sera un plus|seria un plus|un plus|gradito|graditi|preferibile|costituisce un plus|wunschenswert|von vorteil)\b/;
const REQUIRED_CUE = /\b(required|requirements?|must|mandatory|essential|you have|you bring|we expect|requisitos?|imprescindible|obligatorio|necesario|indispensabile|richiesto|requisiti|erforderlich|voraussetzung)\b/;

function normalizeLine(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Inline headings in postings whose line breaks were lost (Himalayas and
// enriched pages are often one long line). A line break is inserted before
// each so headings and sections are still recognised.
const INLINE_HEADINGS = [
  "key responsibilities", "role responsibilities", "responsibilities", "what you(?:'| wi)ll do", "your role",
  "essential requirements", "key requirements", "basic qualifications",
  "requirements", "required skills", "minimum qualifications", "preferred qualifications", "qualifications",
  "must have", "nice to have", "nice-to-have", "bonus points", "bonus", "what you bring", "your profile",
  "about you", "what we offer", "benefits", "about us", "job summary",
  "requisitos", "se valorar[aá]", "funciones", "responsabilidades", "ofrecemos",
  "requisiti", "responsabilit[aà]", "gradito", "offriamo"
].join("|");
const INLINE_HEADING_PATTERN = new RegExp(`\\s(?=(?:${INLINE_HEADINGS})\\s*:)`, "gi");
// A flattened bullet list: a capitalised action word directly after a word or
// closing bracket, with no punctuation in between ("…using React JS Build
// responsive interfaces…").
const FLATTENED_BULLET = /(?<=[A-Za-z0-9)])\s+(?=(?:\d+\+?\s*(?:years?|yrs|años|anos|anni)\b|Very|Fluent|Deep|Advanced|Familiar|Practical|Previous|At least|Minimum|Develop|Build|Write|Perform|Translate|Collaborate|Experience|Strong|Proficiency|Proficient|Knowledge|Familiarity|Ability|Bachelor|Degree|Excellent|Good|Solid|Proven|Hands-on|Understanding|Work|Maintain|Design|Optimi[sz]e|Ensure|Participate|Implement|Create|Support|Analy[sz]e|Own|Drive|Contribute|Deliver|Test|Review|Experiencia|Conocimientos|Desarrollar|Esperienza|Conoscenza|Sviluppare)\b)/g;
// Required-section headings beyond the shared ones ("Essential Requirements:").
const EXTRA_REQUIRED_HEADING = /^(essential|key|basic|core|minimum) (requirements|qualifications)\s*:?$/;

// A preference among alternatives is not an optional requirement:
// "React (preferably Next.js)", "AWS, Google Cloud, or Azure (Azure preferred)",
// "Azure preferred, Google Cloud, AWS". Removed before looking for optional cues.
function withoutAlternativePreferences(text) {
  return text
    .replace(/\([^)]*\b(preferred|preferably|ideally|e\.g\.|such as|for example|preferiblemente|preferibilmente)\b[^)]*\)/g, " ")
    .replace(/\b[\w.+#-]+ (preferred|preferably)\b(?=\s*(,|\bor\b))/g, " ");
}

// Headings that start a neutral section (ends any optional section).
const NEUTRAL_HEADING = /^(key responsibilities|role responsibilities|responsibilities|what you('| wi)ll do|your role|what we offer|benefits|about us|job summary|funciones|responsabilidades|ofrecemos|responsabilita|offriamo)\s*:?$/;

// Splits the description into lines/sentences tagged with the section they
// belong to ("optional" after a "Nice to have:" heading, "required" after a
// "Requirements:" heading, otherwise null).
export function segmentPosting(description = "") {
  const segments = [];
  let section = null;
  const prepared = String(description)
    .replace(INLINE_HEADING_PATTERN, "\n")
    .replace(/(^|\n)([^\n:]{2,60}:)\s*/g, "$1$2\n")
    .replace(FLATTENED_BULLET, "\n");
  for (const rawLine of prepared.split(/\r?\n|•|·|(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ])/)) {
    const line = normalizeLine(rawLine);
    if (!line) continue;
    if (NEUTRAL_HEADING.test(line.replace(/[:\-–—]+\s*$/, "").trim()) && line.length <= 60) {
      section = null;
      continue;
    }
    if (EXTRA_REQUIRED_HEADING.test(line) && line.length <= 60) {
      section = "required";
      continue;
    }
    // Same heading rules as the years parser in job-pre-ranker.js.
    const heading = sectionHeading(line);
    if (heading) {
      section = heading;
      continue;
    }
    const ids = new Set(findMentions(rawLine).mentions.map((mention) => mention.id));
    const cueText = withoutAlternativePreferences(line);
    segments.push({
      text: line,
      section,
      optional: OPTIONAL_CUE.test(cueText) || section === "optional",
      required: (REQUIRED_CUE.test(cueText) || section === "required") && !OPTIONAL_CUE.test(cueText),
      ids
    });
  }
  return segments;
}

// The same segmentation as text, one segment per line, with preferences among
// alternatives removed: used for the years check so it sees bullets that the
// original flattened text ran together.
function preparedForYears(description) {
  return segmentPosting(description)
    .map((segment) => (segment.section === "optional" ? `nice to have: ${segment.text}` : withoutAlternativePreferences(segment.text)))
    .join("\n");
}

const itemText = (item) => (typeof item === "string" ? item : item?.item ?? "");
const techIds = (text) => [...new Set(findMentions(text).mentions.map((mention) => mention.id))];
const snippet = (text) => (text.length > 140 ? `${text.slice(0, 137)}...` : text);

function segmentsMentioning(segments, ids) {
  return segments.filter((segment) => ids.some((id) => segment.ids.has(id)));
}

export function auditExtraction(description = "", profile = {}) {
  const findings = [];
  const segments = segmentPosting(description);
  const required = profile.requirements?.required ?? [];
  const preferred = profile.requirements?.preferred ?? [];

  for (const requirement of required) {
    const text = itemText(requirement);
    const ids = techIds(text);
    if (!ids.length) continue;
    const mentioning = segmentsMentioning(segments, ids);
    if (!mentioning.length) {
      findings.push({
        type: "NOT_IN_POSTING", severity: "high", item: text,
        detail: `Required item names ${ids.map(techDisplayName).join(", ")}, which the posting never mentions.`
      });
    } else if (mentioning.every((segment) => segment.optional)) {
      findings.push({
        type: "PREFERRED_AS_REQUIRED", severity: "high", item: text,
        detail: "The posting mentions this only in optional wording.", evidence: snippet(mentioning[0].text)
      });
    }
  }

  for (const requirement of preferred) {
    const text = itemText(requirement);
    const ids = techIds(text);
    if (!ids.length) continue;
    const mentioning = segmentsMentioning(segments, ids);
    if (mentioning.length && mentioning.every((segment) => (segment.required || segment.section === "required") && !segment.optional)) {
      findings.push({
        type: "REQUIRED_AS_PREFERRED", severity: "medium", item: text,
        detail: "The posting states this only in mandatory wording.", evidence: snippet(mentioning[0].text)
      });
    }
  }

  const minimumYears = profile.experience?.minimumYears;
  const stated = analyzeYearsRequirements(preparedForYears(description));
  if (typeof minimumYears === "number" && stated.requiredMinimum === null && stated.optionalYears.includes(minimumYears)) {
    findings.push({
      type: "YEARS_PREFERRED_AS_MINIMUM", severity: "high", item: `${minimumYears}+ years`,
      detail: `minimumYears=${minimumYears}, but the posting states ${minimumYears}+ years only as preferred.`
    });
  } else if (stated.requiredMinimum !== null && (typeof minimumYears !== "number" || minimumYears < stated.requiredMinimum)) {
    findings.push({
      type: "YEARS_MISSED", severity: "medium", item: `${stated.requiredMinimum}+ years`,
      detail: `The posting requires ${stated.requiredMinimum}+ years; the extraction has minimumYears=${minimumYears ?? "null"}.`
    });
  }

  for (const language of profile.languages ?? []) {
    if (language?.required !== true || !language.language) continue;
    const name = normalizeLine(language.language);
    const mentioning = segments.filter((segment) => segment.text.includes(name));
    if (mentioning.length && mentioning.every((segment) => segment.optional)) {
      findings.push({
        type: "LANGUAGE_OPTIONAL_AS_REQUIRED", severity: "high", item: language.language,
        detail: "The posting mentions this language only as optional.", evidence: snippet(mentioning[0].text)
      });
    }
  }

  const covered = new Set([...required, ...preferred].flatMap((requirement) => techIds(itemText(requirement))));
  const responsibilityIds = new Set([
    ...(profile.responsibilities?.core ?? []), ...(profile.responsibilities?.secondary ?? [])
  ].flatMap(techIds));
  const missed = new Set();
  for (const segment of segments) {
    if (!(segment.required || segment.section === "required")) continue;
    for (const id of segment.ids) {
      if (!covered.has(id) && !responsibilityIds.has(id) && id !== "frontend" && id !== "backend-development") missed.add(id);
    }
  }
  if (missed.size) {
    findings.push({
      type: "TECH_NOT_EXTRACTED", severity: "info", item: [...missed].map(techDisplayName).join(", "),
      detail: "Technologies in requirement wording that no extracted requirement covers."
    });
  }

  return findings;
}

// Applies only high-confidence findings, to measure their impact on the
// decision. The original profile is not modified.
export function correctExtraction(profile, findings) {
  const corrected = structuredClone(profile);
  const moveToPreferred = new Set(findings.filter((finding) => finding.type === "PREFERRED_AS_REQUIRED").map((finding) => finding.item));
  const drop = new Set(findings.filter((finding) => finding.type === "NOT_IN_POSTING").map((finding) => finding.item));
  const required = corrected.requirements?.required ?? [];

  corrected.requirements = {
    ...corrected.requirements,
    required: required.filter((requirement) => !moveToPreferred.has(itemText(requirement)) && !drop.has(itemText(requirement))),
    preferred: [
      ...(corrected.requirements?.preferred ?? []),
      ...required
        .filter((requirement) => moveToPreferred.has(itemText(requirement)))
        .map((requirement) => (typeof requirement === "string" ? requirement : { ...requirement, priority: "preferred" }))
    ]
  };
  if (findings.some((finding) => finding.type === "YEARS_PREFERRED_AS_MINIMUM")) {
    corrected.experience = { ...corrected.experience, minimumYears: null };
  }
  const optionalLanguages = new Set(findings.filter((finding) => finding.type === "LANGUAGE_OPTIONAL_AS_REQUIRED").map((finding) => finding.item));
  corrected.languages = (corrected.languages ?? []).map((language) =>
    optionalLanguages.has(language?.language) ? { ...language, required: false } : language
  );
  return corrected;
}
