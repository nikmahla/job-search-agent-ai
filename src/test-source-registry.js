// Offline tests for the job-source registry: one source list, failure
// isolation, disabled sources and unchanged job order.
import assert from "node:assert/strict";
import fs from "node:fs";
import { JOB_SOURCES, disabledFromEnv, enabledSources, formatSourceReport, runSources } from "./job-source-registry.js";
import { searchAllJobs } from "./job-sources.js";

const job = (source, n) => ({ id: `${source}:${n}`, title: `Frontend Developer ${n}`, company: `Co ${source}`, location: "Remote", url: `https://${source}.example/jobs/${n}`, source, description: "React." });
const fake = (name, impl, enabled = true) => ({ name, label: name, enabled, search: impl });

// 1. The registry holds the sources the pipeline always used, in the same order.
{
  const names = JOB_SOURCES.map((source) => source.name);
  assert.deepEqual(names.slice(0, 4), ["adzuna-local", "adzuna-europe-remote", "adzuna-uk-remote", "himalayas"]);
  for (const source of JOB_SOURCES) {
    assert.equal(typeof source.name, "string");
    assert.equal(typeof source.search, "function");
    assert.equal(typeof source.enabled, "boolean");
  }
  assert.equal(new Set(names).size, names.length, "unique names");
}

// 2. One failing source does not fail the search; jobs keep registry order.
{
  const { jobs, report } = await runSources([
    fake("a", async () => [job("a", 1), job("a", 2)]),
    fake("broken", async () => { throw new Error("HTTP 503 after 3 attempts"); }),
    fake("b", async () => [job("b", 1)]),
    fake("bad-shape", async () => ({ jobs: [] }))
  ], { disabled: new Set() });
  assert.deepEqual(jobs.map((j) => j.id), ["a:1", "a:2", "b:1"]);
  assert.deepEqual(report.map((row) => [row.name, row.status, row.count]), [["a", "ok", 2], ["broken", "failed", 0], ["b", "ok", 1], ["bad-shape", "failed", 0]]);
  assert.match(report[1].error, /HTTP 503/);
  assert.match(report[3].error, /instead of a list/);
  const text = formatSourceReport(report);
  assert.match(text, /✖ broken: FAILED — HTTP 503/);
  assert.match(text, /other sources continue/);
}

// 3. Sources run concurrently: a slow source does not delay the result order.
{
  const order = [];
  const { jobs } = await runSources([
    fake("slow", async () => { await new Promise((r) => setTimeout(r, 30)); order.push("slow"); return [job("slow", 1)]; }),
    fake("fast", async () => { order.push("fast"); return [job("fast", 1)]; })
  ], { disabled: new Set() });
  assert.deepEqual(order, ["fast", "slow"], "both started at once");
  assert.deepEqual(jobs.map((j) => j.source), ["slow", "fast"], "results still follow registry order");
}

// 4. Disabled sources (flag or DISABLED_SOURCES) are never called.
{
  let called = 0;
  const sources = [fake("off", async () => { called += 1; return []; }, false), fake("on", async () => [job("on", 1)]), fake("env-off", async () => { called += 1; return []; })];
  const { report } = await runSources(sources, { disabled: disabledFromEnv(" Env-Off , other ") });
  assert.equal(called, 0);
  assert.deepEqual(report.map((row) => row.status), ["disabled", "ok", "disabled"]);
  assert.deepEqual(enabledSources(sources, { disabled: new Set() }).map((s) => s.name), ["on", "env-off"]);
  assert.deepEqual([...disabledFromEnv("")], []);
}

// 5. All sources failing gives an empty list, not an exception.
{
  const { jobs, report } = await runSources([fake("x", async () => { throw new Error("down"); })], { disabled: new Set() });
  assert.deepEqual(jobs, []);
  assert.equal(report[0].status, "failed");
}

// 6. run-agent.js and searchAllJobs() both use the registry; no duplicated source list.
{
  const runAgent = fs.readFileSync(new URL("./run-agent.js", import.meta.url), "utf8");
  const jobSources = fs.readFileSync(new URL("./job-sources.js", import.meta.url), "utf8");
  assert.match(runAgent, /from "\.\/job-source-registry\.js"/);
  assert.match(runAgent, /await runSources\(/);
  assert.ok(!/searchHimalayasJobs\(|searchLocalJobs\(|Promise\.all\(\[/.test(runAgent), "run-agent.js no longer lists sources itself");
  const allJobsBody = jobSources.slice(jobSources.indexOf("export async function searchAllJobs"));
  assert.match(allJobsBody, /runSources\(/);
  assert.ok(!/Promise\.all\(\[/.test(allJobsBody));
}

// 7. searchAllJobs() works through the registry (every network source disabled here).
{
  const all = JOB_SOURCES.map((source) => source.name).join(",");
  const jobs = await searchAllJobs({ disabled: disabledFromEnv(all) });
  assert.deepEqual(jobs, []);
}

console.log("PASS: source registry and failure isolation checks passed (offline).");
