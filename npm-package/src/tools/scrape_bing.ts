import type { z } from "zod";
import {
  createPlatformScraperTool,
  type PlatformScraperConfig,
  type PlatformOperationConfig,
} from "./platform_scraper.js";

// ─── Bing operation → catalog scraper_id map (single source of truth) ────────
// Tools-v2: novada_scrape_bing, built on the config-driven platform-scraper
// factory (src/tools/platform_scraper.ts — see scrape_amazon.ts for the
// proof-of-pattern). Friendly, human-readable operation names for
// novada_scrape_bing, each mapped deterministically to the exact `slug`
// (== scraper_id) in src/data/scraper_catalog.ts's bing.com block.
//
// All 4 bing.com catalog operations are status:"ok" as of the 2026-07-13 live
// verification pass — none are excluded here. If a future catalog refresh marks
// any of these backend_broken, tests/tools/platform-scraper-catalog.test.ts will
// fail CI until it is removed from this map.
//
// NOTE: bing.com is NOT one of novada_search's selectable `engine` values (only
// google/duckduckgo/yandex are — see src/tools/types.ts's `engine` enum). Bing is
// used internally by novada_search only as an unexposed fallback. This tool is
// therefore the ONLY way to intentionally target Bing (besides the generic
// novada_scrape(platform="bing.com", ...)).
export const BING_OPERATIONS = Object.freeze({
  web_search: "bing_search",
  videos: "bing_videos",
  news: "bing_news",
  shopping: "bing_shopping",
} as const);

export type BingOperation = keyof typeof BING_OPERATIONS;

/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const BING_OPERATION_PARAMS_DOC: Record<BingOperation, string> = {
  web_search: "params.q (search query); optional params.device, params.country, params.lg (language), params.location, params.start, params.num, params.safe, params.filters",
  videos: "params.q (search query); optional params.device, params.country, params.lg, params.length (short/medium/long), params.date, params.resolution, params.source_site, params.price",
  // NOTE: the live scraper_catalog.ts entry for bing_news does not itemize a `q` param
  // (only json/country/language/lg/start/num/qft are listed) — appears to be a catalog
  // data gap, since the shared engine's SEARCH_ENGINE_OP_KEYS map still requires one of
  // q/keyword/query for this op (see scrape.ts). Documented here as required to match
  // actual enforced behavior, not the (incomplete) catalog params list.
  news: "params.q (search query — required by the engine's preflight even though the catalog's own params list omits it); optional params.country, params.language, params.start, params.num, params.qft (sort order, e.g. \"sortbydate\")",
  shopping: "params.q (search query); optional params.country, params.lg, params.start, params.filters",
};

const BING_OPERATION_CONFIGS: Record<BingOperation, PlatformOperationConfig> = Object.fromEntries(
  (Object.keys(BING_OPERATIONS) as BingOperation[]).map((name) => [
    name,
    { scraperId: BING_OPERATIONS[name], paramsDoc: BING_OPERATION_PARAMS_DOC[name] },
  ]),
) as Record<BingOperation, PlatformOperationConfig>;

/** Bing's declarative platform-scraper config — the factory's sole input for this tool. */
export const BING_SCRAPER_CONFIG: PlatformScraperConfig<BingOperation> = {
  platform: "bing.com",
  platformLabel: "Bing",
  toolName: "novada_scrape_bing",
  category: "Scraping & Verification",
  registryDescription:
    "Extract structured Bing SERP data (web search, videos, news, shopping) via a closed, typed operation enum — 4 verified-working operations; same engine and output formats as novada_scrape, pinned to platform=bing.com",
  operations: BING_OPERATION_CONFIGS,
  paramsFieldDoc:
    "Operation-specific parameters for the selected `operation`. E.g. { q: \"wireless earbuds\" } for " +
    "web_search/videos/news/shopping; all four operations share the same q-driven query shape.",
  description: {
    core:
      "Extract structured Bing SERP data — organic web search, video results, news results, shopping listings — via a closed, typed `operation` enum (same engine as novada_scrape, pinned to platform=\"bing.com\"). Bing is NOT a selectable engine on novada_search — this is the only intentional way to query Bing specifically.",
    useWhen: [
      "get the raw Bing search results (titles, links, ranks) for <query>",
      "find Bing video results for <query>",
      "find Bing news results for <query>, sorted by date",
      "search Bing Shopping for <keyword>",
    ],
    notFor: [
      { when: "A general question needing just an answer or a few good links", useInstead: "novada_search — google/duckduckgo/yandex only (Bing is not selectable there); ranked, cheaper than a raw-SERP scrape" },
      { when: "A complex question needing cited multi-source synthesis", useInstead: "novada_research" },
      { when: "Reading one already-known URL's page content", useInstead: "novada_extract" },
      { when: "A different platform's data", useInstead: "its own novada_scrape_<platform> tool, or novada_scrape(platform=\"<domain>\")" },
    ],
    returns:
      "Structured SERP records per operation — organic results (title/url/snippet/rank), video results, news results (with date), shopping listings (price/rating) — in the chosen output format, same rendering as novada_scrape.",
    operationsNote:
      "4 verified-working Bing operations: web search, videos, news, and shopping. Every bing.com catalog operation is currently status:\"ok\" — none are excluded for being backend_broken.",
  },
};

/** The materialized Bing platform-scraper tool (definition + registry entry + handler). */
export const BING_SCRAPER_TOOL = createPlatformScraperTool(BING_SCRAPER_CONFIG);

export const ScrapeBingParamsSchema = BING_SCRAPER_TOOL.ParamsSchema;

export type ScrapeBingParams = z.infer<typeof ScrapeBingParamsSchema>;

export function validateScrapeBingParams(args: Record<string, unknown> | undefined): ScrapeBingParams {
  return BING_SCRAPER_TOOL.validateParams(args);
}

/**
 * novada_scrape_bing — a thin, Bing-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "bing.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export async function novadaScrapeBing(params: ScrapeBingParams, apiKey: string): Promise<string> {
  return BING_SCRAPER_TOOL.handler(params, apiKey);
}
