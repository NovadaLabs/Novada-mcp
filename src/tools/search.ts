import axios, { AxiosError } from "axios";
import * as cheerio from "cheerio";
import { USER_AGENT, cleanParams, rerankResults } from "../utils/index.js";
import { SCRAPER_API_BASE, SCRAPER_DOWNLOAD_BASE } from "../config.js";
import type { SearchParams, NovadaApiResponse, NovadaSearchResult } from "./types.js";
import { novadaExtract } from "./extract.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";

const SCRAPER_SEARCH_ENGINES = new Set(["google", "bing", "duckduckgo", "yandex"]);

interface ScraperSearchEngine {
  scraper_name: string;
  scraper_id: string;
  query_param: string;  // canonical query field name for this engine
  supports_num: boolean; // whether this engine accepts the num parameter
}

const ENGINE_MAP: Record<string, ScraperSearchEngine> = {
  google:     { scraper_name: "google.com",     scraper_id: "google_search", query_param: "q",       supports_num: true  },
  bing:       { scraper_name: "bing.com",        scraper_id: "bing_search",   query_param: "q",       supports_num: false },
  duckduckgo: { scraper_name: "duckduckgo.com",  scraper_id: "duckduckgo",    query_param: "q",       supports_num: true  },
  yandex:     { scraper_name: "yandex.com",      scraper_id: "yandex",        query_param: "keyword", supports_num: false },
};

function scraperSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Parse Bing SERP HTML (returned in sync mode with is_auto_push=false) into search results. */
function parseBingHtml(html: string): NovadaSearchResult[] {
  const $ = cheerio.load(html);
  const results: NovadaSearchResult[] = [];

  $("li.b_algo").each((_, el) => {
    const titleEl = $(el).find("h2 a");
    const title = titleEl.text().trim();
    const rawUrl = titleEl.attr("href") ?? "";
    const url = rawUrl.startsWith("http") ? rawUrl : "";

    const snippet =
      $(el).find(".b_caption p").first().text().trim() ||
      $(el).find("p.b_para").first().text().trim() ||
      $(el).find("p").first().text().trim();

    if (title && url) {
      results.push({ title, url, link: url, snippet, description: snippet });
    }
  });

  return results;
}

/**
 * Submit a Bing search using is_auto_push=false.
 * Prefers the task_id path — download endpoint returns parsed organic_results,
 * which is more reliable than cheerio HTML parsing.
 * Retries up to 3 times because the API returns data.data.data=null ~20% of the time.
 */
async function submitBingSearch(apiKey: string, query: string): Promise<NovadaSearchResult[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await scraperSleep(2000);

    const form = new URLSearchParams();
    form.append("scraper_name", "bing.com");
    form.append("scraper_id", "bing_search");
    form.append("scraper_errors", "true");
    form.append("a_auto_push", "false"); // Bing-specific param (NOT is_auto_push) — confirmed from dashboard playground
    form.append("q", query);
    form.append("json", "1");
    form.append("no_cache", "false");
    form.append("safe", "off");

    const resp = await axios.post(`${SCRAPER_API_BASE}/request`, form, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 60000,
    });

    const body = resp.data as { code: number; msg?: string; data: unknown };
    if (body.code !== 0) {
      throw new Error(`Bing search error (code ${body.code}): ${body.msg ?? "unknown"}`);
    }

    const inner = body.data as Record<string, unknown> | null;
    const innerData = inner?.data as Record<string, unknown> | null;

    // Prefer task_id path — download endpoint returns parsed organic_results
    // task_id lives at data.data.data.task_id (not data.data.task_id)
    const taskId = (
      (inner?.task_id as string | undefined) ??
      (innerData?.task_id as string | undefined)
    );
    if (taskId) {
      const resultData = await pollSearchResult(apiKey, taskId);
      const results = parseScraperSearchResults(resultData);
      if (results.length > 0) return results;
    }

    // HTML fallback (task_id polling returned empty or task_id absent)
    const html = innerData?.html as string | undefined;
    if (html) {
      const results = parseBingHtml(html);
      if (results.length > 0) return results;
    }

    // Sync direct organic result
    if (inner?.organic_results || inner?.organic) {
      return parseScraperSearchResults(inner as Record<string, unknown>);
    }

    // data.data.data was null — retry
  }

  return [];
}

