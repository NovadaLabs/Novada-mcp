import { normalizeUrl } from "../utils/index.js";
import { saveOutput } from "../utils/output.js";
import type { ResearchParams, NovadaSearchResult } from "./types.js";
import { novadaExtract } from "./extract.js";
import { submitSearchScrapeTask, resolveSearchResults } from "./search.js";
import type { ProgressReporter } from "./crawl.js";
import { makeNovadaError, NovadaError, NovadaErrorCode, redactSecrets } from "../_core/errors.js";

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

/**
 * Search with primary engine first, race fallbacks on failure.
 * Best case: 1 API call. Failure case: 3 API calls (1 primary + 2 raced).
 */
async function searchWithFallback(
  apiKey: string,
  query: string,
  num: number,
  signal?: { entitlement: boolean },
): Promise<NovadaSearchResult[]> {
  // C1: record whether a failure carried a real auth/entitlement signal so the
  // caller can tell "Scraper API not activated" (permanent) apart from a
  // transient blip. We never let error inspection change the success path.
  const note = (err: unknown): void => {
    if (signal && isEntitlementError(err)) signal.entitlement = true;
  };

  // Attempt 1: Primary engine (Google) — cheapest path
  try {
    const submitted = await submitSearchScrapeTask(apiKey, PRIMARY.name, PRIMARY.id, query, num, PRIMARY.param, PRIMARY.supportsNum);
    const results = await resolveSearchResults(apiKey, submitted);
    if (results.length > 0) return results;
  } catch (err) { note(err); /* fall through to fallback race */ }

  // Attempt 2: Race fallback engines (DDG + Bing in parallel) — fastest recovery
  const attempts = FALLBACKS.map(eng =>
    submitSearchScrapeTask(apiKey, eng.name, eng.id, query, num, eng.param, eng.supportsNum)
      .then(submitted => resolveSearchResults(apiKey, submitted))
      .then(results => {
        if (results.length === 0) throw new Error("empty results");
        return results;
      })
      .catch((err: unknown) => { note(err); throw err; })
  );
  try {
    return await Promise.any(attempts);
  } catch {
    return []; // all engines failed
  }
}

// ─── Domain Detection ──────────────────────────────────────────────────────
// Detect question domain to generate targeted, domain-specific queries

type QuestionDomain = "tech" | "business" | "comparison" | "howto" | "general";

