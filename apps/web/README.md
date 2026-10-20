# Shortlist — demo UI for job-search-agent-ai

A portfolio-quality interface for the job-search agent in this repository. It shows how a CV, a set of
preferences and a list of scored jobs could be presented, with the evidence behind every score.

**Phase 1 runs on synthetic data only.** There is no backend call, no authentication, no database and no real
job search. The CV step does not read the file you choose. The data layer (`src/lib/api`) is a typed interface
with one demo adapter, so a later phase can add an HTTP adapter for the real agent without touching the UI.

## Run it

```bash
cd apps/web
npm install
npm run dev        # http://localhost:3000
```

Other scripts: `npm run build`, `npm run start`, `npm run lint`, `npm run typecheck`.

Append `?demo=error` or `?demo=empty` to `/jobs` to see the error and empty states.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 5.9 · Tailwind CSS 4 · shadcn/ui · Framer Motion ·
Recharts · TanStack Query · Zod.

## Where the data shapes come from

`src/lib/schema` mirrors what the agent already produces: `data/job-results.json` entries (`src/job-scorer.js`),
requirement coverage rows (`src/requirement-coverage.js`), the candidate profile, the skill-gap report
(`src/skill-gap.js`) and the run funnel (`src/job-state.js`, `src/triage.js`). The demo score is the weighted mean
the scorer uses, and each demo decision follows the scorer's APPLY / MAYBE / SKIP rules. All companies, postings
and people in `src/demo-data` are invented.
