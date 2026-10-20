# FreeHire source

Code: `src/sources/freehire.js` · Config: `FREEHIRE_CONFIG` in `src/search-config.js` ·
Tests: `src/test-freehire-source.js` (offline, fake fetch).

This is the file to update if the FreeHire API changes.

## What it is

[freehire.me](https://freehire.me) is an open-source IT job aggregator that normalizes
postings from ~50 applicant-tracking systems into one schema. Reads are public and need
no API key. It is a personal project run on a best-effort basis with **no SLA**, so the
source is optional: if it fails, the registry reports it and every other source still runs.

Its `robots.txt` asks automated clients to use the JSON API rather than scrape HTML pages
and to send a User-Agent naming the project. This source does both.

## Endpoint used

`GET {base}/api/v1/agent/jobs/search` (base: `https://freehire.me`, or `FREEHIRE_API_URL`
for a self-hosted instance).

| Param | Value sent | Notes |
|---|---|---|
| `q` | each of `FREEHIRE_CONFIG.terms` (`react`, `frontend`) | keyword full-text |
| `category` | `frontend`, `fullstack` | repeated param = OR |
| `countries` / `regions` / `work_mode` | per scope (below) | controlled vocabularies |
| `posted_within_days` | `30` | same window as Adzuna (`MAX_JOB_AGE_DAYS`) |
| `limit` / `offset` | `25` / `0` | one page per query |
| `include_description` / `description_format` | `true` / `text` | full description in the search result, so no detail call and no enrichment fetch |
| `semantic_ratio` | `0` | keyword search |

Scopes (3) × terms (2) = **6 requests per run**:

- `spain`: `countries=es`, every work mode. Alicante/Valencia/Spain-remote is decided by our own location rules.
- `eu-remote`: `regions=eu&work_mode=remote`
- `uk-remote`: `regions=uk&work_mode=remote`

Live facet values (with counts) for a query: `GET /api/v1/jobs/facets?q=react`.

Response envelope: `{ "data": [job, ...], "meta": { "total", "limit", "offset" } }`;
errors are `{ "error": "..." }` with a 4xx/5xx status. A `404` on the search path means
the instance predates the agent endpoint.

Fields read from each job: `public_slug`, `url` (the employer/ATS posting URL), `title`,
`company`, `location`, `description`, `work_mode`, `regions`, `countries`, `skills`,
`posted_at`, `created_at`, `source` (the ATS), `enrichment.{seniority, category,
employment_type, salary_min, salary_max, salary_currency, salary_period}`.

## Normalization

Into the shared internal job shape (`id`, `title`, `company`, `location`, `description`,
`url`, `source: "freehire"`, `sourceCountry`, `searchMode`, `remote`, `hybrid`, `salary`,
`created`, `locationRestrictions`, `timezoneRestrictions`, `sourceAttribution`), plus
`sourceTags` with FreeHire's own facets as metadata.

- **`work_mode` is not trusted for eligibility.** `remote`/`hybrid` are derived from the
  title, description and location with the same `isRemote`/`isHybrid` rules used for
  Adzuna (including the "Remote Sensing" safeguard). A job tagged `remote` whose text
  never says so is treated as not remote, and the existing location rules decide.
- FreeHire's `countries`/`regions` describe where a job is and are often incomplete, so
  they are **never** turned into `locationRestrictions`.
- `url` is the employer's posting URL, so a job also found on Adzuna or Himalayas is
  merged by the existing deduplication (provenance kept in `sourceInfoList`).
- Closed and older-than-30-days postings are dropped with the same `isUsableJob` check
  as the other sources; entries without a description are dropped.

## Failure behaviour

- 15 s timeout per request (`AbortSignal.timeout`); timeouts and network errors are not retried.
- `429` and `5xx`: at most 3 attempts in total, backoff 1 s then 2 s, `Retry-After`
  honoured but capped at 10 s.
- Any other status, invalid JSON or a missing `data` array fails that request.
- One failed request is logged; the others still count. If all 6 fail, the source throws
  and the registry reports `freehire: FAILED`; the run continues with the other sources.

## Turning it off

- Permanently: `FREEHIRE_CONFIG.enabled = false` in `src/search-config.js`.
- For one run: `DISABLED_SOURCES=freehire npm start`.
