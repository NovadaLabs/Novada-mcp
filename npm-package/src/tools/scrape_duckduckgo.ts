import type { z } from "zod";
import {
  createPlatformScraperTool,
  type PlatformScraperConfig,
  type PlatformOperationConfig,
} from "./platform_scraper.js";

// ─── DuckDuckGo operation → catalog scraper_id map (single source of truth) ──
// Tools-v2: novada_scrape_duckduckgo, built on the config-driven platform-scraper
// factory (src/tools/platform_scraper.ts — see scrape_amazon.ts for the
// proof-of-pattern). DuckDuckGo's catalog block has exactly ONE operation, so
// this config is a single-entry map, deterministically pointing at the exact
// `slug` (== scraper_id) in src/data/scraper_catalog.ts's duckduckgo.com block.
//
// The 1 duckduckgo.com catalog operation is status:"ok" as of the 2026-07-13
// live verification pass. If a future catalog refresh marks it backend_broken,
// tests/tools/platform-scraper-catalog.test.ts will fail CI until it is removed
// from this map (which would leave this tool with zero operations — a signal to
// deprecate it, not silently ship a broken enum).
export const DUCKDUCKGO_OPERATIONS = Object.freeze({
  web_search: "duckduckgo",
} as const);

export type DuckduckgoOperation = keyof typeof DUCKDUCKGO_OPERATIONS;

/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const DUCKDUCKGO_OPERATION_PARAMS_DOC: Record<DuckduckgoOperation, string> = {
  web_search: "params.q (search query); optional params.kl (region), params.start (results offset), params.df (time range: d/w/m/y), params.kp (adult content filter)",
};

const DUCKDUCKGO_OPERATION_CONFIGS: Record<DuckduckgoOperation, PlatformOperationConfig> = Object.fromEntries(
  (Object.keys(DUCKDUCKGO_OPERATIONS) as DuckduckgoOperation[]).map((name) => [
    name,
    { scraperId: DUCKDUCKGO_OPERATIONS[name], paramsDoc: DUCKDUCKGO_OPERATION_PARAMS_DOC[name] },
  ]),
) as Record<DuckduckgoOperation, PlatformOperationConfig>;

/** DuckDuckGo's declarative platform-scraper config — the factory's sole input for this tool. */
export const DUCKDUCKGO_SCRAPER_CONFIG: PlatformScraperConfig<DuckduckgoOperation> = {
  platform: "duckduckgo.com",
  platformLabel: "DuckDuckGo",
  toolName: "novada_scrape_duckduckgo",
  category: "Scraping & Verification",
  registryDescription:
    "Extract structured DuckDuckGo web search SERP data via a closed, typed operation enum — 1 verified-working operation; same engine and output formats as novada_scrape, pinned to platform=duckduckgo.com",
  operations: DUCKDUCKGO_OPERATION_CONFIGS,
  paramsFieldDoc:
    "Operation-specific parameters for the selected `operation`. E.g. { q: \"wireless earbuds\", kl: \"us-en\" } for web_search.",
  description: {
    core:
      "Extract structured DuckDuckGo web search SERP data through a DuckDuckGo-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"duckduckgo.com\". Returns the raw organic-results SERP, with region/time/adult-content filters novada_search does not expose, not a generated answer.",
    useWhen: [
      "get the raw DuckDuckGo search results (titles, links, ranks) for <query>",
      "search DuckDuckGo restricted to a specific region (params.kl) or time range (params.df)",
      "compare DuckDuckGo's ranking for <query> against another engine's raw SERP",
    ],
    notFor: [
      { when: "A general question that just needs an answer or a few good links", useInstead: "novada_search with engine=\"duckduckgo\" — same engine, but ranked/reranked and answer-oriented instead of a raw SERP dump" },
      { when: "A complex question needing cited multi-source synthesis", useInstead: "novada_research" },
      { when: "Reading one already-known URL's page content (not a search results page)", useInstead: "novada_extract" },
      { when: "A different platform's structured data (Amazon, LinkedIn, TikTok, etc.)", useInstead: "novada_scrape with that platform's domain, or its own novada_scrape_<platform> tool" },
    ],
    returns:
      "Structured organic-result SERP records (title/url/snippet/rank) in the chosen format (markdown/json/csv/excel/html/toon), same rendering as novada_scrape.",
    operationsNote:
      "1 verified-working DuckDuckGo operation (web search — see the `operation` param's description for the exact `params` keys it needs). The single duckduckgo.com catalog operation is currently status:\"ok\".",
  },
};

/** The materialized DuckDuckGo platform-scraper tool (definition + registry entry + handler). */
export const DUCKDUCKGO_SCRAPER_TOOL = createPlatformScraperTool(DUCKDUCKGO_SCRAPER_CONFIG);

export const ScrapeDuckduckgoParamsSchema = DUCKDUCKGO_SCRAPER_TOOL.ParamsSchema;

export type ScrapeDuckduckgoParams = z.infer<typeof ScrapeDuckduckgoParamsSchema>;

export function validateScrapeDuckduckgoParams(args: Record<string, unknown> | undefined): ScrapeDuckduckgoParams {
  return DUCKDUCKGO_SCRAPER_TOOL.validateParams(args);
}

/**
 * novada_scrape_duckduckgo — a thin, DuckDuckGo-only adapter over the shared scrape
 * engine (novadaScrape in ./scrape.js), generated by the platform-scraper factory.
 * Resolves the friendly `operation` name to its exact catalog scraper_id, pins the
 * platform to "duckduckgo.com", and delegates everything else — the HTTP call,
 * polling, output rendering, and error classification — to novadaScrape. No
 * HTTP/FormData logic is duplicated here.
 */
export async function novadaScrapeDuckduckgo(params: ScrapeDuckduckgoParams, apiKey: string): Promise<string> {
  return DUCKDUCKGO_SCRAPER_TOOL.handler(params, apiKey);
}
