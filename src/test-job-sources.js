import {
  searchLocalJobs,
  searchEuropeRemoteJobs,
  searchUKRemoteJobs
} from "./job-sources.js";

console.log("\n🔎 Searching Alicante + Valencia...\n");

const localJobs = await searchLocalJobs();

console.log(`Found ${localJobs.length} local jobs\n`);

for (const job of localJobs.slice(0, 10)) {
  console.log("────────────────────────────");
  console.log(`${job.title}`);
  console.log(`Company: ${job.company}`);
  console.log(`Location: ${job.location}`);
  console.log(`Remote: ${job.remote}`);
  console.log(`Hybrid: ${job.hybrid}`);
  console.log(`URL: ${job.url}`);
}

console.log("\n🌍 Searching Europe Remote...\n");

const europeJobs = await searchEuropeRemoteJobs();

console.log(`Found ${europeJobs.length} European remote jobs\n`);

for (const job of europeJobs.slice(0, 10)) {
  console.log("────────────────────────────");
  console.log(`${job.title}`);
  console.log(`Company: ${job.company}`);
  console.log(`Location: ${job.location}`);
  console.log(`Country: ${job.country}`);
  console.log(`Remote: ${job.remote}`);
  console.log(`URL: ${job.url}`);
}

console.log("\n🇬🇧 Searching UK Remote...\n");

const ukJobs = await searchUKRemoteJobs();

console.log(`Found ${ukJobs.length} UK remote jobs\n`);

for (const job of ukJobs.slice(0, 10)) {
  console.log("────────────────────────────");
  console.log(`${job.title}`);
  console.log(`Company: ${job.company}`);
  console.log(`Location: ${job.location}`);
  console.log(`Remote: ${job.remote}`);
  console.log(`URL: ${job.url}`);
}

console.log("\n✅ Search test completed.\n");