/** Normalize a URL for deduplication: strip trailing slash, www, fragment, sort params */
export declare function normalizeUrl(urlStr: string): string;
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