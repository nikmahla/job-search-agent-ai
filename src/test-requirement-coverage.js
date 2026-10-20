// Offline tests for requirement coverage and application packs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySourceFacts } from "./analyze-job.js";
import { packDirName, renderPosting, writeApplicationPack } from "./application-pack.js";
import { normalizeJobProfile } from "./build-job-profile.js";
import { scoreJob } from "./job-scorer.js";
import { applyState, emptyState, hashText, recordAnalysis, saveStateAtomic, stableJobKey } from "./job-state.js";
import { buildRequirementCoverage, candidateEvidenceIndex, findEvidence } from "./requirement-coverage.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-pack-"));

const CANDIDATE = {
  candidate: { name: "Synthetic Person", experienceYears: 4, location: { acceptedCities: ["Alicante", "Valencia"] }, workAuthorization: { eu: true },
    languages: [{ language: "English", level: "C1" }, { language: "Spanish", level: "B1" }] },
  professionalProfile: { targetRoles: ["Frontend Developer"] },
  skills: { primary: ["React", "Next.js", "TypeScript", "JavaScript"], testing: ["Vitest", "React Testing Library"] },
  experience: [{ role: "Frontend Developer", company: "Example Co", functions: ["Build reusable UI components with React", "Integrate REST APIs"] }]
};
const DESCRIPTION = [
  "Frontend Developer — remote within Spain.",
  "Requirements:",
  "- React, TypeScript",
  "- React and Angular | both used daily",
  "- Kubernetes",
  "- Excellent communication skills",
  "- 3+ years of experience",
  "- English B2",
  "Nice to have: GraphQL, Vitest, German.",
  "Example: ```const x = `y`;``` (backticks must survive)"
].join("\n");
const RAW = { title: "Frontend Developer (React/TS)", company: "Acme Iberia S.L.", location: "Remote - Spain", description: DESCRIPTION,
  url: "https://acme.example/jobs/1?utm_source=x", source: "freehire", sources: ["freehire"], remote: true, hybrid: false, created: "2026-10-10T00:00:00Z" };
const QWEN = {
  job: { title: "", company: "", description: "" },
  requirements: {
    required: ["React", "TypeScript", "Experience with React and Angular", "Kubernetes", "Excellent communication skills", "3+ years of experience"].map((item) => ({ type: "skill", item, priority: "critical" })),
    preferred: ["GraphQL", "Vitest"].map((item) => ({ type: "skill", item, priority: "preferred" }))
  },
  experience: { minimumYears: 3, requiredFunctions: [] },
  responsibilities: { core: ["Build React features"], secondary: [] },
  qualifications: [],
  languages: [{ language: "English", level: "B2", required: true, evidence: "English B2" }, { language: "German", level: null, required: false, evidence: "German" }],
  workAuthorization: { required: false, eu: false },
  location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" }
};
const EXTRACTION = normalizeJobProfile(structuredClone(QWEN), RAW);
const PROFILE = applySourceFacts(structuredClone(EXTRACTION), RAW);
const SCORED = scoreJob(CANDIDATE, PROFILE);
const coverage = buildRequirementCoverage({ candidate: CANDIDATE, jobProfile: PROFILE, scored: SCORED });
const row = (text) => coverage.rows.find((r) => r.requirement === text);

// 1. Required skill matching, with evidence quoted from the profile.
{
  assert.equal(row("React").status, "MATCH");
  assert.equal(row("React").kind, "Required");
  assert.ok(row("React").evidence.includes('skills.primary: "React"'));
  assert.ok(row("React").evidence.some((e) => e.includes("Build reusable UI components with React")), "experience functions count as evidence");
  assert.equal(row("TypeScript").status, "MATCH");
}

// 2. Preferred skill matching is labelled Preferred.
{
  assert.equal(row("Vitest").kind, "Preferred");
  assert.equal(row("Vitest").status, "MATCH");
  assert.deepEqual(row("Vitest").evidence, ['skills.testing: "Vitest"']);
}

// 3. Missing requirements are GAPs (required and preferred), languages included.
{
  assert.equal(row("Kubernetes").status, "GAP");
  assert.deepEqual(row("Kubernetes").evidence, []);
  assert.equal(row("GraphQL").status, "GAP");
  assert.equal(row("GraphQL").kind, "Preferred");
  assert.equal(row("German").status, "GAP");
  assert.deepEqual(coverage.requiredGaps, ["Kubernetes"], "preferred gaps are not required gaps");
}

// 4. Partial matches name what is missing.
{
  const partial = row("Experience with React and Angular");
  assert.equal(partial.status, "PARTIAL");
  assert.match(partial.note, /missing: Angular/);
  assert.ok(partial.evidence.some((e) => e.includes('"React"')));
}

