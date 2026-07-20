import type { z } from "zod";
import {
  createPlatformScraperTool,
  type PlatformScraperConfig,
  type PlatformOperationConfig,
} from "./platform_scraper.js";

// ─── SHEIN operation → catalog scraper_id map (single source of truth) ──────
// Tools-v2: novada_scrape_shein, built on the config-driven platform-scraper
// factory (src/tools/platform_scraper.ts — see scrape_amazon.ts for the
// proof-of-pattern). Friendly, human-readable operation names for
// novada_scrape_shein, each mapped deterministically to the exact `slug`
// (== scraper_id) in src/data/scraper_catalog.ts's shein.com block.
//
// Only the 2 slugs marked status:"ok" (verified 2026-07-13) are included. The 3
// "backend_broken" slugs — shein_products_keyword, shein_products_category_id,
// shein_products_category_url (all: "submit endpoint hangs 60s+ — connection
// timeout") — are deliberately EXCLUDED from this enum, so they are unreachable
// through novada_scrape_shein at all (Zod rejects an unknown `operation` value
// before any backend round-trip). This mirrors the Amazon scaffold's precedent
// (see scrape_amazon.ts's AMAZON_OPERATIONS comment) — novada_scrape's generic
// `operation` string param still forwards broken ops with a warning (see
// scrape.ts's `brokenWarning`); this closed-enum tool hard-blocks them instead.
export const SHEIN_OPERATIONS = Object.freeze({
  product_by_id: "shein_product_id",
  product_by_url: "shein_product_url",
} as const);

export type SheinOperation = keyof typeof SHEIN_OPERATIONS;

/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const SHEIN_OPERATION_PARAMS_DOC: Record<SheinOperation, string> = {
  product_by_id: "params.ID (e.g. \"Tween-Girls-Casual-Solid-Color-Criss-Cross-Racerback-Sports-Dress-Kids-p-423721658\"); optional params.flow_retry_num, params.country",
  product_by_url: "params.url (product page URL); optional params.flow_retry_num, params.country",
};

const SHEIN_OPERATION_CONFIGS: Record<SheinOperation, PlatformOperationConfig> = Object.fromEntries(
  (Object.keys(SHEIN_OPERATIONS) as SheinOperation[]).map((name) => [
    name,
    { scraperId: SHEIN_OPERATIONS[name], paramsDoc: SHEIN_OPERATION_PARAMS_DOC[name] },
  ]),
) as Record<SheinOperation, PlatformOperationConfig>;

/** SHEIN's declarative platform-scraper config — the factory's sole input for this tool. */
export const SHEIN_SCRAPER_CONFIG: PlatformScraperConfig<SheinOperation> = {
  platform: "shein.com",
  platformLabel: "SHEIN",
  toolName: "novada_scrape_shein",
  category: "Scraping & Verification",
  registryDescription:
    "Extract structured SHEIN product data (by product ID or product URL) via a closed, typed operation enum — 2 verified-working operations (3 known backend_broken SHEIN list/search operations excluded); same engine and output formats as novada_scrape, pinned to platform=shein.com",
  operations: SHEIN_OPERATION_CONFIGS,
  paramsFieldDoc:
    "Operation-specific parameters for the selected `operation`. E.g. { ID: \"Tween-Girls-...-p-423721658\" } for " +
    "product_by_id, { url: \"https://us.shein.com/...html\" } for product_by_url.",
  description: {
    core:
      "Extract structured SHEIN product data — product details by product ID or product URL — through a SHEIN-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"shein.com\".",
    useWhen: [
      "get SHEIN product details for this product ID",
      "get SHEIN product details for this product URL",
    ],
    notFor: [
      { when: "A single SHEIN URL you just want read as plain text", useInstead: "novada_extract" },
      { when: "A general web search not scoped to SHEIN", useInstead: "novada_search" },
      { when: "SHEIN keyword or category product-list search (no working operation exists for these today)", useInstead: "novada_search, or novada_extract on a SHEIN category/search page URL — the 3 catalog operations that would cover this (product list by keyword, by category ID, by category URL) are all backend_broken (submit endpoint hangs 60s+) and deliberately excluded from this tool's enum" },
      { when: "A different platform's structured data (Amazon, Walmart, etc.)", useInstead: "novada_scrape with that platform's domain, or its own novada_scrape_<platform> tool" },
    ],
    returns:
      "Structured product records (title, price, rating, images, etc.) in the chosen format (markdown/json/csv/excel/html/toon) — same rendering as novada_scrape.",
    operationsNote:
      "2 verified-working SHEIN operations: product lookup by product ID or by product URL (see the `operation` param's description for the exact `params` keys each needs). 3 known backend_broken SHEIN operations — product-list by keyword, by category ID, and by category URL, all failing with a 60s+ submit-endpoint hang — are intentionally NOT in this enum; this tool rejects them before any backend call, unlike novada_scrape(platform=\"shein.com\", ...), which still forwards them with a warning.",
  },
};

/** The materialized SHEIN platform-scraper tool (definition + registry entry + handler). */
export const SHEIN_SCRAPER_TOOL = createPlatformScraperTool(SHEIN_SCRAPER_CONFIG);

export const ScrapeSheinParamsSchema = SHEIN_SCRAPER_TOOL.ParamsSchema;

export type ScrapeSheinParams = z.infer<typeof ScrapeSheinParamsSchema>;

export function validateScrapeSheinParams(args: Record<string, unknown> | undefined): ScrapeSheinParams {
  return SHEIN_SCRAPER_TOOL.validateParams(args);
}

/**
 * novada_scrape_shein — a thin, SHEIN-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "shein.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export async function novadaScrapeShein(params: ScrapeSheinParams, apiKey: string): Promise<string> {
  return SHEIN_SCRAPER_TOOL.handler(params, apiKey);
}
