> **This folder IS the npm package published as `novada-mcp`** — a local stdio MCP server (`npx novada-mcp`). It lives inside the [novada-mcp monorepo](../README.md); the hosted `mcp.novada.com` wrapper is in [`../hosted-server/`](../hosted-server/README.md).

# Novada MCP

**One MCP server for the entire live web.** Search, extract, scrape, crawl, proxy, browser automation, and AI-powered research — behind a single hosted connection, or one local install if you'd rather run it yourself.

[screenshot: Novada connected in an MCP client, tool list visible]

[![npm version](https://img.shields.io/npm/v/novada-mcp)](https://www.npmjs.com/package/novada-mcp)
[![npm downloads](https://img.shields.io/npm/dm/novada-mcp)](https://www.npmjs.com/package/novada-mcp)
[![CI](https://github.com/NovadaLabs/novada-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/NovadaLabs/novada-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Quickstart](#quickstart) · [Get your key](#get-your-key) · [How to choose a tool](#how-to-choose-a-tool) · [Troubleshooting](#troubleshooting) · [Why Novada](#why-novada) · [Links](#links)

> ### 🎁 Free to start — no credit card
> Sign up and get **$10 in free credits (up to 1,000 API calls/month)**. [Get your free key →](https://dashboard.novada.com/sign-up/)

---

## Quickstart

Novada is **hosted-first** — there's nothing to install. Point your client at the hosted URL and you're done. Every client below also has a local self-host fallback (`npx novada-mcp`) if you'd rather run the server yourself.

> **Security note:** the hosted URL contains your API key in the `?token=` parameter — treat it like a password. Never share it, never post it publicly, and never configure it as a shared or organization-level connector.

### claude.ai (web)

1. Go to **Settings → Connectors → Add custom connector**.
2. Name it `Novada`.
3. Paste the URL (contains your key — see security note above):
   ```
   https://mcp.novada.com/mcp?token=YOUR_KEY
   ```
4. Click **Add**.

claude.ai runs entirely in the browser, so only the hosted endpoint applies here — there's no local variant for this client.

### Claude Desktop

Uses the same **Settings → Connectors → Add custom connector** flow as claude.ai above — paste the same hosted URL. Prefer a config file instead? Edit `claude_desktop_config.json`:

**Hosted:**
```json
{
  "mcpServers": {
    "novada": {
      "url": "https://mcp.novada.com/mcp?token=YOUR_KEY"
    }
  }
}
```

**Local (self-host):**
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp"],
      "env": { "NOVADA_API_KEY": "your_key" }
    }
  }
}
```

### Claude Code

**Hosted:**
```bash
claude mcp add --transport http novada "https://mcp.novada.com/mcp?token=YOUR_KEY"
```

**Local (self-host):**
```bash
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp
```

### Cursor

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project-scoped):

**Hosted:**
```json
{
  "mcpServers": {
    "novada": {
      "url": "https://mcp.novada.com/mcp?token=YOUR_KEY"
    }
  }
}
```

**Local (self-host):**
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp"],
      "env": { "NOVADA_API_KEY": "your_key" }
    }
  }
}
```

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

**Hosted:**
```json
{
  "mcpServers": {
    "novada": {
      "serverUrl": "https://mcp.novada.com/mcp?token=YOUR_KEY"
    }
  }
}
```

**Local (self-host):**
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp"],
      "env": { "NOVADA_API_KEY": "your_key" }
    }
  }
}
```

### VS Code

Edit `.vscode/mcp.json` (top-level key is `servers`, not `mcpServers`):

**Hosted:**
```json
{
  "servers": {
    "novada": {
      "type": "http",
      "url": "https://mcp.novada.com/mcp?token=YOUR_KEY"
    }
  }
}
```

**Local (self-host):**
```json
{
  "servers": {
    "novada": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "novada-mcp"],
      "env": { "NOVADA_API_KEY": "your_key" }
    }
  }
}
```

### Try it

```
novada_setup()                                          — validates your key, shows balance
novada_search({query: "Claude MCP tutorials"})          — web search
novada_extract({url: "https://example.com"})            — read any URL
novada_research({question: "how do MCP servers work?"}) — parallel multi-source research
```

[screenshot: agent calling novada_search and returning results]

> Self-hosting? Always use `npx -y novada-mcp` (not a global install) — a globally installed binary can silently shadow the package and run an old cached version.

---

## Get your key

1. Sign up at [dashboard.novada.com](https://dashboard.novada.com/sign-up/) — no credit card required.
2. Copy your API key from [dashboard.novada.com/api-key](https://dashboard.novada.com/api-key/).
3. You start with **$10 in free credits**, capped at **1,000 calls/month**. Light tools (search, extract) draw down a small fraction of that per call; heavier tools (browser, scrape, proxy) cost more per call and can exhaust the starter balance well before 1,000 calls. Check what's left any time with `novada_account({section: "balance"})` or `novada_setup()`.

---

## How to choose a tool

If you know the exact page you want → `novada_extract`. If you need to find pages first → `novada_search`. If you need cited, multi-source material for a complex question → `novada_research` (extractive source passages, not a generated summary). If you need many pages from one site → `novada_crawl` (bodies inline, capped at 20 pages) or `novada_site_copy` (writes an entire docs site to disk). If you just need the URL list, not content → `novada_map`. If the data lives on a named platform (Amazon, LinkedIn, TikTok, GitHub, etc.) → `novada_scrape` returns clean structured records instead of raw HTML you'd have to parse yourself. If you need to detect what changed on a page over time → `novada_monitor`; for a brand's footprint on AI-company domains specifically → `novada_ai_monitor`. If you need to fact-check a claim before citing it → `novada_verify`. If a page needs clicks, typing, or a login to reach the data → `novada_browser` (or `novada_browser_flow` for a simpler step sequence). If you need your own HTTP client routed through a specific IP type or geo → `novada_proxy`. Unsure which tool applies at all → call `novada_discover` first; unsure if your key even works → call `novada_setup()` first.

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
| `novada_scrape` | Structured data from 16 supported platforms (~88 operations) — Amazon, Walmart, LinkedIn, TikTok, YouTube, Instagram, GitHub, X, ChatGPT, Perplexity, etc. — instead of parsing raw HTML | Clean records in markdown/json/csv/excel/html/toon |
| `novada_scrape_amazon` | Amazon-only structured data (product, reviews, seller, bestsellers, category/brand listings) via a closed, typed `operation` enum — 10 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_google` | Google-only raw SERP data (web search, AI Mode, Maps details/reviews, Shopping, Jobs, Hotels, Videos) via a closed, typed `operation` enum — 13 verified-working operations | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_bing` | Bing-only raw SERP data (web search, videos, news, shopping) via a closed, typed `operation` enum — 4 verified-working operations; Bing is not a selectable `novada_search` engine | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_duckduckgo` | DuckDuckGo-only raw SERP data (web search) via a closed, typed `operation` enum — 1 verified-working operation | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |
| `novada_scrape_yandex` | Yandex-only raw SERP data (web search) via a closed, typed `operation` enum — 1 verified-working operation | Clean records in markdown/json/csv/excel/html/toon (same rendering as `novada_scrape`) |

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