// 5. Not-assessed and numeric requirements: UNKNOWN for soft skills, years from the profile.
{
  assert.equal(row("Excellent communication skills").status, "UNKNOWN");
  assert.match(row("Excellent communication skills").note, /not assessed automatically/);
  assert.equal(row("3+ years of experience").status, "MATCH");
  assert.deepEqual(row("3+ years of experience").evidence, ["candidate.experienceYears: 4"]);
  const short = buildRequirementCoverage({ candidate: { ...CANDIDATE, candidate: { ...CANDIDATE.candidate, experienceYears: 2 } }, jobProfile: PROFILE, scored: SCORED });
  assert.equal(short.rows.find((r) => r.requirement === "3+ years of experience").status, "GAP");
  assert.equal(row("English (B2)").status, "MATCH");
  assert.deepEqual(row("English (B2)").evidence, ['candidate.languages: "English C1"']);
  assert.equal(coverage.rows.filter((r) => /years of experience/.test(r.requirement)).length, 1, "the years line is listed once");
}

// 6. No invented evidence: every quoted value exists in the candidate profile,
// and a scorer match without a quotable profile entry is UNKNOWN, never MATCH.
{
  const profileStrings = new Set([
    ...Object.values(CANDIDATE.skills).flat(),
    ...CANDIDATE.experience.flatMap((job) => [job.role, ...job.functions]),
    ...CANDIDATE.candidate.languages.map((l) => `${l.language} ${l.level}`),
    String(CANDIDATE.candidate.experienceYears)
  ]);
  for (const r of coverage.rows) {
    for (const evidence of r.evidence) {
      const quoted = evidence.match(/"(.*)"$/)?.[1] ?? evidence.split(": ").at(-1);
      assert.ok(profileStrings.has(quoted), `evidence "${evidence}" must quote the profile`);
    }
    if (r.status === "MATCH" || r.status === "PARTIAL") assert.ok(r.evidence.length > 0, `${r.requirement}: a match needs evidence`);
  }
  const aliasOnly = buildRequirementCoverage({
    candidate: CANDIDATE,
    jobProfile: { requirements: { required: [], preferred: [] }, experience: {}, languages: [] },
    scored: { requirementMatches: [{ item: "Agile ceremonies", required: true, status: "SEMANTIC", matched: ["scrum"], missing: [] }], gates: {} }
  });
  assert.equal(aliasOnly.rows[0].status, "UNKNOWN");
  assert.match(aliasOnly.rows[0].note, /verify/);
  assert.deepEqual(findEvidence(candidateEvidenceIndex(CANDIDATE), { item: "Java", matched: [] }), [], "Java is never evidenced by JavaScript");
  assert.deepEqual(findEvidence(candidateEvidenceIndex({}), { item: "React", matched: ["React"] }), [], "an empty profile has no evidence");
  const text = JSON.stringify(coverage);
  assert.ok(!text.includes("Synthetic Person"), "the candidate's name is not part of the coverage");
}

// 7. Directory naming: company_role, ASCII, no path separators, capped.
{
  assert.equal(packDirName("Acme Iberia S.L.", "Frontend Developer (React/TS)"), "acme-iberia-s-l_frontend-developer-react-ts");
  assert.equal(packDirName("Café Ñandú", "Desarrollador/a Front-End"), "cafe-nandu_desarrollador-a-front-end");
  assert.equal(packDirName("", null), "unknown_unknown");
  const long = packDirName("C".repeat(80), "R".repeat(120));
  assert.ok(!long.includes("/") && long.length <= 101);
  assert.ok(!packDirName("../../etc", "passwd").includes(".."), "no path traversal");
}

