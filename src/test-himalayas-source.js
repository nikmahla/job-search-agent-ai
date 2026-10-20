import assert from "node:assert/strict";
import { searchHimalayasJobs } from "./job-sources.js";
import { preRankJob, deduplicateJobs } from "./job-pre-ranker.js";
import { scoreJob } from "./job-scorer.js";
import fs from "node:fs";

const fixture = {
  jobs: [
    {
      guid: "frontend-1",
      title: "Frontend Developer (React)",
      companyName: "Example Studio",
      locationRestrictions: [],
      pubDate: Math.floor(Date.now() / 1000),
      applicationLink: "https://example.test/jobs/frontend-1",
      minSalary: 50000,
      maxSalary: 70000,
      currency: "EUR",
      description: "<p>Build accessible React and Next.js interfaces.</p><ul><li>TypeScript</li></ul>"
    },
    {
      guid: "backend-1",
      title: "Backend Java Engineer",
      companyName: "Example Studio",
      locationRestrictions: [],
      pubDate: Math.floor(Date.now() / 1000),
      applicationLink: "https://example.test/jobs/backend-1",
      description: "Build Java microservices."
    }
  ]
};

let requestCount = 0;
const jobs = await searchHimalayasJobs({
  fetchImpl: async (url, options) => {
    requestCount += 1;
    assert.match(String(url), /^https:\/\/himalayas\.app\/jobs\/api\/search/);
    assert.equal(options.headers.Accept, "application/json");
    return {
      ok: true,
      status: 200,
      json: async () => fixture
    };
  }
});

assert.equal(requestCount, 3, "the source should make at most three bounded API requests");
assert.equal(jobs.length, 1, "only frontend-relevant roles should pass source-level screening");
assert.equal(jobs[0].source, "himalayas");
assert.equal(jobs[0].remote, true);
assert.equal(jobs[0].sourceAttribution, "Himalayas (https://himalayas.app)");
assert.equal(jobs[0].salary.currency, "EUR");
assert.match(jobs[0].description, /Build accessible React and Next\.js interfaces/);
assert.ok(!jobs[0].description.includes("<p>"), "HTML tags should be stripped from description");
console.log("Himalayas source tests passed (offline mock; no network requests).");

// Explicit location restrictions are preserved and drive the existing location logic.
const restricted = (guid, title, name) => ({
  guid,
  title,
  companyName: `Company ${guid}`,
  locationRestrictions: [{ name }],
  pubDate: Math.floor(Date.now() / 1000),
  applicationLink: `https://example.test/jobs/${guid}`,
  description: "<p>React and TypeScript frontend role.</p>"
});
const restrictedJobs = await searchHimalayasJobs({
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      jobs: [
        restricted("es-1", "Frontend Developer (React) Spain", "Spain"),
        restricted("uk-1", "Frontend Developer (React) UK", "United Kingdom"),
        restricted("br-1", "Frontend Developer (React) Brazil", "Brazil")
      ]
    })
  })
});
const byGuid = Object.fromEntries(restrictedJobs.map((job) => [job.id, job]));
const expectations = [
  ["himalayas:es-1", "Spain", "SPAIN_REMOTE"],
  ["himalayas:uk-1", "United Kingdom", "REMOTE_OTHER_REGION"],
  ["himalayas:br-1", "Brazil", "REMOTE_OTHER_REGION"]
];

for (const [id, country, category] of expectations) {
  const job = byGuid[id];
  assert.deepEqual(job.locationRestrictions, [country]);
  assert.equal(job.location, `Remote: ${country}`);
  assert.equal(job.url, `https://example.test/jobs/${id.split(":")[1]}`);
  assert.equal(preRankJob(job).preRank.locationCategory, category, `${country} location category`);
}
console.log("Himalayas location-restriction tests passed.");

// Source data -> sourceInfo -> location gate. run-agent.js runs main() on import,
// so its sourceInfo assembly is checked from source and mirrored below.
// The sourceInfo assembly moved from run-agent.js to analyze-job.js unchanged.
const runAgentSource = fs.readFileSync(new URL("./analyze-job.js", import.meta.url), "utf8");
assert.match(runAgentSource, /locationRestrictions:\s*rawJob\.locationRestrictions\s*\?\?\s*\[\]/);
assert.match(runAgentSource, /timezoneRestrictions:\s*rawJob\.timezoneRestrictions\s*\?\?\s*\[\]/);

const gateCandidate = {
  candidate: { experienceYears: 4, location: { acceptedCities: ["Alicante", "Valencia"] }, workAuthorization: { eu: true }, languages: [{ language: "English", level: "C1" }] },
  skills: { primary: ["React"] }
};
const locationGateFor = async (restrictions, timezones = []) => {
  const [rawJob] = await searchHimalayasJobs({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        jobs: [{
          guid: "gate-1",
          title: "Frontend Developer (React)",
          companyName: "Gate Co",
          locationRestrictions: restrictions.map((name) => ({ name })),
          timezoneRestrictions: timezones,
          pubDate: Math.floor(Date.now() / 1000),
          applicationLink: "https://example.test/jobs/gate-1",
          description: "<p>React frontend role.</p>"
        }]
      })
    })
  });
  const sourceInfo = {
    location: rawJob.location,
    description: rawJob.description,
    remote: rawJob.remote === true,
    hybrid: rawJob.hybrid === true,
    locationRestrictions: rawJob.locationRestrictions ?? [],
    timezoneRestrictions: rawJob.timezoneRestrictions ?? []
  };
  return scoreJob(gateCandidate, {
    job: { title: rawJob.title, company: rawJob.company, description: rawJob.description },
    location: { type: "remote", city: null, country: null, remoteScope: "unknown" },
    sourceInfo
  }).gates.location;
};

