import "dotenv/config";
import fs from "node:fs/promises";
import { hasHybridWorkSignal } from "./job-source-rules.js";
const OLLAMA_URL =
  process.env.OLLAMA_URL ?? "http://localhost:11434/api/chat";

const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
// A local model can be slow, but a request that never returns must not hang
// the whole run: the job fails, is logged, and the run continues.
const configuredTimeout = Number(process.env.OLLAMA_TIMEOUT_MS);
export const OLLAMA_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 180000;
// ============================================================
// HELPERS
// ============================================================

function cleanJsonText(text) {
  let result = String(text).trim();

  // Remove optional Markdown code fences without regular expressions.
  if (result.startsWith("```json")) {
    result = result.slice("```json".length).trim();
  } else if (result.startsWith("```")) {
    result = result.slice("```".length).trim();
  }

  if (result.endsWith("```")) {
    result = result.slice(0, -"```".length).trim();
  }

  return result;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }

  return value
    .map((item, index) => {
      if (typeof item !== "string") {
        throw new Error(`${fieldName}[${index}] must be a string.`);
      }
      return item.trim();
    })
    .filter(Boolean);
}

function validateRequirementList(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }

  return value.map((item, index) => {
    if (typeof item === "string") {
      const name = item.trim();
      if (!name) {
        throw new Error(`${fieldName}[${index}] cannot be empty.`);
      }

      return {
        type: "skill",
        item: name,
        priority: fieldName.endsWith(".preferred") ? "preferred" : "important"
      };
    }

    if (!isObject(item)) {
      throw new Error(`${fieldName}[${index}] must be an object or string.`);
    }

    const name = stringOrEmpty(item.item);
    if (!name) {
      throw new Error(`${fieldName}[${index}].item is missing.`);
    }

    const allowedPriorities = ["critical", "important", "secondary", "preferred"];

    return {
      type: stringOrEmpty(item.type) || "skill",
      item: name,
      priority: allowedPriorities.includes(item.priority)
        ? item.priority
        : fieldName.endsWith(".preferred")
          ? "preferred"
          : "important"
    };
  });
}

function createExtractionTracker() {
  return {
    status: "complete",
    fields: {},
    warnings: []
  };
}

function markExtractionField(tracker, field, state) {
  tracker.fields[field] = state;
}

function addExtractionWarning(tracker, field, code, message) {
  tracker.status = "uncertain";
  tracker.warnings.push({ field, code, message });
}

function classifyArrayField(tracker, container, key, field) {
  if (!hasOwn(container, key)) {
    markExtractionField(tracker, field, "missing");
    addExtractionWarning(
      tracker,
      field,
      "MISSING_FIELD",
      `${field} was not returned.`
    );
    return [];
  }

  if (!Array.isArray(container[key])) {
    markExtractionField(tracker, field, "malformed");
    addExtractionWarning(
      tracker,
      field,
      "MALFORMED_FIELD",
      `${field} must be an array.`
    );
    return [];
  }

  markExtractionField(
    tracker,
    field,
    container[key].length ? "present" : "empty"
  );
  return container[key];
}

function markContainerFields(tracker, container, keys, fieldPrefix, state, code) {
  for (const key of keys) {
    const field = `${fieldPrefix}.${key}`;
    markExtractionField(tracker, field, state);
    addExtractionWarning(
      tracker,
      field,
      code,
      `${field} was not returned in the expected object.`
    );
  }
}

// ============================================================
// PROFILE VALIDATION AND NORMALIZATION
// ============================================================

