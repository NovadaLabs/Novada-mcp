import { normalizeUrl } from "../utils/index.js";
import { saveOutput } from "../utils/output.js";
import type { ResearchParams, NovadaSearchResult } from "./types.js";
import { novadaExtract } from "./extract.js";
import { submitSearchScrapeTask, resolveSearchResults } from "./search.js";
import type { ProgressReporter } from "./crawl.js";
import { makeNovadaError, NovadaErrorCode, redactSecrets } from "../_core/errors.js";

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
async function searchWithFallback(apiKey: string, query: string, num: number): Promise<NovadaSearchResult[]> {
  // Attempt 1: Primary engine (Google) — cheapest path
  try {
    const submitted = await submitSearchScrapeTask(apiKey, PRIMARY.name, PRIMARY.id, query, num, PRIMARY.param, PRIMARY.supportsNum);
    const results = await resolveSearchResults(apiKey, submitted);
    if (results.length > 0) return results;
  } catch { /* fall through to fallback race */ }

  // Attempt 2: Race fallback engines (DDG + Bing in parallel) — fastest recovery
  const attempts = FALLBACKS.map(eng =>
    submitSearchScrapeTask(apiKey, eng.name, eng.id, query, num, eng.param, eng.supportsNum)
      .then(submitted => resolveSearchResults(apiKey, submitted))
      .then(results => {
        if (results.length === 0) throw new Error("empty results");
        return results;
      })
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

  // Execute all searches in parallel — each query races all 3 engines simultaneously
  const allResults = await Promise.all(
    queries.map(async (query): Promise<{ query: string; results: NovadaSearchResult[]; failed?: boolean }> => {
      const results = await searchWithFallback(apiKey, query, 5);
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
        const retryResults = await searchWithFallback(apiKey, retryQuery, 5);
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
          // Both must be caught here so timeout error text never reaches synthesizeAnswer.
          if (content.startsWith("## Extract Failed") || content.startsWith("## Extraction Error")) {
            return { ok: false as const, title: source.title, url: source.url, snippet: source.snippet };
          }
          // Strip all extract-output metadata — only keep the page body content
          const strippedContent = content.replace(/^📁[^\n]*\n\n/, "");
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

  // All searches failed or returned 0 results — Scraper API not activated
  if (failedCount === queries.length || totalResults === 0) {
    return [
      `## Research Unavailable`,
      ``,
      `All search queries returned 0 results. Scraper API (search) is not activated on this account.`,
      ``,
      `**Cannot complete research on:** "${topic}"`,
      ``,
      `**Fix:**`,
      `- Activate Scraper API at https://dashboard.novada.com/overview/scraper/`,
      `- Run \`novada_health_all()\` to check which API products are currently active on your account`,
      ``,
      `**Alternatives while search is unavailable:**`,
      `- Use \`novada_extract\` with specific URLs you already know`,
      `- Use \`novada_map\` on a relevant site, then \`novada_extract\` on discovered pages`,
      ``,
      `## Agent Action`,
      `agent_instruction: status:search_unavailable | action: call novada_health_all() to diagnose, then activate_scraper_api | question_not_answered: true`,
    ].join("\n");
  }

  // NOV-319 phase 4/4: synthesizing the cited report.
  await reportProgress(onProgress, {
    progress: 4,
    total: RESEARCH_PHASES,
    message: "Synthesizing cited report",
  });

  // Build structured synthesis from extracted contents + snippet fallbacks
  // F14-1: synthesizeAnswer now returns quality signal alongside text
  const { text: summaryText, quality: synthesisQuality } = synthesizeAnswer(topic, extractedContents, extractFailedSources, sources);

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

  // Agent hints
  const agentHints: string[] = [
    `- Use \`novada_extract\` with specific source URLs to get full content: ${sources.slice(0, 3).map(s => s.url).join(", ") || "none available"}.`,
    `- For narrower research: add \`focus\` param to guide sub-query generation.`,
    `- For more coverage: use depth='comprehensive' (8-10 searches).`,
  ];
  if (failedCount > 0) {
    agentHints.push(`- ${failedCount} of ${queries.length} search queries failed; results may be incomplete.`);
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
    summaryText,
    synthesisQuality,
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
    finalReport += `\n\n---\nResearch saved: ${redactSecrets(outputResult.filePath)}`;
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

// ─── Synthesis ─────────────────────────────────────────────────────────────
// Build a structured synthesis: direct answer + contrasting points + common finding
// F14-1: Returns { text, quality } where quality is "ok" | "weak" | "failed"

type SynthesisQuality = "ok" | "weak" | "failed";

function synthesizeAnswer(
  question: string,
  extracted: { title: string; url: string; content: string }[],
  failedSources: { title: string; url: string; snippet: string }[],
  allSources: { title: string; url: string; snippet: string }[],
): { text: string; quality: SynthesisQuality } {
  const fallback = "Synthesis unavailable — see raw findings below.";

  // Collect all available text fragments for synthesis
  const fragments: { source: string; text: string }[] = [];

  // Full extracted content — take first ~600 chars of each
  // F14-1: strip nav-chrome lines before collecting fragments
  for (const src of extracted) {
    const cleaned = stripNavChrome(
      src.content.replace(/^#+.*$/gm, "").replace(/\n{2,}/g, " ").trim()
    );
    const sentences = cleaned.match(/[^.!?]+[.!?]+/g) ?? [];
    const fragment = sentences.slice(0, 4).join(" ").trim() || cleaned.slice(0, 600).trim();
    if (fragment) {
      fragments.push({ source: src.title, text: fragment });
    }
  }

  // Snippet fallbacks — include snippets from extraction-failed sources
  for (const src of failedSources) {
    if (src.snippet) {
      fragments.push({ source: src.title, text: src.snippet });
    }
  }

  // If we have nothing from extracted or failed, use top snippets from all sources
  if (fragments.length === 0) {
    for (const src of allSources.slice(0, 5)) {
      if (src.snippet) {
        fragments.push({ source: src.title, text: src.snippet });
      }
    }
  }

  if (fragments.length === 0) return { text: fallback, quality: "failed" };

  // Rank fragments by keyword overlap with the question — most relevant first
  // F14-1: also penalise chrome-heavy fragments (chrome fraction > 0.4)
  const questionKeywords = question.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
  if (questionKeywords.length > 0) {
    fragments.sort((a, b) => {
      const aText = a.text.toLowerCase();
      const bText = b.text.toLowerCase();
      const scoreA = questionKeywords.filter(kw => aText.includes(kw)).length - (chromeFraction(a.text) > 0.4 ? 100 : 0);
      const scoreB = questionKeywords.filter(kw => bText.includes(kw)).length - (chromeFraction(b.text) > 0.4 ? 100 : 0);
      return scoreB - scoreA;
    });
  }

  // Build structured synthesis
  const parts: string[] = [];

  // 1. Lead with the most question-relevant fragment
  const primary = fragments[0];
  parts.push(primary.text);

  // 2. Add contrasting/supplementary points from other sources
  if (fragments.length > 1) {
    const supplementary = fragments.slice(1, 4)
      .filter(f => f.text.length > 30)
      .map(f => `- *${f.source}*: ${f.text.slice(0, 200).trim()}`);
    if (supplementary.length > 0) {
      parts.push("");
      parts.push("**Additional perspectives:**");
      parts.push(...supplementary);
    }
  }

  const synthesis = parts.join("\n");
  if (!synthesis) return { text: fallback, quality: "failed" };

  // F14-1: Determine synthesis quality — weak if the primary fragment is chrome-heavy
  // or shares fewer than 1 keyword with the question
  const primaryChromeFraction = chromeFraction(primary.text);
  const primaryKeywordMatches = questionKeywords.filter(kw => primary.text.toLowerCase().includes(kw)).length;
  const isWeak = primaryChromeFraction > 0.6 || (questionKeywords.length > 0 && primaryKeywordMatches < 1);

  return { text: synthesis, quality: isWeak ? "weak" : "ok" };
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
  summaryText: string;
  synthesisQuality: SynthesisQuality;
  findingBullets: string[];
  sourceRows: { label: string; url: string; note: string }[];
  agentHints: string[];
}): string {
  const fallbackSummary = "Synthesis unavailable — see raw findings below.";
  const timestamp = new Date().toISOString();
  const summaryText = args.summaryText.trim();
  const hasSynthesis = summaryText.length > 0 && summaryText !== fallbackSummary;
  // F14-1: use synthesisQuality from synthesizeAnswer (ok | weak | failed)
  const synthesisStatus = hasSynthesis ? args.synthesisQuality : "failed";
  const summary = hasSynthesis ? summaryText : fallbackSummary;
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
    `**search_strategy**: concurrent engine racing (google + duckduckgo + bing)`,
    `**timestamp**: ${timestamp}`,
    ``,
    `---`,
    ``,
    `## Summary`,
    summary,
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
    `agent_instruction: status:${(synthesisStatus === "ok" || synthesisStatus === "weak") ? "success" : "partial"} | requested_depth:${args.requestedDepth} | resolved_depth:${args.depth} | queries:${args.queriesSucceeded}/${args.queriesTotal} | sources:${args.sourcesFetchedCount} | synthesis:${synthesisStatus}`,
    `next: novada_extract on specific source URLs for full content`,
    `next: novada_research with focus="<subtopic>" to narrow coverage`,
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
