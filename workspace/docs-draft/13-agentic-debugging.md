# Agentic Debugging

A self-help guide for AI agents when Novada MCP tools fail. Every error is structured and machine-readable. Follow the `agent_instruction` field first -- it contains the exact next step.

---

## When Tools Fail

Every Novada error response includes four structured fields:

| Field | Type | Purpose |
|-------|------|---------|
| `failure_class` | `auth` \| `quota` \| `transient` \| `permanent` | What category of failure this is |
| `retry_recommended` | `true` \| `false` | Whether retrying the same call may succeed |
| `retry_after_ms` | integer | Milliseconds to wait before retrying (only present when retry is recommended) |
| `agent_instruction` | string | Plain-language guidance on what to do next |

### Decision Tree

```
Error received
  |
  +-- Read agent_instruction FIRST
  |
  +-- Check failure_class:
  |     |
  |     +-- auth       --> credentials are wrong or missing. Do not retry.
  |     +-- quota      --> rate limit hit. Wait retry_after_ms, then retry.
  |     +-- transient  --> temporary failure (network, API down). Retry after delay.
  |     +-- permanent  --> bad params, product not activated, or invalid request. Fix input.
  |
  +-- Check retry_recommended:
        |
        +-- true  --> wait retry_after_ms, retry the same call
        +-- false --> do NOT retry. Fix the issue described in agent_instruction.
```

### Retry Timing by Error Code

| Error Code | failure_class | retry_recommended | retry_after_ms | Action |
|------------|---------------|-------------------|----------------|--------|
| `RATE_LIMITED` | quota | true | 30000 | Wait 30s, retry. Use exponential backoff. |
| `URL_UNREACHABLE` | transient | true | 10000 | Wait 10s, retry once. Try `novada_unblock` if second attempt fails. |
| `API_DOWN` | transient | true | 30000 | Wait 30s, retry. Check status.novada.com if persistent. |
| `TASK_PENDING` | transient | true | 5000 | Wait 5s, poll `novada_scraper_status` again. Backoff: 5s, 10s, 20s, 40s. |
| `INVALID_API_KEY` | auth | false | -- | Fix the API key. Run `novada_setup` for instructions. |
| `PRODUCT_UNAVAILABLE` | permanent | false | -- | Activate the product at dashboard.novada.com. |
| `INVALID_PARAMS` | permanent | false | -- | Fix parameters. Check tool description for constraints. |
| `TASK_NOT_FOUND` | permanent | false | -- | Task expired (24h TTL). Re-submit with `novada_scraper_submit`. |
| `SESSION_EXPIRED` | permanent | false | -- | Browser session expired (10min idle). Start a new session. |
| `PROXY_AUTH_FAILURE` | auth | false | -- | Check `NOVADA_PROXY_USER` and `NOVADA_PROXY_PASS`. |
| `SPA_NO_URLS_FOUND` | permanent | false | -- | Site is a JS SPA. Use `novada_crawl` with `render="render"` instead of `novada_map`. |
| `UNKNOWN` | permanent | false | -- | Unexpected error. Check message for details. Contact support@novada.com. |

---

## Diagnostic Tools

Three built-in tools for diagnosing issues. Run them in this order when something is wrong.

### 1. `novada_setup()` -- Environment Check

**When to use:** First tool to run. Shows whether environment variables are configured correctly.

**What it returns:**
- Status of all env vars (`NOVADA_API_KEY`, `NOVADA_PROXY_*`, `NOVADA_BROWSER_WS`)
- Whether each variable is set, empty, or missing
- Step-by-step setup instructions for the current MCP client
- Config snippets ready to copy-paste

**No authentication required.** This tool works even when `NOVADA_API_KEY` is not set.

```
novada_setup()
```

### 2. `novada_health_all()` -- Product Endpoint Test

**When to use:** After confirming env vars are set. Tests all 6 product endpoints in parallel.

**What it returns:**
- Per-product status table: product name, status, latency, notes
- Products tested: Search, Extract, Scraper, Proxy, Browser, Unblock
- Activation links for any product showing `PRODUCT_UNAVAILABLE`
- Partial failures are isolated -- one product down does not block others

```
novada_health_all()
```

### 3. `novada_discover()` -- Tool Catalog

**When to use:** To see all available tools, their categories, and status (active/todo).

**What it returns:**
- Full tool list grouped by category
- Category filter supported: `"Content Retrieval"`, `"Scraping & Verification"`, `"Proxy"`, `"Browser & Rendering"`, `"Health & Discovery"`, `"Auth"`

```
novada_discover()
novada_discover({ category: "Proxy" })
```

### Diagnostic Sequence

When a tool fails and you need to figure out why:

```
Step 1: novada_setup()        -- Are env vars configured?
Step 2: novada_health_all()   -- Are product endpoints reachable?
Step 3: novada_discover()     -- Is the tool loaded? (Check NOVADA_TOOLS / NOVADA_GROUPS filters)
```

