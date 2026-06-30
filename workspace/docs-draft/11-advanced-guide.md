# Advanced Scraping Guide

This guide covers the internal mechanics of Novada MCP's rendering, anti-bot handling, domain routing, and extraction pipeline. It progresses from foundational concepts to advanced techniques.

---

## Render Modes

Every URL extraction in Novada flows through a **smart rendering router** (`routeFetch`) that selects the cheapest viable method to fetch a page. There are four modes:

| Mode | Cost | Latency | When to use |
|------|------|---------|-------------|
| `auto` | varies | varies | Default. Let the router decide. |
| `static` | low ($0) | ~170ms P50 | Server-rendered HTML (Wikipedia, GitHub, docs sites) |
| `render` | medium (~$0.001/req) | 5-15s | JS-heavy SPAs, Cloudflare-protected pages |
| `browser` | high (~$3/GB) | 10-30s | Heavy anti-bot fingerprinting, TLS challenges |

### How `auto` mode works

The `auto` router follows a cost-minimizing escalation chain:

```
1. Check DOMAIN_REGISTRY for a known optimal method
   - If match found: use that method directly (skip probing)
   - If no match: continue to step 2

2. Static fetch via Scraper API proxy
   - If page has real content (no JS signals, no bot challenge): return
   - If JS-heavy or bot challenge detected: escalate to step 3

3. Web Unblocker with JS rendering
   - If bot challenge still present AND browser configured: escalate to step 4
   - If JS content resolved: return
   - If still JS-heavy AND browser configured: try step 4

4. Browser API via CDP (last resort)
   - If success: return
   - If failure: return best result from earlier steps
```

### Decision tree for choosing a mode

```
Is the page a known SPA (React, Vue, Angular)?
  YES -> render="render"
  NO  -> Does the page use Cloudflare/DataDome/Kasada protection?
           YES -> render="auto" (router will escalate automatically)
           NO  -> Is the page server-rendered (docs, Wikipedia, news)?
                    YES -> render="static" (fastest)
                    NO  -> render="auto" (safest default)

Need to interact with the page (click, scroll, fill forms)?
  YES -> Use novada_browser tool instead of novada_extract
```

### Forcing a specific mode

```typescript
// Fastest: skip detection, assume server-rendered
novada_extract({ url: "https://docs.python.org/3/library/json.html", render: "static" })

// Force JS rendering for a known SPA
novada_extract({ url: "https://react.dev/learn", render: "render" })

// Force full browser for fingerprint-heavy sites
novada_extract({ url: "https://booking.com/hotel/us/example", render: "browser" })
```

### Understanding the `render-failed` mode

When Web Unblocker is not configured (missing `NOVADA_WEB_UNBLOCKER_KEY`) and `render` mode is requested, the router falls back to static fetch and returns `mode: "render-failed"`. This signals to the caller that JS rendering did NOT occur. The quality score applies a -15 penalty for this mode.

---

## Handling Anti-Bot Protection

Novada detects and handles anti-bot systems automatically in `auto` mode.

### Detection signals

The router uses two detection functions:

**`detectJsHeavyContent`** -- identifies pages that need JS rendering:
- Page content shorter than 200 characters (threshold: `JS_DETECTION_THRESHOLD = 200`)
- Strings like "enable javascript", "javascript is required", "checking your browser"
- Cloudflare markers: "ray id", "cf-browser-verification", `__cf_chl`
- Generic loading indicators: "loading...</p>", "ddos-guard"

**`detectBotChallenge`** -- identifies active bot challenge pages:
- Cloudflare: "just a moment", "cf-browser-verification", `__cf_chl_opt`
- DataDome: "datadome" in page source
- PerimeterX/HUMAN: `_pxhd`, `px-captcha`
- Kasada: "kasada" in page source
- Akamai: `akamai-bm` patterns

### Anti-bot provider identification

After detection, `identifyAntiBot` pinpoints the specific provider for diagnostic output:

