// Deterministic technology lexicon used to read requirement *sentences*
// ("Strong experience with React and TypeScript") as well as atomic skills.
//
// Why this exists: the LLM extractor returns requirement lines as sentences,
// often in Spanish or Italian, while the candidate profile lists atomic skills.
// Matching sentences against atomic skills as whole strings scores almost every
// real requirement as missing. Technology names are language-neutral, so
// recognising them inside a sentence is both multilingual and deterministic.
//
// Honesty rules:
// - Both the job text and the candidate evidence are read with the same
//   lexicon and the same longest-match-first tokenizer, so "Tailwind CSS" does
//   not also count as "CSS", "React Native" is never "React", and
//   "React Testing Library" is not evidence of "React".
// - Technologies the candidate does NOT have are in the lexicon on purpose:
//   a sentence such as "React and PostgreSQL" must report PostgreSQL as missing
//   instead of crediting the whole line for React.
// - Implications are few, explicit and weighted (e.g. Redux Toolkit -> Redux).

const ENTRIES = [
  // Core frontend
  ["react", "React", ["react", "reactjs", "react js"]],
  ["react-native", "React Native", ["react native"]],
  ["nextjs", "Next.js", ["nextjs", "next js"]],
  ["nextjs-app-router", "Next.js App Router", ["nextjs app router", "app router"]],
  ["typescript", "TypeScript", ["typescript"]],
  ["javascript", "JavaScript", ["javascript", "js", "es6", "es2015", "ecmascript", "javascript es6", "vanilla js", "vanilla javascript"]],
  ["html", "HTML", ["html", "html5"]],
  ["css", "CSS", ["css", "css3"]],
  ["frontend", "Frontend development", [
    "frontend", "front end", "frontend development", "front end development", "frontend engineering",
    "front end engineering", "desarrollo frontend", "desarrollo front end", "sviluppo frontend",
    "sviluppo front end", "frontend entwicklung"
  ]],
  ["backend-development", "Backend development", ["backend development", "back end development", "desarrollo backend", "sviluppo backend"]],
  ["vue", "Vue.js", ["vue", "vuejs", "vue js", "vue 3"]],
  ["nuxt", "Nuxt", ["nuxt", "nuxtjs", "nuxt js"]],
  ["angular", "Angular", ["angular", "angularjs"]],
  ["svelte", "Svelte", ["svelte", "sveltekit"]],
  ["preact", "Preact", ["preact"]],
  ["remix", "Remix", ["remix run"]],
  ["gatsby", "Gatsby", ["gatsby", "gatsbyjs"]],
  ["jquery", "jQuery", ["jquery"]],
  ["sass", "Sass/SCSS", ["sass", "scss"]],
  ["styled-components", "styled-components", ["styled components"]],
  ["storybook", "Storybook", ["storybook"]],
  ["webpack", "Webpack", ["webpack"]],
  ["vite", "Vite", ["vite", "vitejs"]],
  ["turbopack", "Turbopack", ["turbopack"]],
  ["babel", "Babel", ["babel"]],
  ["esbuild", "esbuild", ["esbuild"]],
  ["graphql", "GraphQL", ["graphql", "apollo", "apollo client"]],
  ["rest-apis", "REST APIs", [
    "rest api", "rest apis", "restful", "restful api", "restful apis", "api rest", "apis rest",
    "rest api integration", "restful services", "rest services"
  ]],
  ["websockets", "WebSockets", ["websocket", "websockets"]],
  // State and data
  ["redux", "Redux", ["redux"]],
  ["redux-toolkit", "Redux Toolkit", ["redux toolkit"]],
  ["zustand", "Zustand", ["zustand"]],
  ["mobx", "MobX", ["mobx"]],
  ["recoil", "Recoil", ["recoil"]],
  ["jotai", "Jotai", ["jotai"]],
  ["react-query", "React Query", ["react query", "tanstack query", "tanstack react query"]],
  ["swr", "SWR", ["swr"]],
  // Styling / UI kits
  ["tailwind", "Tailwind CSS", ["tailwind", "tailwind css", "tailwindcss"]],
  ["material-ui", "Material UI", ["material ui", "mui"]],
  ["chakra", "Chakra UI", ["chakra", "chakra ui"]],
  ["bootstrap", "Bootstrap", ["bootstrap"]],
  ["shadcn", "shadcn/ui", ["shadcn", "shadcn ui"]],
  ["figma", "Figma", ["figma"]],
  ["design-system", "Design systems", ["design system", "design systems", "sistema de diseno", "sistemas de diseno"]],
  ["design-system-principles", "Design system principles", ["design system principles"]],
  // Testing
  ["testing", "Testing", ["testing", "tests", "automated testing", "automated tests", "pruebas", "tdd"]],
  ["unit-testing", "Unit testing", ["unit testing", "unit test", "unit tests", "pruebas unitarias", "test unitari", "unit tested"]],
  ["integration-testing", "Integration testing", ["integration testing", "integration test", "integration tests", "pruebas de integracion"]],
  ["e2e-testing", "End-to-end testing", ["e2e", "e2e testing", "e2e tests", "end to end testing", "end to end tests"]],
  ["jest", "Jest", ["jest"]],
  ["vitest", "Vitest", ["vitest"]],
  ["react-testing-library", "React Testing Library", ["react testing library", "testing library"]],
  ["cypress", "Cypress", ["cypress"]],
  ["playwright", "Playwright", ["playwright"]],
  ["selenium", "Selenium", ["selenium"]],
  ["mocha", "Mocha", ["mocha"]],
  ["enzyme", "Enzyme", ["enzyme"]],
  // Rendering / performance / quality
  ["ssr", "SSR", ["ssr", "server side rendering"]],
  ["ssg", "SSG", ["ssg", "static site generation"]],
  ["seo", "SEO", ["seo"]],
  ["performance-optimization", "Performance optimization", [
    "performance optimization", "performance optimisation", "frontend performance", "frontend performance optimization",
    "web performance", "optimizacion de rendimiento"
  ]],
  ["lazy-loading", "Lazy loading", ["lazy loading"]],
  ["code-splitting", "Code splitting", ["code splitting"]],
  ["memoization", "Memoization", ["memoization", "memoisation"]],
  ["accessibility", "Accessibility", ["accessibility", "a11y", "accesibilidad", "accessibilita", "barrierefreiheit"]],
  ["wcag", "WCAG", ["wcag"]],
  ["responsive-design", "Responsive design", [
    "responsive", "responsive design", "responsive web design", "diseno responsive", "diseno responsivo", "mobile first"
  ]],
  ["pwa", "PWA", ["pwa", "progressive web app", "progressive web apps"]],
  ["i18n", "Internationalization (i18n)", ["i18n", "internationalization", "internationalisation"]],
  ["micro-frontends", "Micro-frontends", ["micro frontends", "microfrontends", "micro frontend", "microfrontend"]],
  ["electron", "Electron", ["electron", "electronjs"]],
  ["threejs", "Three.js", ["threejs", "three js"]],
  ["d3", "D3.js", ["d3", "d3js"]],
  ["webgl", "WebGL", ["webgl"]],
  // Auth
  ["jwt", "JWT", ["jwt", "json web token", "json web tokens"]],
  ["oauth", "OAuth", ["oauth", "oauth2", "openid connect", "oidc"]],
  ["authentication", "Authentication", ["authentication", "autenticacion"]],
  // Tooling / platforms
  ["git", "Git", ["git"]],
  ["github", "GitHub", ["github"]],
  ["gitlab", "GitLab", ["gitlab"]],
  ["bitbucket", "Bitbucket", ["bitbucket"]],
  ["github-actions", "GitHub Actions", ["github actions"]],
  ["ci-cd", "CI/CD", ["cicd", "continuous integration", "continuous delivery", "continuous deployment"]],
  ["vercel", "Vercel", ["vercel"]],
  ["netlify", "Netlify", ["netlify"]],
  ["docker", "Docker", ["docker"]],
  ["kubernetes", "Kubernetes", ["kubernetes", "k8s"]],
  ["terraform", "Terraform", ["terraform"]],
  ["aws", "AWS", ["aws", "amazon web services"]],
  ["azure", "Azure", ["azure"]],
  ["gcp", "Google Cloud", ["gcp", "google cloud", "google cloud platform"]],
  ["linux", "Linux", ["linux"]],
  // Backend and data (present so that gaps are reported honestly)
  ["nodejs", "Node.js", ["node", "nodejs", "node js"]],
  ["express", "Express", ["expressjs", "express js"]],
  ["nestjs", "NestJS", ["nestjs", "nest js"]],
  ["java", "Java", ["java"]],
  ["spring", "Spring", ["spring", "spring boot", "springboot"]],
  ["kotlin", "Kotlin", ["kotlin"]],
  ["csharp", "C#", ["csharp"]],
  ["dotnet", ".NET", ["dotnet", "asp dotnet"]],
  ["python", "Python", ["python"]],
  ["django", "Django", ["django"]],
  ["flask", "Flask", ["flask"]],
  ["fastapi", "FastAPI", ["fastapi"]],
  ["php", "PHP", ["php"]],
  ["laravel", "Laravel", ["laravel"]],
  ["symfony", "Symfony", ["symfony"]],
  ["ruby", "Ruby", ["ruby"]],
  ["rails", "Ruby on Rails", ["rails", "ruby on rails"]],
  ["golang", "Go", ["golang"]],
  ["rust", "Rust", ["rust"]],
  ["scala", "Scala", ["scala"]],
  ["swift", "Swift", ["swift"]],
  ["cpp", "C++", ["cpp"]],
  ["microservices", "Microservices", ["microservices", "microservice", "microservicios", "microservizi"]],
  ["sql", "SQL", ["sql"]],
  ["postgresql", "PostgreSQL", ["postgresql", "postgres"]],
  ["mysql", "MySQL", ["mysql"]],
  ["mongodb", "MongoDB", ["mongodb", "mongo"]],
  ["redis", "Redis", ["redis"]],
  ["snowflake", "Snowflake", ["snowflake"]],
  ["elasticsearch", "Elasticsearch", ["elasticsearch"]],
  ["kafka", "Kafka", ["kafka"]],
  ["salesforce", "Salesforce", ["salesforce"]],
  ["wordpress", "WordPress", ["wordpress"]],
  ["shopify", "Shopify", ["shopify"]],
  // Practices
  ["agile", "Agile", ["agile", "agil", "metodologias agiles", "metodologia agile"]],
  ["scrum", "Scrum", ["scrum"]],
  ["kanban", "Kanban", ["kanban"]],
  ["code-review", "Code review", ["code review", "code reviews", "revision de codigo", "revisiones de codigo"]]
];

