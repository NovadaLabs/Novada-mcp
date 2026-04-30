import axios, { AxiosError } from "axios";
import { USER_AGENT, cleanParams, rerankResults } from "../utils/index.js";
import { SCRAPERAPI_BASE } from "../config.js";
import type { SearchParams, NovadaApiResponse, NovadaSearchResult } from "./types.js";
import { novadaExtract } from "./extract.js";

const SERP_UNAVAILABLE = `## Search Unavailable

The Novada SERP endpoint is not yet available for this API key.

**Why:** \`novada_search\` requires a dedicated SERP quota that is separate from
the Scraper API and Web Unblocker plans. Contact support@novada.com to enable it.

**Alternatives right now:**
- \`novada_extract\` — fetch and read any specific URL directly
- \`novada_research\` — multi-source research using extract-based discovery
- \`novada_map\` + \`novada_extract\` — discover and read pages from a known site`;

export async function novadaSearch(params: SearchParams, apiKey: string): Promise<string> {
  const engine = params.engine || "google";

  const rawParams: Record<string, string> = {
    q: params.query,
    api_key: apiKey,
    engine,
    num: String(params.num || 10),
    country: params.country || "",
    language: params.language || "",
  };

  // Bing: set locale-specific params
  if (engine === "bing") {
    if (!rawParams.country) rawParams.country = "us";
    if (!rawParams.language) rawParams.language = "en";
    rawParams.mkt = `${rawParams.language}-${rawParams.country.toUpperCase()}`;
  }

  // Time filtering
  if (params.time_range) rawParams.time_range = params.time_range;
  if (params.start_date) rawParams.start_date = params.start_date;
  if (params.end_date) rawParams.end_date = params.end_date;

  // Domain filtering
  if (params.include_domains?.length) {
    rawParams.include_domains = params.include_domains.slice(0, 10).join(",");
  }
  if (params.exclude_domains?.length) {
    rawParams.exclude_domains = params.exclude_domains.slice(0, 10).join(",");
  }

  const cleaned = cleanParams(rawParams) as Record<string, string>;

  let response;
  try {
    // SERP endpoint uses POST with JSON body { serpapi_query: { ... } }
    // Domain: scraperapi.novada.com (not scraper.novada.com)
    response = await axios.post(
      `${SCRAPERAPI_BASE}/search`,
      { serpapi_query: cleaned },
      {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        timeout: 30000,
      }
    );
  } catch (error) {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      if (status === 404 || status === 402) {
        return SERP_UNAVAILABLE;
      }
    }
    throw error;
  }

  const data: NovadaApiResponse = response.data;

  // code 402 = key lacks SERP quota; code 400 = API key missing (should not happen)
  if (data.code === 402 || data.code === 400) {
    return SERP_UNAVAILABLE;
  }

  if (data.code && data.code !== 200 && data.code !== 0) {
    throw new Error(`Novada API error (code ${data.code}): ${data.msg || "Unknown error"}`);
  }

  const results: NovadaSearchResult[] = data.data?.organic_results || data.organic_results || [];
  if (results.length === 0) {
    return "No results found for this query.";
  }

  // Rerank by relevance to query
  const reranked = rerankResults(results, params.query);

  // P1-7: Auto-extract content from top N results when extract_options is provided
  if (params.extract_options) {
    const opts = params.extract_options;
    const topN = opts.top_n ?? 3;
    const urlsToExtract = reranked.slice(0, topN)
      .map(r => r.url || r.link)
      .filter((u): u is string => Boolean(u));

    const extractResults = await Promise.all(
      urlsToExtract.map(async (url) => {
        try {
          const content = await novadaExtract({
            url,
            format: opts.format ?? "markdown",
            render: "auto" as const,
            fields: opts.fields,
            max_chars: opts.max_chars,
          }, apiKey);
          return { url, content, ok: true };
        } catch (err) {
          return { url, content: null, extract_error: String(err), ok: false };
        }
      })
    );

    for (const er of extractResults) {
      const result = reranked.find(r => (r.url || r.link) === er.url);
      if (result) {
        if (er.ok) {
          (result as NovadaSearchResult & { extracted_content?: string | null }).extracted_content = er.content;
        } else {
          (result as NovadaSearchResult & { extract_error?: string }).extract_error = er.extract_error;
        }
      }
    }
  }

  // Active filters summary for agent metadata
  const activeFilters: string[] = [];
  if (params.country) activeFilters.push(`country:${params.country}`);
  if (params.time_range) activeFilters.push(`time:${params.time_range}`);
  if (params.start_date || params.end_date) {
    activeFilters.push(`dates:${params.start_date || "*"}→${params.end_date || "*"}`);
  }
  if (params.include_domains?.length) activeFilters.push(`only:${params.include_domains.join(",")}`);
  if (params.exclude_domains?.length) activeFilters.push(`exclude:${params.exclude_domains.join(",")}`);

  const filterStr = activeFilters.length ? ` | ${activeFilters.join(" | ")}` : "";

  const lines: string[] = [
    `## Search Results`,
    `results:${reranked.length} | engine:${engine} | reranked:true${filterStr}`,
    ``,
    `---`,
    ``,
  ];

  for (let i = 0; i < reranked.length; i++) {
    const r = reranked[i];
    const rawUrl = r.url || r.link;
    if (!rawUrl) continue; // Skip results with no URL — would render as "N/A" and break agents
    let url = unwrapBingUrl(rawUrl);

    // Strip pagination UI text from snippets
    const rawSnippet = r.description || r.snippet || "";
    const cleanSnippet = rawSnippet
      .replace(/\.{3}\s*Read\s+more\s*$/i, "...")
      .replace(/\s+Read\s+more\s*$/i, "")
      .replace(/\s+More\s*$/i, "")
      .trim() || "No description";

    lines.push(`### ${i + 1}. ${r.title || "Untitled"}`);
    lines.push(`url: ${url}`);
    lines.push(`snippet: ${cleanSnippet}`);
    if (r.published || r.date) lines.push(`published: ${r.published || r.date}`);
    const rExt = r as NovadaSearchResult & { extracted_content?: string | null; extract_error?: string };
    if (rExt.extracted_content != null) {
      lines.push(`extracted_content:`);
      lines.push(rExt.extracted_content);
    }
    if (rExt.extract_error) {
      lines.push(`extract_error: ${rExt.extract_error}`);
    }
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`## Agent Hints`);
  lines.push(`- Results are reranked by relevance to your query (title + snippet keyword scoring)`);
  lines.push(`- To read any result in full: \`novada_extract\` with its url`);
  lines.push(`- To batch-read multiple results: \`novada_extract\` with \`url=[url1, url2, ...]\``);
  lines.push(`- For deeper multi-source research: \`novada_research\``);

  return lines.join("\n");
}

/** Unwrap Bing redirect/base64 encoded URLs */
function unwrapBingUrl(url: string): string {
  if (url.includes("bing.com/ck/a") || url.includes("r.bing.com")) {
    try {
      const u = new URL(url);
      const realUrl = u.searchParams.get("r") || u.searchParams.get("u");
      if (realUrl) {
        const cleaned = realUrl.replace(/^a1/, "");
        try {
          const decoded = Buffer.from(cleaned, "base64").toString("utf8");
          if (decoded.startsWith("http")) return decoded;
        } catch { /* not base64 */ }
        return decodeURIComponent(cleaned);
      }
    } catch { /* keep original */ }
  }
  if (!url.startsWith("http") && /^[A-Za-z0-9+/=]+$/.test(url) && url.length > 20) {
    try {
      const decoded = Buffer.from(url, "base64").toString("utf8");
      if (decoded.startsWith("http")) return decoded;
    } catch { /* keep original */ }
  }
  return url;
}
