import { createPlatformScraperTool, } from "./platform_scraper.js";
// ─── Amazon operation → catalog scraper_id map (single source of truth) ──────
// Tools-v2: Amazon is the FIRST config expressed through the platform-scraper
// factory (src/tools/platform_scraper.ts) — the proof-of-pattern for the
// 16-tool per-platform family (see ARCHITECTURE.md). Friendly, human-readable
// operation names for novada_scrape_amazon, each mapped deterministically to
// the exact `slug` (== scraper_id) in src/data/scraper_catalog.ts's amazon.com
// block.
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
});
/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const AMAZON_OPERATION_PARAMS_DOC = {
    product_by_asin: "params.asin (e.g. \"B0BWBK8F37\")",
    product_by_url: "params.url (product page URL); optional params.zip_code",
    products_by_keywords: "params.keyword; optional params.max_pages, params.min_price, params.max_price",
    bestsellers: "params.url (a Best Sellers list page URL); optional params.max_pages",
    reviews_by_url: "params.url (product page URL)",
    seller_by_url: "params.url (seller page URL)",
    listings_by_keyword: "params.keyword and params.domain (e.g. \"https://www.amazon.com\"); optional params.max_pages",
    global_product_by_url: "params.url",
    global_product_by_category_url: "params.url (category/search URL) and params.maximum; optional params.sort_by, params.get_sponsored",
    global_product_by_keyword_and_brand: "params.keyword, params.brands, params.max_pages",
};
const AMAZON_OPERATION_CONFIGS = Object.fromEntries(Object.keys(AMAZON_OPERATIONS).map((name) => [
    name,
    { scraperId: AMAZON_OPERATIONS[name], paramsDoc: AMAZON_OPERATION_PARAMS_DOC[name] },
]));
/** Amazon's declarative platform-scraper config — the factory's sole input for this tool. */
export const AMAZON_SCRAPER_CONFIG = {
    platform: "amazon.com",
    platformLabel: "Amazon",
    toolName: "novada_scrape_amazon",
    category: "Scraping & Verification",
    registryDescription: "Extract structured Amazon data (product details, reviews, seller info, bestsellers, category/brand listings) via a closed, typed operation enum — 10 verified-working operations; same engine and output formats as novada_scrape, pinned to platform=amazon.com",
    operations: AMAZON_OPERATION_CONFIGS,
    paramsFieldDoc: "Operation-specific parameters for the selected `operation`. E.g. { asin: \"B0BWBK8F37\" } for " +
        "product_by_asin, { url: \"https://www.amazon.com/dp/...\" } for product_by_url/reviews_by_url/" +
        "seller_by_url/bestsellers/global_product_by_url, { keyword: \"wireless earbuds\" } for products_by_keywords.",
    description: {
        core: "Extract structured Amazon data — product details, reviews, seller info, bestseller lists, and category/brand listings — through an Amazon-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"amazon.com\".",
        useWhen: [
            "get the price/rating/title for Amazon ASIN B0...",
            "pull the reviews for this Amazon product URL",
            "search Amazon for <keyword> with price and rating",
            "who is this Amazon seller",
            "what's in this Amazon Best Sellers list",
        ],
        notFor: [
            { when: "Any other platform", useInstead: "novada_scrape with the target platform's domain instead (e.g. platform=\"walmart.com\")" },
            { when: "A general Google/web search", useInstead: "novada_search" },
            { when: "Reading one arbitrary URL's raw content", useInstead: "novada_extract" },
        ],
        returns: "Structured product/review/seller records (title, price, rating, asin, availability, etc.) in the chosen format — same rendering as novada_scrape (markdown/json/csv/excel/html/toon).",
        operationsNote: "10 verified-working Amazon operations (see the `operation` param's description for the exact `params` keys each needs). 3 known backend-broken Amazon operations are intentionally NOT in this enum — this tool rejects them before any backend call, unlike novada_scrape(platform=\"amazon.com\", ...), which still forwards them with a warning.",
    },
};
/** The materialized Amazon platform-scraper tool (definition + registry entry + handler). */
export const AMAZON_SCRAPER_TOOL = createPlatformScraperTool(AMAZON_SCRAPER_CONFIG);
// ─── Public entry points (unchanged names/shapes — behavior-preserving) ──────
// novadaScrapeAmazon / validateScrapeAmazonParams / ScrapeAmazonParamsSchema keep
// their original names and import path (src/tools/scrape_amazon.js) so existing
// callers (tools/index.ts barrel, tests/tools/scrape_amazon.test.ts) are unaffected.
export const ScrapeAmazonParamsSchema = AMAZON_SCRAPER_TOOL.ParamsSchema;
export function validateScrapeAmazonParams(args) {
    return AMAZON_SCRAPER_TOOL.validateParams(args);
}
/**
 * novada_scrape_amazon — a thin, Amazon-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "amazon.com", and delegates everything else — the HTTP call, polling, output
 * rendering, price/availability normalization, and error classification — to
 * novadaScrape. No HTTP/FormData logic is duplicated here.
 */
export async function novadaScrapeAmazon(params, apiKey) {
    return AMAZON_SCRAPER_TOOL.handler(params, apiKey);
}
//# sourceMappingURL=scrape_amazon.js.map