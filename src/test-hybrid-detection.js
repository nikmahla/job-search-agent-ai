// Offline regression tests: "hybrid" as a technology (hybrid cloud, hybrid
// apps, hybrid architecture...) must not be read as a hybrid WORK arrangement,
// while every genuine hybrid-work wording keeps being detected.
import assert from "node:assert/strict";
import { hasHybridWorkSignal, isHybrid, isRemote } from "./job-source-rules.js";
import { preRankJob } from "./job-pre-ranker.js";
import { detectLocationType } from "./build-job-profile.js";
import { recheckEnrichedJob } from "./shortlist.js";

const adzunaRaw = (description, title = "Frontend Developer", location = "Berlin") => ({
  title, description, location: { display_name: location }, company: { display_name: "Example" }
});

// 1. Technology uses of "hybrid" are not hybrid work.
const technical = [
  "Build and operate our hybrid cloud platform.",
  "Experience with hybrid-cloud deployments on AWS and on-prem.",
  "Experience with hybrid applications (Ionic, Capacitor) is a plus.",
  "You will maintain our hybrid mobile apps.",
  "Knowledge of hybrid app frameworks.",
  "Design a hybrid architecture across AWS and Azure.",
  "Operate in a hybrid environment of AWS and Azure.",
  "Hybrid infrastructure with Kubernetes.",
  "Experience with hybrid and native apps.",
  "Native or hybrid mobile development.",
  "Ionic or Capacitor based hybrid development.",
  "Experiencia con nube híbrida y Kubernetes.",
  "Desarrollo de aplicaciones móviles híbridas.",
  "Arquitectura híbrida en AWS."
];
for (const text of technical) {
  assert.equal(hasHybridWorkSignal(text), false, `technical use: "${text}"`);
}

// 2. Genuine hybrid-work wording is still detected.
const work = [
  "Hybrid working: 3 days per week in our Valencia office.",
  "This is a hybrid role based in Madrid.",
  "We follow a hybrid model with two office days.",
  "Hybrid work environment with flexible hours.",
  "Hybrid schedule, Tuesday and Thursday in the office.",
  "Location: Valencia (Hybrid)",
  "Hybrid - Madrid",
  "Modelo híbrido: 2 días en oficina.",
  "Trabajo híbrido en Alicante.",
  "Modalidad híbrida.",
  "Puesto híbrido, presencial y remoto.",
  "Tres días en oficina a la semana."
];
for (const text of work) {
  assert.equal(hasHybridWorkSignal(text), true, `hybrid work: "${text}"`);
}

// 3. A genuine hybrid role that also mentions hybrid technology stays hybrid.
assert.equal(hasHybridWorkSignal("Hybrid working, 2 days in the office. You will build our hybrid cloud tooling."), true);
assert.equal(hasHybridWorkSignal("We build hybrid mobile apps. Location: Valencia (Hybrid)"), true);
// Words merely containing "hybrid" are not the word.
assert.equal(hasHybridWorkSignal("Hybridization of legacy systems"), false);

// 4. Source detection: a remote job mentioning hybrid technology stays remote.
assert.equal(isHybrid(adzunaRaw("Fully remote position. You will build our hybrid cloud platform.")), false);
assert.equal(isRemote(adzunaRaw("Remote position. Experience with hybrid applications is a plus.")), true);
assert.equal(isRemote(adzunaRaw("Remote work. We build hybrid and native apps.")), true);
// A real hybrid job is still not remote.
assert.equal(isHybrid(adzunaRaw("Hybrid role: remote work two days per week.")), true);
assert.equal(isRemote(adzunaRaw("Hybrid role: remote work two days per week.")), false);

// 5. Pre-ranker: "Hybrid App Developer" is a technology in the title.
const rank = (job) => preRankJob({ description: "React", created: new Date().toISOString(), ...job }).preRank;
assert.equal(rank({ title: "Hybrid App Developer (React)", location: "Remote", remote: true, sourceCountry: "es" }).locationCategory, "SPAIN_REMOTE");
assert.equal(rank({ title: "Frontend Developer (Hybrid)", location: "Madrid", remote: false, sourceCountry: "es" }).locationCategory, "HYBRID_NON_LOCAL");
assert.equal(rank({ title: "Frontend Developer", location: "Valencia (Hybrid)", remote: false, sourceCountry: "es" }).locationCategory, "LOCAL_HYBRID");

// 6. Extractor-side location type uses the same rule.
assert.equal(detectLocationType({ title: "Frontend Developer", location: "Remote", description: "Remote role. You will build hybrid mobile apps." }), "remote");
assert.equal(detectLocationType({ title: "Frontend Developer", location: "Madrid", description: "Hybrid role in Madrid." }), "hybrid");
assert.equal(detectLocationType({ title: "Frontend Developer", location: "Madrid", description: "Modelo híbrido en Madrid." }), "hybrid");

// 7. Full-text re-check after enrichment keeps a remote job remote.
const rechecked = recheckEnrichedJob({
  id: "adzuna-1", title: "Frontend Developer", company: "X", location: "Berlin, Deutschland", source: "adzuna",
  remote: true, hybrid: false, descriptionEnriched: true,
  description: "Remote position across Europe. Responsibilities: build React UIs for our hybrid cloud management console. Requirements: React."
});
assert.equal(rechecked.remote, true);
assert.equal(rechecked.hybrid, false);

console.log("PASS: hybrid work vs hybrid technology detection checks passed (offline).");