| Provider | Detection signal | Typical domains |
|----------|-----------------|-----------------|
| Cloudflare | `cf_chl_`, `cf-browser-verification` | Medium, Reuters, Zillow, Indeed |
| DataDome | `datadome` cookie/script | Amazon (all TLDs), Shein, Ticketmaster |
| PerimeterX/HUMAN | `_pxhd`, `px-captcha` | Walmart, Airbnb, TripAdvisor, Wayfair |
| Kasada | `kasada` script | G2.com |
| Akamai | `akamai-bm` | Steam, Target, Best Buy, Nike, Home Depot |

### The full escalation chain

```
Static fetch
  |
  |--> Content OK? --> Return (cost: low)
  |
  |--> JS-heavy or bot challenge detected
         |
         |--> Web Unblocker (render)
                |
                |--> Content OK? --> Return (cost: medium)
                |
                |--> Still bot challenge?
                       |
                       |--> Browser configured?
                              YES --> Browser API (CDP)
                                        |
                                        |--> Success --> Return (cost: high)
                                        |--> Failure --> Return render-failed + static HTML
                              NO  --> Return render-failed + static HTML
```

### Proxy tiers

Some domains in the registry specify `proxyTier: "residential"`, meaning they require residential IP addresses to bypass IP-reputation-based blocks. Without residential proxy credentials, these domains silently fall back to datacenter IPs, which may trigger additional bot challenges.

Required env vars for residential proxies:
```bash
export NOVADA_RESIDENTIAL_PROXY_USER="your_user"
export NOVADA_RESIDENTIAL_PROXY_PASS="your_pass"
export NOVADA_RESIDENTIAL_PROXY_ENDPOINT="your_endpoint"
```

At startup, the server warns (via stderr) if residential-tier domains exist in the registry but credentials are not configured.

---

## Domain-Specific Routing

### The DOMAIN_REGISTRY

Novada ships with a pre-configured registry of 80+ domains and their optimal fetch strategies. When a URL matches a known domain, the router skips the static-probe step and goes directly to the right method.

Registry entries have this shape:

```typescript
interface DomainEntry {
  method: "static" | "render" | "browser";
  note: string;
  provider?: "cloudflare" | "datadome" | "kasada" | ...;
  proxyTier?: "residential" | "datacenter";
}
```

### Categories in the registry

**Static domains** (cheapest, fastest):
- Developer platforms: `github.com`, `gitlab.com`, `stackoverflow.com`
- Documentation: `docs.python.org`, `developer.mozilla.org`, `docs.anthropic.com`
- News (SSR): `techcrunch.com`, `theverge.com`, `apnews.com`, `arstechnica.com`
- Package registries: `pypi.org`, `crates.io`, `pkg.go.dev`
- Reference: `wikipedia.org`, `arxiv.org`, `archive.org`

**Render domains** (JS execution required):
- E-commerce: `amazon.com` (all TLDs), `ebay.com`, `etsy.com`, `walmart.com`
- Social media: `twitter.com`/`x.com`, `youtube.com`, `instagram.com`, `linkedin.com`
- SPA documentation: `react.dev`, `nextjs.org`, `tailwindcss.com`, `svelte.dev`
- CF-protected content: `medium.com`, `reuters.com`, `openai.com`, `martinfowler.com`
- Chinese platforms: `zhihu.com`, `weibo.com`, `bilibili.com`, `juejin.cn`, `36kr.com`

**Browser domains** (full CDP required):
- `booking.com` -- JS fingerprinting challenge (PerimeterX)
- `glassdoor.com` -- aggressive anti-bot (Cloudflare)
- `g2.com` -- Kasada protection
- `ticketmaster.com`, `stubhub.com` -- DataDome
- `cloudflare.com`, `blog.cloudflare.com` -- self-hosted CF, blocks unblocker
- `discord.com` -- TLS fingerprinting

