// Offline end-to-end check of scripts/qwen-validation.js in A/B mode.
// Runs the real script in a temporary folder with SYNTHETIC data and a fake
// fetch preloaded: Claude answers come from the fake, Qwen is reused from a
// saved file, and any other network call fails the test.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/qwen-validation.js", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-validation-"));
fs.mkdirSync(path.join(dir, "data"));
const write = (file, value) => fs.writeFileSync(path.join(dir, file), typeof value === "string" ? value : JSON.stringify(value));

const CANDIDATE_MARKER = "Synthetic Candidate Zq7";
write("data/candidate-profile.json", {
  candidate: { name: CANDIDATE_MARKER, experienceYears: 4, location: { acceptedCities: ["Valencia"] }, workAuthorization: { eu: true },
    languages: [{ language: "English", level: "C1" }] },
  professionalProfile: { targetRoles: ["Frontend Developer"] },
  skills: { primary: ["React", "TypeScript", "HTML", "CSS"] },
  experience: [{ role: "Frontend Developer", functions: ["Frontend development"] }]
});
const DESCRIPTION = "Frontend Developer, remote within Spain. Requirements: 3+ years with React and TypeScript. English B2. Nice to have: GraphQL.";
const job = (title, company) => ({
  title, company,
  sourceInfo: { source: "adzuna", sources: ["adzuna"], location: "España", description: DESCRIPTION, url: "https://example.com/private-url" }
});
write("data/job-results.json", [job("Frontend Developer", "Alpha"), job("Frontend Developer", "Alpha"), job("React Engineer", "Beta")]);
write("data/qwen-validation.json", {
  model: "qwen3:8b",
  records: [
    {
      title: "Frontend Developer", company: "Alpha", seconds: 40,
      extraction: { status: "complete", warnings: [], required: ["React", "TypeScript", "GraphQL"], preferred: [], minimumYears: 3,
        languages: [{ language: "English", level: "B2", required: true }], location: { type: "remote" }, workAuthorization: { required: false } },
      findings: [], result: { decision: "MAYBE" }
    },
    { title: "React Engineer", company: "Beta", error: "Ollama did not respond within 180s" }
  ]
});

const claudeOutput = {
  job: { title: "", company: "", description: "" },
  requirements: { required: [{ type: "skill", item: "React", priority: "critical" }, { type: "skill", item: "TypeScript", priority: "critical" }],
    preferred: [{ type: "skill", item: "GraphQL", priority: "preferred" }] },
  experience: { minimumYears: 3, requiredFunctions: [] },
  responsibilities: { core: ["Build React features"], secondary: [] },
  qualifications: [], languages: [{ language: "English", level: "B2", required: true, evidence: "English B2" }],
  workAuthorization: { required: false, eu: false },
  location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" }
};
write("fake-fetch.mjs", `
import fs from "node:fs";
const log = [];
globalThis.fetch = async (url, init) => {
  log.push({ url: String(url), body: init.body, key: init.headers["x-api-key"] });
  if (String(url) !== "https://api.anthropic.com/v1/messages") throw new Error("NETWORK BLOCKED: " + url);
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({
    model: JSON.parse(init.body).model, stop_reason: "end_turn",
    content: [{ type: "text", text: ${JSON.stringify(JSON.stringify(claudeOutput))} }],
    usage: { input_tokens: 2000, output_tokens: 500 } }) };
};
process.on("exit", () => fs.writeFileSync("fetch-log.json", JSON.stringify(log)));
`);

const run = (args, env = {}) => spawnSync(process.execPath, ["--import", "./fake-fetch.mjs", SCRIPT, ...args], {
  cwd: dir, encoding: "utf-8", env: { PATH: process.env.PATH, ...env }
});

// 1. Without an API key nothing is sent and the script stops clearly.
{
  const result = run(["--extractor", "both", "--reuse-qwen", "data/qwen-validation.json"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ANTHROPIC_API_KEY is not set/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "fetch-log.json"), "utf-8")), []);
}

// 2. A/B with reused Qwen: Qwen is never called (even with a non-local
// OLLAMA_URL, which only matters when Qwen runs), Claude is called once per
// distinct job, and only public posting text is sent.
{
  const savedQwen = fs.readFileSync(path.join(dir, "data/qwen-validation.json"), "utf-8");
  const result = run(["--extractor", "both", "--reuse-qwen", "data/qwen-validation.json"], {
    ANTHROPIC_API_KEY: "sk-ant-fake-test", OLLAMA_URL: "http://not-local.example/api/chat"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes("sk-ant-fake-test") && !result.stderr.includes("sk-ant-fake-test"), "the key is never printed");

  const calls = JSON.parse(fs.readFileSync(path.join(dir, "fetch-log.json"), "utf-8"));
  assert.equal(calls.length, 2, "one Claude call per distinct saved job; no Ollama calls");
  for (const call of calls) {
    assert.equal(call.url, "https://api.anthropic.com/v1/messages");
    assert.ok(!call.body.includes(CANDIDATE_MARKER), "candidate data is never sent");
    assert.ok(!call.body.includes("private-url"), "source metadata is never sent");
    assert.ok(call.body.includes("Nice to have: GraphQL"), "the public description is sent");
  }

  const output = JSON.parse(fs.readFileSync(path.join(dir, "data/extraction-ab.json"), "utf-8"));
  assert.equal(output.qwenSource, "reused:data/qwen-validation.json");
  assert.equal(output.records.length, 2);
  const [alpha, beta] = output.records;
  assert.equal(alpha.qwen.reused, true);
  assert.equal(alpha.qwen.result.decision, "MAYBE", "the saved Qwen decision is reused");
  assert.deepEqual(alpha.qwen.findings.filter((f) => f.severity !== "info").map((f) => f.type), ["PREFERRED_AS_REQUIRED"],
    "the saved Qwen extraction is re-audited with the current auditor");
  assert.deepEqual(alpha.claude.findings.filter((f) => f.severity !== "info"), []);
  assert.ok(alpha.claude.profile.requirements, "the full Claude profile is stored");
  assert.ok(alpha.comparison.requiredVsPreferred.includes("GraphQL: qwen required, claude preferred"));
  assert.equal(alpha.humanVerdict, null);
  assert.equal(beta.comparison, null, "a failed Qwen run is not compared");
  assert.deepEqual(output.summary.qwenFailures, ["React Engineer"]);
  assert.equal(output.summary.compared, 1);
  assert.deepEqual(output.summary.claudeUsage, { input_tokens: 4000, output_tokens: 1000, estimatedCostUsd: 0.0009 });
  assert.equal(fs.readFileSync(path.join(dir, "data/qwen-validation.json"), "utf-8"), savedQwen, "the reused Qwen file is not modified");
}

// 3. Guards: unknown extractor, --reuse-qwen without both, non-local Ollama when Qwen would run.
{
  assert.equal(run(["--extractor", "gpt"]).status, 1);
  assert.equal(run(["--reuse-qwen", "data/qwen-validation.json"]).status, 1);
  const remote = run([], { OLLAMA_URL: "http://not-local.example/api/chat" });
  assert.equal(remote.status, 1);
  assert.match(remote.stderr, /not a local Ollama/);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log("PASS: A/B validation script dry run passed (offline, synthetic data, fake fetch).");
