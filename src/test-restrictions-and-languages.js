// Offline regression tests for structured location restrictions (Himalayas)
// and the language gate. No network, no data/ files.
import assert from "node:assert/strict";
import { structuredRestrictionVerdict, LISTING_KNOWN_OTHER_COUNTRIES } from "./job-source-rules.js";
import { preRankJob } from "./job-pre-ranker.js";
import { scoreJob } from "./job-scorer.js";

// 1. Restriction lists made only of real non-Spanish countries exclude Spain.
for (const restrictions of [
  ["Philippines"], ["Colombia"], ["Argentina", "Bolivia", "Chile", "Paraguay"], ["United States", "Canada"],
  ["LATAM"], ["Portugal"], ["PH"], ["Nigeria", "Kenya"]
]) {
  assert.equal(structuredRestrictionVerdict({ locationRestrictions: restrictions }), "EXCLUDES_SPAIN", JSON.stringify(restrictions));
}
// Spain, Spanish territories and regions containing Spain stay open.
for (const restrictions of [
  ["Spain"], ["España"], ["Canary Islands"], ["Europe"], ["EU"], ["EMEA"], ["Worldwide"], ["Portugal", "Spain"], ["Colombia", "Europe"]
]) {
  assert.equal(structuredRestrictionVerdict({ locationRestrictions: restrictions }), "NONE", JSON.stringify(restrictions));
}
// Names that are not recognised stay for manual review, never auto-excluded.
assert.equal(structuredRestrictionVerdict({ locationRestrictions: ["Atlantis"] }), "NONE");
assert.equal(LISTING_KNOWN_OTHER_COUNTRIES.has("spain"), false);
assert.equal(LISTING_KNOWN_OTHER_COUNTRIES.has("europe"), false);

// 2. Pre-ranker: excluded regions never reach the shortlist; Europe ranks as Europe remote.
const himalayas = (restrictions) => preRankJob({
  title: "Frontend Developer", description: "React and TypeScript", source: "himalayas", remote: true, hybrid: false,
  location: restrictions.length ? `Remote: ${restrictions.join(", ")}` : "Remote: Worldwide",
  sourceCountry: restrictions[0] ?? "remote", locationRestrictions: restrictions, created: new Date().toISOString()
}).preRank;
for (const restrictions of [["Philippines"], ["Colombia"], ["Argentina", "Bolivia", "Chile"]]) {
  const rank = himalayas(restrictions);
  assert.equal(rank.locationCategory, "REMOTE_OTHER_REGION", JSON.stringify(restrictions));
  assert.equal(rank.eligible, false);
}
assert.equal(himalayas(["Europe"]).locationCategory, "EUROPE_REMOTE");
assert.equal(himalayas(["EU"]).locationCategory, "EUROPE_REMOTE");
assert.equal(himalayas(["Spain"]).locationCategory, "SPAIN_REMOTE");
assert.equal(himalayas(["Canary Islands"]).locationCategory, "SPAIN_REMOTE");
assert.equal(himalayas([]).locationCategory, "REMOTE_UNKNOWN", "worldwide without proof stays for review");
assert.equal(himalayas(["Atlantis"]).locationCategory, "REMOTE_UNKNOWN");
assert.ok(himalayas(["Europe"]).score > himalayas([]).score, "an explicit Europe restriction ranks above unknown scope");

// 3. Scorer location gate agrees with the pre-ranker.
const candidate = {
  candidate: {
    experienceYears: 4,
    location: { acceptedCities: ["Alicante", "Valencia"] },
    workAuthorization: { eu: true },
    languages: [{ language: "English", level: "C1" }, { language: "Spanish", level: "B1" }]
  },
  professionalProfile: { targetRoles: ["Frontend Developer"] },
  skills: { primary: ["React", "TypeScript"] },
  experience: [{ role: "Frontend Developer", functions: ["Frontend development"] }]
};
const job = (overrides = {}) => ({
  extraction: { status: "complete", fields: { "workAuthorization.required": "present" }, warnings: [] },
  job: { title: "Frontend Developer", company: "X", description: "" },
  requirements: { required: [{ type: "skill", item: "React", priority: "critical" }], preferred: [] },
  experience: { minimumYears: null, requiredFunctions: [] },
  responsibilities: { core: [], secondary: [] },
  qualifications: [],
  languages: [],
  workAuthorization: { required: false, eu: false },
  location: { type: "remote", city: null, country: null, remoteScope: "unknown" },
  sourceInfo: { location: "Remote", description: "Frontend role.", remote: true, hybrid: false, searchMode: "remote" },
  ...overrides
});
const locationGate = (restrictions) => scoreJob(candidate, job({
  sourceInfo: { location: `Remote: ${restrictions.join(", ")}`, description: "Frontend role.", remote: true, hybrid: false, locationRestrictions: restrictions }
})).gates.location.status;
assert.equal(locationGate(["Philippines"]), "FAIL");
assert.equal(locationGate(["Colombia"]), "FAIL");
assert.equal(locationGate(["Europe"]), "PASS");
assert.equal(locationGate(["Canary Islands"]), "PASS");
assert.equal(locationGate(["Atlantis"]), "FLAG");

// 4. Language gate: names in the posting's language, CEFR ranges and descriptive levels.
const languageGate = (language, level) => scoreJob(candidate, job({
  languages: [{ language, level, required: true, evidence: "" }]
})).gates.language.status;
assert.equal(languageGate("English", "C1"), "PASS");
assert.equal(languageGate("English", "professional"), "PASS");
assert.equal(languageGate("English", "C1 or higher"), "PASS");
assert.equal(languageGate("English", "B2/C1"), "PASS", "a range means its lower bound");
assert.equal(languageGate("English", "fluent"), "PASS");
assert.equal(languageGate("Inglés", "C1"), "PASS", "Spanish name for English");
assert.equal(languageGate("inglese", "buona"), "PASS", "Italian name and level");
assert.equal(languageGate("English", null), "PASS");
// Honest gaps stay visible.
assert.equal(languageGate("English", "native"), "FLAG");
assert.equal(languageGate("English", "C2"), "FLAG");
assert.equal(languageGate("Spanish", "fluent"), "FLAG", "B1 is below fluent");
assert.equal(languageGate("Castellano", "nativo"), "FLAG");
assert.equal(languageGate("Spanish", "B1"), "PASS");
assert.equal(languageGate("English", "Kenntnisse"), "FLAG", "an unrecognised level needs review");
assert.equal(languageGate("German", "B2"), "FAIL", "a required language the candidate lacks still fails");
assert.equal(languageGate("Catalán", null), "FAIL");
// Optional languages never gate.
assert.equal(scoreJob(candidate, job({ languages: [{ language: "German", level: "C1", required: false }] })).gates.language.status, "PASS");

console.log("PASS: restriction and language gate checks passed (offline).");
