import axios, { AxiosError } from "axios";
import * as cheerio from "cheerio";
import https from "https";
import { USER_AGENT, cleanParams, rerankResults, detectIntent, isSocialOrPr, SOCIAL_PR_DOMAINS, type SearchIntent } from "../utils/index.js";
import { SCRAPER_API_BASE, SCRAPER_DOWNLOAD_BASE, TIMEOUTS } from "../config.js";
import { saveOutput } from "../utils/output.js";
import type { SearchParams, NovadaApiResponse, NovadaSearchResult } from "./types.js";
import { novadaExtract } from "./extract.js";
import { makeNovadaError, NovadaErrorCode, sanitizeServerMsg } from "../_core/errors.js";

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

const _searchCache = new Map<string, { result: string; ts: number }>();
const SEARCH_CACHE_TTL = 60_000;

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
      httpsAgent: keepAliveAgent,
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

interface SearchFilterParams {
  time_range?: string;
  start_date?: string;
  end_date?: string;
  country?: string;
  language?: string;
}

interface SubmitSearchResult {
  /** Inline results parsed directly from the submit response (avoids a download round-trip). */
  inlineResults?: Record<string, unknown>;
  /** task_id for polling the download endpoint when inline results are absent. */
  taskId?: string;
}

/** Submit a search task via the Scraper API.
 *
 * Returns inline results when the API includes them synchronously in the submit
 * response (body.data.data.json[0].rest) — this is the common path for Google/DDG.
 * Falls back to returning a task_id for async download polling when inline results
 * are absent.
 */
export async function submitSearchScrapeTask(
  apiKey: string,
  scraperName: string,
  scraperId: string,
  query: string,
  num: number,
  queryParam = "q",
  supportsNum = true,
  filterParams: SearchFilterParams = {}
): Promise<SubmitSearchResult> {
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
  if (filterParams.time_range) form.append("time_range", filterParams.time_range);
  if (filterParams.start_date) form.append("start_date", filterParams.start_date);
  if (filterParams.end_date) form.append("end_date", filterParams.end_date);
  if (filterParams.country) form.append("country", filterParams.country);
  if (filterParams.language) form.append("language", filterParams.language);

  const resp = await axios.post(`${SCRAPER_API_BASE}/request`, form, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 60000,
    httpsAgent: keepAliveAgent,
  });

  const body = resp.data as { code: number; msg?: string; data: unknown };

  // Auth error codes returned as HTTP 200 with non-zero body code
  if (body.code === 10001) {
    throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, 'Invalid or missing API key (code 10001)');
  }
  if (body.code === 50001 || body.code === 50002 || body.code === 50003) {
    throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, `Scraper API auth error (code: ${body.code})`);
  }
  if (body.code === 500) {
    throw makeNovadaError(NovadaErrorCode.API_DOWN, `Scraper API server error`);
  }

  if (body.code !== 0) {
    throw new Error(`Scraper search submit error (code ${body.code}): ${sanitizeServerMsg(body.msg ?? "unknown")}`);
  }

  const inner = body.data as Record<string, unknown> | null;
  const innerData = inner?.data as Record<string, unknown> | undefined;

  // Fast path: API returned inline results synchronously in body.data.data.json[0].rest
  // This is the common response shape for Google and DuckDuckGo — avoids a download round-trip.
  const inlineJson = innerData?.json as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(inlineJson) && inlineJson.length > 0) {
    const firstItem = inlineJson[0];
    const rest = firstItem?.rest as Record<string, unknown> | undefined;
    if (rest && (Array.isArray(rest.organic) || Array.isArray(rest.organic_results))) {
      return { inlineResults: rest };
    }
  }

  // Slow path: no inline results — extract task_id for async download polling
  const taskId = (
    (inner?.task_id as string | undefined) ??
    (innerData?.task_id as string | undefined)
  );
  if (!taskId) {
    throw new Error(`Scraper search submit: no task_id in response: ${JSON.stringify(body)}`);
  }
  return { taskId };
}

/**
 * Resolve a SubmitSearchResult to NovadaSearchResult[].
 * Uses inline results when available (fast path), falls back to polling the
 * download endpoint (slow path).
 */
export async function resolveSearchResults(
  apiKey: string,
  submitted: SubmitSearchResult
): Promise<NovadaSearchResult[]> {
  if (submitted.inlineResults) {
    return parseScraperSearchResults(submitted.inlineResults);
  }
  if (submitted.taskId) {
    const data = await pollSearchResult(apiKey, submitted.taskId);
    return parseScraperSearchResults(data);
  }
  return [];
}

