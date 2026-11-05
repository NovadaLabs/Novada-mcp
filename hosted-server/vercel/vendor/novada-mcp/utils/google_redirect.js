/**
 * Google SERP "goto" redirect resolver.
 *
 * Bug (reported 2026-11-04, affects ALL clients — blocked the OpenAI plugin
 * review): novada_search, novada_research, and novada_scrape_google can
 * return organic-result links as a Google relative click-tracking path —
 * `link: "/goto?url=CAESgwEB6zswFd2J..."` — instead of the real destination
 * URL. Reproduced live against production scraper.novada.com on 2026-11-04:
 * a 5-result google_search query returned 5/8 organic results in this shape.
 * Downstream this breaks `novada_research`'s extraction step, which calls
 * `novadaExtract({ url: source.url })` on the raw (unresolved) link —
 * "/goto?url=..." is not an absolute http(s) URL, so extraction fails for
 * every such source ("sources_extracted: 0 full + N snippet-only").
 *
 * Investigated resolution strategies, in the order the fix report requires:
 *
 *   (a) Prefer an already-absolute, non-Google link field — zero network cost.
 *       `organic_results[i].link` is sometimes already the real absolute URL
 *       (the upstream scraper does not wrap every result); use it as-is.
 *
 *   (b) Decode the opaque `url=` token locally, no network call. INVESTIGATED
 *       AND REJECTED: the token (e.g. "CAESgwEB6zswFd2J...") base64url-decodes
 *       to ~130 bytes of BINARY data whose first two bytes (0x08 0x01 0x12 ..)
 *       are a protobuf field tag/varint, not text, and the payload contains no
 *       ASCII substring resembling a URL. This is Google's opaque, session-
 *       scoped click-tracking token (the same shape used by its `/url?...&url=`
 *       anti-scraping redirect introduced to replace the old plaintext
 *       `url=https://...` scheme) — it cannot be decoded without Google's own
 *       backend. Confirmed by decoding 16 live-captured tokens; none contained
 *       a recoverable URL. Always falls through to (c).
 *
 *   (c) Resolve via a bounded request to Google's OWN `/goto` endpoint.
 *       LIVE-VERIFIED 2026-11-04 (16/16 tokens resolved, both from a
 *       residential IP and from the production EC2 host in Frankfurt —
 *       35.158.128.181 — the actual server IP this ships from):
 *       `GET https://www.google.com/goto?url=<token>` (no other query params
 *       needed) returns a plain HTTP 302 with `Location: <real destination>`
 *       — fast (~50-200ms), no CAPTCHA/consent interstitial observed at this
 *       call volume from either IP.
 *
 *   2026-11-04 FOLLOW-UP (same day, after sustained probing from one IP):
 *       at normal volume (c) above is reliable, but after ~40 manual probe
 *       requests within roughly an hour from ONE residential IP, Google
 *       started answering some `/goto` calls with HTTP 200 + a ~15KB
 *       "interstitial" HTML page (a client-side redirect with an additional
 *       delay) instead of a clean 302 — sometimes pointing at a SECOND
 *       `/goto?url=<token2>` rather than the real destination directly.
 *       Dropping every such result (the original fix) is SAFE but collapses
 *       result quality under sustained production traffic from the single
 *       EC2 IP this ships from (observed: 1 kept / 7 dropped in one run).
 *       Two additional fallback paths were added so "the /goto 302 degraded"
 *       is no longer synonymous with "unresolvable":
 *
 *   (c2) Parse the upstream scraper's OWN `redirect_link` shape. LIVE-CONFIRMED
 *        this endpoint returns HTTP 200 with a small HTML/JS page:
 *          <script>...var redirectUrl='<real URL>';google.navigateTo(...)...</script>
 *          <noscript><meta content="0;url=<real URL>" http-equiv="refresh"></noscript>
 *        `extractRedirectUrlFromHtml` parses either form (JS string literal or
 *        the `<meta refresh>` fallback — attribute-order-independent, since live
 *        output puts `content` BEFORE `http-equiv`), decoding HTML entities and
 *        the handful of JS string escapes Google is known to emit (`\/`, `\xNN`,
 *        `\uNNNN`), then re-validates the result exactly like a `/goto` Location
 *        (absolute http(s), not another Google redirect host, SSRF-safe).
 *
 *        2026-11-04 SECOND follow-up (live-probed while finishing this fix):
 *        a BARE `https://www.google.com/url?url=<token>` request (no other
 *        params) does NOT return the page above — it returns a GENERIC
 *        "Weiterleitungshinweis" ("redirect notice") warning page with no
 *        destination in it at all ("the page you visited is trying to
 *        redirect you to an invalid URL"). Google's `/url` endpoint only
 *        decodes the token server-side when the FULL original query string
 *        Google itself generated (`sa=t&source=web&rct=j&opi=...&url=<token>
 *        &ved=...&uoh=1`) is replayed — confirmed by bisecting which params
 *        matter live: `sa=t` alone bounces to a broken `/CAES...` path, and
 *        dropping just `opi`/`uoh` leaves `redirectUrl` as the RAW undecoded
 *        token. Rather than chase which exact subset is load-bearing (clearly
 *        undocumented, internal Google behavior that can change at any time),
 *        this resolver replays the upstream scraper's `redirect_link` query
 *        string VERBATIM (`extractGoogleRedirectQuery`). With no full query
 *        available it skips (c2) entirely — a bare `url=<token>` request is a
 *        wasted call, not a fallback. SSRF posture is unaffected — see below:
 *        the query is only accepted from a Google redirect host's `/url` path,
 *        must be plain opaque tracking params (charset- and length-checked),
 *        and is always spliced onto OUR OWN hardcoded
 *        `https://www.google.com/url`, never used to pick the fetch target.
 *
 *        2026-11-05 live finding (why (c2) now runs FIRST when available):
 *        for FRESH tokens from a just-scraped SERP, `/goto` answered 200 with
 *        Google's "Anfrage wird verifiziert" bot-check interstitial for 4/4
 *        tokens — even from an IP where an older token still got a clean 302
 *        — while replaying `redirect_link` against `/url` returned the real
 *        destination in `var redirectUrl` for 4/4. Trying (c2) first costs ONE
 *        request per result instead of two-to-three, and keeps load off the
 *        bot-check endpoint.
 *
 *   (c3) interstitial hop: when `/goto` itself answers 200 (the degraded case
 *        above) and its body embeds ANOTHER `/goto?url=<token2>` link (the
 *        "redirect to a redirect" shape observed live), follow that SECOND
 *        token through (c) exactly ONCE — no further recursion even if that
 *        second hop is itself a 200. This bounds total extra network cost to
 *        one additional request per token, never an unbounded chain. The live
 *        bot-check page embeds the continuation inside a JS string with the
 *        `=` escaped (`/goto?url\x3dCAES...`); following that token once was
 *        live-confirmed (2026-11-05) to return the clean 302, so the matcher
 *        accepts `=`, `\x3d` and `\u003d`.
 *
 *   (d) Still unresolvable after (c)/(c2)/(c3) → the result is RETAINED (never
 *       dropped outright — see 2026-11-04 follow-up decision below), with its
 *       `link`/`url` cleared to "" and `url_unavailable: true` set. The agent
 *       still sees the title/snippet (useful, honest content) but is never
 *       handed a relative or Google-redirect path as a url.
 *
 * SSRF posture: every outbound request always targets a HARDCODED host
 * (`https://www.google.com`) and HARDCODED path (`/goto` or `/url`) that this
 * module constructs itself — the upstream `link`/`redirect_link` strings are
 * NEVER used as a fetch target, only their opaque `url=` query VALUE (an inert
 * token, never parsed as a URL) is spliced into our own request. Any resolved
 * destination — a `Location` header, a `var redirectUrl=` JS literal, a
 * `<meta refresh>` target, or an interstitial-embedded `/goto` token — is
 * Google-controlled but still external input: it is re-validated with
 * `isUrlSafe` and rejected if it points back at a Google redirect host (loop
 * guard) before ever being returned to a caller.
 *
 * Retention policy (2026-11-04 follow-up, SOP item 3): dropping a result
 * outright on failure is SAFE (never leaks a bad link) but, under the
 * single-EC2-IP production topology, throws away content an agent could
 * still use (title + snippet) even without a fetchable url. Decided: KEEP
 * the result with `url`/`link` cleared and `url_unavailable: true` set,
 * rather than removing it from the list — "more useful, still honest".
 */
