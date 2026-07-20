---
name: novada-agent
description: >-
  Use Novada MCP tools for web tasks. Covers tool selection (search vs extract
  vs crawl vs map vs research), key parameters, common workflows, and
  when NOT to call each tool. Trigger: any task requiring web data, content
  extraction, site crawling, or multi-source research.
---

# Novada Agent Skill

You have access to Novada's **38** curated MCP tools (the set `novada_discover` lists; the hosted endpoint exposes a core-derived **30**-tool subset). This skill tells you exactly which tool to use when and how to use it effectively. Older names like `novada_unblock`, `novada_verify`, and `novada_health` still work as back-compat aliases — the current tools are shown below.

Deep-dive companion skills: `novada-scrape` (platform scrapers + price fields), `novada-extract` (single/batch extraction), `novada-browser` (CDP automation), `novada-proxy` (proxy type selection + escalation), `novada-site-copy` (whole-site copying / RAG ingestion).

## Tool Selection — Decision Tree

```
Need web data?
├── Have specific URLs already? → novada_extract
├── Need to find URLs first?
│   ├── Question needs facts/prices/current events (accuracy matters)?
│   │   ├── 1 source → novada_search THEN novada_extract top result (read it)
│   │   └── Multiple sources → novada_research (reads full content for you — cheaper than N search+extract)
│   ├── Just locating pages (no answer needed yet) → novada_search
│   ├── Explore an entire site → novada_map or novada_crawl
│   └── Multi-faceted question → novada_research
└── Want ranked, cited source material to reason over? → novada_research

Need structured platform data (Amazon, TikTok, LinkedIn…)? → novada_scrape_<platform> if one of the 15 dedicated platform tools exists for it, else generic novada_scrape
Need proxy credentials for your own HTTP requests? → novada_proxy
Page blocked or JS-heavy, need raw HTML? → novada_extract (format:"html", render:"render")
Need to click/fill/screenshot a page? → novada_browser
Check account balance / plans / entitlements? → novada_account
```

**Escalation ladder (pick the lowest rung that answers the question):**
`novada_search` (locate) → `novada_extract` top result (read one page) → `novada_research` (read many sources)

Also read `novada://guide` — it contains the full decision tree and workflow patterns.

## Core Tools

### `novada_search`

**When:** Find pages matching a query. You know what you're looking for, not where it lives.

**Returns: titles, URLs, snippets only.** Snippets are for locating pages, not for answering questions. If the answer needs to be correct (facts, prices, current events, "what does X say"), you MUST either open the top result(s) with `novada_extract`, or use `novada_research` (which reads full sources for you). Never answer a substantive question from snippets alone.

**Key parameters:**
- `query` — your search string
- `engine` — `google` (default), `duckduckgo`, `yandex` (`bing` and `yahoo` are NOT supported — return an error)
- `num` — results count, 1-20 (default 10)
- `time_range` — `day`, `week`, `month`, `year`
- `include_domains` / `exclude_domains` — up to 10 domains each
- `country` — ISO code for geo-targeting (195 countries supported)

**When NOT to use:** You already have the URL — use `novada_extract` instead. You need a factual answer — search gives you candidates to read, not the answer itself.

**Example:**
```json
{
  "query": "Claude API function calling examples 2025",
  "engine": "google",
  "num": 5,
  "time_range": "year",
  "include_domains": ["anthropic.com", "github.com"]
}
```

---

### `novada_extract`

**When:** You have specific URLs and need their content.

**Key parameters:**
- `url` — single URL string, or array of up to 10 URLs for parallel batch
- `urls` — alias for `url` when passing multiple URLs; preferred for batch workflows
- `format` — `markdown` (default), `text`, `html`
- `render` — `auto` (default), `static`, `render` (Web Unblocker), `browser` (full CDP)
- `query` — optional: focuses the content summary on a specific aspect
- `fields` — optional: specific fields to extract, e.g. `["price", "author", "rating"]` (max 20)
- `max_chars` — optional: max characters to return (default 25000, max 100000). Do NOT set to 100000 by default.

**Batch mode:** Pass `url: ["url1", "url2"]` or `urls: ["url1", "url2"]` to extract multiple pages in one call — faster than calling extract once per URL.

**When NOT to use:** You don't have URLs yet — use `novada_search` or `novada_map` first.