### Domain lookup logic

The `lookupDomain` function resolves URLs to registry entries:

1. Parse the hostname, strip `www.` prefix
2. Try exact match in registry
3. Try stripping subdomains (e.g., `shop.example.com` matches `example.com`)
4. Return `null` if no match found (falls through to auto-detection)

```typescript
// These all resolve to the amazon.com entry:
lookupDomain("https://www.amazon.com/dp/B09V3K...")    // exact (www stripped)
lookupDomain("https://smile.amazon.com/dp/B09V3K...")  // subdomain match
lookupDomain("https://amazon.com/dp/B09V3K...")        // exact match
```

### When a domain is not in the registry

For unknown domains, `auto` mode performs the full probe chain (static -> detect -> escalate). This works well for most sites but adds latency from the initial static probe. If you know a site is JS-heavy, force `render` mode to skip the probe:

```typescript
// Unknown SPA not in registry -- skip the wasted static probe
novada_extract({ url: "https://some-new-spa.dev/docs", render: "render" })
```

---

## Structured Data Extraction

### The extraction pipeline

Novada's HTML-to-markdown pipeline (`extractMainContent`) processes pages in four stages:

```
1. CLEAN: Remove non-content elements
   - Tags: script, style, noscript, svg, iframe, nav, footer, aside
   - Conditional: site headers (with nav/logo), forms (high link density)
   - Boilerplate: sidebar, menu, cookie, banner, popup, modal, ad regions
   - HTML comments

2. LOCATE: Find the main content area (priority order)
   a. Semantic selectors: <main>, <article>, [role="main"], [class*="content"]
   b. Density scoring: score div/section elements by text length,
      link density, heading count, paragraph count
   c. Fallback: body with boilerplate removed

3. CONVERT: Transform to markdown
   - Headings -> # / ## / ### (preserve hierarchy)
   - Links -> [text](url) with URL resolution
   - Lists -> - / 1. (ordered vs unordered)
   - Code blocks -> ``` with language hint from class="language-xxx"
   - Tables -> markdown tables (data) or plain text (layout)
   - Images -> ![alt](src) (skip base64 data URIs)
   - Inline formatting -> **bold**, *italic*, `code`

4. TRUNCATE: Cap at maxChars (default 25,000)
   - Cut at last paragraph boundary before limit
   - If no good boundary in last 20%, hard-cut at limit
```

### Using the `fields` parameter

The `fields` parameter on `novada_extract` requests specific data points. The extraction pipeline checks JSON-LD structured data first (fastest, most reliable), then falls back to pattern matching.

```typescript
// Extract specific fields from a product page
novada_extract({
  url: "https://amazon.com/dp/B09V3KXJPB",
  fields: ["price", "availability", "rating", "brand"]
})

