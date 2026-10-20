// Offline tests for the Claude extractor used by the Qwen-vs-Claude A/B
// validation. Every HTTP call goes to an injected fake fetch; nothing leaves
// the machine.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CLAUDE_API_URL,
  DEFAULT_CLAUDE_MODEL,
  buildClaudeRequest,
  estimateClaudeCostUsd,
  extractWithClaude,
  publicJobFields
} from "./claude-extractor.js";
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt, normalizeJobProfile } from "./build-job-profile.js";
import { JOB_PROFILE_SCHEMA } from "./extraction-schema.js";

const FAKE_KEY = "sk-ant-test-FAKE-KEY-0000";
const noSleep = async () => {};

const RAW_JOB = {
  title: "Frontend Developer",
  company: "Acme",
  location: "Spain",
  description: "Requirements: 3+ years with React and TypeScript. English B2. Nice to have: GraphQL.",
  // Fields that must never be sent: they are not part of the public posting.
  candidate: { name: "Private Person", email: "private@example.com" },
  sourceInfo: { url: "https://example.com/job/1", internalScore: 99 },
  notes: "private notes"
};

const MODEL_OUTPUT = {
  job: { title: "Frontend Developer", company: "Acme", description: "Frontend role" },
  requirements: {
    required: [
      { type: "skill", item: "React", priority: "critical" },
      { type: "skill", item: "TypeScript", priority: "critical" }
    ],
    preferred: [{ type: "skill", item: "GraphQL", priority: "preferred" }]
  },
  experience: { minimumYears: 3, requiredFunctions: ["Frontend development"] },
  responsibilities: { core: ["Build React features"], secondary: [] },
  qualifications: [],
  languages: [{ language: "English", level: "B2", required: true, evidence: "English B2" }],
  workAuthorization: { required: false, eu: false },
  location: { type: "remote", city: null, country: "Spain", remoteScope: "country-specific" }
};

const okResponse = (body, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => body
});
const messageBody = (output, overrides = {}) => ({
  id: "msg_test",
  type: "message",
  model: DEFAULT_CLAUDE_MODEL,
  stop_reason: "end_turn",
  content: [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }],
  usage: { input_tokens: 1200, output_tokens: 400 },
  ...overrides
});
function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, calls };
}

// 1. Only public posting fields are sent, with the same prompts as Qwen.
{
  assert.deepEqual(Object.keys(publicJobFields(RAW_JOB)).sort(), ["company", "description", "location", "title"]);
  const request = buildClaudeRequest(RAW_JOB);
  const serialized = JSON.stringify(request);
  for (const secret of ["Private Person", "private@example.com", "internalScore", "private notes", "example.com/job"]) {
    assert.ok(!serialized.includes(secret), `request must not contain ${secret}`);
  }
  assert.equal(request.system, EXTRACTION_SYSTEM_PROMPT, "same system prompt as Qwen");
  assert.equal(request.messages[0].content, buildExtractionPrompt(publicJobFields(RAW_JOB)), "same extraction prompt as Qwen");
  assert.equal(request.model, DEFAULT_CLAUDE_MODEL);
  for (const sampling of ["temperature", "top_p", "top_k"]) {
    assert.ok(!(sampling in request), `${sampling} must not be sent: Claude 5-generation models reject it with a 400`);
  }
  assert.ok(request.max_tokens >= 8000, "room for adaptive thinking plus the JSON");
  assert.deepEqual(request.output_config, { format: { type: "json_schema", schema: JOB_PROFILE_SCHEMA } });
  assert.equal(buildClaudeRequest(RAW_JOB, { model: "claude-other" }).model, "claude-other");
}

// 2. The module itself never touches candidate data or the scorer.
{
  const source = fs.readFileSync(new URL("./claude-extractor.js", import.meta.url), "utf-8");
  assert.ok(!/candidate-profile|job-scorer|readFile/.test(source), "the Claude extractor must not read the candidate profile or import the scorer");
}

// 3. A successful call: correct endpoint/headers, normalized like Qwen's output.
{
  const { impl, calls } = fakeFetch([okResponse(messageBody(MODEL_OUTPUT))]);
  const result = await extractWithClaude(RAW_JOB, { apiKey: FAKE_KEY, model: DEFAULT_CLAUDE_MODEL, fetchImpl: impl, sleepImpl: noSleep });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, CLAUDE_API_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["x-api-key"], FAKE_KEY);
  assert.equal(calls[0].init.headers["anthropic-version"], "2023-06-01");
  assert.ok(!calls[0].init.body.includes(FAKE_KEY), "the key is a header, never in the body");
  assert.deepEqual(result.profile, normalizeJobProfile(structuredClone(MODEL_OUTPUT), RAW_JOB), "same normalizer as Qwen");
  assert.deepEqual(result.profile.requirements.required.map((item) => item.item), ["React", "TypeScript"]);
  assert.equal(result.profile.experience.minimumYears, 3);
  assert.deepEqual(result.usage, { input_tokens: 1200, output_tokens: 400 });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(typeof result.latencyMs, "number");
}

