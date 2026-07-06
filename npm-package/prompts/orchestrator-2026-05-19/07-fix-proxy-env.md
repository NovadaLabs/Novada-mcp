# Fix Proxy Env: Configure Proxy Credentials in MCP Server

## Problem
The `novada_proxy` tool returns "not configured" because NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT are not set in the MCP server environment.

## Credentials (from memory)
```
NOVADA_PROXY_USER=<NOVADA_PROXY_USER_REDACTED>
NOVADA_PROXY_PASS=<NOVADA_PROXY_PASS_REDACTED>
NOVADA_PROXY_HOST=<NOVADA_PROXY_HOST_REDACTED>
NOVADA_PROXY_PORT=7777
```
Full endpoint: `<NOVADA_PROXY_HOST_REDACTED>:7777`

## Fix
1. Read `~/.claude/settings.json`
2. Find the `mcpServers` section
3. The novada-search MCP server likely runs via the plugin system. Check:
   - `~/.claude/plugins/cache/novada-search/novada-search/0.8.6/.mcp.json` for the env config
4. Add the proxy env vars to whichever config controls the MCP server environment:
   ```json
   "env": {
     "NOVADA_API_KEY": "<NOVADA_API_KEY_REDACTED>",
     "NOVADA_PROXY_USER": "<NOVADA_PROXY_USER_REDACTED>",
     "NOVADA_PROXY_PASS": "<NOVADA_PROXY_PASS_REDACTED>",
     "NOVADA_PROXY_ENDPOINT": "<NOVADA_PROXY_HOST_REDACTED>:7777",
     "NOVADA_WEB_UNBLOCKER_KEY": "<NOVADA_API_KEY_REDACTED>",
     "NOVADA_BROWSER_WS": "wss://<NOVADA_BROWSER_WS_CREDS_REDACTED>@upg-scbr2.novada.com"
   }
   ```
5. Note: This requires MCP server restart to take effect

## Verification
- After restart, `novada_proxy(type="residential", country="us", format="url")` should return a proxy URL with masked password
- `novada_proxy(type="residential", country="us", format="curl")` should return curl command with masked password
