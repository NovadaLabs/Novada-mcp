# Novada MCP — Gap Action Plan
**Date:** 2026-04-22  
**Based on:** evaluation-v2-2026-04-22.md  
**Goal:** Make every tool output optimal for agent consumption and competitive with Tavily/Firecrawl

---

## What "Optimal for Agent" Means

Before coding anything, we need a shared definition of what the agent actually needs from each MCP call:

1. **Complete enough to act on** — agent shouldn't need a second call to get the same data it already asked for. If a page has 4000 words of content, the agent should get 4000 words, not 2000 with a truncation notice.
2. **Failure is informative, not cryptic** — when something fails, the agent must know (a) what went wrong and (b) what to do next. "Novada API error (code 413)" is useless. "Google search failed — use `novada_research` instead or retry sequentially" is actionable.
3. **Structured metadata at the top** — agent reads the metadata line before the content. If the content is low quality (< 300 chars, blocked page), the agent should know immediately from the header, not after reading the whole response.
4. **Consistent structure across all tools** — agent builds a mental model of what to expect. All tools should follow: `## Header` → `metadata line` → `---` → `content` → `---` → `## Agent Hints`.
5. **Next-step guidance is mandatory** — the "Agent Hints" section is Novada's competitive differentiator. Every tool response must end with 2–4 actionable hints specific to what was just returned.

---

## Gap 1 — Search Engine Migration (CRITICAL, P0)

**Problem:** `scraperapi.novada.com/search` is broken for 4/5 engines (BUG-1 through BUG-5).  
**Solution:** Replace with `scraper.novada.com/request` (the dedicated Scraper API).

### What Exactly Changes

**File:** `src/tools/search.ts`  
**Config:** `src/config.ts` — add `SCRAPER_API_SEARCH = "https://scraper.novada.com/request"`  
**Auth:** Change from `api_key` query param to `Authorization: Bearer NOVADA_SCRAPER_KEY` header  
**Method:** Change from GET to POST with `application/x-www-form-urlencoded` body  

**Engine → scraper_id mapping:**
```
google    → scraper_name=google.com,  scraper_id=google_search
bing      → scraper_name=bing.com,    scraper_id=bing_search
duckduckgo→ scraper_name=duck.com,    scraper_id=duckduckgo_search
yahoo     → scraper_name=yahoo.com,   scraper_id=yahoo_search
yandex    → scraper_name=yandex.com,  scraper_id=yandex_search
```

**Request body params:**
```
scraper_name = <from mapping>
scraper_id   = <from mapping>
q            = params.query
device       = desktop
json         = 1
num          = params.num (1–20)
country      = params.country || "us"
language     = params.language || "en"
```

**Response format change:** Scraper API returns a different JSON shape. Need to read the actual response format when implementing (test with `curl` first).

**New env var needed:** `NOVADA_SCRAPER_KEY=1f35b477c9e1802778ec64aee2a6adfa`  
Add to `~/.claude.json` alongside `NOVADA_API_KEY` and `NOVADA_UNBLOCKER_KEY`.

**Error handling change:** New error codes from Scraper API — update `classifyError()` in `src/tools/types.ts` to handle them.

**Backward compat:** Keep `NOVADA_API_KEY` working as fallback — if `NOVADA_SCRAPER_KEY` not set, fall back to current `scraperapi.novada.com` with a warning in the error message.

---

## Gap 2 — `cleanParams()` Misses Nulls/Empty Arrays (HIGH, P1)

**Problem:** `cleanParams()` only strips empty strings. Null values and empty arrays pass through to the API and cause BUG-1 class errors (Yahoo 410, "empty query built").

**File:** `src/utils/index.ts` (wherever `cleanParams` is exported)  
**Change:** Extend the filter to also remove:
- `null`
- `undefined`  
- Empty arrays `[]`
- Arrays containing only empty strings `["", ""]`

