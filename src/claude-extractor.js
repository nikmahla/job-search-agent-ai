// Claude extractor for the Qwen-vs-Claude A/B comparison (validation only; the
// live agent keeps using Qwen).
//
// Privacy: the request is built ONLY from the public posting fields title,
// company, location and description. This module never reads the candidate
// profile and never imports the scorer.
//
// It uses the same system prompt and extraction prompt as the Qwen extractor,
// asks for schema-constrained JSON (structured outputs), and passes the result
// through the same normalizeJobProfile() as Qwen's output.
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  normalizeJobProfile
} from "./build-job-profile.js";
import { JOB_PROFILE_SCHEMA } from "./extraction-schema.js";

export const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
export const CLAUDE_API_VERSION = "2023-06-01";
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";
export const CLAUDE_TIMEOUT_MS = 60000;
// Claude Haiku 5.5 list prices per million tokens (prompts up to 100k tokens).
export const HAIKU_PRICE_PER_MTOK = { input: 0.10, output: 0.50 };

const PUBLIC_JOB_FIELDS = ["title", "company", "location", "description"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The only data that leaves the machine: public posting fields, as strings.
export function publicJobFields(rawJob = {}) {
  return Object.fromEntries(
    PUBLIC_JOB_FIELDS.map((field) => [field, typeof rawJob[field] === "string" ? rawJob[field] : ""])
  );
}

export function buildClaudeRequest(rawJob, { model = DEFAULT_CLAUDE_MODEL } = {}) {
  const job = publicJobFields(rawJob);
  // No temperature/top_p/top_k: Claude 5-generation models reject non-default
  // sampling parameters with a 400. Haiku 5.5 may think adaptively before
  // answering, so max_tokens leaves room for that plus the JSON.
  return {
    model,
    max_tokens: 16000,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildExtractionPrompt(job) }],
    output_config: { format: { type: "json_schema", schema: JOB_PROFILE_SCHEMA } }
  };
}

export function estimateClaudeCostUsd(usage = {}, price = HAIKU_PRICE_PER_MTOK) {
  const input = Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) * 0.1 +
    Number(usage.cache_creation_input_tokens ?? 0) * 1.25;
  const output = Number(usage.output_tokens ?? 0);
  return (input * price.input + output * price.output) / 1e6;
}

function claudeError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

// Returns { profile, usage, latencyMs, model, stopReason }. Throws a clear
// error (never containing the API key) on any failure.
export async function extractWithClaude(rawJob, {
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.CLAUDE_EXTRACTION_MODEL || DEFAULT_CLAUDE_MODEL,
  fetchImpl = fetch,
  timeoutMs = CLAUDE_TIMEOUT_MS,
  sleepImpl = sleep,
  maxAttempts = 2
} = {}) {
  if (!apiKey) {
    throw claudeError("ANTHROPIC_API_KEY is not set; Claude extraction was skipped.", { code: "NO_API_KEY" });
  }

  const body = JSON.stringify(buildClaudeRequest(rawJob, { model }));
  const started = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(CLAUDE_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": CLAUDE_API_VERSION
        },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      if (attempt < maxAttempts && !timedOut) {
        await sleepImpl(2000);
        continue;
      }
      throw claudeError(
        timedOut ? `Claude did not respond within ${Math.round(timeoutMs / 1000)}s` : `Claude request failed: ${error?.message ?? "network error"}`,
        { code: timedOut ? "TIMEOUT" : "NETWORK" }
      );
    }

    if (!response.ok) {
      const status = response.status;
      const retryable = status === 429 || status === 529 || status >= 500;
      if (retryable && attempt < maxAttempts) {
        const retryAfter = Number(response.headers?.get?.("retry-after"));
        await sleepImpl(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 2000);
        continue;
      }
      let detail = "";
      try {
        const errorBody = await response.json();
        const type = errorBody?.error?.type;
        // The API's own explanation (e.g. which parameter it rejected), with
        // the key redacted in case it is ever echoed back.
        const reason = String(errorBody?.error?.message ?? "").split(apiKey).join("[redacted]").slice(0, 300);
        detail = type ? ` (${type}${reason ? `: ${reason}` : ""})` : "";
      } catch {
        // Error body is optional.
      }
      throw claudeError(`Claude API error ${status}${detail}`, { code: "HTTP", status });
    }

    const data = await response.json();
    if (data.stop_reason === "refusal") {
      throw claudeError("Claude declined to extract this posting.", { code: "REFUSAL" });
    }
    if (data.stop_reason === "max_tokens") {
      throw claudeError("Claude's extraction was cut off by max_tokens.", { code: "MAX_TOKENS" });
    }
    const text = (data.content ?? []).filter((block) => block?.type === "text").map((block) => block.text).join("");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw claudeError("Claude returned output that is not valid JSON.", { code: "INVALID_JSON" });
    }

    return {
      profile: normalizeJobProfile(parsed, rawJob),
      usage: data.usage ?? {},
      latencyMs: Date.now() - started,
      model: data.model ?? model,
      stopReason: data.stop_reason ?? null
    };
  }

  throw claudeError("Claude extraction failed after retries.", { code: "RETRIES" });
}
