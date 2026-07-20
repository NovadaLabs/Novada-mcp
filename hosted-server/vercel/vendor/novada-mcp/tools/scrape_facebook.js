import { createPlatformScraperTool, } from "./platform_scraper.js";
// ─── Facebook operation → catalog scraper_id map (single source of truth) ───
// Tools-v2: novada_scrape_facebook, built on the config-driven platform-scraper
// factory (src/tools/platform_scraper.ts — see scrape_amazon.ts for the
// proof-of-pattern). Friendly, human-readable operation names for
// novada_scrape_facebook, each mapped deterministically to the exact `slug`
// (== scraper_id) in src/data/scraper_catalog.ts's facebook.com block.
//
// All 6 facebook.com catalog operations are status:"ok" as of the 2026-07-13 live
// verification pass — none are excluded here. If a future catalog refresh marks
// any of these backend_broken, tests/tools/platform-scraper-catalog.test.ts will
// fail CI until it is removed from this map.
export const FACEBOOK_OPERATIONS = Object.freeze({
    profile_by_url: "facebook_profile_profiles-url",
    events_by_search_url: "facebook_event_search-url",
    event_by_url: "facebook_event_events-url",
    events_by_list_url: "facebook_event_eventlist-url",
    post_by_url: "facebook_post_posts-url",
    comments_by_post_url: "facebook_comment_comments-url",
});
/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const FACEBOOK_OPERATION_PARAMS_DOC = {
    profile_by_url: "params.url (personal/page homepage URL); optional params.file_name",
    events_by_search_url: "params.url (an activity/events search URL); optional params.file_name",
    event_by_url: "params.url (a single event URL); optional params.file_name",
    events_by_list_url: "params.url (a page's /events list URL); optional params.upcoming_events, params.file_name",
    post_by_url: "params.url (post URL); optional params.file_name",
    comments_by_post_url: "params.url (post URL); optional params.get_all_replies, params.limit_records, params.file_name",
};
const FACEBOOK_OPERATION_CONFIGS = Object.fromEntries(Object.keys(FACEBOOK_OPERATIONS).map((name) => [
    name,
    { scraperId: FACEBOOK_OPERATIONS[name], paramsDoc: FACEBOOK_OPERATION_PARAMS_DOC[name] },
]));
/** Facebook's declarative platform-scraper config — the factory's sole input for this tool. */
export const FACEBOOK_SCRAPER_CONFIG = {
    platform: "facebook.com",
    platformLabel: "Facebook",
    toolName: "novada_scrape_facebook",
    category: "Scraping & Verification",
    registryDescription: "Extract structured Facebook data (profiles, posts, comments, events) via a closed, typed operation enum — 6 verified-working operations; same engine and output formats as novada_scrape, pinned to platform=facebook.com",
    operations: FACEBOOK_OPERATION_CONFIGS,
    paramsFieldDoc: "Operation-specific parameters for the selected `operation`. E.g. { url: \"https://www.facebook.com/handle\" } for " +
        "profile_by_url/post_by_url/comments_by_post_url/event_by_url/events_by_list_url/events_by_search_url.",
    description: {
        core: "Extract structured Facebook data — public profile pages, posts, comments, and events — through a Facebook-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"facebook.com\".",
        useWhen: [
            "get this public Facebook page's profile info",
            "pull the comments on this Facebook post",
            "get details for this Facebook event",
            "find events matching <query> on Facebook",
            "list the upcoming events on this Facebook page",
        ],
        notFor: [
            { when: "A single Facebook URL you just want read as plain text", useInstead: "novada_extract" },
            { when: "A general web search not scoped to Facebook", useInstead: "novada_search" },
            { when: "A different platform's structured data (Instagram, X, etc.)", useInstead: "novada_scrape with that platform's domain, or its own novada_scrape_<platform> tool" },
        ],
        returns: "Structured profile/post/comment/event records (page name, post text, comment author/text, event name/date/location, etc.) in the chosen format (markdown/json/csv/excel/html/toon) — same rendering as novada_scrape.",
        operationsNote: "6 verified-working Facebook operations spanning public profile pages, posts, comments, and events (search / single event / event list) (see the `operation` param's description for the exact `params` keys each needs). Every facebook.com catalog operation is currently status:\"ok\" — none are excluded for being backend_broken.",
    },
};
/** The materialized Facebook platform-scraper tool (definition + registry entry + handler). */
export const FACEBOOK_SCRAPER_TOOL = createPlatformScraperTool(FACEBOOK_SCRAPER_CONFIG);
export const ScrapeFacebookParamsSchema = FACEBOOK_SCRAPER_TOOL.ParamsSchema;
export function validateScrapeFacebookParams(args) {
    return FACEBOOK_SCRAPER_TOOL.validateParams(args);
}
/**
 * novada_scrape_facebook — a thin, Facebook-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "facebook.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export async function novadaScrapeFacebook(params, apiKey) {
    return FACEBOOK_SCRAPER_TOOL.handler(params, apiKey);
}
//# sourceMappingURL=scrape_facebook.js.map