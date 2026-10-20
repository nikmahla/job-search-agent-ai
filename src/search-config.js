// Pure search configuration (no env/API access) so it can be tested offline.

export const EUROPE_COUNTRIES = [
  { code: "es", name: "Spain" },
  { code: "fr", name: "France" },
  { code: "de", name: "Germany" },
  { code: "nl", name: "Netherlands" },
  { code: "be", name: "Belgium" },
  { code: "it", name: "Italy" },
  { code: "at", name: "Austria" },
  { code: "pl", name: "Poland" },
  { code: "ch", name: "Switzerland" }
];

export const LOCAL_CITIES = [
  "Alicante",
  "Valencia"
];

// Adzuna matches every word of "what", so a term containing all words of
// another term is a narrower subset of it. Keep terms distinct and few:
// each term costs one request per location/country.
export const SEARCH_TERMS = [
  "React Developer",
  "Frontend Developer",
  "React Engineer",
  "Next.js Developer",
  "Frontend Engineer",
  "JavaScript Developer",
  "Full Stack React Developer"
];

// FreeHire (https://freehire.me) public JSON API: one request per term per
// scope, so 2 terms × 3 scopes = 6 requests per run. Facet values are
// FreeHire's controlled vocabularies (see docs/sources/freehire.md).
// FreeHire's own work_mode tag is NOT trusted for eligibility: remote/hybrid
// is re-derived from the posting text with the same rules as Adzuna.
export const FREEHIRE_CONFIG = {
  enabled: true,
  baseUrl: "https://freehire.me",
  searchPath: "/api/v1/agent/jobs/search",
  terms: ["react", "frontend"],
  categories: ["frontend", "fullstack"],
  scopes: [
    // Spain: every work mode (the location rules decide Alicante/Valencia/remote).
    { name: "spain", searchMode: "local", facets: { countries: ["es"] } },
    { name: "eu-remote", searchMode: "remote", facets: { regions: ["eu"], work_mode: ["remote"] } },
    { name: "uk-remote", searchMode: "remote", facets: { regions: ["uk"], work_mode: ["remote"] } }
  ],
  limit: 25,
  postedWithinDays: 30,
  timeoutMs: 15000,
  maxAttempts: 3,
  maxRetryAfterMs: 10000,
  userAgent: "job-search-agent/1.0 (personal job search; low volume)"
};

// One search per local city, per European country and one for the UK.
export function countPlannedRequests({
  terms = SEARCH_TERMS,
  cities = LOCAL_CITIES,
  countries = EUROPE_COUNTRIES,
  pagesPerQuery = 1
} = {}) {
  return (cities.length + countries.length + 1) * terms.length * pagesPerQuery;
}

function tokens(term) {
  return String(term ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9.#+]+/)
    .filter(Boolean);
}

// Terms that add no coverage: exact duplicates after normalization.
export function findDuplicateTerms(terms = SEARCH_TERMS) {
  const seen = new Set();
  const duplicates = [];

  for (const term of terms) {
    const key = tokens(term).join(" ");
    if (seen.has(key)) duplicates.push(term);
    seen.add(key);
  }

  return duplicates;
}

// Pairs where `narrow` contains every word of `broad` (heavy overlap).
export function findSubsetTerms(terms = SEARCH_TERMS) {
  const pairs = [];

  for (const narrow of terms) {
    for (const broad of terms) {
      if (narrow === broad) continue;
      const narrowTokens = new Set(tokens(narrow));
      const broadTokens = tokens(broad);
      if (broadTokens.length < narrowTokens.size && broadTokens.every((word) => narrowTokens.has(word))) {
        pairs.push({ narrow, broad });
      }
    }
  }

  return pairs;
}
