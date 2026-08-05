/** Normalize a URL for deduplication: strip trailing slash, www, fragment, sort params */
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