// Extract article metadata
novada_extract({
  url: "https://techcrunch.com/2024/01/15/some-article",
  fields: ["author", "datePublished", "headline"]
})
```

Supported JSON-LD types and their extractable fields:

| Type | Fields |
|------|--------|
| Product | name, price, currency, availability, description, brand, ratingValue, reviewCount, sku |
| Article/NewsArticle/BlogPosting | headline, author, datePublished, dateModified, description, publisher |
| Event | name, startDate, endDate, location, description, organizer |
| Person | name, jobTitle, description, url |
| Organization | name, description, url, telephone |

### Extraction quality scoring

Every extraction result receives a quality score (0-100) based on additive signals:

| Signal | Points | Condition |
|--------|--------|-----------|
| Structured data found | +20 | Page has JSON-LD |
| Content length >= 5000 chars | +20 | Rich content |
| Content length >= 1000 chars | +10 | Moderate content |
| Content length < 200 chars | -20 | Too little content |
| Has list items (>= 10) | +10 | Structured listings |
| Has 20+ content lines | +5 | Well-structured |
| Link density 5-60% | +10 | Healthy link ratio |
| Has headings (H2/H3) | +10 | Structured content |
| Has code blocks | +5 | Technical content |
| Static mode used | +10 | Cheapest method worked |
| Render mode used | +5 | Mid-cost method |
| Render-failed mode | -15 | JS rendering didn't happen |
| Bot challenge in HTML | -40 | Extraction likely failed |
| Truncated (>= 25k chars) | -5 | Content was cut off |

Quality labels: `excellent` (80+), `good` (60+), `moderate` (40+), `poor` (20+), `low` (<20).

---

## Platform Scraping

For popular platforms (Amazon, Reddit, TikTok, LinkedIn, etc.), `novada_scrape` uses specialized scrapers that return structured records instead of raw HTML.

### How it works

```
1. Submit task: POST to Scraper API with platform + operation + params
2. Poll for result: GET download endpoint every 2s (up to 180s timeout)
3. Extract records: Parse response, flatten nested objects, apply limit
4. Format output: markdown table, JSON, or TOON (token-optimized)
```

### Output formats

| Format | Best for | Token cost |
|--------|----------|------------|
| `markdown` | Human reading, quick review | Medium |
| `json` | Programmatic processing, downstream code | Medium |
| `toon` | Agent consumption, token-constrained contexts | Low (40-65% savings) |

### Operation aliases

Some operation IDs have aliases that auto-resolve:

```
amazon_product_by-keywords  -->  amazon_product_keywords
amazon_product_by-asin      -->  amazon_product_asin
google_shopping             -->  google_shopping_keywords
google_shopping_by-keyword  -->  google_shopping_keywords
```

### Common errors and their meaning

| Code | Error | What to do |
|------|-------|-----------|
| 11006 | Operation ID rejected | Read `novada://scraper-platforms` for the exact ID. Don't guess. |
| 11008 | Unknown platform | Use exact domain (e.g., `amazon.com` not `amazon`). |
| 27202 | Task still processing | Wait and poll again (automatic in `novada_scrape`). |
| 27203 | Server-side task failure | Transient. Retry once. |

---

## Handling JavaScript-Heavy Pages

### Single-Page Applications (React, Vue, Angular)

SPAs serve a minimal HTML shell with JavaScript that renders content client-side. Static fetch returns nearly empty HTML (< 200 chars triggers `detectJsHeavyContent`).

```typescript
// Explicit render for known SPAs
novada_extract({ url: "https://react.dev/learn", render: "render" })

// Auto mode also works -- the router detects the empty HTML and escalates
novada_extract({ url: "https://react.dev/learn", render: "auto" })
```

### Dynamic content with `wait_for`

Some pages load content asynchronously after initial render. Use `wait_for` to delay extraction until a specific CSS selector appears in the DOM:

```typescript
// Wait for price element to load before extracting
novada_extract({
  url: "https://amazon.com/dp/B09V3KXJPB",
  render: "render",
  wait_for: ".a-price-whole"
})

// Wait for search results to render
novada_extract({
  url: "https://example.com/search?q=term",
  render: "browser",
  wait_for: "[data-testid='search-results']"
})
```

### Infinite scroll and pagination

For pages that load content on scroll, use `novada_browser` with scroll actions:

```typescript
novada_browser({
  actions: [
    { action: "navigate", url: "https://example.com/feed", wait_until: "domcontentloaded" },
    { action: "wait", ms: 2000 },
    { action: "scroll", direction: "down" },
    { action: "wait", ms: 2000 },
    { action: "scroll", direction: "down" },
    { action: "wait", ms: 2000 },
    { action: "aria_snapshot" }  // capture the loaded content
  ],
  timeout: 30000
})
```

### Pages behind login

For authenticated content, use `novada_browser` with session persistence:

