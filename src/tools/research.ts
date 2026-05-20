import { normalizeUrl } from "../utils/index.js";
import type { ResearchParams, NovadaSearchResult } from "./types.js";
import { novadaExtract } from "./extract.js";
import { submitSearchScrapeTask, pollSearchResult, parseScraperSearchResults } from "./search.js";

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

  // Execute all searches in parallel via Scraper API (google_search)
  const allResults = await Promise.all(
    queries.map(async (query): Promise<{ query: string; results: NovadaSearchResult[]; failed?: boolean }> => {
      try {
        const taskId = await submitSearchScrapeTask(apiKey, "google.com", "google_search", query, 5, "q");
        const data = await pollSearchResult(apiKey, taskId);
        const results = parseScraperSearchResults(data);
        return { query, results };
      } catch {
        return { query, results: [], failed: true };
      }
    })
  );

  const failedCount = allResults.filter(r => r.failed).length;
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

  // Phase 2: Extract top 3 source URLs for full content
  const topSources = sources.slice(0, 3);
  const extractedContents: { title: string; url: string; content: string }[] = [];

  if (topSources.length > 0) {
    const extractResults = await Promise.allSettled(
      topSources.map(async (source) => {
        try {
          const content = await novadaExtract(
            { url: source.url, format: "markdown", query: params.question, render: "auto" },
            apiKey
          );
          // Skip failed extractions (extract.ts returns "## Extract Failed" on error)
          if (content.startsWith("## Extract Failed")) return null;
          // Strip Agent Hints section from extracted content — too noisy in research output
          const cleanContent = content.split("## Agent Hints")[0].trim();
          return { title: source.title, url: source.url, content: cleanContent };
        } catch {
          return null;
        }
      })
    );

    for (const result of extractResults) {
      if (result.status === "fulfilled" && result.value) {
        extractedContents.push(result.value);
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
      `**Fix:** Activate Scraper API at https://dashboard.novada.com/overview/scraper/`,
      ``,
      `**Alternatives while search is unavailable:**`,
      `- Use \`novada_extract\` with specific URLs you already know`,
      `- Use \`novada_map\` on a relevant site, then \`novada_extract\` on discovered pages`,
      ``,
      `## Agent Instruction`,
      `agent_status: search_unavailable | action: activate_scraper_api | question_not_answered: true`,
    ].join("\n");
  }

  // Build synthesis summary from extracted contents or snippet snippets
  let summaryText: string;
  if (extractedContents.length > 0) {
    // Use the first extracted source's opening content as summary basis
    const firstContent = extractedContents[0].content;
    // Take up to first 4 sentences / 600 chars as summary
    const trimmed = firstContent.replace(/^#+.*$/gm, "").replace(/\n{2,}/g, " ").trim();
    const sentences = trimmed.match(/[^.!?]+[.!?]+/g) ?? [];
    summaryText = sentences.slice(0, 4).join(" ").trim() || trimmed.slice(0, 600).trim();
    if (!summaryText) summaryText = "Synthesis unavailable — see raw findings below.";
  } else if (sources.length > 0) {
    // Derive a brief summary from top-3 snippets
    const snippets = sources.slice(0, 3).map(s => s.snippet).filter(Boolean);
    summaryText = snippets.join(" ").slice(0, 600).trim() || "Synthesis unavailable — see raw findings below.";
  } else {
    summaryText = "Synthesis unavailable — see raw findings below.";
  }

  // Build Key Findings bullets from sources with snippets
  const findingBullets: string[] = sources.length > 0
    ? sources.map(s => `- **${s.title}** (${s.url})${s.snippet ? ` — ${s.snippet}` : ""}`)
    : [`- No structured findings extracted.`];

  // Build Sources list from successfully fetched sources
  const sourceLines: string[] = extractedContents.length > 0
    ? extractedContents.map(s => `- ${s.url} — ${sourceLabel(s.title, s.url)}`)
    : [`- No sources fetched.`];

  // Agent hints
  const agentHints: string[] = [
    `- Use \`novada_extract\` with specific source URLs to get full content: ${sources.slice(0, 3).map(s => s.url).join(", ") || "none available"}.`,
    `- For narrower research: add \`focus\` param to guide sub-query generation.`,
    `- For more coverage: use depth='comprehensive' (8-10 searches).`,
  ];
  if (failedCount > 0) {
    agentHints.push(`- ${failedCount} of ${queries.length} search queries failed; results may be incomplete.`);
  }

  return formatResearchOutput({
    topic,
    query: queryValue,
    depth: depthValue,
    sourcesFetchedCount: extractedContents.length,
    summaryText,
    findingBullets,
    sourceLines,
    agentHints,
  });
}

function formatResearchOutput(args: {
  topic: string;
  query: string;
  depth: string;
  sourcesFetchedCount: number;
  summaryText: string;
  findingBullets: string[];
  sourceLines: string[];
  agentHints: string[];
}): string {
  const fallbackSummary = "Synthesis unavailable — see raw findings below.";
  const timestamp = new Date().toISOString();
  const summaryText = args.summaryText.trim();
  const hasSynthesis = summaryText.length > 0 && summaryText !== fallbackSummary;
  const synthesisStatus = hasSynthesis ? "ok" : "failed";
  const summary = hasSynthesis ? summaryText : fallbackSummary;
  const findingBullets = args.findingBullets.length > 0 ? args.findingBullets : [`- No structured findings extracted.`];
  const sourceLines = args.sourceLines.length > 0 ? args.sourceLines : [`- No sources fetched.`];
  const agentHints = args.agentHints.length > 0 ? args.agentHints : [`- Try a narrower query or provide known source URLs to inspect directly.`];

  const lines: string[] = [
    `## Research: ${args.topic}`,
    ``,
    `**Query**: ${args.query}`,
    `**depth**: ${args.depth}`,
    `**sources_searched**: ${args.sourcesFetchedCount}`,
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
    ...sourceLines,
    ``,
    `## Agent Hints`,
    ...agentHints,
    ``,
    `## Agent Notice — Coverage`,
    `requested_depth: ${args.depth} | sources_found: ${args.sourcesFetchedCount} | synthesis: ${synthesisStatus}`,
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

  if (keywords.length > 2) {
    queries.push(`${keyPhrase} overview explained${focusSuffix}`);
    queries.push(`${keyPhrase} vs alternatives comparison${focusSuffix}`);
    if (deep || comprehensive) {
      queries.push(`${keyPhrase} best practices real world${focusSuffix}`);
      queries.push(`${keyPhrase} challenges limitations${focusSuffix}`);
      if (keywords.length >= 2) {
        queries.push(`"${keywords[0]}" "${keywords[1]}" site:reddit.com OR site:news.ycombinator.com`);
      } else {
        queries.push(`${topic} site:reddit.com OR site:news.ycombinator.com`);
      }
    }
    if (comprehensive) {
      queries.push(`${keyPhrase} case study examples${focusSuffix}`);
      queries.push(`${keyPhrase} 2024 2025 trends${focusSuffix}`);
      queries.push(`${keyPhrase} expert opinion${focusSuffix}`);
    }
  } else {
    queries.push(`"${topic}" explained overview${focusSuffix}`);
    queries.push(`${topic} vs alternatives${focusSuffix}`);
    if (deep || comprehensive) {
      queries.push(`${topic} examples use cases${focusSuffix}`);
      queries.push(`${topic} review experience${focusSuffix}`);
      queries.push(`${topic} site:reddit.com OR site:news.ycombinator.com`);
    }
    if (comprehensive) {
      queries.push(`${topic} best practices 2025${focusSuffix}`);
      queries.push(`${topic} tutorial guide${focusSuffix}`);
    }
  }

  return queries;
}
