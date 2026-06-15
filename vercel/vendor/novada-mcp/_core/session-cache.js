/**
 * Session-scoped in-process cache for extract results.
 * Prevents duplicate API calls when agents hit the same URL multiple times
 * within a research loop. Discards on process restart — correct scope for agents.
 *
 * TTL: 5 minutes. Key: url::renderMode[::fields:f1,f2].
 * Fields are included in the key so extract(url) and extract(url, fields=["price"])
 * are cached separately — different params, different results.
 */
const TTL_MS = 5 * 60 * 1000;
const cache = new Map();
function cacheKey(url, renderMode, fields) {
    const fieldsSuffix = fields && fields.length > 0
        ? `::fields:${[...fields].sort().join(",")}`
        : "";
    return `${url}::${renderMode}${fieldsSuffix}`;
}
export function getCached(url, renderMode, fields) {
    const key = cacheKey(url, renderMode, fields);
    const entry = cache.get(key);
    if (!entry)
        return null;
    if (Date.now() - entry.ts > TTL_MS) {
        cache.delete(key);
        return null;
    }
    return entry.result;
}
export function setCached(url, renderMode, result, fields) {
    const key = cacheKey(url, renderMode, fields);
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
//# sourceMappingURL=session-cache.js.map