**Example (single):**
```json
{ "url": "https://docs.anthropic.com/en/api/getting-started", "format": "markdown" }
```

**Example (batch):**
```json
{
  "url": ["https://example.com/page1", "https://example.com/page2"],
  "format": "markdown",
  "query": "pricing information"
}
```

---

### `novada_crawl`

**When:** You need content from multiple pages of a site but don't have all URLs.

**Key parameters:**
- `url` — starting URL (root)
- `max_pages` — 1-20 (default 5)
- `strategy` — `bfs` (breadth-first, broad coverage) or `dfs` (depth-first, deep paths)
- `select_paths` — glob patterns to restrict to specific paths, e.g. `["/docs/**"]`
- `exclude_paths` — glob patterns to skip, e.g. `["/blog/**", "/changelog/**"]`
- `instructions` — natural language hint: `"only API reference pages"`

**When NOT to use:**
- You just want a list of URLs → use `novada_map` instead (no content extraction)
- You already have all URLs → use `novada_extract` batch

**Example:**
```json
{
  "url": "https://docs.example.com",
  "max_pages": 10,
  "strategy": "bfs",
  "select_paths": ["/api/**"],
  "instructions": "only API endpoint reference pages, skip tutorials"
}
```

---

### `novada_map`

**When:** You need to discover URLs on a site without extracting their content. Site exploration, inventory, link collection.

**Key parameters:**
- `url` — root URL to map
- `limit` — max URLs to return, 1-100 (default 50)
- `max_depth` — link hops from root, 1-5 (default 2)
- `search` — optional keyword to filter returned URLs
- `include_subdomains` — include URLs on subdomains (default false)

**Use then chain:** `novada_map` → filter the URL list → `novada_extract` batch on selected URLs. This is more efficient than `novada_crawl` when you need selective extraction.

**Example:**
```json
{
  "url": "https://docs.example.com",
  "limit": 100,
  "max_depth": 3,
  "search": "authentication"
}
```

---

### `novada_research`

**When:** You have a question that needs multiple sources. You want ranked, cited source material gathered in one call — then you compose the answer.

**What it does:** Generates 3-10 parallel search queries, deduplicates unique sources, extracts full content from the top ones, and returns the most relevant passages under numbered source sections (CITED SOURCE MATERIAL — extractive, not a generated prose report). You write the final answer from it.

**Key parameters:**
- `question` — the research question (full sentence works best)
- `depth` — `auto` (default: picks quick or deep by question length, never comprehensive), `quick` (3 searches), `deep` (6), `comprehensive` (8-9)
- `focus` — optional: `"technical implementation"`, `"business impact"`, `"recent news only"`

**When NOT to use:** You need real-time data or very specific factual lookups — `novada_search` is more precise. You want a finished prose report — this returns source material, not an answer.

**Example:**
```json
{
  "question": "What are the best practices for implementing JWT refresh token rotation in 2025?",
  "depth": "deep",
  "focus": "security and implementation"
}
```

---

### `novada_proxy`

**When:** You need to route your own HTTP requests through residential, mobile, ISP, or datacenter IPs — for geo-targeting, IP rotation, or bypassing IP-based rate limits.

**Key parameters:**
- `type` — `residential` (default), `mobile`, `isp`, `datacenter`
- `country` — ISO 2-letter code (`us`, `gb`, `de`)
- `city` — city-level targeting (requires `country`)
- `session_id` — sticky session — same ID returns same IP for multi-step workflows
- `format` — `url` (default, for Node.js/Python), `env` (shell export commands), `curl` (--proxy flag)

**When NOT to use:** Web page extraction (use `novada_extract` — proxy is automatic). Web search (use `novada_search`).

**Example:**
```json
{ "type": "residential", "country": "us", "session_id": "my-session", "format": "env" }
```

---

### `novada_scrape`

**When:** You need clean, structured records from a known platform — not raw HTML but tabular data. Supports 16 platforms (~88 operations): Amazon, Walmart, SHEIN, Google (incl. Shopping), Bing, DuckDuckGo, Yandex, X/Twitter, TikTok, Instagram, Facebook, YouTube, LinkedIn, GitHub, ChatGPT, Perplexity.

