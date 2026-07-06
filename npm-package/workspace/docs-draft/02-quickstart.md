# Quick Start

Get Novada MCP running in under 2 minutes. One API key, one install command, every web data tool available to your AI agent.

---

## Step 1: Get Your API Key

1. Go to [dashboard.novada.com/api-key/](https://dashboard.novada.com/api-key/)
2. Sign up or log in
3. Copy your API key

Your API key covers all products: Search, Extract, Crawl, Research, Scrape, Monitor, and Verify. Proxy and Browser require separate activation on the same key.

---

## Step 2: Install

Choose the method that matches your MCP client.

### Option A: Claude Code (recommended)

```bash
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp
```

That's it. Restart Claude Code and the tools are available immediately.

### Option B: Claude Desktop / Cursor / VS Code / Windsurf

Add this to your MCP configuration file:

- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
- **Cursor:** `.cursor/mcp.json` in your project root
- **VS Code:** `.vscode/mcp.json` in your project root
- **Windsurf:** `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp"],
      "env": {
        "NOVADA_API_KEY": "your_key"
      }
    }
  }
}
```

Save the file and restart your editor. The server starts automatically on first tool call.

### Option C: npm Global Install

```bash
npm install -g novada-mcp
```

Then run the server directly:

```bash
NOVADA_API_KEY=your_key novada-mcp
```

Or export the key in your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export NOVADA_API_KEY=your_key
```

---

## Step 3: Verify It Works

Ask your AI agent to run a health check:

```
Run novada_health_all() to check my Novada setup.
```

Or use the setup diagnostic:

```
Run novada_setup() to see my configuration status.
```

Either tool will report which products are active, which environment variables are set, and provide activation links for anything missing.

---

## Step 4: Your First Requests

### Extract a web page

```
novada_extract({
  url: "https://news.ycombinator.com",
  format: "markdown",
  render: "auto"
})
```

Returns clean markdown content from the page. `render: "auto"` handles static and JavaScript-rendered pages automatically.

### Search the web

```
novada_search({
  query: "best MCP servers 2026",
  engine: "google",
  num: 5,
  format: "markdown"
})
```

Returns titles, URLs, and snippets from Google. Swap `engine` to `bing`, `duckduckgo`, `yahoo`, or `yandex`.

### Run a deep research query

```
novada_research({
  question: "How do MCP servers work and what are the best practices?",
  depth: "deep"
})
```

One call generates 5-6 parallel searches, deduplicates sources, extracts full content from the top results, and returns a cited multi-source report. No other MCP server does this.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NOVADA_API_KEY` | **Yes** | Your Novada API key. Covers Search, Extract, Crawl, Scrape, Research, Verify, Monitor, and AI Monitor. Get it at [dashboard.novada.com/api-key/](https://dashboard.novada.com/api-key/). |
| `NOVADA_PROXY_ENDPOINT` | No | Proxy host:port endpoint for `novada_proxy_*` tools. Required only if you need proxy credential routing (residential, mobile, ISP, datacenter). Also requires `NOVADA_PROXY_USER` and `NOVADA_PROXY_PASS`. |
| `NOVADA_PROXY_USER` | No | Proxy username. Required alongside `NOVADA_PROXY_ENDPOINT`. |
| `NOVADA_PROXY_PASS` | No | Proxy password. Required alongside `NOVADA_PROXY_ENDPOINT`. |
| `NOVADA_BROWSER_WS` | No | Browser API WebSocket URL for `novada_browser` and `novada_browser_flow`. Enables cloud browser automation (navigate, click, type, screenshot). |
| `NOVADA_WEB_UNBLOCKER_KEY` | No | Separate key for Web Unblocker, if different from your main API key. Used by `novada_unblock` with `method: "render"`. |
| `NOVADA_TOOLS` | No | Load only specific tools. Comma-separated list: `"extract,search,research,monitor"`. Reduces context window usage. |
| `NOVADA_GROUPS` | No | Load tool groups instead of individual tools: `"search,proxy,browser"`. Available groups: `search`, `proxy`, `browser`, `scraper`, `health`. |

### Full Configuration Example (all features)

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp"],
      "env": {
        "NOVADA_API_KEY": "your_api_key",
        "NOVADA_PROXY_ENDPOINT": "your_proxy_host:port",
        "NOVADA_PROXY_USER": "your_proxy_user",
        "NOVADA_PROXY_PASS": "your_proxy_pass",
        "NOVADA_BROWSER_WS": "wss://your_browser_ws_url"
      }
    }
  }
}
```

Most users only need `NOVADA_API_KEY`. Add proxy and browser variables later when those features are needed.

---

## What's Next

- **Tool Reference** -- See the full list of 25+ tools and their parameters
- **Use Cases** -- Common workflows: research pipelines, price monitoring, competitive intelligence, lead generation
- **Platform Scraping** -- 129 supported platforms with structured data extraction
- **Proxy Network** -- Route requests through 100M+ IPs across 195 countries

---

## Troubleshooting

**"NOVADA_API_KEY is not set"**
Make sure the environment variable is passed in your MCP config. Double-check there are no extra spaces or quotes around the key value.

**Tools don't appear in Claude Code**
Run `claude mcp list` to confirm the server is registered. If missing, re-run the `claude mcp add` command from Step 2.

**"Product not activated"**
Some products (Proxy, Browser, Scraper API) require separate activation on your Novada dashboard. Run `novada_health()` to see which products are active and get direct activation links.

**npx download is slow on first run**
The first `npx -y novada-mcp` call downloads the package. Subsequent calls use the cached version. Alternatively, install globally with `npm install -g novada-mcp` for instant startup.
