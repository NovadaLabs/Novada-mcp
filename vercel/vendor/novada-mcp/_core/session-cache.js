/**
 * Session-scoped in-process cache for extract results.
 * Prevents duplicate API calls when agents hit the same URL multiple times
 * within a research loop. Discards on process restart — correct scope for agents.
 *
 * TTL: 5 minutes. Key: url::renderMode::format[::fields:f1,f2].
 * Format is included in the key so extract(url, format="html") and
 * extract(url, format="markdown") are cached separately — different params, different results.
 * Fields are included so extract(url) and extract(url, fields=["price"]) are also separate.
 */
const TTL_MS = 5 * 60 * 1000;
const cache = new Map();
function cacheKey(url, renderMode, format, fields) {
    const base = `${url}::${renderMode}::${format}`;
    return fields?.length ? `${base}::fields:${[...fields].sort().join(",")}` : base;
}
export function getCached(url, renderMode, format, fields) {
    const key = cacheKey(url, renderMode, format, fields);
    const entry = cache.get(key);
    if (!entry)
        return null;
    if (Date.now() - entry.ts > TTL_MS) {
        cache.delete(key);
        return null;
    }
    return entry.result;
}
export function setCached(url, renderMode, format, result, fields) {
    const key = cacheKey(url, renderMode, format, fields);
    cache.set(key, { result, ts: Date.now() });
    // Lazy eviction: prune expired entries when cache grows beyond 100
    if (cache.size > 100) {
        const now = Date.now();
        for (const [k, v] of cache) {
            if (now - v.ts > TTL_MS)
                cache.delete(k);
        }
    }
}
/**
 * Clear the entire session cache. Primarily for tests: vitest runs many cases
 * in one process, and a success cached under url+mode+format would short-circuit
 * a later test that reuses the same URL (the axios mock is never consulted).
 * Call in a beforeEach so each test starts from a cold cache.
 */
export function clearCache() {
    cache.clear();
}
//# sourceMappingURL=session-cache.js.map