import { normalizeUrlForResultDedup, decodeBingRedirect } from "../utils/index.js";
import { saveOutput } from "../utils/output.js";
import type { ResearchParams, NovadaSearchResult } from "./types.js";
import { novadaExtract } from "./extract.js";
import { submitSearchScrapeTask, resolveSearchResults, boundQuery } from "./search.js";
import type { ProgressReporter } from "./crawl.js";
import { makeNovadaError, NovadaError, NovadaErrorCode, redactSecrets, toolFailure, isToolFailure, stripToolFailureMark } from "../_core/errors.js";
import { raceEngineFallbacks, type FallbackAttempt } from "../_core/search-fallback.js";
import { wrapUntrusted, unwrapUntrusted } from "../utils/untrusted.js";

// C1: distinguish a REAL account-level entitlement failure (Scraper API not
// activated / bad key / quota) from a transient blip (timeout, 5xx, DNS). Only
// the former justifies the permanent "not activated" verdict; everything else
// must be reported as retryable so the agent doesn't dead-end on a false
// "activate the Scraper API" conclusion. Mirrors search.ts:589-591.
function isEntitlementError(err: unknown): boolean {
  if (err instanceof NovadaError) {
    return err.code === NovadaErrorCode.INVALID_API_KEY ||
           err.code === NovadaErrorCode.PRODUCT_UNAVAILABLE ||
           err.code === NovadaErrorCode.RATE_LIMITED;
  }
  const msg = err instanceof Error ? err.message : "";
  return /code 40[0-9]|permission|quota|unauthorized|forbidden|no permission|not activated/i.test(msg);
}

// FIX-2: Max question length to prevent DoS via over-long inputs hanging upstream searches
const QUESTION_MAX_LENGTH = 2000;

/** Invoke a progress reporter without ever letting it break research (NOV-319). */
async function reportProgress(
  onProgress: ProgressReporter | undefined,
  info: { progress: number; total?: number; message?: string }
): Promise<void> {
  if (!onProgress) return;
  try {
    await onProgress(info);
  } catch { /* progress is best-effort — never surface reporter failures */ }
}

/** Phase sequence reported via notifications/progress. Fixed total so clients render a
 *  determinate 4-step bar; the seed search phase is reported before queries run. */
const RESEARCH_PHASES = 4;

// ─── Engine Fallback ──────────────────────────────────────────────────────
// Primary engine first (cheapest — 1 API call). On failure, race 2 fallback
// engines in parallel (fastest recovery). Total: 1 call best case, 3 worst case.
// This saves 2/3 of API costs vs racing all 3 engines simultaneously.

interface SearchEngine {
  name: string;
  id: string;
  param: string;
  supportsNum: boolean;
}

const PRIMARY: SearchEngine = { name: "google.com", id: "google_search", param: "q", supportsNum: true };
const FALLBACKS: SearchEngine[] = [
  { name: "duckduckgo.com", id: "duckduckgo", param: "q", supportsNum: true },
  { name: "bing.com",       id: "bing_search", param: "q", supportsNum: false },
];

interface ResearchFilterParams {
  time_range?: string;
  start_date?: string;
  end_date?: string;
}

/**
 * Search with primary engine first, race fallbacks on failure.
 * Best case: 1 API call. Failure case: 3 API calls (1 primary + 2 raced).
 *
 * C1 (#39, 2026-11-18): the actual race is now the SAME shared primitive
 * novada_search uses (`raceEngineFallbacks`, `_core/search-fallback.ts`) —
 * this function is just research-specific plumbing (which engines, how to
 * submit+resolve one, the entitlement-signal side channel) around it.
 */
async function searchWithFallback(
  apiKey: string,
  query: string,
  num: number,
  signal?: { entitlement: boolean },
  filterParams?: ResearchFilterParams,
): Promise<NovadaSearchResult[]> {
  // C1: record whether a failure carried a real auth/entitlement signal so the
  // caller can tell "Scraper API not activated" (permanent) apart from a
  // transient blip. We never let error inspection change the success path.
  const note = (err: unknown): void => {
    if (signal && isEntitlementError(err)) signal.entitlement = true;
  };

  const attempt = (eng: SearchEngine): FallbackAttempt<NovadaSearchResult> => ({
    label: eng.name,
    run: async () => {
      try {
        const submitted = await submitSearchScrapeTask(apiKey, eng.name, eng.id, query, num, eng.param, eng.supportsNum, filterParams);
        return await resolveSearchResults(apiKey, submitted);
      } catch (err) {
        note(err);
        throw err;
      }
    },
  });

  // Attempt 1: Primary engine (Google) — cheapest path
  try {
    const results = await attempt(PRIMARY).run();
    // C1 review round 2 (HIGH, cost): a clean, successful-but-EMPTY primary
    // (no exception — the SERP genuinely has no hits for THIS sub-query) must
    // never trigger the fallback race — each race attempt is a real, separately
    // billed Scraper API submission, and racing 2 more engines on every
    // legitimately-empty sub-query would silently multiply the billed cost of
    // the common case (a `deep`/`comprehensive` research call already fans out
    // to several sub-queries; tripling EACH one compounds fast). Return the
    // empty result honestly — novadaResearch's own caller-side retry-with-
    // simplified-query already covers the "maybe the query itself was too
    // narrow" case without racing extra engines. Same rule as novada_search
    // (search.ts) — one rule, both callers, not two independently-tunable
    // cost policies.
    return results;
  } catch { /* primary FAILED transiently — race the fallback engines below */ }

  // Attempt 2: Race fallback engines (DDG + Bing in parallel) — fastest recovery.
  // Only reached when the primary attempt THREW; never for a clean empty result.
  const outcome = await raceEngineFallbacks(FALLBACKS.map(attempt));
  return outcome.results; // [] when every fallback engine ALSO failed or emptied
}

// ─── Domain Detection ──────────────────────────────────────────────────────
// Detect question domain to generate targeted, domain-specific queries

type QuestionDomain = "tech" | "business" | "comparison" | "howto" | "general";

/** Supported languages for suffix/filler text. "unknown" is a DETECTION
 *  OUTCOME (genuinely unsupported script), not a row with its own filler —
 *  see detectLanguage and the "fail safe" branches in generateSearchQueries. */
type Lang = "en" | "de" | "fr" | "es";
type DetectedLang = Lang | "unknown";
const SUPPORTED_LANGS: readonly Lang[] = ["en", "de", "fr", "es"];

// Comparison trigger phrases, ONE shared table keyed by language — used by
// both detectDomain (classification) and extractComparands (named-entity
// extraction) so the two never disagree about what counts as a comparison
// question. Table-driven (review round 2, requirement 3): a 5th language is
// a new array entry here, not a new regex at any call site.
const COMPARISON_TRIGGER_WORDS: Record<Lang, string[]> = {
  en: ["vs\\.?", "versus", "compared?\\s+to", "compare", "alternative", "better than", "difference between", "pros and cons"],
  de: ["vs\\.?", "versus", "gegen", "vergleich(?:e[nst]?)?", "gegenüber", "unterschied(?:e)?\\s+zwischen", "zwischen"],
  fr: ["vs\\.?", "versus", "contre", "comparaisons?", "compar(?:er|ons|ez|ent|e|es)", "diff[ée]rences?\\s+entre", "entre"],
  es: ["vs\\.?", "versus", "contra", "comparaci[oó]n", "comparar", "diferencias?\\s+entre", "entre"],
};
const COMPARISON_TRIGGER_REGEX = new RegExp(
  `\\b(${SUPPORTED_LANGS.flatMap(l => COMPARISON_TRIGGER_WORDS[l]).join("|")})\\b`,
  "i"
);

function detectDomain(question: string): QuestionDomain {
  const q = question.toLowerCase();

  if (COMPARISON_TRIGGER_REGEX.test(q)) {
    return "comparison";
  }
  if (/\b(how to|how do i|step[\s-]by[\s-]step|tutorial|guide|implement|setup|install|configure|build)\b/.test(q)) {
    return "howto";
  }
  if (/\b(api|sdk|library|framework|github|stackoverflow|code|programming|typescript|python|rust|golang|docker|kubernetes|react|node\.?js|database|sql|graphql|cli|npm|pip|crate)\b/.test(q)) {
    return "tech";
  }
  if (/\b(market|revenue|pricing|roi|case study|benchmark|growth|strategy|business model|saas|b2b|enterprise|startup|competitor|industry)\b/.test(q)) {
    return "business";
  }
  return "general";
}

/** Domain-specific query suffixes for targeted search diversity, one row per
 *  supported language. Adding a language = a new key here, not a new branch
 *  at any call site. Only reached when detectLanguage resolved a SUPPORTED
 *  language — "unknown" is handled by a separate, filler-free branch in
 *  generateSearchQueries so an unsupported language never gets a guessed
 *  translation (requirement 3). */
const DOMAIN_SUFFIXES_BY_LANG: Record<Lang, Record<QuestionDomain, string[]>> = {
  en: {
    tech:       ["github", "documentation official", "stackoverflow solution"],
    business:   ["case study", "market analysis benchmark", "industry report"],
    comparison: ["comparison table", "detailed review", "benchmarks performance"],
    howto:      ["tutorial step by step", "implementation example", "best practices guide"],
    general:    ["overview explained", "analysis", "expert opinion"],
  },
  de: {
    tech:       ["github", "offizielle dokumentation", "stackoverflow lösung"],
    business:   ["fallstudie", "marktanalyse", "branchenbericht"],
    comparison: ["vergleichstabelle", "ausführlicher test", "leistungsvergleich"],
    howto:      ["schritt für schritt anleitung", "praxisbeispiel", "best practices"],
    general:    ["übersicht erklärt", "analyse", "expertenmeinung"],
  },
  fr: {
    tech:       ["github", "documentation officielle", "solution stackoverflow"],
    business:   ["étude de cas", "analyse de marché", "rapport sectoriel"],
    comparison: ["tableau comparatif", "avis détaillé", "comparatif performances"],
    howto:      ["tutoriel étape par étape", "exemple d'implémentation", "meilleures pratiques"],
    general:    ["aperçu expliqué", "analyse", "avis d'expert"],
  },
  es: {
    tech:       ["github", "documentación oficial", "solución stackoverflow"],
    business:   ["caso de estudio", "análisis de mercado", "informe del sector"],
    comparison: ["tabla comparativa", "análisis detallado", "comparativa de rendimiento"],
    howto:      ["tutorial paso a paso", "ejemplo de implementación", "mejores prácticas"],
    general:    ["resumen explicado", "análisis", "opinión de experto"],
  },
};

