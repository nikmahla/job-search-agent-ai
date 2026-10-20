// Offline tests for the A/B comparison helpers and the structured-output
// schema used for Claude.
import assert from "node:assert/strict";
import { compareExtractions, profileFromSummary, summarizeExtraction } from "./extraction-compare.js";
import { auditExtraction } from "./extraction-audit.js";
import { JOB_PROFILE_SCHEMA } from "./extraction-schema.js";

const R = (item) => ({ type: "skill", item, priority: "critical" });
const P = (item) => ({ type: "skill", item, priority: "preferred" });

// 1. Summary shape matches what qwen-validation.json already stores, and a
// summary round-trips into an auditable profile.
{
  const profile = {
    extraction: { status: "complete", warnings: ["w"] },
    requirements: { required: [R("React"), "TypeScript"], preferred: [P("GraphQL")] },
    experience: { minimumYears: 3 },
    languages: [{ language: "English", level: "B2", required: true }],
    location: { type: "remote", remoteScope: "europe" },
    workAuthorization: { required: false, eu: false }
  };
  const summary = summarizeExtraction(profile);
  assert.deepEqual(Object.keys(summary), ["status", "warnings", "required", "preferred", "minimumYears", "languages", "location", "workAuthorization"]);
  assert.deepEqual(summary.required, ["React", "TypeScript"]);
  assert.deepEqual(summarizeExtraction({}).required, []);

  const rebuilt = profileFromSummary(summary);
  assert.deepEqual(rebuilt.requirements.required.map((item) => item.item), ["React", "TypeScript"]);
  assert.equal(rebuilt.requirements.preferred[0].priority, "preferred");
  assert.equal(rebuilt.experience.minimumYears, 3);

  const posting = "Requirements: React and TypeScript. 3+ years of experience. English B2. Nice to have: GraphQL.";
  const fromSummary = auditExtraction(posting, rebuilt).filter((finding) => finding.severity !== "info");
  assert.deepEqual(fromSummary, [], "a correct extraction audited from its summary has no findings");
}

// 2. The comparison reports technology, priority, field and decision differences.
{
  const qwen = {
    label: "qwen",
    summary: {
      status: "complete", required: ["React", "TypeScript", "AWS"], preferred: ["GraphQL"], minimumYears: 5,
      languages: [{ language: "English", level: "B2", required: true }, { language: "German", level: null, required: true }],
      location: { type: "remote", remoteScope: "europe" }, workAuthorization: { required: false }
    },
    findings: [{ type: "PREFERRED_AS_REQUIRED", severity: "high" }, { type: "TECH_NOT_EXTRACTED", severity: "info" }],
    decision: "SKIP"
  };
  const claude = {
    label: "claude",
    summary: {
      status: "complete", required: ["React", "TypeScript", "HTML and CSS"], preferred: ["AWS", "GraphQL"], minimumYears: 3,
      languages: [{ language: "english", level: "B2", required: true }],
      location: { type: "remote", remoteScope: "eu" }, workAuthorization: { required: false }
    },
    findings: [],
    decision: "APPLY"
  };
  const diff = compareExtractions(qwen, claude);
  assert.deepEqual(diff.requiredTechOnly.qwen, ["AWS"]);
  assert.deepEqual(diff.requiredTechOnly.claude.length, 2, "HTML and CSS only in Claude's required list");
  assert.deepEqual(diff.requiredVsPreferred, ["AWS: qwen required, claude preferred"]);
  assert.deepEqual(diff.preferredTechOnly.qwen, []);
  assert.deepEqual(diff.itemCounts, { qwen: { required: 3, preferred: 1 }, claude: { required: 3, preferred: 2 } });
  assert.ok(diff.fieldDiffs.includes("minimumYears: qwen=5, claude=3"));
  assert.ok(diff.fieldDiffs.includes("location.remoteScope: qwen=europe, claude=eu"));
  assert.ok(diff.fieldDiffs.includes("german: qwen=required, claude=not required"));
  assert.ok(!diff.fieldDiffs.some((line) => line.startsWith("english")), "language names compare case-insensitively");
  assert.deepEqual(diff.auditFindings, { qwen: { PREFERRED_AS_REQUIRED: 1 }, claude: {} }, "info findings are not counted");
  assert.deepEqual(diff.decisions, { qwen: "SKIP", claude: "APPLY" });
  assert.equal(diff.decisionsDiffer, true);
}

// 3. Identical extractions produce an empty diff.
{
  const summary = { status: "complete", required: ["React"], preferred: [], minimumYears: null, languages: [], location: { type: "remote" }, workAuthorization: {} };
  const diff = compareExtractions({ label: "a", summary, findings: [], decision: "MAYBE" }, { label: "b", summary, findings: [], decision: "MAYBE" });
  assert.deepEqual(diff.requiredVsPreferred, []);
  assert.deepEqual(diff.fieldDiffs, []);
  assert.equal(diff.decisionsDiffer, false);
}

// 4. The schema follows the structured-output rules: every object closes
// additionalProperties and requires all of its properties; no unsupported
// numeric/string constraints.
{
  const unsupported = ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"];
  const objects = [];
  (function walk(node, path) {
    if (!node || typeof node !== "object") return;
    for (const key of unsupported) assert.ok(!(key in node), `${path} uses unsupported "${key}"`);
    const types = [].concat(node.type ?? []);
    if (types.includes("object")) {
      objects.push(path);
      assert.equal(node.additionalProperties, false, `${path} must set additionalProperties: false`);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${path} must require every property`);
      for (const [key, child] of Object.entries(node.properties)) walk(child, `${path}.${key}`);
    }
    if (types.includes("array")) walk(node.items, `${path}[]`);
  })(JOB_PROFILE_SCHEMA, "$");
  assert.ok(objects.length >= 10, "schema walk visited the nested objects");
  assert.deepEqual(JOB_PROFILE_SCHEMA.properties.location.properties.type.enum, ["remote", "hybrid", "onsite", "unknown"]);
}

console.log("PASS: extraction comparison and schema checks passed (offline).");
