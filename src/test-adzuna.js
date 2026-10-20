import "dotenv/config";

const appId = process.env.ADZUNA_APP_ID;
const appKey = process.env.ADZUNA_APP_KEY;

if (!appId || !appKey) {
  throw new Error(
    "Missing ADZUNA_APP_ID or ADZUNA_APP_KEY in .env"
  );
}

const url = new URL(
  "https://api.adzuna.com/v1/api/jobs/es/search/1"
);

url.searchParams.set("app_id", appId);
url.searchParams.set("app_key", appKey);
url.searchParams.set("results_per_page", "5");
url.searchParams.set("what", "React Developer");
url.searchParams.set("where", "Valencia");
url.searchParams.set("content-type", "application/json");

const response = await fetch(url);

if (!response.ok) {
  const errorText = await response.text();

  throw new Error(
    `Adzuna API error ${response.status}: ${errorText}`
  );
}

const data = await response.json();

console.log(`Found ${data.results?.length ?? 0} jobs\n`);

for (const job of data.results ?? []) {
  console.log("────────────────────────────");
  console.log("Title:", job.title);
  console.log("Company:", job.company?.display_name ?? "Unknown");
  console.log(
    "Location:",
    job.location?.display_name ?? "Unknown"
  );
  console.log("URL:", job.redirect_url);
}