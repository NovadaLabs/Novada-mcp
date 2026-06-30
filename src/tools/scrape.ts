import axios, { AxiosError } from "axios";
import { SCRAPER_API_BASE, SCRAPER_DOWNLOAD_BASE, HOSTED_SAFE_CEILING_MS } from "../config.js";
import { formatAsMarkdown } from "../utils/format.js";
import { saveOutput } from "../utils/output.js";
import { NovadaError, NovadaErrorCode, makeNovadaError, sanitizeServerMsg } from "../_core/errors.js";
import type { ScrapeParams, ScrapeParamsFullType } from "./types.js";

const SCRAPE_ENDPOINT = `${SCRAPER_API_BASE}/request`;

// How long to wait for a task to complete before giving up.
// Amazon and similar scrapers can take 120-180s, but the hosted Vercel function
// is killed at ~60s (see novada-mcpserver config.maxDuration) and returns a BARE
// 504 that is NOT valid JSON-RPC (#5). Capping the poll at HOSTED_SAFE_CEILING_MS
// guarantees the tool emits a structured TASK_PENDING result the client can act on
// (resubmit / poll via novada_scraper_status) before the function is force-killed.
const POLL_TIMEOUT_MS = HOSTED_SAFE_CEILING_MS;
const POLL_INTERVAL_MS = 2_000;

interface SubmitApiResponse {
  code: number;
  msg?: string;
  data: unknown;
  timestamp?: number;
}

type DownloadResultItem =
  | { spider_code: 200; rest: Record<string, unknown> }
  | { error: string; error_code?: number };

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Submit a scraper task and return the task_id */
export async function submitScrapeTask(
  apiKey: string,
  scraper_name: string,
  scraper_id: string,
  params: Record<string, unknown>
): Promise<string> {
  const file_name = `novada_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const form = new URLSearchParams();
  form.append("scraper_name", scraper_name);
  form.append("scraper_id", scraper_id);
  form.append("scraper_errors", "true");
  form.append("is_auto_push", "false");
  form.append("file_name", file_name);

  // Two param formats exist in the Novada Scraper API:
  //   A) Search engines (google, bing, duckduckgo, yandex) — flat form fields + json=1
  //   B) All other platforms — scraper_params=[{...}] JSON array
  // Verified from dashboard playground 2026-05-18.
  const SEARCH_ENGINES = new Set(["google.com", "bing.com", "duckduckgo.com", "yandex.com"]);
  const RESERVED = new Set(["scraper_name", "scraper_id", "apikey", "api_key", "authorization",
    "scraper_errors", "is_auto_push"]);

  // H-4: Block prototype-pollution keys from flowing to form/JSON
  const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const opParams: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && !RESERVED.has(k.toLowerCase()) && !BLOCKED_KEYS.has(k)) {
      opParams[k] = v;
    }
  }

  if (SEARCH_ENGINES.has(scraper_name)) {
    // Format A: flat form fields for search engines
    if (!("json" in opParams)) opParams["json"] = 1; // request JSON output format
    for (const [k, v] of Object.entries(opParams)) {
      form.append(k, String(v));
    }
  } else {
    // Format B: scraper_params array for all other platforms
    // Always include scraper_params even when empty — backend requires this field
    form.append("scraper_params", JSON.stringify([opParams]));
  }

  const resp = await axios.post(SCRAPE_ENDPOINT, form, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 60000,
  });

  const body = resp.data as SubmitApiResponse;

  // Auth error codes returned as HTTP 200 with non-zero body code
  if (body.code === 50001 || body.code === 50002 || body.code === 50003) {
    throw makeNovadaError(NovadaErrorCode.INVALID_API_KEY, `Scraper API auth error (code: ${body.code})`);
  }
  if (body.code === 500) {
    throw makeNovadaError(NovadaErrorCode.API_DOWN, `Scraper API server error`);
  }

  if (body.code !== 0) {
    // H5: throw typed NovadaError for 11006/11008 — no brittle string matching needed at catch site
    if (body.code === 11006) {
      throw makeNovadaError(
        NovadaErrorCode.PRODUCT_UNAVAILABLE,
        `Scraper returned code 11006 for operation '${scraper_id}'. This means either: (1) the operation ID is invalid or unsupported for this account, or (2) Scraper API access is not activated. Verify the operation ID against novada://scraper-platforms before assuming it is an account issue.`,
        "code 11006",
      );
    }
    if (body.code === 11008) {
      throw makeNovadaError(
        NovadaErrorCode.INVALID_PARAMS,
        `Unknown platform '${scraper_name}'. Use the exact domain (e.g. 'amazon.com', 'reddit.com'). To find valid operation IDs: read the novada://scraper-platforms resource — operation names are exact and cannot be guessed.`,
        "code 11008",
      );
    }
    const errorMessages: Record<number, string> = {
      10001: "Missing required parameters. Check platform and operation fields.",
      11000: "Invalid API key.",
    };
    const msg = errorMessages[body.code] ?? body.msg ?? "Unknown scraper error";
    throw new Error(`Scraper error (code ${body.code}): ${sanitizeServerMsg(msg)}`);
  }

  // Accept both flat { code:0, data: { task_id: "..." } } and nested { code:0, data: { data: { task_id: "..." } } }
  const inner = body.data as Record<string, unknown> | null;
  const taskId = (
    (inner?.task_id as string | undefined) ??
    ((inner?.data as Record<string, unknown> | undefined)?.task_id as string | undefined)
  );
  if (!taskId) {
    throw new Error(`Scraper submit succeeded but no task_id in response: ${sanitizeServerMsg(JSON.stringify(body))}`);
  }

  return taskId;
}

