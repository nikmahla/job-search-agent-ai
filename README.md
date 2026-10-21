# AI Job Search Agent

An AI-powered job search assistant that discovers, filters, ranks, and analyzes job postings based on a candidate's skills, preferences, and eligibility rules.

## 🚀 Live Demo

**Try the interactive UI:**  
https://job-search-agent-ai.vercel.app/

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
- 🧪 Offline test coverage for core pipeline logic
- 📌 Explainable job matching with requirement coverage and decision factors

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
