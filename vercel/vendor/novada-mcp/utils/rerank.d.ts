import { type SearchIntent } from "./authority.js";
export interface RankedResult<T extends {
    title?: string;
    description?: string;
    snippet?: string;
    url?: string;
    link?: string;
}> {
    result: T;
    score: number;
}
/**
 * Rerank results by relevance to query using keyword scoring plus a bounded,
 * intent-gated domain-authority signal.
 *
 * Title matches are weighted 3x (word boundary) / 2x (substring).
 * Snippet matches are weighted 1x (word boundary) / 0.5x (substring).
 * Domain authority (see authority.ts) only nudges/breaks ties — its magnitude
 * stays below the smallest title-match delta and is GATED by `intent`:
 *   - "factual": authoritative sources boosted, social/PR down-ranked
 *   - "social":  no authority adjustment (social results are the target)
 *   - "default": mild adjustment only
 *
 * Returns original order when no meaningful query terms remain after stop-word
 * filtering, preserving the prior keyword-only contract (authority is a
 * tie-breaker/nudge layered on top of keyword relevance, not a standalone sort).
 */
export declare function rerankResults<T extends {
    title?: string;
    description?: string;
    snippet?: string;
    url?: string;
    link?: string;
}>(results: T[], query: string, intent?: SearchIntent): T[];
//# sourceMappingURL=rerank.d.ts.map