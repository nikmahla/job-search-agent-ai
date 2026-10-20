// Twelve synthetic analysed jobs. Companies, postings and URLs are invented
// (example.com is a reserved domain). The numbers follow the real scorer:
//  - jobFitScore is the weighted mean of the breakdown parts, skipping nulls
//    (src/job-scorer.js calculateWeightedScore: 30/20/20/15/15);
//  - the decision follows src/job-scorer.js decideJob(): any FAIL gate -> SKIP,
//    fit < 60 -> SKIP, 60-75 or any gate not PASS or < 50% required coverage or an
//    incomplete extraction -> MAYBE, otherwise APPLY.
import {
  BREAKDOWN_KEYS,
  BREAKDOWN_WEIGHTS,
  GATE_LABELS,
  GATE_KEYS,
  jobResultSchema,
  type Breakdown,
  type CoverageRow,
  type CoverageStatus,
  type Decision,
  type GateStatus,
  type Gates,
  type JobResult,
  type RequirementMatch
} from "@/lib/schema";

const REQUIRED_COVERAGE_FOR_APPLY = 50;

// Profile evidence strings, in the format requirement-coverage.js quotes them.
const EV: Record<string, string> = {
  React: 'skills.primary: "React"',
  "Next.js": 'skills.primary: "Next.js"',
  TypeScript: 'skills.primary: "TypeScript"',
  JavaScript: 'skills.primary: "JavaScript"',
  HTML: 'skills.secondary: "HTML"',
  CSS: 'skills.secondary: "CSS"',
  "Redux Toolkit": 'skills.secondary: "Redux Toolkit"',
  Zustand: 'skills.secondary: "Zustand"',
  "React Query": 'skills.secondary: "React Query"',
  "REST APIs": 'skills.secondary: "REST APIs"',
  JWT: 'skills.secondary: "JWT Authentication"',
  Tailwind: 'skills.secondary: "Tailwind CSS"',
  Vitest: 'skills.testing: "Vitest"',
  RTL: 'skills.testing: "React Testing Library"',
  Git: 'skills.tools: "Git"',
  Vercel: 'skills.tools: "Vercel"',
  Agile: 'skills.practices: "Agile"',
  A11y: 'skills.practices: "Accessibility"',
  Review: 'experience: Frontend Developer @ Sample Studio: "Code review"',
  Perf: 'experience: Frontend Developer @ Sample Studio: "Performance optimization"',
  Years: "candidate.experienceYears: 4",
  EN: "candidate.languages: \"English C1\"",
  ES: "candidate.languages: \"Spanish B1\""
};
const ev = (...keys: string[]) => keys.map((key) => EV[key] ?? key);

type Req = {
  text: string;
  kind: "Required" | "Preferred";
  status: CoverageStatus;
  evidence?: string[];
  matched?: string[];
  missing?: string[];
  note?: string;
};
const req = (text: string, kind: Req["kind"], status: CoverageStatus, extra: Partial<Req> = {}): Req => ({ text, kind, status, ...extra });

type GateSpec = Partial<Record<keyof Gates, [GateStatus, string]>>;
const GATE_DEFAULTS: Record<keyof Gates, [GateStatus, string]> = {
  roleFit: ["PASS", "Title aligns with the frontend/React/Next.js target."],
  experience: ["PASS", "No explicit minimum of 5 or more years."],
  language: ["PASS", "Language requirements are compatible."],
  workAuthorization: ["PASS", "No work-authorization requirement is stated and the candidate has EU work authorization."],
  location: ["PASS", "Location is eligible."]
};

type Spec = {
  slug: string;
  title: string;
  company: string;
  location: string;
  source: "adzuna" | "himalayas" | "freehire";
  searchMode: "local" | "remote";
  remote: boolean;
  hybrid: boolean;
  created: string;
  breakdown: Omit<Breakdown, "scoringCoverage"> & { scoringCoverage: number };
  gates?: GateSpec;
  reqs: Req[];
  keywords: string[];
  excerpt: string;
  extraction?: "complete" | "uncertain";
  warnings?: string[];
};

