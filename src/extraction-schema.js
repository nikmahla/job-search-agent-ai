// JSON schema of the job profile that normalizeJobProfile() expects, for
// extractors that support schema-constrained output (Claude structured
// outputs). It mirrors the JSON template in buildExtractionPrompt().
//
// Structured-output rules followed here: every object has
// additionalProperties: false and lists all its properties as required; no
// numeric/string length constraints; nullable fields use ["type", "null"].

const stringArray = { type: "array", items: { type: "string" } };

const requirementItem = {
  type: "object",
  additionalProperties: false,
  required: ["type", "item", "priority"],
  properties: {
    type: { type: "string" },
    item: { type: "string" },
    priority: { type: "string", enum: ["critical", "important", "secondary", "preferred"] }
  }
};

export const JOB_PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "job", "requirements", "experience", "responsibilities", "qualifications",
    "languages", "workAuthorization", "location"
  ],
  properties: {
    job: {
      type: "object",
      additionalProperties: false,
      required: ["title", "company", "description"],
      properties: {
        title: { type: "string" },
        company: { type: "string" },
        description: { type: "string" }
      }
    },
    requirements: {
      type: "object",
      additionalProperties: false,
      required: ["required", "preferred"],
      properties: {
        required: { type: "array", items: requirementItem },
        preferred: { type: "array", items: requirementItem }
      }
    },
    experience: {
      type: "object",
      additionalProperties: false,
      required: ["minimumYears", "requiredFunctions"],
      properties: {
        minimumYears: { type: ["number", "null"] },
        requiredFunctions: stringArray
      }
    },
    responsibilities: {
      type: "object",
      additionalProperties: false,
      required: ["core", "secondary"],
      properties: {
        core: stringArray,
        secondary: stringArray
      }
    },
    qualifications: stringArray,
    languages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["language", "level", "required", "evidence"],
        properties: {
          language: { type: "string" },
          level: { type: ["string", "null"] },
          required: { type: "boolean" },
          evidence: { type: "string" }
        }
      }
    },
    workAuthorization: {
      type: "object",
      additionalProperties: false,
      required: ["required", "eu"],
      properties: {
        required: { type: "boolean" },
        eu: { type: "boolean" }
      }
    },
    location: {
      type: "object",
      additionalProperties: false,
      required: ["type", "city", "country", "remoteScope"],
      properties: {
        type: { type: "string", enum: ["remote", "hybrid", "onsite", "unknown"] },
        city: { type: ["string", "null"] },
        country: { type: ["string", "null"] },
        remoteScope: { type: "string", enum: ["worldwide", "europe", "eu", "country-specific", "unknown"] }
      }
    }
  }
};
