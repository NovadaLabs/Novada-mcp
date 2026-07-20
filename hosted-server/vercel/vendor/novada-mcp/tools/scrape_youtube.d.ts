import type { z } from "zod";
import { type PlatformScraperConfig } from "./platform_scraper.js";
export declare const YOUTUBE_OPERATIONS: Readonly<{
    readonly transcript_by_video: "youtube_transcript_id";
    readonly video_file_by_url: "youtube_video-url";
    readonly channel_by_url: "youtube_profiles_url";
    readonly channels_by_keyword: "youtube_profiles_keyword";
    readonly comments_by_video: "youtube_comment_id";
    readonly audio_file_by_url: "youtube_audio_url";
    readonly video_by_id: "youtube_product-videoid";
    readonly video_by_url: "youtube_video-post_explore";
    readonly videos_by_keyword: "youtube_video-post-keyword";
    readonly videos_by_filters: "youtube_video-post_search_filters";
    readonly videos_by_playlist_url: "youtube_video-post-podcast-url";
    readonly channel_videos_by_url: "youtube_video-post_url";
}>;
export type YoutubeOperation = keyof typeof YOUTUBE_OPERATIONS;
/** YouTube's declarative platform-scraper config — the factory's sole input for this tool. */
export declare const YOUTUBE_SCRAPER_CONFIG: PlatformScraperConfig<YoutubeOperation>;
/** The materialized YouTube platform-scraper tool (definition + registry entry + handler). */
export declare const YOUTUBE_SCRAPER_TOOL: {
    toolDefinition: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        annotations: {
            readOnlyHint: boolean;
            idempotentHint: boolean;
            destructiveHint: boolean;
            openWorldHint: boolean;
        };
    };
    registryEntry: import("./registry.js").ToolMeta;
    ParamsSchema: z.ZodObject<{
        operation: z.ZodEnum<{
            transcript_by_video: "transcript_by_video";
            video_file_by_url: "video_file_by_url";
            channel_by_url: "channel_by_url";
            channels_by_keyword: "channels_by_keyword";
            comments_by_video: "comments_by_video";
            audio_file_by_url: "audio_file_by_url";
            video_by_id: "video_by_id";
            video_by_url: "video_by_url";
            videos_by_keyword: "videos_by_keyword";
            videos_by_filters: "videos_by_filters";
            videos_by_playlist_url: "videos_by_playlist_url";
            channel_videos_by_url: "channel_videos_by_url";
        }>;
        params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        limit: z.ZodDefault<z.ZodNumber>;
        format: z.ZodDefault<z.ZodEnum<{
            json: "json";
            html: "html";
            markdown: "markdown";
            csv: "csv";
            excel: "excel";
            toon: "toon";
        }>>;
        task_id: z.ZodOptional<z.ZodString>;
        project: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    validateParams: (args: Record<string, unknown> | undefined) => {
        operation: "transcript_by_video" | "video_file_by_url" | "channel_by_url" | "channels_by_keyword" | "comments_by_video" | "audio_file_by_url" | "video_by_id" | "video_by_url" | "videos_by_keyword" | "videos_by_filters" | "videos_by_playlist_url" | "channel_videos_by_url";
        params: Record<string, unknown>;
        limit: number;
        format: "json" | "html" | "markdown" | "csv" | "excel" | "toon";
        task_id?: string | undefined;
        project?: string | undefined;
    };
    handler: (params: {
        operation: "transcript_by_video" | "video_file_by_url" | "channel_by_url" | "channels_by_keyword" | "comments_by_video" | "audio_file_by_url" | "video_by_id" | "video_by_url" | "videos_by_keyword" | "videos_by_filters" | "videos_by_playlist_url" | "channel_videos_by_url";
        params: Record<string, unknown>;
        limit: number;
        format: "json" | "html" | "markdown" | "csv" | "excel" | "toon";
        task_id?: string | undefined;
        project?: string | undefined;
    }, apiKey: string) => Promise<string>;
    config: PlatformScraperConfig<"transcript_by_video" | "video_file_by_url" | "channel_by_url" | "channels_by_keyword" | "comments_by_video" | "audio_file_by_url" | "video_by_id" | "video_by_url" | "videos_by_keyword" | "videos_by_filters" | "videos_by_playlist_url" | "channel_videos_by_url">;
};
export declare const ScrapeYoutubeParamsSchema: z.ZodObject<{
    operation: z.ZodEnum<{
        transcript_by_video: "transcript_by_video";
        video_file_by_url: "video_file_by_url";
        channel_by_url: "channel_by_url";
        channels_by_keyword: "channels_by_keyword";
        comments_by_video: "comments_by_video";
        audio_file_by_url: "audio_file_by_url";
        video_by_id: "video_by_id";
        video_by_url: "video_by_url";
        videos_by_keyword: "videos_by_keyword";
        videos_by_filters: "videos_by_filters";
        videos_by_playlist_url: "videos_by_playlist_url";
        channel_videos_by_url: "channel_videos_by_url";
    }>;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    limit: z.ZodDefault<z.ZodNumber>;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        html: "html";
        markdown: "markdown";
        csv: "csv";
        excel: "excel";
        toon: "toon";
    }>>;
    task_id: z.ZodOptional<z.ZodString>;
    project: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ScrapeYoutubeParams = z.infer<typeof ScrapeYoutubeParamsSchema>;
export declare function validateScrapeYoutubeParams(args: Record<string, unknown> | undefined): ScrapeYoutubeParams;
/**
 * novada_scrape_youtube — a thin, YouTube-only adapter over the shared scrape engine
 * (novadaScrape in ./scrape.js), generated by the platform-scraper factory. Resolves
 * the friendly `operation` name to its exact catalog scraper_id, pins the platform to
 * "youtube.com", and delegates everything else — the HTTP call, polling, output
 * rendering, and error classification — to novadaScrape. No HTTP/FormData logic is
 * duplicated here.
 */
export declare function novadaScrapeYoutube(params: ScrapeYoutubeParams, apiKey: string): Promise<string>;
//# sourceMappingURL=scrape_youtube.d.ts.map