import axios from "axios";
import { TIMEOUTS } from "../config.js";
import { isUrlSafe } from "./ssrf.js";
import { safeLookup } from "./ssrf.js";
/** Google hosts whose `/goto` and `/url` paths are click-tracking redirects.
 *  We only ever construct requests to these hosts ourselves (see module doc) —
 *  never fetch a host read from upstream data. */
const GOOGLE_REDIRECT_HOSTS = new Set(["google.com", "www.google.com"]);
function isGoogleRedirectHost(hostname) {
    return GOOGLE_REDIRECT_HOSTS.has(hostname.toLowerCase().replace(/\.$/, ""));
}
// Real tokens observed live are 60-230 chars. Generous cap to reject pathological input
// cheaply before it ever reaches a regex or an outbound request (MCP params = untrusted;
// these strings originate from the upstream scraper, not a raw caller, but the same
// posture applies defensively).
const MAX_TOKEN_LENGTH = 4096;
// Live tokens are base64url ("CAESgwEB6zsw..."); allow percent-escapes and the
// other URL-unreserved characters, refuse anything else before it is spliced
// into a request.
const SAFE_TOKEN_RE = /^[A-Za-z0-9_.~%=-]+$/;
/**
 * Extract the raw (NOT percent-decoded) `url=` token from a Google redirect
 * link — relative (`/goto?url=TOKEN`, `/url?...&url=TOKEN&...`) or absolute
 * (`https://www.google.com/goto?url=TOKEN`, `.../url?...&url=TOKEN&...`).
 * Never decodes the token: Google expects it back byte-identical to how it
 * appeared in the href it rendered, and this module never needs to look
 * inside it. Returns null for anything that doesn't match this exact shape —
 * deliberately narrow so an unrelated `url=` query param on a non-Google link
 * is never mistaken for a redirect token.
 */
