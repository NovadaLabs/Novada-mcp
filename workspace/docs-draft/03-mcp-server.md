# MCP Server

Novada runs as a local MCP server via `npx`. One command, one API key, all tools.

You can also connect to the hosted server at `mcp.novada.com` if you prefer not to install anything locally (see [Hosted Mode](#hosted-mode) below).

---

## Prerequisites

1. **Node.js 18+** installed
2. **API key** from [novada.com](https://www.novada.com)

---

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

With all optional products enabled:

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your-api-key-here",
        "NOVADA_BROWSER_WS": "wss://username:password@upg-scbr2.novada.com",
        "NOVADA_PROXY_ENDPOINT": "pr.novada.com:7777"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

---

## Claude Code

```bash
claude mcp add novada-mcp -e NOVADA_API_KEY=your-api-key-here -- npx -y novada-mcp@latest
```

With browser and proxy:

```bash
claude mcp add novada-mcp \
  -e NOVADA_API_KEY=your-api-key-here \
  -e NOVADA_BROWSER_WS=wss://username:password@upg-scbr2.novada.com \
  -e NOVADA_PROXY_ENDPOINT=pr.novada.com:7777 \
  -- npx -y novada-mcp@latest
```

Verify it was added:

```bash
claude mcp list
```

---

## VS Code (Copilot / Continue)

Add to `.vscode/mcp.json` in your project root (or `~/.vscode/mcp.json` for global):

```json
{
  "servers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

For Continue, add to `~/.continue/config.json` under the `mcpServers` key:

```json
{
  "mcpServers": [
    {
      "name": "novada",
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your-api-key-here"
      }
    }
  ]
}
```

---

## Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project-level):

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

---

## Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
      "env": {
        "NOVADA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

---

## Hosted Mode

Connect to the remote Novada MCP endpoint without installing anything locally:

```
mcp.novada.com
```

Use this when your MCP client supports remote servers (SSE or Streamable HTTP transport). Pass your API key as a query parameter or header per your client's configuration. Refer to your MCP client's documentation for remote server setup.

---

## Self-Hosted Mode (npx)

All configurations above use `npx -y novada-mcp@latest`, which downloads and runs the server from npm on each launch. This is the recommended approach:

- Always gets the latest version
- No global install needed
- Works offline after first download (npm cache)

To pin a specific version:

```bash
npx -y novada-mcp@0.8.1
```

To install globally instead:

```bash
npm install -g novada-mcp
```

Then replace `"command": "npx", "args": ["-y", "novada-mcp@latest"]` with `"command": "novada-mcp"` in your config.

---

## Environment Variables

One API key covers all products. Additional variables unlock proxy and browser features.

### Required

| Variable | Purpose |
|----------|---------|
| `NOVADA_API_KEY` | Your API key. Authenticates **all** products: search, extract, research, crawl, map, scrape, verify, monitor, unblock, and proxy auto-provisioning. Get it at [novada.com](https://www.novada.com). |

### Optional -- Proxy

| Variable | Purpose |
|----------|---------|
| `NOVADA_PROXY_ENDPOINT` | Proxy gateway (e.g. `pr.novada.com:7777`). When set, proxy tools become active. User/pass are auto-fetched from your account using `NOVADA_API_KEY` -- no need to set them manually. |
| `NOVADA_PROXY_USER` | Override proxy username. Only needed if you want to use specific sub-account credentials instead of auto-provisioned ones. |
| `NOVADA_PROXY_PASS` | Override proxy password. Same as above. |

### Optional -- Browser

| Variable | Purpose |
|----------|---------|
| `NOVADA_BROWSER_WS` | Browser API WebSocket URL (e.g. `wss://user:pass@upg-scbr2.novada.com`). Required for `novada_browser` and `novada_browser_flow`. Get the endpoint from your Novada dashboard under Browser API. |

### Optional -- Advanced

| Variable | Purpose |
|----------|---------|
| `NOVADA_WEB_UNBLOCKER_KEY` | Override key for the Web Unblocker. If not set, `NOVADA_API_KEY` is used as fallback. Only needed if your unblocker runs on a separate account. |
| `NOVADA_DEVELOPER_API_KEY` | Key for account management tools (wallet balance, proxy account CRUD, traffic logs). Falls back to `NOVADA_API_KEY` if not set. |
| `NOVADA_TOOLS` | Load only specific tools. Comma-separated: `"extract,search,research,monitor"`. Reduces context window usage. |
| `NOVADA_GROUPS` | Load tool groups instead of individual tools. Values: `search`, `proxy`, `browser`, `scraper`, `health`, `account`. Can combine with `NOVADA_TOOLS` (union). |

### Tool Filtering Examples

Load only search-related tools (8 tools instead of 25+):

```json
{
  "env": {
    "NOVADA_API_KEY": "your-key",
    "NOVADA_GROUPS": "search"
  }
}
```

Load specific tools only:

```json
{
  "env": {
    "NOVADA_API_KEY": "your-key",
    "NOVADA_TOOLS": "search,extract,research"
  }
}
```

Combine groups and individual tools:

```json
{
  "env": {
    "NOVADA_API_KEY": "your-key",
    "NOVADA_GROUPS": "search,proxy",
    "NOVADA_TOOLS": "browser"
  }
}
```

Available groups:

| Group | Tools Included |
|-------|---------------|
| `search` | search, extract, crawl, map, research, verify, ai_monitor, monitor |
| `proxy` | proxy, proxy_residential, proxy_isp, proxy_datacenter, proxy_mobile, proxy_static, proxy_dedicated |
| `browser` | browser, browser_flow |
| `scraper` | scrape, scraper_submit, scraper_status, scraper_result |
| `health` | health, health_all, discover, setup |
| `account` | wallet_balance, wallet_usage_record, proxy_account_create, proxy_account_list, traffic_daily, plan_balance_all, capture_logs, account_summary |

`novada_health` and `novada_setup` are always loaded regardless of filter settings, so agents can always diagnose issues.

---

## Verify Your Setup

After configuring, ask your AI agent to run:

```
Run novada_health_all() to check which products are active.
```

Or call the tool directly:

```
novada_health_all()
```

Expected output shows per-product status:

```
Product          | Status  | Latency
-----------------+---------+---------
Search API       | active  | 245ms
Extract API      | active  | 180ms
Scraper API      | active  | 312ms
Proxy API        | active  | 95ms
Browser API      | active  | 420ms
Web Unblocker    | active  | 280ms
```

Any product showing `PRODUCT_UNAVAILABLE` includes an activation link to enable it on your dashboard.

You can also run `novada_setup()` -- it works even before `NOVADA_API_KEY` is configured and shows the status of all environment variables plus setup commands for every MCP client.

---

## Troubleshooting

### "NOVADA_API_KEY is not set"

The API key environment variable is missing or empty.

**Fix:** Double-check the `env` block in your MCP config. The key must be a non-empty string. Restart your MCP client after updating the config.

```json
"env": {
  "NOVADA_API_KEY": "your-actual-key-here"
}
```

### "INVALID_API_KEY"

The key is set but rejected by the Novada API.

**Fix:** Verify the key at [novada.com](https://www.novada.com). Common causes: extra whitespace, partial key copied, or expired key.

### Proxy tools return "missing environment variables"

Proxy tools require `NOVADA_PROXY_ENDPOINT` to be set. User and password are auto-provisioned from your account.

**Fix:** Add the proxy endpoint:

```json
"env": {
  "NOVADA_API_KEY": "your-key",
  "NOVADA_PROXY_ENDPOINT": "pr.novada.com:7777"
}
```

Get the exact endpoint from your Novada dashboard under Residential Proxies > Endpoint Generator.

### Browser tools return "NOVADA_BROWSER_WS not configured"

The browser automation tools (`novada_browser`, `novada_browser_flow`) require a WebSocket endpoint.

**Fix:** Add the Browser API WebSocket URL:

```json
"env": {
  "NOVADA_API_KEY": "your-key",
  "NOVADA_BROWSER_WS": "wss://username:password@upg-scbr2.novada.com"
}
```

Get credentials from your Novada dashboard under Browser API.

### "Tool X is not in the active set"

You are using `NOVADA_TOOLS` or `NOVADA_GROUPS` and the requested tool is not in the allowed set.

**Fix:** Add the tool name to `NOVADA_TOOLS` or its group to `NOVADA_GROUPS`. Run `novada_discover()` to see all available tools and their groups.

### npx hangs or fails to download

Network or npm cache issue.

**Fix:**
```bash
# Clear npm cache
npm cache clean --force

# Or install globally as fallback
npm install -g novada-mcp
```

### Claude Desktop does not show Novada tools

Config file might be in the wrong location or has a JSON syntax error.

**Fix:**
1. Verify file location: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
2. Validate JSON syntax (no trailing commas, proper quoting)
3. Restart Claude Desktop completely (quit and reopen, not just close window)

### Scraper API returns "product not activated"

Some Scraper API platforms require separate activation on your Novada account.

**Fix:** Run `novada_health()` to see which products are active. Visit the activation link in the output to enable the Scraper API product.