/** Submit a search task via the Scraper API and return the task_id. */
export async function submitSearchScrapeTask(
  apiKey: string,
  scraperName: string,
  scraperId: string,
  query: string,
  num: number,
  queryParam = "q",
  supportsNum = true
): Promise<string> {
  const form = new URLSearchParams();
  form.append("scraper_name", scraperName);
  form.append("scraper_id", scraperId);
  form.append("scraper_errors", "true");
  form.append("is_auto_push", "false");
  form.append(queryParam, query);
  if (supportsNum) form.append("num", String(num));
  form.append("json", "1");
  form.append("no_cache", "false");
  if (scraperName === "bing.com") {
    form.append("safe", "off");
  }

  const resp = await axios.post(`${SCRAPER_API_BASE}/request`, form, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 60000,
  });

  const body = resp.data as { code: number; msg?: string; data: unknown };
  if (body.code !== 0) {
    throw new Error(`Scraper search submit error (code ${body.code}): ${body.msg ?? "unknown"}`);
  }

  const inner = body.data as Record<string, unknown> | null;
  const taskId = (
    (inner?.task_id as string | undefined) ??
    ((inner?.data as Record<string, unknown> | undefined)?.task_id as string | undefined)
  );
  if (!taskId) {
    throw new Error(`Scraper search submit: no task_id in response: ${JSON.stringify(body)}`);
  }
  return taskId;
}

/** Poll the download endpoint until the search task completes or times out. */
export async function pollSearchResult(apiKey: string, taskId: string): Promise<Record<string, unknown>> {
  const url = `${SCRAPER_DOWNLOAD_BASE}/scraper_download?task_id=${encodeURIComponent(taskId)}&file_type=json&apikey=${encodeURIComponent(apiKey)}`;
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const resp = await axios.get(url, { timeout: 30000 });
    const body = resp.data;

    // Pending
    if (body !== null && typeof body === "object" && !Array.isArray(body) &&
        (body as Record<string, unknown>).code === 27202) {
      await scraperSleep(2000);
      continue;
    }

    // Complete: array of result items — take first successful item
    if (Array.isArray(body) && body.length > 0) {
      const first = body[0] as Record<string, unknown>;
      // Wrapped envelope format
      if ("rest" in first) {
        return first.rest as Record<string, unknown>;
      }
      // Flat format — look for organic_results at top level
      if ("organic_results" in first || "organic" in first) {
        return first;
      }
      return first;
    }

    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      const bObj = body as Record<string, unknown>;
      // Direct result object — flat format (organic_results / search_metadata at top level)
      if ("organic_results" in bObj || "organic" in bObj || "results" in bObj || "search_metadata" in bObj) {
        return bObj;
      }
      // Still pending
      if (bObj.code === 27202) {
        await scraperSleep(2000);
        continue;
      }
      throw new Error(`Scraper download error (code ${bObj.code ?? "?"}): ${bObj.msg ?? JSON.stringify(bObj).slice(0, 150)}`);
    }

    throw new Error(`Unexpected scraper download response: ${JSON.stringify(body).slice(0, 200)}`);
  }

  throw new Error(`Scraper search task ${taskId} timed out after 90s.`);
}

/** Parse scraper API result data into NovadaSearchResult[]. */
export function parseScraperSearchResults(data: Record<string, unknown>): NovadaSearchResult[] {
  const organic = (
    data.organic_results ?? data.organic ?? data.results ?? data.items ?? []
  );
  if (!Array.isArray(organic)) return [];

  return (organic as Record<string, unknown>[]).map(item => ({
    title: (item.title as string | undefined) ?? "",
    url: (item.url as string | undefined) ?? (item.link as string | undefined) ?? ((item.source as Record<string, unknown> | undefined)?.link as string | undefined) ?? "",
    link: (item.link as string | undefined) ?? (item.url as string | undefined) ?? ((item.source as Record<string, unknown> | undefined)?.link as string | undefined) ?? "",
    snippet: (item.snippet as string | undefined) ?? (item.description as string | undefined) ?? "",
    description: (item.description as string | undefined) ?? (item.snippet as string | undefined) ?? "",
    published: (item.published as string | undefined) ?? (item.date as string | undefined),
    date: (item.date as string | undefined) ?? (item.published as string | undefined),
  }));
}