/** Poll the download endpoint until the task completes or times out */
async function pollForResult(apiKey: string, taskId: string): Promise<DownloadResultItem[]> {
  const url = `${SCRAPER_DOWNLOAD_BASE}/scraper_download?task_id=${encodeURIComponent(taskId)}&file_type=json&apikey=${encodeURIComponent(apiKey)}`;
  // H3: safe version of URL for error messages — strips the apikey value to prevent key exposure
  const safeUrl = url.replace(/apikey=[^&]+/, "apikey=***");
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const resp = await axios.get(url, { timeout: 30000 });
    const body = resp.data;

    // Pending: { code: 27202, data: null, msg: "" }
    if (
      body !== null &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as Record<string, unknown>).code === 27202
    ) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Complete: array of result items
    if (Array.isArray(body)) {
      return body as DownloadResultItem[];
    }

    // Known error codes from the download endpoint
    if (
      body !== null &&
      typeof body === "object" &&
      !Array.isArray(body)
    ) {
      const bErr = body as Record<string, unknown>;
      const errCode = bErr.code as number | undefined;
      const errMsg = (bErr.msg as string | undefined) ?? "";
      if (errCode === 10001) {
        throw new Error(`Scraper download error 10001 (Invalid file type): The server could not return results as JSON for this scraper. Try a different operation, or check that the platform and operation names are correct. Use novada://scraper-platforms to find valid operations.`);
      }
      if (errCode === 10002 || errCode === 10003) {
        throw new Error(`Scraper task error (code ${errCode}): ${errMsg || "Task failed on the server side."} Retry with different parameters.`);
      }
      if (errCode === 27203) {
        throw new Error(`Scraper task failed (code 27203): Server-side task execution error. ${errMsg}. This is a transient error — retry once.`);
      }
      // code 10000 from the legacy proxy download endpoint means "result not yet available"
      // (equivalent to 27202 from task_status). Continue polling — do NOT throw.
      // Only throw if we've already seen 27202 confirmed Ready from task_status.
      if (errCode === 10000) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      // Direct result object — Google SERP and similar formats return organic/search_metadata at top level
      if ("organic_results" in bErr || "organic" in bErr || "search_metadata" in bErr) {
        return [{ spider_code: 200 as const, rest: bErr }];
      }
      throw new Error(`Unexpected download response (code ${errCode ?? "?"}): ${sanitizeServerMsg(errMsg || JSON.stringify(bErr).slice(0, 150))}`);
    }
    throw new Error(`Unexpected download response: ${sanitizeServerMsg(JSON.stringify(body).slice(0, 200))}`);
  }

  // H-8: Use NovadaError(TASK_PENDING) instead of generic Error to avoid
  // classifyError mismatching "timed out" → URL_UNREACHABLE
  throw makeNovadaError(
    NovadaErrorCode.TASK_PENDING,
    `Scraper poll exceeded ${POLL_TIMEOUT_MS / 1000}s for task_id="${taskId}". The task may still be running server-side.`,
    "poll_timeout"
  );
}