// Weighted, explicit implications: evidence of the key is partial or strong
// evidence of the listed technology. Anything not listed is never implied.
const IMPLICATIONS = {
  "redux-toolkit": [["redux", 0.9]],
  nextjs: [["react", 0.9]],
  "nextjs-app-router": [["nextjs", 1], ["react", 0.9]],
  typescript: [["javascript", 0.9]],
  "react-testing-library": [["testing", 1]],
  vitest: [["testing", 1], ["unit-testing", 0.5]],
  jest: [["testing", 1], ["unit-testing", 0.5]],
  "unit-testing": [["testing", 1]],
  "integration-testing": [["testing", 1]],
  "design-system-principles": [["design-system", 0.5]],
  wcag: [["accessibility", 0.9]],
  "jwt": [["authentication", 0.9]],
  "spring": [["java", 0.9]],
  "django": [["python", 0.9]],
  "rails": [["ruby", 0.9]],
  "nestjs": [["nodejs", 0.9]],
  "express": [["nodejs", 0.9]]
};

const DISPLAY = Object.fromEntries(ENTRIES.map(([id, display]) => [id, display]));

// Word separators that may appear between technologies of one list.
const AND_WORDS = new Set(["and", "y", "e", "und", "et", "&", "+", ",", "/", "(", ")", ";", "as", "well", "plus", "with", "con"]);
const OR_WORDS = new Set(["or", "o", "u", "oder", "ou", "and/or"]);
// "or similar", "o similar", "or equivalent", "or another comparable framework"...
const ALTERNATIVE_TAIL = new Set([
  "similar", "similares", "simili", "equivalent", "equivalente", "equivalenti", "comparable",
  "other", "another", "otro", "otra", "otros", "altro", "altri", "alike"
]);
// A list introduced by "frameworks such as ..." / "tools like ..." is a list of alternatives.
const CATEGORY_WORDS = new Set([
  "framework", "frameworks", "library", "libraries", "librerias", "libreria", "librerie", "tool", "tools",
  "herramientas", "herramienta", "bundler", "bundlers", "build", "preprocessor", "preprocessors",
  "management", "manager", "managers", "cloud", "provider", "providers", "database", "databases",
  "bases", "datos", "platform", "platforms", "solution", "solutions", "stack"
]);
const EXAMPLE_CUES = [["such", "as"], ["e", "g"], ["eg"], ["like"], ["for", "example"], ["including"], ["como"], ["tipo"], ["ad", "esempio"], ["come"], ["z", "b"], ["wie"]];

