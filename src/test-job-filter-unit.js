import assert from "node:assert/strict";
import { filterJob } from "./job-filter.js";
import { preRankJob } from "./job-pre-ranker.js";

const cases = [
  [{ title: "Senior Frontend Engineer", description: "React, TypeScript, responsive web applications" }, true, "frontend_title"],
  [{ title: "React Native Mobile Engineer", description: "React Native and TypeScript" }, false, "hard_excluded_title"],
  [{ title: "Full Stack Developer", description: "Python, APIs, databases; no frontend framework listed" }, false, "no_frontend_evidence_for_broader_role"],
  [{ title: "Full Stack Developer (React)", description: "Build React web applications with TypeScript" }, true, "broader_role_with_frontend_evidence"],
  [{ title: "Senior Frontend Developer - Vue.js", description: "Vue.js and JavaScript" }, false, "non_target_frontend_framework"],
  [{ title: "React Developer (SC Cleared)", description: "React, TypeScript" }, false, "hard_excluded_title"],
  [{ title: "Data Engineer", description: "Uses React for an internal dashboard" }, false, "hard_excluded_title"],
  // Management and unrelated titles without a frontend title must not reach ranking.
  ...["Finance Manager", "Engineering Manager", "Flight Software Manager", "Software Development Manager"].map((title) => [
    { title, description: "Lead budgeting, hiring and stakeholder reporting for the team." },
    false,
    "insufficient_frontend_evidence",
  ]),
  [{ title: "Engineering Manager", description: "Manage a React and TypeScript web application team" }, false, "insufficient_frontend_evidence"],
  // "JavaScript Developer" is a search term: kept with React/web evidence, dropped without it.
  [{ title: "JavaScript Developer", description: "Build React web applications with TypeScript, HTML and CSS" }, true, "broader_role_with_frontend_evidence"],
  [{ title: "TypeScript Developer", description: "React and Next.js frontend with CSS modules" }, true, "broader_role_with_frontend_evidence"],
  [{ title: "JavaScript Developer", description: "Node.js backend services, PostgreSQL and Kafka" }, false, "no_frontend_evidence_for_broader_role"],
  [{ title: "JavaScript Developer (Angular)", description: "Angular and TypeScript" }, false, "non_target_frontend_framework"],
  // Titles in the posting languages map to the same categories as their English form.
  [{ title: "Desarrollador Web", description: "React y TypeScript" }, true, "frontend_title"],
  [{ title: "Desarrollador/a Web", description: "React y TypeScript" }, true, "frontend_title"],
  [{ title: "Programador(a) Web", description: "React y TypeScript" }, true, "frontend_title"],
  [{ title: "Sviluppatore Web", description: "React e TypeScript" }, true, "frontend_title"],
  [{ title: "Webentwickler/in", description: "React und TypeScript" }, true, "frontend_title"],
  [{ title: "Ingeniero de Software", description: "Aplicaciones web con React, HTML y CSS" }, true, "broader_role_with_frontend_evidence"],
  [{ title: "Ingeniero de Software", description: "Java, Spring Boot y microservicios" }, false, "no_frontend_evidence_for_broader_role"],
  [{ title: "Desarrollador React Native", description: "React Native" }, false, "hard_excluded_title"],
];

for (const [job, expectedKeep, expectedReason] of cases) {
  const actual = filterJob(job);
  assert.equal(actual.keep, expectedKeep, `${job.title}: keep mismatch`);
  assert.equal(actual.reason, expectedReason, `${job.title}: reason mismatch`);
}

// The pre-ranker reads the same translated / gendered titles the same way.
const roleScore = (title) => preRankJob({ title, description: "React", location: "Alicante" }).preRank.roleScore;
assert.equal(roleScore("Desarrollador Web"), roleScore("Web Developer"));
assert.equal(roleScore("Programador(a) Web"), roleScore("Web Developer"));
assert.equal(roleScore("Desarrollador/a Frontend"), roleScore("Frontend Developer"));
assert.equal(roleScore("TypeScript Developer"), roleScore("JavaScript Developer"));

console.log(`PASS: ${cases.length} deterministic job-filter checks passed.`);