export function detectLocationType(rawJob) {
  const jobText = [
    rawJob.title ?? "",
    rawJob.location ?? "",
    rawJob.description ?? ""
  ].join(" ").toLowerCase();

  const textWithoutRemoteSensing = jobText.replace(/\bremote sensing\b/gi, " ");

  const hasOnsiteEvidence =
    /\b(on[- ]?site|onsite|in[- ]person|presencial|presencialmente)\b/i.test(jobText);

  const hasHybridEvidence =
    // Shared rule: "hybrid cloud" / "hybrid apps" are not hybrid work.
    hasHybridWorkSignal(jobText) ||
    (/\b\d+\s+days?\s+(?:in|at)\s+(?:the\s+)?office\b/i.test(jobText) &&
      /\b\d+\s+days?\s+remote\b/i.test(jobText)) ||
    (/\b\d+\s+días?\s+(?:en la oficina|presencial(?:es)?)\b/i.test(jobText) &&
      /\b\d+\s+días?\s+remot[oa]s?\b/i.test(jobText));

  const hasRemoteEvidence =
    /\bremote\b/i.test(textWithoutRemoteSensing) ||
    /\bfully distributed\b/i.test(textWithoutRemoteSensing) ||
    /\bremoto\b/i.test(textWithoutRemoteSensing) ||
    /\bteletrabajo\b/i.test(textWithoutRemoteSensing);

  const hasRemoteNegation =
    /\bnot\s+(?:a\s+)?(?:fully\s+)?remote\b/i.test(jobText) ||
    /\bno\s+(?:es\s+)?(?:un\s+)?(?:puesto\s+)?remoto\b/i.test(jobText);

  const hasHybridSchedule =
    (/\b\d+\s+days?\s+(?:in|at)\s+(?:the\s+)?office\b/i.test(jobText) &&
      /\b\d+\s+days?\s+remote\b/i.test(jobText)) ||
   (/\b(?:dos|tres|cuatro|cinco|seis|dos|2|3|4|5|6)\s+días?\s+(?:en la oficina|presencial(?:es)?)\b/i.test(jobText) &&
  /\b(?:uno|una|dos|tres|cuatro|cinco|seis|1|2|3|4|5|6)\s+días?\s+(?:de trabajo )?remoto\b/i.test(jobText));

const hasOccasionalOfficeVisits =
  /\b(?:occasional|occasionally|occasional visits?|periodic|sometimes)\b.{0,60}\b(?:office|on[- ]?site)\b/i.test(jobText) ||
  /\b(?:office|on[- ]?site)\b.{0,60}\b(?:occasional|occasionally|periodic|sometimes)\b/i.test(jobText);


      if (hasRemoteNegation) {
    return "unknown";
  }

if (hasOccasionalOfficeVisits) {
  return "unknown";
}

  if (hasHybridSchedule) {
    return "hybrid";
  }

  if (hasHybridEvidence && !hasOnsiteEvidence && !hasRemoteEvidence) {
    return "hybrid";
  }

  if (hasRemoteEvidence && !hasOnsiteEvidence && !hasHybridEvidence) {
    return "remote";
  }

  if (hasOnsiteEvidence && !hasHybridEvidence && !hasRemoteEvidence) {
    return "onsite";
  }
  

  return "unknown";
}

