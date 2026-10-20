import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const args = process.argv.slice(2);

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (args.some((arg) => arg !== "--test") ||
    args.filter((arg) => arg === "--test").length > 1) {
  fail("The only supported optional argument is --test.");
}

function git(gitArgs) {
  try {
    return execFileSync("git", gitArgs, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 2 * 1024 * 1024
    });
  } catch (error) {
    fail(
      `Git command failed: git ${gitArgs.join(" ")}\n` +
      (error.stderr?.toString() || error.message)
    );
  }
}

function isSensitivePath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  return (
    /(^|\/)\.env($|\.)/i.test(normalized) ||
    /(^|\/)(data|node_modules|secrets?)(\/|$)/i.test(normalized) ||
    /(^|\/)[^/]*(cv|resume|curriculum.?vitae|personal.?profile)[^/]*$/i.test(normalized) ||
    /(^|\/)[^/]*\.(pem|key|p12|pfx)$/i.test(normalized)
  );
}

function safeStatus() {
  const lines = git(["status", "--short", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean);

  if (!lines.length) return "(clean)";

  return lines.map((line) => {
    const filePath = line.slice(3);
    return isSensitivePath(filePath)
      ? `${line.slice(0, 2)} [sensitive path omitted]`
      : line;
  }).join("\n");
}

function shortStat(gitArgs) {
  const output = git(gitArgs).trim();
  if (!output) return "(no changes)";
  return output;
}

const packageJson = JSON.parse(
  readFileSync(path.join(projectRoot, "package.json"), "utf8")
);

const expectedTestScript =
  "node src/test-job-pre-ranker.js && node src/test-job-filter-unit.js && node src/test-job-source-detection.js && node src/test-job-scorer.js && node src/test-location-detection.js";

console.log("\n=== PROJECT ===");
console.log(projectRoot);

console.log("\n=== GIT STATUS (sensitive paths filtered) ===");
console.log(safeStatus());

console.log("\n=== STAGED CHANGE SUMMARY ===");
console.log(shortStat(["diff", "--cached", "--shortstat"]));

console.log("\n=== UNSTAGED CHANGE SUMMARY ===");
console.log(shortStat(["diff", "--shortstat"]));

console.log("\n=== UNTRACKED FILE NAMES (contents not read) ===");
const untracked = git(["ls-files", "--others", "--exclude-standard"])
  .split("\n")
  .filter(Boolean);

const visibleUntracked = untracked.filter(
  (filePath) => !isSensitivePath(filePath)
);
const hiddenUntrackedCount = untracked.length - visibleUntracked.length;

console.log(visibleUntracked.length ? visibleUntracked.join("\n") : "(none)");
if (hiddenUntrackedCount) {
  console.log(`(${hiddenUntrackedCount} sensitive path(s) omitted)`);
}

console.log("\n=== UNSTAGED DIFF CHECK ===");
const unstagedCheck = git(["diff", "--check"]);
console.log(unstagedCheck || "PASS");

console.log("\n=== STAGED DIFF CHECK ===");
const stagedCheck = git(["diff", "--cached", "--check"]);
console.log(stagedCheck || "PASS");

if (args.includes("--test")) {
  if (packageJson.scripts?.test !== expectedTestScript) {
    fail(
      "The npm test script differs from the reviewed safe command. " +
      "Review package.json before running tests."
    );
  }

  console.log("\n=== TESTS ===");
  console.log("Running the reviewed npm test script only.");

  const result = spawnSync("npm", ["test"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    fail(`Could not start npm test: ${result.error.message}`);
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    console.error("\nTESTS FAILED.");
  } else {
    console.log("\nTESTS PASSED.");
  }
} else {
  console.log("\nTests were not run. Use --test to request them explicitly.");
}

console.log("\nNo report file was created.");