```typescript
// Step 1: Log in
novada_browser({
  session_id: "my-session",
  actions: [
    { action: "navigate", url: "https://example.com/login", wait_until: "domcontentloaded" },
    { action: "type", selector: "#email", text: "user@example.com" },
    { action: "type", selector: "#password", text: "password" },
    { action: "click", selector: "#submit" },
    { action: "wait", ms: 3000 }
  ],
  timeout: 30000
})

// Step 2: Extract authenticated content (same session_id reuses login state)
novada_browser({
  session_id: "my-session",
  actions: [
    { action: "navigate", url: "https://example.com/dashboard", wait_until: "domcontentloaded" },
    { action: "aria_snapshot" }
  ],
  timeout: 30000
})
```

---

## Batch Operations

### Multi-page extraction with `novada_crawl`

`novada_crawl` performs BFS or DFS crawling up to 20 pages from a starting URL:

```typescript
// Crawl API docs (BFS, up to 10 pages)
novada_crawl({
  url: "https://docs.example.com/api",
  max_pages: 10,
  strategy: "bfs",
  format: "markdown",
  render: "auto",
  select_paths: ["/api/.*"]  // only follow /api/* URLs
})

// Deep crawl a specific section (DFS)
novada_crawl({
  url: "https://docs.example.com/guides/auth",
  max_pages: 5,
  strategy: "dfs",
  format: "json",
  render: "auto",
  exclude_paths: ["/blog/.*", "/changelog/.*"]
})
```

**Performance note:** Crawl time scales linearly at ~1.4s/page. At `max_pages: 20`, expect 28s minimum. Keep `max_pages` low and use `select_paths` to restrict scope.

### URL discovery with `novada_map`

`novada_map` discovers URLs on a site without downloading content. It tries `sitemap.xml` first (fast), then falls back to BFS link crawling:

```typescript
// Discover all URLs on a site
novada_map({ url: "https://example.com", limit: 50 })

// Search for specific pages
novada_map({ url: "https://docs.example.com", search: "authentication" })
```

Use `novada_map` to find URLs, then `novada_extract` to read specific pages. This is faster and cheaper than crawling everything.

### Output pipeline

All extraction and scrape results are automatically saved to `~/Downloads/novada-mcp/`:

```
~/Downloads/novada-mcp/
  extract/
    github-com-20240115-143022.md
    react-dev-20240115-143156.md
  search/
    ai-agents-20240115-142800.md
  scrape/
    amazon-com-20240115-144500.csv
    reddit-com-20240115-145200.json
  crawl/
    docs-example-com-20240115-150000.md
```

---

## Performance Optimization

### Search cache

Search results are cached in memory for 60 seconds. Identical queries (same engine + query + num) return instantly from cache:

```typescript
// First call: hits the API (~2-5s)
novada_search({ query: "AI agents 2024", engine: "google", num: 10 })

// Second call within 60s: returns from cache (~0ms)
novada_search({ query: "AI agents 2024", engine: "google", num: 10 })
```

The cache holds up to 100 entries. When full, the oldest entry is evicted. Empty results are also cached to prevent repeated failed API calls.

### HTTP connection pooling

All HTTP clients use `keepAlive: true` with `maxSockets: 10`, reusing TCP connections across requests. This eliminates TLS handshake overhead for repeated calls to the same host.

### Expected latency by mode

| Operation | P50 latency | Notes |
|-----------|------------|-------|
| Static extract | ~170ms | Direct proxy fetch, no JS |
| Render extract | 5-15s | Web Unblocker JS execution |
| Browser extract | 10-30s | Full Chromium launch + render |
| Search (Google) | 2-5s | Scraper API submit + poll |
| Platform scrape | 10-180s | Depends on platform complexity |

### Tips for faster extractions

1. **Use `static` mode** when you know the page is server-rendered. Skips the JS-detection probe.
2. **Use `auto` mode** (default) for unknown pages. The DOMAIN_REGISTRY shortcut avoids wasted probes for known domains.
3. **Avoid `browser` mode** unless necessary. It is 50-100x more expensive than static.
4. **Batch with `novada_extract`** (array of URLs, up to 10) for parallel extraction.
5. **Use `novada_map`** before `novada_crawl` to identify which URLs actually matter.