/** Shorter per-language filler words for the other suffix slots
 *  (challenges/case-study/examples/review/best-practices/pricing). One row
 *  per language — a 5th language is a new object here. */
const EXTRA_WORDS_BY_LANG: Record<Lang, {
  challengesLimitations: string;
  caseStudyExamples: string;
  examplesUseCases: string;
  reviewExperience: string;
  bestPractices: string;
  pricing: string;
}> = {
  en: { challengesLimitations: "challenges limitations", caseStudyExamples: "case study examples", examplesUseCases: "examples use cases", reviewExperience: "review experience", bestPractices: "best practices", pricing: "pricing" },
  de: { challengesLimitations: "herausforderungen grenzen", caseStudyExamples: "praxisbeispiele", examplesUseCases: "beispiele anwendungsfälle", reviewExperience: "erfahrungen test", bestPractices: "bewährte praktiken", pricing: "preise" },
  fr: { challengesLimitations: "défis limites", caseStudyExamples: "étude de cas exemples", examplesUseCases: "exemples cas d'usage", reviewExperience: "avis expérience", bestPractices: "meilleures pratiques", pricing: "prix" },
  es: { challengesLimitations: "desafíos limitaciones", caseStudyExamples: "caso de estudio ejemplos", examplesUseCases: "ejemplos casos de uso", reviewExperience: "opinión experiencia", bestPractices: "mejores prácticas", pricing: "precios" },
};

/** Function/connector words common enough in a short question that one hit
 *  is a reliable language signal. Used for (a) detectLanguage's scoring and
 *  (b) filtering non-content words out of `keywords`/the comparison residual.
 *  One row per supported language — a 5th language is a new array here. */
const SIGNAL_WORDS_BY_LANG: Record<Lang, string[]> = {
  en: ["the", "is", "are", "how", "what", "why", "when", "where", "who", "which", "and", "or", "of", "in", "on", "at", "to", "for", "with", "a", "an", "do", "does"],
  de: ["und", "oder", "aber", "für", "mit", "ist", "sind", "wie", "warum", "wann", "wo", "wer", "welche", "welcher", "welches", "der", "die", "das", "ein", "eine", "einen", "einem", "im", "am", "beim", "vom", "zum", "zur", "bei", "über", "unter", "durch", "ohne", "nicht", "kein", "keine", "zwischen", "vergleich", "gegenüber", "unterschied", "gegen"],
  fr: ["le", "la", "les", "un", "une", "des", "et", "ou", "entre", "pour", "avec", "dans", "sur", "qui", "que", "quoi", "comment", "pourquoi", "quand", "où", "est", "sont", "comparaison", "comparer", "contre"],
  es: ["el", "la", "los", "las", "un", "una", "y", "o", "u", "e", "entre", "para", "con", "en", "sobre", "quien", "que", "como", "cuando", "donde", "es", "son", "comparación", "comparar", "contra"],
};
const ALL_SIGNAL_WORDS = new Set(SUPPORTED_LANGS.flatMap(l => SIGNAL_WORDS_BY_LANG[l]));

/** Detect the question's language from a small function-word table.
 *
 * research-query-quality-2026-11-14 review round 2 (MEDIUM #3): covers
 * en/de/fr/es, not just en/de. Defaults to "en" when no non-English signal
 * is found (keeps every pre-existing English-keyword-phrase test green —
 * e.g. "quantum computing applications" has no function words in ANY
 * language but is still English) — "unknown" is reserved for a genuinely
 * different, unsupported SCRIPT (CJK/Cyrillic/Arabic/etc.), where guessing
 * English and appending English filler would be actively wrong. This is the
 * fail-safe the review asked for: never confidently mislabel a different
 * language as English, while not refusing to guess on terse English input. */
function detectLanguage(question: string): DetectedLang {
  if (/[Ѐ-ӿ一-鿿぀-ヿ가-힣֐-׿؀-ۿ]/.test(question)) {
    return "unknown";
  }
  const q = question.toLowerCase();
  const tokens = q.split(/[^a-zà-ÿ0-9]+/).filter(Boolean);
  const nonEnglish: Exclude<Lang, "en">[] = ["de", "fr", "es"];
  let best: Lang = "en";
  let bestCount = 0;
  for (const l of nonEnglish) {
    const set = new Set(SIGNAL_WORDS_BY_LANG[l]);
    let count = 0;
    for (const t of tokens) if (set.has(t)) count++;
    if (l === "de" && /[äöüß]/.test(q)) count += 1;
    if (l === "fr" && /[éèêëçœ]/.test(q)) count += 0.5;
    if (l === "es" && /[ñ¿¡]/.test(q)) count += 0.5;
    if (count > bestCount) { bestCount = count; best = l; }
  }
  return bestCount > 0 ? best : "en";
}

// ─── Comparand Detection ─────────────────────────────────────────────────────
// F14-2: For comparison questions, detect named comparands (single brand
// tokens like "O2"/"Vodafone"/"eBay" or short multi-word entities like
// "Deutsche Telekom") and check whether any sources mention them — emit a
// warning when a comparand has zero hits. Also feeds generateSearchQueries so
// comparison questions get one targeted query PER comparand instead of the
// full question padded with a generic suffix (2026-11-14 field report).

/** Non-comparand syntax words, per language — question starters, comparison
 *  verbs/prepositions. Checked against the lowercased, bare token. Kept
 *  separate from the DOMAIN/STOP tables because this is about SYNTAX (what
 *  glues a comparand list together), not general vocabulary. Union across
 *  all supported languages: knowing a word is comparison-syntax in ANY
 *  supported language is enough to exclude it everywhere (harmless
 *  cross-lingual overlap, and a 5th language is a new array entry).
 *  These words (articles/prepositions/verbs) can never themselves open a
 *  real brand name, so this table's exclusion is unconditional — unlike
 *  COMPARAND_PRONOUN_WORDS_BY_LANG below, which needs a position-sensitive
 *  rule because pronouns sometimes ARE the first word of a real brand. */
const COMPARAND_EXCLUDE_WORDS_BY_LANG: Record<Lang, string[]> = {
  en: ["what", "how", "why", "when", "where", "who", "which", "is", "are", "the", "a", "an", "for", "compare", "comparing", "compared", "between", "and", "or", "with", "from", "in", "on", "at", "to", "vs", "versus", "offers", "differences", "difference", "pros", "cons"],
  de: ["vergleich", "vergleichen", "vergleicht", "vergleiche", "zwischen", "und", "oder", "gegenüber", "gegen", "unterschied", "unterschiede", "im", "der", "die", "das"],
  fr: ["comparaison", "comparaisons", "comparer", "entre", "et", "ou", "contre", "différence", "différences"],
  es: ["comparación", "comparar", "entre", "y", "o", "u", "e", "contra", "diferencia", "diferencias"],
};
const COMPARAND_EXCLUDE_WORDS = new Set(SUPPORTED_LANGS.flatMap(l => COMPARAND_EXCLUDE_WORDS_BY_LANG[l]));

/** Personal pronouns / possessive determiners, per language (#3, 2026-11-19:
 *  "We"/"Wir" and similar sentence-initial capitalized pronouns passed
 *  isComparandToken's `/^[A-Z]/` capitalization check and were misread as a
 *  comparand — e.g. "We compared O2 vs Telekom..." extracted "We" as a 3rd
 *  comparand). Kept in a SEPARATE table from COMPARAND_EXCLUDE_WORDS_BY_LANG
 *  above, on purpose: a pronoun, unlike a preposition/article, sometimes IS
 *  the real first word of a brand ("Us Weekly", "WIR Bank", "She Media") — a
 *  blanket identity exclusion dropped those (review round 2, HIGH #3,
 *  live-reproduced: "compare Us Weekly vs People magazine" →
 *  ["Weekly","People"], losing "Us"). isPronounActuallyComparand (below)
 *  is the ONE discriminator rule applied to every word in this table; a 5th
 *  language or a newly-noticed pronoun is still just a new array entry. */
const COMPARAND_PRONOUN_WORDS_BY_LANG: Record<Lang, string[]> = {
  en: ["we", "us", "our", "ours", "i", "you", "your", "yours", "they", "them", "their", "theirs", "he", "she", "him", "her", "hers", "it", "its", "this", "that", "these", "those"],
  de: ["wir", "uns", "unser", "unsere", "ich", "mich", "mir", "du", "dich", "dir", "sie", "ihr", "ihre", "ihnen", "er", "es", "diese", "dieser", "dieses"],
  fr: ["nous", "notre", "nos", "je", "tu", "vous", "votre", "vos", "ils", "elles", "il", "elle", "leur", "leurs"],
  es: ["nosotros", "nosotras", "nuestro", "nuestra", "yo", "tú", "usted", "ustedes", "ellos", "ellas", "él", "su", "sus"],
};
const COMPARAND_PRONOUN_WORDS = new Set(SUPPORTED_LANGS.flatMap(l => COMPARAND_PRONOUN_WORDS_BY_LANG[l]));

/**
 * The one discriminator rule for every COMPARAND_PRONOUN_WORDS entry: a
 * pronoun/determiner reads as the REAL pronoun (and should be dropped) only
 * when it is either standing alone or followed by a lowercase verb/connector
 * ("We compared...", "Wir vergleichen...", "Nous comparons..."). It reads as
 * the first word of a real brand (and should be KEPT) when either:
 *   (a) it is written in ALL CAPS at length ≥2 — ordinary pronoun usage is
 *       essentially never all-caps, so this reads as an acronym/brand
 *       ("WIR" the bank, "IT" the department) regardless of what follows, or
 *   (b) the very next token is itself a comparand candidate by
 *       isComparandToken's own rule — the SAME capitalization check that
 *       keeps "Deutsche Telekom" whole also joins this pronoun-shaped token
 *       to the next one ("Us" + "Weekly", "She" + "Media").
 * `clean` is the token with its own trailing punctuation already stripped
 * (same `clean` isComparandToken computes); `nextRaw` is the RAW next token
 * (punctuation stripped here, once, same as every other token in the scan).
 */
function isPronounActuallyComparand(clean: string, nextRaw: string | undefined): boolean {
  if (clean.length >= 2 && clean === clean.toUpperCase() && clean !== clean.toLowerCase()) return true;
  if (nextRaw === undefined) return false;
  const nextClean = nextRaw.replace(/[?!.,:;()]/g, "");
  if (nextClean.length === 0) return false;
  return isComparandToken(nextClean);
}

