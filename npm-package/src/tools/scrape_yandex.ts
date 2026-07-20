import type { z } from "zod";
import {
  createPlatformScraperTool,
  type PlatformScraperConfig,
  type PlatformOperationConfig,
} from "./platform_scraper.js";

// ─── Yandex operation → catalog scraper_id map (single source of truth) ──────
// Tools-v2: novada_scrape_yandex, built on the config-driven platform-scraper
// factory (src/tools/platform_scraper.ts — see scrape_amazon.ts for the
// proof-of-pattern). Yandex's catalog block has exactly ONE operation, so this
// config is a single-entry map, deterministically pointing at the exact `slug`
// (== scraper_id) in src/data/scraper_catalog.ts's yandex.com block.
//
// The 1 yandex.com catalog operation is status:"ok" as of the 2026-07-13 live
// verification pass. If a future catalog refresh marks it backend_broken,
// tests/tools/platform-scraper-catalog.test.ts will fail CI until it is removed
// from this map (which would leave this tool with zero operations — a signal to
// deprecate it, not silently ship a broken enum).
export const YANDEX_OPERATIONS = Object.freeze({
  web_search: "yandex",
} as const);

export type YandexOperation = keyof typeof YANDEX_OPERATIONS;

/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const YANDEX_OPERATION_PARAMS_DOC: Record<YandexOperation, string> = {
  // yandex_domain is catalog required:true (which of 15 Yandex TLD variants to search,
  // e.g. "yandex.com" vs "yandex.ru"). The shared engine's SEARCH_ENGINE_OP_KEYS map
  // treats the "yandex" slug's query key as OR-alternates on q/keyword/query, but
  // SEARCH_ENGINE_EXTRA_REQUIRED_KEYS (see scrape.ts, B1 fix 2026-07-20) ALSO
  // AND-requires yandex_domain alongside the query — preflight now rejects a call
  // missing yandex_domain locally, before the live 400/empty the backend used to
  // return for it.
  web_search: "params.q (search query) and params.yandex_domain (Yandex TLD, e.g. \"yandex.com\", \"yandex.ru\"); optional params.lang, params.location, params.page, params.within (time range)",
};

const YANDEX_OPERATION_CONFIGS: Record<YandexOperation, PlatformOperationConfig> = Object.fromEntries(
  (Object.keys(YANDEX_OPERATIONS) as YandexOperation[]).map((name) => [
    name,
    { scraperId: YANDEX_OPERATIONS[name], paramsDoc: YANDEX_OPERATION_PARAMS_DOC[name] },
  ]),
) as Record<YandexOperation, PlatformOperationConfig>;

/** Yandex's declarative platform-scraper config — the factory's sole input for this tool. */
export const YANDEX_SCRAPER_CONFIG: PlatformScraperConfig<YandexOperation> = {
  platform: "yandex.com",
  platformLabel: "Yandex",
  toolName: "novada_scrape_yandex",
  category: "Scraping & Verification",
  registryDescription:
    "Extract structured Yandex web search SERP data via a closed, typed operation enum — 1 verified-working operation; same engine and output formats as novada_scrape, pinned to platform=yandex.com",
  operations: YANDEX_OPERATION_CONFIGS,
  paramsFieldDoc:
    "Operation-specific parameters for the selected `operation`. E.g. { q: \"wireless earbuds\", yandex_domain: \"yandex.com\" } for web_search.",
  description: {
    core:
      "Extract structured Yandex web search SERP data through a Yandex-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"yandex.com\". Returns the raw organic-results SERP, with TLD/language/time-range controls novada_search does not expose, not a generated answer.",
    useWhen: [
      "get the raw Yandex search results (titles, links, ranks) for <query>",
      "search a specific Yandex TLD (params.yandex_domain, e.g. \"yandex.ru\") for Russian/Eastern European content",
      "search Yandex restricted to a time range (params.within)",
    ],
    notFor: [
      { when: "A general question that just needs an answer or a few good links", useInstead: "novada_search with engine=\"yandex\" — same engine, but ranked/reranked and answer-oriented instead of a raw SERP dump" },
      { when: "A complex question needing cited multi-source synthesis", useInstead: "novada_research" },
      { when: "Reading one already-known URL's page content (not a search results page)", useInstead: "novada_extract" },
      { when: "A different platform's structured data (Amazon, LinkedIn, TikTok, etc.)", useInstead: "novada_scrape with that platform's domain, or its own novada_scrape_<platform> tool" },
    ],
    returns:
      "Structured organic-result SERP records (title/url/snippet/rank) in the chosen format (markdown/json/csv/excel/html/toon), same rendering as novada_scrape.",
    operationsNote:
      "1 verified-working Yandex operation (web search — see the `operation` param's description for the exact `params` keys it needs, including the required params.yandex_domain TLD selector). The single yandex.com catalog operation is currently status:\"ok\".",
  },
};

/** The materialized Yandex platform-scraper tool (definition + registry entry + handler). */
export const YANDEX_SCRAPER_TOOL = createPlatformScraperTool(YANDEX_SCRAPER_CONFIG);

export const ScrapeYandexParamsSchema = YANDEX_SCRAPER_TOOL.ParamsSchema;

export type ScrapeYandexParams = z.infer<typeof ScrapeYandexParamsSchema>;

export function validateScrapeYandexParams(args: Record<string, unknown> | undefined): ScrapeYandexParams {
  return YANDEX_SCRAPER_TOOL.validateParams(args);
}

/**
 * novada_scrape_yandex — a thin, Yandex-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "yandex.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export async function novadaScrapeYandex(params: ScrapeYandexParams, apiKey: string): Promise<string> {
  return YANDEX_SCRAPER_TOOL.handler(params, apiKey);
}
