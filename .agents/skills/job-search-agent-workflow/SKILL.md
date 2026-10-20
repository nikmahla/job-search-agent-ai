---
name: job-search-agent-workflow
description: Work on the Job Search Agent Node.js repository. Use for job filtering, deduplication, ranking, CV matching, AI-assisted coding skills, location eligibility, bug fixes, and offline testing.
---

# Job Search Agent Workflow

## Project workflow
- Inspect only the files relevant to the current task before making changes.
- Prefer the smallest correct change over refactoring unrelated code.
- Reuse existing helpers and patterns where possible.
- Preserve existing behavior unless the task explicitly requires a change.
- Explain important assumptions and limitations.

## Job eligibility rules
- Alicante: onsite, hybrid, and remote are eligible.
- Valencia: hybrid and remote are eligible; onsite is ineligible.
- Other European countries: remote only.
- United Kingdom and United Arab Emirates: remote only.
- Unknown or ambiguous location/work mode must be flagged for review, not automatically assumed eligible.
- Do not mistake "Remote Sensing" for a remote work arrangement.
- Reject Lead, Principal, and Staff roles.
- Reject Intern and Internship roles.
- Accept Junior and Entry-level roles.
- Prioritize Mid-level roles; assess Senior roles against skills and experience.
- Reject an explicitly required minimum of five years or more of experience.
- Do not infer a five-year requirement when years are missing or the wording is optional or ambiguous.

## CV and AI skills
- Match job requirements against evidence actually present in the candidate profile.
- Consider relevant AI-assisted coding tools and AI/API integration experience when supported by the CV.
- Never invent candidate skills, experience, qualifications, or language proficiency.
- The word "AI" alone must not earn credit through accidental substring matching.
- Keep missing or uncertain job-extraction data visible for review rather than silently treating it as confirmed.

## Deduplication and ranking
- Deduplicate jobs before selecting the Top N for analysis.
- Normalize URLs conservatively; remove known tracking parameters but preserve meaningful query parameters.
- Do not merge distinct postings just because their titles are similar.
- Preserve existing scoring weights and thresholds unless explicitly asked to change them.

## Testing and safety
- Prefer offline unit tests and local fixtures.
- Run `npm test` and `git diff --check` when appropriate.
- Use syntax checks for relevant JavaScript files when useful.
- Do not run `npm start`, `npm run analyze:sample`, live search scripts, or commands that call external APIs unless the user explicitly authorizes them.
- Never commit, push, or publish changes without explicit user approval.
- Do not modify the candidate profile or personal data without approval.
- Do not install packages or change dependencies unless necessary and approved.

## Completion report
After making changes, report:
1. Files changed.
2. Behavior changed.
3. Tests executed and results.
4. Remaining limitations.
5. Any decision that requires user input.

Do not repeat checks that have already passed unless a new change could affect them.
name: job-search-agent
description: Work on the Job Search Agent Node.js repository. Use for job filtering, deduplication, ranking, CV matching, AI-assisted coding skills, location eligibility, bug fixes, and offline testing.
---

# Job Search Agent Workflow

## Project workflow
- Inspect only the files relevant to the current task before making changes.
- Prefer the smallest correct change over refactoring unrelated code.
- Reuse existing helpers and patterns where possible.
- Preserve existing behavior unless the task explicitly requires a change.
- Explain important assumptions and limitations.

## Job eligibility rules
- Alicante: onsite, hybrid, and remote are eligible.
- Valencia: hybrid and remote are eligible; onsite is ineligible.
- Other European countries: remote only.
- United Kingdom and United Arab Emirates: remote only.
- Unknown or ambiguous location/work mode must be flagged for review, not automatically assumed eligible.
- Do not mistake "Remote Sensing" for a remote work arrangement.
- Reject Lead, Principal, and Staff roles.
- Reject Intern and Internship roles.
- Accept Junior and Entry-level roles.
- Prioritize Mid-level roles; assess Senior roles against skills and experience.
- Reject an explicitly required minimum of five years or more of experience.
- Do not infer a five-year requirement when years are missing or the wording is optional or ambiguous.

## CV and AI skills
- Match job requirements against evidence actually present in the candidate profile.
- Consider relevant AI-assisted coding tools and AI/API integration experience when supported by the CV.
- Never invent candidate skills, experience, qualifications, or language proficiency.
- The word "AI" alone must not earn credit through accidental substring matching.
- Keep missing or uncertain job-extraction data visible for review rather than silently treating it as confirmed.

## Deduplication and ranking
- Deduplicate jobs before selecting the Top N for analysis.
- Normalize URLs conservatively; remove known tracking parameters but preserve meaningful query parameters.
- Do not merge distinct postings just because their titles are similar.
- Preserve existing scoring weights and thresholds unless explicitly asked to change them.

## Testing and safety
- Prefer offline unit tests and local fixtures.
- Run `npm test` and `git diff --check` when appropriate.
- Use syntax checks for relevant JavaScript files when useful.
- Do not run `npm start`, `npm run analyze:sample`, live search scripts, or commands that call external APIs unless the user explicitly authorizes them.
- Never commit, push, or publish changes without explicit user approval.
- Do not modify the candidate profile or personal data without approval.
- Do not install packages or change dependencies unless necessary and approved.

## Completion report
After making changes, report:
1. Files changed.
2. Behavior changed.
3. Tests executed and results.
4. Remaining limitations.
5. Any decision that requires user input.

Do not repeat checks that have already passed unless a new change could affect them.
---

<!-- Tip: Use /create-skill in chat to generate content with agent assistance -->

Define the functionality provided by this skill, including detailed instructions and examples