/** List-connector words, per language — these close the CURRENT comparand
 *  phrase but the list keeps going (Oxford-comma handling below), AND cover
 *  "vs"-chains ("A vs B vs C vs D") the SAME way, not as a special case
 *  (review round 2, HIGH #2: comparison connectors are ONE class). Union
 *  across languages for the same reason as COMPARAND_EXCLUDE_WORDS. Trailing
 *  punctuation like "vs." is stripped from tokens before lookup, so a bare
 *  "vs" entry covers it. */
const LIST_CONNECTOR_WORDS_BY_LANG: Record<Lang, string[]> = {
  en: ["and", "or", "vs", "versus"],
  de: ["und", "oder", "vs", "versus", "gegen"],
  fr: ["et", "ou", "vs", "versus", "contre"],
  es: ["y", "e", "o", "u", "vs", "versus", "contra"],
};
const LIST_CONNECTOR_WORDS = new Set(SUPPORTED_LANGS.flatMap(l => LIST_CONNECTOR_WORDS_BY_LANG[l]));
const LIST_CONNECTOR_REGEX_SOURCE = `\\b(${[...LIST_CONNECTOR_WORDS].join("|")})\\b`;

/** Generic/common nouns, per language, that must NEVER be absorbed into a
 *  2-word comparand phrase even though they're capitalized in German (every
 *  German noun is) or otherwise look brand-like — e.g. "Telekom
 *  Geschäftskunden" → comparand "Telekom" (not "Telekom Geschäftskunden"),
 *  "O2 Business" → comparand "O2". Table-driven (review round 2, MEDIUM #4):
 *  a 5th language or a newly-noticed generic noun is a new array entry, not
 *  an ad-hoc length tweak. */
const GENERIC_NOUN_WORDS_BY_LANG: Record<Lang, string[]> = {
  en: ["business", "enterprise", "cloud", "services", "solutions", "group", "corp", "inc"],
  de: ["geschäftskunden", "unternehmen", "kunden", "bevölkerung", "einwohner", "gmbh", "ag", "mobilfunk"],
  fr: ["entreprise", "entreprises", "clients", "population"],
  es: ["empresa", "empresas", "clientes", "población"],
};
const GENERIC_NOUNS = new Set(SUPPORTED_LANGS.flatMap(l => GENERIC_NOUN_WORDS_BY_LANG[l]));

/** Real brand names are never this long — a defensive cap so a pathological
 *  input can never reach buildComparisonTopicResidual's regex construction
 *  with an unbounded-length comparand (review round 2, LOW: defense in depth
 *  alongside novadaResearch's own QUESTION_MAX_LENGTH gate upstream). */
const MAX_COMPARAND_TOKEN_LENGTH = 60;

/** A token counts as a comparand candidate when it's capitalized (proper
 *  noun, works for "O2"/"Telekom"/"Deutsche"), an alnum brand token like
 *  "O2"/"5G" (letter+digit either order), or has an internal lowercase→
 *  uppercase hump like "eBay"/"iPhone" (review round 2, MEDIUM #4:
 *  lowercase-initial brands) — and isn't one of the syntax words above.
 *  `nextRaw` (the RAW next token in the scan, undefined at end of input) is
 *  only consulted when `token` is a pronoun/determiner (COMPARAND_PRONOUN_
 *  WORDS) — see isPronounActuallyComparand's doc comment for the rule. */
function isComparandToken(token: string, nextRaw?: string): boolean {
  const clean = token.replace(/[?!.,:;()]/g, "");
  if (clean.length < 2 || clean.length > MAX_COMPARAND_TOKEN_LENGTH) return false;
  const lower = clean.toLowerCase();
  if (COMPARAND_EXCLUDE_WORDS.has(lower)) return false;
  if (COMPARAND_PRONOUN_WORDS.has(lower) && !isPronounActuallyComparand(clean, nextRaw)) return false;
  if (/^[A-Z]/.test(clean)) return true;
  if (/^[A-Za-z]+\d+$/.test(clean) || /^\d+[A-Za-z]+$/.test(clean)) return true;
  if (/[a-z][A-Z]/.test(clean)) return true;
  return false;
}

/** Max tokens grouped into one comparand phrase. Caps at 2 so a genuine
 *  two-word brand ("Deutsche Telekom") survives whole. The GENERIC_NOUNS
 *  check below (not this cap alone) is what stops a trailing common noun
 *  from being swallowed as the comparand's 2nd word. */
const MAX_COMPARAND_PHRASE_WORDS = 2;

/** Extract candidate comparands from a comparison question. Groups adjacent
 *  comparand tokens into one phrase (comma or list-connector = hard
 *  boundary even between two capitalized tokens, so "O2, Telekom" stays two
 *  comparands while "Deutsche Telekom" — no separator between them — stays
 *  one; "A vs B vs C vs D" stays four, since "vs" is a connector, not a
 *  list-terminator). A generic noun right after a single-word comparand ends
 *  that phrase at one word instead of extending it to two. Stops entirely
 *  once ≥2 comparands have been found and the list is closed by an ordinary
 *  word, so trailing topic/location words ("in Germany: prices, speeds...")
 *  are never misread as more comparands. */
export function extractComparands(question: string): string[] {
  if (!COMPARISON_TRIGGER_REGEX.test(question)) return [];

  const rawTokens = question.split(/\s+/);
  const phrases: string[] = [];
  let current: string[] = [];
  let listClosed = false;

  const flush = (): void => {
    if (current.length > 0) {
      phrases.push(current.join(" "));
      current = [];
    }
  };

  for (let i = 0; i < rawTokens.length; i++) {
    if (listClosed) break;
    const raw = rawTokens[i];
    const clean = raw.replace(/[?!.,:;()]/g, "");
    if (clean.length === 0) { flush(); continue; }
    const hadComma = /,$/.test(raw);
    const lowerClean = clean.toLowerCase();

    if (current.length === 1 && GENERIC_NOUNS.has(lowerClean)) {
      // review round 2, MEDIUM #4: a generic noun right after a single-word
      // comparand ends THIS phrase at one word ("Telekom Geschäftskunden" →
      // comparand "Telekom") instead of being absorbed by the 2-word cap.
      flush();
      if (phrases.length >= 2) listClosed = true;
      continue;
    }

    // #3 Round 2: pass the RAW next token so a pronoun/determiner candidate
    // (COMPARAND_PRONOUN_WORDS) can apply isPronounActuallyComparand's
    // look-ahead rule. Irrelevant for every other token (ignored unless the
    // current token is actually in that table).
    if (isComparandToken(clean, rawTokens[i + 1]) && current.length < MAX_COMPARAND_PHRASE_WORDS) {
      current.push(clean);
      if (hadComma) flush();
    } else if (LIST_CONNECTOR_WORDS.has(lowerClean)) {
      // "and"/"und"/"vs"/"versus"/... closes the CURRENT phrase but the list
      // keeps going — both an Oxford-comma list ("X, Y, Z and W") and a
      // "vs"-chain ("A vs B vs C vs D") put a connector before the LAST
      // item, not after it, so this must never end the scan (review round 2,
      // HIGH #2: connectors are one shared class, not a comma-only special case).
      flush();
    } else {
      // Any other non-comparand word genuinely ends the list (topic/
      // location words that follow, e.g. "in Germany: prices, speeds...").
      flush();
      if (phrases.length >= 2) listClosed = true;
    }
  }
  flush();

  return [...new Set(phrases)];
}

/** Build the residual topic/noun-phrase left after removing every detected
 *  comparand and the comparison trigger/connector words from the question —
 *  e.g. "O2, Telekom und Deutsche Telekom Geschäftskunden Internet
 *  Vergleich" minus its 3 comparands → "Geschäftskunden Internet". Appended
 *  to each per-comparand query so it stays specific instead of bare brand
 *  names. Filtered through every supported language's signal words and
 *  capped so a long tail clause doesn't balloon every comparand query. */
function buildComparisonTopicResidual(topic: string, comparands: string[]): string {
  let residual = topic;
  for (const rawComparand of comparands) {
    // Defensive length cap (review round 2, LOW) — never build a regex from
    // an unbounded-length comparand, even though isComparandToken already
    // rejects anything this long before it can reach extractComparands' output.
    const c = rawComparand.length > MAX_COMPARAND_TOKEN_LENGTH
      ? rawComparand.slice(0, MAX_COMPARAND_TOKEN_LENGTH)
      : rawComparand;
    const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    residual = residual.replace(new RegExp(`\\b${escaped}\\b`, "i"), " ");
  }
  // Fresh global copies for replacement — COMPARISON_TRIGGER_REGEX itself
  // stays non-global so its repeated .test() calls elsewhere (detectDomain,
  // extractComparands) never accumulate lastIndex state across calls.
  residual = residual.replace(new RegExp(COMPARISON_TRIGGER_REGEX.source, "gi"), " ");
  residual = residual.replace(new RegExp(LIST_CONNECTOR_REGEX_SOURCE, "gi"), " ");
  residual = residual.replace(/[,:;]/g, " ");

  const words = residual.split(/\s+/).filter(Boolean);
  const content = words.filter(w => {
    // Stray punctuation debris (e.g. a lone "." left behind when "vs." is
    // matched without its trailing dot — `\b` cannot assert a boundary
    // between a dot and a following space, so the regex above backtracks to
    // leave the dot unconsumed) is never usable query text.
    if (!/[a-z0-9]/i.test(w)) return false;
    const lower = w.toLowerCase();
    return !STOP_WORDS.has(lower) && !ALL_SIGNAL_WORDS.has(lower) && !COMPARAND_EXCLUDE_WORDS.has(lower);
  });
  return content.slice(0, 6).join(" ");
}

/** Check whether a comparand appears in any of the collected sources */
function comparandHasHits(
  comparand: string,
  sources: { title: string; url: string; snippet: string }[],
): boolean {
  const lower = comparand.toLowerCase();
  return sources.some(s =>
    s.title.toLowerCase().includes(lower) ||
    s.url.toLowerCase().includes(lower) ||
    s.snippet.toLowerCase().includes(lower)
  );
}

// ─── Main Research Function ────────────────────────────────────────────────

