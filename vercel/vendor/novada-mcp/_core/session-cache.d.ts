/**
 * Session-scoped in-process cache for extract results.
 * Prevents duplicate API calls when agents hit the same URL multiple times
 * within a research loop. Discards on process restart — correct scope for agents.
 *
 * TTL: 5 minutes. Key: url::renderMode[::fields:f1,f2].
 * Fields are included in the key so extract(url) and extract(url, fields=["price"])
 * are cached separately — different params, different results.
 */
export declare function getCached(url: string, renderMode: string, fields?: string[]): string | null;
export declare function setCached(url: string, renderMode: string, result: string, fields?: string[]): void;
//# sourceMappingURL=session-cache.d.ts.map