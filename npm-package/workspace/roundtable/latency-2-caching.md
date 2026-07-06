# Agent 2 — Caching Specialist: Search Cache Analysis

## 1. Does novadaSearch use the session cache?

No. `novadaSearch` in `src/tools/search.ts` makes zero imports from `src/_core/session-cache.ts`.
The cache module exports `getCached` / `setCached` and is used exclusively by `novadaExtract`.

Why it was skipped: The session cache was purpose-built for extract (URL → rendered page content),
where the same URL genuinely recurs within a research loop. Search was added later and its
result type — a list of ranked URLs with snippets — was treated as inherently ephemeral.

What it would take to add it:

```
import { getCached, setCached } from "../_core/session-cache.js";
```

Then wrap the scraper call with a cache-key lookup before dispatching and a set-call after.
The cache API is a plain Map with TTL; no structural changes needed. The only decision is
key design and TTL (see sections 2–3 below).

---

## 2. Correct cache key for search

The effective query sent to the scraper already encodes domain filters as `site:` modifiers
(lines 304–316 in search.ts). That means the `effectiveQuery` string captures include/exclude
domain intent. The remaining axes that produce different result sets:

| Dimension | Include in key? | Reason |
|---|---|---|
| `effectiveQuery` | YES | core differentiator |
| `engine` | YES | google vs duckduckgo return different SERP |
| `num` | YES | requesting 5 vs 20 results is a different call |
| `country` | YES | geo changes results meaningfully |
| `language` | YES | same query, different language = different results |
| `time_range` / `start_date` / `end_date` | YES | temporal filter changes result set |
| `format` (json vs markdown) | NO | format is post-processing; cache the raw results, render on read |
| `extract_options` / `enrich_top` | NO | extraction is a downstream step; cache search separately |
| `apiKey` | YES (implicitly) | different accounts may hit different SERP quotas; safest to scope per-key |

Recommended key function:

```typescript
function searchCacheKey(params: SearchParams, apiKey: string, effectiveQuery: string): string {
  const parts = [
    effectiveQuery,
    params.engine ?? "google",
    String(params.num ?? 10),
    params.country ?? "",
    params.language ?? "",
    params.time_range ?? "",
    params.start_date ?? "",
    params.end_date ?? "",
    apiKey.slice(-8), // last 8 chars — identifies account without exposing key
  ];
  return `search::${parts.join("|")}`;
}
```

Canonicalize by lowercasing `effectiveQuery` to avoid `"React" vs "react"` misses.

---

## 3. TTL by query type

Search results have wildly different freshness requirements depending on query intent:

| Query type | Example | Staleness threshold | Recommended TTL |
|---|---|---|---|
| Breaking news / live events | "earthquake 2026" | minutes | 2–5 min |
| Current pricing / stock | "NVDA stock price" | minutes | 2–5 min |
| Software docs / APIs | "react useState hook" | hours–days | 30–60 min |
| Research / academic | "transformer attention paper" | days–weeks | 4–8 hours |
| Company info / about pages | "what is Stripe" | days | 2–4 hours |
| Historical facts | "when was WWII" | permanent | 24 hours |

For a general-purpose MCP tool where query intent is unknown at cache-write time:

- **Session cache (in-process):** 5 min TTL — matches the existing extract cache; good enough
  to deduplicate agent loops that call the same search twice within a planning cycle.
- **Disk cache:** 30 min TTL as default, with a `time_range` hint: if the query has
  `time_range="day"` or explicit recent dates, use 5 min; otherwise 30 min.
- **Cloud cache:** Categorize queries: if query contains date terms, news terms, or
  price/stock terms → 5 min; otherwise → 60 min.

The current extract cache uses a uniform 5 min TTL. For search, 5 min is appropriate
as the session-level default because it covers the agent research loop without serving
stale news.

---

## 4. Cache hit rate estimate for persistent cross-session cache

For an AI agent doing research, query repetition patterns:

- **Within a single research task (same session):** an agent commonly searches the same
  query 2–4 times as it re-reads context or retries after tool errors. Hit rate within
  session: ~40–60%.

- **Across sessions (persistent cache):** repetition depends on the domain:
  - Agents using novada_search for recurring monitoring tasks (e.g., "latest AI funding news")
    would re-issue nearly identical queries daily → 70–80% hit rate on a 1-hour disk cache.
  - One-off research queries are rarely re-issued verbatim across sessions → ~5–15% hit rate.
  - Agents doing multi-step research often issue related but not identical queries
    ("React hooks tutorial" then "React useState examples") → low cross-query hit rate.

- **Weighted estimate for a typical AI agent workload:**
  - 60% of calls are one-off queries: ~10% cross-session hit rate.
  - 30% are recurring monitoring queries: ~75% hit rate on 30-min disk cache.
  - 10% are exact repeats within a loop: ~90% hit rate.
  - Blended: **~30% cross-session hit rate** with a 30-min persistent disk cache.
  - With a 24-hour cache for non-time-sensitive queries: ~45%.

The high-leverage case is recurring agent tasks (cron-style monitoring), where caching
effectively eliminates redundant SERP cost entirely.

---

## 5. 3-tier cache design

### Tier 1 — In-memory session (existing Map)

Already exists in `session-cache.ts` but not wired to search.

- **Storage:** `Map<string, CacheEntry>` in process memory
- **TTL:** 5 min
- **Hit latency:** ~0.01 ms (Map lookup)
- **Miss behavior:** fall through to Tier 2
- **Implementation complexity:** LOW — reuse `getCached`/`setCached` as-is, just add imports and two lines in `novadaSearch`
- **Eviction:** lazy (prune on size > 100), already implemented

### Tier 2 — SQLite disk cache

