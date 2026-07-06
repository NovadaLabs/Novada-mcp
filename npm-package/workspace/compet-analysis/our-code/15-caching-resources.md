# 15 — Caching Strategies & MCP Resource Usage

**Date:** 2026-06-23
**Scope:** `src/_core/session-cache.ts`, `src/resources/index.ts`, `src/utils/http.ts`, `src/utils/credentials.ts`

---

## 1. What Does the Cache Actually Store?

There are three distinct caching/state-retention mechanisms across the codebase:

### 1a. `session-cache.ts` — Extract Result Cache (Primary)
- **What:** Full extracted page content (markdown or JSON string output) from `novada_extract`
- **Key:** `${url}::${renderMode}[::fields:f1,f2]` — fields are sorted before joining, so order doesn't matter
- **TTL:** 5 minutes (TTL_MS = 300,000ms)
- **Scope:** In-process, process-lifetime Map; resets on restart
- **Eviction:** Lazy — only scans when Map size exceeds 100 entries
- **Cache hits:** Injected as `source: cache` in the returned text so agents know the result is from cache, not live

### 1b. `credentials.ts` — Proxy Sub-Account Credential Cache
- **What:** `{ account, password }` fetched from `/v1/proxy_account/list` management API
- **Key:** Module-level singleton (`_credCache`)
- **TTL:** 6 hours (CACHE_TTL_MS = 21,600,000ms)
- **Scope:** Process-lifetime; not keyed by user/apiKey — single tenant assumption
- **Purpose:** Avoids repeated management API calls when auto-fetching proxy credentials

### 1c. `http.ts` — Proxy Circuit Breaker State
- **What:** Per-`${tier}:${endpoint}` availability booleans (`available: null | true | false`)
- **Key:** `${tier}:${endpoint}` (e.g. `residential:proxy.novada.com:7777`)
- **TTL:** 5 minutes auto-reset when `available === false` (PROXY_CIRCUIT_RESET_MS)
- **Scope:** Process-lifetime Map
- **Purpose:** Avoids burning 3-retry × exponential-backoff on a known-unavailable proxy

---

## 2. TTL Strategy Assessment

### Extract Cache (5 min) — Correct
5 minutes is appropriate for agent session deduplication. The goal is preventing duplicate API calls in a single research loop, not caching across sessions. Agents rarely need fresh data within a 5-minute window for the same URL. Longer TTLs would risk stale content for monitoring or news use cases.

