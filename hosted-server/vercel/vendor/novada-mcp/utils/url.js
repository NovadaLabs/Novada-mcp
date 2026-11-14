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
export function normalizeUrl(urlStr) {
    try {
        const u = new URL(urlStr);
        u.hash = "";
        u.hostname = u.hostname.replace(/^www\./, "");
        u.pathname = u.pathname.replace(/\/+$/, "") || "/";
        u.searchParams.sort();
        return u.toString();
    }
    catch {
        return urlStr;
    }
}
// ─── Result-dedup-only noise params (research-query-quality-2026-11-14) ────
// Source URLs in a SEARCH RESULT LIST are often otherwise identical except
// for a locale/tracking param the publisher's CMS stamps per-request (e.g. a
// Facebook Answers article served at the same path under ?locale=pa_IN /
// pt_BR / tr_TR). Left in, two requests for the SAME article count as two
// separate sources — the bug reported 2026-11-14 (three locale-wrapped copies
// of one facebook.com/fb-answers/... article counted as three sources).
//
// This is deliberately a SEPARATE function from `normalizeUrl` above (review
// round 2, HIGH #1): collapsing a locale duplicate is correct for research's
// already-fetched result list, but wrong as the crawl/map/site_copy
// TRAVERSAL key, where it would cause a real, not-yet-visited page to be
// silently treated as already seen. Table-driven (class, not instance) so
// adding a new noise param is a new row here, never a new branch at the call
// site. Exact names cover one-off known noise keys; prefixes cover whole
// families (utm_source, utm_medium, …).
// "tl" added 2026-11-14 review round 2: live-reproduced during re-verification
// — reddit.com serves the SAME thread under ?tl=ru / ?tl=de / ?tl=el
// (translate-locale) redirects, which collapsed the research.ts dedup bug
// this table exists to fix, just under a different param name than "locale".
const NOISE_PARAM_EXACT = new Set([
    "locale", "hl", "lang", "tl", "fbclid", "gclid", "msclkid", "ref", "ref_src",
    "igshid", "mc_cid", "mc_eid", "_ga", "si",
]);
const NOISE_PARAM_PREFIXES = ["utm_"];
/** True when `paramName` is a known non-content (locale/tracking) query param
 *  that should be stripped before RESULT-LIST dedup — never a meaningful
 *  content param like `id`, `q`, or `page` on an unrelated host, and never
 *  applied to the crawl/map/site_copy traversal key (see `normalizeUrl`). */
function isNoiseParam(paramName) {
    const lower = paramName.toLowerCase();
    if (NOISE_PARAM_EXACT.has(lower))
        return true;
    return NOISE_PARAM_PREFIXES.some((p) => lower.startsWith(p));
}
/** Normalize a URL for RESEARCH RESULT-LIST dedup only: everything
 *  `normalizeUrl` does, PLUS stripping known non-content (locale/tracking)
 *  params. Do not use this as a crawl/map/site_copy traversal key — use
 *  `normalizeUrl` there. */
export function normalizeUrlForResultDedup(urlStr) {
    try {
        const u = new URL(normalizeUrl(urlStr));
        // Snapshot keys before deleting — deleting while iterating a live
        // URLSearchParams iterator can skip entries.
        for (const key of [...new Set(u.searchParams.keys())]) {
            if (isNoiseParam(key))
                u.searchParams.delete(key);
        }
        u.searchParams.sort();
        return u.toString();
    }
    catch {
        return normalizeUrl(urlStr);
    }
}
// ─── Bing redirect decoding ─────────────────────────────────────────────────
// Bing wraps every SERP result href in a `bing.com/ck/a?...&u=<encoded>` (or the
// sibling `r.bing.com`) tracking redirect before it ever reaches an MCP caller.
// Left undecoded, novada_search / novada_research hand the agent a tracking
// link it then has to base64-decode by hand to find the real page — the tool
// should do that itself (agent-first: the tool does the work, never the
// downstream agent — 2026-07-30 field feedback on novada_research).
//
// Shape (verified against this repo's own pre-existing decoder in
// src/tools/search.ts, `unwrapBingUrl` — itself flagged in a prior code review
// at docs/review/2026-04-29/report-code-quality.md:114 as real production
// logic missing a decoded-URL validation step, which this rewrite adds; no raw
// captured live Bing HTML/JSON sample was found elsewhere in the repo, so the
// "a1" prefix / `u` param assumption rests on that pre-existing implementation
// plus synthetic fixtures built by encoding known URLs into the shape below —
// not an independently re-verified live capture):
//   https://www.bing.com/ck/a?...&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbQ%3D%3D
// The `u` (or, on the sibling redirect host, `r`) query param carries the real
// URL, base64url-encoded and prefixed with a literal "a1".
/** Is `hostname` bing.com or a bing.com subdomain (www., r., cn., ...)?
 *  Hostname-exact / suffix check — NOT a substring match on the full URL — so
 *  a spoofed host like "evilbing.com" (which contains the raw substring
 *  "bing.com" and would have passed the old `url.includes("bing.com/...")`
 *  gate) is correctly rejected. Strips a trailing FQDN dot first (`bing.com.`
 *  is a DNS-valid variant of `bing.com` — reviewer-flagged 2026-07-30 gap:
 *  without this, that variant fell through undecoded, silently regressing
 *  back to the exact bug this function fixes). */
