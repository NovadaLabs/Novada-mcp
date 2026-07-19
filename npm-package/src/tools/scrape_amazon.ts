import { z } from "zod";
import { novadaScrape } from "./scrape.js";
import { TASK_ID_REGEX, TASK_ID_REGEX_MSG } from "./types.js";

// ─── Amazon operation → catalog scraper_id map (single source of truth) ──────
// Tools-v2 Option B scaffold (proof-of-pattern for the 16-tool per-platform family —
// see ARCHITECTURE.md). Friendly, human-readable operation names for
// novada_scrape_amazon, each mapped deterministically to the exact `slug`
// (== scraper_id) in src/data/scraper_catalog.ts's amazon.com block.
//
// Only the 10 slugs marked status:"ok" (verified 2026-07-13) are included. The 3
// "backend_broken" slugs — amazon_product_category-url, amazon_global-product_seller-url,
// amazon_global-product_keywords — are deliberately EXCLUDED from this enum, so they
// are unreachable through novada_scrape_amazon at all (Zod rejects an unknown
// `operation` value before any backend round-trip). This differs from novada_scrape's
// generic `operation` string param, which still forwards broken ops with a warning
// (see scrape.ts's `brokenWarning`) — that tool covers all 16 platforms and can't
// hard-block per-platform breakage without a matching enum per platform.
export const AMAZON_OPERATIONS = Object.freeze({
  product_by_asin: "amazon_product_asin",
  product_by_url: "amazon_product_url",
  products_by_keywords: "amazon_product_keywords",
  bestsellers: "amazon_product_best-sellers",
  reviews_by_url: "amazon_comment_url",
  seller_by_url: "amazon_seller_url",
  listings_by_keyword: "amazon_product-list_keywords-domain",
  global_product_by_url: "amazon_global-product_url",
  global_product_by_category_url: "amazon_global-product_category-url",
  global_product_by_keyword_and_brand: "amazon_global-product_keywords-brand",
} as const);

export type AmazonOperation = keyof typeof AMAZON_OPERATIONS;

const AMAZON_OPERATION_NAMES = Object.keys(AMAZON_OPERATIONS) as [AmazonOperation, ...AmazonOperation[]];

export const ScrapeAmazonParamsSchema = z.object({
  operation: z.enum(AMAZON_OPERATION_NAMES)
    .describe(
      "Which Amazon operation to run. Each requires specific keys in `params`:\n" +
      "- product_by_asin: params.asin (e.g. \"B0BWBK8F37\")\n" +
      "- product_by_url: params.url (product page URL); optional params.zip_code\n" +
      "- products_by_keywords: params.keyword; optional params.max_pages, params.min_price, params.max_price\n" +
      "- bestsellers: params.url (a Best Sellers list page URL); optional params.max_pages\n" +
      "- reviews_by_url: params.url (product page URL)\n" +
      "- seller_by_url: params.url (seller page URL)\n" +
      "- listings_by_keyword: params.keyword and params.domain (e.g. \"https://www.amazon.com\"); optional params.max_pages\n" +
      "- global_product_by_url: params.url\n" +
      "- global_product_by_category_url: params.url (category/search URL) and params.maximum; optional params.sort_by, params.get_sponsored\n" +
      "- global_product_by_keyword_and_brand: params.keyword, params.brands, params.max_pages"
    ),
  params: z.record(z.string(), z.unknown()).default({})
    .describe(
      "Operation-specific parameters for the selected `operation`. E.g. { asin: \"B0BWBK8F37\" } for " +
      "product_by_asin, { url: \"https://www.amazon.com/dp/...\" } for product_by_url/reviews_by_url/" +
      "seller_by_url/bestsellers/global_product_by_url, { keyword: \"wireless earbuds\" } for products_by_keywords."
    ),
  limit: z.number().int().min(1).max(100).default(20)
    .describe("Max records to return. Default 20, max 100."),
  format: z.enum(["json", "csv", "excel", "html", "markdown", "toon"]).default("markdown")
    .describe("Output format. 'markdown' (default): structured table. 'json': structured records array. 'csv'/'excel'/'html': spreadsheet-ready. 'toon': token-optimized pipe-separated format."),
  task_id: z.string().regex(TASK_ID_REGEX, TASK_ID_REGEX_MSG).optional()
    .describe("Optional. Resume a previous slow task by its task_id instead of submitting a new billable one — same semantics as novada_scrape's task_id."),
  project: z.string().max(30).optional()
    .describe("Optional project name to group related outputs in a subfolder. E.g. 'competitor-pricing'."),
});

export type ScrapeAmazonParams = z.infer<typeof ScrapeAmazonParamsSchema>;

export function validateScrapeAmazonParams(args: Record<string, unknown> | undefined): ScrapeAmazonParams {
  return ScrapeAmazonParamsSchema.parse(args ?? {});
}

/**
 * novada_scrape_amazon — a thin, Amazon-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js). Resolves the friendly `operation` name to its exact
 * catalog scraper_id, pins the platform to "amazon.com", and delegates everything else
 * — the HTTP call, polling, output rendering, price/availability normalization, and
 * error classification — to novadaScrape. No HTTP/FormData logic is duplicated here.
 */
export async function novadaScrapeAmazon(params: ScrapeAmazonParams, apiKey: string): Promise<string> {
  const scraperId = AMAZON_OPERATIONS[params.operation];
  return novadaScrape(
    {
      platform: "amazon.com",
      operation: scraperId,
      params: params.params,
      limit: params.limit,
      format: params.format,
      task_id: params.task_id,
      project: params.project,
      // FIX 3: surface the friendly operation name (e.g. "product_by_asin") in the
      // "## Scrape Results" header instead of the raw catalog slug — the caller
      // never typed "amazon_product_asin", they typed "product_by_asin".
      displayName: params.operation,
    },
    apiKey,
  );
}