- **Storage:** `~/.novada-mcp/search-cache.db`, single table: `(key TEXT PRIMARY KEY, result TEXT, ts INTEGER)`
- **TTL:** 30 min default, 5 min for time-sensitive queries
- **Hit latency:** ~1–5 ms (file I/O, warm page cache)
- **Miss behavior:** fall through to live API, write-back to SQLite and Tier 1
- **Implementation complexity:** MEDIUM
  - Add `better-sqlite3` dependency
  - Write 40–60 lines: open-or-create db, `get`, `set`, lazy eviction
  - Handle first-run (no file), WAL mode for concurrent access
  - Must run eviction on startup to avoid unbounded growth
- **Benefit:** survives process restart; persistent across agent sessions within a day

### Tier 3 — Redis cloud cache

- **Storage:** Redis key-value, key = search cache key, value = JSON result string
- **TTL:** set via Redis EXPIRE, vary by query type (5 min to 24 hours)
- **Hit latency:** ~5–20 ms (network round-trip)
- **Miss behavior:** fall through to live API, write-back to all tiers
- **Implementation complexity:** HIGH
  - Add `ioredis` or `@upstash/redis` dependency
  - Need a Redis instance (Upstash is serverless/free tier, easiest)
  - Config: `NOVADA_REDIS_URL` env var; graceful degradation if absent
  - Connection pooling, error handling, serialization
  - Shared across all users — must include account identifier in key to prevent cross-tenant leakage
  - ~100–150 lines including connection management and fallback
- **Benefit:** shared cache across multiple MCP processes, multiple machines, multiple users

### Tier interaction (lookup order)

```
request → Tier1 hit? → return
        → Tier2 hit? → backfill Tier1 → return
        → Tier3 hit? → backfill Tier1+Tier2 → return
        → live API   → write all three → return
```

---

## 6. Latency reduction from caching

Current measured baseline: first call ~1915 ms end-to-end.

The dominant cost is the scraper API round-trip plus polling:
- `submitSearchScrapeTask`: ~200–400 ms
- `pollSearchResult`: the 2s sleep + N polls = 2000–8000 ms
- Bing path (`submitBingSearch`): up to 3 × (submit + poll) = potentially 6000+ ms

Cache hit latencies:

| Tier | Hit latency | Reduction vs 1915 ms baseline |
|---|---|---|
| Tier 1 (Map) | ~0.01 ms | 99.999% reduction |
| Tier 2 (SQLite) | ~1–5 ms | 99.7% reduction |
| Tier 3 (Redis) | ~10–30 ms | 98.4% reduction |

Even at the worst case (Redis at 30 ms), caching delivers a 64× speedup vs the median
1915 ms. For Bing with retries at 6000+ ms, the improvement is 200×+.

The impact is most visible in agent research loops where the same search fires 2–3 times.
Session caching converts the 2nd+ call from ~2 seconds to ~0.01 ms — effectively zero.

---

## 7. Concrete implementation: session-level caching for novadaSearch

The exact lines to add. Insert three blocks into `src/tools/search.ts`:

**Block A — Add import at top of file (after existing imports, line 8):**

```typescript
import { getCached, setCached } from "../_core/session-cache.js";
```

**Block B — Build cache key and check before scraper call (insert after `effectiveQuery` is finalized, before the `try` block at line 318):**

```typescript
  const cacheKeyStr = `search::${effectiveQuery.toLowerCase()}|${engine}|${params.num ?? 10}|${params.country ?? ""}|${params.time_range ?? ""}`;
  const cached = getCached(cacheKeyStr, "search");
  if (cached !== null) return cached;
```

**Block C — Write result to cache before the final return (insert before `return lines.join("\n")` at line 507, and similarly wrap the JSON branch):**

```typescript
  const output = lines.join("\n");
  setCached(cacheKeyStr, "search", output);
  return output;
```

All 10 lines together (the complete diff):

```typescript
// Line A: new import
import { getCached, setCached } from "../_core/session-cache.js";

// Lines B: after effectiveQuery is built (line ~316), before try block
const cacheKeyStr = `search::${effectiveQuery.toLowerCase()}|${engine}|${params.num ?? 10}|${params.country ?? ""}|${params.time_range ?? ""}`;
const cached = getCached(cacheKeyStr, "search");
if (cached !== null) return cached;

// Lines C1: wrap markdown output path (replace bare return)
const output = lines.join("\n");
setCached(cacheKeyStr, "search", output);
return output;

// Lines C2: wrap JSON output path (replace bare return JSON.stringify)
const jsonOutput = JSON.stringify(jsonResult, null, 2);
setCached(cacheKeyStr, "search", jsonOutput);
return jsonOutput;
```

`getCached` / `setCached` accept a `renderMode` string as 2nd argument — passing `"search"`
repurposes the existing signature without any changes to the cache module itself. The key
is namespaced with `search::` to avoid any collision with extract keys.

The TTL is inherited from the cache module's 5-minute constant — appropriate for session scope.
A follow-up would be to expose TTL as a parameter on `setCached` so search can use a
query-type-aware TTL when Tier 2/3 caching is added.

---

## Summary

novadaSearch has no caching today. Adding session-level caching requires 10 lines, reuses
the existing cache module without modification, and delivers near-zero latency on repeated
queries within an agent loop. The right cache key is `effectiveQuery + engine + num + country
+ time_range`. TTL of 5 min is appropriate for session scope. A persistent cross-session
cache (SQLite) would yield ~30% hit rate for typical agent workloads and is medium-effort
to implement. The primary latency win is on the poll-heavy scraper path where a cache hit
converts a 2–6 second wait into a sub-millisecond Map lookup.
