import { authorityAdjustment } from "./authority.js";
const STOP_WORDS = new Set([
    "the", "a", "an", "in", "on", "at", "to", "for", "of", "with",
    "and", "or", "but", "is", "are", "was", "were", "be", "been",
    "what", "how", "why", "when", "where", "who", "which",
]);
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
export function rerankResults(results, query, intent = "default") {
    if (results.length <= 1)
        return results;
    const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
    if (terms.length === 0)
        return results;
    return results
        .map(r => ({ result: r, score: scoreResult(r, terms, intent) }))
        .sort((a, b) => b.score - a.score)
        .map(r => r.result);
}
function scoreResult(result, terms, intent) {
    const title = (result.title || "").toLowerCase();
    const snippet = (result.description || result.snippet || "").toLowerCase();
    let score = 0;
    for (const term of terms) {
        // Title matches weighted 3x (exact word boundary) + 2x (substring)
        const titleWordCount = (title.match(new RegExp(`\\b${escapeRegex(term)}\\b`, "g")) || []).length;
        const titleSubCount = Math.max(0, (title.split(term).length - 1) - titleWordCount);
        score += titleWordCount * 3 + titleSubCount * 2;
        // Snippet matches weighted 1x (word boundary) + 0.5x (substring)
        const snippetWordCount = (snippet.match(new RegExp(`\\b${escapeRegex(term)}\\b`, "g")) || []).length;
        const snippetSubCount = Math.max(0, (snippet.split(term).length - 1) - snippetWordCount);
        score += snippetWordCount * 1 + snippetSubCount * 0.5;
    }
    // Bonus: snippet length signal (longer = more informative, up to 200 chars = max bonus 1.0)
    score += Math.min(snippet.length / 200, 1.0);
    // Domain-authority signal — bounded + intent-gated. Reads the result URL,
    // which the keyword pass ignores. Missing/invalid URL → 0 (no crash).
    score += authorityAdjustment(result.url || result.link, intent);
    return score;
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//# sourceMappingURL=rerank.js.map