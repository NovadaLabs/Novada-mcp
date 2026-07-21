> **This folder IS the npm package published as `novada-mcp`** — a local stdio MCP server (`npx novada-mcp`). It lives inside the [novada-mcp monorepo](../README.md); the hosted `mcp.novada.com` wrapper is in [`../hosted-server/`](../hosted-server/README.md).

# Novada MCP

**One MCP server for the entire live web.** Search, extract, scrape, crawl, proxy, browser automation, and AI-powered research — behind a single hosted connection, or one local install if you'd rather run it yourself.

[screenshot: Novada connected in an MCP client, tool list visible]

[![npm version](https://img.shields.io/npm/v/novada-mcp)](https://www.npmjs.com/package/novada-mcp)
[![npm downloads](https://img.shields.io/npm/dm/novada-mcp)](https://www.npmjs.com/package/novada-mcp)
[![CI](https://github.com/NovadaLabs/novada-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/NovadaLabs/novada-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Quickstart](#quickstart) · [Get your key](#get-your-key) · [How to choose a tool](#how-to-choose-a-tool) · [Troubleshooting](#troubleshooting) · [Why Novada](#why-novada) · [Links](#links)

[![Free to start — $10 in free credits, up to 1,000 API calls/month, no credit card needed](https://raw.githubusercontent.com/NovadaLabs/Novada-mcp/main/docs/assets/free-credits-banner.png)](https://www.novada.com)

|  |  |
|:--|:--|
| **✅ Works with any MCP client** — Claude, Cursor, Windsurf, VS Code, or `npx` locally | **🎯 15 typed per-platform scrapers** — Amazon, Google, LinkedIn, TikTok, … each a closed `operation` enum, so an agent can't call an invalid op |
| **🎁 $10 free credits — no credit card needed** — up to 1,000 calls/month | **⚡ Hosted-first, zero install** — point at one URL, or self-host in one command |

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

1. Sign up at [novada.com](https://www.novada.com) — no credit card required.
2. Copy your API key from [novada.com](https://www.novada.com).
3. You start with **$10 in free credits**, capped at **1,000 calls/month**. Light tools (search, extract) draw down a small fraction of that per call; heavier tools (browser, scrape, proxy) cost more per call and can exhaust the starter balance well before 1,000 calls. Check what's left any time with `novada_account({section: "balance"})` or `novada_setup()`.

---

## How to choose a tool

[![How to choose a Novada MCP tool — decision guide](https://raw.githubusercontent.com/NovadaLabs/Novada-mcp/main/docs/assets/tool-decision-map.png)](https://www.novada.com)

These are the tools you reach for most:

| Tool | Use it when |
|------|-------------|
| `novada_setup` | **First run** — validate your key and see your balance. Start here. |
| `novada_search` | Find pages by query (google / duckduckgo / yandex; time, domain, geo filters). |
| `novada_extract` | Read one known URL — or up to 10 in parallel — through anti-bot pages. |
| `novada_research` | Answer a complex question — parallel multi-source search + extraction in one call. |
| `novada_scrape` | Structured records from 16 platforms (Amazon, LinkedIn, TikTok, …). Plus **15 typed per-platform tools** — `novada_scrape_amazon`, `_google`, `_linkedin`, … — each a closed `operation` enum. |
| `novada_crawl` | Pull content from a bounded set of related pages (≤20) on one site. |
| `novada_map` | Discover what URLs exist on a site before fetching. |
| `novada_browser` | Interact with a page — click, type, screenshot, run JS. |
| `novada_proxy` | Route your own HTTP client through a specific IP type / country / session. |

**Not sure?** Call `novada_discover` and it returns the full catalog with each tool's status.

📚 **[Full reference — all 38 tools →](https://github.com/NovadaLabs/novada-mcp/blob/main/docs/TOOLS.md)**

**38 tools across 6 categories.** Self-host (`npx novada-mcp`) exposes all 38. The hosted default surface (`mcp.novada.com`) exposes **30** — the same registry minus 8 tools that don't apply to a stateless serverless endpoint: `novada_browser_flow` (needs a persistent browser session), `novada_site_copy` (writes files to disk), `novada_ip_whitelist` / `novada_static_ip_mgmt` / `novada_capture_apikey` (write-gated account ops), `novada_session_stats` / `novada_search_feedback` (per-process in-memory state), and `novada_verify` — it is core-derived, not a hand-curated subset. Call `novada_discover` on your connection to see exactly what's available on it.

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

- **Honest tool surface.** Every listed `operation` is verified-working — operations we can't currently deliver are marked and excluded, not left in to fail on you mid-task.
- **Contract-tested self-report.** Tool descriptions are tested against actual behavior, not just written and forgotten — what a tool claims to return is checked against what it actually returns.
- **Drift-guarded tool registry.** `src/tools/registry.ts` is the single source of truth for the tool catalog; a test asserts the registered tools, the wired tools, and the `novada_discover` output can never diverge.
- **`confirm:true` write-gate.** Every mutating tool (proxy sub-account creation, IP whitelist changes, static IP purchases, capture-key resets) requires an explicit two-step confirmation — no silent writes.
- **Callable onboarding.** `novada_discover` and `novada_setup` are tools your agent can call itself to find the right tool or validate a key, without ever reading this README.

---

## Links

- Website: [novada.com](https://www.novada.com)
- Get an API key: [novada.com](https://www.novada.com)
- Sign up (free): [novada.com](https://www.novada.com)
- npm: [npmjs.com/package/novada-mcp](https://www.npmjs.com/package/novada-mcp)
- GitHub: [github.com/NovadaLabs/novada-mcp](https://github.com/NovadaLabs/novada-mcp)
- Issues: [github.com/NovadaLabs/novada-mcp/issues](https://github.com/NovadaLabs/novada-mcp/issues)

## License

MIT