export function normalizeJobProfile(profile, rawJob = {}) {
  if (!isObject(profile)) {
    throw new Error("Job profile must be a JSON object.");
  }

  const extraction = createExtractionTracker();
  const getSection = (key, fields) => {
    if (!hasOwn(profile, key)) {
      markContainerFields(
        extraction,
        profile,
        fields,
        key,
        "missing",
        "MISSING_FIELD"
      );
      return {};
    }

    if (!isObject(profile[key])) {
      markContainerFields(
        extraction,
        profile,
        fields,
        key,
        "malformed",
        "MALFORMED_FIELD"
      );
      return {};
    }

    return profile[key];
  };

  const job = isObject(profile.job) ? profile.job : {};
  const requirements = getSection("requirements", ["required", "preferred"]);
  const experience = getSection("experience", ["minimumYears", "requiredFunctions"]);
  const responsibilities = getSection(
    "responsibilities",
    ["core", "secondary"]
  );
  const workAuthorization = getSection(
    "workAuthorization",
    ["required", "eu"]
  );
  const location = getSection(
    "location",
    ["type", "city", "country", "remoteScope"]
  );
  const verifiedLocationType = detectLocationType(rawJob);

  let minimumYears = null;
  if (!hasOwn(experience, "minimumYears")) {
    markExtractionField(extraction, "experience.minimumYears", "missing");
    addExtractionWarning(
      extraction,
      "experience.minimumYears",
      "MISSING_FIELD",
      "experience.minimumYears was not returned."
    );
  } else if (experience.minimumYears === null) {
    markExtractionField(extraction, "experience.minimumYears", "null");
  } else if (
    typeof experience.minimumYears === "number" &&
    Number.isFinite(experience.minimumYears) &&
    experience.minimumYears >= 0
  ) {
    minimumYears = experience.minimumYears;
    markExtractionField(extraction, "experience.minimumYears", "present");
  } else {
    markExtractionField(extraction, "experience.minimumYears", "malformed");
    addExtractionWarning(
      extraction,
      "experience.minimumYears",
      "MALFORMED_FIELD",
      "experience.minimumYears must be a non-negative number or null."
    );
  }

  const allowedLocationTypes = ["remote", "hybrid", "onsite", "unknown"];
  const allowedRemoteScopes = [
    "worldwide",
    "europe",
    "eu",
    "country-specific",
    "unknown"
  ];

  const rawLanguages = classifyArrayField(
    extraction,
    profile,
    "languages",
    "languages"
  );
  const languages = [];

  rawLanguages.forEach((language, index) => {
    if (typeof language === "string") {
      const name = language.trim();
      if (name) {
        languages.push({
          language: name,
          level: null,
          required: false,
          evidence: ""
        });
        return;
      }
    } else if (isObject(language)) {
      const name = stringOrEmpty(language.language);
      if (name) {
        languages.push({
          language: name,
          level: stringOrEmpty(language.level) || null,
          required: language.required === true,
          evidence: stringOrEmpty(language.evidence)
        });
        return;
      }
    }

    addExtractionWarning(
      extraction,
      `languages[${index}]`,
      "MALFORMED_ITEM",
      "Each language must be a non-empty string or object with a language."
    );
  });

  const rawQualifications = classifyArrayField(
    extraction,
    profile,
    "qualifications",
    "qualifications"
  );
  const qualifications = [];

  rawQualifications.forEach((qualification, index) => {
    if (
      (typeof qualification === "string" && qualification.trim()) ||
      (isObject(qualification) && stringOrEmpty(qualification.item))
    ) {
      qualifications.push(qualification);
      return;
    }

    addExtractionWarning(
      extraction,
      `qualifications[${index}]`,
      "MALFORMED_ITEM",
      "Each qualification must be a non-empty string or object with an item."
    );
  });

  const normalizeRequirementField = (key) => {
    const field = `requirements.${key}`;
    const rawValue = classifyArrayField(extraction, requirements, key, field);

    if (!Array.isArray(rawValue) || !rawValue.length) {
      return [];
    }

    try {
      return validateRequirementList(rawValue, field).flatMap((requirement) => {
        const sourceText = requirement.item;
        let skills;

        if (/experience with react or another comparable javascript framework/i.test(sourceText)) {
          skills = ["React"];
        } else if (/javascript, html, and css/i.test(sourceText)) {
          skills = ["JavaScript", "HTML", "CSS"];
        } else if (/unit test and debugging skills/i.test(sourceText)) {
          skills = ["Unit Testing"];
        }

        if (!skills) return [requirement];

        return skills.map((item) => ({
          ...requirement,
          item,
          sourceText
        }));
      });
    } catch (error) {
      markExtractionField(extraction, field, "malformed");
      addExtractionWarning(
        extraction,
        field,
        "MALFORMED_ITEM",
        error.message
      );
      return [];
    }
  };

  const normalizeStringArrayField = (container, key, field) => {
    const rawValue = classifyArrayField(extraction, container, key, field);

    if (!rawValue.length) {
      return [];
    }

    try {
      return stringArray(rawValue, field);
    } catch (error) {
      markExtractionField(extraction, field, "malformed");
      addExtractionWarning(
        extraction,
        field,
        "MALFORMED_ITEM",
        error.message
      );
      return [];
    }
  };

  const requiredRequirements = normalizeRequirementField("required");
  const preferredRequirements = normalizeRequirementField("preferred");
  const requiredFunctions = normalizeStringArrayField(
    experience,
    "requiredFunctions",
    "experience.requiredFunctions"
  );
  const coreResponsibilities = normalizeStringArrayField(
    responsibilities,
    "core",
    "responsibilities.core"
  );
  const secondaryResponsibilities = normalizeStringArrayField(
    responsibilities,
    "secondary",
    "responsibilities.secondary"
  );

  const rawJobFields = {
    title: rawJob.title,
    company: rawJob.company,
    description: rawJob.description
  };
  const normalizedJob = {};

  for (const key of ["title", "company", "description"]) {
    const modelValue = stringOrEmpty(job[key]);
    const rawValue = stringOrEmpty(rawJobFields[key]);

    if (
      hasOwn(job, key) &&
      job[key] !== null &&
      typeof job[key] !== "string"
    ) {
      normalizedJob[key] = rawValue;
      markExtractionField(extraction, `job.${key}`, "malformed");
      addExtractionWarning(
        extraction,
        `job.${key}`,
        "MALFORMED_FIELD",
        `job.${key} must be a string or null.`
      );
    } else if (modelValue) {
      normalizedJob[key] = modelValue;
      markExtractionField(extraction, `job.${key}`, "present");
    } else if (rawValue) {
      normalizedJob[key] = rawValue;
      markExtractionField(extraction, `job.${key}`, "source-fallback");
    } else if (hasOwn(job, key) && job[key] === "") {
      normalizedJob[key] = "";
      markExtractionField(extraction, `job.${key}`, "empty");
    } else {
      normalizedJob[key] = "";
      markExtractionField(extraction, `job.${key}`, "missing");
      addExtractionWarning(
        extraction,
        `job.${key}`,
        "MISSING_FIELD",
        `job.${key} was not returned and no source fallback was available.`
      );
    }
  }

  const markBooleanField = (container, key, field) => {
    if (!hasOwn(container, key)) {
      markExtractionField(extraction, field, "missing");
      addExtractionWarning(
        extraction,
        field,
        "MISSING_FIELD",
        `${field} was not returned.`
      );
      return false;
    }

    if (typeof container[key] !== "boolean") {
      markExtractionField(extraction, field, "malformed");
      addExtractionWarning(
        extraction,
        field,
        "MALFORMED_FIELD",
        `${field} must be a boolean.`
      );
      return false;
    }

    markExtractionField(extraction, field, "present");
    return container[key];
  };

  const authorizationRequired = markBooleanField(
    workAuthorization,
    "required",
    "workAuthorization.required"
  );
  const authorizationEu = markBooleanField(
    workAuthorization,
    "eu",
    "workAuthorization.eu"
  );

  let locationType = verifiedLocationType;
  if (!hasOwn(location, "type")) {
    markExtractionField(extraction, "location.type", "missing");
    addExtractionWarning(
      extraction,
      "location.type",
      "MISSING_FIELD",
      "location.type was not returned."
    );
  } else if (!allowedLocationTypes.includes(location.type)) {
    markExtractionField(extraction, "location.type", "malformed");
    addExtractionWarning(
      extraction,
      "location.type",
      "MALFORMED_FIELD",
      "location.type is not an allowed value."
    );
  } else {
    markExtractionField(
      extraction,
      "location.type",
      location.type === "unknown" ? "unknown" : "present"
    );
    locationType =
      location.type === verifiedLocationType
        ? location.type
        : verifiedLocationType;
  }

  const normalizeLocationNullable = (key) => {
    const field = `location.${key}`;
    if (!hasOwn(location, key)) {
      markExtractionField(extraction, field, "missing");
      addExtractionWarning(
        extraction,
        field,
        "MISSING_FIELD",
        `${field} was not returned.`
      );
      return null;
    }

    if (location[key] === null) {
      markExtractionField(extraction, field, "null");
      return null;
    }

    if (typeof location[key] === "string") {
      const value = location[key].trim();
      markExtractionField(extraction, field, value ? "present" : "empty");
      return value || null;
    }

    markExtractionField(extraction, field, "malformed");
    addExtractionWarning(
      extraction,
      field,
      "MALFORMED_FIELD",
      `${field} must be a string or null.`
    );
    return null;
  };

  const locationCity = normalizeLocationNullable("city");
  const locationCountry = normalizeLocationNullable("country");
  let remoteScope = "unknown";

  if (!hasOwn(location, "remoteScope")) {
    markExtractionField(extraction, "location.remoteScope", "missing");
    addExtractionWarning(
      extraction,
      "location.remoteScope",
      "MISSING_FIELD",
      "location.remoteScope was not returned."
    );
  } else if (allowedRemoteScopes.includes(location.remoteScope)) {
    remoteScope = location.remoteScope;
    markExtractionField(
      extraction,
      "location.remoteScope",
      remoteScope === "unknown" ? "unknown" : "present"
    );
  } else {
    markExtractionField(extraction, "location.remoteScope", "malformed");
    addExtractionWarning(
      extraction,
      "location.remoteScope",
      "MALFORMED_FIELD",
      "location.remoteScope is not an allowed value."
    );
  }

  return {
    extraction,
    job: normalizedJob,
    requirements: {
      required: requiredRequirements,
      preferred: preferredRequirements
    },
    experience: {
      minimumYears,
      requiredFunctions
    },
    responsibilities: {
      core: coreResponsibilities,
      secondary: secondaryResponsibilities
    },
    qualifications,
    languages,
    workAuthorization: {
      required: authorizationRequired,
      eu: authorizationEu
    },
    location: {
      type: locationType,
      city: locationCity,
      country: locationCountry,
      remoteScope
    }
  };
}