assert.equal((await locationGateFor(["Spain"])).status, "PASS", "Remote: Spain is eligible");
assert.equal((await locationGateFor(["Germany", "Spain"])).status, "PASS", "a list including Spain is eligible");
assert.equal((await locationGateFor(["United States"])).status, "FAIL", "Remote: United States must not be eligible");
assert.equal((await locationGateFor(["Atlantis"])).status, "FLAG", "unknown restriction needs manual review");
assert.equal((await locationGateFor([])).status, "FLAG", "Remote: Worldwide alone is not proof for Spain");
assert.equal((await locationGateFor(["Spain"], [-8, -5])).status, "FLAG", "incompatible timezones downgrade a Spain match");
assert.equal((await locationGateFor(["Spain"], [1, 2])).status, "PASS");

// I1: the pre-ranker and the scorer agree on structured restrictions.
const agreement = [
  [["United States"], false, "FAIL"],
  [["Germany"], false, "FAIL"],
  [["Brazil", "Germany"], false, "FAIL"],
  [["Spain"], true, "PASS"],
  [["Germany", "Spain"], true, "PASS"],
  [["Europe"], true, "PASS"],
  [["Atlantis"], true, "FLAG"]
];
for (const [restrictions, preRankEligible, gate] of agreement) {
  const [rawJob] = await searchHimalayasJobs({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        jobs: [{
          guid: "agree-1",
          title: "Frontend Developer (React)",
          companyName: "Agree Co",
          locationRestrictions: restrictions.map((name) => ({ name })),
          pubDate: Math.floor(Date.now() / 1000),
          applicationLink: "https://example.test/jobs/agree-1",
          description: "<p>React frontend role.</p>"
        }]
      })
    })
  });
  const label = restrictions.join("+");
  assert.equal(preRankJob(rawJob).preRank.eligible, preRankEligible, `pre-ranker: ${label}`);
  assert.equal((await locationGateFor(restrictions)).status, gate, `scorer: ${label}`);
}
console.log("Himalayas source-to-location-gate tests passed.");

// B1/R1: merged duplicates keep restrictions ahead of local-city shortcuts and flag conflicts.
assert.match(runAgentSource, /restrictionConflict:\s*rawJob\.restrictionConflict\s*===\s*true/);
const mergedGate = (merged) => scoreJob(gateCandidate, {
  job: { title: merged.title, company: merged.company, description: merged.description },
  location: { type: "remote", city: null, country: null, remoteScope: "unknown" },
  sourceInfo: {
    location: merged.location,
    description: merged.description,
    remote: merged.remote === true,
    hybrid: merged.hybrid === true,
    locationRestrictions: merged.locationRestrictions ?? [],
    timezoneRestrictions: merged.timezoneRestrictions ?? [],
    restrictionConflict: merged.restrictionConflict === true
  }
}).gates.location;
const mergedPair = (restrictionsA, adzunaLocation, restrictionsB = []) => {
  const himalayas = {
    id: "himalayas:m1", source: "himalayas", title: "Frontend Developer (React)", company: "Merge Co",
    url: "https://example.test/jobs/m1", location: `Remote: ${restrictionsA.join(", ")}`,
    remote: true, hybrid: false, description: "Short.", locationRestrictions: restrictionsA,
    sourceCountry: restrictionsA[0]
  };
  const adzuna = {
    id: "adzuna:m1", source: "adzuna", title: himalayas.title, company: himalayas.company,
    url: "https://example.test/jobs/m1?utm_source=adzuna", location: adzunaLocation,
    remote: false, hybrid: false, sourceCountry: "es", locationRestrictions: restrictionsB,
    description: "Long Adzuna description about the React role. ".repeat(20)
  };
  return [[himalayas, adzuna], [adzuna, himalayas]];
};

for (const city of ["Valencia, Spain", "Alicante, Spain"]) {
  for (const order of mergedPair(["United States"], city)) {
    const [merged] = deduplicateJobs(order);
    assert.deepEqual(merged.locationRestrictions, ["United States"]);
    assert.equal(merged.restrictionConflict, false);
    assert.equal(preRankJob(merged).preRank.eligible, false, `${city}: pre-ranker`);
    assert.equal(mergedGate(merged).status, "FAIL", `${city}: scorer`);
  }
}

for (const order of mergedPair(["Spain"], "Valencia, Spain", ["United States"])) {
  const [merged] = deduplicateJobs(order);
  assert.equal(merged.restrictionConflict, true);
  assert.deepEqual(merged.locationRestrictions, []);
  assert.deepEqual(merged.locationRestrictionSets.map((set) => set[0]).sort(), ["Spain", "United States"]);
  assert.equal(preRankJob(merged).preRank.locationCategory, "RESTRICTION_CONFLICT");
  assert.equal(preRankJob(merged).preRank.eligible, true);
  assert.equal(mergedGate(merged).status, "FLAG");
}

// Identical restrictions from two sources are not a conflict.
for (const order of mergedPair(["Spain"], "Remote", ["spain"])) {
  const [merged] = deduplicateJobs(order);
  assert.equal(merged.restrictionConflict, false);
  assert.equal(merged.locationRestrictionSets.length, 1);
}
console.log("Merged-restriction precedence and conflict tests passed.");