function detectDomain(question: string): QuestionDomain {
  const q = question.toLowerCase();

  if (/\b(vs\.?|versus|compared?\s+to|alternative|better than|difference between|pros and cons)\b/.test(q)) {
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

/** Domain-specific query suffixes for targeted search diversity */
const DOMAIN_SUFFIXES: Record<QuestionDomain, string[]> = {
  tech:       ["github", "documentation official", "stackoverflow solution"],
  business:   ["case study", "market analysis benchmark", "industry report"],
  comparison: ["comparison table", "detailed review", "benchmarks performance"],
  howto:      ["tutorial step by step", "implementation example", "best practices guide"],
  general:    ["overview explained", "analysis", "expert opinion"],
};

// ─── Comparand Detection ─────────────────────────────────────────────────────
// F14-2: For comparison questions, detect named proper-noun comparands and check
// whether any sources mention them — emit a warning when a comparand has zero hits.

/** Extract candidate proper-noun comparands from a comparison question.
 * Comparands are capitalized tokens adjacent to comparison keywords. */
function extractComparands(question: string): string[] {
  // Match tokens that start with uppercase (proper nouns) in comparison questions
  const comparisonMatch = /\b(?:vs\.?|versus|compared?\s+to|compare|difference between|alternative(?:s)?\s+to|between)\b/i.test(question);
  if (!comparisonMatch) return [];

  // Extract CamelCase / Uppercase-starting words (length ≥ 3, not sentence-start heuristic)
  const tokens = question.split(/\s+/);
  const properNouns: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/[?!.,]/g, "");
    if (t.length >= 3 && /^[A-Z]/.test(t) && !/^(What|How|Why|When|Where|Who|Which|Is|Are|The|A|An|For|What|Compare|Between|And|Or|With|From|In|On|At|To)\b/.test(t)) {
      properNouns.push(t);
    }
  }
  return [...new Set(properNouns)];
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
  const allResults = await Promise.all(
    queries.map(async (query): Promise<{ query: string; results: NovadaSearchResult[]; failed?: boolean }> => {
      const results = await searchWithFallback(apiKey, query, 5, authSignal);
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
        const retryResults = await searchWithFallback(apiKey, retryQuery, 5, authSignal);
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
      const rawUrl: string = r.url || r.link || "";
      const normalized = normalizeUrl(rawUrl);
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
          const content = await novadaExtract(
            { url: source.url, format: "markdown", query: params.question, render: "auto" },
            apiKey
          );
          // Skip failed extractions.
          // extract.ts returns "## Extract Failed" on generic errors (extract.ts:242)
          // and "## Extraction Error" on TOTAL_REQUEST_CEILING timeout (extract.ts:1294).
          // Both must be caught here so timeout error text never reaches source-material assembly.
          if (content.startsWith("## Extract Failed") || content.startsWith("## Extraction Error")) {
            return { ok: false as const, title: source.title, url: source.url, snippet: source.snippet };
          }
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
          return { ok: true as const, title: source.title, url: source.url, content: cleanContent };
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
      return [
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
      ].join("\n");
    }
    // No auth signal → transient / no-results. Retry is the real remedy; do NOT
    // assert a permanent activation defect.
    return [
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
    ].join("\n");
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
      materialLines.push(e.extract);
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
      || /\b(compare|versus|vs|why|how does|best|worst|difference between|trade-off|pros and cons|review)\b/i.test(question);
    return isComplex ? "deep" : "quick";
  }
  return depth; // quick, deep, comprehensive pass through
}

const STOP_WORDS = new Set([
  "what", "how", "why", "when", "where", "who", "which", "is", "are", "do",
  "does", "the", "a", "an", "in", "on", "at", "to", "for", "of", "with",
  "and", "or", "but", "can", "will", "should", "would", "could",
]);

/** Generate diverse search queries for broader research coverage.
 *
 * F14-2: Use the full `topic` string (not a truncated 4-word keyPhrase) as the
 * base for all derived sub-queries so that named entities (proper nouns at word
 * positions 5+) survive into search sub-queries.  The keyPhrase is still derived
 * for the reddit/hn social queries where shorter phrases work better.
 */
function generateSearchQueries(
  question: string,
  deep: boolean,
  comprehensive: boolean,
  focus?: string
): string[] {
  const queries: string[] = [question];
  const words = question.toLowerCase().split(/\s+/);
  // F14-2: use full topic (without trailing punctuation) as base for sub-queries
  const topic = question.replace(/[?!.]+$/, "").trim();
  const keywords = words.filter(w => !STOP_WORDS.has(w) && w.length > 2);
  // keyPhrase retained for social/fallback queries only (shorter is better there)
  const keyPhrase = keywords.slice(0, 4).join(" ") || topic;

  // Apply focus to sub-queries if provided
  const focusSuffix = focus ? ` ${focus}` : "";

  // Detect question domain for targeted query generation
  const domain = detectDomain(question);
  const domainSuffixes = DOMAIN_SUFFIXES[domain];

  if (keywords.length > 2) {
    // F14-2: Use full `topic` so named entities (e.g. "Novada", "TypeScript", "Model Context Protocol")
    // are preserved in derived sub-queries, not truncated by a 4-word slice.
    queries.push(`${topic} ${domainSuffixes[0]}${focusSuffix}`);
    queries.push(`${topic} ${domainSuffixes[1]}${focusSuffix}`);
    if (deep || comprehensive) {
      queries.push(`${topic} ${domainSuffixes[2]}${focusSuffix}`);
      queries.push(`${topic} challenges limitations${focusSuffix}`);
      // Social queries use short keyPhrase (better signal-to-noise for reddit/hn)
      if (keywords.length >= 2) {
        queries.push(`${keyPhrase} reddit discussion opinions`);
      } else {
        queries.push(`${topic} reddit discussion opinions`);
      }
    }
    if (comprehensive) {
      queries.push(`${topic} case study examples${focusSuffix}`);
      queries.push(`${topic} 2024 2025 trends${focusSuffix}`);
      queries.push(`${keyPhrase} hacker news discussion`);
    }
  } else {
    queries.push(`"${topic}" ${domainSuffixes[0]}${focusSuffix}`);
    queries.push(`${topic} ${domainSuffixes[1]}${focusSuffix}`);
    if (deep || comprehensive) {
      queries.push(`${topic} examples use cases${focusSuffix}`);
      queries.push(`${topic} review experience${focusSuffix}`);
      queries.push(`${topic} reddit discussion opinions`);
    }
    if (comprehensive) {
      queries.push(`${topic} best practices 2025${focusSuffix}`);
      queries.push(`${topic} hacker news discussion`);
    }
  }

  return queries;
}
