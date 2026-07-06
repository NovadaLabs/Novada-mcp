# Research, Verify & Monitor

Three tools that go beyond extraction. `novada_research` synthesizes multi-source reports in a single call -- something no other MCP server offers. `novada_verify` fact-checks claims against the live web. `novada_monitor` tracks page changes over time.

---

## novada_research

**The most powerful research tool in any MCP server.** One call fires 3-10 parallel searches across Google, Bing, and DuckDuckGo, deduplicates results, extracts full content from the top 5 sources, and returns a synthesized report with citations. It replaces 5-10 manual search-then-extract calls.

No other MCP server does this. Firecrawl, Exa, Tavily -- they all return raw search results or page content. Novada Research runs the entire pipeline: query generation, multi-engine search, dedup, content extraction, keyword-ranked synthesis. One tool call, one report.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `question` | string | Yes* | -- | The research question. Minimum 5 characters. |
| `query` | string | Yes* | -- | Alias for `question`. Use either one. |
| `depth` | string | No | `"auto"` | Controls how many parallel searches run. `"quick"` = 3, `"deep"` = 5-6, `"comprehensive"` = 8-10, `"auto"` = server decides based on question complexity. |
| `focus` | string | No | -- | Narrows sub-query generation. E.g. `"technical implementation"`, `"business impact"`, `"recent news only"`. |

*Either `question` or `query` must be provided.

### How It Works

1. **Query generation** -- The question is analyzed for domain (tech, business, comparison, how-to, general). Domain-specific sub-queries are generated: a tech question gets queries suffixed with "github", "documentation official", "stackoverflow solution"; a business question gets "case study", "market analysis benchmark", "industry report".

2. **Parallel search** -- All queries run simultaneously. Each query tries Google first (cheapest path), then races DuckDuckGo and Bing in parallel on failure. Best case: 1 API call per query. Worst case: 3.

3. **Dedup and rank** -- Results are deduplicated by normalized URL. Up to 15 unique sources are kept.

4. **Content extraction** -- The top 5 source URLs are extracted in parallel via `novada_extract`. Sources where extraction fails fall back to their search snippets.

5. **Synthesis** -- Extracted content is ranked by keyword overlap with the original question. The most relevant fragment leads the summary; additional perspectives follow.

### Depth Modes

| Depth | Queries | Best For |
|-------|---------|----------|
| `quick` | 3 | Simple factual questions, quick lookups |
| `deep` | 5-6 | Comparisons, trade-off analysis, multi-faceted topics |
| `comprehensive` | 8-10 | Market research, competitive intelligence, thorough coverage |
| `auto` | varies | Server decides: short simple questions get `quick`, complex questions (80+ chars, contains "compare", "vs", "pros and cons") get `deep` |

### Examples

**Market research**

```
novada_research({
  question: "What are the top MCP servers for web data access in 2026?",
  depth: "deep"
})
```

**Competitive analysis with focus**

```
novada_research({
  question: "How does Firecrawl compare to Novada for agent web scraping?",
  depth: "comprehensive",
  focus: "pricing and developer experience"
})
```

**Technical deep dive**

```
novada_research({
  question: "Best practices for implementing MCP tool servers in TypeScript",
  depth: "deep",
  focus: "error handling and streaming"
})
```

**Quick fact lookup**

```
novada_research({
  query: "When was the Model Context Protocol specification released?",
  depth: "quick"
})
```

### Response Structure

The output is a structured markdown report:

```
## Research: <topic>

**Query**: <original question>
**depth**: deep
**queries**: 5/6 succeeded
**generated_queries**:
  1. <query 1>
  2. <query 2>
  ...
**sources_extracted**: 4 full + 1 snippet-only
**search_strategy**: concurrent engine racing (google + duckduckgo + bing)
**timestamp**: 2026-06-23T10:30:00.000Z

---

## Summary
<synthesized answer with citations>

**Additional perspectives:**
- *Source A*: <relevant excerpt>
- *Source B*: <contrasting point>

## Key Findings
- **Title** (url) -- snippet
- ...

## Sources
- url -- title (full content extracted)
- url -- title (snippet only -- extraction failed)

## Agent Hints
- Use novada_extract with specific source URLs for full content
- For narrower research: add focus param
- For more coverage: use depth='comprehensive'
```