export function extractGoogleRedirectToken(raw) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_TOKEN_LENGTH * 2)
        return null;
    let pathAndQuery = null;
    if (raw.startsWith("/goto?") || raw.startsWith("/url?")) {
        pathAndQuery = raw;
    }
    else if (/^https?:\/\//i.test(raw)) {
        let parsed;
        try {
            parsed = new URL(raw);
        }
        catch {
            return null;
        }
        if (!isGoogleRedirectHost(parsed.hostname))
            return null;
        if (parsed.pathname !== "/goto" && parsed.pathname !== "/url")
            return null;
        pathAndQuery = parsed.pathname + parsed.search;
    }
    if (pathAndQuery === null)
        return null;
    const m = /[?&]url=([^&]+)/.exec(pathAndQuery);
    if (!m)
        return null;
    const token = m[1];
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH)
        return null;
    if (!SAFE_TOKEN_RE.test(token))
        return null;
    return token;
}
// A live upstream `redirect_link` query (sa, source, rct, opi, url, ved, usg)
// is a few hundred bytes; generous cap, still far below anything pathological.
const MAX_REDIRECT_QUERY_LENGTH = 4096;
// Google's tracking params are opaque ints/base64url hashes. Anything outside
// this charset is refused rather than forwarded.
const SAFE_REDIRECT_QUERY_RE = /^[A-Za-z0-9._~%&=+-]+$/;
/**
 * Return the FULL query string of a Google `/url?...` redirect link (relative,
 * or absolute on a Google redirect host) so (c2) can replay it verbatim — see
 * the module doc for why the bare `url=<token>` form does not work. Returns
 * null unless the link is exactly that shape, carries a `url=` token, and its
 * query is plain opaque tracking params within the length cap. Never returns
 * a host or path: the caller always splices the result onto its own hardcoded
 * `https://www.google.com/url?`.
 */