### Credential Cache (6h) — Appropriate but has a blind spot
6 hours is reasonable for proxy sub-account credentials, which change infrequently. However: the cache is a module-level singleton with no key for `apiKey`. If two different API keys are used in the same process (e.g., via SDK's `withCredentials()`), the second key will get credentials fetched by the first. This is a latent multi-tenant bug.

**The `withCredentials()` / `AsyncLocalStorage` system exists for SDK multi-tenancy, but `_credCache` is a bare module global — these two designs conflict.**

### Circuit Breaker (5 min reset) — Correct
5-minute recovery window is a reasonable tradeoff between: not hammering a broken proxy on every request, but recovering from transient failures (network blip, momentary overload) without needing a server restart.

---

## 3. No Credential Caching in `session-cache.ts`

The session cache caches **results, not credentials**. This is the correct separation. Credentials live in `credentials.ts`. The session cache is purely about deduplicating API calls within an agent loop.

---

## 4. Connection Pooling Analysis

### Verdict: No explicit connection pooling configured

`fetchWithRetry()` calls `axios.get()` with no custom `httpAgent` or `httpsAgent`. This means:

- **On Node.js < 19:** Every request opens a new TCP/TLS connection. No keep-alive by default. This adds ~15–50ms per request for TLS handshake to `novada-api.com`, `webunlocker.novada.com`, etc.
- **On Node.js >= 19:** `http.globalAgent` has `keepAlive: true` by default, so connections ARE reused — but only via the global agent. No explicit pool sizing.

The SSL bypass path (`new https.Agent({ rejectUnauthorized: false })`) creates a new Agent per SSL-error request, which is fine since it's a rare fallback.

### `fetchWithRender` — Same issue
`axios.post()` to `webunlocker.novada.com` also has no custom agent. With 2–3 retries on intermittent failures (stated as ~30% failure rate), a persistent connection pool would reduce cold-start overhead per retry.

### Impact estimation
For `novada_extract` making calls to 3 different backends (static, render, browser), each with TLS:
- Without keep-alive: 3 × ~20ms TLS overhead = ~60ms per extract call
- With keep-alive agent: ~0ms after first call to same host
- Research says keep-alive can halve latency; for repeated extractions in a loop, the savings compound

### What's missing
```
// Not present anywhere in http.ts or the module:
import { Agent } from 'https';
const keepAliveAgent = new Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 10 });
```

No `httpAgent`/`httpsAgent` passed to axios calls. No `agentkeepalive` package in dependencies.

---

## 5. Caching Opportunities We're Missing

### 5a. Search Result Caching — Not Implemented
`novada_search` appends `no_cache: "false"` to the form (seen in search.ts:73, 141), delegating caching to the backend. But there's no client-side result cache. In a research loop where the same query is run twice (common in multi-agent scenarios), the full round-trip to the search backend happens both times.

**Opportunity:** Apply the same `session-cache` pattern to search results. Key = `query::engine::num[::country][::language]`. TTL = 2 minutes (search results are more time-sensitive than page content).

### 5b. Domain Routing Decision Cache — Not Implemented
`novada_extract` runs the `auto` → `static` → `render` escalation path on every call. Once we know `example.com` requires `render` mode (JS-heavy), the next call to `example.com/other-page` will still start from `static`, fail detection, and escalate again.

**Opportunity:** Cache the render-mode outcome per domain. Key = hostname only (not full URL). TTL = 30 minutes. A `Map<string, "static" | "render" | "browser">` in `session-cache.ts` would let subsequent calls to the same domain skip the JS-heavy detection step.

```
// Hypothetical: domain routing cache
const domainRouteCache = new Map<string, { mode: "static" | "render"; ts: number }>();
```

### 5c. Map Results — Not Implemented
`novada_map` fetches sitemaps or crawls BFS to discover URLs. In a research workflow, an agent might call `novada_map` then immediately call `novada_crawl` on the same domain. If `novada_map` was called minutes ago, the second call wastes time.

**Opportunity:** Cache map results (URL list per domain) for 10 minutes.

### 5d. Scraper Platform List — Hardcoded (Non-issue)
The scraper platform list in `novada://scraper-platforms` is hardcoded in `resources/index.ts`. This is actually the right choice for an MCP resource — it's static reference data that doesn't change without a release. No caching needed; it's always instant.

### 5e. Health Check Results — Not Implemented
`novada_health` makes API calls to check product activation status. These results don't change often (sub-accounts are provisioned, not toggled per-request). A 5-minute in-memory cache on health results would eliminate redundant status checks when agents call `novada_health` before each tool call.

---

## 6. MCP Resources Analysis

### What's Exposed (5 resources total)

| URI | Content | Value |
|-----|---------|-------|
| `novada://engines` | 5 search engines + use case recommendations | Medium — agents rarely need this before searching |
| `novada://countries` | 195 ISO country codes grouped by region | Low — agents already know country codes |
| `novada://guide` | Full decision tree + tool comparison table + workflow patterns + failure recovery | High — this is the most valuable resource |
| `novada://scraper-platforms` | 13 active platforms, operation IDs, params, NOT-AVAILABLE list | High — prevents halluciniated operation IDs |
| `novada://llms-txt` | Compact per-tool reference (60% shorter than guide) | High — best for context-constrained sessions |

### Quality Assessment

**Strengths:**
- `novada://scraper-platforms` directly addresses the #1 agent failure mode (inventing wrong operation IDs). It includes an explicit NOT-AVAILABLE list and error code interpretations.
- `novada://guide` has failure recovery patterns — this is rare in MCP servers and highly valuable.
- `novada://llms-txt` is a thoughtful optimization for token budget; most MCP servers don't have this.
- Resources are hardcoded (no DB/file reads), so access is always instant and zero-latency.

**Gaps:**

1. **No `novada://error-codes` resource.** Error codes like 11006, 11008 are mentioned in the scraper platforms doc but not in a dedicated error reference. Agents encountering these in other tools (crawl, extract, unblock) have to infer the meaning from tool descriptions.

2. **No `novada://proxy-types` resource.** With 6 proxy tools (residential/isp/mobile/datacenter/static/dedicated), agents frequently pick the wrong one. A resource comparing tier characteristics (IP pool size, geo coverage, anti-bot strength, use cases) would reduce misroutes.

3. **The country code list (`novada://countries`) is likely unused in practice.** Agents know ISO 2-letter codes. This resource consumes ~3KB but provides no differential value over agent training data. Could be replaced with something more useful (e.g., `novada://rate-limits`).

4. **`novada://scraper-platforms` claims 129 platforms** in the MCP tool description but the resource body says "Only these 13 platforms have active operations." This inconsistency will confuse agents — they read the tool description first, then the resource, and get contradictory numbers.

5. **No `novada://changelog` or version resource.** When agents read stale cached resources (MCP clients often cache resources for minutes), there's no way to know the platform list has been updated.

6. **Resources have no TTL metadata.** The MCP spec supports `ttlMs` and `cacheScope` fields on resource responses. Without them, MCP clients may aggressively cache or never cache. For `novada://scraper-platforms` (changes with product updates), a TTL of 1 hour would be appropriate.

---

## 7. Competitive Benchmark: Caching vs. Industry

| Feature | novada-mcp | firecrawl-mcp | brightdata-mcp |
|---------|-----------|---------------|----------------|
| Extract result cache | Yes (5 min, in-process) | No | No |
| Search result cache | No | No | N/A |
| Domain routing cache | No | No | No |
| Connection pool (keep-alive) | No explicit config | No explicit config | No explicit config |
| Credential cache | Yes (6h) | N/A | N/A |
| Circuit breaker | Yes (5 min) | No | No |
| MCP resources count | 5 | 0 | 0 |
| MCP resources with failure patterns | Yes | No | No |

novada-mcp is ahead on caching infrastructure and MCP resources vs. competitors. The main gaps are connection pooling and missing caches for search results and domain routing decisions.

---

## 8. Priority Recommendations

### P0 (High impact, low effort)
1. **Fix the scraper platform count inconsistency.** Tool description says "129 platforms", resource body says "13 active." Pick one accurate number. This is a trust issue with agents.

2. **Add `httpAgent`/`httpsAgent` with `keepAlive: true` to axios calls in `fetchWithRetry`.** One line per call. Node.js 19+ already does this via globalAgent, but explicit configuration ensures behavior doesn't depend on runtime version.

### P1 (Medium impact, medium effort)
3. **Domain routing cache** — prevents double-escalation on repeated calls to the same JS-heavy domain. Estimated 20–40ms savings per cache hit.

4. **Fix `_credCache` multi-tenancy bug** — key the cache by API key, not as a bare module singleton. Required before the SDK supports multiple simultaneous API keys.

### P2 (Lower urgency)
5. **Add `novada://proxy-types` resource** — reduces wrong proxy tier selection.

6. **Add TTL metadata to resources** — `ttlMs: 3600000` for scraper-platforms, `ttlMs: 86400000` for countries/engines.

7. **Search result cache** — only useful if agents hit the same query twice in a session, which is uncommon outside of multi-agent loops.

---

## Sources

- [MCP Caching: Resources Are For Caching](https://timkellogg.me/blog/2025/06/05/mcp-resources)
- [MCP Specification — Caching](https://modelcontextprotocol.io/specification/draft/server/utilities/caching)
- [Node.js Keep-Alive Trick That Halved Latency](https://medium.com/@bhagyarana80/the-node-js-keep-alive-trick-that-halved-latency-02264fc34bdf)
- [Connection Pooling with Axios and agentkeepalive](https://traveling-coderman.net/code/node-architecture/connection-pooling/)
- [MCP Advanced Caching Strategies](https://medium.com/@parichay2406/advanced-caching-strategies-for-mcp-servers-from-theory-to-production-1ff82a594177)