function weightedFit(breakdown: Breakdown): number | null {
  let total = 0;
  let weight = 0;
  for (const key of BREAKDOWN_KEYS) {
    const value = breakdown[key];
    if (value === null) continue;
    total += value * BREAKDOWN_WEIGHTS[key];
    weight += BREAKDOWN_WEIGHTS[key];
  }
  return weight ? Math.round((total / weight) * 10) / 10 : null;
}

function requiredCoverage(reqs: Req[]): { score: number | null; count: number } {
  const required = reqs.filter((r) => r.kind === "Required" && r.status !== "UNKNOWN");
  if (!required.length) return { score: null, count: 0 };
  const points = required.reduce((sum, r) => sum + (r.status === "MATCH" ? 1 : r.status === "PARTIAL" ? 0.5 : 0), 0);
  return { score: (points / required.length) * 100, count: required.length };
}

function decide(fit: number | null, gates: Gates, coverage: { score: number | null; count: number }, extraction: string) {
  const reasons: string[] = [];
  const failed = GATE_KEYS.filter((key) => gates[key].status === "FAIL");
  if (failed.length) {
    return { decision: "SKIP" as Decision, reasons: failed.map((key) => `${GATE_LABELS[key]} gate failed: ${gates[key].note}`) };
  }
  if (coverage.score === 0 && coverage.count >= 2) {
    return { decision: "SKIP" as Decision, reasons: [`None of the ${coverage.count} required technical skills is supported by the profile.`] };
  }
  if (fit === null) return { decision: "MAYBE" as Decision, reasons: ["Too little extracted evidence to compute a job-fit score; review manually."] };
  if (fit < 60) return { decision: "SKIP" as Decision, reasons: [`Job fit ${fit.toFixed(1)} is below 60.`] };
  if (fit < 75) reasons.push(`Job fit ${fit.toFixed(1)} is between 60 and 75.`);
  if (coverage.score !== null && coverage.score < REQUIRED_COVERAGE_FOR_APPLY) {
    reasons.push(`Only ${Math.round(coverage.score)}% of the required technical skills are covered (APPLY needs ${REQUIRED_COVERAGE_FOR_APPLY}%).`);
  }
  for (const key of GATE_KEYS) {
    if (gates[key].status !== "PASS") reasons.push(`${GATE_LABELS[key]} needs review (${gates[key].status}): ${gates[key].note}`);
  }
  if (extraction !== "complete") reasons.push("Job extraction was incomplete or uncertain.");
  if (reasons.length) return { decision: "MAYBE" as Decision, reasons };
  return { decision: "APPLY" as Decision, reasons: [`Job fit ${fit.toFixed(1)} with every eligibility gate confirmed and the required skills covered.`] };
}

