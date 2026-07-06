/**
 * NOV-330: session-level domain→fetch-mode routing memory.
 *
 * Within a single process, remember which fetch mode (static/render/browser) last
 * SUCCEEDED for a domain, so the next request to that domain can try the winning
 * mode first instead of re-running the static→render→browser escalation ladder.
 *
 * Scope is deliberately process-local (discarded on restart) — same rationale as
 * session-cache.ts. An agent in a research loop hits dozens of pages on the same
 * host; paying the full escalation cost once and remembering the answer for the
 * rest of the session is the whole win. It is NOT a persistent classifier and must
 * never override the static DOMAIN_REGISTRY (which is authoritative and hand-curated).
 *
 * Design constraints:
 *   - Bounded LRU (MAX_ENTRIES) so a long-lived server can't grow this map without bound.
 *   - TTL per entry: a site that flips from static to render (deploy, new WAF) must not
 *     be pinned to a stale mode forever. After TTL the memory is ignored + evicted.
 *   - Advisory only: callers READ a hint and may ignore it. Recording is best-effort.
 *
 * Only "real" successes are recorded. The transient "render-failed" pseudo-mode that
 * extract.ts uses is explicitly NOT a success and is rejected by recordRouteSuccess.
 */

/** Fetch modes that can be remembered. Mirrors the success modes in extract.ts. */
export type RouteMode = "static" | "render" | "browser";

const TTL_MS = 30 * 60 * 1000; // 30 min — longer than session-cache (content) TTL; routing is stabler than content.
const MAX_ENTRIES = 200;

interface RouteEntry {
  mode: RouteMode;
  ts: number;
}

/**
 * Insertion-ordered Map doubles as the LRU recency list: Map preserves insertion
 * order, so deleting + re-setting a key on every touch moves it to the tail (most
 * recent) and the head is always the least-recently-used candidate for eviction.
 */
const memory = new Map<string, RouteEntry>();

/**
 * Normalize a URL to its registrable-ish host key. Mirrors lookupDomain()'s
 * hostname handling (lowercase, strip leading `www.`) but stays self-contained so
 * this module has no dependency on the domain registry. Returns null for inputs
 * that don't parse as URLs (callers then skip routing memory entirely).
 *
 * Note: we key on the FULL hostname (minus www.), e.g. `docs.example.com`, not the
 * apex. Subdomains legitimately differ in rendering strategy (a marketing apex may
 * be static while `app.` is a browser-only SPA), so per-host keying is correct here.
 */
export function routeKey(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Return the remembered winning mode for this URL's host, or null if there's no
 * (live) memory. A stale (TTL-expired) entry is evicted and treated as a miss.
 * Touching a live entry refreshes its LRU recency (but NOT its TTL — age is from
 * the last recorded success, so a mode can't be kept alive forever by reads alone).
 */
export function getRouteHint(url: string): RouteMode | null {
  const key = routeKey(url);
  if (!key) return null;
  const entry = memory.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    memory.delete(key);
    return null;
  }
  // LRU touch: re-insert to move to tail. Preserve original ts so TTL keeps counting
  // from the last *success*, not from this read.
  memory.delete(key);
  memory.set(key, entry);
  return entry.mode;
}

/**
 * Record that `mode` successfully fetched this URL's host. Best-effort and silent:
 *   - Unparseable URLs are ignored.
 *   - Only static/render/browser are accepted; "render-failed" and any other
 *     non-success token is rejected (we must not pin a domain to a failure).
 * Evicts the least-recently-used entry when the map is full.
 */
export function recordRouteSuccess(url: string, mode: string): void {
  if (mode !== "static" && mode !== "render" && mode !== "browser") return;
  const key = routeKey(url);
  if (!key) return;

  // Re-set moves the key to the tail (most-recently-used).
  memory.delete(key);
  memory.set(key, { mode, ts: Date.now() });

  if (memory.size > MAX_ENTRIES) {
    // Map iteration is insertion order → first key is the LRU. Evict one.
    const lru = memory.keys().next().value;
    if (lru !== undefined) memory.delete(lru);
  }
}

/**
 * Clear all routing memory. Primarily for tests (vitest shares one process across
 * cases, so a recorded mode would leak between tests). Call in beforeEach.
 */
export function clearRouteMemory(): void {
  memory.clear();
}
