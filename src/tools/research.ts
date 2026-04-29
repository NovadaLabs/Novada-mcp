import axios from "axios";
import { USER_AGENT, normalizeUrl } from "../utils/index.js";
import { SCRAPERAPI_BASE } from "../config.js";
import type { ResearchParams, NovadaApiResponse, NovadaSearchResult } from "./types.js";
import { novadaExtract } from "./extract.js";

export async function novadaResearch(params: ResearchParams, apiKey: string): Promise<string> {
  // Resolve depth — 'auto' picks based on question complexity heuristic
  const resolvedDepth = resolveDepth(params.depth || "auto", params.question);
  const isDeep = resolvedDepth === "deep" || resolvedDepth === "comprehensive";
  const isComprehensive = resolvedDepth === "comprehensive";

  const queries = generateSearchQueries(params.question, isDeep, isComprehensive, params.focus);

  // Execute all searches in parallel
  const allResults = await Promise.all(
    queries.map(async (query): Promise<{ query: string; results: NovadaSearchResult[]; failed?: boolean }> => {
      try {
        const response = await axios.post(
          `${SCRAPERAPI_BASE}/search`,
          { serpapi_query: { q: query, api_key: apiKey, engine: "google", num: "5" } },
          { headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT }, timeout: 30000 }
        );

        const data: NovadaApiResponse = response.data;
        // code 402 = no SERP quota
        if (data.code === 402 || data.code === 400) return { query, results: [], failed: true };
        const results: NovadaSearchResult[] = data.data?.organic_results || data.organic_results || [];
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

  // All searches failed — SERP endpoint is unavailable for this account
  if (failedCount === queries.length) {
    return [
      `## Research: Search Unavailable`,
      `question: "${params.question}"`,
      ``,
      `The Novada SERP endpoint is not available for this API key. All ${queries.length} search queries failed.`,
      ``,
      `**To research this question manually:**`,
      `1. Use \`novada_extract\` with specific URLs you already know`,
      `2. Use \`novada_map\` on a relevant site, then \`novada_extract\` on discovered pages`,
      `3. Contact support@novada.com to enable SERP access for your account`,
      ``,
      `**Suggested starting URLs for "${params.question.slice(0, 60)}":**`,
      `- \`novada_extract\` with a Wikipedia, official docs, or news URL on this topic`,
      `- \`novada_map\` on a domain you know covers this topic`,
    ].join("\n");
  }

  const depthLabel = params.depth === "auto"
    ? `${resolvedDepth} (auto-selected)`
    : resolvedDepth;

  const lines: string[] = [
    `## Research Report`,
    `question: "${params.question}"`,
    `depth:${depthLabel} | searches:${queries.length}${failedCount > 0 ? ` (${failedCount} failed)` : ""} | unique_sources:${sources.length} | extracted:${extractedContents.length}`,
    params.focus ? `focus: ${params.focus}` : "",
    ``,
    `---`,
    ``,
    `## Search Queries Used`,
    ``,
    ...queries.map((q, i) => `${i + 1}. ${q}`),
    ``,
    `## Key Findings`,
    ``,
    ...sources.map((s, i) =>
      `${i + 1}. **${s.title}**\n   ${s.url}\n   ${s.snippet}\n`
    ),
    // Key Sources (Extracted) section
    ...(extractedContents.length > 0 ? [
      ``,
      `## Key Sources (Extracted)`,
      ``,
      ...extractedContents.flatMap((s, i) => [
        `### [${i + 1}] ${s.title}`,
        `url: ${s.url}`,
        ``,
        s.content,
        ``,
        `---`,
        ``,
      ]),
    ] : []),
    `## Sources`,
    ``,
    ...sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`),
    ``,
    `---`,
    `## Agent Hints`,
    `- ${extractedContents.length > 0 ? `${extractedContents.length} sources extracted in full above.` : "No sources extracted."} For more: use novada_extract with url=[url1, url2, ...].`,
    `- For narrower research: add \`focus\` param to guide sub-query generation.`,
    `- For more coverage: use depth='comprehensive' (8-10 searches).`,
  ].filter(l => l !== "");

  return lines.join("\n");
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