// Same transformations for job text, aliases and candidate evidence.
export function lexTokens(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bc\s*#/g, " csharp ")
    .replace(/\bc\+\+/g, " cpp ")
    .replace(/\basp\.net\b/g, " asp dotnet ")
    .replace(/(^|[^a-z0-9])\.net\b/g, "$1 dotnet ")
    .replace(/\bci\s*\/\s*cd\b/g, " cicd ")
    .replace(/\band\s*\/\s*or\b/g, " and/or ")
    .replace(/\b([a-z0-9]+)\.js\b/g, "$1js")
    .match(/and\/or|[a-z0-9]+|[,/()&+;]/g) ?? [];
}

const ALIASES = ENTRIES.flatMap(([id, , aliases]) =>
  aliases.map((alias) => ({ id, tokens: lexTokens(alias).filter((token) => /^[a-z0-9]+$/.test(token)) }))
)
  .filter((alias) => alias.tokens.length)
  .sort((a, b) => b.tokens.length - a.tokens.length);

const ALIASES_BY_FIRST = ALIASES.reduce((map, alias) => {
  const list = map.get(alias.tokens[0]) ?? [];
  list.push(alias);
  map.set(alias.tokens[0], list);
  return map;
}, new Map());

// Longest-match-first scan. Returns mentions with token positions.
export function findMentions(text) {
  const tokens = lexTokens(text);
  const mentions = [];
  let i = 0;

  while (i < tokens.length) {
    const candidates = ALIASES_BY_FIRST.get(tokens[i]) ?? [];
    const hit = candidates.find((alias) =>
      alias.tokens.every((token, offset) => tokens[i + offset] === token)
    );
    if (hit) {
      mentions.push({ id: hit.id, start: i, end: i + hit.tokens.length });
      i += hit.tokens.length;
    } else {
      i += 1;
    }
  }

  return { tokens, mentions };
}

