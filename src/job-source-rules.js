// Pure source-listing classifiers. Kept separate from API access so these rules
// can be tested offline without credentials, network calls, or dotenv.
function normalizeText(value = "") {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getJobText(job) {
  return normalizeText([
    job?.title,
    job?.description,
    job?.location?.display_name,
    job?.company?.display_name
  ].filter(Boolean).join(" "));
}

// Region names published in structured source restrictions (e.g. Himalayas),
// shared by the pre-ranker and the scorer's location gate.
export const LISTING_SPAIN_REGIONS = new Set([
  "spain", "espana", "es", "canary islands", "islas canarias", "ic", "ceuta & melilla", "ceuta", "melilla", "ea"
]);
export const LISTING_OPEN_REGIONS = new Set([
  "europe", "european union", "eu", "worldwide", "anywhere", "global",
  "emea", "eea", "european economic area"
]);

// Region codes that are not a single country, or are part of Spain.
const NON_COUNTRY_REGION_CODES = new Set(["ES", "IC", "EA", "EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"]);

// Every country except Spain, by English name and ISO code, from the ICU data
// bundled with Node. A restriction list made only of these excludes an
// applicant living in Spain. Names that are not recognised at all (typos,
// invented regions) are deliberately left out so they stay "manual review".
function buildOtherCountryNames() {
  const names = new Set();
  try {
    const display = new Intl.DisplayNames(["en"], { type: "region" });
    for (let first = 65; first <= 90; first++) {
      for (let second = 65; second <= 90; second++) {
        const code = String.fromCharCode(first, second);
        if (NON_COUNTRY_REGION_CODES.has(code)) continue;
        const name = display.of(code);
        if (!name || name === code) continue;
        names.add(normalizeText(name));
        names.add(code.toLowerCase());
      }
    }
  } catch {
    // Without ICU data the static list below still applies.
  }
  return names;
}

// Multi-country regions that do not contain Spain.
const OTHER_REGIONS = [
  "north america", "south america", "latin america", "latam", "americas", "central america", "caribbean",
  "asia", "apac", "asia pacific", "asia-pacific", "southeast asia", "east asia", "south asia", "middle east",
  "mena", "africa", "sub-saharan africa", "sub saharan africa", "oceania", "gcc"
];

export const LISTING_KNOWN_OTHER_COUNTRIES = new Set([
  "united states", "united states of america", "usa", "us", "canada", "mexico", "brazil", "argentina",
  "united kingdom", "uk", "gb", "great britain", "england", "scotland", "wales", "northern ireland",
  "ireland", "germany", "de", "france", "fr", "netherlands", "the netherlands", "holland", "nl",
  "belgium", "be", "italy", "it", "austria", "at", "poland", "pl", "switzerland", "ch", "portugal", "pt",
  "united arab emirates", "uae", "australia", "new zealand", "india", "singapore", "japan",
  "south korea", "korea", "czech republic", "turkey", "russia", "vietnam", "ivory coast",
  ...OTHER_REGIONS,
  ...buildOtherCountryNames()
].map(normalizeText).filter((name) => !LISTING_SPAIN_REGIONS.has(name) && !LISTING_OPEN_REGIONS.has(name)));

export function restrictsToCountriesOutsideSpain(restrictions) {
  const regions = (Array.isArray(restrictions) ? restrictions : []).map(normalizeText).filter(Boolean);
  return regions.length > 0 && regions.every((region) => LISTING_KNOWN_OTHER_COUNTRIES.has(region));
}

// Shared by the pre-ranker and the scorer so both read structured restrictions
// identically, before any local-city or remote shortcut.
export function structuredRestrictionVerdict(job = {}) {
  if (job?.restrictionConflict === true) return "CONFLICT";
  if (restrictsToCountriesOutsideSpain(job?.locationRestrictions)) return "EXCLUDES_SPAIN";
  return "NONE";
}

// Written restrictions on where a remote employee may live. Shared by the
// scorer's location gate and the pre-ranker so a restriction that only the
// full description reveals can remove a job before the final shortlist.
// Text is normalised the same way as in the scorer (idempotent).
function normalizeRestrictionText(value = "") {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\.js\b/g, "js")
    .replace(/\+/g, " ")
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXPLICIT_SPAIN_REMOTE = /\b(remote within spain|spain[ -]wide remote|remote across spain|remote in spain|remote from spain|solo en espana|remoto en espana|teletrabajo en espana|trabajo remoto desde espana)\b/;
const EXPLICIT_NON_SPAIN_RESTRICTION = /\b(uk only|only in the uk|must be based in the uk|uk residents only|united kingdom only|must reside in the uk|uae only|only in the uae|must be based in the uae|uae residents only|united arab emirates only|must reside in the uae|dubai only|only in dubai|must be based in dubai|remote within (the )?(uk|united kingdom|germany|france|netherlands|belgium|italy|austria|poland|switzerland|uae|united arab emirates) only|must be based in (the )?(uk|united kingdom|germany|france|netherlands|belgium|italy|austria|poland|switzerland|uae|united arab emirates)|only (uk|united kingdom|german|french|dutch|belgian|italian|austrian|polish|swiss|emirati) residents)\b/;
const EXPLICIT_NON_SPAIN_RESIDENCY = /\b(?:(?:usa|u\.s\.a?|united states(?: of america)?|canada|canadian|australia|india|north america|latam|latin america)[ -](?:only|residents?|citizens?|based)|(?:us|u\.s\.)[ -](?:residents?|citizens?|based)|only (?:in|within|from|for|open to|available to) (?:the )?(?:usa|u\.s\.|united states|canada|north america|latam|latin america)|must (?:be (?:based|located|resident|living)|reside|live) in (?:the )?(?:usa|u\.s\.|united states|canada|north america|latam|latin america)|authori[sz]ed to work in (?:the )?(?:usa|u\.s\.|united states|canada))(?![a-z0-9])/;

export function hasExplicitSpainRemote(text) {
  return EXPLICIT_SPAIN_REMOTE.test(normalizeRestrictionText(text));
}

export function hasExplicitNonSpainRestriction(text) {
  const normalized = normalizeRestrictionText(text);
  return EXPLICIT_NON_SPAIN_RESTRICTION.test(normalized) || EXPLICIT_NON_SPAIN_RESIDENCY.test(normalized);
}

// Explicit permission to work remotely from anywhere / anywhere in Europe.
// Tied to the remote arrangement itself: "customers worldwide" or "offices in
// Europe" do not count. Shared by the scorer's location gate and the pre-ranker.
const remoteLead = "remote(?:ly)?(?:\\s+(?:position|role|job|opportunity|work|working|is|are|available|open|to|candidates|applicants|from))*";
const EXPLICIT_WORLDWIDE_REMOTE = new RegExp(
  `\\b(?:worldwide|global) remote\\b|\\b${remoteLead}\\s+(?:worldwide|globally|anywhere(?: in the world)?)\\b|\\bwork(?:ing)?(?: remotely)? from anywhere(?! in (?:europe|the eu|the us|the uk|spain))\\b`
);
const EXPLICIT_EUROPE_REMOTE = new RegExp(
  `\\b(?:europe|eu)[ -]wide remote\\b|\\b${remoteLead}\\s+(?:across|within|throughout|in)\\s+(?:all of\\s+)?(?:europe|the eu|the european union)\\b|\\bwork from anywhere in (?:europe|the eu)\\b`
);

export function hasExplicitWorldwideRemote(text) {
  return EXPLICIT_WORLDWIDE_REMOTE.test(normalizeRestrictionText(text));
}

export function hasExplicitEuropeRemote(text) {
  return EXPLICIT_EUROPE_REMOTE.test(normalizeRestrictionText(text));
}

// "Hybrid" as a technology, not a work arrangement: hybrid cloud, hybrid
// (mobile) apps, hybrid architecture/infrastructure/environments, hybrid and
// native apps, nube híbrida, aplicaciones híbridas... These uses are removed
// before looking for hybrid-work wording. "Hybrid work/working/model/role/
// office/schedule" and a bare "(Hybrid)" are never removed.
const HYBRID_TECH_NOUNS = [
  "cloud", "clouds", "multi ?cloud", "apps?", "applications?", "mobile", "web", "architectures?",
  "environments?", "infrastructures?", "integrations?", "solutions?", "frameworks?", "development",
  "technolog(?:y|ies)", "tech", "it", "systems?", "platforms?", "deployments?", "stack", "databases?",
  "storage", "network(?:s|ing)?", "rendering", "ssr", "ssg", "search", "engines?", "vehicles?",
  "cars?", "electric", "energy", "power", "cms", "data", "analytics", "computing", "hosting",
  "servers?", "kubernetes", "k8s", "websites?", "ml", "ai"
].join("|");
const HYBRID_TECH_USES = [
  new RegExp(`\\bhybrid[- ](?:${HYBRID_TECH_NOUNS})\\b`, "g"),
  /\bhybrid\s*(?:and|or|&|\/)\s*native\b/g,
  /\bnative\s*(?:and|or|&|\/)\s*hybrid\b/g,
  /\b(?:ionic|cordova|capacitor|phonegap)\b[^.\n]{0,30}\bhybrid\b/g,
  /\b(?:nube|aplicacion(?:es)?|apps?|arquitectura|infraestructura|soluciones?|tecnologias?|entornos? (?:cloud|multicloud|de nube))\s+(?:moviles?\s+)?hibrid[oa]s?\b/g,
  /\bhibrid[oa]s?\s+(?:y|o)\s+nativ[oa]s?\b/g
];
const HYBRID_WORK_KEYWORDS = [
  "hybrid", "modelo hibrido", "trabajo hibrido", "modalidad hibrida",
  "hibrido", "hibrida", "presencial y remoto", "dias en oficina"
];

// True when the text describes a hybrid WORK arrangement.
export function hasHybridWorkSignal(value) {
  let text = normalizeText(value);
  for (const pattern of HYBRID_TECH_USES) text = text.replace(pattern, " ");
  return HYBRID_WORK_KEYWORDS.some((keyword) =>
    new RegExp(`(^|[^a-z0-9])${normalizeText(keyword)}(?=$|[^a-z0-9])`).test(text)
  );
}

export function isHybrid(job = {}) {
  return hasHybridWorkSignal(getJobText(job));
}

const REMOTE_NEGATION = new RegExp([
  "\\bnot (?:a |an )?(?:fully |100% )?remote\\b",
  "\\bnon[- ]remote\\b",
  "\\bno (?:remote|teletrabajo|home office|homeoffice)\\b(?! (?:restrictions?|limits?))",
  "\\bremote (?:work(?:ing)? )?(?:is |are )?(?:not|no longer) (?:possible|available|offered|an option|allowed|permitted)\\b(?! (?:from )?(?:outside|abroad|from other countries))",
  "\\b(?:does not|doesn't|cannot|can't) (?:be |offer |support )?(?:done |performed )?(?:fully )?remote(?:ly)?\\b",
  "\\bno (?:es |se trata de )?(?:un )?(?:puesto |trabajo )?(?:remoto|en remoto)\\b",
  "\\b(?:sin |no se permite (?:el )?|no hay )teletrabajo\\b",
  "\\bno (?:ofrecemos|se ofrece) (?:teletrabajo|trabajo remoto)\\b"
].join("|"));

export function isRemote(job = {}) {
  const title = normalizeText(job.title ?? "");
  const location = normalizeText(job.location?.display_name ?? "");
  const description = normalizeText(job.description ?? "");

  const titleOrLocationSignals = [
    "remote", "remoto", "teletrabajo", "work from home", "home based",
    "home-based", "fully remote", "100% remote", "remote-first", "remote first"
  ];
  const descriptionSignals = [
    "fully remote", "100% remote", "remote-first", "remote first",
    "remote working", "remote work", "remote position", "remote role",
    "remote job", "work from home", "work-from-home", "work remotely",
    "distributed team", "distributed workforce", "home based", "home-based",
    "trabajo remoto", "trabajar en remoto", "teletrabajo",
    "trabajo desde casa", "trabajar desde casa", "puesto remoto", "en remoto",
    // Statements of where remote work is allowed are remote statements too
    // ("Remote within Spain.", "remote across Europe", "Full remote").
    "remote within", "remote across", "remote from", "remote only", "remote opportunity",
    "remote contract", "remote basis", "full remote", "full-remote", "fully-remote",
    "100% remoto", "remoto desde", "modalidad remota", "en remoto desde"
  ];

  // "Remote sensing" is a technology, not a work arrangement.
  const withoutRemoteSensing = (text) => text.replace(/\bremote sensing\b/g, " ");
  const titleForSignals = withoutRemoteSensing(title);
  const locationForSignals = withoutRemoteSensing(location);

  const explicitRemoteInTitleOrLocation = titleOrLocationSignals.some((term) =>
    titleForSignals.includes(normalizeText(term)) ||
    locationForSignals.includes(normalizeText(term))
  );
  // Explicit permission recognised by the location gate (remote within Spain,
  // across Europe, from anywhere) must also mark the job as remote; otherwise
  // the gate treats it as an onsite job in the listed country.
  const explicitRemoteInDescription = descriptionSignals.some((term) =>
    description.includes(normalizeText(term))
  ) || hasExplicitSpainRemote(job.description ?? "") ||
    hasExplicitEuropeRemote(job.description ?? "") ||
    hasExplicitWorldwideRemote(job.description ?? "");
  const hybrid = isHybrid(job);
  const fullyRemoteOverride = /\b(fully remote|100% remote|remote[- ]first|remote worldwide|worldwide remote|remote anywhere|trabajo 100% remoto)\b/.test(
    `${title} ${description}`
  );

  // "This is not a remote position" / "remote work is not possible" deny
  // remote work. "Not possible from outside Spain" limits where, not whether.
  const remoteNegated = REMOTE_NEGATION.test(description) &&
    !explicitRemoteInTitleOrLocation && !fullyRemoteOverride;

  // A hybrid listing can mention remote work without being fully remote.
  if (hybrid && !fullyRemoteOverride) return false;
  if (remoteNegated) return false;
  return explicitRemoteInTitleOrLocation || explicitRemoteInDescription;
}

export const jobSourceDetection = { isRemote, isHybrid };