If all three pass and the tool still fails, the issue is with the specific request parameters or the target URL.

---

## Common Issues and Fixes

### Authentication and Configuration

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Error [INVALID_API_KEY]: Invalid or missing API key` | `NOVADA_API_KEY` not set or contains invalid value | Set `NOVADA_API_KEY` in your MCP config. Get a key at dashboard.novada.com. Run `novada_setup()` for config snippets. |
| `Error [PROXY_AUTH_FAILURE]: Proxy authentication failed` | Proxy credentials wrong or expired | Check `NOVADA_PROXY_USER`, `NOVADA_PROXY_PASS`, and `NOVADA_PROXY_ENDPOINT`. Regenerate at dashboard.novada.com/overview/proxy/. |
| `Error [PRODUCT_UNAVAILABLE]: Product not activated` | The specific product (Scraper, Proxy, Browser) is not enabled on your plan | Visit dashboard.novada.com/overview/products/ to activate. Alternative: use a different tool (e.g., `novada_extract` instead of `novada_scrape`). |
| Tools not appearing in MCP client | `NOVADA_TOOLS` or `NOVADA_GROUPS` filter is excluding them | Remove the filter env vars, or add the needed tool/group. `novada_health` and `novada_setup` are always loaded regardless of filters. |

### Content Extraction

| Symptom | Cause | Fix |
|---------|-------|-----|
| `novada_extract` returns empty or navigation-only content | Page is JavaScript-rendered (SPA) | Set `render: "render"` to force JS rendering. Or add `wait_for: ".main-content"` (CSS selector) to wait for dynamic content. |
| `novada_extract` returns truncated content | Content exceeds `max_chars` limit (default 25000) | Increase `max_chars` up to 100000. Do not set to 100000 by default -- only when needed. |
| `novada_extract` returns wrong page content | URL redirects to a different page | Check the actual URL after redirect. Use `novada_unblock` to see the raw HTML and find the correct URL. |
| `novada_crawl` returns 0 pages | `select_paths` regex too restrictive or site blocks crawlers | Broaden the regex. Try without `select_paths` first. Set `render: "render"` for JS-heavy sites. |

### Search and Research

| Symptom | Cause | Fix |
|---------|-------|-----|
| `novada_search` returns 0 results | Engine temporarily unavailable or query too specific | Try a different `engine` (google, bing, duckduckgo). Broaden the query. Check `time_range` is not too narrow. |
| `novada_research` takes too long | `depth: "comprehensive"` generates 8-10 parallel queries | Use `depth: "quick"` (3 queries) or `depth: "auto"` (server decides). |
| Search results are irrelevant | Query is too broad or uses keywords instead of natural language | Rewrite query as a natural-language description of the ideal page. Use `include_domains` to restrict to known-good sources. |

### Proxy

| Symptom | Cause | Fix |
|---------|-------|-----|
| Proxy tools return "credentials not configured" | `NOVADA_PROXY_USER`, `NOVADA_PROXY_PASS`, or `NOVADA_PROXY_ENDPOINT` not set | Set all three env vars. Run `novada_setup()` to see which are missing. |
| Proxy connection refused (HTTP 407) | Wrong username/password or account expired | Regenerate credentials at dashboard.novada.com. Verify with `novada_health_all()`. |
| Sticky session returns different IPs | `session_id` not passed or format invalid | Pass `session_id` parameter (alphanumeric + underscore/hyphen, max 64 chars). Same `session_id` = same IP. |

### Browser Automation

| Symptom | Cause | Fix |
|---------|-------|-----|
| `novada_browser` returns "NOVADA_BROWSER_WS not set" | WebSocket URL not configured | Set `NOVADA_BROWSER_WS` env var. Get the URL from your Novada dashboard. |
| `Error [SESSION_EXPIRED]: Browser session expired` | Session inactive for >10 minutes | Remove `session_id` param to start a new session. Sessions auto-expire after 10min of inactivity. |
| Actions timeout on SPA pages | Page never reaches `networkidle` | Use `wait_until: "domcontentloaded"` instead of `networkidle`. SPAs continuously poll and never reach network idle. |
| Screenshots are blank | Page not fully loaded before screenshot action | Add a `wait` action before `screenshot`: `{action: "wait", ms: 3000}` or `{action: "wait", selector: "#content"}`. |

### Scraping

| Symptom | Cause | Fix |
|---------|-------|-----|
| `novada_scrape` returns "operation not found" | Wrong `operation` ID for the platform | Run `novada_discover()` or read the `novada://scraper-platforms` resource for valid operation IDs. |
| Async scraper task stuck in "pending" | Long processing time or backend queue | Poll `novada_scraper_status` with exponential backoff (5s, 10s, 20s, 40s). Tasks can take up to 5 minutes. |
| Scraper returns partial data | Platform page layout changed or rate-limited | Retry once. If still partial, use `novada_extract` on the URL directly as fallback. |

---

## Reading Error Responses

Every Novada error follows the same structure. Here is a real error response with annotations:

