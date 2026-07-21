# Novada MCP — complete tool reference

Every tool Novada MCP exposes, grouped by category. The [README](../README.md) shows only the
handful you reach for most; this is the full list.

- **38 tools across 6 categories.** Self-host (`npx novada-mcp`) exposes all 38.
- The hosted default surface (`mcp.novada.com`) exposes **30** — the same registry minus 8 tools
  that don't apply to a stateless serverless endpoint (write-gated account mutations, per-process
  debug state, and two browser tools that need a persistent process). It's core-derived, not a
  hand-curated subset.
- Not sure what's on your connection? Call **`novada_discover`** — it returns this catalog live,
  with each tool's name, category, and status.

---

## Search

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_search` | Finding pages by query, with time/domain/geo filters. Engines: google (default), duckduckgo, yandex. | Ranked results (title, url, snippet); optional auto-extracted top result |
| `novada_search_feedback` | Rating a prior `novada_search` result set to improve future ranking | Thank-you/echo confirmation |

## Extract

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_extract` | Reading one known URL, or up to 10 in parallel, including anti-bot pages | markdown/text/html/json — main content, title, links, structured fields |

## Scrape

`novada_scrape` is the generic gateway (16 platforms, ~87 operations). The 15 `novada_scrape_<platform>`
tools wrap the same backend behind a **closed, typed `operation` enum** scoped to one platform, so an
agent can't call an invalid operation for the wrong platform. Every listed `operation` is
verified-working — operations we can't currently deliver are excluded, not left in to fail on you.

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_scrape` | Structured data from 16 supported platforms (~87 operations) — Amazon, Walmart, LinkedIn, TikTok, YouTube, Instagram, GitHub, X, ChatGPT, Perplexity, etc. — instead of parsing raw HTML | Clean records in markdown/json/csv/excel/html/toon |
| `novada_scrape_amazon` | Amazon-only structured data (product, reviews, seller, bestsellers, category/brand listings) via a closed, typed `operation` enum — 10 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_google` | Google-only raw SERP data (web search, AI Mode, Maps details/reviews, Shopping, Jobs, Hotels, Videos) via a closed, typed `operation` enum — 13 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_bing` | Bing-only raw SERP data (web search, videos, news, shopping) via a closed, typed `operation` enum — 4 verified-working operations; Bing is not a selectable `novada_search` engine | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_duckduckgo` | DuckDuckGo-only raw SERP data (web search) via a closed, typed `operation` enum — 1 verified-working operation | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_yandex` | Yandex-only raw SERP data (web search) via a closed, typed `operation` enum — 1 verified-working operation | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_youtube` | YouTube-only structured data (video/channel info, transcripts, comments, video/audio downloads) via a closed, typed `operation` enum — 13 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_instagram` | Instagram-only structured data (profiles, posts, reels, comments) via a closed, typed `operation` enum — 7 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_facebook` | Facebook-only structured data (profiles, posts, comments, events) via a closed, typed `operation` enum — 6 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_tiktok` | TikTok-only structured data (profiles, posts, hashtag/discover listings) via a closed, typed `operation` enum — 5 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_x` | X (Twitter)-only structured data (post details, profile lookup by username or URL) via a closed, typed `operation` enum — 3 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_walmart` | Walmart-only structured data (product details by keyword/category URL/SKU/zip code/URL) via a closed, typed `operation` enum — 5 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_shein` | SHEIN-only structured product data (by product ID or product URL) via a closed, typed `operation` enum — 2 verified-working operations (3 known backend_broken ops excluded) | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_linkedin` | LinkedIn-only structured data (job listings by filters/search URL/job URL, company info by URL) via a closed, typed `operation` enum — 4 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_github` | GitHub-only structured repository data (by repository URL or a search-results URL) via a closed, typed `operation` enum — 3 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_perplexity` | Perplexity AI's own generated answer for a query (by URL or search term) via a closed, typed `operation` enum — 2 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |

## Crawl / Map / Site copy

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_crawl` | Pulling content from a bounded set of related pages (≤20) on one site | Page bodies inline (markdown/json) |
| `novada_map` | Discovering what URLs exist on a site before deciding what to fetch | Up to 100 URLs, no content |
| `novada_site_copy` | Mirroring an entire docs site or knowledge base to disk | Local `.md` files + a compact manifest (no bodies inline) |

## Proxy

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_proxy` | Routing your own HTTP client through a specific IP type, country, city, or sticky session | Proxy URL, shell exports, or curl flag |

## Browser

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_browser` | Full interaction — navigate, click, type, screenshot, evaluate JS — up to 20 actions per call | Action results, screenshots, snapshots; session persists via `session_id` |
| `novada_browser_flow` | Simpler click/scroll/wait/type/screenshot sequences | Action results per step |

## Research

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_research` | One call → parallel multi-source search, dedup, and extraction for a complex question | Numbered, cited source passages (extractive, not a generated summary) |

## Monitor

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_monitor` | Detecting changes on a specific page over time | changed/unchanged + optional field-level diffs (baseline is session-scoped) |
| `novada_ai_monitor` | Checking brand mentions on indexed AI-company domains (openai.com, perplexity.ai, anthropic.com, ...) | Per-domain sentiment, key claims, competitor mentions, source URLs |

## Verify

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_verify` | Fact-checking a claim before citing it | Verdict (supported/unsupported/contested/insufficient_data) + confidence 0–100 |

## Account

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_account` | Balance, plan quotas, usage history, traffic, capture logs in one call | Unified dashboard, or one `section=` slice |
| `novada_proxy_account_create` | Provisioning a proxy sub-account | Created account details — **WRITE, requires `confirm:true`** |
| `novada_proxy_account_list` | Auditing existing proxy sub-accounts | Paginated list |
| `novada_ip_whitelist` | Managing the proxy IP whitelist (Residential, Unlimited, Static ISP) | Whitelist entries — add/del are **WRITE, require `confirm:true`** |
| `novada_capture_apikey` | Getting or rotating the Capture API key | Current key, or new key on reset — reset is **WRITE, requires `confirm:true`** |
| `novada_static_ip_mgmt` | Managing static ISP IPs | IP list, or purchase/renewal confirmation — open/renew are **WRITE, require `confirm:true`** |

## Discover / Setup

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_discover` | Finding out which tool to use — call this first if unsure | Full tool catalog: name, description, category, status |
| `novada_setup` | Validating your key on first run; never hard-errors on a missing key | Key status, balance, onboarding guidance |
| `novada_session_stats` | Debugging your own call pattern this session | Per-tool call counts, recent calls, uptime |