**Exact change:**
```typescript
// BEFORE
export function cleanParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "")
  );
}

// AFTER
export function cleanParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => {
      if (v === null || v === undefined || v === "") return false;
      if (Array.isArray(v) && (v.length === 0 || v.every(i => i === ""))) return false;
      return true;
    })
  );
}
```

**Also update callers** — `search.ts`, `research.ts` use `cleanParams`. Since the return type is now `Record<string, unknown>`, callers that pass to `URLSearchParams` need to stringify values first.

---

## Gap 3 — Content Truncation Too Aggressive (MEDIUM, P1)

**Problem:** `extractMainContent()` truncates at ~2000 words (~10,000 chars). Firecrawl delivers full content. Agents making doc-extraction calls get incomplete data and need a second call.

**File:** `src/utils/content.ts` (or wherever `extractMainContent` lives)  
**Current limit:** Find `maxContentChars` or equivalent constant  
**New limit:** 30,000 chars (≈ 5000–6000 words) — matches typical agent context budget for a single page  

**Also add to metadata line:** Include `chars_available` vs `chars_returned` so the agent knows if truncation happened:
```
format: markdown | chars:12453 | truncated:false | links:32
```
vs:
```
format: markdown | chars:30000 | truncated:true (full:47210) | links:32
```

**When truncated:** Change Agent Hint from generic "content may be truncated" to: "Full page is 47,210 chars — use `novada_crawl` with `max_pages=1` to get complete content including JS-rendered sections."

---

## Gap 4 — Error Messages Are Not Actionable (MEDIUM, P1)

**Problem:** When tools fail, agents receive cryptic backend errors. They can't self-correct without trying random things.

**File:** `src/tools/types.ts` — `classifyError()` function  

**Current behavior:**
```
"Novada API error (code 413): Get html error: get response failed..."
"Error [API_DOWN]: Novada API is temporarily unavailable."
```

**Required behavior — each error must include WHAT + WHY + WHAT TO DO:**
```
"Google search temporarily unavailable (WorkerPool 413). 
 → Use novada_research for this query instead — it handles Google sequentially and won't hit this limit.
 → Or retry this call once (single sequential call works)."

"DuckDuckGo unavailable (API_DOWN). 
 → Switch engine: use engine='google' for the same query.
 → novada_research is a better choice for research questions."

"Yahoo search failed (empty query — backend bug). 
 → Switch to engine='google' or use novada_research."
```

**Implementation:** Add a `getActionableError(code, engine, context)` function that maps known error patterns to actionable messages. The last line of each error should always start with `→` to give the agent its next move.

---

## Gap 5 — Extract/Crawl: No Geo-Targeting (MEDIUM, P2)

**Problem:** Proxy IPs from EU pool cause Stripe (and possibly other sites) to return locale-specific content in wrong language with minimal content.

**File:** `src/utils/http.ts` — `fetchViaProxy()`  

**Change:** Add `country=us` as a default param for all `scraperapi.novada.com` requests:
```typescript
const proxyParams = new URLSearchParams({
  api_key: apiKey,
  url,
  render: "false",
  country: "us",  // ← add this
});
```

**Also expose as option:** Add optional `country?: string` to `ExtractParams` and `CrawlParams` so callers can override (e.g., "extract this French site with country=fr").

---

## Gap 6 — No Runtime Zod Validation (LOW, P2)

**Problem:** Bad input (malformed URL, invalid enum value) reaches the API and returns a cryptic backend error. Firecrawl catches these before the API call with clear messages.

**Files:** `src/tools/extract.ts`, `src/tools/crawl.ts`, `src/tools/search.ts`, `src/tools/map.ts`, `src/tools/research.ts`

**Change pattern — add at the top of each tool handler:**
```typescript
// In novadaExtract():
const parsed = ExtractParamsSchema.parse(params);
// ZodError thrown immediately with "Expected string URL, got undefined"

// In novadaSearch():
const parsed = SearchParamsSchema.parse(params);
```

**Why this helps:** ZodError messages are human-readable. "Expected valid URL format, received 'httpss://example.com'" is better than a 500 from the API.

