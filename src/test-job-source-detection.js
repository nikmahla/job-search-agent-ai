import assert from "node:assert/strict";
import { jobSourceDetection } from "./job-source-rules.js";

const raw = (title, description = "", location = "") => ({
  title,
  description,
  location: { display_name: location },
  company: { display_name: "Example" }
});

const cases = [
  [raw("Remote Frontend Developer", "React and TypeScript"), true, false],
  [raw("Frontend Engineer", "Collaborate with remote teams across offices"), false, false],
  [raw("Frontend Engineer", "Fully remote within Europe; no office attendance"), true, false],
  [raw("Frontend Engineer", "Hybrid role, remote work two days per week"), false, true],
  [raw("Frontend Engineer", "Teletrabajo en España"), true, false],
  [raw("Frontend Engineer", "Office-based position in Valencia"), false, false],
  [raw("Remote Sensing Engineer"), false, false],
  [raw("Remote Sensing Engineer", "Fully remote within Europe"), true, false],
  [raw("Remote Sensing Engineer", "", "Remote, Spain"), true, false],
  [raw("Remote Sensing Engineer", "Hybrid role, 2 days per week"), false, true],
  [raw("Remote Sensing Engineer (Remote)"), true, false],
  // Negated remote wording is not a remote role.
  [raw("Frontend Engineer", "This is not a remote position. Office in Munich.", "München"), false, false],
  [raw("Frontend Engineer", "Remote work is not possible for this role."), false, false],
  [raw("Frontend Engineer", "Non-remote role; work from home is not offered."), false, false],
  [raw("Desarrollador Frontend", "No es un puesto remoto. Trabajo presencial en Madrid."), false, false],
  [raw("Desarrollador Frontend", "Puesto presencial, sin teletrabajo."), false, false],
  // A limit on where remote work may happen is still remote work.
  [raw("Frontend Engineer", "Remote work is not possible from outside Spain. Remote work within Spain is fully supported."), true, false],
  [raw("Frontend Engineer", "Fully remote. No remote restrictions within the EU."), true, false],
  [raw("Remote Frontend Engineer", "Relocation is not a remote option for the US team."), true, false],
];

for (const [job, expectedRemote, expectedHybrid] of cases) {
  assert.equal(jobSourceDetection.isRemote(job), expectedRemote, `${job.title} remote detection`);
  assert.equal(jobSourceDetection.isHybrid(job), expectedHybrid, `${job.title} hybrid detection`);
}

console.log(`PASS: ${cases.length} source remote/hybrid detection checks passed.`);
