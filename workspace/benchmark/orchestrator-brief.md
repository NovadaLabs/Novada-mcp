# MCP Web Scraping Benchmark — Orchestrator Brief
**Version:** 1.0 | **Date:** 2026-05-21

You are a benchmark orchestration agent. Your job is to run a rigorous, data-backed
head-to-head comparison of Novada MCP vs BrightData, Firecrawl, Tavily, and Oxylabs
across all major web scraping/research capabilities.

**No prior context needed. This brief is fully self-contained.**

---

## Credentials

```
NOVADA_API_KEY=          [already in your .mcp.json as novada-dev]
BRIGHTDATA_TOKEN=        39fe5616-61ca-417a-b952-a059d2593e67
FIRECRAWL_KEY=           fc-a897ecb6c3e54425a4acba11a399a735
TAVILY_KEY=              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
OXYLABS_USER=            oxy001_4xGlt
OXYLABS_PASS=            20260324_Berry
```

---

## Test Matrix

### Fixed targets (same for every competitor, every round)

| Category | ID | Target | What to measure |
|----------|----|--------|----------------|
| Static scrape | T1 | `https://news.ycombinator.com` | Top 5 story titles extracted |
| JS-heavy scrape | T2 | `https://linear.app` | Hero headline + feature list extracted |
| Search — financial | T3 | query: `"bitcoin price 2025"` | Top 5 results: title + URL |
| Search — AI | T4 | query: `"agent memory system AI"` | Top 5 results: title + URL |
| Crawl | T5 | `https://docs.python.org/3/library/collections.html` max 3 pages | pages crawled, total words |
| Structured data | T6 | Amazon ASIN `B09B96TG33` (Echo Dot) | price, rating, review count |

### Rounds
- **1 warm-up round** (discard — for auth/session init)
- **10 measured rounds** per (competitor × category)
- Total calls per competitor: ~66 (1 warmup + 10 rounds × 6 categories)
- Stop a competitor when their API returns an out-of-credits / quota error — note the round it happened, continue with others

---

## How to Call Each Competitor

### Novada (use MCP tools — novada-dev server)
```
T1, T2: novada_extract(url=TARGET, format="markdown")
T3, T4: novada_search(engine="google", query=QUERY, num=5)
T5:     novada_crawl(url=TARGET, max_pages=3)
T6:     novada_scrape(platform="amazon.com", operation="amazon_product_keywords",
                      params={"keyword":"Echo Dot B09B96TG33","country":"us"}, limit=3)
```

### BrightData (REST API — no MCP needed)
Base URL: `https://api.brightdata.com`
Auth: `Authorization: Bearer 39fe5616-61ca-417a-b952-a059d2593e67`

```bash
# T1, T2 — scrape
curl -X POST https://api.brightdata.com/request \
  -H "Authorization: Bearer $BD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"zone":"web_unlocker1","url":"TARGET","format":"markdown"}'

# T3, T4 — SERP
curl -X POST https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_... \
  -H "Authorization: Bearer $BD_TOKEN" ...
# If SERP zone unavailable, use web_search zone:
# -d '{"zone":"web_search","query":"QUERY","country":"us"}'

# T5 — crawl (check if BrightData has a crawl endpoint, else mark N/A)
# T6 — structured data (check if they have amazon scraper, else mark N/A)
```

> If any endpoint returns 402, 429, or "insufficient credits", log it, mark remaining
> rounds as CREDIT_EXHAUSTED, and continue with the next competitor.

### Firecrawl (REST API)
```bash
# T1, T2 — scrape
curl -X POST https://api.firecrawl.dev/v2/scrape \
  -H "Authorization: Bearer fc-a897ecb6c3e54425a4acba11a399a735" \
  -H "Content-Type: application/json" \
  -d '{"url":"TARGET","formats":["markdown"]}'

# T3, T4 — NO SEARCH (Firecrawl has no search endpoint) → mark N/A

# T5 — crawl
curl -X POST https://api.firecrawl.dev/v1/crawl \
  -H "Authorization: Bearer fc-a897ecb6c3e54425a4acba11a399a735" \
  -H "Content-Type: application/json" \
  -d '{"url":"TARGET","limit":3,"scrapeOptions":{"formats":["markdown"]}}'

# T6 — structured (no Amazon scraper) → mark N/A
```

### Tavily (REST API)
```bash
# T1, T2 — extract (Tavily has extract endpoint)
curl -X POST https://api.tavily.com/extract \
  -H "Content-Type: application/json" \
  -d '{"api_key":"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",
       "urls":["TARGET"]}'

# T3, T4 — search
curl -X POST https://api.tavily.com/search \
  -H "Content-Type: application/json" \
  -d '{"api_key":"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",
       "query":"QUERY","max_results":5,"search_depth":"basic"}'

# T4 deep research — also test with search_depth="advanced"
# T5, T6 — N/A (no crawl, no structured scraper)
```

### Oxylabs (REST API)
Auth: Basic `oxy001_4xGlt:20260324_Berry`
```bash
# T1, T2 — universal scraper
curl -X POST https://realtime.oxylabs.io/v1/queries \
  -u "oxy001_4xGlt:20260324_Berry" \
  -H "Content-Type: application/json" \
  -d '{"source":"universal","url":"TARGET","render":"html"}'

# T3, T4 — SERP (if SERP product active)
curl -X POST https://realtime.oxylabs.io/v1/queries \
  -u "oxy001_4xGlt:20260324_Berry" \
  -H "Content-Type: application/json" \
  -d '{"source":"google_search","query":"QUERY","domain":"com","geo_location":"United States"}'

# T5 — no crawl → N/A
# T6 — Amazon (if active)
curl -X POST https://realtime.oxylabs.io/v1/queries \
  -u "oxy001_4xGlt:20260324_Berry" \
  -H "Content-Type: application/json" \
  -d '{"source":"amazon_product","query":"B09B96TG33","domain":"com"}'
```