// Errors must never reveal the key.
async function expectFailure(responses, code, message) {
  const { impl, calls } = fakeFetch(responses);
  await assert.rejects(
    extractWithClaude(RAW_JOB, { apiKey: FAKE_KEY, fetchImpl: impl, sleepImpl: noSleep }),
    (error) => {
      assert.equal(error.code, code);
      if (message) assert.match(error.message, message);
      assert.ok(!error.message.includes(FAKE_KEY) && !JSON.stringify(error).includes(FAKE_KEY), "error must not contain the API key");
      return true;
    }
  );
  return calls;
}

// 4. Missing key: nothing is sent.
{
  const { impl, calls } = fakeFetch([]);
  await assert.rejects(extractWithClaude(RAW_JOB, { apiKey: "", fetchImpl: impl }), (error) => error.code === "NO_API_KEY");
  assert.equal(calls.length, 0);
}

// 5. 401 is not retried; the message has status and error type only.
{
  const calls = await expectFailure(
    [okResponse({ type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${FAKE_KEY}` } }, { status: 401 })],
    "HTTP", /^Claude API error 401 \(authentication_error: invalid x-api-key \[redacted\]\)$/
  );
  assert.equal(calls.length, 1);
}

// 5b. A 400 shows the API's reason so a rejected parameter is diagnosable.
await expectFailure(
  [okResponse({ type: "error", error: { type: "invalid_request_error", message: "temperature: not supported for this model" } }, { status: 400 })],
  "HTTP", /400 \(invalid_request_error: temperature: not supported for this model\)/
);

// 6. 429 then success: one retry honouring retry-after (capped).
{
  const waits = [];
  const { impl, calls } = fakeFetch([
    okResponse({ type: "error", error: { type: "rate_limit_error" } }, { status: 429, headers: { "retry-after": "3" } }),
    okResponse(messageBody(MODEL_OUTPUT))
  ]);
  const result = await extractWithClaude(RAW_JOB, { apiKey: FAKE_KEY, fetchImpl: impl, sleepImpl: async (ms) => waits.push(ms) });
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [3000]);
  assert.equal(result.profile.requirements.required.length, 2);

  const longWaits = [];
  const long = fakeFetch([okResponse({}, { status: 529, headers: { "retry-after": "600" } }), okResponse(messageBody(MODEL_OUTPUT))]);
  await extractWithClaude(RAW_JOB, { apiKey: FAKE_KEY, fetchImpl: long.impl, sleepImpl: async (ms) => longWaits.push(ms) });
  assert.deepEqual(longWaits, [30000], "retry-after is capped at 30s");
}

// 7. Persistent 500: retried once, then a clear error.
{
  const calls = await expectFailure([okResponse({}, { status: 500 }), okResponse({}, { status: 500 })], "HTTP", /500/);
  assert.equal(calls.length, 2);
}

// 8. Network error then success; timeout is not retried.
{
  const { impl, calls } = fakeFetch([new TypeError("fetch failed"), okResponse(messageBody(MODEL_OUTPUT))]);
  await extractWithClaude(RAW_JOB, { apiKey: FAKE_KEY, fetchImpl: impl, sleepImpl: noSleep });
  assert.equal(calls.length, 2);

  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const timeoutCalls = await expectFailure([timeout], "TIMEOUT", /did not respond within 60s/);
  assert.equal(timeoutCalls.length, 1);
}

// 9. Refusal, truncated output and invalid JSON are failures, not empty profiles.
await expectFailure([okResponse(messageBody("", { stop_reason: "refusal", content: [] }))], "REFUSAL");
await expectFailure([okResponse(messageBody('{"job": {"title": "Fr', { stop_reason: "max_tokens" }))], "MAX_TOKENS");
await expectFailure([okResponse(messageBody("not json at all"))], "INVALID_JSON");

// 10. A real abort through AbortSignal.timeout is reported as TIMEOUT.
{
  const keepAlive = setInterval(() => {}, 1000);
  const hanging = async (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  });
  await assert.rejects(
    extractWithClaude(RAW_JOB, { apiKey: FAKE_KEY, fetchImpl: hanging, timeoutMs: 50, sleepImpl: noSleep }),
    (error) => error.code === "TIMEOUT"
  );
  clearInterval(keepAlive);
}

// 11. Cost estimate (Haiku list price $0.10 / $0.50 per MTok).
{
  assert.equal(estimateClaudeCostUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 }), 0.6);
  assert.ok(Math.abs(estimateClaudeCostUsd({ input_tokens: 1200, output_tokens: 400 }) - 0.00032) < 1e-12);
  assert.equal(estimateClaudeCostUsd({}), 0);
}

console.log("PASS: Claude extractor checks passed (offline, fake fetch).");
