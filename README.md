```markdown
# AI Job Search Agent

An AI-powered job search assistant that discovers, filters, ranks, and analyzes job postings based on a candidate's skills, preferences, and eligibility rules.

## 🚀 Live Demo

**Try the interactive UI:**  
https://job-search-agent-ai.vercel.app/

[![AI Job Search Agent Demo](./apps/web/public/demo-preview.png)](<img width="1350" height="749" alt="Image" src="https://github.com/user-attachments/assets/9e957ea3-5d48-482a-a1c9-8a9d1dcfceaf" />)


> **Demo mode:** This preview runs on a sample candidate and simulated job-search results. Your own profile, preferences, and live job sources aren't connected yet.
>
> The demo uses the same matching concepts as the agent — scoring rules, eligibility gates, decisions, requirement coverage, and skill-gap analysis — with synthetic data.

## ✨ Features

- 🔎 Multi-source job discovery
- 🎯 Deterministic job filtering and eligibility rules
- 📊 Pre-ranking and job prioritization
- 🤖 AI-powered job analysis with Qwen
- 💾 Cached analyses to reduce unnecessary AI calls
- 🧠 Skill-gap analysis
- 📋 Detailed job triage and audit records
- 🔄 Duplicate detection and job-state tracking
- 📌 Explainable job matching with requirement coverage and decision factors
- 🧪 Offline test coverage for core pipeline logic

## 🏗️ Pipeline

```text
Job Sources
    ↓
Discovery
    ↓
Deduplication
    ↓
Filtering
    ↓
Pre-Ranking
    ↓
Enrichment
    ↓
Eligibility Re-check
    ↓
AI Analysis
    ↓
Scoring & Decision
    ↓
Results
```

## 🧠 AI Analysis

The agent uses an LLM to evaluate suitable jobs against a candidate profile and produces:

- Job-fit score
- APPLY / MAYBE / SKIP decision
- Matching skills
- Skill gaps
- Relevant technologies
- Decision reasoning

Previously analyzed jobs can be reused through the cache without consuming a new AI-analysis slot.

## 🎯 Explainable Matching

The matching system is designed to make job recommendations understandable rather than treating them as a black box.

For each analyzed job, the agent can expose:

- Eligibility gates
- Technical and experience fit
- Matching requirements
- Missing or partially matched requirements
- Skill gaps
- Score breakdown
- Final recommendation
- Reasons behind the decision

The UI presents these signals as a decision-oriented view so a candidate can quickly understand **why a job matches, what is missing, and what should be reviewed before applying**.

## 📊 Skill Gap Analysis

The project can identify recurring skills and technologies requested by employers and compare them with the candidate's existing profile.

This helps prioritize what to learn next based on actual job-market demand rather than relying only on generic skill lists.

## 🗂️ Job Triage

Each discovered job can have a structured triage record containing:

- Pipeline stage
- Exclusion reason
- Pre-rank score
- Eligibility information
- Description snapshot
- Work-mode information
- Analysis status
- Final decision

This makes the pipeline auditable instead of treating rejected jobs as unexplained numbers.

## 💾 Caching

AI analysis can be expensive and time-consuming.

The agent caches completed analyses and reuses them when the same job does not require a new analysis.

This reduces unnecessary LLM calls and makes repeated runs more efficient.

## 🔄 Job State & Deduplication

The pipeline tracks jobs across runs and detects duplicate postings before analysis.

Job state can be used to distinguish between jobs that are:

- Newly discovered
- Previously analyzed
- Already reviewed
- Selected for application
- Skipped

This allows the agent to maintain continuity across multiple search runs.

## 🖥️ Web Interface

The repository also contains a Next.js interface under:

```text
apps/web
```

The interface provides an interactive view of the matching workflow, including:

- Candidate profile and preferences
- Job matches
- Match scores
- Eligibility gates
- Requirement coverage
- Skill gaps
- Saved jobs
- Search insights
- Explainable decision factors

The current web interface uses synthetic data for demonstration purposes.

The production agent remains a local-first Node.js application and is not directly connected to the public demo yet.

## 🛠️ Tech Stack

### Agent

- Node.js
- JavaScript
- Ollama
- Qwen
- REST APIs
- Automated testing

### Web Interface

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Framer Motion
- Recharts
- TanStack Query
- Zod

## ⚙️ Run Locally

Install the project dependencies:

```bash
npm install
```

Configure your local environment and add the required API credentials to `.env`.

Then start the agent:

```bash
npm start
```

> Live job-source access and AI analysis may require external API credentials or a locally running Ollama/Qwen setup.

### Run the Web UI

The Next.js interface can be run separately:

```bash
cd apps/web
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

> The web interface currently runs on synthetic demo data and is not connected to the live agent pipeline yet.

## 🧪 Testing

Run the automated test suite with:

```bash
npm test
```

The tests cover core pipeline behavior including:

- Filtering
- Ranking
- Caching
- Triage
- Selection behavior
- Job-state tracking
- Other decision-making logic

The test suite is designed to run offline without requiring live job sources or external AI services.

## 🔐 Privacy & Security

Sensitive information should **never** be committed to the repository.

Keep private:

- API keys and tokens
- Personal CV/profile data
- Private job-search data
- Local state/results
- Environment variables
- Personal configuration

Use `.env` and local configuration files for secrets and personal data.

The public web demo uses synthetic candidate and job data and does not contain personal CV information.

## ⚠️ Limitations

- The public Vercel demo uses **synthetic candidate and job data** and is not connected to a real candidate profile.
- CV upload and CV parsing are planned but are not implemented in the current demo.
- The web interface currently uses simulated job-search results rather than live job-source data.
- Live job-source availability is currently limited by the configured external APIs and their credentials.
- AI analysis requires a locally running Ollama/Qwen setup when running the agent locally.
- The AI model provides **job recommendations and analysis only**. It does not automatically apply to jobs.
- Final application decisions remain with the candidate.
- The current public UI is a demonstration layer; the underlying Node.js agent remains the primary working pipeline.

## 📁 Project Structure

```text
.
├── src/
│   ├── discovery/
│   ├── filtering/
│   ├── ranking/
│   ├── enrichment/
│   ├── analysis/
│   ├── scoring/
│   ├── triage/
│   └── job-state/
│
├── scripts/
│
├── apps/
│   └── web/
│       └── Next.js UI
│
├── LICENSE
├── package.json
└── README.md
```

## 📌 Project Status

The core pipeline, caching, triage, ranking, job-state tracking, skill-gap analysis, and AI-analysis workflow are implemented and covered by automated tests.

The Next.js interface is currently a **demonstration layer** built with synthetic data.

Planned integrations include:

- CV parsing
- Profile-driven preferences
- Live job-source integration
- Real-time pipeline execution
- Connecting the web interface to the local agent API

## 📄 License

This project is licensed under the terms of the included `LICENSE` file.
``