### When to Use (and When Not To)

| Scenario | Use novada_research? |
|----------|---------------------|
| Complex question needing multiple sources | Yes |
| Comparative analysis or trade-offs | Yes |
| Market research, competitive intel | Yes |
| Single fact lookup ("what is X?") | No -- use `novada_search` |
| Reading one known URL | No -- use `novada_extract` |
| Getting structured product data | No -- use `novada_scrape` |

---

## novada_verify

Fact-check a claim against live web sources. Runs 3 parallel searches from different angles (supporting, skeptical, neutral fact-check) and returns a verdict with confidence score.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `claim` | string | Yes | -- | The factual claim to verify. Minimum 10 characters. |
| `context` | string | No | -- | Narrows the search. E.g. `"as of 2024"`, `"in the United States"`, `"according to WHO"`. |

### How It Works

1. **Three search angles** -- The claim is searched from three perspectives:
   - **Supporting**: `"<claim>" evidence study research`
   - **Skeptical**: `"<claim>" debunked refuted disproved misinformation myth`
   - **Neutral**: `fact check "<first 10 words of claim>"`

2. **Parallel execution** -- All 3 searches run simultaneously. Partial failures are tolerated (confidence is capped at 60 if a key query fails).

3. **Dispute filtering** -- Skeptical results are filtered for genuine disagreement language ("false", "debunked", "myth", "no evidence"). Academic papers that merely cite the claim as a true example are excluded.

4. **Verdict calculation** -- Supporting evidence count (including neutral fact-check results) is compared against contradicting evidence:
   - Score >= 0.6 --> `supported`
   - Score <= 0.3 --> `unsupported`
   - Between 0.3 and 0.6 --> `contested`
   - No evidence from either side --> `insufficient_data`

5. **Confidence scoring** -- 0-100 scale. Higher means more agreement among sources. Capped at 60 when a search query failed. Floor of 50 for clear verdicts.

### Verdicts

| Verdict | Meaning |
|---------|---------|
| `supported` | Majority of sources confirm the claim |
| `unsupported` | Majority of sources contradict the claim |
| `contested` | Sources disagree -- evidence on both sides |
| `insufficient_data` | Not enough search results to determine |

### Examples

**Simple fact check**

```
novada_verify({
  claim: "Python is the most popular programming language in 2026"
})
```

**Claim with context**

```
novada_verify({
  claim: "OpenAI was founded in 2015",
  context: "San Francisco, nonprofit AI research lab"
})
```

**Checking a statistic**

```
novada_verify({
  claim: "Over 50% of enterprise developers use AI coding assistants",
  context: "as of 2025 survey data"
})
```

### Response Structure

```
## Claim Verification

claim: "Python is the most popular programming language in 2026"
verdict: supported
confidence: 80  (0 = completely uncertain, 100 = all evidence agrees)

---

## Supporting Evidence (4 sources)

1. **TIOBE Index June 2026**
   Python maintains #1 position with 18.2% market share...

2. **Stack Overflow Developer Survey**
   ...

## Contradicting Evidence (1 source)

1. **Alternative Ranking Methodology**
   When measuring by lines of code in production...

---
## Agent Hints
- Verdict is based on search result balance, not deep reasoning.
- Supporting URLs: url1, url2, url3
- Contradicting URLs: url4
```

### Important Caveats

- The verdict is **signal-based**, not a definitive ruling. It reflects the balance of search results, not deep semantic reasoning.
- Confidence 0-100 indicates how much sources agree, not how "true" the claim is.
- For "contested" results, use `novada_extract` on the source URLs to read the full arguments.
- For "insufficient_data", try `novada_research` for a deeper multi-source investigation.

---

## novada_monitor

