
import assert from "node:assert/strict";
import {
  deduplicateJobs,
  preRankJob,
  preRankJobs,
  selectTopJobs,
} from "./job-pre-ranker.js";

const base = {
  title: "Senior Frontend Engineer (React / TypeScript)",
  company: "Example",
  description: "Build web applications with React and TypeScript.",
  sourceCountry: "es",
  remote: false,
  hybrid: false,
  created: new Date().toISOString(),
};

const local = preRankJob({ ...base, location: "Alicante, España" });
assert.equal(local.preRank.eligible, true);
assert.equal(local.preRank.locationCategory, "LOCAL");

const localHybrid = preRankJob({
  ...base,
  title: "Frontend Engineer",
  location: "Alicante, Spain",
  hybrid: true,
});
assert.equal(localHybrid.preRank.eligible, true);
assert.equal(localHybrid.preRank.locationCategory, "LOCAL_HYBRID");

const localRemote = preRankJob({
  ...base,
  title: "Frontend Engineer",
  location: "Alicante, Spain",
  remote: true,
});
assert.equal(localRemote.preRank.eligible, true);
assert.equal(localRemote.preRank.locationCategory, "LOCAL_REMOTE");

// Valencia rules: hybrid and remote are eligible, onsite is ineligible.
const valenciaOnsite = preRankJob({ ...base, location: "Valencia, España" });
assert.equal(valenciaOnsite.preRank.eligible, false);
assert.equal(valenciaOnsite.preRank.locationCategory, "VALENCIA_ONSITE");

const valenciaHybrid = preRankJob({ ...base, location: "Valencia, España", hybrid: true });
assert.equal(valenciaHybrid.preRank.eligible, true);
assert.equal(valenciaHybrid.preRank.locationCategory, "LOCAL_HYBRID");

const valenciaRemote = preRankJob({ ...base, location: "Valencia, España", remote: true });
assert.equal(valenciaRemote.preRank.eligible, true);
assert.equal(valenciaRemote.preRank.locationCategory, "LOCAL_REMOTE");

const spainRemote = preRankJob({
  ...base,
  title: "Frontend Engineer - Remote",
  location: "España",
  sourceCountry: "es",
  remote: true,
});
assert.equal(spainRemote.preRank.eligible, true);
assert.equal(spainRemote.preRank.locationCategory, "SPAIN_REMOTE");

const euRemote = preRankJob({
  ...base,
  title: "React Developer (Remote)",
  location: "Berlin, Deutschland",
  sourceCountry: "de",
  remote: true,
});
assert.equal(euRemote.preRank.eligible, true);
assert.equal(euRemote.preRank.locationCategory, "EUROPE_REMOTE");

const ukRemote = preRankJob({
  ...base,
  title: "Frontend Engineer (Remote)",
  location: "London, UK",
  sourceCountry: "gb",
  remote: true,
});
assert.equal(ukRemote.preRank.eligible, true);
assert.equal(ukRemote.preRank.locationCategory, "UK_REMOTE");

const uaeRemote = preRankJob({
  ...base,
  title: "Frontend Engineer (Remote)",
  location: "Dubai, United Arab Emirates",
  sourceCountry: "ae",
  remote: true,
});
assert.equal(uaeRemote.preRank.eligible, true);
assert.equal(uaeRemote.preRank.locationCategory, "UAE_REMOTE");

const uaeOnsite = preRankJob({
  ...base,
  title: "Frontend Engineer",
  location: "Dubai, United Arab Emirates",
  sourceCountry: "ae",
  remote: false,
  hybrid: false,
});
assert.equal(uaeOnsite.preRank.eligible, false);
assert.equal(uaeOnsite.preRank.locationCategory, "ONSITE_NON_LOCAL");