---

## Troubleshooting

### Error codes and what they mean

Novada uses typed error codes with structured `agent_instruction` hints:

| Code | Class | Retryable | Meaning |
|------|-------|-----------|---------|
| `INVALID_API_KEY` | auth | No | API key missing or invalid |
| `RATE_LIMITED` | quota | Yes (30s) | Too many requests, back off |
| `URL_UNREACHABLE` | transient | Yes (10s) | Target URL down or unreachable |
| `SPA_NO_URLS_FOUND` | permanent | No | JS SPA, static crawl found nothing |
| `API_DOWN` | transient | Yes (30s) | Novada API temporarily unavailable |
| `INVALID_PARAMS` | permanent | No | Bad parameters, fix and retry |
| `PRODUCT_UNAVAILABLE` | permanent | No | Product not activated on account |
| `TASK_NOT_FOUND` | permanent | No | Scraper task expired or invalid |
| `TASK_PENDING` | transient | Yes (5s) | Scraper task still processing |
| `SESSION_EXPIRED` | permanent | No | Browser session timed out |
| `PROXY_AUTH_FAILURE` | auth | No | Proxy credentials invalid |

### Reading `agent_instruction` hints

Every error response includes an `agent_instruction` field with actionable next steps. These are designed to be read and acted upon by AI agents:

```
error_code: PRODUCT_UNAVAILABLE
failure_class: permanent
retry_recommended: false
agent_instruction: "This Novada product is not active on your API key. Three options:
  Option 1 -- Activate (recommended): Visit https://dashboard.novada.com/overview/
  Option 2 -- Use alternatives: novada_extract, novada_unblock, novada_crawl
  Option 3 -- Contact support: support@novada.com"
```

### Diagnostics with `novada_health_all`

Run `novada_health_all` to test all 6 Novada product endpoints in parallel:

```typescript
novada_health_all()
// Returns:
// | Product   | Status | Latency | Notes |
// |-----------|--------|---------|-------|
// | Search    | OK     | 234ms   |       |
// | Extract   | OK     | 178ms   |       |
// | Scraper   | OK     | 312ms   |       |
// | Proxy     | OK     | 89ms    |       |
// | Browser   | NOT_CONFIGURED | - | Set NOVADA_BROWSER_WS |
// | Unblock   | OK     | 1,203ms |       |
```

If a product shows `PRODUCT_UNAVAILABLE`, the output includes a direct activation link. If it shows `NOT_CONFIGURED`, export the required environment variable and restart the MCP server.

### Common troubleshooting patterns

**Empty or minimal content returned:**
1. Check if the page is a JS SPA -- try `render="render"`
2. If still empty, try `render="browser"`
3. If the page requires login, use `novada_browser` with session persistence
4. Run `novada_map` on the domain to find the correct URL

**Bot challenge detected (quality score < 20):**
1. `auto` mode should handle this, but check if residential proxies are configured
2. Try `novada_unblock` with `method="browser"` for the toughest sites
3. Check `novada_health_all` to confirm all products are active

**Scraper returns "code 11006":**
1. The operation ID is wrong. Do not guess operation IDs.
2. Read the `novada://scraper-platforms` resource for the exact canonical ID.
3. Try known aliases (e.g., `amazon_product_by-keywords` auto-resolves to `amazon_product_keywords`).
4. If the operation ID is confirmed correct, the Scraper API product may not be activated.

**Slow extractions (> 30s):**
1. Force `render="static"` if you know the page is server-rendered
2. Reduce `max_chars` to avoid processing large DOMs
3. For batch work, use `novada_crawl` with `select_paths` to restrict scope
4. Check if the domain is in `DOMAIN_REGISTRY` -- unknown domains add a probe step