// 8. Posting preservation, metadata and the written pack.
{
  const baseDir = path.join(tmp, "applications");
  const job = { ...RAW, stateKey: stableJobKey(RAW), sourceAttribution: "FreeHire (https://freehire.me)" };
  const { dir } = await writeApplicationPack({ job, candidate: CANDIDATE, jobProfile: PROFILE, scored: SCORED, baseDir, now: new Date("2026-10-18T10:00:00Z") });
  assert.equal(path.basename(dir), "acme-iberia-s-l_frontend-developer-react-ts");
  const posting = fs.readFileSync(path.join(dir, "posting.md"), "utf-8");
  for (const meta of ["**Company:** Acme Iberia S.L.", "**Title:** Frontend Developer (React/TS)", "**Location:** Remote - Spain", "**Source:** freehire (FreeHire (https://freehire.me))", "**URL:** https://acme.example/jobs/1?utm_source=x"]) {
    assert.ok(posting.includes(meta), `posting.md has ${meta}`);
  }
  const fence = posting.match(/\n(`{3,})text\n/)[1];
  const body = posting.slice(posting.indexOf(`${fence}text\n`) + fence.length + 5, posting.lastIndexOf(`\n${fence}`));
  assert.equal(body, DESCRIPTION, "the posting text is preserved byte for byte (pipes and backticks included)");
  assert.ok(fence.length > 3, "the fence is longer than any backtick run in the posting");

  const coverageMd = fs.readFileSync(path.join(dir, "coverage.md"), "utf-8");
  assert.match(coverageMd, /\| Requirement \| Required\/Preferred \| Candidate evidence \| Status \|/);
  assert.match(coverageMd, /\| Kubernetes \| Required \| — \| GAP \|/);
  assert.match(coverageMd, /Required gaps:\*\* Kubernetes/);
  assert.ok(!coverageMd.includes("Synthetic Person"));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "pack.json"), "utf-8"));
  assert.equal(meta.stateKey, job.stateKey);
  assert.equal(meta.decision, SCORED.decision);

  // Regenerating keeps the user's own files; a different job with the same name gets its own folder.
  fs.writeFileSync(path.join(dir, "my-notes.md"), "keep me");
  await writeApplicationPack({ job, candidate: CANDIDATE, jobProfile: PROFILE, scored: SCORED, baseDir });
  assert.equal(fs.readFileSync(path.join(dir, "my-notes.md"), "utf-8"), "keep me");
  const otherCity = { ...job, url: "https://acme.example/jobs/2", location: "Alicante", stateKey: "url:acme.example/jobs/2" };
  const second = await writeApplicationPack({ job: otherCity, candidate: CANDIDATE, jobProfile: PROFILE, scored: SCORED, baseDir });
  assert.notEqual(second.dir, dir, "same company and title in another city never overwrites a pack");
  assert.match(path.basename(second.dir), /^acme-iberia-s-l_frontend-developer-react-ts_[0-9a-f]{6}$/);
  assert.equal(fs.readdirSync(baseDir).length, 2);

  const plain = renderPosting({ title: "T", company: "C", description: "line 1\nline 2" }, { generatedAt: "x" });
  assert.ok(plain.includes("```text\nline 1\nline 2\n```"));
}

// 9. The apply:pack command rebuilds packs from saved results + cached extraction, without Qwen.
{
  const dir = path.join(tmp, "cli");
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  const { buildSourceInfo } = await import("./analyze-job.js");
  const { computeAnalysisHashes } = await import("./job-state.js");
  const hashes = await computeAnalysisHashes();
  const state = emptyState();
  applyState([RAW], state);
  const key = stableJobKey(RAW);
  recordAnalysis(state, key, { profile: EXTRACTION, description: DESCRIPTION, hashes, result: SCORED });
  await saveStateAtomic(state, { file: path.join(dir, "data", "job-state.json") });
  const stale = { ...RAW, url: "https://acme.example/jobs/stale", title: "Stale Job" };
  fs.writeFileSync(path.join(dir, "data", "job-results.json"), JSON.stringify([
    { ...SCORED, title: RAW.title, company: RAW.company, decision: "APPLY", stateKey: key, sourceInfo: buildSourceInfo(RAW) },
    { ...SCORED, title: "Stale Job", company: RAW.company, decision: "APPLY", stateKey: stableJobKey(stale), sourceInfo: buildSourceInfo(stale) },
    { ...SCORED, title: "A skip", decision: "SKIP", stateKey: null, sourceInfo: buildSourceInfo(RAW) }
  ]));
  fs.writeFileSync(path.join(dir, "data", "candidate-profile.json"), JSON.stringify(CANDIDATE));
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "application-pack.js");
  const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf-8", env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /✓ Frontend Developer \(React\/TS\) — Acme Iberia S\.L\./);
  assert.match(result.stdout, /✖ Stale Job — .*no valid cached extraction \(not-cached\)/, "a job without a valid cached extraction is skipped, not guessed");
  assert.match(result.stdout, /1 application pack\(s\)/);
  const written = fs.readdirSync(path.join(dir, "data", "applications"));
  assert.deepEqual(written, ["acme-iberia-s-l_frontend-developer-react-ts"]);

  // A changed description invalidates the cache for packing too.
  const changed = JSON.parse(fs.readFileSync(path.join(dir, "data", "job-results.json"), "utf-8"));
  changed[0].sourceInfo.description += "\nNew line.";
  fs.writeFileSync(path.join(dir, "data", "job-results.json"), JSON.stringify(changed));
  const again = spawnSync(process.execPath, [script, key], { cwd: dir, encoding: "utf-8", env: { PATH: process.env.PATH } });
  assert.match(again.stdout, /description-changed/);
  assert.notEqual(hashText(changed[0].sourceInfo.description), hashText(DESCRIPTION));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("PASS: requirement coverage and application pack checks passed (offline).");
