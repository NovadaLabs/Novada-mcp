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

import axios from "axios";
import { TIMEOUTS } from "../config.js";
import { isUrlSafe } from "./ssrf.js";
import { safeLookup } from "./ssrf.js";

/** Google hosts whose `/goto` and `/url` paths are click-tracking redirects.
 *  We only ever construct requests to these hosts ourselves (see module doc) —
 *  never fetch a host read from upstream data. */
const GOOGLE_REDIRECT_HOSTS = new Set(["google.com", "www.google.com"]);

function isGoogleRedirectHost(hostname: string): boolean {
  return GOOGLE_REDIRECT_HOSTS.has(hostname.toLowerCase().replace(/\.$/, ""));
}

// Real tokens observed live are 60-230 chars. Generous cap to reject pathological input
// cheaply before it ever reaches a regex or an outbound request (MCP params = untrusted;
// these strings originate from the upstream scraper, not a raw caller, but the same
// posture applies defensively).
const MAX_TOKEN_LENGTH = 4096;

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
export function extractGoogleRedirectToken(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_TOKEN_LENGTH * 2) return null;

  let pathAndQuery: string | null = null;
  if (raw.startsWith("/goto?") || raw.startsWith("/url?")) {
    pathAndQuery = raw;
  } else if (/^https?:\/\//i.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    if (!isGoogleRedirectHost(parsed.hostname)) return null;
    if (parsed.pathname !== "/goto" && parsed.pathname !== "/url") return null;
    pathAndQuery = parsed.pathname + parsed.search;
  }
  if (pathAndQuery === null) return null;

  const m = /[?&]url=([^&]+)/.exec(pathAndQuery);
  if (!m) return null;
  const token = m[1];
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

/** True when `primary` (a record's link/url field) or the presence of a
 *  `redirectLink` indicates a Google click-tracking wrapper worth resolving.
 *  Cheap, synchronous, zero network cost — the fast no-op path for every
 *  record that ISN'T Google-wrapped (i.e. every other platform, and every
 *  Google result whose link is already a plain absolute URL). */
function isGoogleWrappedLink(primary: string, redirectLink: unknown): boolean {
  if (primary) {
    if (primary.startsWith("/goto?") || primary.startsWith("/url?")) return true;
    if (/^https?:\/\//i.test(primary)) {
      try {
        const u = new URL(primary);
        if (isGoogleRedirectHost(u.hostname) && (u.pathname === "/goto" || u.pathname === "/url")) return true;
      } catch { /* not a parseable absolute URL — not a recognized wrapper shape */ }
    }
    return false;
  }
  // No link/url at all, but a redirect_link string is present — still worth a look.
  return typeof redirectLink === "string" && redirectLink.length > 0;
}

export interface ResolveOptions {
  /** Per-request axios timeout. Defaults to TIMEOUTS.GOOGLE_REDIRECT_RESOLVE. */
  timeoutMs?: number;
  /** Absolute Date.now()-style deadline for the WHOLE batch — once passed, remaining
   *  unresolved items are treated as unresolvable (dropped) rather than launching a
   *  new request. Defaults to no deadline (bounded only by timeoutMs per request and
   *  MAX_ITEMS_TO_RESOLVE below). */
  deadlineMs?: number;
}

const DEFAULT_RESOLVE_TIMEOUT_MS = TIMEOUTS.GOOGLE_REDIRECT_RESOLVE;

// Per-process cache: the same token can repeat within one batch (duplicate SERP
// entries) or across calls in the same search-cache TTL window. Small, TTL'd,
// capped — mirrors the style of search.ts's own `_searchCache`.
const RESOLVE_CACHE_TTL_MS = 10 * 60_000;
const RESOLVE_CACHE_MAX = 500;
const _resolveCache = new Map<string, { value: string | null; ts: number }>();

function cacheGet(token: string): string | null | undefined {
  const hit = _resolveCache.get(token);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > RESOLVE_CACHE_TTL_MS) {
    _resolveCache.delete(token);
    return undefined;
  }
  return hit.value;
}

function cacheSet(token: string, value: string | null): void {
  _resolveCache.set(token, { value, ts: Date.now() });
  if (_resolveCache.size > RESOLVE_CACHE_MAX) {
    const oldestKey = [..._resolveCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]?.[0];
    if (oldestKey !== undefined) _resolveCache.delete(oldestKey);
  }
}

