import { createPlatformScraperTool, } from "./platform_scraper.js";
// ─── LinkedIn operation → catalog scraper_id map (single source of truth) ───
// Tools-v2: novada_scrape_linkedin, built on the config-driven platform-scraper
// factory (src/tools/platform_scraper.ts — see scrape_amazon.ts for the
// proof-of-pattern). Friendly, human-readable operation names for
// novada_scrape_linkedin, each mapped deterministically to the exact `slug`
// (== scraper_id) in src/data/scraper_catalog.ts's linkedin.com block.
//
// All 4 linkedin.com catalog operations are status:"ok" as of the 2026-07-13 live
// verification pass — none are excluded here. If a future catalog refresh marks
// any of these backend_broken, tests/tools/platform-scraper-catalog.test.ts will
// fail CI until it is removed from this map.
//
// jobs_search note: the catalog's linkedin_job_listings_information_keyword op
// (api_name "LinkedIn Job Listings Scraper By Keywords") counter-intuitively marks
// `location` required:true and `keyword` required:false — despite the op's own
// name. This is taken verbatim from the catalog (single source of truth), not a
// typo here; the paramsDoc below documents the real requirement so callers aren't
// misled by the op's display name. Only 1 required key, so no AND_REQUIRED_OPS
// entry is needed for this op (or any other LinkedIn op — each has exactly one
// catalog required:true key).
//
// No LinkedIn personal-PROFILE operation exists in the catalog today — only
// company info and job listings. See this config's `notFor` entry.
export const LINKEDIN_OPERATIONS = Object.freeze({
    jobs_search: "linkedin_job_listings_information_keyword",
    jobs_by_search_url: "linkedin_job_listings_information_job-listing-url",
    job_by_url: "linkedin_job_listings_information_job-url",
    company_by_url: "linkedin_company_information_url",
});
/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const LINKEDIN_OPERATION_PARAMS_DOC = {
    jobs_search: "params.location (required, e.g. \"Germany\"); optional params.keyword, params.range (Any_time|Past_day|Past_week|Past_month), params.level, params.position_type, params.remote (On_site|Remote|Hybrid), params.company, params.selective_search, params.position_to_not_include, params.location_radius, params.page_limit, params.file_name",
    jobs_by_search_url: "params.listing_url (a LinkedIn JOBS SEARCH RESULTS URL — returns multiple listings); optional params.page_limit, params.file_name",
    job_by_url: "params.position_url (a single LinkedIn job POSTING URL); optional params.file_name",
    company_by_url: "params.url (LinkedIn company page URL); optional params.file_name",
};
const LINKEDIN_OPERATION_CONFIGS = Object.fromEntries(Object.keys(LINKEDIN_OPERATIONS).map((name) => [
    name,
    { scraperId: LINKEDIN_OPERATIONS[name], paramsDoc: LINKEDIN_OPERATION_PARAMS_DOC[name] },
]));
/** LinkedIn's declarative platform-scraper config — the factory's sole input for this tool. */
export const LINKEDIN_SCRAPER_CONFIG = {
    platform: "linkedin.com",
    platformLabel: "LinkedIn",
    toolName: "novada_scrape_linkedin",
    category: "Scraping & Verification",
    registryDescription: "Extract structured LinkedIn data (job listings by filters/search URL/job URL, company info by URL) via a closed, typed operation enum — 4 verified-working operations; same engine and output formats as novada_scrape, pinned to platform=linkedin.com",
    operations: LINKEDIN_OPERATION_CONFIGS,
    paramsFieldDoc: "Operation-specific parameters for the selected `operation`. E.g. { location: \"Germany\", keyword: \"product manager\" } for " +
        "jobs_search, { listing_url: \"https://www.linkedin.com/jobs/search?...\" } for jobs_by_search_url, " +
        "{ position_url: \"https://www.linkedin.com/jobs/view/...\" } for job_by_url, { url: \"https://www.linkedin.com/company/...\" } for company_by_url.",
    description: {
        core: "Extract structured LinkedIn data — job listings (by location/filters, by a jobs search-results URL, or a single job posting URL) and company profile info by URL — through a LinkedIn-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"linkedin.com\".",
        useWhen: [
            "find LinkedIn job listings in <location> matching <keyword/level/remote/etc.>",
            "get all the job listings from this LinkedIn jobs search URL",
            "get details for this single LinkedIn job posting URL",
            "get company info for this LinkedIn company URL",
        ],
        notFor: [
            { when: "A single LinkedIn URL you just want read as plain text", useInstead: "novada_extract" },
            { when: "A general web search not scoped to LinkedIn", useInstead: "novada_search" },
            { when: "A LinkedIn personal PROFILE (not a company or job) — no catalog operation exists for this today", useInstead: "novada_extract on the profile URL, or novada_search" },
            { when: "A different platform's structured data (GitHub, Amazon, etc.)", useInstead: "novada_scrape with that platform's domain, or its own novada_scrape_<platform> tool" },
        ],
        returns: "Structured job-listing/company records (title, location, level, company name, follower count, etc.) in the chosen format (markdown/json/csv/excel/html/toon) — same rendering as novada_scrape.",
        operationsNote: "4 verified-working LinkedIn operations spanning job search (by location, with optional keyword/level/remote/company filters), job listings from a search-results URL, a single job posting by URL, and company info by URL (see the `operation` param's description for the exact `params` keys each needs). `jobs_search` requires `params.location` — the catalog's actual required key for this op, despite its upstream name reading \"By Keywords\" (keyword itself is optional there). Every linkedin.com catalog operation is currently status:\"ok\" — none are excluded for being backend_broken.",
    },
};
/** The materialized LinkedIn platform-scraper tool (definition + registry entry + handler). */
export const LINKEDIN_SCRAPER_TOOL = createPlatformScraperTool(LINKEDIN_SCRAPER_CONFIG);
export const ScrapeLinkedinParamsSchema = LINKEDIN_SCRAPER_TOOL.ParamsSchema;
export function validateScrapeLinkedinParams(args) {
    return LINKEDIN_SCRAPER_TOOL.validateParams(args);
}
/**
 * novada_scrape_linkedin — a thin, LinkedIn-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "linkedin.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export async function novadaScrapeLinkedin(params, apiKey) {
    return LINKEDIN_SCRAPER_TOOL.handler(params, apiKey);
}
//# sourceMappingURL=scrape_linkedin.js.map