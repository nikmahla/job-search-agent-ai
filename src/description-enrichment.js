// Bounded enrichment of truncated Adzuna descriptions for shortlisted jobs.
// At most one GET per job, sequential, no retries. Any failure keeps the original
// description; a job is never dropped because enrichment failed.
export const ENRICHMENT_LIMITS = {
  timeoutMs: 12000,
  maxBytes: 500 * 1024,
  maxShortDescription: 500,
  minEnrichedLength: 1000
};

const JOB_TERMS = [
  "responsibilit", "requirement", "experience", "skills", "qualification", "you will", "we offer", "about the role",
  "responsabilidades", "requisitos", "experiencia", "funciones", "ofrecemos", "conocimientos",
  "responsabilita", "requisiti", "esperienza", "competenze", "offriamo",
  "aufgaben", "anforderungen", "erfahrung", "kenntnisse",
  "exigences", "competences", "vous serez", "nous offrons"
];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

export function htmlToText(html = "") {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|nav|header|footer|aside|noscript|form)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findJobPostings(value, found = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => findJobPostings(item, found));
  } else if (value && typeof value === "object") {
    const type = value["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) found.push(value);
    findJobPostings(value["@graph"], found);
  }
  return found;
}

// Returns candidate description text from an identifiable source only.
// Never falls back to the whole page body.
export function extractDescriptionCandidate(html = "") {
  const page = String(html);

  for (const match of page.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      for (const posting of findJobPostings(JSON.parse(match[1].trim()))) {
        if (typeof posting.description === "string" && posting.description.trim()) {
          return { text: htmlToText(posting.description), method: "json-ld" };
        }
      }
    } catch {
      // Malformed JSON-LD is ignored; other markers are tried next.
    }
  }

  const section = page.match(
    /<(section|div|article)\b[^>]*(?:itemprop=["']description["']|(?:class|id)=["'][^"']*(?:job[-_ ]?description|jobdescription|adp-body)[^"']*["'])[^>]*>([\s\S]*?)<\/\1>/i
  );
  if (section) return { text: htmlToText(section[2]), method: "description-section" };

  return null;
}

export function looksLikeJobDescription(text, title = "") {
  const lower = String(text).toLowerCase();
  const hits = JOB_TERMS.filter((term) => lower.includes(term)).length;
  const titleWords = String(title).toLowerCase().split(/[^a-z0-9.+#]+/).filter((word) => word.length > 3);
  const mentionsRole = titleWords.length === 0 || titleWords.some((word) => lower.includes(word));
  return hits >= 2 && mentionsRole;
}

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel?.();
        return { tooLarge: true };
      }
      chunks.push(value);
    }
    return { text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8") };
  }

  const text = await response.text();
  return Buffer.byteLength(text, "utf8") > maxBytes ? { tooLarge: true } : { text };
}

export function getEnrichmentUrl(job) {
  const refs = Array.isArray(job?.sourceInfoList) && job.sourceInfoList.length
    ? job.sourceInfoList
    : [{ source: job?.source, url: job?.url }];
  // Only one GET per job: the first usable Adzuna URL is the single attempt.
  return refs.find((ref) => ref?.source === "adzuna" && typeof ref.url === "string" && /^https?:\/\//i.test(ref.url))?.url ?? null;
}

export function needsEnrichment(job) {
  return job?.source === "adzuna" &&
    String(job.description ?? "").length <= ENRICHMENT_LIMITS.maxShortDescription &&
    getEnrichmentUrl(job) !== null;
}

export function getEnrichmentDiagnostics(job) {
  return {
    descriptionEnriched: typeof job?.descriptionEnriched === "boolean" ? job.descriptionEnriched : null,
    descriptionEnrichmentReason: typeof job?.descriptionEnrichmentReason === "string"
      ? job.descriptionEnrichmentReason
      : null
  };
}

function failed(job, reason) {
  return { ...job, descriptionEnriched: false, descriptionEnrichmentReason: reason };
}

export async function enrichJobDescription(job, { fetchImpl = fetch, limits = ENRICHMENT_LIMITS } = {}) {
  const url = getEnrichmentUrl(job);
  if (!url) return failed(job, "no-url");

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(limits.timeoutMs),
      headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; job-search-agent)" }
    });

    if (!response.ok) return failed(job, `http-${response.status}`);
    const contentType = String(response.headers?.get?.("content-type") ?? "");
    if (contentType && !/html/i.test(contentType)) return failed(job, "not-html");

    const body = await readCapped(response, limits.maxBytes);
    if (body.tooLarge) return failed(job, "response-too-large");

    const candidate = extractDescriptionCandidate(body.text);
    if (!candidate) return failed(job, "no-description-section");
    if (candidate.text.length < limits.minEnrichedLength) return failed(job, "text-too-short");
    if (candidate.text.length <= String(job.description ?? "").length) return failed(job, "not-longer");
    if (!looksLikeJobDescription(candidate.text, job.title)) return failed(job, "not-job-related");

    return {
      ...job,
      shortDescription: job.description ?? "",
      description: candidate.text,
      descriptionEnriched: true,
      descriptionEnrichmentReason: candidate.method
    };
  } catch (error) {
    return failed(job, error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "fetch-failed");
  }
}

// Sequential, one GET per eligible job, so requests never exceed the job count.
export async function enrichShortlistedJobs(jobs = [], { fetchImpl = fetch, delayMs = 1000, limits = ENRICHMENT_LIMITS } = {}) {
  const result = [];
  let requests = 0;
  for (const job of jobs) {
    if (!needsEnrichment(job)) {
      result.push(job);
      continue;
    }
    if (requests > 0 && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    requests += 1;
    result.push(await enrichJobDescription(job, { fetchImpl, limits }));
  }
  return result;
}