export function extractGoogleRedirectQuery(raw) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_REDIRECT_QUERY_LENGTH * 2)
        return null;
    let query;
    if (raw.startsWith("/url?")) {
        query = raw.slice("/url?".length).split("#")[0];
    }
    else if (/^https?:\/\//i.test(raw)) {
        let parsed;
        try {
            parsed = new URL(raw);
        }
        catch {
            return null;
        }
        if (!isGoogleRedirectHost(parsed.hostname) || parsed.pathname !== "/url")
            return null;
        query = parsed.search.slice(1);
    }
    else {
        return null;
    }
    if (query.length === 0 || query.length > MAX_REDIRECT_QUERY_LENGTH)
        return null;
    if (!SAFE_REDIRECT_QUERY_RE.test(query))
        return null;
    if (extractGoogleRedirectToken(`/url?${query}`) === null)
        return null;
    return query;
}
/**
 * Best-effort extraction of a DIFFERENT embedded `/goto?url=<token>` reference
 * from an interstitial page body (see (c3) in the module doc) — the degraded
 * "/goto answers 200 with a page that itself points at another /goto" shape.
 * Deliberately narrow (bounded token length, must differ from the token we
 * just requested) so this never turns into an unbounded hop chain: the caller
 * follows at most ONE token returned by this function, never recurses into
 * parsing ITS body for a third.
 */
