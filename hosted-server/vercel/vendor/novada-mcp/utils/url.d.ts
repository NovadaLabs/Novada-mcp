/** Normalize a URL for deduplication: strip trailing slash, www, fragment, sort params.
 *
 * research-query-quality-2026-11-14 review round 2 (HIGH #1): this function is
 * also the TRAVERSAL key for crawl.ts/map.ts/site_copy.ts — it decides which
 * URLs have "already been visited" and therefore get skipped. It must stay
 * conservative here: many real sites serve genuinely different CONTENT under
 * a locale/language query param (translated docs pages, Google Support locale
 * variants), so stripping `lang`/`hl` globally would make `crawl`/`site_copy`
 * silently skip a real second-language page it hasn't actually visited yet —
 * under-coverage, the mirror-image failure of the over-counting bug this file
 * was originally changed to fix. See `normalizeUrlForResultDedup` below for
 * the noise-param-stripping variant, used ONLY by research.ts's post-hoc
 * result-list dedup (where collapsing a locale-duplicate source is correct). */
export declare function normalizeUrl(urlStr: string): string;
/** Normalize a URL for RESEARCH RESULT-LIST dedup only: everything
 *  `normalizeUrl` does, PLUS stripping known non-content (locale/tracking)
 *  params. Do not use this as a crawl/map/site_copy traversal key — use
 *  `normalizeUrl` there. */
export declare function normalizeUrlForResultDedup(urlStr: string): string;
/**
 * Decode a Bing SERP redirect URL into the real destination it wraps.
 *
 * FAIL-SAFE: any parse/decode failure, a non-bing.com host, a missing `u`/`r`
 * param, or a decoded value that isn't itself a valid http(s) URL all fall
 * back to returning `url` unchanged. This function never throws.
 *
 * `u` and `r` are tried in that order but NEITHER is trusted blindly — no live
 * Bing capture was available to confirm precedence when both are present
 * (reviewer-flagged 2026-07-30), so whichever param actually decodes to a
 * valid URL wins; a non-decodable `u` falls through to `r` instead of giving
 * up. When only one param is present this is equivalent to a straight lookup.
 */
export declare function decodeBingRedirect(url: string): string;
/** Filter out boilerplate links (assets, tracking, auth, etc.) */
export declare function isContentLink(href: string): boolean;
//# sourceMappingURL=url.d.ts.map