const uaeHybrid = preRankJob({
  ...base,
  title: "Frontend Engineer",
  location: "Dubai, United Arab Emirates",
  sourceCountry: "ae",
  remote: false,
  hybrid: true,
});
assert.equal(uaeHybrid.preRank.eligible, false);
assert.equal(uaeHybrid.preRank.locationCategory, "HYBRID_NON_LOCAL");

const ukOnsite = preRankJob({
  ...base,
  title: "Frontend Engineer",
  location: "London, UK",
  sourceCountry: "gb",
  remote: false,
  hybrid: false,
});
assert.equal(ukOnsite.preRank.eligible, false);
assert.equal(ukOnsite.preRank.locationCategory, "ONSITE_NON_LOCAL");

const nonLocalHybrid = preRankJob({
  ...base,
  title: "Frontend Engineer",
  location: "Madrid, Spain",
  sourceCountry: "es",
  hybrid: true,
  remote: false,
});
assert.equal(nonLocalHybrid.preRank.eligible, false);
assert.equal(nonLocalHybrid.preRank.locationCategory, "HYBRID_NON_LOCAL");

const unknown = preRankJob({
  ...base,
  title: "Frontend Engineer",
  location: "Unknown",
  sourceCountry: "",
  remote: false,
  hybrid: false,
});
assert.equal(unknown.preRank.eligible, false);
assert.equal(unknown.preRank.locationCategory, "UNKNOWN");

const reactNative = {
  ...base,
  id: "rn",
  title: "React Native Mobile Engineer",
  location: "Valencia, Spain",
};

const vueOnly = {
  ...base,
  id: "vue",
  title: "Senior Frontend Developer - Vue.js",
  location: "Valencia, Spain",
};

const clearance = {
  ...base,
  id: "sc",
  title: "React Developer (SC Cleared)",
  location: "London, UK",
  remote: true,
};

const good1 = {
  ...base,
  id: "good1",
  title: "Senior Frontend Developer",
  company: "Otto Group one.O",
  location: "Valencia, Spain",
  hybrid: true,
};

const goodDuplicate = {
  ...base,
  id: "good2",
  title: "Senior Frontend Developer",
  company: "Otto Group one.O",
  location: "Valencia, Spain",
  hybrid: true,
};

const sameRoleDifferentCity = {
  ...base,
  id: "good3",
  title: "Senior Frontend Developer",
  company: "Otto Group one.O",
  location: "Alicante, Spain",
};

const notEligible = {
  ...base,
  id: "office",
  title: "React Developer",
  location: "Manchester, UK",
  remote: false,
  hybrid: false,
};

const selected = selectTopJobs(
  [reactNative, vueOnly, clearance, good1, goodDuplicate, sameRoleDifferentCity, notEligible],
  15,
);

assert.deepEqual(selected.map((job) => job.id), ["good1", "good3"]);
assert.equal(selectTopJobs([good1], 0).length, 0);

const ranked = preRankJobs([good1, ukOnsite, spainRemote]);
assert.equal(ranked[0].preRank.eligible, true);

for (const job of ranked) {
  assert.ok(job.preRank.score >= 0 && job.preRank.score <= 100);
  assert.ok(Array.isArray(job.preRank.reasons));
}

assert.ok(good1.preRank === undefined, "ranking should not mutate input jobs");

const eligibleOf = (overrides) =>
  preRankJob({ ...base, location: "Alicante, Spain", ...overrides }).preRank.roleEligible;

// Seniority title rules: rejected before Qwen.
for (const title of [
  "Lead Frontend Developer", "Tech Lead React", "Frontend Team Lead",
  "Principal Frontend Engineer", "Staff Frontend Engineer",
  "Frontend Developer Intern", "Frontend Developer Internship",
  "Frontend Developer (Lead)", "Team Leader - Frontend",
]) {
  assert.equal(eligibleOf({ title }), false, `${title} must be rejected`);
  assert.ok(
    !selectTopJobs([{ ...base, id: title, title, location: "Alicante, Spain" }]).length,
    `${title} must not be selected`
  );
}