export async function novadaResearch(
  params: ResearchParams,
  apiKey: string,
  onProgress?: ProgressReporter
): Promise<string> {
  // Support 'query' as alias for 'question' (matches other tools' param naming)
  if (!params.question && params.query) {
    params = { ...params, question: params.query };
  }
  // FIX-2: Reject over-long questions immediately — prevents huge strings causing hangs.
  const questionText = (params.question ?? "").trim();
  if (questionText.length > QUESTION_MAX_LENGTH) {
    throw makeNovadaError(
      NovadaErrorCode.INVALID_PARAMS,
      `question exceeds maximum length of ${QUESTION_MAX_LENGTH} characters (got ${questionText.length}). Shorten your question and retry.`,
      `question_length:${questionText.length} max:${QUESTION_MAX_LENGTH}`
    );
  }
  if (questionText !== (params.question ?? "")) {
    params = { ...params, question: questionText };
  }
  // Resolve depth — 'auto' picks based on question complexity heuristic
  // F14-3: Track requested vs resolved depth separately for provenance
  const requestedDepth = params.depth || "auto";
  const resolvedDepth = resolveDepth(requestedDepth, params.question ?? "");
  const isDeep = resolvedDepth === "deep" || resolvedDepth === "comprehensive";
  const isComprehensive = resolvedDepth === "comprehensive";

  const queries = generateSearchQueries(params.question ?? "", isDeep, isComprehensive, params.focus);

  // NOV-319 phase 1/4: searching (no-op when no progressToken).
  await reportProgress(onProgress, {
    progress: 1,
    total: RESEARCH_PHASES,
    message: `Searching the web (${queries.length} queries)`,
  });

  // C1: shared flag — set true only when a search failure carried a real
  // auth/entitlement signal. Used to gate the permanent "Scraper API not
  // activated" verdict below; without it, a transient blip is reported as retryable.
  const authSignal = { entitlement: false };

  // Execute all queries in parallel; within each query, searchWithFallback tries
  // the primary engine (google) first and only races the fallbacks (ddg + bing)
  // if the primary returns nothing — this saves ~2/3 of API cost vs racing all 3.
  const researchFilterParams: ResearchFilterParams = {
    time_range: params.time_range,
    start_date: params.start_date,
    end_date: params.end_date,
  };

  const allResults = await Promise.all(
    queries.map(async (query): Promise<{ query: string; results: NovadaSearchResult[]; failed?: boolean }> => {
      const results = await searchWithFallback(apiKey, query, 5, authSignal, researchFilterParams);
      if (results.length > 0) {
        return { query, results };
      }
      // All engines failed — one retry with simplified query
      const retryQuery = query
        .replace(/site:\S+/gi, "")
        .replace(/["']/g, "")
        .replace(/\s+OR\s+\S+/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (retryQuery && retryQuery !== query) {
        const retryResults = await searchWithFallback(apiKey, retryQuery, 5, authSignal, researchFilterParams);
        if (retryResults.length > 0) {
          return { query: retryQuery, results: retryResults };
        }
      }
      return { query, results: [], failed: true };
    })
  );

  const failedCount = allResults.filter(r => r.failed).length;
  const succeededCount = allResults.length - failedCount;
  const failedQueries = allResults.filter(r => r.failed).map(r => r.query);
  const totalResults = allResults.reduce((sum, r) => sum + r.results.length, 0);
  const uniqueSources = new Map<string, { title: string; url: string; snippet: string }>();

  for (const { results } of allResults) {
    for (const r of results) {
      // FIX A (2026-07-30): the bing.com fallback engine (searchWithFallback
      // above) can put a raw `bing.com/ck/a` tracking redirect into r.url —
      // decode it to the real destination BEFORE dedup/normalize so (a) the
      // agent gets a citable, directly-fetchable URL instead of a redirect it
      // would otherwise have to base64-decode by hand, (b) novadaExtract below
      // fetches the real page rather than the tracking hop, and (c) two
      // differently-tracked redirects to the same real URL correctly collapse
      // into one source instead of appearing as duplicates. decodeBingRedirect
      // never throws — a non-bing URL (the common case) passes through unchanged.
      const rawUrl: string = decodeBingRedirect(r.url || r.link || "");
      // research-query-quality-2026-11-14 review round 2: use the dedup-only
      // normalizer here (strips locale/tracking params), NOT plain
      // normalizeUrl — that one is also crawl/map/site_copy's traversal key
      // and must stay conservative (see utils/url.ts).
      const normalized = normalizeUrlForResultDedup(rawUrl);
      if (normalized && !uniqueSources.has(normalized)) {
        const rawSnippet = r.description || r.snippet || "";
        const cleanSnippet = rawSnippet
          .replace(/\.{3}\s*Read\s+more\s*$/i, "...")
          .replace(/\s+Read\s+more\s*$/i, "")
          .trim();
        uniqueSources.set(normalized, {
          title: r.title || "Untitled",
          url: rawUrl,
          snippet: cleanSnippet,
        });
      }
    }
  }

  const sources = [...uniqueSources.values()].slice(0, 15);

  // NOV-319 phase 2/4: sources collected & deduped.
  await reportProgress(onProgress, {
    progress: 2,
    total: RESEARCH_PHASES,
    message: `Collected ${sources.length} unique sources from ${succeededCount}/${queries.length} queries`,
  });

  // Phase 2: Extract top 5 source URLs for full content (up from 3)
  const topSources = sources.slice(0, 5);
  const extractedContents: { title: string; url: string; content: string }[] = [];
  // Track sources where extraction failed — we still use their snippets
  const extractFailedSources: { title: string; url: string; snippet: string }[] = [];

  if (topSources.length > 0) {
    const extractResults = await Promise.allSettled(
      topSources.map(async (source) => {
        try {
          const rawContent = await novadaExtract(
            { url: source.url, format: "markdown", query: params.question, render: "auto" },
            apiKey
          );
          // Round 6 (review HIGH, class fix): novadaExtract is called in-process here —
          // this consumer is OUTSIDE the one transport choke point (applyHonestFailureFlag
          // in index.ts/mcp.ts), so it must detect failure via isToolFailure() itself,
          // never by re-deriving its own copy of extract.ts's failure heading text. The
          // old `content.startsWith("## Extract Failed" | "## Extraction Error")` check
          // silently broke the moment toolFailure() started prepending an invisible
          // marker ahead of that text — every failed extraction's error text was treated
          // as source material instead of being skipped (round-3f-gap.test.ts's mock of
          // the bare unmarked string stayed green for a world that no longer exists).
          if (isToolFailure(rawContent)) {
            return { ok: false as const, title: source.title, url: source.url, snippet: source.snippet };
          }
          const content = stripToolFailureMark(rawContent);
          // Strip all extract-output metadata — only keep the page body content.
          // R1/R9: extract prepends a save-header — `📁 ...` (local) or `path: ...`
          // (hosted, often EMPTY as `path: `). Both must be removed or the dangling
          // `path:` label leaks in as the first "sentence" of the synthesis.
          const strippedContent = content
            .replace(/^📁[^\n]*\n\n/, "")
            .replace(/^path:[^\n]*\n\n/, "");
          // Strip the ## Extracted Content metadata block (url: ... | mode: ... | quality: ...)
          let cleaned = strippedContent.replace(/^## Extracted Content\n(?:.*\n)*?---\n\n?/m, "");
          // Strip ## Structured Data block (JSON-LD: type, headline, author, datePublished etc.)
          cleaned = cleaned.replace(/^## Structured Data\n(?:.*\n)*?---\n\n?/m, "");
          // Strip ## Requested Fields block
          cleaned = cleaned.replace(/^## Requested Fields[^\n]*\n(?:.*\n)*?---\n\n?/m, "");
          // Strip ## Same-Domain Links block
          cleaned = cleaned.replace(/## Same-Domain Links[^\n]*\n(?:[\s\S]*?)(?=\n## |\n---\n|$)/, "");
          // Strip ## Extraction Diagnostics block
          cleaned = cleaned.replace(/## Extraction Diagnostics\n(?:[\s\S]*?)(?=\n## |\n---\n|$)/, "");
          // Strip ## Agent Memory block
          cleaned = cleaned.replace(/## Agent Memory\n(?:[\s\S]*?)(?=\n## |\n---\n|$)/, "");
          // Strip trailing metadata sections: Agent Hints, Agent Action
          const cleanContent = cleaned.split("## Agent Hints")[0].split("## Agent Action")[0].trim();
          // G-2 (no double-wrap): novadaExtract's body is ALREADY wrapUntrusted-wrapped
          // (G-2's own coverage of extract.ts). Unwrap it here, BEFORE it enters
          // splitSentences/selectExtractForSource below — otherwise the delimiter
          // lines (they end in a period, so they parse as "sentences") can leak
          // through as garbage excerpt candidates, AND assembleSourceMaterial's
          // formatter wraps the selected excerpt a second time, producing nested
          // markers. External text must be marked EXACTLY once in the final
          // response — research.ts's own wrap (below, around e.extract) is that
          // one mark; this call keeps the intermediate NLP pipeline unwrapped.
          const unwrappedContent = unwrapUntrusted(cleanContent);
          return { ok: true as const, title: source.title, url: source.url, content: unwrappedContent };
        } catch {
          return { ok: false as const, title: source.title, url: source.url, snippet: source.snippet };
        }
      })
    );

    for (const result of extractResults) {
      if (result.status === "fulfilled" && result.value) {
        if (result.value.ok) {
          extractedContents.push({
            title: result.value.title,
            url: result.value.url,
            content: result.value.content,
          });
        } else {
          extractFailedSources.push({
            title: result.value.title,
            url: result.value.url,
            snippet: result.value.snippet ?? "",
          });
        }
      }
    }
  }

  // NOV-319 phase 3/4: top sources extracted.
  await reportProgress(onProgress, {
    progress: 3,
    total: RESEARCH_PHASES,
    message: `Extracted ${extractedContents.length} full source(s), ${extractFailedSources.length} snippet-only`,
  });

  const topic = params.question ?? "";
  const queryValue = params.query ?? params.question ?? "";
  const depthValue = resolvedDepth;
  // F14-3: keep requested depth for provenance (auto → deep/quick is a lossy transform without this)
  const requestedDepthValue = requestedDepth;

  // All searches failed or returned 0 results. C1: classify honestly — only a
  // real auth/entitlement signal justifies the permanent "Scraper API not
  // activated" verdict. A transient timeout/5xx/DNS blip across every query
  // produces the SAME failed-count state, so without this gate a temporary
  // outage becomes a false permanent "activate the Scraper API" dead-end.
  if (failedCount === queries.length || totalResults === 0) {
    if (authSignal.entitlement) {
      return toolFailure([
        `## Research Unavailable`,
        ``,
        `Search failed with an account/authorization error. The Scraper API (which powers search) is not activated on this API key, or the key is invalid.`,
        ``,
        `**Cannot complete research on:** "${topic}"`,
        ``,
        `**Fix:**`,
        `- Activate the Scraper API at https://dashboard.novada.com/overview/scraper/`,
        `- Run \`novada_account(section="summary")\` to check which API products are active on your account`,
        ``,
        `**Alternatives while search is unavailable:**`,
        `- Use \`novada_extract\` with specific URLs you already know`,
        `- Use \`novada_map\` on a relevant site, then \`novada_extract\` on discovered pages`,
        ``,
        `## Agent Action`,
        `agent_instruction: status:search_unavailable | action: call novada_account(section="summary") to confirm, then activate_scraper_api | question_not_answered: true`,
      ].join("\n"));
    }
    // No auth signal → transient / no-results. Retry is the real remedy; do NOT
    // assert a permanent activation defect.
    return toolFailure([
      `## Research Incomplete`,
      ``,
      `All search queries returned 0 results — likely a temporary upstream issue (timeout, rate-limit, or a query that matched nothing), not an account problem.`,
      ``,
      `**Cannot complete research on:** "${topic}"`,
      ``,
      `**Fix:**`,
      `- Retry this call once — transient search failures usually clear on retry`,
      `- If it persists, run \`novada_account(section="summary")\` to confirm the Scraper API is active`,
      ``,
      `**Alternatives right now:**`,
      `- Use \`novada_extract\` with specific URLs you already know`,
      `- Use \`novada_map\` on a relevant site, then \`novada_extract\` on discovered pages`,
      ``,
      `## Agent Action`,
      `agent_instruction: status:search_temporarily_failed | action: retry_once; if it persists call novada_account(section="summary") | question_not_answered: true`,
    ].join("\n"));
  }

  // NOV-319 phase 4/4: assembling the cited source material.
  await reportProgress(onProgress, {
    progress: 4,
    total: RESEARCH_PHASES,
    message: "Assembling cited source material",
  });

  // Assemble grounded, cited SOURCE MATERIAL (one relevant extract per top source).
  // No synthesis is claimed — the consuming agent composes the answer from this.
  const { extracts, quality: materialQuality } = assembleSourceMaterial(topic, extractedContents, extractFailedSources, sources);

  // Build Key Findings bullets from sources with snippets
  const findingBullets: string[] = sources.length > 0
    ? sources.map(s => `- **${s.title}** (${s.url})${s.snippet ? ` — ${s.snippet}` : ""}`)
    : [`- No structured findings extracted.`];

  // Build Sources table — include both extracted and snippet-only sources
  const sourceRows: { label: string; url: string; note: string }[] = [];
  for (const s of extractedContents) {
    sourceRows.push({ label: sourceLabel(s.title, s.url), url: s.url, note: "full content extracted" });
  }
  for (const s of extractFailedSources) {
    sourceRows.push({ label: sourceLabel(s.title, s.url), url: s.url, note: "snippet only" });
  }

  // Agent hints. The material above is complete and cited — the consuming agent
  // should compose the answer from it, NOT make follow-up extract calls (that was
  // the original complaint). Only on genuine insufficiency do we suggest recovery.
  const agentHints: string[] = [];
  if (materialQuality === "insufficient") {
    agentHints.push(
      `- Material is thin — if the above is not enough, \`novada_extract\` these URLs directly: ${sources.slice(0, 3).map(s => s.url).join(", ") || "none available"}.`
    );
  } else {
    agentHints.push(`- Compose the user's answer directly from the cited source material above; cite claims with the [n] markers. No further calls are needed.`);
    if (materialQuality === "snippets") {
      agentHints.push(`- Material is snippet-level (full-page extraction was thin/blocked) — good for a summary; use depth='comprehensive' or a narrower \`focus\` if you need deeper detail.`);
    }
  }
  agentHints.push(`- For narrower research: add \`focus\` param to guide sub-query generation.`);
  if (!isComprehensive) {
    agentHints.push(`- For more coverage: use depth='comprehensive' (8-10 searches).`);
  }
  if (failedCount > 0) {
    agentHints.push(`- ${failedCount} of ${queries.length} search queries failed; coverage may be incomplete.`);
  }
  // F14-2: Check for comparison questions where a named comparand has zero hits across all sources
  if (detectDomain(topic) === "comparison") {
    const comparands = extractComparands(topic);
    for (const comparand of comparands) {
      if (!comparandHasHits(comparand, sources)) {
        agentHints.push(`- Warning: no results found for comparand "${comparand}" — coverage may be one-sided. Try searching for "${comparand}" directly.`);
      }
    }
  }

  let finalReport = formatResearchOutput({
    topic,
    query: queryValue,
    depth: depthValue,
    requestedDepth: requestedDepthValue,
    queriesSucceeded: succeededCount,
    queriesTotal: queries.length,
    generatedQueries: queries,
    failedQueries,
    sourcesFetchedCount: extractedContents.length,
    snippetOnlyCount: extractFailedSources.length,
    extracts,
    materialQuality,
    findingBullets,
    sourceRows,
    agentHints,
  });

  // Wire output save — best-effort, never breaks the tool
  // FIX-1: Redact absolute path before embedding in agent-visible output.
  try {
    const outputResult = await saveOutput({
      tool: "research",
      hint: params.question?.slice(0, 30) || params.query?.slice(0, 30) || "research",
      format: "md",
      data: finalReport,
      project: params.project,
    });
    // R1: only surface the save line when a file was actually written. On hosted
    // (Vercel) saveOutput returns an empty filePath — a dangling "Research saved:"
    // with no path was leaking into every response tail.
    if (outputResult.filePath) {
      finalReport += `\n\n---\nResearch saved: ${redactSecrets(outputResult.filePath)}`;
    }
  } catch { /* best-effort */ }

  return finalReport;
}

// ─── Nav-Chrome Detection ──────────────────────────────────────────────────
// Patterns that indicate page navigation/header chrome (not substantive content).
//
// Two classes:
//  STRONG_CHROME_PATTERNS — always chrome regardless of line length (no risk of false-positives
//    on substantive text because these exact phrases never appear mid-sentence in research content)
//  CONTEXT_SENSITIVE_PATTERNS — chrome ONLY when the line is short (< CONTEXT_LENGTH_THRESHOLD).
//    These phrases ("sign in", "privacy policy", "terms of service", "cookie consent",
//    "cookie policy") can also appear as SUBJECT MATTER in substantive sentences
//    (OAuth docs, GDPR compliance, ePrivacy legal analysis). A standalone short
//    link/list item is ≤ CONTEXT_LENGTH_THRESHOLD chars; a substantive sentence is longer.

const CONTEXT_LENGTH_THRESHOLD = 80; // chars; short enough to catch "Sign in", "Cookie policy", etc.

const STRONG_CHROME_PATTERNS: RegExp[] = [
  /\[?skip\s+to\s+(main\s+)?content\]?/i,
  /\btoggle\s+navigation\b/i,
  /\bnavigation\s+menu\b/i,
  /\bopen\s+menu\b/i,
  /\bclose\s+menu\b/i,
  /^\[.*?\]\s*$/,           // lines that are entirely "[something]"
];

const CONTEXT_SENSITIVE_PATTERNS: RegExp[] = [
  /\bsign\s+(in|up)\b/i,       // nav affordance on short lines; OAuth/SSO subject on long lines
  /\bprivacy\s+policy\b/i,     // footer link on short lines; GDPR subject on long lines
  /\bterms\s+(of\s+)?(service|use)\b/i, // footer link on short lines; legal subject on long lines
  // C5 fix: cookie-consent / cookie-policy moved from STRONG_CHROME to CONTEXT_SENSITIVE so
  // substantive GDPR/ePrivacy sentences (> CONTEXT_LENGTH_THRESHOLD chars) survive stripping,
  // while short nav links like "Cookie settings" / "Cookie policy" are still removed.
  /\b(cookie|cookies)\s+(settings|preferences|policy|consent|notice|banner)\b/i,
  // Round-3f fix P1: "accept cookies/tracking" moved from STRONG_CHROME to CONTEXT_SENSITIVE.
  // Short nav buttons ("Accept all cookies", "Accept tracking") are still stripped.
  // Substantive GDPR/ePrivacy sentences (>80 chars) that use these phrases as subject matter
  // (e.g. "websites must allow users to accept cookies on a purpose-by-purpose basis") survive.
  /\baccept\s+(all\s+)?(cookies|tracking)\b/i,
];

/** Returns true if a line/sentence is nav or header chrome */
function isNavChromeLine(text: string): boolean {
  if (STRONG_CHROME_PATTERNS.some(re => re.test(text))) return true;
  // Context-sensitive patterns: only treat as chrome when the line is a short affordance,
  // not when the phrase is embedded in a substantive sentence.
  if (text.length < CONTEXT_LENGTH_THRESHOLD && CONTEXT_SENSITIVE_PATTERNS.some(re => re.test(text))) return true;
  return false;
}

/** Returns the fraction of lines in a text that match nav-chrome patterns (0–1) */
// C14 fix: split on "\n" (same as stripNavChrome) so the 80-char CONTEXT_SENSITIVE length guard
// is evaluated per logical line, not per sentence fragment. Splitting on /[\n.!?]+/ broke
// multi-sentence paragraphs into sub-80-char pieces that falsely scored as chrome.
function chromeFraction(text: string): number {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return 0;
  const chromeLines = lines.filter(isNavChromeLine).length;
  return chromeLines / lines.length;
}

/** Strip nav-chrome lines from a fragment text. Returns cleaned text. */
function stripNavChrome(text: string): string {
  return text
    .split("\n")
    .filter(line => !isNavChromeLine(line.trim()))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// ─── Fragment scrubbing (R9) ─────────────────────────────────────────────────
// The nav-chrome line filter removes whole boilerplate LINES, but markdown link/
// image syntax, bracket/paren debris and bare URLs survive INSIDE otherwise-kept
// lines — and the sentence splitter then treats "](/support)" or "[![logo](url)]"
// as a "sentence", polluting the Summary. This scrubber strips that inline debris
// so only human-readable prose reaches the synthesis.

/** Strip markdown/HTML/URL debris from a text fragment, leaving readable prose. */
function scrubFragmentText(text: string): string {
  return text
    // images: ![alt](url) → drop entirely (alt text is rarely useful prose)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // links: [label](url) → keep the label only
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // orphaned link/image syntax left by line-wrapped markdown: "](/path)", "[", "!["
    .replace(/!?\]\([^)]*\)/g, " ")
    .replace(/!?\[[^\]]*$/gm, " ")
    .replace(/^\s*\]\S*/gm, " ")
    // bare URLs
    .replace(/https?:\/\/\S+/g, " ")
    // leftover markdown emphasis / list / table markup
    .replace(/[*_`>|]+/g, " ")
    .replace(/^\s*[-+]\s+/gm, " ")
    // collapse whitespace runs (incl. the wrapped-nav newlines)
    .replace(/\s+/g, " ")
    .trim();
}

/** Heuristic: does this fragment read as prose (vs residual link/nav debris)?
 *  Prose has enough words AND a healthy ratio of letters to punctuation/symbols. */
function looksLikeProse(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false;
  const words = t.split(/\s+/).filter(w => /[a-zA-Z]/.test(w));
  if (words.length < 8) return false;
  const letters = (t.match(/[a-zA-Z]/g) ?? []).length;
  // At least 60% of characters should be letters — debris (brackets, slashes,
  // punctuation runs) drags this ratio down.
  if (letters / t.length < 0.6) return false;
  // Reject fragments dominated by residual bracket/paren/slash debris.
  const debris = (t.match(/[[\]()/\\|]/g) ?? []).length;
  if (debris > words.length) return false;
  return true;
}

// ─── Source-material assembly ────────────────────────────────────────────────
// HONEST framing (re-audited): there is NO LLM in this process, so abstractive
// synthesis is impossible HERE — but the CONSUMER of this MCP tool IS an LLM (the
// agent in the chat). Stitching extracted sentences and labelling the result
// "synthesized" is dishonest (the QA verdict flagged visible seams like
// "Let's have a look into all 3..."). So this tool does the ONE thing it can do
// well and honestly: it assembles GROUNDED, CITED SOURCE MATERIAL — the most
// relevant, debris-free extract from each top source — so the consuming agent has
// everything it needs to write the answer itself in ONE call, with zero follow-up
// extract calls (that follow-up was the original complaint).
//
// Pipeline per source:
//   1. sentence pool  — split the full extracted body into clean, cited sentences
//   2. score          — query-relevance (TF) + cross-source consensus (centrality)
//                       + length prior − chrome/debris penalty
//   3. MMR selection  — pick the top few high-relevance, low-redundancy sentences
//                       for THIS source (a substantive extract, not one line)
// Falls back to search snippets when a body doesn't extract cleanly, and reports
// honest insufficiency only when there is genuinely 0 usable content.

type MaterialQuality = "grounded" | "snippets" | "insufficient";

/** A cited, debris-free extract of the relevant content from one source. */
interface SourceExtract {
  index: number;   // 1-based citation number, aligned with the Sources table
  title: string;
  url: string;
  extract: string; // multi-sentence relevant material (not a one-line snippet)
  grounded: boolean; // true = from full-body extraction; false = search snippet
}

interface ScoredSentence {
  text: string;
  sourceIdx: number;   // index into the ordered source list (for [n] citation)
  source: string;      // source title
  tokens: Set<string>; // content tokens, for centrality + MMR similarity
  score: number;
}

/** Tokenize to content words (drop stop-words + short tokens). Used for scoring. */
function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/** Jaccard similarity between two token sets (0–1) — MMR redundancy signal. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Tool/config debris that can survive extract.ts metadata stripping and leak into
// the sentence pool (bot-challenge hints, browser-WS setup lines, agent-instruction
// echoes, dashboard/env prompts). These are never part of a page's substantive prose,
// so a sentence containing any of them is dropped outright before synthesis.
const TOOL_META_PATTERNS: RegExp[] = [
  /\bNOVADA_[A-Z_]+\b/,                       // env var names (NOVADA_BROWSER_WS, ...)
  /\brender\s*=\s*["']?(browser|render|auto|static|js)\b/i,
  /\bnovada_(extract|unblock|research|search|scrape|map|crawl)\s*\(/i,
  /\bsuggested_fix\s*:/i,
  /\bagent_instruction\s*:/i,
  /\bdashboard\.novada\.com\b/i,
  /\bBrowser API\b.*\bcosts?\b/i,
  /\bbot[- ]?challenge\b/i,
  /\bset\s+NOVADA_/i,
];

// Forum / social-UI chrome that reads like prose (letters + words) but is site
// furniture, not substantive content — Reddit vote widgets, account prompts, comment
// metadata. Seen leaking LIVE from a reddit.com extraction into the Summary:
// "Create an account [–] user[S] 0 points1 point2 points 2 years ago (0 children)".
const SOCIAL_CHROME_PATTERNS: RegExp[] = [
  /\bcreate an account\b/i,
  /\d+\s*point(s)?\d*\s*point/i,             // "0 points1 point2 points" vote widget
  /\b\d+\s+points?\b[\s\S]*\bago\b/i,        // score followed by "N years ago"
  /\(\s*\d+\s+child(ren)?\s*\)/i,            // "(0 children)"
  /\[\s*[–\-+]\s*\]/,                         // [–] / [-] / [+] collapse toggles
  /\[S\]|\[OP\]|\[deleted\]|\[removed\]/,     // reddit submitter/OP/removed markers
  /\b(log in|sign in|sign up)\s+(or|to)\b/i, // "log in or sign up"
  /\bpermalink\s*embed\s*save\b/i,            // reddit action bar (run-together)
  /\bupvote|downvote\b/i,
];

/** Split one cleaned text blob into candidate prose sentences. */
function splitSentences(raw: string): string[] {
  const deChromed = stripNavChrome(raw.replace(/^#+.*$/gm, ""));
  const scrubbed = scrubFragmentText(deChromed);
  const parts = scrubbed.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [scrubbed];
  return parts
    .map(s => s.trim())
    .filter(s => s.length >= 30 && s.length <= 400)
    .filter(s => {
      const words = s.split(/\s+/);
      if (words.length < 6) return false;              // too short to be a claim
      const letters = (s.match(/[a-zA-Z]/g) ?? []).length;
      if (letters / s.length < 0.6) return false;      // reject debris-heavy lines
      if (TOOL_META_PATTERNS.some(re => re.test(s))) return false;   // tool/config debris
      if (SOCIAL_CHROME_PATTERNS.some(re => re.test(s))) return false; // forum/social UI chrome
      return true;
    });
}

/** Score a source's sentences by query relevance + corpus centrality + shape, then
 *  MMR-select the top few into a substantive, non-redundant extract for THAT source.
 *  `corpus` is the pooled tokens across ALL sources — centrality rewards sentences
 *  whose content recurs across the research set (consensus signal). */
function selectExtractForSource(
  sentences: string[],
  questionKeywords: Set<string>,
  corpus: ScoredSentence[],
  maxSentences: number,
): string {
  if (sentences.length === 0) return "";
  const scored: ScoredSentence[] = sentences.map(text => ({
    text, sourceIdx: 0, source: "", tokens: new Set(contentTokens(text)), score: 0,
  }));

  for (const s of scored) {
    let kwHits = 0;
    for (const kw of questionKeywords) if (s.text.toLowerCase().includes(kw)) kwHits++;
    const relevance = questionKeywords.size > 0 ? kwHits / questionKeywords.size : 0;

    let centrality = 0;
    if (corpus.length > 1) {
      let sum = 0;
      for (const o of corpus) if (o.text !== s.text) sum += jaccard(s.tokens, o.tokens);
      centrality = sum / (corpus.length - 1);
    }

    const words = s.text.split(/\s+/).length;
    const lengthPrior = words >= 12 && words <= 35 ? 1 : words < 12 ? 0.4 : 0.7;
    const chromePenalty = chromeFraction(s.text) > 0.4 ? 1 : 0;
    s.score = relevance * 3 + centrality * 2 + lengthPrior * 0.5 - chromePenalty * 10;
  }

  // MMR: relevant AND non-redundant within this source's extract.
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const lambda = 0.72;
  const DEDUP_THRESHOLD = 0.6;
  const picked: ScoredSentence[] = [];
  const remaining = [...ranked];
  while (picked.length < maxSentences && remaining.length > 0) {
    let bestIdx = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let maxSim = 0;
      for (const sel of picked) maxSim = Math.max(maxSim, jaccard(cand.tokens, sel.tokens));
      if (maxSim >= DEDUP_THRESHOLD) continue;
      const mmr = lambda * cand.score - (1 - lambda) * maxSim * 3;
      if (mmr > bestVal) { bestVal = mmr; bestIdx = i; }
    }
    if (bestIdx === -1) break;
    picked.push(remaining.splice(bestIdx, 1)[0]);
  }
  if (picked.length === 0) return "";

  // Keep the extract in the source's ORIGINAL reading order (not score order) so it
  // reads as a coherent passage from that page, not re-shuffled fragments.
  const orderInSource = new Map(sentences.map((t, i) => [t, i]));
  picked.sort((a, b) => (orderInSource.get(a.text) ?? 0) - (orderInSource.get(b.text) ?? 0));
  return picked.map(s => s.text.replace(/\s+/g, " ").trim()).join(" ");
}

/**
 * Assemble grounded, cited SOURCE MATERIAL for the question. Returns one extract per
 * top source (from the full extracted body where available, else the search snippet),
 * ordered to match the Sources table, plus a coverage quality flag. NO synthesis is
 * claimed — the consuming agent writes the answer from this material.
 */
function assembleSourceMaterial(
  question: string,
  extracted: { title: string; url: string; content: string }[],
  failedSources: { title: string; url: string; snippet: string }[],
  allSources: { title: string; url: string; snippet: string }[],
): { extracts: SourceExtract[]; quality: MaterialQuality } {
  const questionKeywords = new Set(
    question.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOP_WORDS.has(w))
  );

  // Ordered source list = extracted first, then snippet-only — matches the Sources
  // table order in the formatter so [n] citations line up.
  const orderedSources: { title: string; url: string }[] = [
    ...extracted.map(s => ({ title: s.title, url: s.url })),
    ...failedSources.map(s => ({ title: s.title, url: s.url })),
  ];

  // Build the shared corpus (all clean sentences from all extracted bodies) so
  // per-source centrality can reward cross-source consensus.
  const corpus: ScoredSentence[] = [];
  const bodySentences = new Map<string, string[]>();
  for (const src of extracted) {
    const sents = splitSentences(src.content);
    bodySentences.set(src.url, sents);
    for (const t of sents) corpus.push({ text: t, sourceIdx: 0, source: src.title, tokens: new Set(contentTokens(t)), score: 0 });
  }

  const extracts: SourceExtract[] = [];
  let index = 0;
  let groundedCount = 0;

  // On-topic gate: when the question has keywords, an extract that shares NONE of them
  // is off-topic page furniture (marketing/community/nav copy that reads like prose but
  // answers nothing) — e.g. "LM Community Join the community to learn from peers...".
  // Such material is worse than useless in a research report, so it is rejected.
  const isOnTopic = (text: string): boolean => {
    if (questionKeywords.size === 0) return true;
    const lower = text.toLowerCase();
    return [...questionKeywords].some(kw => lower.includes(kw));
  };

  // Extracted bodies → substantive per-source extracts.
  for (const src of extracted) {
    index++;
    const sents = bodySentences.get(src.url) ?? [];
    const extract = selectExtractForSource(sents, questionKeywords, corpus, 4);
    const snip = allSources.find(s => s.url === src.url)?.snippet ?? "";
    const cleanedSnippet = scrubFragmentText(snip);

    if (extract && looksLikeProse(extract) && isOnTopic(extract)) {
      // Full-body extract that actually addresses the question.
      extracts.push({ index, title: src.title, url: src.url, extract, grounded: true });
      groundedCount++;
    } else if (cleanedSnippet.length >= 20 && isOnTopic(cleanedSnippet)) {
      // Body was off-topic/debris-only → fall back to the on-topic search snippet.
      extracts.push({ index, title: src.title, url: src.url, extract: cleanedSnippet, grounded: false });
    } else {
      // Neither the body nor the snippet is usable/on-topic for this question.
      extracts.push({ index, title: src.title, url: src.url, extract: "(no clean, on-topic extract available — see Sources for the full URL)", grounded: false });
    }
  }

  // Snippet-only sources (extraction failed/blocked) → cite their clean, on-topic snippet.
  for (const src of failedSources) {
    index++;
    const cleaned = scrubFragmentText(src.snippet || "");
    const usable = cleaned.length >= 20 && isOnTopic(cleaned);
    extracts.push({
      index,
      title: src.title,
      url: src.url,
      extract: usable ? cleaned : "(extraction blocked — no on-topic snippet available; see Sources for the full URL)",
      grounded: false,
    });
  }

  // Quality: grounded when ≥1 source gave a real body extract; snippets when we only
  // have snippet-level material; insufficient when nothing usable at all.
  const anyUsable = extracts.some(e => !e.extract.startsWith("("));
  const quality: MaterialQuality = !anyUsable ? "insufficient" : groundedCount > 0 ? "grounded" : "snippets";

  // orderedSources is retained implicitly via extract.index/url — no further use here.
  void orderedSources;
  return { extracts, quality };
}

// ─── Output Formatting ─────────────────────────────────────────────────────

function formatResearchOutput(args: {
  topic: string;
  query: string;
  depth: string;
  requestedDepth: string;
  queriesSucceeded: number;
  queriesTotal: number;
  generatedQueries?: string[];
  failedQueries?: string[];
  sourcesFetchedCount: number;
  snippetOnlyCount: number;
  extracts: SourceExtract[];
  materialQuality: MaterialQuality;
  findingBullets: string[];
  sourceRows: { label: string; url: string; note: string }[];
  agentHints: string[];
}): string {
  const timestamp = new Date().toISOString();
  const materialQuality = args.materialQuality;
  const hasMaterial = materialQuality !== "insufficient" && args.extracts.some(e => !e.extract.startsWith("("));

  // Build the "Researched source material" block: one cited extract per top source.
  // This is the honest deliverable — grounded material the consuming agent turns
  // into the answer, NOT a fake-synthesized paragraph.
  const materialLines: string[] = [];
  if (hasMaterial) {
    for (const e of args.extracts) {
      const label = sourceLabel(e.title, e.url);
      const tag = e.grounded ? "extracted" : "snippet";
      materialLines.push(`### [${e.index}] ${label} — ${tag}`);
      // G-2: e.extract is fetched-page prose (or a snippet) — wrap it. The
      // "(no clean, on-topic extract available…)" / "(extraction blocked…)"
      // placeholders (see assembleSourceMaterial) are OUR OWN text, not fetched —
      // same `startsWith("(")` test the `anyUsable`/hasMaterial gates already use.
      // Source label is `label` (title-derived), NOT e.url — a dedup'd source's
      // URL already appears in a small fixed budget of places (material `Source:`
      // line, Sources-table row/link) that research.test.ts's dedup test asserts a
      // cap on; using e.url here added a 5th, uncounted occurrence and broke it.
      materialLines.push(e.extract.startsWith("(") ? e.extract : wrapUntrusted(e.extract, label));
      materialLines.push(`Source: ${e.url}`);
      materialLines.push("");
    }
    // Trim trailing blank line.
    if (materialLines[materialLines.length - 1] === "") materialLines.pop();
  } else {
    materialLines.push(
      "_No clean source material could be extracted for this question. The sources below were located — see **Sources** for their URLs to inspect directly._"
    );
  }

  const findingBullets = args.findingBullets.length > 0 ? args.findingBullets : [`- No structured findings extracted.`];
  const agentHints = args.agentHints.length > 0 ? args.agentHints : [`- Try a narrower query or provide known source URLs to inspect directly.`];
  const totalSources = args.sourceRows.length;

  // Build sources as a markdown table for indexed citation (e.g. Source[1], Source[3])
  const sourceTableLines: string[] = [];
  if (totalSources > 0) {
    sourceTableLines.push(`| # | Title | URL | Notes |`);
    sourceTableLines.push(`|---|-------|-----|-------|`);
    for (let i = 0; i < args.sourceRows.length; i++) {
      const row = args.sourceRows[i];
      // Escape pipe chars in label/note to avoid breaking table
      const safeLabel = row.label.replace(/\|/g, "\\|");
      const safeNote = row.note.replace(/\|/g, "\\|");
      sourceTableLines.push(`| ${i + 1} | [${safeLabel}](${row.url}) | ${row.url} | ${safeNote} |`);
    }
  } else {
    sourceTableLines.push(`_No sources fetched._`);
  }

  const failedQueriesLine = args.failedQueries && args.failedQueries.length > 0
    ? [`**failed_queries**: ${args.failedQueries.map(q => `"${q}"`).join(", ")}`]
    : [];
  const generatedQueriesLines = args.generatedQueries && args.generatedQueries.length > 0
    ? [`**generated_queries**:`, ...args.generatedQueries.map((q, i) => `  ${i + 1}. ${q}`)]
    : [];

  // F14-3: emit requested_depth and resolved_depth as separate provenance fields.
  // Always emit both so callers can programmatically distinguish "user asked for X, got Y".
  // When they differ (auto resolved to a concrete depth), annotate the resolution explicitly.
  const depthProvenanceLine = args.requestedDepth !== args.depth
    ? `**requested_depth**: ${args.requestedDepth} | **resolved_depth**: ${args.depth} *(auto-resolved)*`
    : `**requested_depth**: ${args.requestedDepth} | **resolved_depth**: ${args.depth}`;

  const lines: string[] = [
    `## Research: ${args.topic}`,
    ``,
    `**Query**: ${args.query} | **top_sources**: ${totalSources} | **depth**: ${args.depth}`,
    depthProvenanceLine,
    `**queries**: ${args.queriesSucceeded}/${args.queriesTotal} succeeded`,
    ...failedQueriesLine,
    ...generatedQueriesLines,
    `**sources_extracted**: ${args.sourcesFetchedCount} full + ${args.snippetOnlyCount} snippet-only`,
    `**search_strategy**: primary engine (google) first, with duckduckgo + bing raced only on failure`,
    `**timestamp**: ${timestamp}`,
    ``,
    `---`,
    ``,
    `> This section is CITED SOURCE MATERIAL, not a written answer. Compose the user's answer from it, citing sources with the [n] markers. No further tool calls are needed.`,
    ``,
    `## Researched source material for: ${args.topic}`,
    ``,
    ...materialLines,
    ``,
    `## Key Findings`,
    ...findingBullets,
    ``,
    `## Sources`,
    ``,
    ...sourceTableLines,
    ``,
    `## Agent Hints`,
    ...agentHints,
    ``,
    `## Agent Action`,
    `agent_instruction: status:${hasMaterial ? "success" : "partial"} | requested_depth:${args.requestedDepth} | resolved_depth:${args.depth} | queries:${args.queriesSucceeded}/${args.queriesTotal} | sources:${args.sourcesFetchedCount} | material:${materialQuality} | answer_ready:${hasMaterial}`,
    // The material above is complete + cited — the consuming LLM composes the answer.
    // Do NOT emit a "go extract yourself" to-do on success (the audited complaint).
    ...(hasMaterial
      ? [`next: Grounded cited source material assembled — compose the answer for the user from this; no further calls needed.${materialQuality === "snippets" ? " (Material is snippet-level; use depth='comprehensive' if deeper detail is needed.)" : ""}`]
      : [
          `next: novada_extract on specific source URLs for full content`,
          `next: novada_research with focus="<subtopic>" to narrow coverage`,
        ]),
    ...(args.failedQueries && args.failedQueries.length > 0
      ? [`note: ${args.failedQueries.length} queries failed — retry those searches individually or add focus param`]
      : []),
  ];

  return lines.join("\n");
}

function sourceLabel(title: string, url: string): string {
  if (title && title !== "Untitled") return title;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return title || url;
  }
}

/** Resolve 'auto' and 'comprehensive' depth to the actual search strategy */
function resolveDepth(depth: string, question: string): string {
  if (depth === "auto") {
    const isComplex = question.length > 80
      || /\b(compare|versus|vs|why|how does|best|worst|difference between|trade-off|pros and cons|review)\b/i.test(question)
      || COMPARISON_TRIGGER_REGEX.test(question);
    return isComplex ? "deep" : "quick";
  }
  return depth; // quick, deep, comprehensive pass through
}

const STOP_WORDS = new Set([
  "what", "how", "why", "when", "where", "who", "which", "is", "are", "do",
  "does", "the", "a", "an", "in", "on", "at", "to", "for", "of", "with",
  "and", "or", "but", "can", "will", "should", "would", "could",
]);

/** Real questions never need to be this long for query-generation purposes —
 *  a defensive cap independent of novadaResearch's own QUESTION_MAX_LENGTH
 *  gate (review round 2, LOW: these functions are now exported, so a future
 *  direct caller that bypasses that gate still can't feed pathological input
 *  into the regex-building below). */
const MAX_QUESTION_LENGTH_FOR_QUERY_GEN = 2000;

/** Generate diverse search queries for broader research coverage.
 *
 * F14-2: Use the full `topic` string (not a truncated 4-word keyPhrase) as the
 * base for all derived sub-queries so that named entities (proper nouns at word
 * positions 5+) survive into search sub-queries.
 *
 * research-query-quality-2026-11-14 (round 1 + round 2 review fixes):
 *  1. Comparison questions — EN "vs"/"compare X, Y and Z", DE "Vergleich"/
 *     comma lists, FR "comparaison"/"entre...et", ES "comparación"/
 *     "entre...y", and "vs"-CHAINS of any length ("A vs B vs C vs D") — now
 *     get ONE targeted query per comparand + the residual topic phrase, plus
 *     one side-by-side query, instead of the full question padded with a
 *     generic suffix. Comparison connectors (and/und/et/y, vs/versus/gegen/
 *     contre/contra) are ONE shared table (LIST_CONNECTOR_WORDS), not a
 *     comma-only special case, so a 3+-item "vs"-chain is never truncated.
 *  2. The generic (non-comparison) suffix table is per-language (en/de/fr/
 *     es). A genuinely unsupported language (detectLanguage returns
 *     "unknown" — different script) gets ZERO filler suffixes appended
 *     (fail safe) rather than a guessed-English or guessed-translated one.
 *  3. "2024 2025 trends" / "best practices 2025" are computed from
 *     `new Date()` at call time, never hard-coded.
 *  4. A per-comparand query is only emitted when the topic residual is
 *     non-empty — a bare 1-token query ("TCP") is skipped in favor of the
 *     side-by-side query ("TCP vs UDP"), which always has disambiguating
 *     context.
 * Every generated query is deduped (case/whitespace-insensitive) before
 * returning, so no future suffix addition can reintroduce a near-duplicate.
 */
export function generateSearchQueries(
  question: string,
  deep: boolean,
  comprehensive: boolean,
  focus?: string
): string[] {
  const safeQuestion = question.length > MAX_QUESTION_LENGTH_FOR_QUERY_GEN
    ? question.slice(0, MAX_QUESTION_LENGTH_FOR_QUERY_GEN)
    : question;
  // C5 (#1, 2026-11-18): query #1 used to seed the raw (up to 2000-char)
  // question verbatim as a sub-query sent upstream — a 90+-word question
  // routinely failed the SERP's own query-length limits (queries:1/3
  // succeeded, top_sources:0, failed_queries listing the full question).
  // `topic`/`keywords`/comparand extraction below still use the unbounded
  // `safeQuestion`; only the QUERY SENT UPSTREAM needs bounding.
  // #4 (2026-11-19): query #1 seeds `safeQuestion` UNBOUNDED here — the final
  // `bounded = queries.map(q => boundQuery(q).query)` pass below already
  // bounds EVERY generated query (added in C5 review round 3, specifically so
  // no branch could forget to bound its own output). boundQuery() is
  // idempotent (re-bounding an already-≤500-char string is a no-op), so
  // seeding it bounded here too was a second, redundant call doing nothing
  // the final map doesn't already do — removed, behavior unchanged.
  const queries: string[] = [safeQuestion];
  const words = safeQuestion.toLowerCase().split(/\s+/);
  // F14-2: use full topic (without trailing punctuation) as base for sub-queries
  const topic = safeQuestion.replace(/[?!.]+$/, "").trim();
  const keywords = words.filter(w => !STOP_WORDS.has(w) && !ALL_SIGNAL_WORDS.has(w) && w.length > 2);

  // C5 review round 3 (#1, RC verifier): query #1 above is bounded, but every
  // OTHER generated query below used to build on the full, UNBOUNDED `topic`
  // (`${topic} ${domainSuffixes[n]}`, comparison residual, etc.) — for a
  // genuinely long question, "topic" alone already exceeds the engine's query
  // length limit before any suffix is even appended, so sub-queries #2+ failed
  // upstream (1/5 or 2/5 succeeded live, below the "≥3 ok" bar). Once `topic`
  // already eats most of the per-query budget, derive every SUFFIX-APPENDED
  // query from a CONDENSED topic (the first 15 content keywords, already
  // stop-word-filtered above) instead of the full text + suffix — keeps the
  // suffix itself meaningful and visible rather than silently chopped off by
  // the final bound below. Short/medium topics (the overwhelming common case,
  // every existing fixture) are completely unaffected: this only activates
  // once `topic` alone would leave no room for a suffix. `derivedTopic`
  // replaces `topic` in EVERY place below that builds a suffix/residual
  // query — one basis value, not a per-branch patch — while comparand
  // EXTRACTION above still reads the full, unbounded question (identifying
  // "which entities are being compared" must never be truncated).
  const SUFFIX_QUERY_TOPIC_BUDGET = 350; // leaves >=150 chars for suffix/focus, well under boundQuery's 500-char cap
  const derivedTopic = topic.length > SUFFIX_QUERY_TOPIC_BUDGET
    ? (keywords.slice(0, 15).join(" ") || topic.slice(0, SUFFIX_QUERY_TOPIC_BUDGET))
    : topic;

  // Apply focus to sub-queries if provided
  const focusSuffix = focus ? ` ${focus}` : "";

  const domain = detectDomain(safeQuestion);
  const lang = detectLanguage(safeQuestion);
  const comparands = domain === "comparison" ? extractComparands(safeQuestion) : [];

  const thisYear = new Date().getFullYear();
  const lastYear = thisYear - 1;

  if (comparands.length >= 2) {
    const residual = buildComparisonTopicResidual(derivedTopic, comparands);
    if (residual) {
      const residualSuffix = ` ${residual}`;
      for (const c of comparands) {
        queries.push(`${c}${residualSuffix}${focusSuffix}`);
      }
      if (comprehensive && lang !== "unknown") {
        const pricingWord = EXTRA_WORDS_BY_LANG[lang].pricing;
        for (const c of comparands) {
          queries.push(`${c}${residualSuffix} ${pricingWord}${focusSuffix}`);
        }
      }
    }
    // One side-by-side query, in addition to the full original question
    // (queries[0]) and the per-comparand queries above (if any). Always has
    // disambiguating context from pairing the comparands, so this is never a
    // bare 1-token query even when residual is empty.
    queries.push(`${comparands.join(" vs ")}${residual ? ` ${residual}` : ""}${focusSuffix}`.trim());
  } else if (lang === "unknown") {
    // Genuinely unsupported script — never guess a filler language onto it
    // (requirement 3, fail safe). Keep diversity structural (quoted exact
    // phrase) instead of appending any language's words.
    queries.push(`"${derivedTopic}"${focusSuffix}`);
  } else {
    const domainSuffixes = DOMAIN_SUFFIXES_BY_LANG[lang][domain];
    const extra = EXTRA_WORDS_BY_LANG[lang];
    if (keywords.length > 2) {
      // F14-2: Use `derivedTopic` (full topic for short/medium questions —
      // the overwhelming common case — so named entities like "Novada",
      // "TypeScript", "Model Context Protocol" are preserved; a condensed
      // keyword-based topic only once the full topic alone would already
      // exceed the per-query budget) as base for sub-queries.
      queries.push(`${derivedTopic} ${domainSuffixes[0]}${focusSuffix}`);
      queries.push(`${derivedTopic} ${domainSuffixes[1]}${focusSuffix}`);
      if (deep || comprehensive) {
        queries.push(`${derivedTopic} ${domainSuffixes[2]}${focusSuffix}`);
        queries.push(`${derivedTopic} ${extra.challengesLimitations}${focusSuffix}`);
        // Social queries (reddit/HN) have no clean non-English equivalent —
        // skip rather than append English filler onto a non-English question.
        if (lang === "en") {
          queries.push(`${derivedTopic} reddit discussion opinions`);
        }
      }
      if (comprehensive) {
        queries.push(`${derivedTopic} ${extra.caseStudyExamples}${focusSuffix}`);
        queries.push(`${derivedTopic} ${lastYear} ${thisYear} trends${focusSuffix}`);
        if (lang === "en") queries.push(`${derivedTopic} hacker news discussion`);
      }
    } else {
      queries.push(`"${derivedTopic}" ${domainSuffixes[0]}${focusSuffix}`);
      queries.push(`${derivedTopic} ${domainSuffixes[1]}${focusSuffix}`);
      if (deep || comprehensive) {
        queries.push(`${derivedTopic} ${extra.examplesUseCases}${focusSuffix}`);
        queries.push(`${derivedTopic} ${extra.reviewExperience}${focusSuffix}`);
        if (lang === "en") queries.push(`${derivedTopic} reddit discussion opinions`);
      }
      if (comprehensive) {
        queries.push(`${derivedTopic} ${extra.bestPractices} ${thisYear}${focusSuffix}`);
        if (lang === "en") queries.push(`${derivedTopic} hacker news discussion`);
      }
    }
  }

  // C5 review round 3 (#1): the STRUCTURAL guarantee, applied ONCE here to
  // EVERY generated query — not per-branch. `derivedTopic` above already
  // keeps a long question's suffix queries meaningful; this bound is what
  // makes "every generated query fits the engine's length limit" true by
  // construction, for every question shape/depth/branch (comparison,
  // unknown-language, focus-suffixed, or not), not just the ones a future
  // author remembers to condense. Reuses the SAME boundQuery() (search.ts)
  // policy query #1 already used — one bound, one place, not a second rule.
  const bounded = queries.map(q => boundQuery(q).query);

  // Dedup near-identical generated queries (same text after lowercase +
  // whitespace normalization), checked AFTER bounding so a collision
  // introduced by truncation is caught too, not just a pre-bound one — no
  // suffix addition (or truncation) can reintroduce the near-duplicate-
  // search bug this fix targets.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const q of bounded) {
    const key = q.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(q);
  }
  return deduped;
}
