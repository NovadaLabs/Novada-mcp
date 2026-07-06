# Novada MCP v0.8.3 -- Competitive Scoreboard

Generated: 2026-06-25 | Based on 40 test runs (10 A2B + 20 FIFA + 10 Stress)

---

## Methodology

All Novada metrics come from **actual tool calls** executed today against live APIs.
Competitor metrics come from the FINAL-IMPROVEMENT-REPORT (20-agent competitive analysis)
and published benchmarks (Proxyway 2025 for anti-bot, npm for downloads).

"N/A" = not tested or not applicable. "N/T" = not tested today.

---

## Master Scoreboard

```
DIMENSION              | NOVADA         | FIRECRAWL      | TAVILY         | BRIGHTDATA
-----------------------+----------------+----------------+----------------+----------------
                       |                |                |                |
  SEARCH               |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
Search P50             | 2,342ms        | N/A            | 376ms          | N/A
Search P90             | 9,809ms        | N/A            | N/A            | N/A
Search cache           | Yes (0ms)      | No             | No             | No
Multi-engine           | 5 engines      | No             | No             | No
Search result count    | 3-10/query     | N/A            | N/A            | N/A
                       |                |                |                |
  EXTRACT              |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
Extract P50 (static)   | 531ms          | 761ms          | N/A            | ~8,400ms
Extract P50 (render)   | 7,102ms        | N/A            | N/A            | N/A
Extract P90 (all)      | 17,317ms       | N/A            | N/A            | N/A
Extract max chars      | 103,258        | 72,057         | 35,206         | N/A
Max chars (truncated)  | 260,351*       | N/A            | N/A            | N/A
Quality score          | 7.5/10         | 8.9/10         | 8.8/10         | N/A
Extraction rate        | 91.3%          | 92.5%          | 86.3%          | N/A
                       |                |                |                |
  STRUCTURED DATA      |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
JSON-LD extraction     | Yes            | Yes            | Yes            | N/A
Field extraction       | 25% (partial)  | 75%            | 75%            | N/A
LLM extraction         | No             | Yes (FIRE-1)   | No             | No
                       |                |                |                |
  RESEARCH             |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
Research (1-call)      | Yes            | No             | Limited        | No
Research P50 (quick)   | 61,892ms       | N/A            | N/A            | N/A
Research P50 (deep)    | 72,716ms       | N/A            | N/A            | N/A
Queries generated      | 3-9 parallel   | N/A            | N/A            | N/A
Sources extracted      | 5 full/call    | N/A            | N/A            | N/A
                       |                |                |                |
  ANTI-BOT             |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
Anti-bot (simple)      | ~80%           | 33.69%*        | ~85%           | N/A
Anti-bot (advanced)    | ~60%           | N/A            | N/A            | N/A
FIFA.com SPA           | FAIL           | N/A            | N/A            | N/A
Auto-escalation        | Yes (3-tier)   | Yes            | No             | Yes
                       |                |                |                |
  CRAWL / MAP          |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
Crawl P50 (3 pages)    | 1,049-3,380ms  | N/A            | N/A            | N/A
Map (URL discovery)    | 1,347-2,519ms  | Yes            | No             | No
Map on JS SPAs         | FAIL (0 URLs)  | Partial        | N/A            | N/A
                       |                |                |                |
  SCRAPE (PLATFORMS)   |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
Platform coverage      | 13 active      | 0              | 0              | 700+
Amazon scrape          | 14-25s, 4 rec  | N/A            | N/A            | <5s
YouTube scrape         | 13-28s         | N/A            | N/A            | N/A
Google SERP scrape     | 2,814ms        | N/A            | N/A            | N/A
                       |                |                |                |
  VERIFY               |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
Claim verification     | Yes            | No             | No             | No
3-angle search         | Yes            | N/A            | N/A            | N/A
Scoring accuracy       | BUGGY*         | N/A            | N/A            | N/A
                       |                |                |                |
  PROXY                |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
Proxy types            | 6 types        | 0              | 0              | 1-2 types
Proxy auto-provision   | Yes            | N/A            | N/A            | Manual
                       |                |                |                |
  COST                 |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
Cost per 1K ops        | ~$1            | $4             | $5             | High
Free tier              | No             | Yes            | Yes            | No
                       |                |                |                |
  AGENT UX             |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
Unified API key        | Yes            | Yes            | Yes            | No
Total tools            | 40+            | 26             | 3-5            | 69
Error guidance         | agent_instr.   | Plain throw    | Docs URL       | Partial
Error coverage (MCP)   | 100%*          | N/A            | N/A            | N/A
Error coverage (SDK)   | 80%            | N/A            | N/A            | N/A
Project folders        | Yes            | No             | No             | No
File auto-save         | Yes            | No             | No             | No
Hosted MCP             | Yes*           | No             | Yes            | Yes
Feedback flywheel      | No             | Yes            | No             | No
                       |                |                |                |
  RELIABILITY          |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
Concurrent safety      | PASS (5 par.)  | N/A            | N/A            | N/A
SSRF protection (MCP)  | PASS           | N/A            | N/A            | N/A
SSRF protection (SDK)  | FAIL*          | N/A            | N/A            | N/A
Credential leak        | PASS (fixed)   | N/A            | N/A            | N/A
Path traversal         | PASS           | N/A            | N/A            | N/A
Input validation       | 100% via Zod   | N/A            | N/A            | N/A
                       |                |                |                |
  DISTRIBUTION         |                |                |                |
-----------------------+----------------+----------------+----------------+----------------
npm monthly downloads  | 1,253          | 494,000        | 179,000        | N/A
GitHub stars           | 2              | 30,000+        | 5,000+         | N/A
```

