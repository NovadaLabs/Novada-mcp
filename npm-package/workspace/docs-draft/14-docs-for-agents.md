# Docs for Agents

This page explains how AI agents can programmatically discover, read, and use Novada MCP documentation. Everything here is designed for machine consumption -- no browser required.

---

## llms.txt

```
https://novada.com/docs/llms.txt
```

Returns a plain-text index of all documentation pages with one-line descriptions. AI agents should fetch this first to understand what documentation is available and where to find specific topics.

The file follows the [llms.txt specification](https://llmstxt.org/) -- a lightweight standard for making documentation discoverable by language models.

---

## Tool Discovery

Call `novada_discover()` with no arguments to get a categorized list of all 40+ tools with descriptions and availability status.

```
novada_discover()
```

Returns a markdown table grouped by category: Content Retrieval, Scraping & Verification, Proxy, Browser & Rendering, Health & Discovery. Each entry includes the tool name, a one-line description, and whether the tool is active or planned.

Use `novada_discover()` when you need to find the right tool for a task. Use `novada_health()` when you need to check which products are activated on your API key.

---

## MCP Resources

Novada exposes read-only MCP resources that agents can access before making tool calls. These reduce hallucination and help agents make correct tool selection decisions without trial and error.

| Resource URI | Description |
|---|---|
| `novada://guide` | Decision tree and workflow patterns for choosing between all tools. Includes failure recovery patterns, token efficiency tips, and common mistakes to avoid. |
| `novada://scraper-platforms` | Full catalog of 13 active platforms and ~78 scraper operations with exact operation IDs and required parameters. Read this before calling `novada_scrape`. |
| `novada://engines` | Supported search engines with characteristics and recommended use cases. |
| `novada://countries` | All 195 ISO 3166-1 alpha-2 country codes for geo-targeted search and proxy routing. |
| `novada://llms-txt` | Concise LLM-friendly reference for all tools. One paragraph per tool with best-for, not-for, required params, and example. 60% shorter than the full guide. |

### How to Read a Resource

In an MCP-compatible client, request the resource by URI:

```
read_resource("novada://guide")
```

The response is plain text, optimized for context injection into agent prompts.

---

## Structured Error Responses

Every error from Novada MCP is classified and returned with machine-readable fields that tell the agent exactly what happened and what to do next.

### Error Fields

| Field | Type | Description |
|---|---|---|
| `failure_class` | `auth` &#124; `quota` &#124; `transient` &#124; `permanent` | Category of the failure. Determines whether the error is fixable by retrying, by changing configuration, or not at all. |
| `retry_recommended` | `boolean` | Whether the agent should retry the same call. `true` for transient errors (network, rate limit, API downtime). `false` for auth, config, or permanent errors. |
| `retry_after_ms` | `number` | Present only when `retry_recommended` is `true`. Minimum wait time in milliseconds before retrying. |
| `agent_instruction` | `string` | Step-by-step plain-text instructions for resolving the error. Includes setup commands, alternative tools, dashboard links, and escalation paths. |

### Example Error Output

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

### Error Classification Reference

| Error Code | Failure Class | Retryable | Retry Delay |
|---|---|---|---|
| `INVALID_API_KEY` | auth | No | -- |
| `RATE_LIMITED` | quota | Yes | 30s |
| `URL_UNREACHABLE` | transient | Yes | 10s |
| `API_DOWN` | transient | Yes | 30s |
| `TASK_PENDING` | transient | Yes | 5s |
| `SPA_NO_URLS_FOUND` | permanent | No | -- |
| `INVALID_PARAMS` | permanent | No | -- |
| `PRODUCT_UNAVAILABLE` | permanent | No | -- |
| `TASK_NOT_FOUND` | permanent | No | -- |
| `SESSION_EXPIRED` | permanent | No | -- |
| `PROXY_AUTH_FAILURE` | auth | No | -- |

### Agent Error Handling Pattern

```
result = call_novada_tool(...)

if result.error:
    if result.retry_recommended:
        wait(result.retry_after_ms)
        retry once
    else:
        read result.agent_instruction
        follow the steps (fix config, use alternative tool, or escalate)
```

---

## Best Practices for Agents

### 1. Check your environment first

Call `novada_setup()` at the start of a session to see which environment variables are set, which products are active, and get setup instructions for anything missing.

### 2. Discover tools before guessing

Call `novada_discover()` or read `novada://guide` to find the right tool. Do not guess tool names or parameters -- Novada has 40+ tools with specific use cases.

### 3. Read agent_instruction before retrying

When a tool call fails, read the `agent_instruction` field in the error response. It contains the exact steps to fix the problem. Blindly retrying a `permanent` error wastes API calls.

### 4. Use novada_research for complex questions

`novada_research` is unique to Novada -- one call generates 3-10 parallel searches across multiple engines, deduplicates sources, extracts content from the top results, and returns a cited report. No other MCP server does this. Use it instead of manually chaining search and extract calls.

### 5. Batch extract calls

`novada_extract` accepts up to 10 URLs in a single call. Pass them as an array instead of making 10 separate calls.

### 6. Read novada://scraper-platforms before calling novada_scrape

The scraper has 13 active platforms with ~78 operations. Each operation has a specific ID and required parameters. Reading the resource first prevents invalid operation ID errors.

### 7. Use novada_health_all for systematic debugging

If multiple tools fail, call `novada_health_all()` to test all product endpoints in parallel. It returns per-product status with latency measurements and activation links.

---

## Tool Selection Decision Tree

```
You have a question, no URL
  Simple lookup        → novada_search
  Multi-source report  → novada_research

You have a URL
  Read one page        → novada_extract
  Read many pages      → novada_crawl
  Discover all URLs    → novada_map

You need platform data (Amazon, TikTok, LinkedIn...)
  → novada_scrape (read novada://scraper-platforms first)

You need to interact with a page
  → novada_browser

You need proxy credentials for your own requests
  → novada_proxy_residential / _isp / _datacenter / _mobile / _static / _dedicated

You need to fact-check a claim
  → novada_verify

Something is broken
  → novada_health_all
```