**28 tools across 6 categories.** The hosted default surface (`mcp.novada.com`) exposes a curated subset; self-host (`npx novada-mcp`) exposes all 28. Call `novada_discover` on your connection to see exactly what's available on it.

---

## Configuration (self-host)

Only relevant if you're running `npx novada-mcp` yourself — hosted users only need the `?token=` URL.

| Variable | Required | Purpose |
|----------|----------|---------|
| `NOVADA_API_KEY` | **Yes** | Covers search, extract, crawl, scrape, research, browser, and account tools. |
| `NOVADA_BROWSER_WS` | No | Browser API WebSocket URL. Auto-provisioned from your API key if not set. |
| `NOVADA_PROXY_ENDPOINT` | No | Proxy host:port. Required only if you use `novada_proxy` with your own HTTP client. |
| `NOVADA_TOOLS` | No | Load specific tools only, e.g. `"search,extract,research"`. |
| `NOVADA_GROUPS` | No | Load tool groups, e.g. `"search,proxy,browser"`. Groups: search, proxy, browser, scraper, health, account. |

---

## Troubleshooting

<details>
<summary>Tools not showing up in my client</summary>

- Confirm the server registered: for Claude Code run `claude mcp list`; for other clients, check the connector/server status in settings.
- If using the hosted URL, make sure it's exactly `https://mcp.novada.com/mcp?token=YOUR_KEY` with your real key substituted — a placeholder or malformed URL fails silently in some clients.
- If self-hosting, always use `npx -y novada-mcp` (never a global install) — a stale globally-installed binary can silently shadow the package and run an old cached version with a different tool list.
- Call `novada_discover` once connected. Hosted and self-host expose different catalogs, so a "missing" tool may simply not be on the surface you're connected to.

</details>

<details>
<summary>Connector won't connect / times out</summary>

- Double-check the URL has no extra whitespace or line breaks — some clients mangle a pasted URL across lines.
- Confirm your key is active: call `novada_setup()` or check the dashboard.
- If you're behind a corporate proxy or firewall, confirm outbound HTTPS to `mcp.novada.com` is allowed.

</details>

<details>
<summary>"Invalid key" / auth errors</summary>

- Keys are case-sensitive with no surrounding whitespace — copy directly from the dashboard, don't retype it.
- Call `novada_setup()` — it validates your key against the live account API and tells you exactly what's wrong. It never hard-errors on a missing key, so if you see something else, read the returned `agent_instruction`.
- Rotated or reset a key recently? Old copies left in other config files won't work — update every client config that references it.

</details>

<details>
<summary>claude.ai free plan only allows one custom connector</summary>

- claude.ai's free tier currently limits custom connectors to one at a time. If you need a different connector too, upgrade your claude.ai plan or remove the existing connector before adding Novada.
- This is a claude.ai plan limit, not a Novada limit — the same key works without restriction in Claude Desktop, Claude Code, Cursor, Windsurf, and VS Code.

</details>

<details>
<summary>"Quota" vs "balance" — which one ran out?</summary>

- Balance = your wallet's dollar credits (starts at $10 free). Quota/plan = a separate per-product allocation (e.g. a purchased proxy traffic plan), if you have one.
- Call `novada_account({section: "summary"})` for both at once, or `section: "balance"` / `section: "plans"` for just one.
- Running out of balance stops every tool. Running out of a specific plan's quota only affects that product — a maxed-out proxy plan doesn't block `novada_search`.

</details>

---

## Why Novada

- **Contract-tested self-report.** Tool descriptions are tested against actual behavior, not just written and forgotten — what a tool claims to return is checked against what it actually returns.
- **Drift-guarded tool registry.** `src/tools/registry.ts` is the single source of truth for the tool catalog; a test asserts the registered tools, the wired tools, and the `novada_discover` output can never diverge.
- **`confirm:true` write-gate.** Every mutating tool (proxy sub-account creation, IP whitelist changes, static IP purchases, capture-key resets) requires an explicit two-step confirmation — no silent writes.
- **Callable onboarding.** `novada_discover` and `novada_setup` are tools your agent can call itself to find the right tool or validate a key, without ever reading this README.

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
