# Novada MCP

**One MCP server for the entire live web.** Search, extract, scrape, crawl, proxy, browser automation, and AI-powered research — behind a single hosted connection, or one local install if you'd rather run it yourself.

[screenshot: Novada connected in an MCP client, tool list visible]

[![npm version](https://img.shields.io/npm/v/novada-mcp)](https://www.npmjs.com/package/novada-mcp)
[![npm downloads](https://img.shields.io/npm/dm/novada-mcp)](https://www.npmjs.com/package/novada-mcp)
[![CI](https://github.com/NovadaLabs/novada-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/NovadaLabs/novada-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](npm-package/LICENSE)

[Quickstart](#quickstart) · [Get your key](#get-your-key) · [How to choose a tool](#how-to-choose-a-tool) · [Why Novada](#why-novada) · [Repository layout](#repository-layout) · [Links](#links)

[![Free to start — $10 in free credits, up to 1,000 API calls/month, no credit card](docs/assets/free-credits-banner.png)](https://dashboard.novada.com/sign-up/)

> ### 🔎 15 dedicated per-platform scrapers
> Amazon, Google, LinkedIn, TikTok, YouTube, GitHub, Walmart, Instagram, Facebook, X, Bing, DuckDuckGo, Yandex, SHEIN, Perplexity — each a closed, typed `operation` enum instead of a generic scrape-and-guess call. See the [Scrape table](#how-to-choose-a-tool) below.

---

## Quickstart

Novada is **hosted-first** — there's nothing to install. Point your client at the hosted URL and you're done.

> **Security note:** the hosted URL contains your API key in the `?token=` parameter — treat it like a password. Never share it, never post it publicly, and never configure it as a shared or organization-level connector.

### claude.ai (web)

1. Go to **Settings → Connectors → Add custom connector**.
2. Name it `Novada`.
3. Paste the URL (contains your key — see security note above):
   ```
   https://mcp.novada.com/mcp?token=YOUR_KEY
   ```
4. Click **Add**.

### Claude Code

```bash
claude mcp add --transport http novada "https://mcp.novada.com/mcp?token=YOUR_KEY"
```

**Full per-client install (Cursor/Windsurf/VS Code + local self-host) → [npm-package/README.md](./npm-package/README.md).**

### Try it

```
novada_setup()                                          — validates your key, shows balance
novada_search({query: "Claude MCP tutorials"})          — web search
novada_extract({url: "https://example.com"})            — read any URL
novada_research({question: "how do MCP servers work?"}) — parallel multi-source research
```

[screenshot: agent calling novada_search and returning results]

---

## Get your key

1. Sign up at [dashboard.novada.com](https://dashboard.novada.com/sign-up/) — no credit card required.
2. Copy your API key from [dashboard.novada.com/api-key](https://dashboard.novada.com/api-key/).
3. You start with **$10 in free credits**, capped at **1,000 calls/month**. Check what's left any time with `novada_account({section: "balance"})` or `novada_setup()`.

---

## How to choose a tool

If you know the exact page you want → `novada_extract`. If you need to find pages first → `novada_search`. If you need cited, multi-source material for a complex question → `novada_research` (extractive source passages, not a generated summary). If you need many pages from one site → `novada_crawl` (bodies inline, capped at 20 pages) or `novada_site_copy` (writes an entire docs site to disk). If you just need the URL list, not content → `novada_map`. If the data lives on a named platform (Amazon, LinkedIn, TikTok, GitHub, etc.) → use the dedicated `novada_scrape_<platform>` tool for that platform (a closed, typed `operation` enum — 15 platforms have one) or the generic `novada_scrape` for the rest, instead of parsing raw HTML yourself. If you need to detect what changed on a page over time → `novada_monitor`; for a brand's footprint on AI-company domains specifically → `novada_ai_monitor`. If you need to fact-check a claim before citing it → `novada_verify`. If a page needs clicks, typing, or a login to reach the data → `novada_browser` (or `novada_browser_flow` for a simpler step sequence). If you need your own HTTP client routed through a specific IP type or geo → `novada_proxy`. Unsure which tool applies at all → call `novada_discover` first; unsure if your key even works → call `novada_setup()` first.

### Quick reference table

**Search**

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_search` | Finding pages by query, with time/domain/geo filters. Engines: google (default), duckduckgo, yandex. | Ranked results (title, url, snippet); optional auto-extracted top result |
| `novada_search_feedback` | Rating a prior `novada_search` result set to improve future ranking | Thank-you/echo confirmation |

**Extract**

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_extract` | Reading one known URL, or up to 10 in parallel, including anti-bot pages | markdown/text/html/json — main content, title, links, structured fields |

**Scrape**

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

**Crawl / Map / Site copy**

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_crawl` | Pulling content from a bounded set of related pages (≤20) on one site | Page bodies inline (markdown/json) |
| `novada_map` | Discovering what URLs exist on a site before deciding what to fetch | Up to 100 URLs, no content |
| `novada_site_copy` | Mirroring an entire docs site or knowledge base to disk | Local `.md` files + a compact manifest (no bodies inline) |

**Proxy**

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_proxy` | Routing your own HTTP client through a specific IP type, country, city, or sticky session | Proxy URL, shell exports, or curl flag |

**Browser**

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_browser` | Full interaction — navigate, click, type, screenshot, evaluate JS — up to 20 actions per call | Action results, screenshots, snapshots; session persists via `session_id` |
| `novada_browser_flow` | Simpler click/scroll/wait/type/screenshot sequences | Action results per step |

**Research**

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_research` | One call → parallel multi-source search, dedup, and extraction for a complex question | Numbered, cited source passages (extractive, not a generated summary) |

**Monitor**

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_monitor` | Detecting changes on a specific page over time | changed/unchanged + optional field-level diffs (baseline is session-scoped) |
| `novada_ai_monitor` | Checking brand mentions on indexed AI-company domains (openai.com, perplexity.ai, anthropic.com, ...) | Per-domain sentiment, key claims, competitor mentions, source URLs |

**Verify**

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_verify` | Fact-checking a claim before citing it | Verdict (supported/unsupported/contested/insufficient_data) + confidence 0–100 |

**Account**

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_account` | Balance, plan quotas, usage history, traffic, capture logs in one call | Unified dashboard, or one `section=` slice |
| `novada_proxy_account_create` | Provisioning a proxy sub-account | Created account details — **WRITE, requires `confirm:true`** |
| `novada_proxy_account_list` | Auditing existing proxy sub-accounts | Paginated list |
| `novada_ip_whitelist` | Managing the proxy IP whitelist (Residential, Unlimited, Static ISP) | Whitelist entries — add/del are **WRITE, require `confirm:true`** |
| `novada_capture_apikey` | Getting or rotating the Capture API key | Current key, or new key on reset — reset is **WRITE, requires `confirm:true`** |
| `novada_static_ip_mgmt` | Managing static ISP IPs | IP list, or purchase/renewal confirmation — open/renew are **WRITE, require `confirm:true`** |

**Discover / Setup**

| Tool | Best for | Returns |
|------|----------|---------|
| `novada_discover` | Finding out which tool to use — call this first if unsure | Full tool catalog: name, description, category, status |
| `novada_setup` | Validating your key on first run; never hard-errors on a missing key | Key status, balance, onboarding guidance |
| `novada_session_stats` | Debugging your own call pattern this session | Per-tool call counts, recent calls, uptime |

**38 tools across 6 categories.** Self-host (`npx novada-mcp`) exposes all 38. The hosted default surface (`mcp.novada.com`) exposes **30** — the same registry minus 8 tools that don't apply to a stateless serverless endpoint (write-gated account mutations, per-process debug state, and two browser tools that need a persistent process) — it is core-derived, not a hand-curated subset. Call `novada_discover` on your connection to see exactly what's available on it.

---

## Why Novada

- **15 dedicated per-platform scrapers.** `novada_scrape_amazon`, `_google`, `_bing`, `_duckduckgo`, `_yandex`, `_youtube`, `_instagram`, `_facebook`, `_tiktok`, `_x`, `_walmart`, `_shein`, `_linkedin`, `_github`, `_perplexity` — each exposes a closed, typed `operation` enum scoped to that platform instead of the generic `novada_scrape`'s open `platform`+`operation` string pair, so an agent can't guess an invalid operation for the wrong platform.
- **Contract-tested self-report.** Tool descriptions are tested against actual behavior, not just written and forgotten — what a tool claims to return is checked against what it actually returns.
- **Drift-guarded tool registry.** `npm-package/src/tools/registry.ts` is the single source of truth for the tool catalog; a test asserts the registered tools, the wired tools, and the `novada_discover` output can never diverge.
- **`confirm:true` write-gate.** Every mutating tool (proxy sub-account creation, IP whitelist changes, static IP purchases, capture-key resets) requires an explicit two-step confirmation — no silent writes.
- **Callable onboarding.** `novada_discover` and `novada_setup` are tools your agent can call itself to find the right tool or validate a key, without ever reading this README.

---

## Repository layout

This is a **monorepo** with two artifacts:

- **`npm-package/`** — the `novada-mcp` npm package. Local stdio MCP server (`npx novada-mcp`); source of truth for all tool logic.
- **`hosted-server/`** — what runs at `https://mcp.novada.com`. An HTTP wrapper (auth, quota, rate-limit) on Vercel around the npm package's built output.

**Full architecture map (entrances, dispatch core, where-does-X-live) → [ARCHITECTURE.md](./ARCHITECTURE.md); contributor routing → [CONTRIBUTING](./npm-package/CONTRIBUTING.md).**

---

## Links

- Website: [novada.com](https://www.novada.com)
- Get an API key: [dashboard.novada.com/api-key](https://dashboard.novada.com/api-key/)
- Sign up (free): [dashboard.novada.com/sign-up](https://dashboard.novada.com/sign-up/)
- npm: [npmjs.com/package/novada-mcp](https://www.npmjs.com/package/novada-mcp)
- GitHub: [github.com/NovadaLabs/novada-mcp](https://github.com/NovadaLabs/novada-mcp)
- Issues: [github.com/NovadaLabs/novada-mcp/issues](https://github.com/NovadaLabs/novada-mcp/issues)

## License

MIT
