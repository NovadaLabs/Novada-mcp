import { createPlatformScraperTool, } from "./platform_scraper.js";
// ─── Google operation → catalog scraper_id map (single source of truth) ──────
// Tools-v2: novada_scrape_google is the first SEARCH-ENGINE platform-scraper tool
// (built on the config-driven factory in src/tools/platform_scraper.ts — see
// scrape_amazon.ts for the proof-of-pattern). Friendly, human-readable operation
// names for novada_scrape_google, each mapped deterministically to the exact
// `slug` (== scraper_id) in src/data/scraper_catalog.ts's google.com block.
//
// All 13 google.com catalog operations are status:"ok" as of the 2026-07-13 live
// verification pass — none are excluded here for being backend_broken (unlike
// Amazon, which has 3 excluded slugs). If a future catalog refresh marks any of
// these backend_broken, tests/tools/platform-scraper-catalog.test.ts will fail
// CI until it is removed from this map.
export const GOOGLE_OPERATIONS = Object.freeze({
    web_search: "google_search",
    web_search_by_domain: "google_serp_web",
    search_by_url: "google_search_url",
    ai_mode: "google_ai_mode",
    hotels: "google_serp_hotels",
    jobs: "google_serp_jobs",
    videos: "google_serp_videos",
    shopping: "google_shopping_keywords",
    maps_by_location: "google_map-details_location",
    maps_by_place_id: "google_map-details_placeid",
    maps_by_cid: "google_map-details_cid",
    maps_by_url: "google_map-details_url",
    maps_reviews_by_url: "google_comment_url",
});
/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const GOOGLE_OPERATION_PARAMS_DOC = {
    web_search: "params.q (search query); optional params.domain, params.country, params.hl (language), params.location, params.start/params.num (pagination), params.ai_overview, params.safe, params.tbs (advanced filters)",
    web_search_by_domain: "params.q (search query) and params.domain (Google TLD domain, e.g. \"google.com\"); optional params.country, params.hl, params.location, params.start, params.num",
    search_by_url: "params.url (a full Google search results URL, e.g. \"https://www.google.com/search?q=...\"); optional params.device, params.render_js, params.no_cache",
    ai_mode: "params.q (search query); optional params.gl (country), params.location, params.uule (encoded location)",
    hotels: "params.q, params.domain, params.check_in_date, params.check_out_date (YYYY-MM-DD); optional params.country, params.hl, params.adults",
    jobs: "params.q (search query); optional params.domain, params.country, params.hl, params.location, params.start, params.num",
    videos: "params.q (search query); optional params.domain, params.country, params.hl, params.start, params.num",
    shopping: "params.keyword (e.g. \"pizza\"); optional params.country",
    maps_by_location: "params.country, params.keyword, params.merchant_limit (max merchants to return); optional params.lat, params.long, params.zl (zoom level)",
    maps_by_place_id: "params.place_id (Google Place ID)",
    maps_by_cid: "params.cid (Google Maps CID)",
    maps_by_url: "params.url (a Google Maps place URL)",
    maps_reviews_by_url: "params.url (Google Maps place URL); optional params.limit (days of reviews to fetch, default 30)",
};
const GOOGLE_OPERATION_CONFIGS = Object.fromEntries(Object.keys(GOOGLE_OPERATIONS).map((name) => [
    name,
    { scraperId: GOOGLE_OPERATIONS[name], paramsDoc: GOOGLE_OPERATION_PARAMS_DOC[name] },
]));
/** Google's declarative platform-scraper config — the factory's sole input for this tool. */
export const GOOGLE_SCRAPER_CONFIG = {
    platform: "google.com",
    platformLabel: "Google",
    toolName: "novada_scrape_google",
    category: "Scraping & Verification",
    registryDescription: "Extract structured Google SERP data (web search, AI Mode, Maps details/reviews, Shopping, Jobs, Hotels, Videos) via a closed, typed operation enum — 13 verified-working operations; same engine and output formats as novada_scrape, pinned to platform=google.com",
    operations: GOOGLE_OPERATION_CONFIGS,
    paramsFieldDoc: "Operation-specific parameters for the selected `operation`. E.g. { q: \"wireless earbuds\" } for " +
        "web_search/ai_mode, { keyword: \"pizza\" } for shopping, { url: \"https://www.google.com/maps/place/...\" } " +
        "for maps_by_url/maps_reviews_by_url, { place_id: \"ChIJ...\" } for maps_by_place_id.",
    description: {
        core: "Extract structured Google SERP data — organic web search results, AI Mode answers, Maps place/review details, Shopping listings, Jobs, Hotels, and Videos — through a Google-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"google.com\". Returns raw structured SERP records, not a generated answer.",
        useWhen: [
            "get the raw Google search results (titles, links, ranks) for <query>",
            "what's in Google's AI Mode answer for <query>",
            "pull Google Maps reviews or place details for this URL / place_id / CID",
            "search Google Shopping for <keyword>",
            "find Google Jobs, Hotels, or Videos results for <query>",
        ],
        notFor: [
            { when: "A general question that just needs an answer or a few good links", useInstead: "novada_search — multi-engine (google/duckduckgo/yandex), ranked and reranked, answer-oriented, and far cheaper than a raw-SERP scrape" },
            { when: "A complex question needing cited multi-source synthesis", useInstead: "novada_research" },
            { when: "Reading one already-known URL's page content (not a search results page)", useInstead: "novada_extract" },
            { when: "A different platform's structured data (Amazon, LinkedIn, TikTok, etc.)", useInstead: "novada_scrape with that platform's domain, or its own novada_scrape_<platform> tool" },
        ],
        returns: "Structured SERP records per operation — organic results (title/url/snippet/rank), AI Mode answer content, Maps place details/reviews, Shopping listings (price/rating), and Jobs/Hotels/Videos listings — in the chosen format (markdown/json/csv/excel/html/toon), same rendering as novada_scrape.",
        operationsNote: "13 verified-working Google operations spanning web search, AI Mode, Maps (location/place_id/CID/URL lookups + reviews), Shopping, Jobs, Hotels, and Videos (see the `operation` param's description for the exact `params` keys each needs). Every google.com catalog operation is currently status:\"ok\" — none are excluded for being backend_broken.",
    },
};
/** The materialized Google platform-scraper tool (definition + registry entry + handler). */
export const GOOGLE_SCRAPER_TOOL = createPlatformScraperTool(GOOGLE_SCRAPER_CONFIG);
export const ScrapeGoogleParamsSchema = GOOGLE_SCRAPER_TOOL.ParamsSchema;
export function validateScrapeGoogleParams(args) {
    return GOOGLE_SCRAPER_TOOL.validateParams(args);
}
/**
 * novada_scrape_google — a thin, Google-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "google.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export async function novadaScrapeGoogle(params, apiKey) {
    return GOOGLE_SCRAPER_TOOL.handler(params, apiKey);
}
//# sourceMappingURL=scrape_google.js.map