function build(spec: Spec): JobResult {
  const gates = Object.fromEntries(
    GATE_KEYS.map((key) => {
      const [status, note] = spec.gates?.[key] ?? GATE_DEFAULTS[key];
      return [key, { status, note }];
    })
  ) as Gates;
  const fit = weightedFit(spec.breakdown);
  const extraction = spec.extraction ?? "complete";
  const { decision, reasons } = decide(fit, gates, requiredCoverage(spec.reqs), extraction);

  const coverage: CoverageRow[] = spec.reqs.map((r) => ({
    requirement: r.text,
    kind: r.kind,
    status: r.status,
    evidence: r.status === "GAP" ? [] : r.evidence ?? [],
    note: r.note ?? ""
  }));
  const requirementMatches: RequirementMatch[] = spec.reqs
    .filter((r) => r.status !== "UNKNOWN")
    .map((r) => ({
      item: r.text,
      required: r.kind === "Required",
      priority: r.kind === "Required" ? "critical" : "preferred",
      status: r.status === "MATCH" ? "SEMANTIC" : r.status === "PARTIAL" ? "PARTIAL" : "MISSING",
      score: r.status === "MATCH" ? 1 : r.status === "PARTIAL" ? 0.5 : 0,
      matched: r.matched ?? [],
      missing: r.status === "MATCH" ? [] : r.missing ?? [r.text],
      method: "sentence"
    }));
  const missingOf = (kind: "Required" | "Preferred") =>
    spec.reqs.filter((r) => r.kind === kind && r.status === "GAP").map((r) => r.text);

  const job: JobResult = {
    stateKey: `url:example.com/jobs/${spec.slug}`,
    title: spec.title,
    company: spec.company,
    jobFitScore: fit,
    atsScore: Math.round(spec.keywords.length * 7.5 * 10) / 10,
    scoringCoverage: spec.breakdown.scoringCoverage,
    decision,
    decisionReasons: reasons,
    gates,
    breakdown: spec.breakdown,
    ats: {
      score: Math.round(spec.keywords.length * 7.5 * 10) / 10,
      keywordScore: Math.round(spec.keywords.length * 6.2 * 10) / 10,
      titleScore: spec.title.toLowerCase().includes("react") ? 90 : 70,
      matchedKeywords: spec.keywords
    },
    missingRequiredSkills: missingOf("Required"),
    missingPreferredSkills: missingOf("Preferred"),
    requirementMatches,
    extraction: { status: extraction, warnings: spec.warnings ?? [] },
    availability: { active: true, status: "active", reason: "http-200" },
    sourceInfo: {
      id: `${spec.source}:${spec.slug}`,
      url: `https://example.com/jobs/${spec.slug}`,
      source: spec.source,
      sources: [spec.source],
      sourceAttribution: spec.source === "freehire" ? "FreeHire (demo)" : spec.source === "himalayas" ? "Himalayas (demo)" : null,
      location: spec.location,
      sourceCountry: spec.searchMode === "local" ? "es" : "remote",
      searchMode: spec.searchMode,
      remote: spec.remote,
      hybrid: spec.hybrid,
      created: spec.created
    },
    coverage,
    excerpt: spec.excerpt
  };
  return jobResultSchema.parse(job);
}