// Junior, entry-level, mid-level, senior and unspecified stay eligible with unchanged scores.
const seniorityScore = (title) =>
  preRankJob({ ...base, title, location: "Alicante, Spain" }).preRank.seniorityScore;
for (const title of [
  "Junior Frontend Developer", "Entry-level Frontend Developer",
  "Mid-level Frontend Developer", "Senior Frontend Developer",
  "Frontend Developer", "Internal Tools Frontend Developer",
]) {
  assert.equal(eligibleOf({ title }), true, `${title} must stay eligible`);
}
assert.equal(seniorityScore("Junior Frontend Developer"), -4);
assert.equal(seniorityScore("Mid-level Frontend Developer"), 8);
assert.equal(seniorityScore("Senior Frontend Developer"), 8);
assert.equal(seniorityScore("Frontend Developer"), 4);

// Remote sensing signal tests
const remoteSensingJob = preRankJob({
  ...base,
  title: "Remote Sensing Engineer",
  location: "Valencia, Spain",
  remote: false,
  hybrid: false
});
assert.equal(remoteSensingJob.preRank.eligible, false);
assert.equal(remoteSensingJob.preRank.locationCategory, "VALENCIA_ONSITE");

const remoteSensingRemoteJob = preRankJob({
  ...base,
  title: "Remote Sensing Engineer (Remote)",
  location: "Valencia, Spain",
  remote: false,
  hybrid: false
});
assert.equal(remoteSensingRemoteJob.preRank.eligible, true);
assert.equal(remoteSensingRemoteJob.preRank.locationCategory, "LOCAL_REMOTE");

// Explicit minimum years: 5 or more is rejected; 4 is the boundary that stays eligible.
const yearsEligible = (description) => eligibleOf({ title: "Frontend Developer", description });
for (const description of [
  "Requirements: 5+ years of experience with React.",
  "Minimum 5 years of experience in frontend development.",
  "You must have 7 years of experience building web apps.",
  "At least 5 years in React.",
  "Required: 5-7 years of experience with TypeScript.",
  "Se requiere experiencia de 6 años de experiencia en React.",
]) {
  assert.equal(yearsEligible(description), false, `should reject: ${description}`);
}
for (const description of [
  "Requirements: 4+ years of experience with React.",
  "Minimum 4 years of experience in frontend development.",
  "3-5 years of experience with React; you must know TypeScript.",
  "Nice to have: 5+ years of experience with GraphQL.",
  "Preferably 6 years of experience, but not required.",
  "Our company has 10 years of experience building web products.",
  "We have over 15 years of experience in e-commerce.",
  "Work with engineers with 8 years of experience.",
  "Up to 5 years of experience is fine.",
  "Build web applications with React and TypeScript.",
  "Collaborate in a team for 5 days a week.",
]) {
  assert.equal(yearsEligible(description), true, `should stay eligible: ${description}`);
}
assert.ok(
  preRankJob({ ...base, location: "Valencia, Spain", description: "5+ years of experience required." })
    .preRank.reasons.some((reason) => reason.includes("5+ years")),
  "years rejection must be explained"
);

// Deduplication before Top-N selection.
const dup = (overrides) => ({
  ...base,
  title: "Frontend Developer",
  company: "Acme",
  location: "Valencia, Spain",
  hybrid: true,
  ...overrides,
});
const ids = (jobs) => jobs.map((job) => job.id);

// Same stable ID across different search results.
assert.deepEqual(
  ids(deduplicateJobs([dup({ id: "1", searchMode: "local" }), dup({ id: "1", searchMode: "remote" })])),
  ["1"]
);