/** Poll the download endpoint until the search task completes or times out. */
export async function pollSearchResult(apiKey: string, taskId: string): Promise<Record<string, unknown>> {
  const url = `${SCRAPER_DOWNLOAD_BASE}/scraper_download?task_id=${encodeURIComponent(taskId)}&file_type=json&apikey=${encodeURIComponent(apiKey)}`;
  const deadline = Date.now() + TIMEOUTS.SEARCH_TOTAL_CEILING;
  let pollAttempt = 0;

  // No pre-wait: poll immediately. If the task is still pending we get 27202 and
  // enter the backoff loop (100ms first interval). Removing the 300ms fixed pre-wait
  // saves ~300ms on the slow path and has zero cost on the fast path.

  while (Date.now() < deadline) {
    const resp = await axios.get(url, { timeout: 30000, httpsAgent: keepAliveAgent });
    const body = resp.data;

    // Pending: exponential backoff capped at 1000ms (was 2000ms).
    // Backend processing is typically 1–3s so a 1000ms cap gives good coverage
    // while cutting worst-case poll delay in half vs the old 2000ms cap.
    if (body !== null && typeof body === "object" && !Array.isArray(body) &&
        (body as Record<string, unknown>).code === 27202) {
      await scraperSleep(Math.min(100 * Math.pow(2, pollAttempt), 1000));
      pollAttempt++;
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
        await scraperSleep(Math.min(100 * Math.pow(2, pollAttempt), 1000));
        pollAttempt++;
        continue;
      }
      throw new Error(`Scraper download error (code ${bObj.code ?? "?"}): ${bObj.msg ?? JSON.stringify(bObj).slice(0, 150)}`);
    }

    throw new Error(`Unexpected scraper download response: ${JSON.stringify(body).slice(0, 200)}`);
  }

  throw new Error(`Scraper search task ${taskId} timed out after ${TIMEOUTS.SEARCH_TOTAL_CEILING / 1000}s.`);
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
- Use engine="google" (fast, reliable) — same query syntax, equivalent results. engine="duckduckgo" also works.

