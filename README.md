
# AI Job Search Agent

An AI-powered job search assistant that discovers, filters, ranks, and analyzes job postings based on a candidate's skills and preferences.

## ✨ Features

- 🔎 Multi-source job discovery
- 🎯 Deterministic job filtering and eligibility rules
- 📊 Pre-ranking and job prioritization
- 🤖 AI-powered job analysis with Qwen
- 💾 Cached analyses to reduce unnecessary AI calls
- 🧠 Skill-gap analysis
- 📋 Detailed job triage and audit records
- 🔄 Duplicate detection and job-state tracking
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

The agent uses an LLM to evaluate suitable jobs against the candidate profile and produces:

- Job-fit score
- APPLY / MAYBE / SKIP decision
- Matching skills
- Skill gaps
- Relevant technologies
- Decision reasoning

Previously analyzed jobs can be reused through the cache without consuming a new AI-analysis slot.

## 📊 Skill Gap Analysis

The project can identify recurring skills and technologies requested by employers and compare them with the candidate's existing profile.

This helps prioritize what to learn next based on actual job-market demand.

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

## 🧪 Testing

Run the test suite with:

```bash
npm test
```

The tests cover filtering, ranking, caching, triage, selection behavior, and other core pipeline logic.

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

## ⚙️ Setup

```bash
npm install
```

Configure your local environment, then run:

```bash
npm start
```

> Live job-source access and AI analysis may require external API credentials or locally running services.

## 📌 Project Status

This project is actively evolving. The core pipeline, caching, triage, ranking, and AI-analysis workflow are implemented and covered by automated tests.

