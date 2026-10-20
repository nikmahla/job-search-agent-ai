// Offline tests for run reliability: a failed run must not overwrite the last
// good results, and a hung Ollama request must time out instead of hanging.
import assert from "node:assert/strict";
import { saveRunOutputs, RUN_OUTPUT_PATHS } from "./run-output.js";
import { askQwen } from "./build-job-profile.js";

function fakeWriter() {
  const files = new Map();
  return { files, writeFile: async (path, content) => { files.set(path, content); } };
}

// 1. Every analysis failed (e.g. Ollama down): nothing is written.
{
  const disk = fakeWriter();
  const saved = await saveRunOutputs({ results: [], debugJobProfiles: [], attempted: 15, writeFile: disk.writeFile });
  assert.deepEqual(saved, { written: false, reason: "every-analysis-failed" });
  assert.equal(disk.files.size, 0, "previous job-results.json is left untouched");
}

// 2. Nothing analysed: nothing is written.
{
  const disk = fakeWriter();
  const saved = await saveRunOutputs({ results: [], attempted: 0, writeFile: disk.writeFile });
  assert.equal(saved.written, false);
  assert.equal(disk.files.size, 0);
}

// 3. Partial and complete runs are written, results and debug profiles both.
{
  const disk = fakeWriter();
  const saved = await saveRunOutputs({
    results: [{ title: "A", decision: "MAYBE" }],
    debugJobProfiles: [{ title: "A" }],
    attempted: 3,
    writeFile: disk.writeFile
  });
  assert.deepEqual(saved, { written: true, reason: "partial" });
  assert.deepEqual(JSON.parse(disk.files.get(RUN_OUTPUT_PATHS.results)), [{ title: "A", decision: "MAYBE" }]);
  assert.deepEqual(JSON.parse(disk.files.get(RUN_OUTPUT_PATHS.debugProfiles)), [{ title: "A" }]);
}
{
  const disk = fakeWriter();
  const saved = await saveRunOutputs({ results: [{}, {}], debugJobProfiles: [{}, {}], attempted: 2, writeFile: disk.writeFile });
  assert.deepEqual(saved, { written: true, reason: "complete" });
}

// 4. A hung Ollama request times out with a clear error (fake fetch honours the abort signal).
{
  const hangingFetch = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  });
  // A real fetch keeps the event loop alive through its socket; the fake one
  // holds nothing open, so keep the process alive while waiting for the abort.
  const keepAlive = setTimeout(() => {}, 5000);
  const started = Date.now();
  await assert.rejects(
    askQwen("prompt", { fetchImpl: hangingFetch, timeoutMs: 50 }),
    /Ollama did not respond within/
  );
  clearTimeout(keepAlive);
  assert.ok(Date.now() - started < 2000, "the timeout fires promptly");
}

// 5. Normal responses and HTTP errors are unchanged.
{
  const ok = await askQwen("prompt", {
    fetchImpl: async (url, options) => {
      assert.ok(options.signal, "every Ollama request carries a timeout signal");
      return { ok: true, json: async () => ({ message: { content: "{\"job\":{}}" } }) };
    }
  });
  assert.equal(ok, "{\"job\":{}}");
  await assert.rejects(
    askQwen("prompt", { fetchImpl: async () => ({ ok: false, status: 500, text: async () => "model not loaded" }) }),
    /Ollama error 500: model not loaded/
  );
  await assert.rejects(
    askQwen("prompt", { fetchImpl: async () => { throw new TypeError("fetch failed"); } }),
    /fetch failed/,
    "a refused connection is reported as-is"
  );
}

console.log("PASS: run reliability checks passed (offline).");