const specs: Spec[] = [
  {
    slug: "frontend-engineer-react-valencia",
    title: "Frontend Engineer (React & Next.js)",
    company: "Marlow & Finch Digital",
    location: "Valencia, Spain (hybrid)",
    source: "adzuna",
    searchMode: "local",
    remote: false,
    hybrid: true,
    created: "2026-10-15",
    breakdown: { technical: 88, experience: 85, responsibilities: 82, qualifications: 70, career: 92, scoringCoverage: 90 },
    gates: { location: ["PASS", "Hybrid role in Valencia: eligible."] },
    reqs: [
      req("Strong experience with React and TypeScript", "Required", "MATCH", { evidence: ev("React", "TypeScript") }),
      req("Next.js (App Router) in production", "Required", "MATCH", { evidence: ev("Next.js") }),
      req("State management (Redux Toolkit, Zustand or similar)", "Required", "MATCH", { evidence: ev("Redux Toolkit", "Zustand") }),
      req("Component testing with Vitest or Jest", "Required", "MATCH", { evidence: ev("Vitest", "RTL") }),
      req("Accessible, responsive interfaces (WCAG)", "Preferred", "MATCH", { evidence: ev("A11y", "CSS") }),
      req("Experience with design systems and Storybook", "Preferred", "PARTIAL", { evidence: ev("Tailwind"), missing: ["Storybook"] }),
      req("Fluent English; Spanish is a plus", "Preferred", "MATCH", { evidence: ev("EN", "ES") })
    ],
    keywords: ["react", "next.js", "typescript", "redux toolkit", "zustand", "vitest", "accessibility"],
    excerpt: "Join a product team in Valencia building a booking platform. Hybrid, three days in the office. You will own features end to end with React, Next.js and TypeScript."
  },
  {
    slug: "react-developer-remote-spain",
    title: "React Developer",
    company: "Pinewood Commerce",
    location: "Remote — Spain",
    source: "himalayas",
    searchMode: "remote",
    remote: true,
    hybrid: false,
    created: "2026-10-16",
    breakdown: { technical: 80, experience: 78, responsibilities: 75, qualifications: null, career: 85, scoringCoverage: 85 },
    gates: { location: ["PASS", "Posting explicitly permits remote work from Spain."] },
    reqs: [
      req("Production experience with React", "Required", "MATCH", { evidence: ev("React") }),
      req("TypeScript and modern JavaScript", "Required", "MATCH", { evidence: ev("TypeScript", "JavaScript") }),
      req("Consuming REST APIs and handling auth (JWT)", "Required", "MATCH", { evidence: ev("REST APIs", "JWT") }),
      req("Server state with React Query", "Preferred", "MATCH", { evidence: ev("React Query") }),
      req("Basic CI/CD familiarity", "Preferred", "PARTIAL", { evidence: ev("Git", "Vercel"), missing: ["CI/CD pipelines"] }),
      req("Comfortable working asynchronously across time zones", "Preferred", "UNKNOWN", { note: "Soft skill: the pipeline cannot assess this; judge from your own experience." })
    ],
    keywords: ["react", "typescript", "javascript", "rest apis", "jwt", "react query"],
    excerpt: "We are a small e-commerce team looking for a React developer to improve checkout and account flows. Fully remote from Spain, async-first."
  },
  {
    slug: "frontend-developer-nextjs-europe",
    title: "Frontend Developer (Next.js)",
    company: "Kestrel Labs",
    location: "Remote — Europe",
    source: "freehire",
    searchMode: "remote",
    remote: true,
    hybrid: false,
    created: "2026-10-12",
    breakdown: { technical: 82, experience: 74, responsibilities: 70, qualifications: null, career: 80, scoringCoverage: 80 },
    gates: { location: ["FLAG", "Remote work is indicated, but the posting does not confirm that applicants based in Spain are eligible."] },
    reqs: [
      req("Next.js and React in production", "Required", "MATCH", { evidence: ev("Next.js", "React") }),
      req("TypeScript", "Required", "MATCH", { evidence: ev("TypeScript") }),
      req("Server-side rendering and caching strategies", "Required", "MATCH", { evidence: ev("Perf", "Next.js") }),
      req("GraphQL clients (Apollo or urql)", "Preferred", "GAP"),
      req("Experience with headless CMS", "Preferred", "GAP")
    ],
    keywords: ["next.js", "react", "typescript", "ssr"],
    excerpt: "Kestrel builds analytics dashboards. We are hiring a frontend developer anywhere in Europe to work on the Next.js customer app."
  },
  {
    slug: "fullstack-react-node-uk",
    title: "Full-Stack Engineer (React / Node.js)",
    company: "Brightwater Systems",
    location: "Remote — United Kingdom",
    source: "freehire",
    searchMode: "remote",
    remote: true,
    hybrid: false,
    created: "2026-10-09",
    breakdown: { technical: 52, experience: 70, responsibilities: 66, qualifications: null, career: 78, scoringCoverage: 80 },
    gates: { location: ["FLAG", "Remote role listed in the UK; confirm applicants based in Spain can be hired."] },
    reqs: [
      req("React and TypeScript on the frontend", "Required", "MATCH", { evidence: ev("React", "TypeScript") }),
      req("Node.js services and REST API design", "Required", "PARTIAL", { evidence: ev("REST APIs", "JWT"), missing: ["Node.js"], note: "API and auth work is not evidence of Node.js itself." }),
      req("PostgreSQL schema design", "Required", "GAP"),
      req("Automated testing (Jest, Playwright)", "Required", "PARTIAL", { evidence: ev("Vitest", "RTL"), missing: ["Playwright"] }),
      req("Docker and basic deployment", "Preferred", "GAP")
    ],
    keywords: ["react", "typescript", "rest apis"],
    excerpt: "A product team of eight is looking for a full-stack engineer to build customer-facing React interfaces and Node.js services."
  },
  {
    slug: "frontend-engineer-design-systems",
    title: "Frontend Engineer — Design Systems",
    company: "Orchard Type",
    location: "Remote — Europe",
    source: "himalayas",
    searchMode: "remote",
    remote: true,
    hybrid: false,
    created: "2026-10-13",
    breakdown: { technical: 76, experience: 72, responsibilities: 68, qualifications: null, career: 74, scoringCoverage: 75 },
    gates: { location: ["PASS", "Posting explicitly permits remote work from Europe."] },
    reqs: [
      req("Component libraries in React", "Required", "MATCH", { evidence: ev("React", "Tailwind") }),
      req("Accessibility (WCAG 2.1 AA)", "Required", "MATCH", { evidence: ev("A11y") }),
      req("Storybook and visual regression testing", "Required", "GAP"),
      req("CSS architecture and design tokens", "Preferred", "PARTIAL", { evidence: ev("CSS", "Tailwind"), missing: ["design tokens"] })
    ],
    keywords: ["react", "accessibility", "css", "tailwind"],
    excerpt: "Help us grow a design system used by six teams. You will pair with designers and keep the component library accessible and well documented."
  },
  {
    slug: "senior-react-developer-uk",
    title: "Senior React Developer",
    company: "Larkspur Analytics",
    location: "Remote — United Kingdom",
    source: "freehire",
    searchMode: "remote",
    remote: true,
    hybrid: false,
    created: "2026-10-07",
    breakdown: { technical: 70, experience: 58, responsibilities: 64, qualifications: null, career: 66, scoringCoverage: 70 },
    gates: { location: ["FLAG", "Remote role listed in the UK; confirm applicants based in Spain can be hired."] },
    reqs: [
      req("React performance tuning", "Required", "MATCH", { evidence: ev("React", "Perf") }),
      req("Leading small feature teams", "Required", "UNKNOWN", { note: "Leadership scope is not assessed automatically." }),
      req("Data visualisation (D3 or similar)", "Preferred", "GAP"),
      req("TypeScript", "Required", "MATCH", { evidence: ev("TypeScript") })
    ],
    keywords: ["react", "typescript"],
    excerpt: "Senior role for an analytics product. Senior titles are assessed against skills and experience rather than rejected outright."
  },
  {
    slug: "fullstack-react-dotnet-birmingham",
    title: "Full Stack Developer (React & C# .NET)",
    company: "Tessera Group",
    location: "Birmingham, United Kingdom (remote option)",
    source: "adzuna",
    searchMode: "remote",
    remote: true,
    hybrid: false,
    created: "2026-10-02",
    breakdown: { technical: 38, experience: 60, responsibilities: 44, qualifications: null, career: 50, scoringCoverage: 80 },
    gates: { location: ["FLAG", "Remote role listed in the UK; confirm applicants based in Spain can be hired."] },
    reqs: [
      req("C# and .NET 8 services", "Required", "GAP"),
      req("SQL Server and Entity Framework", "Required", "GAP"),
      req("React on the frontend", "Required", "MATCH", { evidence: ev("React") }),
      req("Azure DevOps pipelines", "Preferred", "GAP")
    ],
    keywords: ["react"],
    excerpt: "Contract role building internal tooling with .NET back-end services and a React frontend. Initial three-month engagement."
  },
  {
    slug: "frontend-developer-react-6-years",
    title: "Frontend Developer (React)",
    company: "Northgate Retail",
    location: "Remote — Europe",
    source: "himalayas",
    searchMode: "remote",
    remote: true,
    hybrid: false,
    created: "2026-10-05",
    breakdown: { technical: 78, experience: null, responsibilities: 70, qualifications: null, career: 72, scoringCoverage: 70 },
    gates: { experience: ["FAIL", "The posting requires at least 6 years of experience; the profile shows 4."] },
    reqs: [
      req("React and TypeScript", "Required", "MATCH", { evidence: ev("React", "TypeScript") }),
      req("6+ years of frontend experience", "Required", "GAP", { note: "2 year(s) short of the stated minimum" }),
      req("Micro-frontend architecture", "Preferred", "GAP")
    ],
    keywords: ["react", "typescript"],
    excerpt: "We need a seasoned frontend developer with at least six years of professional experience to take over our storefront."
  },
  {
    slug: "frontend-engineer-worldwide-remote",
    title: "Frontend Software Engineer (100% remote — worldwide)",
    company: "Quillstream",
    location: "Remote — Worldwide",
    source: "himalayas",
    searchMode: "remote",
    remote: true,
    hybrid: false,
    created: "2026-10-14",
    breakdown: { technical: 72, experience: 70, responsibilities: 66, qualifications: null, career: 70, scoringCoverage: 75 },
    gates: { location: ["FLAG", "Worldwide remote is stated, but the posting does not confirm that applicants based in Spain can be hired."] },
    reqs: [
      req("React or Vue in production", "Required", "MATCH", { evidence: ev("React") }),
      req("TypeScript", "Required", "MATCH", { evidence: ev("TypeScript") }),
      req("Real-time features (WebSockets)", "Preferred", "GAP"),
      req("Overlap with US East working hours", "Preferred", "UNKNOWN", { note: "Time-zone expectations are not assessed automatically." })
    ],
    keywords: ["react", "typescript"],
    excerpt: "A distributed team building a collaboration tool. Work from anywhere; some overlap with US East hours is helpful."
  },
  {
    slug: "junior-frontend-developer-alicante",
    title: "Junior Frontend Developer (React)",
    company: "Costa Pixel Studio",
    location: "Alicante, Spain (onsite)",
    source: "adzuna",
    searchMode: "local",
    remote: false,
    hybrid: false,
    created: "2026-10-16",
    breakdown: { technical: 84, experience: 82, responsibilities: 74, qualifications: 68, career: 76, scoringCoverage: 90 },
    gates: { location: ["PASS", "Onsite role in Alicante: eligible."] },
    reqs: [
      req("React fundamentals and hooks", "Required", "MATCH", { evidence: ev("React") }),
      req("HTML, CSS and responsive layouts", "Required", "MATCH", { evidence: ev("HTML", "CSS") }),
      req("Git workflow and pull requests", "Required", "MATCH", { evidence: ev("Git", "Review") }),
      req("Spanish at conversational level", "Required", "MATCH", { evidence: ev("ES") }),
      req("Interest in animation and creative coding", "Preferred", "UNKNOWN", { note: "Interest is not assessed automatically." })
    ],
    keywords: ["react", "html", "css", "git"],
    excerpt: "A creative studio on the Alicante coast is hiring a junior frontend developer to build marketing sites and interactive campaigns."
  },
  {
    slug: "frontend-developer-madrid-remote",
    title: "Frontend Developer (React)",
    company: "Nuevo Norte",
    location: "Madrid, Spain (remote)",
    source: "adzuna",
    searchMode: "remote",
    remote: true,
    hybrid: false,
    created: "2026-10-11",
    breakdown: { technical: 72, experience: 68, responsibilities: 70, qualifications: null, career: 78, scoringCoverage: 75 },
    gates: { location: ["FLAG", "Remote work is indicated, but the posting does not say which Spanish regions are eligible."] },
    reqs: [
      req("React y TypeScript", "Required", "MATCH", { evidence: ev("React", "TypeScript") }),
      req("Pruebas automatizadas", "Required", "MATCH", { evidence: ev("Vitest", "RTL") }),
      req("Experiencia con Cypress", "Preferred", "PARTIAL", { evidence: ev("Vitest", "RTL"), missing: ["Cypress"] })
    ],
    keywords: ["react", "typescript", "testing"],
    excerpt: "Buscamos una persona desarrolladora frontend para el equipo de producto. Teletrabajo en España, reuniones mensuales en Madrid."
  },
  {
    slug: "platform-engineer-react-optional",
    title: "Platform Engineer (React for admin tools)",
    company: "Granite Infra",
    location: "Remote — Europe",
    source: "freehire",
    searchMode: "remote",
    remote: true,
    hybrid: false,
    created: "2026-10-03",
    breakdown: { technical: 28, experience: 55, responsibilities: 30, qualifications: null, career: 35, scoringCoverage: 60 },
    gates: { roleFit: ["FLAG", "Backend-leaning title; React is only used for internal tools."] },
    extraction: "uncertain",
    warnings: ["responsibilities.core came back empty"],
    reqs: [
      req("Kubernetes and Terraform", "Required", "GAP"),
      req("Go or Rust services", "Required", "GAP"),
      req("React for internal admin tools", "Preferred", "MATCH", { evidence: ev("React") })
    ],
    keywords: ["react"],
    excerpt: "Infrastructure team looking for a platform engineer. React knowledge is useful for the internal admin console."
  }
];

export const demoJobs: JobResult[] = specs
  .map(build)
  .sort((a, b) => (b.jobFitScore ?? -1) - (a.jobFitScore ?? -1));
