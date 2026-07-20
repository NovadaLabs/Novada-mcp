import type { z } from "zod";
import {
  createPlatformScraperTool,
  type PlatformScraperConfig,
  type PlatformOperationConfig,
} from "./platform_scraper.js";

// ─── Instagram operation → catalog scraper_id map (single source of truth) ──
// Tools-v2: novada_scrape_instagram, built on the config-driven platform-scraper
// factory (src/tools/platform_scraper.ts — see scrape_amazon.ts for the
// proof-of-pattern). Friendly, human-readable operation names for
// novada_scrape_instagram, each mapped deterministically to the exact `slug`
// (== scraper_id) in src/data/scraper_catalog.ts's instagram.com block.
//
// All 7 instagram.com catalog operations are status:"ok" as of the 2026-07-13 live
// verification pass — none are excluded here. If a future catalog refresh marks
// any of these backend_broken, tests/tools/platform-scraper-catalog.test.ts will
// fail CI until it is removed from this map.
export const INSTAGRAM_OPERATIONS = Object.freeze({
  comments_by_post_url: "ins_comment_posturl",
  reels_by_profile_url: "ins_allreel_url",
  reel_by_url: "ins_reel_url",
  posts_by_profile: "ins_posts_profileurl",
  post_by_url: "ins_posts_posturl",
  profile_by_url: "ins_profiles_profileurl",
  profile_by_username: "ins_profiles_username",
} as const);

export type InstagramOperation = keyof typeof INSTAGRAM_OPERATIONS;

/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description.
 *  posts_by_profile: the catalog (src/data/scraper_catalog.ts's instagram.com block, slug
 *  ins_posts_profileurl) marks BOTH `profileurl` AND `resultsLimit` as required:true — two
 *  independently-required keys, not OR-alternates — so this op is added to scrape.ts's
 *  AND_REQUIRED_OPS allowlist (see that file's comment for the precedent: the existing
 *  Amazon AND-required ops also carry a catalog `dflt` on their required keys, which does
 *  NOT exempt them from being genuinely mandatory). */
const INSTAGRAM_OPERATION_PARAMS_DOC: Record<InstagramOperation, string> = {
  comments_by_post_url: "params.posturl (post/reel URL); optional params.file_name",
  reels_by_profile_url: "params.url (profile URL); optional params.num_posts, params.uncrawled_posts, params.start_date, params.end_date, params.file_name",
  reel_by_url: "params.url (a single reel URL); optional params.file_name",
  posts_by_profile: "params.profileurl AND params.resultsLimit (BOTH required together); optional params.start_date, params.end_date, params.post_type (Post|Reel), params.file_name",
  post_by_url: "params.posturl (a single post URL); optional params.file_name",
  profile_by_url: "params.profileurl; optional params.file_name",
  profile_by_username: "params.username; optional params.file_name",
};

const INSTAGRAM_OPERATION_CONFIGS: Record<InstagramOperation, PlatformOperationConfig> = Object.fromEntries(
  (Object.keys(INSTAGRAM_OPERATIONS) as InstagramOperation[]).map((name) => [
    name,
    { scraperId: INSTAGRAM_OPERATIONS[name], paramsDoc: INSTAGRAM_OPERATION_PARAMS_DOC[name] },
  ]),
) as Record<InstagramOperation, PlatformOperationConfig>;

/** Instagram's declarative platform-scraper config — the factory's sole input for this tool. */
export const INSTAGRAM_SCRAPER_CONFIG: PlatformScraperConfig<InstagramOperation> = {
  platform: "instagram.com",
  platformLabel: "Instagram",
  toolName: "novada_scrape_instagram",
  category: "Scraping & Verification",
  registryDescription:
    "Extract structured Instagram data (profiles, posts, reels, comments) via a closed, typed operation enum — 7 verified-working operations; same engine and output formats as novada_scrape, pinned to platform=instagram.com",
  operations: INSTAGRAM_OPERATION_CONFIGS,
  paramsFieldDoc:
    "Operation-specific parameters for the selected `operation`. E.g. { posturl: \"https://www.instagram.com/p/...\" } for " +
    "comments_by_post_url/post_by_url, { profileurl: \"https://www.instagram.com/handle/\", resultsLimit: 10 } for " +
    "posts_by_profile, { username: \"handle\" } for profile_by_username.",
  description: {
    core:
      "Extract structured Instagram data — profiles, posts, reels, and comments — through an Instagram-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"instagram.com\".",
    useWhen: [
      "get the latest posts from this Instagram profile",
      "pull the comments on this Instagram post or reel",
      "get details for this single Instagram post or reel URL",
      "get Instagram profile info by URL or username",
      "get the reels posted by this Instagram profile",
    ],
    notFor: [
      { when: "A single Instagram URL you just want read as plain text", useInstead: "novada_extract" },
      { when: "A general web search not scoped to Instagram", useInstead: "novada_search" },
      { when: "A different platform's structured data (TikTok, Facebook, etc.)", useInstead: "novada_scrape with that platform's domain, or its own novada_scrape_<platform> tool" },
    ],
    returns:
      "Structured profile/post/reel/comment records (username, follower count, caption, like count, comment author/text, etc.) in the chosen format (markdown/json/csv/excel/html/toon) — same rendering as novada_scrape.",
    operationsNote:
      "7 verified-working Instagram operations spanning profile lookup (by URL or username), posts and reels (by profile or by direct URL), and comments (see the `operation` param's description for the exact `params` keys each needs). `posts_by_profile` requires BOTH `profileurl` AND `resultsLimit` together. Every instagram.com catalog operation is currently status:\"ok\" — none are excluded for being backend_broken.",
  },
};

/** The materialized Instagram platform-scraper tool (definition + registry entry + handler). */
export const INSTAGRAM_SCRAPER_TOOL = createPlatformScraperTool(INSTAGRAM_SCRAPER_CONFIG);

export const ScrapeInstagramParamsSchema = INSTAGRAM_SCRAPER_TOOL.ParamsSchema;

export type ScrapeInstagramParams = z.infer<typeof ScrapeInstagramParamsSchema>;

export function validateScrapeInstagramParams(args: Record<string, unknown> | undefined): ScrapeInstagramParams {
  return INSTAGRAM_SCRAPER_TOOL.validateParams(args);
}

/**
 * novada_scrape_instagram — a thin, Instagram-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "instagram.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export async function novadaScrapeInstagram(params: ScrapeInstagramParams, apiKey: string): Promise<string> {
  return INSTAGRAM_SCRAPER_TOOL.handler(params, apiKey);
}