/** Flatten a potentially nested object for tabular display.
 *  M-1: depth limit prevents stack overflow on deeply nested server responses. */
function flattenRecord(obj: unknown, prefix = "", depth = 0): Record<string, string> {
  if (obj === null || obj === undefined) return {};
  if (typeof obj !== "object" || Array.isArray(obj)) {
    return { [prefix || "value"]: String(obj) };
  }
  if (depth > 10) {
    return { [prefix || "value"]: JSON.stringify(obj).slice(0, 200) };
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(result, flattenRecord(v, key, depth + 1));
    } else if (Array.isArray(v)) {
      if (v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
        // Array of objects — flatten first 5; add truncation hint if more exist
        const cap = 5;
        v.slice(0, cap).forEach((item, idx) => {
          Object.assign(result, flattenRecord(item, `${key}.${idx}`, depth + 1));
        });
        if (v.length > cap) result[`${key}._count`] = `${v.length} total (showing first ${cap})`;
      } else {
        const joined = v.map(x => String(x ?? "")).join("; ");
        result[key] = joined.length > 200 ? joined.slice(0, 200) + "...(truncated)" : joined;
      }
    } else {
      result[key] = String(v ?? "");
    }
  }
  return result;
}

function extractRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.map(item =>
      typeof item === "object" && item !== null ? (item as Record<string, unknown>) : { value: item }
    );
  }
  if (data !== null && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of ["organic_results", "organic", "results", "items", "records", "data", "products", "posts"]) {
      if (Array.isArray(d[key])) return extractRecords(d[key]);
    }
    return [d];
  }
  return [];
}

// Aliases for stale or non-canonical operation IDs that appeared in old docs/examples.
// Maps a near-miss op ID an agent might guess → the canonical op ID the backend accepts.
// H-1: null-prototype object prevents __proto__/constructor/toString lookup pollution.
export const OPERATION_ALIASES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    "amazon_product_by-keywords": "amazon_product_keywords",
    "amazon_product_by-asin":     "amazon_product_asin",
    "google_shopping":            "google_shopping_keywords",
    "google_shopping_by-keyword": "google_shopping_keywords",
  }
);

// ─── Pre-flight platform → operation → required-param map ────────────────────
// #6: validate operation id AND required params BEFORE dispatching. A typo'd op id
// otherwise hangs ~60s → hosted 504; a missing required param burns a backend call
// for nothing. This map mirrors novada://scraper-platforms (the 13 active platforms,
// verified 2026-05-18). Each operation lists the params it needs — at least one of
// which must be present (most ops take exactly one). Search engines validate via
// SEARCH_ENGINE_PARAMS because they accept several near-equivalent query keys.
//
// H-1 parity: null-prototype objects prevent __proto__/constructor lookup pollution
// when an attacker-supplied platform/operation collides with Object.prototype keys.
type OpMap = Record<string, readonly string[]>;
function freezeOpMap(obj: Record<string, readonly string[]>): OpMap {
  return Object.assign(Object.create(null) as OpMap, obj);
}

// For search-engine platforms the query key varies (q / keyword); accept any of these.
const SEARCH_QUERY_KEYS = ["q", "keyword", "query"] as const;