function extractEmbeddedGotoToken(html, excludeToken) {
    if (typeof html !== "string" || html.length === 0)
        return null;
    const re = /\/goto\?url(?:=|\\x3d|\\u003d)([^"'&<>\s\\]+)/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const token = m[1];
        if (token && token !== excludeToken && token.length > 0 && token.length <= MAX_TOKEN_LENGTH) {
            return token;
        }
    }
    return null;
}
/**
 * Undo the small set of JS-string and HTML-entity escaping Google is known to
 * apply to a URL embedded in `var redirectUrl='...'` or a `<meta refresh>`
 * `content` attribute. Never throws; a string with none of these escapes
 * passes through unchanged.
 */
function decodeEmbeddedUrl(raw) {
    let s = raw;
    s = s.replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
    s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
    s = s.replace(/\\\//g, "/");
    s = s
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, "\"")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
    return s.trim();
}
const REDIRECT_VAR_RE = /var\s+redirectUrl\s*=\s*(['"])([\s\S]*?)\1/;
const META_REFRESH_RE = /<meta[^>]+http-equiv=["']refresh["'][^>]*content=["'][^"']*?url=([^"']+)["']/i;
/**
 * Parse the destination URL out of Google's `/url?...&url=<token>` HTML+JS
 * page body — see (c2) in the module doc. Tries the `var redirectUrl=` JS
 * string literal first (present in every live-captured sample), falls back
 * to the `<noscript><meta http-equiv="refresh" ...></noscript>` form. Applies
 * the same validation as a `/goto` Location: must be absolute http(s), must
 * not be another Google redirect host (loop guard), must pass `isUrlSafe`.
 */
function extractRedirectUrlFromHtml(html) {
    if (typeof html !== "string" || html.length === 0)
        return null;
    let candidate = null;
    const varMatch = REDIRECT_VAR_RE.exec(html);
    if (varMatch)
        candidate = varMatch[2];
    if (!candidate) {
        const metaMatch = META_REFRESH_RE.exec(html);
        if (metaMatch)
            candidate = metaMatch[1];
    }
    if (!candidate)
        return null;
    return validateDestination(decodeEmbeddedUrl(candidate));
}
/** Shared validation for ANY candidate destination (a `/goto` Location, a
 *  parsed `/url` page target, or an interstitial hop's Location): must be an
 *  absolute http(s) URL, must not be another Google redirect host (loop
 *  guard), and must pass the codebase's standard SSRF guard. */
function validateDestination(candidate) {
    if (typeof candidate !== "string" || candidate.length === 0)
        return null;
    if (!/^https?:\/\//i.test(candidate))
        return null;
    if (!isUrlSafe(candidate))
        return null;
    let host = "";
    try {
        host = new URL(candidate).hostname;
    }
    catch {
        return null;
    }
    if (!host || isGoogleRedirectHost(host))
        return null;
    return candidate;
}
/** True when `primary` (a record's link/url field) or the presence of a
 *  `redirectLink` indicates a Google click-tracking wrapper worth resolving.
 *  Cheap, synchronous, zero network cost — the fast no-op path for every
 *  record that ISN'T Google-wrapped (i.e. every other platform, and every
 *  Google result whose link is already a plain absolute URL). */
function isGoogleWrappedLink(primary, redirectLink) {
    if (primary) {
        if (primary.startsWith("/goto?") || primary.startsWith("/url?"))
            return true;
        if (/^https?:\/\//i.test(primary)) {
            try {
                const u = new URL(primary);
                if (isGoogleRedirectHost(u.hostname) && (u.pathname === "/goto" || u.pathname === "/url"))
                    return true;
            }
            catch { /* not a parseable absolute URL — not a recognized wrapper shape */ }
        }
        return false;
    }
    // No link/url at all, but a redirect_link string is present — still worth a look.
    return typeof redirectLink === "string" && redirectLink.length > 0;
}
const DEFAULT_RESOLVE_TIMEOUT_MS = TIMEOUTS.GOOGLE_REDIRECT_RESOLVE;
// A /goto 302's body is a few hundred bytes; the /url and interstitial 200
// bodies observed live are up to ~15KB. Cap well above that so a legitimate
// body is never truncated, but far short of a real page (defense in depth —
// if Google ever served something unexpected at this literal, hardcoded path
// we still bound how much of it we download).
const MAX_RESOLVE_BODY_BYTES = 65536;
// Per-process cache: the same token can repeat within one batch (duplicate SERP
// entries) or across calls in the same search-cache TTL window. Small, TTL'd,
// capped — mirrors the style of search.ts's own `_searchCache`.
const RESOLVE_CACHE_TTL_MS = 10 * 60_000;
// A failed resolution is remembered only briefly, so a later call (e.g. the
// agent retrying after url_resolution_warning) actually tries again.
const RESOLVE_NEGATIVE_CACHE_TTL_MS = 60_000;
const RESOLVE_CACHE_MAX = 500;
const _resolveCache = new Map();
function cacheGet(token) {
    const hit = _resolveCache.get(token);
    if (!hit)
        return undefined;
    const ttl = hit.resolution.url === null ? RESOLVE_NEGATIVE_CACHE_TTL_MS : RESOLVE_CACHE_TTL_MS;
    if (Date.now() - hit.ts > ttl) {
        _resolveCache.delete(token);
        return undefined;
    }
    return hit.resolution;
}
function cacheSet(token, resolution) {
    _resolveCache.set(token, { resolution, ts: Date.now() });
    if (_resolveCache.size > RESOLVE_CACHE_MAX) {
        const oldestKey = [..._resolveCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]?.[0];
        if (oldestKey !== undefined)
            _resolveCache.delete(oldestKey);
    }
    return resolution;
}
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
/** ONE outbound GET to a hardcoded `https://www.google.com/{goto,url}?<query>` —
 *  `query` is either `url=<token>` or a vetted `extractGoogleRedirectQuery`
 *  result, never a host or path. See the module's SSRF posture doc comment.
 *  Never throws. */
async function fetchGoogleRedirectPath(path, query, timeoutMs) {
    try {
        const resp = await axios.get(`https://www.google.com/${path}?${query}`, {
            timeout: timeoutMs,
            maxRedirects: 0,
            validateStatus: () => true,
            maxContentLength: MAX_RESOLVE_BODY_BYTES,
            maxBodyLength: MAX_RESOLVE_BODY_BYTES,
            headers: { "User-Agent": USER_AGENT },
            // DNS-rebinding guard, consistent with every other fetch entry point in this
            // codebase (utils/http.ts) — defense in depth even though the host is a
            // hardcoded literal, never resolved from untrusted input.
            lookup: safeLookup,
        });
        return {
            status: resp.status,
            location: typeof resp.headers?.location === "string" ? resp.headers.location : undefined,
            body: typeof resp.data === "string" ? resp.data : "",
        };
    }
    catch {
        return null;
    }
}
/**
 * Resolve a single Google redirect TOKEN to its real destination, trying in
 * order: (c2) when the caller has the upstream `/url` query (`urlQuery`),
 * replay it against `/url` and parse the HTML/JS redirect page; (c) `/goto`
 * → 302 Location; (c3) if `/goto` instead answers 200 with an embedded SECOND
 * `/goto` token, follow that ONE extra hop. Never throws: returns `{ url:
 * null, via: null }` when every path fails (timeout, non-resolving status,
 * missing/unsafe destination, or a destination that is itself another Google
 * redirect host — loop guard).
 */
export async function resolveGoogleRedirectTokenDetailed(token, opts = {}, urlQuery = null) {
    const cached = cacheGet(token);
    if (cached !== undefined)
        return cached;
    const baseTimeoutMs = opts.timeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS;
    // Every request is clamped to whatever is left of opts.deadlineMs, so one
    // item can never carry the batch past its deadline. null = no budget left:
    // stop without caching (a deadline cut says nothing about the token).
    const legTimeout = () => {
        if (opts.deadlineMs === undefined)
            return baseTimeoutMs;
        const remaining = opts.deadlineMs - Date.now();
        return remaining > 0 ? Math.min(baseTimeoutMs, remaining) : null;
    };
    const OUT_OF_TIME = { url: null, via: null };
    // (c2) first when available — see the 2026-11-05 note in the module doc.
    if (urlQuery) {
        const timeoutMs = legTimeout();
        if (timeoutMs === null)
            return OUT_OF_TIME;
        const urlResp = await fetchGoogleRedirectPath("url", urlQuery, timeoutMs);
        if (urlResp && urlResp.body) {
            const dest = extractRedirectUrlFromHtml(urlResp.body);
            if (dest)
                return cacheSet(token, { url: dest, via: "url_page" });
        }
    }
    // (c) /goto. Tried regardless of why (c2) failed — it is an independent
    // Google endpoint carrying the same token, not a retry of the same request.
    const gotoTimeoutMs = legTimeout();
    if (gotoTimeoutMs === null)
        return OUT_OF_TIME;
    const gotoResp = await fetchGoogleRedirectPath("goto", `url=${token}`, gotoTimeoutMs);
    if (gotoResp) {
        if (gotoResp.status >= 300 && gotoResp.status < 400) {
            const dest = validateDestination(gotoResp.location);
            if (dest)
                return cacheSet(token, { url: dest, via: "goto" });
        }
        else if (gotoResp.status === 200 && gotoResp.body) {
            // (c3) degraded case: /goto answered with an interstitial page instead
            // of a clean 302. Look for exactly ONE embedded, DIFFERENT /goto token
            // and follow it once — never recurse into a second interstitial.
            const embeddedToken = extractEmbeddedGotoToken(gotoResp.body, token);
            const hopTimeoutMs = embeddedToken ? legTimeout() : null;
            if (embeddedToken && hopTimeoutMs === null)
                return OUT_OF_TIME;
            if (embeddedToken && hopTimeoutMs !== null) {
                const hopResp = await fetchGoogleRedirectPath("goto", `url=${embeddedToken}`, hopTimeoutMs);
                if (hopResp && hopResp.status >= 300 && hopResp.status < 400) {
                    const dest = validateDestination(hopResp.location);
                    if (dest)
                        return cacheSet(token, { url: dest, via: "interstitial_hop" });
                }
            }
        }
    }
    return cacheSet(token, { url: null, via: null });
}
/** Backward-compatible string-returning wrapper around
 *  `resolveGoogleRedirectTokenDetailed` — kept for any existing caller that
 *  only needs the destination, not which path produced it. */
export async function resolveGoogleRedirectToken(token, opts = {}) {
    return (await resolveGoogleRedirectTokenDetailed(token, opts)).url;
}
/**
 * Resolve the real destination URL for ONE SERP result item following the
 * preference order documented at the top of this module: (a) already-absolute
 * non-Google link → used as-is (via: "fast_path", zero network calls); (c)/
 * (c2)/(c3) resolve via Google's own endpoints; (d) unresolved (via: null —
 * the caller decides retention policy). (b) decode-without-network is not
 * implemented — investigated and rejected, see module doc.
 */
export async function resolveSerpLinkDetailed(candidate, opts = {}) {
    const link = typeof candidate.link === "string" ? candidate.link : undefined;
    const url = typeof candidate.url === "string" ? candidate.url : undefined;
    const redirectLink = typeof candidate.redirect_link === "string" ? candidate.redirect_link : undefined;
    // (a) fast path — zero network calls.
    for (const primary of [url, link]) {
        if (!primary || !/^https?:\/\//i.test(primary))
            continue;
        try {
            const host = new URL(primary).hostname;
            if (!isGoogleRedirectHost(host))
                return { url: primary, via: "fast_path" };
        }
        catch { /* not a valid absolute URL — fall through to (c) */ }
    }
    // (c2)'s replayable `/url` query, if any field carries one — upstream's
    // `redirect_link` is the usual source.
    let urlQuery = null;
    for (const field of [redirectLink, link, url]) {
        if (field && (urlQuery = extractGoogleRedirectQuery(field)) !== null)
            break;
    }
    // (c)/(c2)/(c3) — try each DISTINCT token, in order of proximity to what
    // the agent would otherwise have seen. The /url replay is attempted at most
    // once per result (with the first token), never once per field.
    const tokens = [];
    for (const field of [link, url, redirectLink]) {
        const token = field ? extractGoogleRedirectToken(field) : null;
        if (token && !tokens.includes(token))
            tokens.push(token);
    }
    for (const [i, token] of tokens.entries()) {
        const resolved = await resolveGoogleRedirectTokenDetailed(token, opts, i === 0 ? urlQuery : null);
        if (resolved.url)
            return resolved;
    }
    return { url: null, via: null }; // (d)
}
/** Backward-compatible string-returning wrapper — existing callers that only
 *  need the destination (not which path produced it) are unaffected. */
export async function resolveSerpLink(candidate, opts = {}) {
    return (await resolveSerpLinkDetailed(candidate, opts)).url;
}
// Bounded work per call: real Google SERPs return single-digit-to-low-tens of
// organic results per page even when `num`/`limit` asks for more, so this cap
// is headroom, not a typical ceiling. Any item beyond it that IS goto-shaped is
// treated as unresolved (retained, url cleared) rather than launching unbounded
// network work.
const MAX_ITEMS_TO_RESOLVE = 60;
const DEFAULT_CONCURRENCY = 10;
function emptyStats() {
    return { wrapped: 0, resolvedViaGoto: 0, resolvedViaInterstitialHop: 0, resolvedViaUrlPage: 0, unresolved: 0 };
}
/** Produce the RETAINED-BUT-UNRESOLVED shape for an item whose Google
 *  redirect could not be resolved by any path: clears `link`/`url` (so no
 *  relative or Google-redirect path can ever reach an agent) and sets
 *  `url_unavailable: true` so callers can render "title/snippet, no link"
 *  instead of silently treating it the same as a fully populated result. */
function markUnresolved(item) {
    const patched = sanitizeRecord(item);
    patched.link = "";
    patched.url = "";
    patched.url_unavailable = true;
    return patched;
}
/** A Google click-tracking wrapper: relative `/goto?`/`/url?`, or a Google
 *  redirect host's `/goto`/`/url`, carrying a `url=` token. */
function isGoogleRedirectString(value) {
    return typeof value === "string" && extractGoogleRedirectToken(value) !== null;
}
// Raw SERP records nest a few levels (key_moments[], sitelinks[], …); the cap
// only bounds pathological input.
const MAX_SANITIZE_DEPTH = 8;
/** Copy-on-write: `value` without any Google redirect wrapper found inside it
 *  (object properties removed, array elements filtered). The same reference
 *  when there is nothing to remove. */
function withoutNestedRedirects(value, depth) {
    if (depth > MAX_SANITIZE_DEPTH || value === null || typeof value !== "object")
        return value;
    if (Array.isArray(value)) {
        let changed = false;
        const out = [];
        for (const el of value) {
            if (isGoogleRedirectString(el)) {
                changed = true;
                continue;
            }
            const next = withoutNestedRedirects(el, depth + 1);
            if (next !== el)
                changed = true;
            out.push(next);
        }
        return changed ? out : value;
    }
    let out = null;
    for (const [key, v] of Object.entries(value)) {
        if (isGoogleRedirectString(v)) {
            out ??= { ...value };
            delete out[key];
            continue;
        }
        const next = withoutNestedRedirects(v, depth + 1);
        if (next !== v) {
            out ??= { ...value };
            out[key] = next;
        }
    }
    return out ?? value;
}
/**
 * `item` as it may leave this module: without its upstream `redirect_link`
 * (only used to feed (c2) above) and without any OTHER Google redirect
 * wrapper anywhere in the record — e.g. a video result's
 * `key_moments[].link` timestamps or a nested `source_info_link`
 * (live 2026-11-05, novada_scrape_google). Only the record's own top-level
 * `link`/`url` is resolved over the network; secondary links are removed
 * rather than resolved (one request each would multiply Google traffic and
 * throttle the primary links) and never returned as relative paths. The same
 * reference when there is nothing to remove.
 */
function sanitizeRecord(item) {
    let out = null;
    for (const [key, v] of Object.entries(item)) {
        if (key === "link" || key === "url")
            continue;
        if (key === "redirect_link" || isGoogleRedirectString(v)) {
            out ??= { ...item };
            delete out[key];
            continue;
        }
        const next = withoutNestedRedirects(v, 1);
        if (next !== v) {
            out ??= { ...item };
            out[key] = next;
        }
    }
    return (out ?? item);
}
/**
 * Resolve Google-wrapped links across a batch of SERP-shaped records.
 * Records whose link/url is already a plain absolute URL cost ZERO network
 * calls (checked synchronously before anything async happens) — this makes
 * the function safe to call unconditionally from every pipeline that can emit
 * Google-sourced links, including every other platform's scrape records
 * (class-not-instance: one shared function, not a per-platform branch).
 *
 * No returned record carries `redirect_link` or any other Google redirect
 * wrapper below its top-level link/url (see `sanitizeRecord`) — removed here
 * once for every caller (novada_search/research/verify/ai_monitor and
 * novada_scrape_google alike) rather than by each caller remembering to.
 *
 * 2026-11-04 follow-up: a record whose link/url could NOT be resolved
 * (timeout, Google 4xx/5xx/degraded-200, budget exhausted) is RETAINED — see
 * `markUnresolved` — never dropped from `kept` the way the original fix did.
 * `dropped` (kept for the existing field name callers already destructure)
 * now counts "needed the fallback and still failed", not "removed from the
 * list" — every input item has a corresponding output item in `kept`, same
 * length, same order. `stats` gives the per-path resolution breakdown.
 */
export async function resolveGoogleLinksInPlace(items, opts = {}) {
    const results = new Array(items.length);
    const stats = emptyStats();
    let cursor = 0;
    async function worker() {
        for (;;) {
            const i = cursor++;
            if (i >= items.length)
                return;
            const item = items[i];
            const primary = (typeof item.url === "string" && item.url) || (typeof item.link === "string" && item.link) || "";
            if (!isGoogleWrappedLink(primary, item.redirect_link)) {
                results[i] = sanitizeRecord(item); // zero network cost; same reference unless it carried a redirect_link
                continue;
            }
            stats.wrapped++;
            if (i >= MAX_ITEMS_TO_RESOLVE || (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs)) {
                stats.unresolved++;
                results[i] = markUnresolved(item); // bounded-work cutoff — retained, not dropped
                continue;
            }
            const resolved = await resolveSerpLinkDetailed(item, opts);
            if (!resolved.url) {
                stats.unresolved++;
                results[i] = markUnresolved(item);
                continue;
            }
            if (resolved.via === "goto")
                stats.resolvedViaGoto++;
            else if (resolved.via === "interstitial_hop")
                stats.resolvedViaInterstitialHop++;
            else if (resolved.via === "url_page")
                stats.resolvedViaUrlPage++;
            // "fast_path" resolutions never reach here (isGoogleWrappedLink already
            // filtered them out above as a zero-cost pass-through), so there is no
            // stats bucket for it in this batch-level counter.
            const patched = { ...sanitizeRecord(item) };
            if ("link" in patched)
                patched.link = resolved.url;
            if ("url" in patched)
                patched.url = resolved.url;
            results[i] = patched;
        }
    }
    const workerCount = Math.min(DEFAULT_CONCURRENCY, items.length);
    if (workerCount > 0) {
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }
    return { kept: results, dropped: stats.unresolved, stats };
}
//# sourceMappingURL=google_redirect.js.map