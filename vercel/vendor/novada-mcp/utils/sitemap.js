import { fetchViaProxy } from "./http.js";
import { TIMEOUTS } from "../config.js";
/**
 * Same-host test: a discovered sitemap URL must belong to the base host (or a
 * subdomain of it). This is BOTH a relevance filter (a sitemap should only list its
 * own site's URLs) AND an SSRF guard for discovery channels — an attacker-influenced
 * robots.txt/sitemap could otherwise declare `<loc>http://169.254.169.254/…</loc>`
 * and we would fetch it. We refuse cross-host candidates BEFORE issuing any request.
 */
function isSameSite(candidate, baseHostname) {
    try {
        const h = new URL(candidate).hostname.replace(/^www\./, "");
        return h === baseHostname || h.endsWith(`.${baseHostname}`);
    }
    catch {
        return false;
    }
}
/**
 * Extract <loc> URLs from a sitemap XML string into `out`, capped at `max`.
 * Only http(s) URLs on the same host as `baseHostname` are kept. Mutates `out` in place.
 */
export function extractSitemapUrls(xml, out, max, baseHostname) {
    const matches = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gs)];
    for (const m of matches) {
        if (out.length >= max)
            break;
        const u = m[1].trim();
        if (u.startsWith("http") && isSameSite(u, baseHostname))
            out.push(u);
    }
}
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
export async function discoverViaSitemap(origin, apiKey, maxUrls) {
    const urls = [];
    // Base host for the same-site SSRF/relevance filter applied to every discovered URL.
    let baseHostname;
    try {
        baseHostname = new URL(origin).hostname.replace(/^www\./, "");
    }
    catch {
        return urls; // malformed origin — nothing safe to discover
    }
    // Find sitemap URL — check robots.txt first, then common paths
    const sitemapCandidates = [];
    try {
        const robotsResp = await fetchViaProxy(`${origin}/robots.txt`, apiKey, { timeout: TIMEOUTS.SITEMAP });
        if (typeof robotsResp.data === "string") {
            const sitemapMatches = robotsResp.data.match(/^Sitemap:\s*(.+)$/gim);
            if (sitemapMatches) {
                for (const m of sitemapMatches) {
                    const u = m.replace(/^Sitemap:\s*/i, "").trim();
                    // SSRF guard: a robots.txt Sitemap: line can declare ANY URL — only follow
                    // same-site declarations, never an attacker-pointed metadata/internal host.
                    if (u.startsWith("http") && isSameSite(u, baseHostname))
                        sitemapCandidates.unshift(u); // prefer robots.txt sitemap
                }
            }
        }
    }
    catch { /* robots.txt not available */ }
    // Fallback candidates
    sitemapCandidates.push(`${origin}/sitemap.xml`);
    sitemapCandidates.push(`${origin}/sitemap_index.xml`);
    for (const sitemapUrl of sitemapCandidates.slice(0, 3)) {
        if (urls.length >= maxUrls)
            break;
        try {
            const resp = await fetchViaProxy(sitemapUrl, apiKey, { timeout: TIMEOUTS.CRAWL_STATIC });
            if (typeof resp.data !== "string")
                continue;
            const xml = resp.data;
            if (!xml.includes("<urlset") && !xml.includes("<sitemapindex"))
                continue;
            // Sitemap index → recurse into child sitemaps
            if (xml.includes("<sitemapindex")) {
                // SSRF guard: a <sitemapindex> can list child <loc> sitemaps on ANY host —
                // only fetch same-site children, never an attacker-pointed internal URL.
                const childSitemaps = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gs)]
                    .map(m => m[1].trim())
                    .filter(u => u.startsWith("http") && isSameSite(u, baseHostname));
                // Fetch ALL child sitemaps up to a safety cap of 50 (SSRF is already guarded
                // above by the isSameSite filter — only same-host children are fetched).
                // Old cap of 5 silently discarded most children on large sites.
                for (const childUrl of childSitemaps.slice(0, 50)) {
                    if (urls.length >= maxUrls)
                        break;
                    try {
                        const childResp = await fetchViaProxy(childUrl, apiKey, { timeout: TIMEOUTS.SITEMAP });
                        if (typeof childResp.data === "string") {
                            extractSitemapUrls(childResp.data, urls, maxUrls, baseHostname);
                        }
                    }
                    catch { /* skip */ }
                }
            }
            else {
                extractSitemapUrls(xml, urls, maxUrls, baseHostname);
            }
            if (urls.length > 0)
                break; // found sitemap, no need to try more
        }
        catch { /* not found */ }
    }
    return urls;
}
//# sourceMappingURL=sitemap.js.map