export const PLATFORM_OPERATIONS: Record<string, OpMap> = Object.assign(
  Object.create(null) as Record<string, OpMap>,
  {
    "amazon.com": freezeOpMap({
      "amazon_product_asin": ["asin"],
      "amazon_product_url": ["url"],
      "amazon_product_keywords": ["keyword"],
      "amazon_product_category-url": ["url"],
      "amazon_product_best-sellers": ["url"],
      "amazon_global-product_url": ["url"],
      "amazon_global-product_category-url": ["url"],
      "amazon_global-product_seller-url": ["url"],
      "amazon_global-product_keywords": ["keyword"],
      "amazon_global-product_keywords-brand": ["keyword"],
      "amazon_comment_url": ["url"],
      "amazon_seller_url": ["url"],
      "amazon_product-list_keywords-domain": ["keyword"],
    }),
    "walmart.com": freezeOpMap({
      "walmart_product_url": ["url"],
      "walmart_product_category-url": ["url"],
      "walmart_product_sku": ["sku"],
      "walmart_product_keywords": ["keyword"],
      "walmart_product_zipcodes": ["url"],
    }),
    "google.com": freezeOpMap({
      "google_search": SEARCH_QUERY_KEYS,
      "google_serp_web": SEARCH_QUERY_KEYS,
      "google_serp_videos": SEARCH_QUERY_KEYS,
      "google_serp_hotels": SEARCH_QUERY_KEYS,
      "google_serp_jobs": SEARCH_QUERY_KEYS,
      "google_map-details_url": ["url"],
      "google_map-details_cid": ["cid"],
      "google_map-details_location": ["location"],
      "google_map-details_placeid": ["place_id"],
      "google_shopping_keywords": ["keyword"],
      "google_comment_url": ["url"],
    }),
    "bing.com": freezeOpMap({
      "bing_search": SEARCH_QUERY_KEYS,
      "bing_maps": SEARCH_QUERY_KEYS,
      "bing_images": SEARCH_QUERY_KEYS,
      "bing_videos": SEARCH_QUERY_KEYS,
      "bing_news": SEARCH_QUERY_KEYS,
      "bing_shopping": SEARCH_QUERY_KEYS,
    }),
    "duckduckgo.com": freezeOpMap({ "duckduckgo": SEARCH_QUERY_KEYS }),
    "yandex.com": freezeOpMap({ "yandex": SEARCH_QUERY_KEYS }),
    "x.com": freezeOpMap({
      "twitter_profile_profileurl": ["url"],
      "twitter_profile_username": ["username"],
      "twitter_post_posturl": ["url"],
    }),
    "tiktok.com": freezeOpMap({
      "tiktok_posts_url": ["url"],
      "tiktok_posts_profileurl": ["url"],
      "tiktok_posts_listurl": ["url"],
      "tiktok_profiles_url": ["url"],
      "tiktok_profiles_listurl": ["url"],
    }),
    "instagram.com": freezeOpMap({
      "ins_profiles_username": ["username"],
      "ins_profiles_profileurl": ["url"],
      "ins_reel_url": ["url"],
      "ins_allreel_url": ["url"],
      "ins_posts_profileurl": ["url"],
      "ins_posts_posturl": ["url"],
      "ins_comment_posturl": ["url"],
    }),
    "facebook.com": freezeOpMap({
      "facebook_event_eventlist-url": ["url"],
      "facebook_event_search-url": ["url"],
      "facebook_event_events-url": ["url"],
      "facebook_post_posts-url": ["url"],
      "facebook_comment_comments-url": ["url"],
      "facebook_profile_profiles-url": ["url"],
    }),
    "youtube.com": freezeOpMap({
      "youtube_video-post_url": ["url"],
      "youtube_video-post_search_filters": ["keyword"],
      "youtube_video_search_label": ["label"],
      "youtube_video-post-podcast-url": ["url"],
      "youtube_video-post-keyword": ["keyword"],
      "youtube_video-post_explore": ["keyword"],
      "youtube_product-videoid": ["video_id"],
      "youtube_video-url": ["url"],
      "youtube_audio_url": ["url"],
      "youtube_comment_id": ["video_id"],
      "youtube_transcript_id": ["url"],
      "youtube_profiles_keyword": ["keyword"],
      "youtube_profiles_url": ["url"],
    }),
    "linkedin.com": freezeOpMap({
      "linkedin_company_information_url": ["url"],
      "linkedin_job_listings_information_job-listing-url": ["url"],
      "linkedin_job_listings_information_job-url": ["url"],
      "linkedin_job_listings_information_keyword": ["keyword"],
    }),
    "github.com": freezeOpMap({
      "github_repository_repo-url": ["url"],
      "github_repository_search-url": ["url"],
      "github_repository_url": ["url"],
    }),
  }
);

// x.com is the canonical platform; twitter.com is a common alias agents try.
const PLATFORM_ALIASES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  { "twitter.com": "x.com" }
);