// URL variations: tracking params, fragments, trailing slash, host case, different IDs.
const adzunaUrl = "https://www.adzuna.es/land/ad/555?se=abc&utm_medium=api&utm_source=x&v=hash1";
assert.deepEqual(
  ids(deduplicateJobs([
    dup({ id: "a", title: "Frontend Dev", url: adzunaUrl }),
    dup({ id: "b", title: "React Engineer", company: "Other", url: "https://WWW.adzuna.es/land/ad/555/?v=hash2&se=zzz#apply" }),
  ])),
  ["a"]
);

// Non-tracking query parameters identify distinct postings.
assert.deepEqual(
  ids(deduplicateJobs([
    dup({ id: "p1", title: "Role A", company: "A", url: "https://jobs.example.com/view?jobId=1&utm_source=x" }),
    dup({ id: "p2", title: "Role B", company: "B", url: "https://jobs.example.com/view?jobId=2&utm_source=x" }),
  ])),
  ["p1", "p2"]
);

// Missing IDs and URLs: conservative title+company+location fallback, tolerant of case and whitespace.
assert.equal(
  deduplicateJobs([
    dup({ title: "Frontend   Developer", company: "ACME" }),
    dup({ title: "frontend developer", company: "Acme", location: "  valencia,  spain " }),
  ]).length,
  1
);

// Distinct jobs stay separate: different location, title, company, or posting URL.
const distinct = deduplicateJobs([
  dup({ id: "d1", url: "https://example.com/jobs/1" }),
  dup({ id: "d2", url: "https://example.com/jobs/2", location: "Alicante, Spain" }),
  dup({ id: "d3", url: "https://example.com/jobs/3", title: "Frontend Developer II" }),
  dup({ id: "d4", url: "https://example.com/jobs/4", company: "Acme Labs" }),
  dup({ id: "d5", url: "https://example.com/jobs/5" }),
]);
assert.deepEqual(ids(distinct), ["d1", "d2", "d3", "d4", "d5"]);

// Without URLs, a different location or title is never merged.
assert.equal(
  deduplicateJobs([
    dup({ id: "n1" }),
    dup({ id: "n2", location: "Alicante, Spain" }),
    dup({ id: "n3", title: "Frontend Developer Next.js" }),
  ]).length,
  3
);

// Unknown companies must not be merged by the title fallback.
assert.equal(
  deduplicateJobs([
    dup({ id: "u1", company: "Unknown" }),
    dup({ id: "u2", company: "Unknown" }),
  ]).length,
  2
);

// Input order is preserved and the input is not mutated.
const dupInput = [dup({ id: "o1" }), dup({ id: "o2", title: "React Developer", url: "https://x.com/2" }), dup({ id: "o1" })];
assert.deepEqual(ids(deduplicateJobs(dupInput)), ["o1", "o2"]);
assert.equal(dupInput.length, 3);

// Duplicates cannot take multiple Top-N slots, and the limit is filled with distinct jobs.
const topDup = (id, title, extra = {}) => dup({ id, title, company: `Company ${id}`, ...extra });
const topJobs = selectTopJobs([
  topDup("t1", "Senior Frontend Developer"),
  topDup("t1", "Senior Frontend Developer"),
  { ...topDup("t2", "Frontend Developer"), url: "https://x.com/j/2?utm_source=a" },
  { ...topDup("t3", "Frontend Developer"), id: "t3b", company: "Company t2", url: "https://x.com/j/2?utm_source=b" },
  topDup("t4", "React Developer"),
], 3);
assert.equal(topJobs.length, 3);
assert.equal(new Set(topJobs.map((job) => job.id)).size, 3);
assert.ok(!(topJobs.some((job) => job.id === "t3b") && topJobs.some((job) => job.id === "t2")));

// Cross-source duplicates keep the richer description and every source reference, in either order.
const shortAdzuna = dup({ id: "adzuna:1", source: "adzuna", description: "Short ad.", url: "https://www.adzuna.es/land/ad/9?utm_source=a" });
const longHimalayas = dup({ id: "himalayas:1", source: "himalayas", description: "Full description ".repeat(40), url: "https://himalayas.app/jobs/9" });
const sameJobUrl = "https://example.test/jobs/shared";