// ---------------------------------------------------------------------------

const SERP_UNAVAILABLE = `## Search Unavailable

The Novada SERP endpoint is not yet available for this API key.

**Why:** \`novada_search\` requires a dedicated SERP quota that is separate from
the Scraper API and Web Unblocker plans. Contact support@novada.com to enable it.

**Alternatives right now:**
- \`novada_extract\` — fetch and read any specific URL directly
- \`novada_research\` — multi-source research using extract-based discovery
- \`novada_map\` + \`novada_extract\` — discover and read pages from a known site`;

const YAHOO_UNAVAILABLE = `## Search Unavailable — Yahoo

Yahoo Search is not available on this account.

## Agent Hints
- Use engine="google" or engine="bing" — same query syntax, equivalent results.

## Agent Notice — Engine Unavailable
engine: yahoo | status: unsupported | suggested_alternatives: google, bing`;

export async function novadaSearch(params: SearchParams, apiKey: string): Promise<string> {
  const engine = params.engine || "google";

  // Yahoo has no scraper-API path — return a clear redirect message immediately.
  if (engine === "yahoo") {
    return YAHOO_UNAVAILABLE;
  }

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

  let scraperResults: NovadaSearchResult[] = [];

  if (!SCRAPER_SEARCH_ENGINES.has(engine)) {
    return SERP_UNAVAILABLE;
  }

  // Apply domain filters as query modifiers (site: syntax works on all engines)
  let effectiveQuery = params.query;
  if (params.include_domains?.length) {
    if (params.include_domains.length === 1) {
      effectiveQuery = `${params.query} site:${params.include_domains[0]}`;
    } else {
      const siteFilter = params.include_domains.slice(0, 10).map(d => `site:${d}`).join(" OR ");
      effectiveQuery = `${params.query} (${siteFilter})`;
    }
  }
  if (params.exclude_domains?.length) {
    const exclusions = params.exclude_domains.slice(0, 10).map(d => `-site:${d}`).join(" ");
    effectiveQuery = `${effectiveQuery} ${exclusions}`;
  }

  try {
    if (engine === "bing") {
      // Bing uses is_auto_push=false and may return HTML synchronously or a task_id
      scraperResults = await submitBingSearch(apiKey, effectiveQuery);
    } else {
      const engineCfg = ENGINE_MAP[engine];
      const taskId = await submitSearchScrapeTask(
        apiKey,
        engineCfg.scraper_name,
        engineCfg.scraper_id,
        effectiveQuery,
        params.num || 10,
        engineCfg.query_param,
        engineCfg.supports_num
      );
      const resultData = await pollSearchResult(apiKey, taskId);
      scraperResults = parseScraperSearchResults(resultData);
    }
  } catch (err: unknown) {
    // 4xx errors: SERP endpoint unavailable / quota exhausted / auth failure
    if (err instanceof AxiosError) {
      return SERP_UNAVAILABLE;
    }
    const msg = err instanceof Error ? err.message : "";
    if (/code 40[0-9]|permission|quota|unauthorized|forbidden/i.test(msg)) {
      return SERP_UNAVAILABLE;
    }
    throw err;
  }

  const results: NovadaSearchResult[] = scraperResults;
  if (results.length === 0) {
    return [
      `## Search Results`,
      `results:0 | engine:${engine}`,
      ``,
      `No results found for: "${params.query}"`,
      ``,
      `## Agent Hints`,
      `- Try a broader or rephrased query`,
      `- Try a different engine: engine="duckduckgo" or engine="bing"`,
      `- Use novada_research for multi-source investigation`,
      `- Use novada_map + novada_extract if you have a known site`,
    ].join("\n");
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

  const engineLabel = `${engine} (via scraper-api)`;

  const lines: string[] = [
    `## Search Results`,
    `results:${reranked.length} | engine:${engineLabel} | reranked:true${filterStr}`,
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