// ============================================================
// OLLAMA / QWEN
// ============================================================

// Shared by every extractor (local Qwen and the Claude A/B extractor) so a
// comparison measures the model, not the prompt.
export const EXTRACTION_SYSTEM_PROMPT = [
  "You extract structured information from job postings.",
  "Return ONLY valid JSON without Markdown fences.",
  "Never invent information or requirements.",
  "Use only facts supported by the posting.",
  "Separate mandatory requirements from preferences.",
  "A phrase such as 'a plus', 'nice to have', 'desirable',",
  "'preferred' or 'bonus' is not mandatory.",
  "For languages, required must be true only when the posting",
  "clearly makes the language mandatory.",
  "If the language is preferred, required must be false.",
  "If the language level is not stated, use null.",
  "Preserve the meaning of postings in other languages.",
  "Distinguish the employer's country from the employee's",
  "permitted work location.",
  "Do not infer remote eligibility from remote collaboration.",
  "Use remoteScope unknown when the permitted region is unclear.",
  "Missing information must be null, an empty array, false,",
  "or unknown as appropriate."
].join(" ");

export function buildExtractionPrompt(rawJob) {
  return `
Extract the job posting into the exact JSON structure below.

IMPORTANT RULES:
1. Do not invent requirements.
2. Separate required skills from preferred skills.
3. Do not put a preferred skill in the required list.
4. Extract minimumYears only when a minimum is explicitly stated.
5. Extract core and secondary responsibilities separately.
6. Include only qualifications supported by the posting.
7. Preserve the meaning of the original job description.
8. Distinguish mandatory and preferred language requirements.
9. A language mentioned as a plus is not mandatory.
10. "Advanced English required" means language="English",
    level="advanced", required=true.
11. "Spanish is a plus" means language="Spanish", required=false.
12. Include short supporting evidence for language requirements.
13. Do not infer work authorization requirements merely from the
    employer's country.
14. Distinguish the employer's location from the region where an
    employee is permitted to work remotely.
15. "Remote, Europe (EU timezone)" supports remoteScope="europe".
16. "100% remoto desde España" supports remote work from Spain;
    use type="remote", remoteScope="country-specific", country="Spain".
17. A remote role in Italy does not automatically allow an employee
    based in Spain.
18. Do not infer remote work from remote collaboration.
19. If location or remote eligibility is unclear, use "unknown".
20. A city name alone does not prove that a job is onsite.
21. Use "onsite" only when the posting explicitly indicates on-site work.
22. Return ONLY valid JSON.

JSON FORMAT:
{
  "job": {
    "title": "",
    "company": "",
    "description": ""
  },
  "requirements": {
    "required": [
      {
        "type": "skill",
        "item": "",
        "priority": "critical"
      }
    ],
    "preferred": [
      {
        "type": "skill",
        "item": "",
        "priority": "preferred"
      }
    ]
  },
  "experience": {
    "minimumYears": null,
    "requiredFunctions": []
  },
  "responsibilities": {
    "core": [],
    "secondary": []
  },
  "qualifications": [],
  "languages": [
    {
      "language": "English",
      "level": "advanced",
      "required": true,
      "evidence": "Supporting wording from the posting"
    }
  ],
  "workAuthorization": {
    "required": false,
    "eu": false
  },
  "location": {
    "type": "unknown",
    "city": null,
    "country": null,
    "remoteScope": "unknown"
  }
}

Allowed location.type values: "remote", "hybrid", "onsite", "unknown".
Allowed location.remoteScope values: "worldwide", "europe", "eu",
"country-specific", "unknown".

JOB POSTING:
Title: ${rawJob.title ?? ""}
Company: ${rawJob.company ?? ""}
Location: ${rawJob.location ?? ""}
Description:
${rawJob.description ?? ""}
`;
}