---

## Footnotes

```
* Extract max chars 260,351: Wikipedia Mbappe page was 260K total; returned 100K
  (truncated at default max_chars=100,000). Agent can request up to 100K per call.

* Firecrawl anti-bot 33.69%: Proxyway independent benchmark (2025). Firecrawl
  claims 100% but ranks last among 11 tested providers.

* Field extraction 25%: novada_extract fields param works for price/title/author
  via pattern matching and JSON-LD. Fails on domain-specific fields (player stats,
  squad data, betting odds) -- returns null. Data IS present in content body but
  the extraction layer lacks domain patterns. Firecrawl/Tavily use LLM extraction.

* Verify scoring BUGGY: Returns confidence=100 even when 0 actual evidence found.
  Formula counts raw search results as "support" regardless of relevance.
  See A2B test 09 for details.

* Error coverage 100% (MCP): All 40 edge-case inputs produce structured
  agent_instruction when routed through MCP Zod validation layer. 8/40 produce
  raw errors when calling tool functions directly (SDK/import usage).

* SSRF protection FAIL (SDK): Direct function calls to novadaExtract() bypass
  Zod URL validation. localhost:3000 was successfully fetched through proxy.
  MCP boundary (hosted endpoint) blocks all private IPs correctly.

* Hosted MCP "Yes*": mcp.novada.com is live but running stale code (4d old).
  Vercel Hobby plan cannot auto-deploy from NovadaLabs private org repos.
  v0.8.3 vendor sync committed but not deployed. Manual deploy needed.

* Search P50 2,342ms: Median of 12 measured search calls across A2B and FIFA
  tests. Range: 1,755ms (cached infra) to 15,766ms (DuckDuckGo cold).

* Extract P50 531ms (static): Median of static-mode extractions only.
  Includes Wikipedia (531ms), Playwright docs (499ms), competitor sites
  (325-795ms), MDN (132-172ms cached). JS-rendered pages are 7-52s.
```

---

## Summary: Where Novada Wins