## Agent Notice — Engine Unavailable
engine: yahoo | status: unsupported | suggested_alternatives: google, duckduckgo`;

export async function novadaSearch(params: SearchParams, apiKey: string): Promise<string> {
  // Trim BEFORE the required check so a whitespace-only query ('   ') is rejected
  // with the same validation error as empty — no live call, no quota burn. The
  // trimmed value is reused for the rest of the request so we never send padding
  // upstream or key the cache on it.
  if (typeof params.query !== 'string') {
    throw new Error('query is required and must be a non-empty string');
  }
  const query = params.query.trim();
  if (!query) {
    throw new Error('query is required and must be a non-empty string');
  }
  params = { ...params, query };

  const engine = params.engine || "google";

  // num is a hard ceiling AND a best-effort floor. We over-fetch upstream so that
  // post-dedup + post-exclude_social still yields ~num, then slice to requestedNum
  // before rendering (see below). overFetchNum is the upstream ask; engines that
  // honour `num` will return more candidates to absorb dedup/filter shrinkage.
  const requestedNum = params.num || 10;
  const overFetchNum = Math.min(requestedNum + 10, 40);

  // Yahoo has no scraper-API path — return a clear redirect message immediately.
  if (engine === "yahoo") {
    return YAHOO_UNAVAILABLE;
  }

  // Cache key must include every param that changes the result set, otherwise
  // two searches differing only by (e.g.) exclude_social collide and return
  // stale, semantically-wrong results.
  const cacheKey = [
    engine,
    params.query,
    params.num ?? 10,
    params.project ?? "",
    params.format ?? "markdown",
    params.source_type ?? "",
    params.exclude_social ? "1" : "",
    (params.include_domains ?? []).join(",") ,
    (params.exclude_domains ?? []).join(","),
    params.time_range ?? "",
    params.start_date ?? "",
    params.end_date ?? "",
  ].join("|");
  const cached = _searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) {
    return cached.result;
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

  // Source-authority biasing: for research/official source_type, append the
  // social/PR domains to the query-level exclusions so the SERP itself
  // de-emphasizes them (cheaper + higher-quality than post-fetch filtering).
  // Skip domains the caller already excluded to avoid a bloated query.
  if (params.source_type === "research" || params.source_type === "official") {
    const already = new Set((params.exclude_domains ?? []).map(d => d.toLowerCase()));
    const socialExclusions = SOCIAL_PR_DOMAINS
      .filter(d => !already.has(d))
      .map(d => `-site:${d}`)
      .join(" ");
    if (socialExclusions) effectiveQuery = `${effectiveQuery} ${socialExclusions}`;
  }

  // Effective rerank intent: source_type overrides automatic query detection.
  const effectiveIntent: SearchIntent =
    params.source_type === "research" || params.source_type === "official"
      ? "factual"
      : params.source_type === "social"
        ? "social"
        : detectIntent(params.query);

  try {
    if (engine === "bing") {
      // Bing uses is_auto_push=false and may return HTML synchronously or a task_id
      scraperResults = await submitBingSearch(apiKey, effectiveQuery);
    } else {
      const engineCfg = ENGINE_MAP[engine];
      const submitted = await submitSearchScrapeTask(
        apiKey,
        engineCfg.scraper_name,
        engineCfg.scraper_id,
        effectiveQuery,
        overFetchNum,
        engineCfg.query_param,
        engineCfg.supports_num,
        {
          time_range: params.time_range,
          start_date: params.start_date,
          end_date: params.end_date,
          country: params.country || undefined,
          language: params.language || undefined,
        }
      );
      // Fast path: inline results from submit response (no download round-trip needed)
      if (submitted.inlineResults) {
        scraperResults = parseScraperSearchResults(submitted.inlineResults);
      } else if (submitted.taskId) {
        // Slow path: poll download endpoint
        const resultData = await pollSearchResult(apiKey, submitted.taskId);
        scraperResults = parseScraperSearchResults(resultData);
      }
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

  let results: NovadaSearchResult[] = scraperResults;

  // exclude_social: hard-drop social/PR results post-fetch. Applied before the
  // empty-check so an all-social SERP correctly reports "no results".
  if (params.exclude_social) {
    results = results.filter(r => !isSocialOrPr(r.url || r.link));
  }

  if (results.length === 0) {
    const emptyResult = [
      `## Search Results`,
      `results:0 | engine:${engine}`,
      ``,
      `No results found for: "${params.query}"`,
      ``,
      `## Agent Hints`,
      `- Try a broader or rephrased query`,
      `- Try a different engine: engine="google" (fast, reliable fallback), or engine="duckduckgo" / "yandex". Avoid engine="bing" — currently degraded.`,
      `- Use novada_research for multi-source investigation`,
      `- Use novada_map + novada_extract if you have a known site`,
    ].join("\n");
    // Cache empty results too so repeated calls don't re-poll the API
    _searchCache.set(cacheKey, { result: emptyResult, ts: Date.now() });
    if (_searchCache.size > 100) {
      const oldest = [..._searchCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      _searchCache.delete(oldest[0]);
    }
    return emptyResult;
  }

  // Dedup by URL before scoring — upstream SERPs (and over-fetching) can repeat
  // the same link. Keep first occurrence; results with no URL are kept as-is
  // (they're skipped later at render time anyway).
  const seenUrls = new Set<string>();
  results = results.filter(r => {
    const u = r.url || r.link;
    if (!u) return true;
    const key = u.toLowerCase();
    if (seenUrls.has(key)) return false;
    seenUrls.add(key);
    return true;
  });

  // Rerank by relevance to query, with bounded intent-gated domain-authority signal,
  // then enforce num as a hard ceiling (slice). This makes every engine — including
  // duckduckgo, which can over-return — respect num. When fewer than requested are
  // genuinely available we surface a scarcity hint (requested:N returned:M) below.
  const reranked = rerankResults(results, params.query, effectiveIntent).slice(0, requestedNum);
  const scarcity = reranked.length < requestedNum
    ? `requested:${requestedNum} returned:${reranked.length}`
    : "";

  // P1-7: Auto-extract content from top N results when extract_options is provided
  // P2-1: enrich_top shorthand — equivalent to extract_options: { top_n: 1 }
  if (params.extract_options || params.enrich_top) {
    const opts = params.extract_options ?? { top_n: 1, format: "markdown" as const };
    const topN = opts.top_n ?? (params.enrich_top ? 1 : 3);
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
          const extractedText = content.replace(/^📁[^\n]*\n\n/, "");
          return { url, content: extractedText, ok: true };
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

  // ── JSON output mode ──────────────────────────────────────────────────────
  const engineLabel = `${engine} (via scraper-api)`;

  if (params.format === "json") {
    const jsonResult = {
      status: "ok",
      query: params.query,
      engine: engineLabel,
      source: "live",
      result_count: reranked.length,
      results: reranked.map((r, i) => {
        const url = r.url || r.link;
        const result: Record<string, unknown> = {
          rank: i + 1,
          title: r.title || "Untitled",
          url: url ? unwrapBingUrl(url) : null,
          snippet: r.description || r.snippet || "",
        };
        if (r.published || r.date) result.published = r.published || r.date;
        // Include extracted content if present (from extract_options or enrich_top)
        const rExt = r as Record<string, unknown>;
        if (rExt.extracted_content) result.extracted_content = rExt.extracted_content;
        if (rExt.extract_error) result.extract_error = rExt.extract_error;
        return result;
      }),
      agent_instruction: "Search complete. Call novada_extract with results[0].url to read the full page. Call novada_research for deeper multi-source investigation.",
    };
    // Surface a scarcity signal when fewer than `num` results were genuinely
    // available, so agents don't assume the ceiling was hit.
    if (scarcity) (jsonResult as Record<string, unknown>).scarcity = scarcity;
    // Wire output save — best-effort, never breaks the tool.
    // Inject output_saved as a field so JSON remains valid and parseable.
    try {
      const outputResult = await saveOutput({
        tool: "search",
        hint: params.query?.slice(0, 30) || "search",
        format: "json",
        data: { query: params.query, engine: params.engine, results: reranked },
        project: params.project,
      });
      (jsonResult as Record<string, unknown>).output_saved = outputResult.filePath;
    } catch { /* best-effort */ }
    const finalResult = JSON.stringify(jsonResult, null, 2);

    _searchCache.set(cacheKey, { result: finalResult, ts: Date.now() });
    if (_searchCache.size > 100) {
      const oldest = [..._searchCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      _searchCache.delete(oldest[0]);
    }
    return finalResult;
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
  if (params.source_type && params.source_type !== "any") activeFilters.push(`source:${params.source_type}`);
  if (params.exclude_social) activeFilters.push(`exclude_social:true`);

  if (scarcity) activeFilters.push(scarcity);

  const filterStr = activeFilters.length ? ` | ${activeFilters.join(" | ")}` : "";

  const lines: string[] = [
    `## Search Results`,
    `results:${reranked.length} | engine:${engineLabel} | source: live | reranked:true${filterStr}`,
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
    const fullSnippet = rawSnippet
      .replace(/\.{3}\s*Read\s+more\s*$/i, "...")
      .replace(/\s+Read\s+more\s*$/i, "")
      .replace(/\s+More\s*$/i, "")
      .trim();
    const cleanSnippet = fullSnippet.length > 400
      ? fullSnippet.slice(0, 397) + "..."
      : fullSnippet || "No description";

    lines.push(`## ${i + 1}. [${r.title || "Untitled"}](${url})`);
    if (r.published || r.date) lines.push(`published: ${r.published || r.date}`);
    lines.push(cleanSnippet);
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
  lines.push(`- Results are reranked by relevance (title + snippet keyword scoring) plus a bounded source-authority signal: authoritative sources (*.gov, *.edu, sec.gov, arxiv.org, reuters.com, wikipedia.org, nature.com …) are boosted and social/PR sources de-emphasized for factual/finance/research queries. Override via source_type or pass exclude_social=true to drop social/PR entirely.`);
  lines.push(`- To read any result in full: \`novada_extract\` with its url`);
  lines.push(`- To batch-read multiple results: \`novada_extract\` with \`url=[url1, url2, ...]\``);
  lines.push(`- For deeper multi-source research: \`novada_research\``);

  lines.push(``);
  lines.push(`## Chainable Output`);
  lines.push(`result_count: ${reranked.length}`);
  const topUrls = reranked.slice(0, 5).map((r, i) => `  [${i + 1}] ${r.url || r.link}`).join("\n");
  lines.push(`top_urls:\n${topUrls}`);
  lines.push(`agent_instruction: Search complete. Call novada_extract with any url above to read the full page. Call novada_research for deeper multi-source investigation.`);

  lines.push(``);
  lines.push(`## Agent Memory`);
  const topResult = reranked[0];
  const topTitle = topResult?.title || "Untitled";
  const topUrl = topResult?.url || topResult?.link || "N/A";
  lines.push(`remember: Top result for '${params.query}': ${topTitle} — ${topUrl}`);

  let finalResult = lines.join("\n");

  // Wire output save — best-effort, never breaks the tool.
  // Prepend the file path to the HEADER so agents that truncate long responses still see it.
  let savePrefix = "";
  try {
    const outputResult = await saveOutput({
      tool: "search",
      hint: params.query?.slice(0, 30) || "search",
      format: "json",
      data: { query: params.query, engine: params.engine, results: reranked },
      project: params.project,
    });
    savePrefix = `📁 ${outputResult.filePath}\n\n`;
  } catch { /* best-effort */ }
  finalResult = savePrefix + finalResult;

  _searchCache.set(cacheKey, { result: finalResult, ts: Date.now() });
  if (_searchCache.size > 100) {
    const oldest = [..._searchCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    _searchCache.delete(oldest[0]);
  }
  return finalResult;
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
