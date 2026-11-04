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
export declare function extractGoogleRedirectToken(raw: string): string | null;
/**
 * Return the FULL query string of a Google `/url?...` redirect link (relative,
 * or absolute on a Google redirect host) so (c2) can replay it verbatim — see
 * the module doc for why the bare `url=<token>` form does not work. Returns
 * null unless the link is exactly that shape, carries a `url=` token, and its
 * query is plain opaque tracking params within the length cap. Never returns
 * a host or path: the caller always splices the result onto its own hardcoded
 * `https://www.google.com/url?`.
 */
export declare function extractGoogleRedirectQuery(raw: string): string | null;
export interface ResolveOptions {
    /** Per-request axios timeout. Defaults to TIMEOUTS.GOOGLE_REDIRECT_RESOLVE. */
    timeoutMs?: number;
    /** Absolute Date.now()-style deadline for the WHOLE batch — once passed, remaining
     *  unresolved items are treated as unresolvable (retained, url cleared) rather than
     *  launching a new request. Defaults to no deadline (bounded only by timeoutMs per
     *  request and MAX_ITEMS_TO_RESOLVE below). */
    deadlineMs?: number;
}
/** Which resolution path actually produced the destination — used only for
 *  the resolution-rate metric in `resolveGoogleLinksInPlace`'s returned
 *  `stats` (SOP item 2's "helper/metric for resolved/total google-wrapped"). */
export type GoogleRedirectResolutionPath = "fast_path" | "goto" | "interstitial_hop" | "url_page";
export interface TokenResolution {
    url: string | null;
    via: Exclude<GoogleRedirectResolutionPath, "fast_path"> | null;
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
export declare function resolveGoogleRedirectTokenDetailed(token: string, opts?: ResolveOptions, urlQuery?: string | null): Promise<TokenResolution>;
/** Backward-compatible string-returning wrapper around
 *  `resolveGoogleRedirectTokenDetailed` — kept for any existing caller that
 *  only needs the destination, not which path produced it. */
export declare function resolveGoogleRedirectToken(token: string, opts?: ResolveOptions): Promise<string | null>;
export interface SerpLinkCandidate {
    link?: unknown;
    url?: unknown;
    redirect_link?: unknown;
}
export interface SerpLinkResolution {
    url: string | null;
    via: GoogleRedirectResolutionPath | null;
}
/**
 * Resolve the real destination URL for ONE SERP result item following the
 * preference order documented at the top of this module: (a) already-absolute
 * non-Google link → used as-is (via: "fast_path", zero network calls); (c)/
 * (c2)/(c3) resolve via Google's own endpoints; (d) unresolved (via: null —
 * the caller decides retention policy). (b) decode-without-network is not
 * implemented — investigated and rejected, see module doc.
 */
export declare function resolveSerpLinkDetailed(candidate: SerpLinkCandidate, opts?: ResolveOptions): Promise<SerpLinkResolution>;
/** Backward-compatible string-returning wrapper — existing callers that only
 *  need the destination (not which path produced it) are unaffected. */
export declare function resolveSerpLink(candidate: SerpLinkCandidate, opts?: ResolveOptions): Promise<string | null>;
export interface ResolveGoogleLinksStats {
    /** Items detected as a Google click-tracking wrapper (needed resolution at all). */
    wrapped: number;
    /** Resolved via the `/goto` 302 Location (the common, cheap case). */
    resolvedViaGoto: number;
    /** Resolved by following ONE extra hop out of a `/goto` interstitial page. */
    resolvedViaInterstitialHop: number;
    /** Resolved by parsing the `/url` HTML/JS redirect page. */
    resolvedViaUrlPage: number;
    /** Could not be resolved by ANY path — retained with url/link cleared, never dropped. */
    unresolved: number;
}
/**
 * Resolve Google-wrapped links across a batch of SERP-shaped records.
 * Records whose link/url is already a plain absolute URL cost ZERO network
 * calls (checked synchronously before anything async happens) — this makes
 * the function safe to call unconditionally from every pipeline that can emit
 * Google-sourced links, including every other platform's scrape records
 * (class-not-instance: one shared function, not a per-platform branch).
 *
 * No returned record carries `redirect_link`: it is a Google click-tracking
 * URL whose only use is the (c2) replay above, so it is removed here once for
 * every caller (novada_search/research/verify/ai_monitor and
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
export declare function resolveGoogleLinksInPlace<T extends SerpLinkCandidate>(items: readonly T[], opts?: ResolveOptions): Promise<{
    kept: T[];
    dropped: number;
    stats: ResolveGoogleLinksStats;
}>;
//# sourceMappingURL=google_redirect.d.ts.map