function isBingHost(hostname) {
    const h = hostname.toLowerCase().replace(/\.$/, "");
    return h === "bing.com" || h.endsWith(".bing.com");
}
/** True when `candidate` parses as an absolute http(s) URL. Closes the gap
 *  flagged in docs/review/2026-04-29/report-code-quality.md:114 — the old
 *  decoder accepted anything starting with the string "http", which would
 *  also match a crafted non-URL string; parsing with `new URL()` and checking
 *  the protocol is the fix that review recommended. */
function isHttpUrl(candidate) {
    try {
        const u = new URL(candidate);
        return u.protocol === "http:" || u.protocol === "https:";
    }
    catch {
        return false;
    }
}
// Sanity cap on any single param/candidate string this module will run a
// regex + decode against. Reviewer-flagged 2026-07-30: these strings
// ultimately originate from an upstream SERP response (Bing), not a raw MCP
// caller, but the codebase's own posture ("MCP params = untrusted") argues
// for a cheap bound anyway rather than trusting upstream size implicitly. A
// real encoded URL is at most a few hundred chars; this is generous headroom.
const MAX_REDIRECT_PARAM_LENGTH = 4096;
/** Base64url-decode, tolerating the URL-safe alphabet (-/_) and missing
 *  padding. Returns null (never throws) on anything that isn't valid base64
 *  or exceeds the sanity length cap. */
function base64UrlDecodePermissive(input) {
    if (!input || input.length > MAX_REDIRECT_PARAM_LENGTH)
        return null;
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    // Reject anything that isn't plausible base64 before handing it to Buffer —
    // Node's base64 decoder silently ignores out-of-alphabet characters rather
    // than throwing, which would otherwise let garbage through as "decoded".
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded))
        return null;
    try {
        return Buffer.from(padded, "base64").toString("utf8");
    }
    catch {
        return null;
    }
}
/** Try to decode one Bing redirect param value ("a1"-prefix stripped, then
 *  base64url, falling back to percent-decoding) into a valid http(s) URL.
 *  Returns null (never throws) if the value doesn't yield one. */
function decodeRedirectParamValue(value) {
    if (value.length > MAX_REDIRECT_PARAM_LENGTH)
        return null;
    const stripped = value.replace(/^a1/, "");
    const decoded = base64UrlDecodePermissive(stripped);
    if (decoded && isHttpUrl(decoded))
        return decoded;
    // Some Bing redirect variants percent-encode the target directly instead
    // of base64-encoding it (or the value is already an unencoded absolute URL,
    // in which case decodeURIComponent is a harmless no-op).
    try {
        const percentDecoded = decodeURIComponent(stripped);
        if (isHttpUrl(percentDecoded))
            return percentDecoded;
    }
    catch { /* not percent-encoded either */ }
    return null;
}
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
export function decodeBingRedirect(url) {
    try {
        const parsed = new URL(url);
        if (isBingHost(parsed.hostname)) {
            for (const param of ["u", "r"]) {
                const wrapped = parsed.searchParams.get(param);
                if (!wrapped)
                    continue;
                const decoded = decodeRedirectParamValue(wrapped);
                if (decoded)
                    return decoded;
            }
            return url; // bing host, but no param decoded to a valid URL — unchanged
        }
    }
    catch { /* not a parseable absolute URL — fall through to the legacy check */ }
    // Legacy fallback (behavior parity with the pre-existing search.ts decoder):
    // a bare, schemeless string that is itself base64 and decodes to an http(s)
    // URL. Not bing-specific, but kept here so both call sites (search.ts,
    // research.ts) get one shared, tested implementation instead of duplicating it.
    if (!url.startsWith("http") && /^[A-Za-z0-9+/=]+$/.test(url) && url.length > 20) {
        const decoded = base64UrlDecodePermissive(url);
        if (decoded && isHttpUrl(decoded))
            return decoded;
    }
    return url;
}
const ASSET_EXTENSIONS = new Set([
    "css", "js", "png", "jpg", "jpeg", "gif", "svg", "ico", "woff", "woff2",
    "ttf", "eot", "map", "xml", "rss", "atom", "json",
]);
const BOILERPLATE_HOSTS = [
    "fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net",
    "cdnjs.cloudflare.com", "unpkg.com", "ajax.googleapis.com",
    "github.githubassets.com", "avatars.githubusercontent.com",
    "collector.github.com", "api.github.com",
    "googletagmanager.com", "google-analytics.com", "facebook.com",
    "twitter.com", "linkedin.com",
];
const SKIP_PATHS = ["/login", "/signup", "/auth", "/oauth", "/settings"];
/** Filter out boilerplate links (assets, tracking, auth, etc.) */
export function isContentLink(href) {
    try {
        const u = new URL(href);
        const ext = u.pathname.split(".").pop()?.toLowerCase() || "";
        if (ASSET_EXTENSIONS.has(ext))
            return false;
        if (BOILERPLATE_HOSTS.some((h) => u.hostname.includes(h)))
            return false;
        if (SKIP_PATHS.some((p) => u.pathname.startsWith(p)))
            return false;
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=url.js.map