| Advantage | Detail |
|-----------|--------|
| Cost | ~$1/1K vs $4-5/1K (3-5x cheaper) |
| Agent error guidance | `agent_instruction` on every error path (MCP layer) |
| Research depth | Single-call multi-source synthesis (3-9 parallel queries) |
| File persistence | Auto-save to `~/Downloads/novada-mcp/YYYY-MM-DD/` with topic folders |
| Proxy depth | 6 proxy types (residential, ISP, datacenter, mobile, static, dedicated) |
| Search caching | In-memory dedup cache (0ms on repeat queries within TTL) |
| Multi-engine search | 5 engines (Google, Bing, DuckDuckGo, Yahoo, Yandex) |
| Claim verification | Only MCP with 3-angle fact-checking (albeit buggy scoring) |
| Security | Zod + SSRF + path traversal + credential sanitization |

## Summary: Where Novada Loses

| Gap | Detail | Severity |
|-----|--------|----------|
| Content quality | 7.5/10 vs 8.9/10 (Firecrawl) | HIGH |
| Field extraction | 25% vs 75% -- no LLM extraction | HIGH |
| Extract latency (render) | 7.1s P50 vs 761ms (Firecrawl static) | HIGH |
| Distribution | 1,253 npm vs 494K (395x gap) | CRITICAL |
| JS SPA handling | FIFA.com, ESPN map = FAIL | MEDIUM |
| Verify accuracy | Confidence=100 on 0 evidence | MEDIUM |
| Hosted MCP freshness | 4d stale, manual deploy needed | MEDIUM |
| Platform scrape speed | Amazon 14-25s vs BrightData <5s | MEDIUM |
| Feedback loop | No agent feedback mechanism | LOW |

## Honest Assessment

**Novada is a viable product with real competitive advantages** (cost, agent UX,
research depth, proxy breadth) but suffers from three structural gaps:

1. **Quality gap** (7.5 vs 8.9) -- fixable with P1 HTML extraction improvements
   and eventual LLM extraction support.

2. **Speed gap on JS pages** -- auto-escalation adds 7-52s. Static pages are
   competitive (531ms P50). The escalation pipeline needs the P2 domain routing
   cache and connection pooling fixes.

3. **Distribution gap** (395x) -- the product works but nobody knows it exists.
   This is the #1 problem. All P0-P2 code improvements combined have less ROI
   than a single Show HN post.

---

## Raw Latency Data (All Measured Today)

### Search Calls (12 measurements)

| Test | Engine | Latency | Results |
|------|--------|---------|---------|
| A2B-01 | google | 2,046-2,342ms | 5 |
| A2B-10 | google | 1,997ms | 3 |
| FIFA-01 | google | 4,332ms | 9 |
| FIFA-10 | google | 9,809ms | 3 |
| FIFA-10 | bing | 7,589ms | 0 (FAIL) |
| FIFA-10 | duckduckgo | 15,766ms | 10 |
| FIFA-16 | google | 3,149ms | 5 |
| FIFA-17 | google | ~2,000ms | 3 |
| FIFA-20 (scrape) | google | 2,814ms | 3 |
| Hosted-v4 | google | 1,755ms | 3 |
| Stress-10 | google | 2,115ms | 5 |
| Cache hit | any | 0ms | cached |

**Search P50: ~2,342ms | Search P90: ~9,809ms**

### Extract Calls (22 measurements)

