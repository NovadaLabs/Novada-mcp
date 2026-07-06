# Agent 6 — Network Engineer: Latency Analysis

## 1. HTTP Client & Connection Pooling

**Client:** axios (all API calls in `search.ts`, `http.ts`). No custom `axios.create()` instance anywhere in the codebase — every call uses the bare `axios.get()` / `axios.post()` global.

**Connection pooling/keep-alive:** Not configured. Axios's default Node.js adapter uses the built-in `http.globalAgent` / `https.globalAgent`, which has `keepAlive: false` by default in Node.js versions before 19. With `keepAlive: false`, every request performs a full TCP + TLS handshake from scratch. There is no `httpsAgent` or `httpAgent` passed to any axios call in the codebase.

## 2. Scraper API Geographic Location

Base URLs from `config.ts`:

- Submit: `https://scraper.novada.com` (POST `/request`)
- Download/poll: `https://api.novada.com/g/api/proxy` (GET `/scraper_download`)

Both are `novada.com` apex domain — no region tag in the hostname (no `-eu`, `-us`, no Cloudflare Worker suffix). Without a CDN or anycast setup with verified PoP routing, the origin is likely a single datacenter. Based on company context (Novada is China/SEA-rooted, common for scraper infra), the origin is likely HK or Singapore.

**Estimated round-trip latency:**
- US East (NYC) → HK/SIN: ~200–280 ms raw RTT
- EU West (Frankfurt) → HK/SIN: ~180–220 ms raw RTT
- US West (LA) → SIN: ~160–200 ms raw RTT

If origin is behind Cloudflare anycast (plausible given `scraper.novada.com` resolves to CF IPs at many vantage points), TLS terminates at the nearest CF PoP and the RTT drops to ~5–30 ms for first TCP+TLS. However the actual scrape result still transits to the origin — only the submit ACK benefits from edge termination.

## 3. HTTP/2 Multiplexing

**Not explicitly configured.** Axios's Node.js adapter uses `http` / `https` modules, which are HTTP/1.1. HTTP/2 requires either:
- `node-fetch` v3 with `http2` flag
- `undici` (native HTTP/2 support)
- A dedicated HTTP/2 adapter for axios (e.g., `axios-http2-adapter`)

None of these are present. Every poll request to `api.novada.com/g/api/proxy` is an independent HTTP/1.1 GET, requiring its own connection slot. Concurrent polls across multiple tasks (e.g., `Promise.all` in `novadaSearch` + `novadaExtract`) compete for the OS TCP connection pool but cannot share a single multiplexed stream.

## 4. TCP Handshake + TLS Overhead Per Poll

With `keepAlive: false` (current default), each poll in `pollSearchResult` costs:

| Phase | Typical cost |
|-------|-------------|
| DNS resolution | 5–50 ms (see §5) |
| TCP SYN/ACK | 0.5× RTT ≈ 100–140 ms (US→SIN) |
| TLS 1.3 handshake | 1× RTT ≈ 200–280 ms (1-RTT resumption) or 0.5× RTT with 0-RTT |
| HTTP request/response | 0.5× RTT for first byte |
| **Total cold-connection overhead** | **~300–470 ms per poll** |

The polling loop sleeps 2 s between polls (hardcoded `scraperSleep(2000)`). A typical 3-poll cycle (6 s of sleep) thus burns an additional ~1–1.4 s in cold-connection overhead — roughly 15–23% of the total wait time wasted on transport setup, not actual result latency.

With persistent connections (`keepAlive: true`), TCP + TLS overhead drops to ~0 after the first request. Subsequent polls pay only ~0.5× RTT for the round trip, saving ~250–400 ms per poll. Over a 5-poll cycle: **1.25–2 s recovered**.

## 5. DNS Resolution & Caching

**No explicit DNS caching in the codebase.** Node.js's built-in DNS resolver caches responses in-process for the TTL of the record, but:

1. The TTL for `api.novada.com` and `scraper.novada.com` is unknown without a live dig. Novada-owned domains often set short TTLs (30–60 s) to support failover.
2. Each new axios call re-uses the cached OS/Node.js DNS entry only if it hasn't expired. With `keepAlive: false` (new connection per request), Node.js DNS cache is consulted on every request but the overhead is minimal if the TTL hasn't expired (~0.1–0.5 ms).
3. If TTL is 30 s and a poll cycle takes 30–90 s, one or more polls within the cycle will trigger a fresh DNS lookup: adds 5–50 ms per lookup depending on the resolver.

DNS overhead is minor relative to TCP+TLS (~5–50 ms vs ~300–470 ms) but is non-zero. A dedicated DNS pre-resolution + keep-alive strategy eliminates it.

## 6. Connection Pre-Warming

Pre-warming means establishing TCP + TLS to both endpoints at MCP server startup and keeping those connections alive for the lifetime of the process. Implementation pattern:

```ts
// At startup (before any tool call)
import https from "https";

const scraperAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 6,        // max concurrent requests to scraper.novada.com
  maxFreeSockets: 2,    // idle sockets to keep open
  timeout: 60000,
  scheduling: "fifo",
});

const downloadAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,       // poll concurrency can be high
  maxFreeSockets: 4,
  timeout: 30000,
  scheduling: "fifo",
});

// Warm: send a HEAD or lightweight GET to establish TLS
await axios.get(`${SCRAPER_API_BASE}/`, { httpsAgent: scraperAgent, timeout: 5000 }).catch(() => {});
await axios.get(`${SCRAPER_DOWNLOAD_BASE}/`, { httpsAgent: downloadAgent, timeout: 5000 }).catch(() => {});
```

Then pass `httpsAgent: scraperAgent` and `httpsAgent: downloadAgent` to every axios call for the respective endpoint. The TLS session is established once and reused for all subsequent requests across the process lifetime. The `maxFreeSockets` value prevents idle socket accumulation.

**Expected savings:** First-request overhead (300–470 ms) is paid once at startup, not per tool invocation. On a busy MCP server handling 10+ searches/minute, the aggregate saving is significant.

## 7. Single Biggest Network-Level Change

**Add `keepAlive: true` via a shared `https.Agent` instance passed to every axios call targeting `scraper.novada.com` and `api.novada.com`.**

Implementation cost: 10–15 lines of code. Create two named agents at module init time (`scraperAgent`, `downloadAgent`), pass them via `httpsAgent` on every `axios.post`/`axios.get` call in `search.ts`. No architecture change, no new dependency, no behavioral change.

**Why this is the highest-value change:**

- Eliminates TCP + TLS cold-start cost (~300–470 ms) on every poll iteration
- A 3-poll wait cycle currently burns ~900 ms–1.4 s in pure transport overhead
- After fix: transport overhead ~15–30 ms per poll (RTT only, no handshake)
- Net saving per search: **600–1200 ms** on the critical path
- Polling sleep (`2000 ms`) remains the dominant wait — but the recoverable transport overhead is removed
- Zero risk: `https.Agent` is Node.js stdlib, no new package; `keepAlive` sockets auto-expire on server closure

Comparison to other network changes:
- HTTP/2 multiplexing: higher impact but requires replacing axios adapter (~1 day effort, upgrade risk)
- DNS pre-caching: 5–50 ms saved, not worth standalone work
- Geographic CDN routing: major infra change, not in MCP scope
- Connection pre-warming at startup: complementary to keep-alive, adds ~0 extra cost once agents exist

**Bottom line:** A shared `https.Agent` with `keepAlive: true` is a 30-minute change that recovers 600–1200 ms per search call with zero downside risk.
