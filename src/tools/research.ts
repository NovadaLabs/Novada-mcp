import { normalizeUrl } from "../utils/index.js";
import { saveOutput } from "../utils/output.js";
import type { ResearchParams, NovadaSearchResult } from "./types.js";
import { novadaExtract } from "./extract.js";
import { submitSearchScrapeTask, resolveSearchResults } from "./search.js";

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

// ─── Main Research Function ────────────────────────────────────────────────

export async function novadaResearch(params: ResearchParams, apiKey: string): Promise<string> {
  // Support 'query' as alias for 'question' (matches other tools' param naming)
  if (!params.question && params.query) {
    params = { ...params, question: params.query };
  }
  // Resolve depth — 'auto' picks based on question complexity heuristic
  const resolvedDepth = resolveDepth(params.depth || "auto", params.question ?? "");
  const isDeep = resolvedDepth === "deep" || resolvedDepth === "comprehensive";
  const isComprehensive = resolvedDepth === "comprehensive";

  const queries = generateSearchQueries(params.question ?? "", isDeep, isComprehensive, params.focus);

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
          // Skip failed extractions (extract.ts returns "## Extract Failed" on error)
          if (content.startsWith("## Extract Failed")) {
            return { ok: false as const, title: source.title, url: source.url, snippet: source.snippet };
          }
          // Strip Agent Hints section from extracted content — too noisy in research output
          const strippedContent = content.replace(/^📁[^\n]*\n\n/, "");
          const cleanContent = strippedContent.split("## Agent Hints")[0].trim();
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

  const topic = params.question ?? "";
  const queryValue = params.query ?? params.question ?? "";
  const depthValue = resolvedDepth;

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

  // Build structured synthesis from extracted contents + snippet fallbacks
  const summaryText = synthesizeAnswer(topic, extractedContents, extractFailedSources, sources);

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

  let finalReport = formatResearchOutput({
    topic,
    query: queryValue,
    depth: depthValue,
    queriesSucceeded: succeededCount,
    queriesTotal: queries.length,
    generatedQueries: queries,
    failedQueries,
    sourcesFetchedCount: extractedContents.length,
    snippetOnlyCount: extractFailedSources.length,
    summaryText,
    findingBullets,
    sourceRows,
    agentHints,
  });

  // Wire output save — best-effort, never breaks the tool
  try {
    const outputResult = await saveOutput({
      tool: "research",
      hint: params.question?.slice(0, 30) || params.query?.slice(0, 30) || "research",
      format: "md",
      data: finalReport,
    });
    finalReport += `\n\n---\nResearch saved: ${outputResult.filePath}`;
  } catch { /* best-effort */ }

  return finalReport;
}

// ─── Synthesis ─────────────────────────────────────────────────────────────
// Build a structured synthesis: direct answer + contrasting points + common finding

function synthesizeAnswer(
  question: string,
  extracted: { title: string; url: string; content: string }[],
  failedSources: { title: string; url: string; snippet: string }[],
  allSources: { title: string; url: string; snippet: string }[],
): string {
  const fallback = "Synthesis unavailable — see raw findings below.";

  // Collect all available text fragments for synthesis
  const fragments: { source: string; text: string }[] = [];

  // Full extracted content — take first ~600 chars of each
  for (const src of extracted) {
    const cleaned = src.content.replace(/^#+.*$/gm, "").replace(/\n{2,}/g, " ").trim();
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

  if (fragments.length === 0) return fallback;

  // Rank fragments by keyword overlap with the question — most relevant first
  const questionKeywords = question.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
  if (questionKeywords.length > 0) {
    fragments.sort((a, b) => {
      const aText = a.text.toLowerCase();
      const bText = b.text.toLowerCase();
      const scoreA = questionKeywords.filter(kw => aText.includes(kw)).length;
      const scoreB = questionKeywords.filter(kw => bText.includes(kw)).length;
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
  return synthesis || fallback;
}

// ─── Output Formatting ─────────────────────────────────────────────────────

function formatResearchOutput(args: {
  topic: string;
  query: string;
  depth: string;
  queriesSucceeded: number;
  queriesTotal: number;
  generatedQueries?: string[];
  failedQueries?: string[];
  sourcesFetchedCount: number;
  snippetOnlyCount: number;
  summaryText: string;
  findingBullets: string[];
  sourceRows: { label: string; url: string; note: string }[];
  agentHints: string[];
}): string {
  const fallbackSummary = "Synthesis unavailable — see raw findings below.";
  const timestamp = new Date().toISOString();
  const summaryText = args.summaryText.trim();
  const hasSynthesis = summaryText.length > 0 && summaryText !== fallbackSummary;
  const synthesisStatus = hasSynthesis ? "ok" : "failed";
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

  const lines: string[] = [
    `## Research: ${args.topic}`,
    ``,
    `**Query**: ${args.query} | **top_sources**: ${totalSources} | **depth**: ${args.depth}`,
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
    `agent_instruction: status:${synthesisStatus === "ok" ? "success" : "partial"} | depth:${args.depth} | queries:${args.queriesSucceeded}/${args.queriesTotal} | sources:${args.sourcesFetchedCount} | synthesis:${synthesisStatus}`,
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

/** Generate diverse search queries for broader research coverage */
function generateSearchQueries(
  question: string,
  deep: boolean,
  comprehensive: boolean,
  focus?: string
): string[] {
  const queries: string[] = [question];
  const words = question.toLowerCase().split(/\s+/);
  const topic = question.replace(/[?!.]+$/, "").trim();
  const keywords = words.filter(w => !STOP_WORDS.has(w) && w.length > 2);
  const keyPhrase = keywords.slice(0, 4).join(" ") || topic;

  // Apply focus to sub-queries if provided
  const focusSuffix = focus ? ` ${focus}` : "";

  // Detect question domain for targeted query generation
  const domain = detectDomain(question);
  const domainSuffixes = DOMAIN_SUFFIXES[domain];

  if (keywords.length > 2) {
    // Domain-specific queries instead of generic "overview explained"
    queries.push(`${keyPhrase} ${domainSuffixes[0]}${focusSuffix}`);
    queries.push(`${keyPhrase} ${domainSuffixes[1]}${focusSuffix}`);
    if (deep || comprehensive) {
      queries.push(`${keyPhrase} ${domainSuffixes[2]}${focusSuffix}`);
      queries.push(`${keyPhrase} challenges limitations${focusSuffix}`);
      // Natural language instead of site: operators
      if (keywords.length >= 2) {
        queries.push(`${keywords[0]} ${keywords[1]} reddit discussion opinions`);
      } else {
        queries.push(`${topic} reddit discussion opinions`);
      }
    }
    if (comprehensive) {
      queries.push(`${keyPhrase} case study examples${focusSuffix}`);
      queries.push(`${keyPhrase} 2024 2025 trends${focusSuffix}`);
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