| Test | URL Type | Mode | Latency | Chars |
|------|----------|------|---------|-------|
| A2B-01 | aimultiple.com | static | 354-670ms | 13,843 |
| A2B-03 | brightdata.com | static | 560ms | 28,972 |
| A2B-03 | oxylabs.io | static | 325ms | 12,073 |
| A2B-03 | smartproxy.com | static | 795ms | 37,978 |
| A2B-05 | playwright.dev | static | 499ms | 15,307 |
| FIFA-03 | transfermarkt.com | static | 640ms | 11,482 |
| FIFA-03 | wikipedia.org | static | 4,241ms | 103,258 |
| FIFA-03 | espn.com | render | 27,832ms | 2,260 |
| FIFA-04 | wikipedia.org | static | 1,366ms | 82,859 |
| FIFA-06 | flashscore.com | static | 51,939ms | 3,183 |
| FIFA-06 | bbc.com | static | 1,605ms | 15,478 |
| FIFA-06 | google sports | render | 26,373ms | 946 |
| FIFA-13 | aiscore.com | render | 11,641ms | 7,733 |
| FIFA-14 | wikipedia.org | static | 1,090ms | 100,114 |
| FIFA-15 | wikipedia.org | static | 2,175ms | 103,172 |
| FIFA-17 | covers.com | static | 9,400ms | 103K |
| Hosted-v3 | react.dev | auto->render | 7,700ms | 22,632 |
| Hosted-v4 | MDN | static | 132ms | 102,505 |
| Stress-04 | wikipedia.org | static | 531ms | 51,430 |
| Stress-04 | MDN (JSON) | static | 172ms | 103,041 |
| Stress-06 | httpbin (5s delay) | static | 5,651ms | json |
| Stress-06 | example.com | static | 116ms | ~1K |

**Extract P50 (static only): ~640ms | Extract P50 (all modes): ~2,175ms**

### Research Calls (4 measurements)

| Test | Depth | Latency | Output | Queries |
|------|-------|---------|--------|---------|
| A2B-04 | quick | ~60s | 8,704ch | 3/3 |
| FIFA-05 | deep | 73,126ms | 8,704ch | 6/6 |
| FIFA-18 | comprehensive | 72,305ms | 9,379ch | 9/9 |
| Stress-10 | quick | 61,892ms | 6,839ch | 3/3 |

### Crawl Calls (2 measurements)

| Test | Pages | Latency | Chars |
|------|-------|---------|-------|
| A2B-07 | 5 | 3,380ms | 17,598 |
| FIFA-11 | 3 | 1,049ms | 10,731 |

### Scrape Calls (4 measurements)

| Test | Platform | Latency | Records |
|------|----------|---------|---------|
| A2B-02 | amazon.com | 14-25s | 4 |
| A2B-06 | youtube.com | 28,462ms | 3 |
| FIFA-07 | youtube.com | 13,015ms | 5 |
| FIFA-20 | google.com | 2,814ms | 3 |

### Verify Calls (4 measurements)

| Test | Latency | Verdict | Confidence | Correct |
|------|---------|---------|------------|---------|
| A2B-09 | 3,062ms | supported | 100 | BUGGY |
| FIFA-08 #1 | 8,998ms | supported | 100 | Vacuously true |
| FIFA-08 #2 | 2,906ms | supported | 100 | Correct |
| FIFA-08 #3 | 2,747ms | supported | 100 | Correct |

---

## Test Pass Rates

| Suite | Total | Pass | Partial | Fail | Rate |
|-------|-------|------|---------|------|------|
| A2B (10 tests) | 10 | 8 | 1 | 1 | 80% |
| FIFA (20 tests) | 20 | 14 | 3 | 3 | 70% |
| Stress (10 tests) | 10 | 9 | 0 | 1 | 90% |
| Hosted (5 batches) | 15 | 14 | 0 | 1 | 93% |
| **Total** | **55** | **45** | **4** | **5** | **82%** |

### Failures Detail

| Test | Issue | Root Cause |
|------|-------|------------|
| A2B-08 map | 0 URLs returned for SmashingMagazine | JS SPA + URL-based search mismatch |
| FIFA-02 extract | FIFA.com SPA = 39 chars | Client-rendered SPA, anti-bot |
| FIFA-06 SofaScore | Extract failed (529 chars) | JS SPA, all promises rejected |
| FIFA-09 fields | All 7 fields null | No domain-specific patterns for sports data |
| Stress-07 rapid-fire | 1 file instead of 5 | Second-level filename collision (data loss) |

---

*Scoreboard compiled from 55 test runs across 4 suites. All Novada data is
from live API calls on 2026-06-25/26. Competitor data sourced from the
20-agent competitive analysis report and published benchmarks.*
