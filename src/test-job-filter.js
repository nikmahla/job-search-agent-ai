import { searchAllJobs } from "./job-sources.js";
import { filterJobs } from "./job-filter.js";

console.log("\n🧪 TESTING JOB FILTER...\n");

const jobs = await searchAllJobs();

console.log(`📦 Raw jobs found: ${jobs.length}`);

const result = filterJobs(jobs);

console.log("\n================================");
console.log("FILTER RESULT");
console.log("================================");

console.log(`Total:    ${result.total}`);
console.log(`Kept:     ${result.keptCount}`);
console.log(`Rejected: ${result.rejectedCount}`);

console.log("\n\n✅ KEPT JOBS");
console.log("================================");

for (const job of result.kept) {
  console.log(
    `\n✓ ${job.title}` +
    `\n  Company: ${job.company}` +
    `\n  Location: ${job.location}` +
    `\n  Reason: ${job.preFilter.reason}`
  );
}

console.log("\n\n❌ REJECTED JOBS");
console.log("================================");

for (const job of result.rejected) {
  console.log(
    `\n✗ ${job.title}` +
    `\n  Company: ${job.company}` +
    `\n  Reason: ${job.preFilter.reason}`
  );
}

console.log("\n\n✅ Filter test completed.\n");