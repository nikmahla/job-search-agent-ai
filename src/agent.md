# Job Search Agent — Engineering Rules for Codex

## 1. Documentation First
- Before making any change, inspect the repository documentation, `AGENTS.md` if present, `README.md`, `package.json`, relevant source files, and existing tests.
- Follow the project's documented architecture, conventions, constraints, and intended behavior.
- If documentation is missing, contradictory, or insufficient, identify the gap and ask for clarification when it materially affects the implementation.
- Do not invent project requirements or silently change established behavior.

## 2. Understand Before Changing
- Trace the complete execution path affected by the proposed change.
- Inspect callers, callees, data schemas, configuration, environment variables, error handling, and dependent modules.
- Identify assumptions, edge cases, failure modes, backward compatibility concerns, and possible side effects.
- Distinguish confirmed facts from hypotheses.

## 3. Research When Necessary
- When a change depends on external APIs, Node.js behavior, library behavior, security, or current documentation, consult authoritative and up-to-date sources.
- Prefer official documentation and primary sources.
- Do not browse unnecessarily for straightforward changes fully explained by the repository.
- Clearly distinguish external documentation from conclusions derived from this codebase.

## 4. Consider Relevant Scenarios
For each change, consider applicable cases such as:
- Normal and boundary inputs
- Missing, null, empty, malformed, or unexpected data
- Network failures, timeouts, rate limits, and retries
- Partial failures and recovery behavior
- Duplicate jobs and inconsistent source data
- Existing functionality and backward compatibility
- Security, privacy, secrets, and personal CV data
- File writes, overwrites, and Git tracking
- Performance and unnecessary API/model calls

Do not add unnecessary complexity for scenarios that are irrelevant to the change.

## 5. Tests and Verification
- Inspect existing tests and add or update focused tests when appropriate.
- Run the relevant tests and report the actual results.
- Do not claim a test passed unless it was executed successfully.
- For scoring or filtering changes, test both positive and negative cases, boundary conditions, missing data, and regressions.
- Never change a test merely to make an implementation appear correct.

## 6. Minimal and Controlled Changes
- Make the smallest change that correctly addresses the demonstrated problem.
- Do not refactor unrelated code, add features, change thresholds, or alter architecture without explicit approval.
- Preserve existing user changes.
- Do not install packages, change configuration, run the full agent, overwrite job results, or make live external requests without approval when those actions have meaningful side effects.
- Never commit or push to GitHub unless explicitly requested.

## 7. Review Before Implementation
Before editing:
1. Explain the confirmed problem and supporting evidence.
2. Describe the proposed solution and why it fits the existing design.
3. Identify relevant risks and alternatives.
4. Show the proposed diff or a precise change plan.
5. Wait for approval when the change affects behavior, data, configuration, dependencies, or external services.

## 8. After Implementation
- Show the actual diff.
- Explain what changed and what did not change.
- Report tests executed, results, and remaining uncertainties.
- Check Git status and identify every changed file.
- Stop and wait for the next instruction.

## 9. Data Integrity
- Treat candidate CVs, personal information, API keys, and environment variables as sensitive.
- Never print or commit secrets or private candidate data.
- Keep local data and debugging artifacts out of Git unless explicitly approved.
- Do not misrepresent missing information as a confirmed match.
- Preserve conservative job eligibility decisions unless an evidence-based change is explicitly approved.

## 10. Communication
- Work in small, reviewable steps.
- Ask only necessary clarifying questions.
- Separate facts, hypotheses, recommendations, and verified results.
- Do not proceed beyond the approved scope.