/** Resolve a platform alias (twitter.com → x.com) with a pollution-safe lookup. */
function resolvePlatform(platform: string): string {
  return Object.prototype.hasOwnProperty.call(PLATFORM_ALIASES, platform)
    ? PLATFORM_ALIASES[platform]
    : platform;
}

/**
 * #6 pre-flight: reject an unknown platform, an unknown operation for a known
 * platform, or a missing required param BEFORE any backend round-trip. Returns a
 * structured NovadaError (INVALID_PARAMS) whose agent_instruction lists the valid
 * operations — so the agent self-corrects without a 60s hang → 504. Returns null
 * when the platform is not in the active map (unknown/inactive platforms fall
 * through to the existing 11006/11008 backend handling — the map only covers the
 * 13 platforms that have live operations).
 */
export function preflightScrape(
  platform: string,
  operation: string,
  params: Record<string, unknown>,
): NovadaError | null {
  const ops = Object.prototype.hasOwnProperty.call(PLATFORM_OPERATIONS, platform)
    ? PLATFORM_OPERATIONS[platform]
    : undefined;
  // Unknown platform → defer to backend (11008). The map is the active-platform
  // allowlist, not an exhaustive domain registry, so we don't hard-reject here.
  if (!ops) return null;

  const validOps = Object.keys(ops);
  if (!Object.prototype.hasOwnProperty.call(ops, operation)) {
    const opList = validOps.join(", ");
    return new NovadaError({
      code: NovadaErrorCode.INVALID_PARAMS,
      message: `Unknown operation '${operation}' for platform '${platform}'. Operation IDs are exact and cannot be guessed.`,
      agent_instruction:
        `Use one of the valid operations for ${platform}: ${opList}. ` +
        `Read novada://scraper-platforms for the full list with required params. Do not retry with the same operation id.`,
      retryable: false,
      detail: `preflight:unknown_operation`,
    });
  }

  // Required-param check: at least one of the operation's accepted keys must be
  // present and non-empty. (Most ops take exactly one; search ops accept several.)
  const required = ops[operation];
  const hasOne = required.some((k) => {
    const v = params[k];
    return v !== undefined && v !== null && String(v).trim().length > 0;
  });
  if (!hasOne) {
    const keyList = required.length === 1 ? `'${required[0]}'` : `one of ${required.map((k) => `'${k}'`).join(", ")}`;
    return new NovadaError({
      code: NovadaErrorCode.INVALID_PARAMS,
      message: `Operation '${operation}' on '${platform}' requires ${keyList} in params, but none was provided.`,
      agent_instruction:
        `Add ${keyList} to the params object, e.g. novada_scrape({ platform: "${platform}", operation: "${operation}", params: { ${required[0]}: "<value>" } }). ` +
        `Read novada://scraper-platforms for the exact param shape.`,
      retryable: false,
      detail: `preflight:missing_param`,
    });
  }

  return null;
}