**Key parameters:**
- `platform` — domain, e.g. `amazon.com`, `tiktok.com`, `linkedin.com`
- `operation` — operation ID, e.g. `amazon_product_keywords`, `tiktok_posts_url`
- `params` — operation-specific params, e.g. `{ "keyword": "iphone 16", "num": 5 }`
- `limit` — max records (1-100, default 20)
- `format` — `markdown` (default, agent-optimized), `json` (programmatic)

**Discover platforms:** Read the `novada://scraper-platforms` MCP resource for the complete list with operation IDs and required params.

**When NOT to use:** General web pages not on the platform list (use `novada_extract` or `novada_crawl`). Unknown domains.

**Example:**
```json
{
  "platform": "amazon.com",
  "operation": "amazon_product_keywords",
  "params": { "keyword": "iphone 16", "num": 5 },
  "format": "json"
}
```

---

### `novada_scrape_<platform>` — 15 dedicated per-platform scrapers

**When:** The platform is one of the 15 below. Prefer the dedicated tool over generic `novada_scrape` for these — its `operation` parameter is a **closed, typed enum** scoped to that one platform, so an agent literally cannot pick an operation that belongs to a different platform or doesn't exist. That eliminates the two most common `novada_scrape` failure modes: error 11008 (invalid platform name) and operation-guessing against the wrong platform's op list. Same output rendering as `novada_scrape` (markdown/json/csv/excel/html/toon).

| Tool | Platform | Ops |
|------|----------|-----|
| `novada_scrape_amazon` | amazon.com | 10 |
| `novada_scrape_google` | google.com (web, AI Mode, Maps, Shopping, Jobs, Hotels, Videos) | 13 |
| `novada_scrape_bing` | bing.com | 4 |
| `novada_scrape_duckduckgo` | duckduckgo.com | 1 |
| `novada_scrape_yandex` | yandex.com | 1 |
| `novada_scrape_youtube` | youtube.com | 12 |
| `novada_scrape_instagram` | instagram.com | 7 |
| `novada_scrape_facebook` | facebook.com | 6 |
| `novada_scrape_tiktok` | tiktok.com | 5 |
| `novada_scrape_x` | x.com / twitter.com | 3 |
| `novada_scrape_walmart` | walmart.com | 5 |
| `novada_scrape_shein` | shein.com | 2 (3 known backend_broken ops excluded) |
| `novada_scrape_linkedin` | linkedin.com | 4 |
| `novada_scrape_github` | github.com | 3 |
| `novada_scrape_perplexity` | perplexity.ai | 2 |

**When NOT to use:** The platform isn't in this list (e.g. Walmart is covered, but a platform not among the 16 in the `novada_scrape` catalog is not — use `novada_extract`/`novada_crawl`). ChatGPT has no dedicated tool — its two catalog operations are backend-dead; use generic `novada_scrape` only if the backend is later fixed.

**Example:**
```json
{
  "operation": "linkedin_company_information_url",
  "params": { "url": "https://www.linkedin.com/company/anthropic/" }
}
```

---

### `novada_verify` (back-compat alias — still works)

**When:** You have a factual claim and need to check whether web sources support it before citing it.

**What it does:** Runs 3 parallel searches (supporting, skeptical, neutral fact-check angles) and returns a structured verdict: `supported` / `unsupported` / `contested` / `insufficient_data`. Confidence score 0–100 indicates how far from a 50/50 split.

**Key parameters:**
- `claim` — the factual statement to verify (min 10 chars)
- `context` — optional: narrows search scope, e.g. `"as of 2024"`, `"in the US"`

**When NOT to use:** Open-ended questions (use `novada_research`). Reading a specific URL (use `novada_extract`). Verdict is signal-based, not a definitive ruling.

**Example:**
```json
{ "claim": "The Eiffel Tower is 330 meters tall", "context": "as of 2024" }
```

---

### Raw HTML — use `novada_extract` (`novada_unblock` is a back-compat alias)

**When:** You need the raw rendered HTML of a blocked or JS-heavy page.

**How:** Call `novada_extract` with `format: "html"` and `render: "render"` (Web Unblocker) or `render: "browser"` (full Chromium CDP for complex SPAs). The old `novada_unblock({url, method})` still dispatches to this.

**When NOT to use:** If you want cleaned text (use `novada_extract` with `render="render"` and the default markdown format — it returns clean markdown). Structured platform data (use `novada_scrape`).