export async function askQwen(prompt, { fetchImpl = fetch, timeoutMs = OLLAMA_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetchImpl(OLLAMA_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        think: false,
        messages: [
          {
            role: "system",
            content: EXTRACTION_SYSTEM_PROMPT
          },
          {
            role: "user",
            content: prompt
          }
        ],
        options: {
          temperature: 0,
          num_ctx: 8192
        }
      })
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`Ollama did not respond within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.message?.content ?? "";

  if (!content.trim()) {
    throw new Error("Ollama returned an empty response.");
  }

  return content;
}

// ============================================================
// JOB PROFILE BUILDER
// ============================================================

export async function buildJobProfile(rawJob) {
  const prompt = buildExtractionPrompt(rawJob);

 
  let parsed;
  let lastParseError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const currentPrompt =
      attempt === 1
        ? prompt
        : `${prompt}

Your previous response was not valid JSON.
Return the same job profile again as valid JSON only.
Do not use Markdown fences, comments, or trailing commas.
Do not omit any required top-level fields.`;

    const rawResponse = await askQwen(currentPrompt);
    const cleaned = cleanJsonText(rawResponse);

    try {
      parsed = JSON.parse(cleaned);
      break;
    } catch (error) {
      lastParseError = error;
      console.error(
        `Qwen returned invalid JSON (attempt ${attempt}/2).`
      );

      if (attempt === 2) {
        console.error(rawResponse);
      }
    }
  }

  if (!parsed) {
    throw new Error("Failed to parse Qwen job profile JSON.", {
      cause: lastParseError
    });
  }


  try {
    return normalizeJobProfile(parsed, rawJob);
  } catch (error) {
    console.error("Qwen JSON did not match the expected schema:", error.message);
    throw error;
  }
}

// ============================================================
// TEST MODE
// ============================================================

if (
  process.argv[1] &&
  process.argv[1].endsWith("build-job-profile.js")
) {
  const rawJob = {
    title: "Senior Frontend Engineer (React / TypeScript)",
    company: "Blue Code",
    location: "Valencia",
    description: `
We are looking for a Senior Frontend Engineer
with strong experience in React and TypeScript.

Requirements:
- 3+ years of frontend development experience
- Strong React experience
- TypeScript
- JavaScript
- REST APIs
- Git

Nice to have:
- Next.js
- Testing experience

Responsibilities:
- Develop frontend applications
- Build reusable UI components
- Work with APIs
- Participate in code reviews
- Collaborate with an Agile development team

Spanish is a plus.
`
  };

  try {
    console.log("\nBuilding job profile with Qwen...\n");
    const profile = await buildJobProfile(rawJob);

    await fs.mkdir("./data", { recursive: true });
    await fs.writeFile(
      "./data/test-job-profile.json",
      JSON.stringify(profile, null, 2),
      "utf-8"
    );

    console.log(JSON.stringify(profile, null, 2));
    console.log("\nJob profile saved to ./data/test-job-profile.json");
  } catch (error) {
    console.error("\nFailed to build job profile:");
    console.error(error.message);
    process.exitCode = 1;
  }
}
