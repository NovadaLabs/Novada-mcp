import { z } from "zod";
export declare const SearchFeedbackParamsSchema: z.ZodObject<{
    search_id: z.ZodString;
    query: z.ZodString;
    useful_urls: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    rating: z.ZodEnum<{
        good: "good";
        ok: "ok";
        bad: "bad";
    }>;
    note: z.ZodOptional<z.ZodString>;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        markdown: "markdown";
    }>>;
}, z.core.$strip>;
export type SearchFeedbackParams = z.infer<typeof SearchFeedbackParamsSchema>;
export declare function validateSearchFeedbackParams(args: Record<string, unknown> | undefined): SearchFeedbackParams;
/** One recorded feedback entry. */
export interface FeedbackEntry {
    search_id: string;
    query: string;
    useful_urls: string[];
    rating: "good" | "ok" | "bad";
    note?: string;
    /** ISO timestamp the feedback was recorded. */
    at: string;
}
/**
 * Read back all feedback recorded for a given search_id. Exposed for in-process
 * consumers (e.g. a future ranking pass) and tests.
 */
export declare function getFeedbackForSearch(searchId: string): readonly FeedbackEntry[];
/** Total feedback submissions recorded this session (across all searches). */
export declare function getTotalFeedbackCount(): number;
/** Test-only: clear the store. Not wired to any tool. */
export declare function resetSearchFeedback(): void;
/**
 * Record search-result quality feedback into the in-memory store and return a
 * thank-you / echo confirmation with an agent_instruction. In-memory only;
 * resets on server restart.
 */
export declare function novadaSearchFeedback(params: SearchFeedbackParams): Promise<string>;
//# sourceMappingURL=search_feedback.d.ts.map