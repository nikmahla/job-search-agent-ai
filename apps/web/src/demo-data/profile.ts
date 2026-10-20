// Synthetic candidate. Not a real person; shaped like data/candidate-profile.json.
import { candidateProfileSchema, type CandidateProfile } from "@/lib/schema";

export const demoProfile: CandidateProfile = candidateProfileSchema.parse({
  candidate: {
    name: "Alex Morgan",
    experienceYears: 4,
    location: { acceptedCities: ["Alicante", "Valencia"] },
    workAuthorization: { eu: true },
    languages: [
      { language: "English", level: "C1" },
      { language: "Spanish", level: "B1" }
    ],
    remoteWork: true
  },
  professionalProfile: {
    targetRoles: ["Frontend Developer", "React Developer", "Next.js Developer"],
    primaryDomain: "Frontend development"
  },
  skills: {
    primary: ["React", "Next.js", "TypeScript", "JavaScript"],
    secondary: ["HTML", "CSS", "Redux Toolkit", "Zustand", "React Query", "REST APIs", "JWT Authentication", "Tailwind CSS"],
    testing: ["Vitest", "React Testing Library", "Integration Testing"],
    performance: ["SSR", "SSG", "Code Splitting", "Lazy Loading"],
    tools: ["Git", "GitHub", "Vercel"],
    practices: ["Agile", "Code Review", "Accessibility"]
  },
  experience: [
    {
      role: "Frontend Developer",
      company: "Sample Studio",
      durationYears: 4,
      functions: [
        "Frontend development",
        "React and Next.js development",
        "REST API integration",
        "JWT authentication with refresh tokens",
        "Performance optimization",
        "Testing",
        "Code review"
      ]
    }
  ],
  education: [{ degree: "B.Sc. Computer Science" }],
  atsKeywords: ["Frontend Developer", "React", "Next.js", "TypeScript", "JavaScript", "Tailwind CSS", "Vitest"],
  cvEvidence: {
    React: "Built and maintained a React 18 component library used by three product teams.",
    "Next.js": "Migrated a marketing site to the Next.js App Router, cutting load time by 40%.",
    TypeScript: "Introduced strict TypeScript across a 60k-line codebase.",
    JavaScript: "Four years of modern JavaScript (ES2022) in production.",
    "Redux Toolkit": "Replaced legacy Redux boilerplate with Redux Toolkit slices.",
    Zustand: "Used Zustand for lightweight client state in dashboard widgets.",
    "React Query": "Cached and synchronised server state with React Query.",
    "REST APIs": "Integrated REST APIs with typed clients and error handling.",
    "JWT Authentication": "Implemented JWT login with refresh-token rotation.",
    "Tailwind CSS": "Designed a Tailwind-based design system with dark mode.",
    Vitest: "Unit tests with Vitest; 85% coverage on shared components.",
    "React Testing Library": "Component tests with React Testing Library.",
    Git: "Daily Git and GitHub pull-request workflow.",
    Accessibility: "Fixed WCAG 2.1 AA issues found in an accessibility audit."
  }
});