for (const order of [[shortAdzuna, longHimalayas], [longHimalayas, shortAdzuna]]) {
  const merged = deduplicateJobs(order.map((job) => ({ ...job, url: sameJobUrl, ...(job.source === "adzuna" ? { url: `${sameJobUrl}?utm_source=a` } : {}) })));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].description, longHimalayas.description);
  assert.equal(merged[0].source, "himalayas");
  assert.deepEqual(merged[0].sourceInfoList.map((ref) => ref.source).sort(), ["adzuna", "himalayas"]);
}

// Distinct URLs of a merged job are both preserved (matched by the title/company fallback only when no URL exists).
const noUrlShort = dup({ id: "n1", source: "adzuna", url: null, description: "Short." });
const noUrlLong = dup({ id: "n2", source: "himalayas", url: null, description: "Much longer description text." });
const mergedNoUrl = deduplicateJobs([noUrlShort, noUrlLong]);
assert.equal(mergedNoUrl.length, 1);
assert.equal(mergedNoUrl[0].id, "n2");
assert.equal(mergedNoUrl[0].sourceInfoList.length, 2);

// A duplicate with an equal description keeps the first record, and inputs are not mutated.
const tieA = dup({ id: "tie", source: "adzuna", description: "Same." });
const tieB = dup({ id: "tie", source: "himalayas", description: "Same." });
const tie = deduplicateJobs([tieA, tieB]);
assert.equal(tie[0].source, "adzuna");
assert.equal(tieA.sourceInfoList, undefined);
assert.equal(deduplicateJobs([tieA])[0], tieA, "non-duplicates are returned unchanged");

// Himalayas restrictions reach the existing location logic without new eligibility rules.
const himalayasJob = (restrictions, location) => ({
  ...base,
  title: "Frontend Developer (React)",
  company: "Remote Co",
  location,
  source: "himalayas",
  searchMode: "remote",
  remote: true,
  hybrid: false,
  locationRestrictions: restrictions,
  sourceCountry: restrictions[0] ?? "remote",
});
const spainRestricted = preRankJob(himalayasJob(["Spain"], "Remote: Spain")).preRank;
assert.equal(spainRestricted.eligible, true);
assert.equal(spainRestricted.locationCategory, "SPAIN_REMOTE");
const ukRestricted = preRankJob(himalayasJob(["United Kingdom"], "Remote: United Kingdom")).preRank;
// A UK-only listing excludes Spain, so it is not eligible (the scorer FAILs it too).
assert.equal(ukRestricted.eligible, false);
assert.equal(ukRestricted.locationCategory, "REMOTE_OTHER_REGION");
// Brazil/US-only listings are outside the location policy: they must not take a Top-15 slot.
const brazilRestricted = preRankJob(himalayasJob(["Brazil"], "Remote: Brazil")).preRank;
assert.equal(brazilRestricted.locationCategory, "REMOTE_OTHER_REGION");
assert.equal(brazilRestricted.eligible, false);
const usRestricted = preRankJob(himalayasJob(["United States"], "Remote: United States")).preRank;
assert.equal(usRestricted.locationCategory, "REMOTE_OTHER_REGION");
assert.equal(usRestricted.eligible, false);
// Unrecognized, worldwide, or empty restrictions stay reviewable.
for (const [restrictions, location] of [[["Atlantis"], "Remote: Atlantis"], [[], "Remote: Worldwide"]]) {
  const review = preRankJob(himalayasJob(restrictions, location)).preRank;
  assert.equal(review.locationCategory, "REMOTE_UNKNOWN");
  assert.equal(review.eligible, true);
}
// Germany-only and Brazil/Germany lists both exclude Spain.
for (const list of [["Germany"], ["Brazil", "Germany"]]) {
  const excluded = preRankJob(himalayasJob(list, `Remote: ${list.join(", ")}`)).preRank;
  assert.equal(excluded.locationCategory, "REMOTE_OTHER_REGION");
  assert.equal(excluded.eligible, false);
}
// A list that includes Spain or an open region stays eligible.
assert.equal(preRankJob(himalayasJob(["Germany", "Spain"], "Remote: Germany, Spain")).preRank.eligible, true);
assert.equal(preRankJob(himalayasJob(["Europe"], "Remote: Europe")).preRank.eligible, true);

