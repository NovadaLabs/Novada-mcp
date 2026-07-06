# Install — Novada Hosted MCP

> Add Novada's full web-data toolset to your AI client in under 2 minutes. One URL, zero install.

---

## 0. Get an API key first

1. Sign up at **https://www.novada.com/signup** (free).
2. Copy your API key from the dashboard. It looks like:
   ```
   sk-eu-novada-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```
3. **Free tier:** 5,000 calls / month. No credit card required.

Throughout this guide, replace `YOUR_KEY` with your real key.

---

## 1. Claude Desktop  ⭐ recommended

1. Open Claude Desktop → **Settings** (`⌘ ,` on macOS).
2. Sidebar → **Connectors**.
3. Click **Add Custom Connector**.
4. Fill in:
   - **Name:** `Novada`
   - **Remote MCP server URL:** `https://mcp.novada.com/mcp?token=YOUR_KEY`
5. Click **Add** → toggle the connector **On**.
6. **Restart** Claude Desktop.

**Verify it works**

In a new chat, type:

```
Search the web for "Y Combinator W26 batch"
```

You should see Claude invoke `novada__search` (tool-use UI block appears). If you don't see a tool call, see Troubleshooting below.

---

## 2. Cursor

### Option A — one-click

Click the install button on **https://mcp.novada.com** (the landing page). It uses Cursor's `cursor://anysphere.cursor-deeplink/mcp/install` deeplink.

### Option B — manual

1. Create / edit `~/.cursor/mcp.json` (global) **or** `.cursor/mcp.json` in your project.
2. Add:

```json
{
  "mcpServers": {
    "novada": {
      "url": "https://mcp.novada.com/mcp?token=YOUR_KEY"
    }
  }
}
```

3. Restart Cursor.
4. Open **Settings → MCP** and confirm `novada` is **green / connected**.

**Verify it works** — in the chat panel, ask: `Use novada to search "MCP spec changelog"`.

---

## 3. Claude Code CLI

```bash
claude mcp add --transport http novada \
  'https://mcp.novada.com/mcp?token=YOUR_KEY'
```

Then in any Claude Code session:

```bash
claude
> /mcp
```

You should see `novada` listed with all 25 tools.

**Verify it works**

```bash
claude -p "Use novada__search to search for 'OpenAI DevDay 2026'"
```

---

## 4. Cline (VS Code extension)

1. Open `~/.config/cline/config.json` (create if missing).
2. Add Novada under `mcpServers`:

```json
{
  "mcpServers": {
    "novada": {
      "type": "streamableHttp",
      "url": "https://mcp.novada.com/mcp?token=YOUR_KEY"
    }
  }
}
```

3. Reload VS Code (`⇧⌘P` → "Reload Window").
4. Open Cline panel → **MCP Servers** → confirm `novada` is connected.

**Verify it works** — in Cline, ask: `Search the web for the latest MCP spec via novada`.

---

## 5. Windsurf

1. Open **Cascade → Settings → MCP servers** (or edit `~/.codeium/windsurf/mcp_config.json`).
2. Add:

```json
{
  "mcpServers": {
    "novada": {
      "serverUrl": "https://mcp.novada.com/mcp?token=YOUR_KEY"
    }
  }
}
```

3. Save → click **Refresh** in the MCP panel.

**Verify it works** — ask Cascade: `Use novada to map the URLs on stripe.com/docs`.

---

## 6. Bonus — Custom / Other clients (`mcp-remote` adapter)

For clients that only support **stdio** transport (e.g. older versions of various tools), use the `mcp-remote` adapter as a bridge:

```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.novada.com/mcp?token=YOUR_KEY"
      ]
    }
  }
}
```

`mcp-remote` is a thin stdio ↔ Streamable HTTP bridge maintained by the MCP community.

---

## Troubleshooting

| Symptom                                   | Likely cause                                    | Fix                                                                 |
|-------------------------------------------|-------------------------------------------------|---------------------------------------------------------------------|
| **401 Unauthorized**                      | Token missing, typo, or revoked                 | Re-copy key from dashboard. Ensure prefix `sk-eu-novada-`.          |
| **429 Too Many Requests**                 | Free quota (5,000/mo) exhausted                 | Wait until 1st of next month, or upgrade plan.                      |
| **Connection refused / DNS error**        | URL typo, or firewall blocks `mcp.novada.com`   | Verify URL exactly. Try `curl https://mcp.novada.com/mcp` first.    |
| **"Tool not found" / no tools listed**    | Client too old (MCP < 1.0)                      | Update client to latest version. MCP 1.0+ required.                 |
| **Tool call hangs > 60s**                 | Heavy upstream (e.g. `research` on a big site)  | Increase client tool-call timeout. Or use lighter tool (`search`).  |
| **CORS error in browser-based client**    | Custom client not sending proper Origin         | Use Bearer header instead of `?token=` query.                       |

If none of the above helps, email `support@novada.com` with the exact error text and which client you use.