/**
 * Resolve a single Google redirect TOKEN to its real destination by requesting
 * Google's own `/goto?url=TOKEN` endpoint (see module doc — NOT `/url`, which
 * does not return a Location header) and reading the 302 `Location`. Never
 * throws: returns null on timeout, non-3xx, a missing/unsafe Location, or a
 * Location that is itself another Google redirect host (loop guard).
 */
export async function resolveGoogleRedirectToken(token: string, opts: ResolveOptions = {}): Promise<string | null> {
  const cached = cacheGet(token);
  if (cached !== undefined) return cached;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS;
  let result: string | null = null;
  try {
    const resp = await axios.get(`https://www.google.com/goto?url=${token}`, {
      timeout: timeoutMs,
      maxRedirects: 0,
      validateStatus: () => true,
      maxContentLength: 8192, // a 302's body is a few hundred bytes; never pull a real page here
      maxBodyLength: 8192,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      // DNS-rebinding guard, consistent with every other fetch entry point in this
      // codebase (utils/http.ts) — defense in depth even though the host is a
      // hardcoded literal, never resolved from untrusted input.
      lookup: safeLookup as never,
    });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers?.location;
      if (typeof loc === "string" && isUrlSafe(loc)) {
        let host = "";
        try {
          host = new URL(loc).hostname;
        } catch {
          host = "";
        }
        if (host && !isGoogleRedirectHost(host)) {
          result = loc;
        }
      }
    }
  } catch {
    result = null;
  }
  cacheSet(token, result);
  return result;
}

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
export async function resolveSerpLink(candidate: SerpLinkCandidate, opts: ResolveOptions = {}): Promise<string | null> {
  const link = typeof candidate.link === "string" ? candidate.link : undefined;
  const url = typeof candidate.url === "string" ? candidate.url : undefined;
  const redirectLink = typeof candidate.redirect_link === "string" ? candidate.redirect_link : undefined;

  // (a) fast path — zero network calls.
  for (const primary of [url, link]) {
    if (!primary || !/^https?:\/\//i.test(primary)) continue;
    try {
      const host = new URL(primary).hostname;
      if (!isGoogleRedirectHost(host)) return primary;
    } catch { /* not a valid absolute URL — fall through to (c) */ }
  }

  // (c) — try whichever field actually carries a token, in order of proximity
  // to what the agent would otherwise have seen.
  for (const field of [link, url, redirectLink]) {
    if (!field) continue;
    const token = extractGoogleRedirectToken(field);
    if (!token) continue;
    const resolved = await resolveGoogleRedirectToken(token, opts);
    if (resolved) return resolved;
  }

  return null; // (d)
}

// Bounded work per call: real Google SERPs return single-digit-to-low-tens of
// organic results per page even when `num`/`limit` asks for more, so this cap
// is headroom, not a typical ceiling. Any item beyond it that IS goto-shaped is
// treated as unresolved (dropped) rather than launching unbounded network work.
const MAX_ITEMS_TO_RESOLVE = 60;
const DEFAULT_CONCURRENCY = 10;

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
export async function resolveGoogleLinksInPlace<T extends SerpLinkCandidate>(
  items: readonly T[],
  opts: ResolveOptions = {},
): Promise<{ kept: T[]; dropped: number }> {
  const results: Array<T | null> = new Array(items.length).fill(null);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      const item = items[i];
      const primary = (typeof item.url === "string" && item.url) || (typeof item.link === "string" && item.link) || "";

      if (!isGoogleWrappedLink(primary, item.redirect_link)) {
        results[i] = item; // zero-cost pass-through — same reference, nothing rewritten
        continue;
      }
      if (i >= MAX_ITEMS_TO_RESOLVE || (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs)) {
        results[i] = null; // bounded-work cutoff — treated as unresolved, dropped
        continue;
      }

      const resolved = await resolveSerpLink(item, opts);
      if (!resolved) {
        results[i] = null;
        continue;
      }
      const patched = { ...item } as Record<string, unknown>;
      if ("link" in patched) patched.link = resolved;
      if ("url" in patched) patched.url = resolved;
      results[i] = patched as T;
    }
  }

  const workerCount = Math.min(DEFAULT_CONCURRENCY, items.length);
  if (workerCount > 0) {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  const kept: T[] = [];
  let dropped = 0;
  for (const r of results) {
    if (r) kept.push(r);
    else dropped++;
  }
  return { kept, dropped };
}