// B1: merging duplicates never erases structured restrictions or provenance, in either order.
const usShort = {
  ...himalayasJob(["United States"], "Remote: United States"),
  id: "himalayas:us-1",
  url: "https://example.test/jobs/us-1",
  description: "Short.",
  timezoneRestrictions: ["UTC-8"],
  sourceAttribution: "Himalayas (https://himalayas.app)",
  sourceInfoList: [{ source: "himalayas", id: "himalayas:us-1", url: "https://example.test/jobs/us-1" }]
};
const adzunaLong = {
  ...base,
  title: usShort.title,
  company: usShort.company,
  id: "adzuna:us-1",
  source: "adzuna",
  url: "https://example.test/jobs/us-1?utm_source=adzuna",
  location: "Remote",
  remote: true,
  hybrid: false,
  sourceCountry: "es",
  description: "A much longer Adzuna description. ".repeat(20)
};
for (const order of [[usShort, adzunaLong], [adzunaLong, usShort]]) {
  const [merged, ...rest] = deduplicateJobs(order);
  assert.equal(rest.length, 0);
  assert.equal(merged.description, adzunaLong.description);
  assert.deepEqual(merged.locationRestrictions, ["United States"]);
  assert.deepEqual(merged.timezoneRestrictions, ["UTC-8"]);
  assert.deepEqual([...merged.sources].sort(), ["adzuna", "himalayas"]);
  assert.equal(merged.sourceInfoList.length, 2);
  assert.equal(merged.sourceAttribution, "Himalayas (https://himalayas.app)");
  const ranked = preRankJob(merged).preRank;
  assert.equal(ranked.eligible, false);
  assert.equal(ranked.locationCategory, "REMOTE_OTHER_REGION");
}

// Cross-board duplicates: the same remote posting on different country sites (different IDs/URLs) merges.
const boardText = "Senior full-stack engineer working with React and Node.js on a distributed product team. ".repeat(4);
const board = (country, id) => ({
  ...base,
  title: "Senior Full-Stack Engineer (React/Node.js)",
  company: "Resourceful Talent Group",
  id,
  source: "adzuna",
  url: `https://www.adzuna.${country}/details/${id}`,
  location: country,
  sourceCountry: country,
  remote: true,
  hybrid: false,
  description: boardText
});
const boardMerged = deduplicateJobs([board("de", "1"), board("be", "2"), board("at", "3")]);
assert.equal(boardMerged.length, 1);
assert.equal(boardMerged[0].sourceInfoList.length, 3, "every board URL is kept");
assert.equal(deduplicateJobs([board("at", "3"), board("de", "1")]).length, 1, "order independent");
// Guards: different company, different text, short text, or non-remote jobs are never merged.
assert.equal(deduplicateJobs([board("de", "1"), { ...board("be", "2"), company: "Other Co" }]).length, 2);
assert.equal(deduplicateJobs([board("de", "1"), { ...board("be", "2"), description: "Different role. ".repeat(10) }]).length, 2);
assert.equal(deduplicateJobs([{ ...board("de", "1"), description: "Short." }, { ...board("be", "2"), description: "Short." }]).length, 2);
assert.equal(deduplicateJobs([{ ...board("es", "4"), remote: false, location: "Alicante" }, { ...board("es", "5"), remote: false, location: "Valencia" }]).length, 2, "local jobs are not merged by text");

console.log("PASS: pre-ranker behavior checks passed.");
