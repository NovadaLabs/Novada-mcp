# Extract & Search

The two tools you will use most often. `novada_extract` reads a page; `novada_search` finds pages.

---

## `novada_extract`

Extract clean, readable content from any URL. Handles Cloudflare, DataDome, and Kasada automatically via auto-escalation (static -> JS render -> Browser CDP). Pass an array of URLs (up to 10) for parallel batch extraction.

### When to use

- Reading a single page or a handful of known URLs.
- Pulling structured fields (price, author, date) from a product or article page.
- Batch-extracting the top results after a `novada_search` call.

### When NOT to use

- You need to discover URLs first -- use `novada_map`.
- You need content from many pages on one domain -- use `novada_crawl`.
- You need structured platform data (Amazon products, TikTok posts) -- use `novada_scrape`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | `string \| string[]` | Yes | -- | URL or array of URLs (max 10). Batch mode processes in parallel. |
| `urls` | `string[]` | No | -- | Alias for `url` when passing multiple URLs. |
| `format` | `string` | No | `"markdown"` | Output format: `"markdown"`, `"text"`, `"html"`, `"json"`. |
| `render` | `string` | No | `"auto"` | Rendering mode: `"auto"`, `"static"`, `"render"` / `"js"`, `"browser"`. |
| `fields` | `string[]` | No | -- | Specific fields to extract, e.g. `["price", "author", "rating"]`. Max 20. |
| `clean` | `boolean` | No | `false` | Set `true` to extract only the main article body (strips nav, footer, ads). |
| `max_chars` | `number` | No | `100000` | Maximum characters to return. Range: 1000--100000. |
| `query` | `string` | No | -- | Relevance hint so the agent can focus on relevant sections. |
| `wait_for` | `string` | No | -- | CSS selector to wait for before capture (browser mode only). Max wait: 15s. |
| `wait_ms` | `number` | No | -- | Fixed delay in ms after page load. Range: 0--30000. Prefer `wait_for`. |

### Render modes

| Mode | Speed | Use when |
|------|-------|----------|
| `"auto"` | Fastest | Default. Tries static first, escalates automatically if JS is detected. |
| `"static"` | Fastest | You know the page is plain HTML (blogs, docs, wikis). |
| `"render"` / `"js"` | ~3-5s | Known JS-heavy SPAs (React, Vue, Angular). Forces Web Unblocker. |
| `"browser"` | ~8-12s | Full Chromium CDP. Last resort for complex SPAs. Requires `NOVADA_BROWSER_WS`. |

**Key rule:** Leave `render="auto"`. It is 15-100x faster on static sites. Only override when you know the page requires JS rendering.

### Output

By default, returns the full page converted to clean markdown. When `clean=true`, returns only the main article body with navigation, footers, sidebars, and ads stripped.

Output is also saved to disk at:

```
~/Downloads/novada-mcp/YYYY-MM-DD/extract_{domain}_{HHmmss}.md
```

### Examples

#### 1. Basic: extract a blog post

```json
{
  "url": "https://blog.example.com/ai-agents-2026",
  "format": "markdown"
}
```

Returns the full page as structured markdown -- headings, paragraphs, images, links all preserved.

#### 2. With fields: extract specific data points

```json
{
  "url": "https://store.example.com/product/widget-pro",
  "fields": ["price", "title", "availability", "rating"]
}
```

Returns a `## Requested Fields` block with each field extracted. Checks JSON-LD structured data first, falls back to pattern matching.

#### 3. JS-heavy page: force rendering

```json
{
  "url": "https://app.example.com/dashboard",
  "render": "render",
  "wait_for": ".dashboard-content"
}
```

Forces JS rendering via the Web Unblocker. The `wait_for` selector delays capture until `.dashboard-content` appears in the DOM (max 15s).

#### 4. Clean mode: main content only

```json
{
  "url": "https://news.example.com/article/12345",
  "clean": true
}
```

Strips navigation bars, footers, sidebars, and ads. Returns only the article body -- ideal for summarization or RAG ingestion.

#### 5. Batch extraction

```json
{
  "urls": [
    "https://docs.example.com/api/auth",
    "https://docs.example.com/api/users",
    "https://docs.example.com/api/billing"
  ],
  "format": "markdown"
}
```

Extracts all three pages in parallel. Returns a structured document with one section per URL (`### [1/3] https://docs.example.com/api/auth`, etc.).

---

## `novada_search`

