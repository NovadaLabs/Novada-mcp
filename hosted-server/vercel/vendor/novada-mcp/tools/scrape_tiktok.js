import { createPlatformScraperTool, } from "./platform_scraper.js";
// ─── TikTok operation → catalog scraper_id map (single source of truth) ─────
// Tools-v2: novada_scrape_tiktok, built on the config-driven platform-scraper
// factory (src/tools/platform_scraper.ts — see scrape_amazon.ts for the
// proof-of-pattern). Friendly, human-readable operation names for
// novada_scrape_tiktok, each mapped deterministically to the exact `slug`
// (== scraper_id) in src/data/scraper_catalog.ts's tiktok.com block.
//
// All 5 tiktok.com catalog operations are status:"ok" as of the 2026-07-13 live
// verification pass — none are excluded here. If a future catalog refresh marks
// any of these backend_broken, tests/tools/platform-scraper-catalog.test.ts will
// fail CI until it is removed from this map.
export const TIKTOK_OPERATIONS = Object.freeze({
    profiles_by_search_url: "tiktok_profiles_listurl",
    profile_by_url: "tiktok_profiles_url",
    posts_by_list_url: "tiktok_posts_listurl",
    posts_by_profile: "tiktok_posts_profileurl",
    post_by_url: "tiktok_posts_url",
});
/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const TIKTOK_OPERATION_PARAMS_DOC = {
    profiles_by_search_url: "params.search_url (a TikTok search/discover URL listing profiles); optional params.country, params.page_turning",
    profile_by_url: "params.url (profile URL, e.g. \"https://www.tiktok.com/@handle\"); optional params.country, params.file_name",
    posts_by_list_url: "params.url (a discover/hashtag page URL); optional params.num_of_posts, params.file_name",
    posts_by_profile: "params.url (profile URL); optional params.start_date, params.end_date, params.num_of_posts, params.what_to_collect, params.post_type, params.country, params.posts_to_not_include, params.file_name",
    post_by_url: "params.url (a single TikTok post/video URL); optional params.country, params.file_name",
};
const TIKTOK_OPERATION_CONFIGS = Object.fromEntries(Object.keys(TIKTOK_OPERATIONS).map((name) => [
    name,
    { scraperId: TIKTOK_OPERATIONS[name], paramsDoc: TIKTOK_OPERATION_PARAMS_DOC[name] },
]));
/** TikTok's declarative platform-scraper config — the factory's sole input for this tool. */
export const TIKTOK_SCRAPER_CONFIG = {
    platform: "tiktok.com",
    platformLabel: "TikTok",
    toolName: "novada_scrape_tiktok",
    category: "Scraping & Verification",
    registryDescription: "Extract structured TikTok data (profiles, posts, hashtag/discover listings) via a closed, typed operation enum — 5 verified-working operations; same engine and output formats as novada_scrape, pinned to platform=tiktok.com",
    operations: TIKTOK_OPERATION_CONFIGS,
    paramsFieldDoc: "Operation-specific parameters for the selected `operation`. E.g. { url: \"https://www.tiktok.com/@handle\" } for " +
        "profile_by_url/posts_by_profile/post_by_url, { search_url: \"https://www.tiktok.com/search?q=...\" } for profiles_by_search_url.",
    description: {
        core: "Extract structured TikTok data — profile info, post/video details, and post lists by profile, hashtag, or search URL — through a TikTok-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"tiktok.com\".",
        useWhen: [
            "get the latest posts from this TikTok profile",
            "get details for this single TikTok video URL",
            "pull TikTok profile info for this URL",
            "search TikTok profiles from this discover/search URL",
            "get posts from this TikTok hashtag/discover page",
        ],
        notFor: [
            { when: "A single TikTok URL you just want read as plain text", useInstead: "novada_extract" },
            { when: "A general web search not scoped to TikTok", useInstead: "novada_search" },
            { when: "A different platform's structured data (YouTube, Instagram, etc.)", useInstead: "novada_scrape with that platform's domain, or its own novada_scrape_<platform> tool" },
        ],
        returns: "Structured profile/post records (username, follower count, video description, likes, view count, etc.) in the chosen format (markdown/json/csv/excel/html/toon) — same rendering as novada_scrape.",
        operationsNote: "5 verified-working TikTok operations: profile search by list URL, profile by URL, posts by list URL, posts by profile URL, and a single post by URL (see the `operation` param's description for the exact `params` keys each needs). Every tiktok.com catalog operation is currently status:\"ok\" — none are excluded for being backend_broken.",
    },
};
/** The materialized TikTok platform-scraper tool (definition + registry entry + handler). */
export const TIKTOK_SCRAPER_TOOL = createPlatformScraperTool(TIKTOK_SCRAPER_CONFIG);
export const ScrapeTiktokParamsSchema = TIKTOK_SCRAPER_TOOL.ParamsSchema;
export function validateScrapeTiktokParams(args) {
    return TIKTOK_SCRAPER_TOOL.validateParams(args);
}
/**
 * novada_scrape_tiktok — a thin, TikTok-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "tiktok.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export async function novadaScrapeTiktok(params, apiKey) {
    return TIKTOK_SCRAPER_TOOL.handler(params, apiKey);
}
//# sourceMappingURL=scrape_tiktok.js.map