Track changes on a web page over time. Extracts content, computes a SHA-256 hash, and compares it against the previous check. Supports field-level diffs with percentage change annotations.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | -- | The page to monitor. Must be HTTP/HTTPS. |
| `fields` | string[] | No | -- | Specific fields to track, e.g. `["price", "availability", "rating"]`. Up to 20. Without fields, monitors full page content hash. |
| `format` | string | No | `"markdown"` | Output format. `"markdown"` for human-readable reports, `"json"` for structured data. |

### How It Works

1. **Extract** -- The URL is fetched via `novada_extract` with `render: "auto"`.
2. **Hash** -- Content is SHA-256 hashed (first 16 hex chars stored).
3. **Field extraction** -- If `fields` are specified, values are extracted from the content using pattern matching: `field: value` labels, markdown headings, and currency patterns for price fields.
4. **Compare** -- If a previous check exists for the same URL, hashes and field values are compared.
5. **Diff** -- Changed fields get annotations: numeric changes show percentage (e.g. "27.3% decrease"), non-numeric changes show "changed".
6. **Store** -- The current state replaces the previous one in memory.

### Session-Scoped State

Monitor state lives in the MCP server's process memory. It persists across multiple calls within the same session but is **lost when the server restarts**. This means:

- First call to a URL records the baseline
- Subsequent calls detect changes relative to the last check
- Restarting the server resets all baselines

For persistent monitoring across sessions, use Novada's cloud monitoring API or build a wrapper that stores state externally.

### Examples

**Basic page monitoring (full content hash)**

```
novada_monitor({
  url: "https://example.com/pricing"
})
```

First call returns `status: baseline_recorded`. Second call returns `status: unchanged` or `status: changed`.

**Field-level price monitoring**

```
novada_monitor({
  url: "https://example.com/product/abc",
  fields: ["price", "availability", "rating"]
})
```

Returns field-level diffs:

```
## Changed Fields
- price: $29.99 --> $24.99 (16.7% decrease)
- availability: In Stock --> In Stock (unchanged)
- rating: 4.5 --> 4.6 (2.2% increase)
```

**JSON format for programmatic use**

```
novada_monitor({
  url: "https://competitor.com/pricing",
  fields: ["price"],
  format: "json"
})
```

Returns:

```json
{
  "url": "https://competitor.com/pricing",
  "status": "changed",
  "current_hash": "a1b2c3d4e5f6g7h8",
  "previous_hash": "z9y8x7w6v5u4t3s2",
  "total_checks": 3,
  "checks_since_change": 0,
  "fields_tracked": ["price"],
  "current_fields": { "price": "$24.99" },
  "changed_fields": [
    {
      "field": "price",
      "previous": "$29.99",
      "current": "$24.99",
      "annotation": "16.7% decrease"
    }
  ]
}
```

### Response States

| Status | Meaning | Next Action |
|--------|---------|-------------|
| `baseline_recorded` | First check for this URL | Call again later to detect changes |
| `unchanged` | Content hash matches previous check | Call again later to continue monitoring |
| `changed` | Content hash differs from previous check | Process changes or alert user |
| `error` | Failed to extract content | Check URL accessibility, retry later |

### Use Cases

| Scenario | fields Parameter |
|----------|-----------------|
| Competitive pricing alerts | `["price", "plan_name", "features"]` |
| Stock/availability tracking | `["availability", "stock", "price"]` |
| Content change detection | omit (uses full hash) |
| Job listing monitoring | `["salary", "title", "location"]` |
| Regulatory/compliance page changes | omit (uses full hash) |

---

## Combining the Three Tools

These tools compose naturally in agent workflows:

**Research-then-verify pipeline:**
1. `novada_research` to investigate a topic
2. `novada_verify` to fact-check specific claims from the report
3. `novada_extract` on source URLs for full context on contested claims

**Competitive monitoring pipeline:**
1. `novada_research` to identify competitor pages
2. `novada_monitor` to track pricing/feature changes over time
3. `novada_verify` to validate competitor claims

**Due diligence workflow:**
1. `novada_research` with `depth: "comprehensive"` for full coverage
2. `novada_verify` on each key claim in the report
3. Synthesize into a verified brief
