# novada-mcp-hosted (Cloudflare Worker)

> ⚠️ **DORMANT / ARCHIVED — this is NOT the live endpoint.** Production hosted MCP runs on
> **Vercel** (`vercel/api/mcp.ts`), not this Cloudflare Worker. This directory is kept for
> reference only: it has its own `worker/tsconfig.json`, is **not** typechecked or deployed by
> CI, and its code may be stale / may not compile against the current `novada-mcp` API.
> Do **not** revive it without (1) re-vendoring novada-mcp (`cd vercel && npm run sync:hosted`),
> (2) reconciling the tool catalog against `vercel/api/mcp.ts`, and (3) a clean
> `wrangler deploy --dry-run`. Tracked as NOV-578 #8.

Wraps the local **novada-mcp** server in a remote **Streamable HTTP** endpoint at
`https://mcp.novada.com/mcp`. Any MCP client (Claude Desktop, Cursor, Cline,
Windsurf, VS Code, etc.) can connect via URL — no `npx`, no local install.

```
Client  ──HTTPS──▶  Cloudflare Worker (/mcp)  ──HTTPS──▶  Novada API
              ?token=sk-eu-novada-…
              or Authorization: Bearer sk-eu-novada-…
```

## What you get

- **One URL** for all 25 Novada tools (search, extract, crawl, research, map,
  scrape, verify, unblock, proxy×7, browser×2, scraper×3, health×2, discover,
  ai_monitor, monitor, setup).
- **Two auth modes** simultaneously: `?token=…` query param and
  `Authorization: Bearer …` header.
- **Per-token monthly quota** in Workers KV (default 5000 calls/mo on free).
- **Stateless transport** — each request gets a fresh isolate; no session
  affinity needed.

## Prerequisites

- Node.js 18+
- Cloudflare account
- Wrangler CLI installed globally:
  ```bash
  npm install -g wrangler
  ```

## 1. Install

```bash
cd ~/Projects/novada-mcp/hosted-server/worker
npm install
```

> The package depends on the npm package via `file:../../npm-package`. Run
> `npm run build` in `~/Projects/novada-mcp/npm-package` first so `build/` exists.

## 2. Authenticate Wrangler

```bash
wrangler login
```

## 3. Create the KV namespace

```bash
wrangler kv namespace create NOVADA_MCP_QUOTA
```

Copy the printed `id` into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "NOVADA_MCP_QUOTA"
id = "abcdef…"   # paste here
```

## 4. Set the upstream Novada API key

The Worker calls Novada's backend with a single operator key (per-user
sub2api lookup is TODO):

```bash
wrangler secret put NOVADA_API_KEY
# Paste your Novada API key when prompted.
```

## 5. Deploy

```bash
wrangler deploy
```

You'll get back something like:

```
Published novada-mcp-hosted (1.23 sec)
  https://novada-mcp-hosted.YOUR-SUBDOMAIN.workers.dev
```

## 6. Smoke test

```bash
curl -X POST 'https://novada-mcp-hosted.YOUR-SUBDOMAIN.workers.dev/mcp?token=sk-eu-novada-test123' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

You should see the 25-tool catalog in the response.

Try a tool call:

```bash
curl -X POST 'https://novada-mcp-hosted.YOUR-SUBDOMAIN.workers.dev/mcp?token=sk-eu-novada-test123' \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": { "name": "novada_setup", "arguments": {} }
  }'
```

## 7. Bind the custom domain `mcp.novada.com`

1. In the Cloudflare dashboard for the `novada.com` zone, add a CNAME:
   ```
   mcp  ->  novada-mcp-hosted.YOUR-SUBDOMAIN.workers.dev   (proxied)
   ```
2. Uncomment the `routes` line in `wrangler.toml`:
   ```toml
   routes = [{ pattern = "mcp.novada.com/mcp", custom_domain = true }]
   ```
3. Redeploy:
   ```bash
   wrangler deploy
   ```
4. Verify:
   ```bash
   curl 'https://mcp.novada.com/mcp?token=sk-eu-novada-test123' \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
   ```

## Client configuration

### Claude Desktop / Cursor / Cline / Windsurf / VS Code

```json
{
  "mcpServers": {
    "novada": {
      "url": "https://mcp.novada.com/mcp?token=sk-eu-novada-YOUR_TOKEN"
    }
  }
}
```

Or with header auth (preferred for clients that support it):

```json
{
  "mcpServers": {
    "novada": {
      "url": "https://mcp.novada.com/mcp",
      "headers": { "Authorization": "Bearer sk-eu-novada-YOUR_TOKEN" }
    }
  }
}
```

## Auth & quota model (current stub)

| Concern         | Implementation                                                      |
|-----------------|---------------------------------------------------------------------|
| Token format    | Anything starting with `sk-eu-novada-` is accepted (stub).          |
| Plan resolution | Hardcoded `free` plan, 5000 calls/mo. **TODO: sub2api integration.**|
| Counter         | KV key `<token>:<YYYY-MM>`, 32-day TTL, decremented before each call.|
| Exhaustion      | Returns a structured `QUOTA_EXCEEDED` error to the agent.           |
| Usage events    | `console.log` JSON (one line per call). **TODO: Analytics Engine.** |

Search for `TODO(sub2api)` in `src/index.ts` to find the integration point.

## Known limitations (Workers runtime)

The following tools depend on Node-only modules and are wired up but may fail
at runtime until ported — they're marked `// TODO: port for Workers runtime`
in `src/index.ts`:

- `novada_browser` — uses `playwright-core` CDP; nodejs_compat covers the JS
  surface but not native binaries.
- `novada_browser_flow` — depends on a cloud browser WebSocket; verify the
  Workers `WebSocket` shim handles the upstream protocol.

All HTTP/JSON-only tools (search, extract, crawl, research, map, scrape,
verify, unblock, proxy×7, scraper×3, health×2, discover, ai_monitor, monitor,
setup) work on the Workers runtime via `nodejs_compat`.

## Local development

```bash
# Create .dev.vars with your local secrets (not committed):
echo "NOVADA_API_KEY=sk-prod-…" > .dev.vars

wrangler dev
# → http://localhost:8787/mcp
```

## Useful commands

```bash
npm run typecheck       # tsc --noEmit
npm run deploy:dry      # wrangler deploy --dry-run
wrangler tail           # live log stream from production
wrangler kv key list --binding=NOVADA_MCP_QUOTA
```
