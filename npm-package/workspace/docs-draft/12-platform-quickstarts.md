# Platform Quickstarts

Platform-specific setup guides for Novada MCP. Each section is self-contained: install, configure, verify, troubleshoot.

**Prerequisites:** A Novada API key from [dashboard.novada.com/api-key/](https://dashboard.novada.com/api-key/).

---

## 1. Claude Code

**CLI-based AI coding agent by Anthropic.**

### Install

```bash
claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-mcp
```

One command. No config file to edit.

### Verify

```bash
claude mcp list
```

Confirm `novada` appears in the output. Then ask Claude Code:

```
Run novada_health() to check my setup.
```

### Full Features (proxy + browser)

```bash
claude mcp add novada \
  -e NOVADA_API_KEY=your_key \
  -e NOVADA_PROXY_ENDPOINT=your_proxy_host:port \
  -e NOVADA_PROXY_USER=your_proxy_user \
  -e NOVADA_PROXY_PASS=your_proxy_pass \
  -e NOVADA_BROWSER_WS=wss://your_browser_ws_url \
  -- npx -y novada-mcp
```

### Reduce Tool Count

Load only the tools you need to save context window:

```bash
claude mcp add novada \
  -e NOVADA_API_KEY=your_key \
  -e NOVADA_GROUPS=search,health \
  -- npx -y novada-mcp
```

### Common Issues

| Symptom | Fix |
|---------|-----|
| Tools not appearing after install | Run `claude mcp list` to confirm registration. Re-run `claude mcp add` if missing. |
| `npx` download slow on first run | Install globally instead: `npm install -g novada-mcp`, then `claude mcp add novada -e NOVADA_API_KEY=your_key -- novada-mcp` |
| "NOVADA_API_KEY is not set" | Check for extra spaces or quotes in the `-e` flag value. |
| Too many tools cluttering context | Set `NOVADA_GROUPS` or `NOVADA_TOOLS` to load a subset. |

---

## 2. Claude Desktop

**Anthropic's desktop app for Claude conversations.**

### Config File Location

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

### Configuration

Create or edit the config file:

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

Save the file and **restart Claude Desktop** (quit fully, reopen).

### Verify

In a new conversation, ask:

```
Run novada_setup() to see my configuration status.
```

### Common Issues

| Symptom | Fix |
|---------|-----|
| Tools not appearing after restart | Ensure the JSON is valid (no trailing commas). Use a JSON validator. |
| "command not found: npx" | Node.js is not in Claude Desktop's PATH. Use the full path: `"command": "/usr/local/bin/npx"` (macOS) or `"command": "C:\\Program Files\\nodejs\\npx.cmd"` (Windows). |
| Multiple MCP servers conflict | Each server needs a unique key in `mcpServers`. Novada uses `"novada"`. |
| Config file doesn't exist | Create it at the path above. The parent directory must exist. |

---

## 3. Cursor

**AI-powered code editor built on VS Code.**

### Config File Location

Project-level (recommended): `.cursor/mcp.json` in your project root.

### Configuration

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

### Verify

1. Open Cursor Settings > MCP
2. Confirm `novada` appears with a green status indicator
3. In Composer or Chat, ask: `Run novada_health() to verify my Novada setup.`

### Common Issues

| Symptom | Fix |
|---------|-----|
| MCP section shows red/error status | Click the refresh icon next to the server entry. Check the error log in Cursor's output panel. |
| Tools not available in Chat mode | MCP tools are available in Composer (Agent mode). Switch from Chat to Composer. |
| "Cannot find module" errors | Ensure Node.js >= 18 is installed. Run `node --version` to check. |
| Config not picked up | Restart Cursor after creating `.cursor/mcp.json`. The file must be in the project root, not a subdirectory. |

---

## 4. VS Code Copilot

**GitHub Copilot's MCP integration in VS Code.**

### Config File Location

Project-level: `.vscode/mcp.json` in your project root.

### Configuration

```json
{
  "servers": {
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

Note: VS Code uses `"servers"` as the top-level key, not `"mcpServers"`.

### Verify

1. Open the Copilot Chat panel (Ctrl+Shift+I / Cmd+Shift+I)
2. Switch to Agent mode (click the mode dropdown)
3. Click the tools icon to confirm Novada tools are listed
4. Ask: `Use novada_health to check my setup.`

### Common Issues

| Symptom | Fix |
|---------|-----|
| No MCP tools in Copilot Chat | MCP requires Agent mode. Switch from "Ask" or "Edit" to "Agent" in the chat mode dropdown. |
| "MCP server failed to start" | Check VS Code's Output panel > "MCP" channel for error details. Usually a PATH issue with `npx`. |
| Config schema mismatch | VS Code uses `"servers"`, not `"mcpServers"`. Double-check the top-level key. |
| Tools appear but calls fail silently | Ensure `NOVADA_API_KEY` is set correctly in the `env` block. No quotes around the key name. |

---

## 5. VS Code Continue

**Open-source AI coding assistant for VS Code and JetBrains.**

### Config File Location

Global: `~/.continue/config.json`

### Configuration

Add the `mcpServers` section to your existing Continue config:

```json
{
  "mcpServers": [
    {
      "name": "novada",
      "command": "npx",
      "args": ["-y", "novada-mcp"],
      "env": {
        "NOVADA_API_KEY": "your_key"
      }
    }
  ]
}
```

Note: Continue uses an array format for `mcpServers`, not an object.

### Verify

1. Open the Continue sidebar in VS Code
2. Type `@novada` to see if Novada tools are available
3. Ask: `Run novada_health to check my setup.`

### Common Issues

| Symptom | Fix |
|---------|-----|
| MCP tools not loading | Reload the VS Code window (Cmd+Shift+P > "Reload Window") after editing config. |
| Config format errors | Continue expects `mcpServers` as an array of objects, each with a `name` field. Not the same format as Cursor or Claude Desktop. |
| "npx: command not found" | Set the full path to npx in the `command` field. Find it with `which npx`. |

---

## 6. Windsurf

**AI-powered IDE by Codeium.**

### Config File Location

| OS | Path |
|----|------|
| macOS | `~/.codeium/windsurf/mcp_config.json` |
| Windows | `%USERPROFILE%\.codeium\windsurf\mcp_config.json` |
| Linux | `~/.codeium/windsurf/mcp_config.json` |

### Configuration

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

### Verify

1. Open Windsurf Settings > MCP
2. Confirm `novada` shows as connected
3. In Cascade, ask: `Run novada_health() to verify my Novada tools.`

### Common Issues

| Symptom | Fix |
|---------|-----|
| Server shows "disconnected" | Click the restart button in the MCP settings panel. Check that Node.js >= 18 is installed. |
| Config file location unclear | Run `novada_setup()` from any connected MCP client -- it outputs the exact path for Windsurf. |
| Tools timeout on first call | The first `npx` invocation downloads the package. Subsequent calls are fast. Install globally (`npm i -g novada-mcp`) to avoid this. |

---

## 7. Zed

**High-performance code editor with AI features.**

### Config File Location

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Zed/settings.json` |
| Linux | `~/.config/zed/settings.json` |

### Configuration

Add to your Zed `settings.json` under `context_servers`:

```json
{
  "context_servers": {
    "novada": {
      "command": {
        "path": "npx",
        "args": ["-y", "novada-mcp"],
        "env": {
          "NOVADA_API_KEY": "your_key"
        }
      }
    }
  }
}
```

Note: Zed uses `context_servers` with a nested `command` object containing `path`, `args`, and `env`.

### Verify

1. Open the Assistant panel (Cmd+Shift+A)
2. Check that Novada tools appear in the tool list
3. Ask: `Use novada_health to check which products are active.`

### Common Issues

| Symptom | Fix |
|---------|-----|
| "Failed to start context server" | Zed requires the `path` field (not `command`). Ensure the nested structure matches the example above. |
| Tools not visible in Assistant | MCP support in Zed requires a recent version. Update to the latest Zed release. |
| npx not found | Use the full path: `"path": "/usr/local/bin/npx"` |

---

## 8. n8n

**Workflow automation platform with MCP support.**

### Setup

n8n supports MCP servers as tool nodes in AI agent workflows.

1. In your n8n workflow, add an **MCP Client Tool** node
2. Configure the connection:

| Field | Value |
|-------|-------|
| Command | `npx` |
| Arguments | `-y novada-mcp` |
| Environment Variables | `NOVADA_API_KEY=your_key` |

3. Connect the MCP Client Tool node to an AI Agent node

### Self-Hosted n8n

If running n8n via Docker, ensure Node.js is available in the container:

```yaml
# docker-compose.yml (n8n service)
services:
  n8n:
    image: n8nio/n8n
    environment:
      - NOVADA_API_KEY=your_key
    volumes:
      - n8n_data:/home/node/.n8n
```

### Verify

1. Open the MCP Client Tool node settings
2. Click "Test Connection" or "Refresh Tools"
3. Confirm Novada tools appear in the tool list

### Common Issues

| Symptom | Fix |
|---------|-----|
| "npx not found" in n8n container | Install Node.js in your n8n Docker image, or use the global install: `npm install -g novada-mcp` and set command to `novada-mcp`. |
| MCP tools timeout | n8n may have a short default timeout for MCP connections. Increase the timeout in the MCP Client Tool node settings. |
| Environment variables not passed | In n8n Cloud, set env vars through the platform's credentials/secrets UI, not the node config. |

---

## 9. Remote / Hosted (mcp.novada.com)

**Zero-install access via Novada's hosted MCP endpoint.**

> Note: Hosted MCP is in development. Check [novada.com](https://www.novada.com) for availability.

### Configuration

For MCP clients that support remote/HTTP transport:

```json
{
  "mcpServers": {
    "novada": {
      "url": "https://mcp.novada.com/sse",
      "headers": {
        "Authorization": "Bearer your_key"
      }
    }
  }
}
```

### When to Use

- No local Node.js installation available
- Cloud-hosted AI platforms that support remote MCP
- Environments where `npx` is blocked or unavailable
- Quick testing without local setup

### Limitations

- Requires network access to `mcp.novada.com`
- Slightly higher latency compared to local stdio transport
- Proxy and Browser tools may require additional configuration

### Common Issues

| Symptom | Fix |
|---------|-----|
| Connection refused | Confirm the hosted endpoint is available. Fall back to local `npx` install if needed. |
| "Unauthorized" response | Verify your API key in the `Authorization` header. Format: `Bearer your_key` (with space). |
| SSE connection drops | Some corporate firewalls block SSE. Try the WebSocket transport if available. |

---

## 10. Docker

**Containerized setup for reproducible environments.**

### Dockerfile

```dockerfile
FROM node:20-slim

RUN npm install -g novada-mcp

ENV NOVADA_API_KEY=your_key

ENTRYPOINT ["novada-mcp"]
```

### Build and Run

```bash
docker build -t novada-mcp .
docker run -e NOVADA_API_KEY=your_key novada-mcp
```

### Docker Compose

```yaml
services:
  novada-mcp:
    build: .
    environment:
      - NOVADA_API_KEY=${NOVADA_API_KEY}
      # Optional: proxy and browser features
      # - NOVADA_PROXY_ENDPOINT=your_proxy_host:port
      # - NOVADA_PROXY_USER=your_proxy_user
      # - NOVADA_PROXY_PASS=your_proxy_pass
      # - NOVADA_BROWSER_WS=wss://your_browser_ws_url
    stdin_open: true
```

### Using with MCP Clients

Point your MCP client to the Docker container using stdio transport:

```json
{
  "mcpServers": {
    "novada": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "NOVADA_API_KEY=your_key", "novada-mcp"],
      "env": {}
    }
  }
}
```

### Common Issues

| Symptom | Fix |
|---------|-----|
| Container exits immediately | MCP servers use stdio transport and need `-i` (interactive) flag. Add `stdin_open: true` in Compose. |
| "Cannot connect to Docker daemon" | Ensure Docker Desktop is running. On Linux, check that your user is in the `docker` group. |
| Environment variable not set | Pass via `-e` flag at runtime, not hardcoded in the Dockerfile. Use `.env` files with Docker Compose. |
| Slow startup | The `node:20-slim` image is ~50MB. Use `node:20-alpine` (~18MB) for faster pulls if you don't need glibc. |

---

## Quick Reference: Config Paths

| Platform | Config Location | Top-Level Key |
|----------|----------------|---------------|
| Claude Code | CLI (no file) | -- |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `mcpServers` |
| Cursor | `.cursor/mcp.json` | `mcpServers` |
| VS Code Copilot | `.vscode/mcp.json` | `servers` |
| VS Code Continue | `~/.continue/config.json` | `mcpServers` (array) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` |
| Zed | `~/Library/Application Support/Zed/settings.json` | `context_servers` |
| n8n | UI-based | -- |
| Hosted | Remote URL | `url` + `headers` |
| Docker | Dockerfile / Compose | -- |

---

## Environment Variables Reference

All platforms use the same environment variables. Only `NOVADA_API_KEY` is required.

| Variable | Required | Purpose |
|----------|----------|---------|
| `NOVADA_API_KEY` | Yes | API key for all core tools (search, extract, crawl, research, scrape, verify, monitor) |
| `NOVADA_PROXY_ENDPOINT` | No | Proxy host:port for `novada_proxy_*` tools |
| `NOVADA_PROXY_USER` | No | Proxy username |
| `NOVADA_PROXY_PASS` | No | Proxy password |
| `NOVADA_BROWSER_WS` | No | WebSocket URL for `novada_browser` and `novada_browser_flow` |
| `NOVADA_WEB_UNBLOCKER_KEY` | No | Separate Web Unblocker key (if different from main API key) |
| `NOVADA_TOOLS` | No | Load specific tools only: `"extract,search,research"` |
| `NOVADA_GROUPS` | No | Load tool groups: `"search,proxy,browser"` |