**Example:**
```json
{ "url": "https://example.com/protected", "format": "html", "render": "render" }
```

---

### `novada_browser`

**When:** You need to interact with a web page — click buttons, fill forms, scroll, take screenshots, or execute JavaScript. Up to 20 chained actions per session.

**Key parameters:**
- `actions` — ordered list of browser actions (max 20)
- `session_id` — optional: maintain state (cookies, login) across multiple calls; sessions expire after 10 min of inactivity

**Supported actions:** `navigate`, `click`, `type`, `screenshot`, `aria_snapshot`, `evaluate`, `wait`, `scroll`, `hover`, `press_key`, `select`

**Auth:** `NOVADA_API_KEY` auto-provisions Browser API credentials; `NOVADA_BROWSER_WS` is optional (overrides auto-provision). Runs on both local and hosted; only cross-call persistent sessions are local-only. The `country` param is accepted but not yet applied to the exit node — do not rely on it for geo-routing.

**When NOT to use:** Simple page reading (use `novada_extract`). Structured data from a known platform (use `novada_scrape`). Raw HTML without interaction (use `novada_extract` with `format: "html"`).

**Example:**
```json
{
  "actions": [
    { "action": "navigate", "url": "https://example.com/login" },
    { "action": "type", "selector": "#email", "text": "user@example.com" },
    { "action": "type", "selector": "#password", "text": "pass" },
    { "action": "click", "selector": "button[type=submit]" },
    { "action": "aria_snapshot" }
  ]
}
```

---

### `novada_account`

**When:** First-time setup, diagnosing why a tool is failing, or checking your balance, plans, and product entitlements. (The old `novada_health` / `novada_health_all` names dispatch here.)

**Key parameters:** `section` — `summary` (default: wallet balance + plan quotas + recent capture logs + entitlements), `balance`, `usage`, `plans`, `traffic`.

**What it returns:** For `summary`, a full dashboard of wallet balance, per-product plan quotas, and proxy/browser entitlements.

**When NOT to use:** This is an account/diagnostic tool. Don't call it in tight production loops unless you're debugging or checking quota.

**Example:**
```json
{ "section": "summary" }
```

---

## Common Workflows

### Research + Extract
1. `novada_research` for the broad answer
2. Identify key sources from the report
3. `novada_extract` on the most relevant URLs for full content

### Competitive Analysis
1. `novada_search` for competitor pages
2. `novada_extract` batch on top results
3. Synthesize findings

### Full Site Documentation Extraction
1. `novada_map` to discover all doc URLs
2. Filter to relevant paths
3. `novada_extract` batch (up to 10 per call) on filtered list

### Fresh News
1. `novada_search` with `time_range: "week"` or `start_date`
2. `novada_extract` on top 3-5 results

---

## Rules

1. **Batch > sequential**: Always use `novada_extract` with a URL array instead of multiple single-URL calls.
2. **Map before crawl for selective work**: If you only need specific pages, `novada_map` + filter + `novada_extract` is more efficient than `novada_crawl`.
3. **Use `focus` in research**: A focused research question produces tighter, more relevant sub-queries.
4. **Prefer `engine="google"`**: It is the fastest and most reliable. `bing` and `yahoo` are unsupported (return an error); `duckduckgo`/`yandex` are slower fallbacks.
5. **`novada_research` is not a search**: It returns ranked, cited source material to reason over (extractive — you compose the answer), not raw URLs or a finished report. Don't use it for a single lookup.
6. **Deliverable-first for tabular results**: If a result (e.g. from `novada_scrape`) has more than ~10 records, default to producing a downloadable file (xlsx/csv/json — see `novada_scrape`'s Format guide) instead of dumping every row as inline text. Lead your response with the file reference, not a prose recap. Under ~10 records, inline text is still correct.
7. **Snippets ≠ answers (depth rule)**: `novada_search` returns snippets for locating pages. If accuracy matters (facts, prices, current events), open the top 1-3 results with `novada_extract` and read the actual content before answering. For multi-source questions, ONE `novada_research` call is cheaper and better than N manual search+extract calls — prefer it.
8. **Do not thrash on transient errors**: Errors like "No approval received" are auto-retried by the server. Do NOT re-issue the same call manually on a transient error — that double-charges. Retry manually only on an explicit, persistent failure.