export function techDisplayName(id) {
  return DISPLAY[id] ?? id;
}

// Candidate technology evidence: id -> strength (1 direct, <1 implied).
export function buildCandidateTechEvidence(evidenceStrings = []) {
  const strength = new Map();
  const add = (id, value) => strength.set(id, Math.max(strength.get(id) ?? 0, value));

  for (const value of evidenceStrings) {
    for (const mention of findMentions(value).mentions) add(mention.id, 1);
  }
  for (const [id, value] of [...strength.entries()]) {
    for (const [implied, weight] of IMPLICATIONS[id] ?? []) add(implied, Math.min(value, weight));
  }
  return strength;
}

function isSeparatorSpan(tokens) {
  return tokens.every((token) => AND_WORDS.has(token) || OR_WORDS.has(token));
}

function startsWithAlternativeTail(tokens) {
  const window = tokens.slice(0, 4).filter((token) => token !== "," && token !== ")" && token !== "(");
  return window.length >= 2 && OR_WORDS.has(window[0]) && window.slice(1, 3).some((token) => ALTERNATIVE_TAIL.has(token));
}

function precededByAlternativeList(tokens, start) {
  const before = tokens.slice(Math.max(0, start - 6), start).filter((token) => token !== "(" && token !== ",");
  for (const cue of EXAMPLE_CUES) {
    for (let i = 0; i + cue.length <= before.length; i++) {
      if (cue.every((word, offset) => before[i + offset] === word)) {
        const head = before.slice(Math.max(0, i - 2), i);
        if (head.some((word) => CATEGORY_WORDS.has(word))) return true;
      }
    }
  }
  // "state management (Redux, Zustand)" / "build tools (Vite, Webpack)"
  const raw = tokens.slice(Math.max(0, start - 3), start);
  if (raw[raw.length - 1] === "(" && raw.slice(0, -1).some((word) => CATEGORY_WORDS.has(word))) return true;
  return false;
}