```
Error [INVALID_API_KEY]: Invalid or missing API key. Get one at https://www.novada.com
failure_class: auth
retry_recommended: false
agent_instruction: "Your API key is missing or invalid. Do not retry until the key is fixed.

Setup (one-time):
  claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada

Verify the key is active:
  Run novada_health -- it will confirm which products are accessible.

Get a key: https://dashboard.novada.com/overview/"
```

### Field Breakdown

| Line | Field | Meaning |
|------|-------|---------|
| `Error [INVALID_API_KEY]: ...` | Error code + message | Machine-parseable code in brackets. Human-readable message after colon. |
| `failure_class: auth` | Classification | This is an authentication error. Other values: `quota`, `transient`, `permanent`. |
| `retry_recommended: false` | Retry signal | Do not retry this call -- it will fail again with the same input. |
| `agent_instruction: "..."` | Next step | The exact action to take. Follow this first. Contains setup commands, alternative tools, and dashboard links. |

### Another Example: Retryable Error

```
Error [RATE_LIMITED]: Rate limit exceeded. API is throttling your requests.
failure_class: quota
retry_recommended: true
retry_after_ms: 30000
agent_instruction: "You have hit the Novada API rate limit. This is temporary and retryable.

Action: Wait 30-60 seconds before retrying this tool call.
Strategy: Use exponential backoff for automated retries (delay doubles each attempt).
Avoid: Parallel calls to the same endpoint -- serialize them instead."
```

Note the additional `retry_after_ms: 30000` field. This only appears when `retry_recommended` is `true`.

### Another Example: Product Not Activated

```
Error [PRODUCT_UNAVAILABLE]: Product not activated on your account.
failure_class: permanent
retry_recommended: false
agent_instruction: "This Novada product is not active on your API key. Three options:

Option 1 -- Activate (recommended):
  Visit: https://dashboard.novada.com/overview/products/
  Enable the required product, then retry.

Option 2 -- Use an alternative tool:
  novada_search unavailable? Try: novada_research (uses internal search)
  novada_scrape unavailable? Try: novada_extract on the target URL directly
  novada_unblock unavailable? Try: novada_browser with navigate action

Option 3 -- Contact support:
  Email: support@novada.com -- include your API key prefix and this error code."
```

The `agent_instruction` provides three escalation paths, ordered by likelihood of success.

---

## Escalation Paths

When the `agent_instruction` does not resolve the issue:

| Step | Action |
|------|--------|
| 1 | Follow the `agent_instruction` exactly as written |
| 2 | Run `novada_setup()` to verify environment configuration |
| 3 | Run `novada_health_all()` to test all product endpoints |
| 4 | Try an alternative tool (see "Alternative Tools" below) |
| 5 | Check status.novada.com for platform-wide incidents |
| 6 | Contact support@novada.com with the full error text and your API key prefix |

### Alternative Tools

When one tool fails, another may accomplish the same goal:

| Failed Tool | Alternative | When to Switch |
|-------------|-------------|----------------|
| `novada_search` | `novada_research` | Research uses its own internal search |
| `novada_scrape` | `novada_extract` | Extract works on any URL, just returns markdown instead of structured records |
| `novada_extract` | `novada_unblock` | Use when extract returns empty on bot-protected pages |
| `novada_unblock` | `novada_browser` | Use when unblock fails -- browser has full CDP control |
| `novada_map` | `novada_crawl` | Map fails on SPAs; crawl with `render="render"` handles them |
| `novada_crawl` | `novada_extract` (batch) | Pass `url` as an array of known URLs instead of crawling |
| `novada_browser` | `novada_browser_flow` | Flow is a simpler API for common automation patterns |

---

## Error Code Reference

Complete list of all error codes, their classification, and the recommended response.

| Code | Class | Retryable | Default Delay | Summary |
|------|-------|-----------|---------------|---------|
| `INVALID_API_KEY` | auth | No | -- | API key missing, invalid, or expired |
| `RATE_LIMITED` | quota | Yes | 30s | Too many requests. Backoff and retry. |
| `URL_UNREACHABLE` | transient | Yes | 10s | Target URL is down or unreachable |
| `SPA_NO_URLS_FOUND` | permanent | No | -- | JavaScript SPA detected, no static URLs |
| `API_DOWN` | transient | Yes | 30s | Novada API returning 5xx errors |
| `INVALID_PARAMS` | permanent | No | -- | Parameters failed validation |
| `PRODUCT_UNAVAILABLE` | permanent | No | -- | Product not activated on API key |
| `TASK_NOT_FOUND` | permanent | No | -- | Async task ID expired or invalid |
| `TASK_PENDING` | transient | Yes | 5s | Async task still processing |
| `SESSION_EXPIRED` | permanent | No | -- | Browser session timed out |
| `PROXY_AUTH_FAILURE` | auth | No | -- | Proxy credentials invalid |
| `UNKNOWN` | permanent | No | -- | Unclassified error |
