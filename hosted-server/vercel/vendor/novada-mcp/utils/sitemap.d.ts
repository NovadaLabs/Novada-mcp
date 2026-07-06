/**
 * Extract <loc> URLs from a sitemap XML string into `out`, capped at `max`.
 * Only http(s) URLs on the same host as `baseHostname` are kept. Mutates `out` in place.
 */
export declare function extractSitemapUrls(xml: string, out: string[], max: number, baseHostname: string): void;
/**
 * Attempt to discover URLs via sitemap.xml. Returns an empty array if not available.
 * Strategy:
 *   1. Read robots.txt and prefer any `Sitemap:` declarations found there.
 *   2. Fall back to /sitemap.xml and /sitemap_index.xml.
 *   3. Recurse one level into sitemap indexes — ALL children up to a safety cap of 50
 *      (previously limited to 5, which silently discarded most of large sites' sitemaps).
 *
 * Callers pass a generous over-fetch budget (e.g. caller_limit * 10) so that upstream
 * sub-path filtering still leaves enough URLs after scope reduction.
 *
 * Shared by novada_map and novada_site_copy so both use identical discovery logic.
 */
export declare function discoverViaSitemap(origin: string, apiKey: string | undefined, maxUrls: number): Promise<string[]>;
//# sourceMappingURL=sitemap.d.ts.map