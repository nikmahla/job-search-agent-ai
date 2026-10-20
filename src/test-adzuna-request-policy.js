// Offline tests for the Adzuna request policy: shared rate limiting across
// concurrent searches and retrying only temporary failures.
// A virtual clock is used, so no real waiting and no network.
import assert from "node:assert/strict";
import { createRateLimiter, requestAdzunaPage } from "./job-sources.js";

function virtualClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms) => { time += ms; }
  };
}

const credentials = { appId: "test-id", appKey: "test-key" };
const options = { countryCode: "es", term: "React Developer", where: "Valencia", page: 1 };
const silent = (fn) => async (...args) => {
  const log = console.log;
  console.log = () => {};
  try { return await fn(...args); } finally { console.log = log; }
};

// 1. Three concurrent callers (local, Europe, UK) never get slots closer than the delay.
{
  const clock = virtualClock();
  const waitForSlot = createRateLimiter(2500, { now: clock.now, sleepImpl: clock.sleep });
  const grantedAt = [];
  const caller = async (count) => {
    for (let i = 0; i < count; i++) {
      await waitForSlot();
      grantedAt.push(clock.now());
    }
  };
  await Promise.all([caller(4), caller(4), caller(4)]);
  assert.equal(grantedAt.length, 12);
  const sorted = [...grantedAt].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i] - sorted[i - 1] >= 2500, `slot ${i} is ${sorted[i] - sorted[i - 1]}ms after the previous one`);
  }
  const perMinute = sorted.filter((time) => time < 60000).length;
  assert.ok(perMinute <= 25, `at most 25 requests per minute (got ${perMinute})`);
  assert.equal(sorted[0], 0, "the first request is not delayed");
}

// 2. A failed slot holder does not block the queue.
{
  const clock = virtualClock();
  const waitForSlot = createRateLimiter(1000, { now: clock.now, sleepImpl: clock.sleep });
  await waitForSlot();
  await waitForSlot();
  assert.equal(clock.now(), 1000);
}

const response = (status, body = {}, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => JSON.stringify(body)
});

const run = silent(async (responses, extra = {}) => {
  const clock = virtualClock();
  let calls = 0;
  let slots = 0;
  const fetchImpl = async () => {
    const next = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    if (next instanceof Error) throw next;
    return next;
  };
  let result;
  let error;
  try {
    result = await requestAdzunaPage(options, {
      fetchImpl,
      waitForSlot: async () => { slots += 1; },
      sleepImpl: clock.sleep,
      credentials,
      ...extra
    });
  } catch (caught) {
    error = caught;
  }
  return { result, error, calls, slots, waited: clock.now() };
});

// 3. Success returns results after one call.
{
  const { result, calls } = await run([response(200, { results: [{ id: 1 }] })]);
  assert.deepEqual(result, [{ id: 1 }]);
  assert.equal(calls, 1);
}

// 4. Permanent errors fail immediately: no retries, no backoff.
for (const status of [400, 401, 403, 404]) {
  const { error, calls, waited } = await run([response(status, { error: "denied" })]);
  assert.ok(error instanceof Error, `HTTP ${status} must throw`);
  assert.match(error.message, new RegExp(`Adzuna ${status} for es/React Developer in Valencia page 1`));
  assert.equal(calls, 1, `HTTP ${status} must not be retried`);
  assert.equal(waited, 0, `HTTP ${status} must not back off`);
}

// 5. Temporary errors are retried, every attempt goes through the limiter.
{
  const { result, calls, slots } = await run([response(429), response(503), response(200, { results: [{ id: 2 }] })]);
  assert.deepEqual(result, [{ id: 2 }]);
  assert.equal(calls, 3);
  assert.equal(slots, 3, "retries also respect the shared rate limit");
}
{
  const { error, calls } = await run([response(500), response(500), response(500)]);
  assert.match(error.message, /Adzuna 500/);
  assert.equal(calls, 3, "gives up after MAX_RETRIES attempts");
}

// 6. Retry-After is honoured (bounded), otherwise linear backoff.
{
  const { waited } = await run([response(429, {}, { "retry-after": "7" }), response(200, { results: [] })]);
  assert.equal(waited, 7000);
}
{
  const { waited } = await run([response(429, {}, { "retry-after": "3600" }), response(200, { results: [] })]);
  assert.equal(waited, 60000, "an extreme Retry-After is capped");
}
{
  const { waited } = await run([response(429), response(429), response(200, { results: [] })]);
  assert.equal(waited, 5000 + 10000);
}

// 7. Network errors are temporary.
{
  const { result, calls } = await run([new TypeError("fetch failed"), response(200, { results: [{ id: 3 }] })]);
  assert.deepEqual(result, [{ id: 3 }]);
  assert.equal(calls, 2);
}

// 8. Missing credentials fail before any request; the key never appears in errors.
{
  const { error, calls } = await run([response(200)], { credentials: { appId: "", appKey: "" } });
  assert.match(error.message, /Missing ADZUNA_APP_ID or ADZUNA_APP_KEY/);
  assert.equal(calls, 0);
  const denied = await run([response(401, { error: "bad key" })]);
  assert.ok(!denied.error.message.includes("test-key"), "the API key is not echoed in error messages");
}

console.log("PASS: Adzuna request policy checks passed (offline, virtual clock).");
