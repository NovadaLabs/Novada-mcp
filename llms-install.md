# Novada MCP — Installation Guide for AI Agents

This file tells an AI coding agent how to install the Novada MCP server for a user. The config steps below are written for Cline (`mcpServers` in `cline_mcp_settings.json`). Other clients use different file names and keys — see the per-client snippets in [`npm-package/README.md`](https://github.com/NovadaLabs/Novada-mcp/blob/main/npm-package/README.md#quickstart).

## What this server does

Novada MCP gives the agent live web data: search, page extraction, multi-source research, site crawling/mapping, structured scraping of major platforms, and proxy routing. One server, one API key.

## Step 1 — Get an API key from the user

Ask the user for their Novada API key.

- If they don't have one: they can sign up at https://www.novada.com (no credit card required; new accounts get free credits) and copy the key from the dashboard.
- Never put the key in a URL. The hosted endpoint only accepts it in an `Authorization: Bearer` header.

## Step 2 — Choose an install method

**Option A (recommended): hosted server — no local install needed.**

**Option B: self-host via npx** — requires Node.js and npm. Use this only if the user wants local-only tools (e.g. `novada_browser`) or cannot reach the hosted endpoint.

## Step 3 — Write the config

Add one of the entries below under `mcpServers` in the client's MCP settings file. Preserve any other servers already in the file.

For Cline, the file is `cline_mcp_settings.json`:

- Cline v4 (VS Code extension and CLI): `~/.cline/data/settings/cline_mcp_settings.json` (Windows: `%USERPROFILE%\.cline\data\settings\cline_mcp_settings.json`). The `CLINE_MCP_SETTINGS_PATH` environment variable overrides this location.
- Older Cline extension builds: VS Code globalStorage, `.../Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- Either version: the user can open the correct file from the Cline panel via MCP Servers → Configure → "Configure MCP Servers".

Check those locations with your file tools and edit the file that exists. Do not scan the whole filesystem. If neither file exists, or you cannot resolve the home directory, ask the user to open the file from the Cline panel instead of guessing.

### Option A: hosted (Streamable HTTP)

```json
{
  "mcpServers": {
    "novada": {
      "type": "streamableHttp",
      "url": "https://mcp.novada.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_NOVADA_API_KEY"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Important for Cline: set `"type": "streamableHttp"` explicitly. If `type` is omitted, Cline falls back to the legacy SSE transport and the connection will fail.

### Option B: self-host (stdio)

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp"],
      "env": {
        "NOVADA_API_KEY": "YOUR_NOVADA_API_KEY"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Use `npx -y novada-mcp` — do not install the package globally (a stale global binary can shadow the latest version).

Optional environment variables (self-host only): `NOVADA_TOOLS` (load specific tools, e.g. `"search,extract,research"`), `NOVADA_GROUPS` (load tool groups: search, proxy, browser, scraper, health, account).

Replace `YOUR_NOVADA_API_KEY` with the user's key.

## Step 4 — Verify

1. Confirm the `novada` server shows as connected in the MCP server list.
2. Call the `novada_setup` tool. It validates the key and returns the account status and balance. If the server does not connect (the hosted endpoint returns 401 for a missing or invalid key), or `novada_setup` reports that the key was rejected, re-check the key and the `Authorization` header format (`Bearer <key>`, single space).
3. Optionally run a quick test: call `novada_search` with `{"query": "latest MCP news"}`.

## Troubleshooting

- **Connection fails on Cline with hosted config** → make sure `"type": "streamableHttp"` is set.
- **Server not connecting / 401** → key missing, mistyped, or placed somewhere other than the `Authorization` header (a key in the URL is rejected).
- **`npx` not found (Option B)** → Node.js is not installed; install Node.js or use Option A.

## Main tools

- `novada_setup` — validate key, show balance (run first)
- `novada_search` — web search with time, domain and geo filters
- `novada_extract` — read one or more URLs, including anti-bot pages
- `novada_research` — parallel multi-source search + extraction with cited passages
- `novada_scrape` / `novada_scrape_<platform>` — structured data from supported platforms
- `novada_crawl` — content from related pages on one site
- `novada_map` — discover URLs on a site
- `novada_proxy` — route HTTP requests by IP type, country or session

Full reference: https://github.com/NovadaLabs/Novada-mcp/blob/main/docs/TOOLS.md
