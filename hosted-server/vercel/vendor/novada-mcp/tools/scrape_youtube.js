import { createPlatformScraperTool, } from "./platform_scraper.js";
// ─── YouTube operation → catalog scraper_id map (single source of truth) ────
// Tools-v2: novada_scrape_youtube, built on the config-driven platform-scraper
// factory (src/tools/platform_scraper.ts — see scrape_amazon.ts for the
// proof-of-pattern). Friendly, human-readable operation names for
// novada_scrape_youtube, each mapped deterministically to the exact `slug`
// (== scraper_id) in src/data/scraper_catalog.ts's youtube.com block.
//
// All 12 youtube.com catalog operations are status:"ok" as of the 2026-07-13 live
// verification pass — none are excluded here. If a future catalog refresh marks
// any of these backend_broken, tests/tools/platform-scraper-catalog.test.ts will
// fail CI until it is removed from this map.
export const YOUTUBE_OPERATIONS = Object.freeze({
    transcript_by_video: "youtube_transcript_id",
    video_file_by_url: "youtube_video-url",
    channel_by_url: "youtube_profiles_url",
    channels_by_keyword: "youtube_profiles_keyword",
    comments_by_video: "youtube_comment_id",
    audio_file_by_url: "youtube_audio_url",
    video_by_id: "youtube_product-videoid",
    video_by_url: "youtube_video-post_explore",
    videos_by_keyword: "youtube_video-post-keyword",
    videos_by_filters: "youtube_video-post_search_filters",
    videos_by_playlist_url: "youtube_video-post-podcast-url",
    channel_videos_by_url: "youtube_video-post_url",
});
/** Per-operation `params` doc — rendered as `- <name>: <doc>` in the enum description. */
const YOUTUBE_OPERATION_PARAMS_DOC = {
    transcript_by_video: "params.video_id (e.g. \"LCAY3PGHZyw\"); optional params.subtitles_language, params.subtitles_type (auto_generated|uploader_provided), params.selected_only, params.file_name",
    video_file_by_url: "params.url (video URL); optional params.resolution, params.video_codec (avc1|vp9|av01), params.audio_format (opus|m4a), params.bitrate, params.subtitles_language, params.selected_only, params.file_name",
    channel_by_url: "params.url (channel URL, e.g. \"https://www.youtube.com/@disneykids\"); optional params.file_name",
    channels_by_keyword: "params.keyword; optional params.page_numbers, params.file_name",
    comments_by_video: "params.video_id; optional params.replay_times, params.sorting_methods, params.num_of_comments, params.file_name",
    audio_file_by_url: "params.url (video URL — downloads its audio track); optional params.bitrate, params.audio_format (opus|m4a), params.kHz, params.is_subtitles, params.selected_format, params.file_name",
    video_by_id: "params.video_id; optional params.file_name",
    video_by_url: "params.url (video URL); optional params.all_labels, params.file_name",
    videos_by_keyword: "params.keyword; optional params.num_of_posts, params.file_name",
    videos_by_filters: "params.keyword_search; optional params.attributes, params.type (Videos|Movies), params.duration, params.upload_date, params.num_of_posts, params.file_name",
    videos_by_playlist_url: "params.url (playlist/podcast URL); optional params.num_of_posts, params.file_name",
    channel_videos_by_url: "params.url (a channel's /videos URL); optional params.sorting_method (Latest|Popular|Oldest), params.start_index, params.num_of_posts, params.file_name",
};
const YOUTUBE_OPERATION_CONFIGS = Object.fromEntries(Object.keys(YOUTUBE_OPERATIONS).map((name) => [
    name,
    { scraperId: YOUTUBE_OPERATIONS[name], paramsDoc: YOUTUBE_OPERATION_PARAMS_DOC[name] },
]));
/** YouTube's declarative platform-scraper config — the factory's sole input for this tool. */
export const YOUTUBE_SCRAPER_CONFIG = {
    platform: "youtube.com",
    platformLabel: "YouTube",
    toolName: "novada_scrape_youtube",
    category: "Scraping & Verification",
    registryDescription: "Extract structured YouTube data (video/channel info, transcripts, comments, video/audio downloads) via a closed, typed operation enum — 12 verified-working operations; same engine and output formats as novada_scrape, pinned to platform=youtube.com",
    operations: YOUTUBE_OPERATION_CONFIGS,
    paramsFieldDoc: "Operation-specific parameters for the selected `operation`. E.g. { video_id: \"LCAY3PGHZyw\" } for " +
        "transcript_by_video/comments_by_video/video_by_id, { url: \"https://www.youtube.com/watch?v=...\" } for " +
        "video_file_by_url/audio_file_by_url/video_by_url, { keyword: \"proxy\" } for channels_by_keyword/videos_by_keyword.",
    description: {
        core: "Extract structured YouTube data — video and channel metadata, transcripts, comments, and downloadable video/audio files — through a YouTube-only tool with a closed, typed `operation` enum. Same underlying engine as novada_scrape, pinned to platform=\"youtube.com\".",
        useWhen: [
            "get the transcript/subtitles for this YouTube video",
            "pull the comments on this YouTube video",
            "get channel info for this YouTube channel URL",
            "search YouTube channels for <keyword>",
            "find YouTube videos matching <keyword>, filtered by duration/upload date/attributes",
        ],
        notFor: [
            { when: "A single YouTube URL you just want read as plain text", useInstead: "novada_extract" },
            { when: "A general web/video search not scoped to YouTube", useInstead: "novada_search" },
            { when: "A different platform's structured data (TikTok, Instagram, etc.)", useInstead: "novada_scrape with that platform's domain, or its own novada_scrape_<platform> tool" },
        ],
        returns: "Structured video/channel/comment records (title, views, transcript text, comment author/text, channel subscriber count, etc.) plus downloadable video/audio file links, in the chosen format (markdown/json/csv/excel/html/toon) — same rendering as novada_scrape.",
        operationsNote: "12 verified-working YouTube operations spanning transcripts, video/audio file downloads, channel lookup + search, comments, and video search by keyword/label/filters/playlist/channel (see the `operation` param's description for the exact `params` keys each needs). Every youtube.com catalog operation is currently status:\"ok\" — none are excluded for being backend_broken.",
    },
};
/** The materialized YouTube platform-scraper tool (definition + registry entry + handler). */
export const YOUTUBE_SCRAPER_TOOL = createPlatformScraperTool(YOUTUBE_SCRAPER_CONFIG);
export const ScrapeYoutubeParamsSchema = YOUTUBE_SCRAPER_TOOL.ParamsSchema;
export function validateScrapeYoutubeParams(args) {
    return YOUTUBE_SCRAPER_TOOL.validateParams(args);
}
/**
 * novada_scrape_youtube — a thin, YouTube-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "youtube.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export async function novadaScrapeYoutube(params, apiKey) {
    return YOUTUBE_SCRAPER_TOOL.handler(params, apiKey);
}
//# sourceMappingURL=scrape_youtube.js.map