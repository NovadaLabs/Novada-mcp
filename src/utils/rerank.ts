const STOP_WORDS = new Set([
  "the", "a", "an", "in", "on", "at", "to", "for", "of", "with",
  "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "what", "how", "why", "when", "where", "who", "which",
]);

export interface RankedResult<T extends { title?: string; description?: string; snippet?: string; url?: string; link?: string }> {
  result: T;
  score: number;
}

/**
 * Rerank results by relevance to query using keyword scoring.
 * Title matches are weighted 3x (word boundary) / 2x (substring).
 * Snippet matches are weighted 1x (word boundary) / 0.5x (substring).
 * Returns original order when no meaningful query terms remain after stop-word filtering.
 */
export function rerankResults<T extends { title?: string; description?: string; snippet?: string; url?: string; link?: string }>(
  results: T[],
  query: string
): T[] {
  if (results.length <= 1) return results;

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w));

  if (terms.length === 0) return results;

  return results
    .map(r => ({ result: r, score: scoreResult(r, terms) }))
    .sort((a, b) => b.score - a.score)
    .map(r => r.result);
}

function scoreResult<T extends { title?: string; description?: string; snippet?: string }>(
  result: T,
  terms: string[]
): number {
  const title = (result.title || "").toLowerCase();
  const snippet = (result.description || result.snippet || "").toLowerCase();

  let score = 0;
  for (const term of terms) {
    // Title matches weighted 3x (exact word boundary) + 2x (substring)
    const titleWordCount = (title.match(new RegExp(`\\b${escapeRegex(term)}\\b`, "g")) || []).length;
    const titleSubCount = (title.split(term).length - 1) - titleWordCount;
    score += titleWordCount * 3 + titleSubCount * 2;

    // Snippet matches weighted 1x (word boundary) + 0.5x (substring)
    const snippetWordCount = (snippet.match(new RegExp(`\\b${escapeRegex(term)}\\b`, "g")) || []).length;
    const snippetSubCount = (snippet.split(term).length - 1) - snippetWordCount;
    score += snippetWordCount * 1 + snippetSubCount * 0.5;
  }

  // Bonus: snippet length signal (longer = more informative, up to 200 chars = max bonus 1.0)
  score += Math.min(snippet.length / 200, 1.0);

  return score;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
