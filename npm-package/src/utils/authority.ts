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

import { DOMAIN_REGISTRY } from "./domains.js";

export type AuthorityTier = "authoritative" | "social" | "neutral";
export type SearchIntent = "factual" | "social" | "default";

/**
 * Social / PR / user-generated-content domains. These are de-emphasized for
 * factual / finance / research queries where primary sources are preferable.
 * (Suffix-matched against the registrable host, so "m.facebook.com" matches.)
 */
export const SOCIAL_PR_DOMAINS: readonly string[] = [
  // social / UGC
  "facebook.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "tiktok.com",
  "reddit.com",
  "quora.com",
  "medium.com",
  // press-release wires
  "prnewswire.com",
  "businesswire.com",
  "globenewswire.com",
  "prweb.com",
  "einpresswire.com",
];

/**
 * Authoritative domains (primary sources, regulators, peer-reviewed, wire
 * services, reference). Suffix entries beginning with "." match any subdomain
 * AND multi-part TLD groups such as "*.gov" / "*.edu".
 *
 * Seeded from DOMAIN_REGISTRY (arxiv.org, reuters.com, apnews.com,
 * wikipedia.org, pubmed.ncbi.nlm.nih.gov) and augmented per NOV-567.
 */
export const AUTHORITATIVE_DOMAINS: readonly string[] = [
  // government / education (TLD-group suffixes)
  ".gov",
  ".edu",
  ".mil",
  // regulators / primary
  "sec.gov",
  // academic / preprint / medical
  "arxiv.org",
  "nih.gov",
  "ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "nature.com",
  // wire services / reference (seeded from DOMAIN_REGISTRY)
  "reuters.com",
  "apnews.com",
  "wikipedia.org",
];

// Cross-check: every authoritative/social domain that ALSO appears in the
// shared DOMAIN_REGISTRY stays in sync via this seed reference (no runtime
// effect — keeps the lists discoverable for future maintainers).
void DOMAIN_REGISTRY;

/** Lexicon signalling a factual / finance / research query → strong down-rank
 *  of social+PR and a boost for authoritative sources. */
const FACTUAL_LEXICON: readonly string[] = [
  "earnings",
  "revenue",
  "sec",
  "10-k",
  "10k",
  "filing",
  "filings",
  "study",
  "studies",
  "research",
  "clinical",
  "trial",
  "gdp",
  "market cap",
  "stock",
  "stocks",
  "shares",
  "dividend",
  "dividends",
  "quarterly",
  "balance sheet",
];

/** Lexicon signalling a social / navigational query → social sources are the
 *  intended target, so they must NOT be penalized. */
const SOCIAL_LEXICON: readonly string[] = [
  "twitter",
  "tweet",
  "tweets",
  "reddit",
  "subreddit",
  "linkedin",
  "instagram",
  "tiktok",
  "facebook",
  "thread",
  "threads",
  "profile",
];

/**
 * Detect the dominant intent of a query.
 *  - social wins when an explicit social/navigational term is present
 *    (e.g. "linkedin profile", "reddit thread") so we never penalize the
 *    results the user is literally asking for.
 *  - factual when a finance/research lexicon term is present.
 *  - default otherwise (mild adjustment only).
 */
export function detectIntent(query: string | undefined): SearchIntent {
  if (!query) return "default";
  const lower = query.toLowerCase();

  // NOV-578: bound the lexicon scan. Single-word terms (the vast majority) are matched
  // against a tokenized Set — an O(1) whole-word lookup with NO substring scan, so
  // punctuation-trimmed tokens like "stock?"/"earnings." still match while in-word
  // substrings ("profile" in "userprofile", "pe" in "tape") never can. Multi-word phrases
  // ("market cap", "balance sheet") can't be a single token, so they fall back to a
  // space-anchored `.includes` over the padded query (NOV-574's word-boundary guard).
  const tokens = new Set(
    lower.split(/\s+/).map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")).filter(Boolean),
  );
  const padded = ` ${lower} `;
  const lexiconHit = (lex: readonly string[]): boolean =>
    lex.some((t) => (t.includes(" ") ? padded.includes(` ${t} `) : tokens.has(t)));

  // social wins so we never penalize the results the user literally asked for.
  if (lexiconHit(SOCIAL_LEXICON)) return "social";
  if (lexiconHit(FACTUAL_LEXICON)) return "factual";

  return "default";
}

/** Extract a lowercase registrable host from a result URL/link. */
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  let raw = url.trim();
  if (!raw) return null;
  // Tolerate bare hosts ("reuters.com/...") that aren't valid URL() inputs.
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Does `host` equal `domain` or end with `.domain`? */
function hostMatches(host: string, domain: string): boolean {
  if (domain.startsWith(".")) {
    // TLD-group suffix (e.g. ".gov", ".edu") — match host ending in that group.
    return host === domain.slice(1) || host.endsWith(domain);
  }
  return host === domain || host.endsWith(`.${domain}`);
}

/** Classify a URL's domain authority tier. Unknown/invalid → "neutral". */
export function classifyAuthority(url: string | undefined): AuthorityTier {
  const host = hostOf(url);
  if (!host) return "neutral";
  // Authoritative takes precedence (e.g. a .gov host is never "social").
  if (AUTHORITATIVE_DOMAINS.some((d) => hostMatches(host, d))) return "authoritative";
  if (SOCIAL_PR_DOMAINS.some((d) => hostMatches(host, d))) return "social";
  return "neutral";
}

/** True when the URL's host is a social/PR domain (for hard-drop filtering). */
export function isSocialOrPr(url: string | undefined): boolean {
  return classifyAuthority(url) === "social";
}

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
export function authorityAdjustment(
  url: string | undefined,
  intent: SearchIntent
): number {
  if (intent === "social") return 0;
  const tier = classifyAuthority(url);
  if (tier === "neutral") return 0;

  if (intent === "factual") {
    return tier === "authoritative" ? 1.0 : -1.5;
  }
  // default: mild
  return tier === "authoritative" ? 0.5 : -0.5;
}
