# Fix Proxy Env: Configure Proxy Credentials in MCP Server

## Problem
The `novada_proxy` tool returns "not configured" because NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT are not set in the MCP server environment.

## Credentials (from memory)
```
NOVADA_PROXY_USER=tongwu_TRDI7X
NOVADA_PROXY_PASS=_Asd1644asd_
NOVADA_PROXY_HOST=1b9b0a2b9011e022.vtv.na.novada.pro
NOVADA_PROXY_PORT=7777
```
Full endpoint: `1b9b0a2b9011e022.vtv.na.novada.pro:7777`

## Fix
1. Read `~/.claude/settings.json`
2. Find the `mcpServers` section
3. The novada-search MCP server likely runs via the plugin system. Check:
   - `~/.claude/plugins/cache/novada-search/novada-search/0.8.6/.mcp.json` for the env config
4. Add the proxy env vars to whichever config controls the MCP server environment:
   ```json
   "env": {
     "NOVADA_API_KEY": "1f35b477c9e1802778ec64aee2a6adfa",
     "NOVADA_PROXY_USER": "tongwu_TRDI7X",
     "NOVADA_PROXY_PASS": "_Asd1644asd_",
     "NOVADA_PROXY_ENDPOINT": "1b9b0a2b9011e022.vtv.na.novada.pro:7777",
     "NOVADA_WEB_UNBLOCKER_KEY": "b27ad6e6834dd36407b00f4e502e055e",
     "NOVADA_BROWSER_WS": "wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com"
   }
   ```
5. Note: This requires MCP server restart to take effect

## Verification
- After restart, `novada_proxy(type="residential", country="us", format="url")` should return a proxy URL with masked password
- `novada_proxy(type="residential", country="us", format="curl")` should return curl command with masked password