// Groups adjacent mentions joined only by list separators. A group is a set of
// alternatives when it contains an OR word, ends with "or similar", or is an
// example list introduced after a category word ("frameworks such as ...").
// Everything else is all-of. "/" is treated as all-of: "HTML/CSS" means both.
export function analyzeTechText(text) {
  const { tokens, mentions } = findMentions(text);
  if (!mentions.length) return { mentions: [], groups: [] };

  const groups = [];
  let current = null;

  for (const mention of mentions) {
    const between = current ? tokens.slice(current.end, mention.start) : null;
    if (current && isSeparatorSpan(between)) {
      if (between.some((token) => OR_WORDS.has(token))) current.anyOf = true;
      current.ids.push(mention.id);
      current.end = mention.end;
    } else {
      if (current) groups.push(current);
      current = { ids: [mention.id], start: mention.start, end: mention.end, anyOf: precededByAlternativeList(tokens, mention.start) };
    }
  }
  groups.push(current);

  for (const group of groups) {
    if (startsWithAlternativeTail(tokens.slice(group.end))) group.anyOf = true;
    group.ids = [...new Set(group.ids)];
    if (group.ids.length === 1) group.anyOf = false;
  }

  return { tokens, mentions, groups };
}

// Words that turn a skill into a requirement sentence ("Strong React",
// "TypeScript avanzato", "experience with Next.js"). Their presence means the
// line is a sentence to read, not an atomic skill to compare token-by-token.
const REQUIREMENT_WORDS = new Set([
  "experience", "experienced", "expertise", "expert", "knowledge", "knowledgeable", "proficiency", "proficient",
  "familiarity", "familiar", "understanding", "skills", "skill", "strong", "solid", "proven", "deep", "good",
  "excellent", "advanced", "hands", "competency", "competence", "command", "mastery", "background", "working",
  "building", "developing", "using", "ability", "abilities", "years", "year",
  "experiencia", "conocimiento", "conocimientos", "dominio", "manejo", "solida", "solido", "avanzado", "avanzados",
  "buen", "buena", "buenos", "esperienza", "conoscenza", "competenze", "avanzato", "avanzata", "ottima", "buona",
  "erfahrung", "kenntnisse", "fundierte", "sehr", "connaissance", "connaissances", "maitrise", "experience"
]);
const NEUTRAL_WORDS = new Set([
  "with", "in", "of", "the", "a", "an", "and", "or", "for", "on", "to", "de", "en", "con", "y", "o", "el", "la",
  "los", "las", "del", "di", "e", "il", "lo", "nel", "nella", "mit", "und", "oder", "et", "ou", "du", "des",
  ",", "/", "(", ")", "&", "+", ";", "and/or"
]);

// True when the text should be read as a requirement sentence rather than an
// atomic skill name. Atomic names keep the existing token matcher, so
// "React 18" or "Agile methodology" retain their established partial scores.
export function isRequirementSentence(text) {
  const { tokens, mentions } = findMentions(text);
  if (!mentions.length) return false;
  if (new Set(mentions.map((mention) => mention.id)).size >= 2) return true;

  const covered = new Set();
  for (const mention of mentions) for (let i = mention.start; i < mention.end; i++) covered.add(i);
  const extras = tokens.filter((token, index) => !covered.has(index) && !NEUTRAL_WORDS.has(token) && !/^\d+$/.test(token));
  return extras.some((token) => REQUIREMENT_WORDS.has(token)) || extras.length >= 3;
}

// The technology id when the whole text is exactly one alias ("React JS",
// "Responsive web design"); null for anything with extra words or versions.
export function pureTechId(text) {
  const { tokens, mentions } = findMentions(text);
  return mentions.length === 1 && mentions[0].start === 0 && mentions[0].end === tokens.length
    ? mentions[0].id
    : null;
}

// Non-JavaScript backend technologies. A job title naming one of them asks for a
// backend skill set outside a JavaScript/React frontend stack, whatever the
// word order ("Java Developer (React)", "Full Stack (React & C# .NET)").
// Node.js is deliberately absent: a JavaScript backend is not penalised.
export const NON_JS_BACKEND_TECH_IDS = new Set([
  "java", "spring", "kotlin", "scala", "csharp", "dotnet", "python", "django", "flask", "fastapi",
  "php", "laravel", "symfony", "ruby", "rails", "golang", "rust", "cpp"
]);

export function namesNonJsBackend(text) {
  return findMentions(text).mentions.some((mention) => NON_JS_BACKEND_TECH_IDS.has(mention.id));
}