export async function novadaScrape(params: ScrapeParams | ScrapeParamsFullType, apiKey: string): Promise<string> {
  const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
  const { params: opParams, format } = params;
  const platform = resolvePlatform(params.platform);
  // H-1: safe lookup — null-prototype + hasOwnProperty guard
  const hasAlias = Object.prototype.hasOwnProperty.call(OPERATION_ALIASES, params.operation);
  const operation = hasAlias ? OPERATION_ALIASES[params.operation] : params.operation;

  // #6: pre-flight validation — fail fast on a bad op id / missing required param
  // BEFORE the backend round-trip, so a typo can't hang ~60s and 504. Reuses the
  // existing 11006-style typed-error contract (NovadaError → index.ts isError:true).
  const preflightErr = preflightScrape(platform, operation, (opParams ?? {}) as Record<string, unknown>);
  if (preflightErr) throw preflightErr;

  try {
  // Step 1: Submit task
  let taskId: string;
  try {
    taskId = await submitScrapeTask(apiKey, platform, operation, opParams as Record<string, unknown>);
  } catch (error) {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const body = error.response?.data;
      if (status === 401 || status === 403) {
        throw new Error("Invalid NOVADA_API_KEY or insufficient permissions for platform scrapers.");
      }
      throw new Error(`Scraper API error (HTTP ${status}): ${JSON.stringify(body)}`);
    }
    throw error;
  }

  // Step 2: Poll for result
  let resultItems: DownloadResultItem[];
  try {
    resultItems = await pollForResult(apiKey, taskId);
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(`Failed to retrieve scraper results: ${sanitizeServerMsg(error.message)}`);
    }
    throw error;
  }

  // Step 3: Extract records — handle two response formats from the download endpoint:
  //   Format A (flat): array of direct record objects, e.g. [{title:"...", error:null, success:true}, ...]
  //   Format B (wrapped): [{spider_code:200, rest:{...}}, ...] or [{error:"msg", error_code:N}]
  const firstItem = resultItems[0];
  if (!firstItem) {
    return `## Scrape Results\nplatform: ${platform} | operation: ${operation}\n\n_No records returned._`;
  }

  const firstAsRecord = firstItem as Record<string, unknown>;
  let rawRecords: Record<string, unknown>[];

  if ("spider_code" in firstAsRecord || "rest" in firstAsRecord) {
    // Format B: wrapped envelope
    const itemError = firstAsRecord.error;
    if (typeof itemError === "string" && itemError.length > 0) {
      const errCode = (firstAsRecord.error_code as number | undefined);
      throw new Error(`Scraper task failed (${errCode ?? "unknown"}): ${itemError}`);
    }
    rawRecords = extractRecords((firstAsRecord as { rest: Record<string, unknown> }).rest);
  } else {
    // Format A: flat array — separate successful items from error items
    const errorItems = resultItems.filter(item => {
      const err = (item as Record<string, unknown>).error;
      return typeof err === "string" && err.length > 0;
    });
    rawRecords = resultItems
      .filter(item => {
        const err = (item as Record<string, unknown>).error;
        return typeof err !== "string" || err.length === 0;
      })
      .map(item => item as unknown as Record<string, unknown>);

    // INC-190: When ALL items have errors, surface the error details instead of
    // misleading "No records returned". The underlying error_code (e.g. 300 = parse failure)
    // is the real root cause the agent needs.
    if (rawRecords.length === 0 && errorItems.length > 0) {
      const firstErr = errorItems[0] as Record<string, unknown>;
      const errCode = firstErr.error_code ?? "unknown";
      const errMsg = firstErr.error ?? "Unknown scraper error";
      throw new Error(
        `Scraper collected ${errorItems.length} result(s) but all failed. ` +
        `error_code: ${errCode} — ${sanitizeServerMsg(String(errMsg))}. ` +
        `This means the target page was reached but data extraction failed (parser error, empty page, or access blocked). ` +
        `Try a different operation or verify the target URL is correct.`
      );
    }
  }
  const records = rawRecords.slice(0, limit).map(r => flattenRecord(r)) as Record<string, unknown>[];

  if (records.length === 0) {
    return `## Scrape Results\nplatform: ${platform} | operation: ${operation}\n\n_No records returned._`;
  }

  const title = `${platform} — ${operation}`;

  let output: string;
  switch (format) {
    case "json":
      output = [
        `## Scrape Results`,
        `platform: ${platform} | operation: ${operation} | records: ${records.length} | source: live`,
        ``,
        "```json",
        JSON.stringify(rawRecords.slice(0, limit), null, 2),
        "```",
        ``,
        `---`,
        `## Agent Hints`,
        `- Increase limit (max 100) to retrieve more records.`,
        `- For human-readable output: use format='markdown' instead.`,
        `- Read novada://scraper-platforms resource to discover other operations on this platform.`,
      ].join("\n");
      break;

    case "toon": {
      // TOON: headers declared once, then pipe-separated rows — 40-65% token savings vs JSON/markdown
      // Union all keys across records to avoid dropping columns from heterogeneous rows
      const headerSet = new Set<string>();
      for (const r of records) Object.keys(r).forEach(k => headerSet.add(k));
      const headers = Array.from(headerSet);
      const toonRows = [
        `HEADERS: ${headers.join(" | ")}`,
        ...records.map(r => headers.map(h => String(r[h] ?? "")).join(" | ")),
      ];
      output = [
        `## Scrape Results`,
        `platform: ${platform} | operation: ${operation} | records: ${records.length} | source: live | format: toon`,
        ``,
        toonRows.join("\n"),
        ``,
        `---`,
        `## Agent Hints`,
        `- TOON format: first line starts with "HEADERS:" listing columns, subsequent lines are pipe-separated values.`,
        `- Use format='json' for downstream code processing, format='markdown' for human-readable output.`,
        `- Increase limit (max 100) to retrieve more records.`,
        ``,
        `## Agent Memory`,
        `remember: ${platform}/${operation} — ${records.length} records retrieved`,
      ].join("\n");
      break;
    }

    // M-4: CLI/SDK formats that reach here via ScrapeParamsFullType — render as markdown with a notice
    case "csv":
    case "html":
    case "xlsx":
    case "markdown":
    default:
      output = [
        `## Scrape Results`,
        `platform: ${platform} | operation: ${operation} | records: ${records.length} | source: live${records.length >= limit ? ` (limit:${limit})` : ""}`,
        ``,
        `---`,
        ``,
        formatAsMarkdown(records),
        ``,
        `---`,
        `## Agent Hints`,
        `- Use format='json' or format='csv' for downstream processing.`,
        `- Increase limit (max 100) to retrieve more records.`,
        `- For structured scraping of other platforms, change platform and operation.`,
        `- Discover all 129 supported platforms and their operations: read novada://scraper-platforms resource.`,
        ``,
        `## Chainable Output`,
        `source_url: ${platform}/${operation}`,
        `agent_instruction: Scrape complete. To read a related URL use novada_extract. To crawl multiple pages use novada_crawl. To search for related content use novada_search.`,
        ``,
        `## Agent Memory`,
        `remember: ${platform}/${operation} — ${records.length} records retrieved`,
      ].join("\n");
      break;
  }

  // Wire output save — best-effort, never breaks the tool
  try {
    const domain = platform || "scrape";
    const outputResult = await saveOutput({
      tool: "scrape",
      hint: domain,
      format: format === "json" ? "json" : "csv",
      data: rawRecords.slice(0, limit),
      project: (params as ScrapeParams).project,
    });
    output += `\n\n## Output Saved\n${outputResult.summary}`;
  } catch { /* file save is best-effort */ }

  return output;
  } catch (err: unknown) {
    // H5: use typed NovadaError.code instead of brittle string matching
    if (err instanceof NovadaError && err.code === NovadaErrorCode.PRODUCT_UNAVAILABLE) {
      // Surface any known canonical aliases for the operation the agent tried, so the
      // agent can self-correct a near-miss op ID without a second round-trip. Most 11006
      // errors are malformed/non-canonical op IDs, NOT a deactivated Scraper API.
      // H-7: Re-throw as NovadaError so index.ts sets isError: true
      const aliasHint = hasAlias
        ? `The operation '${params.operation}' was auto-resolved to '${OPERATION_ALIASES[params.operation]}' but still rejected. The canonical ID itself may be wrong for this platform.`
        : `The operation '${operation}' was rejected. Operation IDs are exact and cannot be guessed.`;
      throw new NovadaError({
        code: NovadaErrorCode.PRODUCT_UNAVAILABLE,
        message: `Scraper code 11006 for '${operation}' on '${platform}'. ${aliasHint}`,
        agent_instruction:
          `${aliasHint} Read novada://scraper-platforms to confirm the exact operation ID. ` +
          `Alternatives: novada_extract (general pages), novada_unblock (bot-protected), novada_crawl (multi-page). ` +
          `Only treat as an activation issue if the operation ID is confirmed correct. Do not retry with the same ID.`,
        retryable: false,
        detail: hasAlias ? `alias:${params.operation}→${OPERATION_ALIASES[params.operation]}` : "code 11006",
      });
    }

    // H-7: Re-throw 11008 as NovadaError so index.ts sets isError: true
    if (err instanceof NovadaError && err.code === NovadaErrorCode.INVALID_PARAMS && err.detail === "code 11008") {
      throw err;
    }

    // All other errors (network, timeout, poll failure, missing task_id): re-throw
    // index.ts will handle them via classifyError and return isError: true
    throw err;
  }
}
