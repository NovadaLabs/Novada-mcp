/**
 * Domain-authority classification + query-intent detection for search reranking.
 *
 * scoreResult in rerank.ts originally read only title/snippet and ignored the
 * result URL. This module adds a bounded, intent-gated authority signal:
 *   - authoritative sources (gov/edu/SEC/arxiv/NIH/Reuters/AP/Wikipedia/Nature …)
 *     get a small boost
 *   - social / press-release sources (Facebook, LinkedIn, X, Reddit, PRNewswire …)
 *     get a small penalty
 *
 * The adjustment is ADDITIVE and BOUNDED (never large enough to override a
 * title-match delta), and GATED by query intent so that a "reddit thread" or
 * "linkedin profile" query does not down-rank the very results it asks for.
 */
export type AuthorityTier = "authoritative" | "social" | "neutral";
export type SearchIntent = "factual" | "social" | "default";
/**
 * Social / PR / user-generated-content domains. These are de-emphasized for
 * factual / finance / research queries where primary sources are preferable.
 * (Suffix-matched against the registrable host, so "m.facebook.com" matches.)
 */
export declare const SOCIAL_PR_DOMAINS: readonly string[];
/**
 * Authoritative domains (primary sources, regulators, peer-reviewed, wire
 * services, reference). Suffix entries beginning with "." match any subdomain
 * AND multi-part TLD groups such as "*.gov" / "*.edu".
 *
 * Seeded from DOMAIN_REGISTRY (arxiv.org, reuters.com, apnews.com,
 * wikipedia.org, pubmed.ncbi.nlm.nih.gov) and augmented per NOV-567.
 */
export declare const AUTHORITATIVE_DOMAINS: readonly string[];
/**
 * Detect the dominant intent of a query.
 *  - social wins when an explicit social/navigational term is present
 *    (e.g. "linkedin profile", "reddit thread") so we never penalize the
 *    results the user is literally asking for.
 *  - factual when a finance/research lexicon term is present.
 *  - default otherwise (mild adjustment only).
 */
export declare function detectIntent(query: string | undefined): SearchIntent;
/** Classify a URL's domain authority tier. Unknown/invalid → "neutral". */
export declare function classifyAuthority(url: string | undefined): AuthorityTier;
/** True when the URL's host is a social/PR domain (for hard-drop filtering). */
export declare function isSocialOrPr(url: string | undefined): boolean;
/**
 * Bounded, intent-gated authority score adjustment for a single result.
 *
 * Returns a delta added to the keyword score in scoreResult. Magnitudes are
 * deliberately kept small relative to keyword deltas (title word match = +3,
 * substring = +2, snippet word = +1) so the URL signal primarily breaks ties
 * and nudges rather than overriding genuine keyword relevance. In particular
 * the total factual swing (boost − penalty = 2.5) stays below a two-term
 * title-vs-snippet gap, so a multi-term title match is not flipped by authority.
 *
 *   intent=factual  → authoritative +1.0, social/PR -1.5  (swing 2.5)
 *   intent=default  → authoritative +0.5, social/PR -0.5  (swing 1.0)
 *   intent=social   → 0 (social results are the target; do not penalize)
 *
 * neutral domains and missing/invalid URLs always yield 0.
 */
export declare function authorityAdjustment(url: string | undefined, intent: SearchIntent): number;
//# sourceMappingURL=authority.d.ts.map