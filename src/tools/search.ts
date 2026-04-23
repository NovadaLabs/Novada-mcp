import axios, { AxiosError } from "axios";
import { fetchWithRetry, USER_AGENT, cleanParams, rerankResults } from "../utils/index.js";
import { SCRAPER_API_BASE } from "../config.js";
import type { SearchParams, NovadaApiResponse, NovadaSearchResult } from "./types.js";

const SERP_UNAVAILABLE = `## Search Unavailable

The Novada SERP endpoint is not yet configured for this API key.

**Alternatives while SERP is unavailable:**
- \`novada_extract\` with a direct URL — e.g. \`https://www.google.com/search?q=your+query\`
- \`novada_research\` — multi-source research without a dedicated search API
- \`novada_map\` + \`novada_extract\` — discover and read pages from a known site

Contact support@novada.com to enable SERP access for your account.`;

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
  const searchParams = new URLSearchParams(cleaned);

  let response;
  try {
    response = await fetchWithRetry(
      `${SCRAPER_API_BASE}/search?${searchParams.toString()}`,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Origin: "https://www.novada.com",
          Referer: "https://www.novada.com/",
        },
      }
    );
  } catch (error) {
    if (error instanceof AxiosError && error.response?.status === 404) {
      return SERP_UNAVAILABLE;
    }
    throw error;
  }

  const data: NovadaApiResponse = response.data;

  if (data.code && data.code !== 200 && data.code !== 0) {
    throw new Error(`Novada API error (code ${data.code}): ${data.msg || "Unknown error"}`);
  }

  const results: NovadaSearchResult[] = data.data?.organic_results || data.organic_results || [];
  if (results.length === 0) {
    return "No results found for this query.";
  }

  // Rerank by relevance to query
  const reranked = rerankResults(results, params.query);

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
    let url = r.url || r.link || "N/A";
    url = unwrapBingUrl(url);

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