**Note:** Zod schemas already exist in `src/tools/types.ts` — this is just calling `.parse()` at the start of each handler.

---

## Gap 7 — Async Crawl for Large Requests (LOW, P3)

**Problem:** `novada_crawl` with `max_pages=20` can run 60–90 seconds and hit MCP client timeout. Firecrawl returns a job ID immediately and provides a polling tool.

**Approach:** Only worth implementing if we see timeout failures in production. For now, add a **soft limit warning** instead:

**File:** `src/tools/crawl.ts`  
**Change:** If `max_pages > 10`, prepend a warning to the response:
```
⚠️ Large crawl (15 pages requested). This may take 60–90s. 
   For time-sensitive use, consider: novada_map → select specific URLs → novada_extract (batch).
```

**Defer** full async polling until we validate the use case in production.

---

---

## Gap 8 — Research Query Over-Generalization (MEDIUM, P1)

**Found in:** Round 3 R1 — "AI agents best practices in 2025" returned 11/15 sources from manufacturing/construction domain.

**Problem:** `generateSearchQueries()` in `src/tools/research.ts` extracts keywords by stripping stop words, then appends them to sub-query templates. Domain-ambiguous words ("production", "building", "platform") get used without their anchoring noun phrase, yielding coherently-phrased but topically-wrong sub-queries.

**Example of broken sub-queries generated:**
```
"best practices building production best practices real world"  ← "building production" = construction?
"best practices building production vs alternatives comparison"  ← same problem
```

**File:** `src/tools/research.ts` — `generateSearchQueries()`  
**Change:** Prefix all sub-queries with the first 3–4 significant words of the original question rather than extracted keyword fragments alone:

```typescript
// BEFORE — keyword-only sub-queries (ambiguous)
queries.push(`${keyPhrase} overview explained${focusSuffix}`);

// AFTER — anchored to original topic
const anchor = topic.split(/\s+/).slice(0, 5).join(" ");  // "best practices building production AI"
queries.push(`${anchor} overview explained${focusSuffix}`);
```

This keeps sub-queries topically grounded while still varying the angle (overview, comparison, challenges).

**Also consider:** If the first result batch has <30% keyword overlap with the original question, regenerate one broader query using the full question verbatim.

---

## Priority Implementation Order

| # | Gap | File(s) | Status | Impact |
|---|-----|---------|--------|--------|
| 1 | Search endpoint migration | `search.ts`, `config.ts` | 🔴 Blocked (Scraper API async) | Fixes 4/5 engines |
| 2 | `cleanParams()` null fix | `utils/params.ts` | ✅ Done (v0.7.x) | Prevents BUG-1 class |
| 3 | Content truncation increase | `utils/html.ts`, `extract.ts` | ✅ Done (v0.8.0) | Full-page extraction |
| 4 | Actionable error messages | `tools/types.ts`, `search.ts` | ✅ Done (v0.8.0) | Agent self-correction |
| 5 | Web Unblocker correct format | `utils/http.ts` | ✅ Done (v0.8.0) | Fixes Stripe German |
| 6 | Zod runtime validation | `index.ts` | ✅ Done (v0.7.x) | Clean error messages |
| 7 | Large crawl warning | `tools/crawl.ts` | ✅ Done (v0.8.0) | Avoids timeouts |
| 8 | Research query anchoring | `tools/research.ts` | 🟡 Next | Source quality |

**v0.8.0 requires session restart to activate.**
**Next:** Session restart → validate Stripe fix → implement Gap 8 (research query anchoring).

---

## What We Do NOT Need to Change

- **Tool descriptions** — already the best of the three MCPs ("Best for / Not for / Tip" format)
- **Agent Hints section** — competitive differentiator, keep as-is
- **Retry logic** — exponential backoff x3 is solid
- **Batch extract** — working correctly, no changes
- **Map output format** — clean and consistent

---

*Last updated: 2026-04-22 after Round 3 testing.*