---

## Measurement Protocol

For each call, record these fields in JSON:

```json
{
  "competitor": "novada|brightdata|firecrawl|tavily|oxylabs",
  "category": "T1|T2|T3|T4|T5|T6",
  "round": 1,
  "latency_ms": 1234,
  "success": true,
  "status": "ok|error|na|credit_exhausted",
  "content_length_chars": 4521,
  "content_quality": 4,
  "agent_friendliness": {
    "has_agent_instruction": true,
    "error_is_structured": true,
    "has_status_field": true,
    "output_is_chainable": true,
    "low_boilerplate": true,
    "score": 5
  },
  "target_content_found": true,
  "notes": "..."
}
```

### Latency
Use `Date.now()` before and after the full API call including response parsing.
Record in milliseconds. **Round 0 (warm-up) is discarded.**

### Content Quality Score (1–5)
| Score | Meaning |
|-------|---------|
| 5 | Target content fully present, well-structured, ready for agent use |
| 4 | Target content present, minor formatting issues |
| 3 | Partial content, some key elements missing |
| 2 | Very sparse, most content missing |
| 1 | Empty or only boilerplate headers |

**Per category:**
- T1 (HN): Score 5 if ≥5 story titles found with points, else scale down
- T2 (linear.app): Score 5 if main headline + ≥3 features extracted
- T3/T4 (search): Score 5 if ≥5 results with both title AND URL
- T5 (crawl): Score 5 if ≥3 pages + ≥500 words total
- T6 (Amazon): Score 5 if price + rating + review count all present

### Agent-Friendliness Score (checklist, 1 point each = max 5)
1. **agent_instruction present** — response includes explicit next-step guidance for the agent
2. **structured errors** — error responses are JSON/key-value, not raw stack traces
3. **status field** — response has an explicit ok/partial/failed status signal
4. **chainable output** — response includes URLs or IDs the agent can pass to the next call
5. **low boilerplate** — <20% of response is headers/metadata vs actual content

Score each call against this checklist. For competitors using raw REST APIs: check if their response JSON has equivalents of these properties.

---

## Execution Order

Run in this order to avoid race conditions and for clean results:

```
For each competitor in [novada, brightdata, firecrawl, tavily, oxylabs]:
  For each category in [T1, T2, T3, T4, T5, T6]:
    Round 0: warm-up call (time it but discard)
    Rounds 1-10: measure + record
    If CREDIT_EXHAUSTED: log round number, break inner loop, continue to next category
  Save intermediate results to workspace/benchmark/results-{competitor}.json
```

After all competitors done, aggregate and generate report.

---

## Output Files

Write these files as you go (don't wait for the end):

```
workspace/benchmark/
  results-novada.json
  results-brightdata.json
  results-firecrawl.json
  results-tavily.json
  results-oxylabs.json
  summary.json          ← aggregated stats
  report.html           ← final HTML report (see format below)
```

---

## Report Format

The final `report.html` must include these sections:

### 1. Executive Summary
- Overall winner per category (fastest, highest quality, most agent-friendly)
- One-line verdict: "Novada wins X/6 categories outright, ties Y, loses Z"
- Key data point per win/loss

### 2. Latency Comparison Table
For each category × competitor: median ms, p95 ms, success rate (N/10)
Mark N/A where tool doesn't support the category.
Highlight fastest in green, slowest in red.

### 3. Quality Scores Table
Same matrix, quality score median across 10 rounds.

### 4. Agent-Friendliness Table
Score per competitor (0–5). Include specific observations: which tools have agent_instruction, which have raw errors, etc.

### 5. Per-Category Deep Dives
For each of T1–T6: what did each tool return? Sample output from round 5. Notable differences. Why one tool beat another (not just the number — the reason).

### 6. Cost Efficiency
Calls completed before credit exhaustion. Estimate cost-per-call based on rounds completed vs known pricing.

### 7. Gaps & Advantages
- Where Novada clearly wins (with data)
- Where Novada loses (with data and why)
- Actionable recommendations (what Novada should copy/build)

### 8. Raw Data
Expandable JSON dump of all results.

Use the same visual style as the previous QA report (Nunito font, sidebar nav, stat cards, color-coded badges).

---

## Error Handling Rules

- **Auth error (401/403)**: try once with the provided credentials, log error, mark test as FAILED, continue
- **Rate limit (429)**: wait 10 seconds, retry once, if still 429 mark FAILED continue
- **Credit exhausted (402 / "insufficient credits")**: mark remaining rounds CREDIT_EXHAUSTED, move to next category
- **Timeout (>60s)**: mark as TIMEOUT, latency = 60000ms, count as failure
- **N/A (tool doesn't support category)**: mark N/A, do not count in success rate

---

## Definition of Done

Report is complete when:
- All 10 rounds run for at least Novada + 2 competitors across all 6 categories
- report.html saved to workspace/benchmark/
- Every conclusion in the report cites at least one data row
- No unsupported claim ("Novada is faster" must be backed by a latency table row)

Save the report path to the terminal when done:
```
BENCHMARK COMPLETE: file:///Users/tongwu/Projects/novada-mcp/workspace/benchmark/report.html
```