Search the web via 5 engines (Google, Bing, DuckDuckGo, Yahoo, Yandex). Returns titles, URLs, and snippets, reranked by relevance. Results are cached for 60 seconds -- repeating the same query returns instantly.

### When to use

- Finding URLs for a topic, product, or company.
- Current events and fact lookup.
- Competitive research and discovery.

### When NOT to use

- You already have the URL -- use `novada_extract`.
- You need a multi-source synthesized report -- use `novada_research` (it runs 3-10 searches + extraction + synthesis in one call).

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | `string` | Yes | -- | Search query. |
| `engine` | `string` | No | `"google"` | Engine: `"google"`, `"bing"`, `"duckduckgo"`, `"yahoo"`, `"yandex"`. |
| `num` | `number` | No | `10` | Number of results. Range: 1--20. |
| `time_range` | `string` | No | -- | Time window: `"day"`, `"week"`, `"month"`, `"year"`. |
| `start_date` | `string` | No | -- | ISO date `YYYY-MM-DD`. Results published on or after this date. |
| `end_date` | `string` | No | -- | ISO date `YYYY-MM-DD`. Results published on or before this date. |
| `country` | `string` | No | `""` | ISO 2-letter country code for geo-targeting. |
| `language` | `string` | No | `""` | Language code for results. |
| `include_domains` | `string[]` | No | -- | Only return results from these domains. Max 10. |
| `exclude_domains` | `string[]` | No | -- | Exclude results from these domains. Max 10. |
| `format` | `string` | No | `"markdown"` | Output format: `"markdown"` or `"json"`. |
| `enrich_top` | `boolean` | No | `false` | Auto-extract full content from the top result. Adds ~2-4s latency. |
| `extract_options` | `object` | No | -- | Auto-extract content from top N results (see below). |

### `extract_options` (auto-extract from search results)

When provided, automatically runs `novada_extract` on the top search results and appends the content inline. Eliminates a separate extraction call.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `top_n` | `number` | `3` | How many top results to extract. Range: 1--10. |
| `format` | `string` | `"markdown"` | Extraction format: `"text"`, `"markdown"`, `"html"`, `"json"`. |
| `fields` | `string[]` | -- | Specific fields to extract from each result page. |
| `max_chars` | `number` | -- | Max characters per extracted page. Range: 1000--100000. |

### Engines

| Engine | Best for |
|--------|----------|
| `"google"` | General relevance (default). |
| `"bing"` | News and local results. |
| `"duckduckgo"` | Privacy-conscious queries. Similar speed to Google. |
| `"yahoo"` | Broad index. |
| `"yandex"` | Russian and Eastern European content. |

### Caching

Results are cached for 60 seconds. The same query + engine + num combination returns the cached response instantly with no API call. Cache is in-memory and resets when the MCP server restarts.

### Examples

#### 1. Basic search

```json
{
  "query": "best MCP servers for web scraping 2026",
  "num": 10
}
```

Returns 10 results as a markdown list with title, URL, and snippet for each.

#### 2. With date filtering

```json
{
  "query": "OpenAI API pricing changes",
  "time_range": "week",
  "engine": "google"
}
```

Returns only results from the last 7 days. Use `"day"` for breaking news, `"month"` for recent developments.

#### 3. With auto-extract: read the top results in one call

```json
{
  "query": "Stripe webhook best practices",
  "extract_options": {
    "top_n": 3,
    "format": "markdown"
  }
}
```

Searches, then automatically extracts the full content from the top 3 result URLs. Each result includes both the search snippet and the full extracted page content. No separate `novada_extract` call needed.

#### 4. Domain-scoped search

```json
{
  "query": "authentication middleware",
  "include_domains": ["github.com", "stackoverflow.com"],
  "num": 15
}
```

Restricts results to GitHub and Stack Overflow only.

#### 5. Quick enrichment with `enrich_top`

```json
{
  "query": "Next.js 16 release notes",
  "enrich_top": true
}
```

Shorthand for `extract_options.top_n=1`. Returns all search results plus the full extracted content of the top result. Adds ~2-4 seconds of latency.

---

## Extract vs. Search: decision guide

| I want to... | Use |
|---------------|-----|
| Read a page I already have the URL for | `novada_extract` |
| Find pages about a topic | `novada_search` |
| Find pages AND read the top results | `novada_search` with `extract_options` |
| Read multiple known URLs in parallel | `novada_extract` with `urls` array |
| Deep multi-source research with synthesis | `novada_research` |
