import { createPlatformScraperTool, } from "./platform_scraper.js";
// ─── Walmart operation → catalog scraper_id map (single source of truth) ────
// Tools-v2: novada_scrape_walmart, built on the config-driven platform-scraper
// factory (src/tools/platform_scraper.ts — see scrape_amazon.ts for the
// proof-of-pattern). Friendly, human-readable operation names for
// novada_scrape_walmart, each mapped deterministically to the exact `slug`
// (== scraper_id) in src/data/scraper_catalog.ts's walmart.com block.
//
// All 5 walmart.com catalog operations are status:"ok" as of the 2026-07-13 live
// verification pass — none are excluded here. If a future catalog refresh marks
// any of these backend_broken, tests/tools/platform-scraper-catalog.test.ts will
// fail CI until it is removed from this map.
//
// AND-required note: 3 of the 5 ops carry MORE THAN ONE catalog required:true key
// (product_by_keyword: domain+keyword; product_by_category_url: category_url+all+
// page_limit; product_by_url_and_zipcode: url+zipcode) — all three are added to
// scrape.ts's AND_REQUIRED_OPS allowlist (same precedent as the Amazon/Instagram
// AND-required ops: a catalog `dflt` on a required key does not exempt it from
// being genuinely mandatory).
export const WALMART_OPERATIONS = Object.freeze({
    product_by_keyword: "walmart_product_keywords",
    product_by_category_url: "walmart_product_category-url",
    product_by_url_and_zipcode: "walmart_product_zipcodes",
    product_by_sku: "walmart_product_sku",
    product_by_url: "walmart_product_url",
});
/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const WALMART_OPERATION_PARAMS_DOC = {
    product_by_keyword: "params.domain (e.g. \"https://www.walmart.com/\") AND params.keyword (BOTH required together); optional params.all, params.page_turning, params.file_name",
    product_by_category_url: "params.category_url AND params.all AND params.page_limit (ALL THREE required together); optional params.file_name",
    product_by_url_and_zipcode: "params.url AND params.zipcode (BOTH required together, e.g. zipcode \"95829\"); optional params.file_name",
    product_by_sku: "params.sku (e.g. \"433078517\"); optional params.all, params.file_name",
    product_by_url: "params.url (product page URL); optional params.all, params.file_name",
};
const WALMART_OPERATION_CONFIGS = Object.fromEntries(Object.keys(WALMART_OPERATIONS).map((name) => [
    name,
    { scraperId: WALMART_OPERATIONS[name], paramsDoc: WALMART_OPERATION_PARAMS_DOC[name] },
]));
/** Walmart's declarative platform-scraper config — the factory's sole input for this tool. */
export const WALMART_SCRAPER_CONFIG = {
    platform: "walmart.com",
    platformLabel: "Walmart",
    toolName: "novada_scrape_walmart",
    category: "Scraping & Verification",
    registryDescription: "Extract structured Walmart data (product details by keyword/category URL/SKU/zip code/URL) via a closed, typed operation enum — 5 verified-working operations; same engine and output formats as novada_scrape, pinned to platform=walmart.com",
    operations: WALMART_OPERATION_CONFIGS,
    paramsFieldDoc: "Operation-specific parameters for the selected `operation`. E.g. { domain: \"https://www.walmart.com/\", keyword: \"shoes\" } for " +
        "product_by_keyword, { sku: \"433078517\" } for product_by_sku, { url: \"https://www.walmart.com/ip/...\" } for " +
        "product_by_url/product_by_url_and_zipcode.",
    description: {
        core: "Extract structured Walmart data — product details by keyword search, category URL, SKU, zip-code-specific pricing, or direct product URL — through a Walmart-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"walmart.com\".",
        useWhen: [
            "search Walmart for <keyword> and give me prices/ratings",
            "get product listings from this Walmart category URL",
            "what's the price/availability for this Walmart SKU",
            "get this Walmart product's info for a specific zip code",
            "get product details for this Walmart product URL",
        ],
        notFor: [
            { when: "A single Walmart URL you just want read as plain text", useInstead: "novada_extract" },
            { when: "A general web search not scoped to Walmart", useInstead: "novada_search" },
            { when: "A different platform's structured data (Amazon, SHEIN, etc.)", useInstead: "novada_scrape with that platform's domain, or its own novada_scrape_<platform> tool" },
        ],
        returns: "Structured product records (title, price, rating, availability, SKU, etc.) in the chosen format (markdown/json/csv/excel/html/toon) — same rendering as novada_scrape.",
        operationsNote: "5 verified-working Walmart operations spanning keyword search, category-URL listings, SKU lookup, zip-code-specific pricing, and direct product URL (see the `operation` param's description for the exact `params` keys each needs). `product_by_keyword` requires BOTH `domain` AND `keyword` together; `product_by_category_url` requires ALL THREE of `category_url`, `all`, AND `page_limit` together; `product_by_url_and_zipcode` requires BOTH `url` AND `zipcode` together. Every walmart.com catalog operation is currently status:\"ok\" — none are excluded for being backend_broken.",
    },
};
/** The materialized Walmart platform-scraper tool (definition + registry entry + handler). */
export const WALMART_SCRAPER_TOOL = createPlatformScraperTool(WALMART_SCRAPER_CONFIG);
export const ScrapeWalmartParamsSchema = WALMART_SCRAPER_TOOL.ParamsSchema;
export function validateScrapeWalmartParams(args) {
    return WALMART_SCRAPER_TOOL.validateParams(args);
}
/**
 * novada_scrape_walmart — a thin, Walmart-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "walmart.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export async function novadaScrapeWalmart(params, apiKey) {
    return WALMART_SCRAPER_TOOL.handler(params, apiKey);
}
//# sourceMappingURL=scrape_walmart.js.map