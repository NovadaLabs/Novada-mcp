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
 *       IMPORTANT NUANCE: the sibling endpoint `/url?sa=...&url=<token>&ved=...`
 *       (the exact URL the upstream scraper surfaces as `redirect_link`) does
 *       NOT behave the same way — it returns HTTP 200 with a tiny HTML page
 *       that performs a client-side `location.replace(...)` (or, for
 *       non-JS clients, a `<meta http-equiv="refresh">`). There is no
 *       `Location` header on that endpoint. This resolver therefore always
 *       re-targets `/goto?url=<token>` (constructed by US, from the token —
 *       never fetches the host-bearing `redirect_link` string directly) to
 *       get a plain 302 we can read without parsing HTML.
 *
 *   (d) Unresolvable (timeout, non-3xx, missing/invalid Location, or Google's
 *       own "goto"/"url" redirect pointing back at itself) → return null. The
 *       caller drops the result — we never hand an agent a relative path.
 *
 * SSRF posture: the outbound request always targets a HARDCODED host
 * (`https://www.google.com`) that this module constructs itself — the upstream
 * `link`/`redirect_link` strings are NEVER used as a fetch target, only their
 * opaque `url=` query VALUE (an inert token, never parsed as a URL) is spliced
 * into our own request. The resolved `Location` (Google-controlled, but still
 * external input) is re-validated with `isUrlSafe` before being returned, and
 * rejected if it points back at a Google redirect host (loop guard).
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
export interface ResolveOptions {
    /** Per-request axios timeout. Defaults to TIMEOUTS.GOOGLE_REDIRECT_RESOLVE. */
    timeoutMs?: number;
    /** Absolute Date.now()-style deadline for the WHOLE batch — once passed, remaining
     *  unresolved items are treated as unresolvable (dropped) rather than launching a
     *  new request. Defaults to no deadline (bounded only by timeoutMs per request and
     *  MAX_ITEMS_TO_RESOLVE below). */
    deadlineMs?: number;
}
/**
 * Resolve a single Google redirect TOKEN to its real destination by requesting
 * Google's own `/goto?url=TOKEN` endpoint (see module doc — NOT `/url`, which
 * does not return a Location header) and reading the 302 `Location`. Never
 * throws: returns null on timeout, non-3xx, a missing/unsafe Location, or a
 * Location that is itself another Google redirect host (loop guard).
 */
export declare function resolveGoogleRedirectToken(token: string, opts?: ResolveOptions): Promise<string | null>;
export interface SerpLinkCandidate {
    link?: unknown;
    url?: unknown;
    redirect_link?: unknown;
}
/**
 * Resolve the real destination URL for ONE SERP result item following the
 * preference order documented at the top of this module: (a) already-absolute
 * non-Google link → used as-is; (c) resolve via Google's /goto; (d) null (the
 * caller drops the result). (b) decode-without-network is not implemented —
 * investigated and rejected, see module doc.
 */
export declare function resolveSerpLink(candidate: SerpLinkCandidate, opts?: ResolveOptions): Promise<string | null>;
/**
 * Resolve Google-wrapped links across a batch of SERP-shaped records.
 * Records whose link/url is already a plain absolute URL cost ZERO network
 * calls (checked synchronously before anything async happens) — this makes
 * the function a no-op for every non-Google-wrapped input, including every
 * other platform's scrape records, so it is safe to call unconditionally from
 * every pipeline that can emit Google-sourced links (class-not-instance: one
 * shared function, not a per-platform branch).
 *
 * A record whose link/url COULD NOT be resolved (timeout, Google 4xx/5xx,
 * budget exhausted) is DROPPED — never passed through with its original
 * relative/wrapped value. Returns the kept records (new objects only where a
 * link was actually rewritten — untouched records keep their original
 * reference) plus how many were dropped, so callers can surface the count.
 */
export declare function resolveGoogleLinksInPlace<T extends SerpLinkCandidate>(items: readonly T[], opts?: ResolveOptions): Promise<{
    kept: T[];
    dropped: number;
}>;
//# sourceMappingURL=google_redirect.d.ts.map