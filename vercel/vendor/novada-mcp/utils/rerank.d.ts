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
 * Rerank results by relevance to query using keyword scoring.
 * Title matches are weighted 3x (word boundary) / 2x (substring).
 * Snippet matches are weighted 1x (word boundary) / 0.5x (substring).
 * Returns original order when no meaningful query terms remain after stop-word filtering.
 */
export declare function rerankResults<T extends {
    title?: string;
    description?: string;
    snippet?: string;
    url?: string;
    link?: string;
}>(results: T[], query: string): T[];
//# sourceMappingURL=rerank.d.ts.map