# novada-mcpserver (Vercel Edge Function)

Wraps the local **novada-mcp** server in a remote **Streamable HTTP** endpoint at
`https://mcp.novada.com/mcp`. Any MCP client (Claude Desktop, Cursor, Cline,
Windsurf, VS Code, etc.) can connect via URL — no `npx`, no local install.

```
Client  ──HTTPS──▶  Vercel Edge Function (/mcp)  ──HTTPS──▶  Novada API
              ?token=sk-eu-novada-…
              or Authorization: Bearer sk-eu-novada-…
```

This is the **Vercel port** of the Cloudflare Worker at `../worker/`. Same
behavior, same 30-tool surface, same auth/quota model. The CF Worker is kept as a
fallback in case the Vercel deploy needs to be rolled back.

**Why Vercel:** the CF Workers approach needs the root domain (`novada.com`)
on Cloudflare DNS. Novada's DNS lives on AWS Route 53 and migrating the whole
zone is heavy. Vercel custom domains work with any DNS provider via a single
CNAME — DNS stays on AWS, we just add `mcp.novada.com → cname.vercel-dns.com`.

## What you get

- **One URL** for the hosted-visible **30-tool** surface — core-derived, not a
  hand-curated list: it's the npm package's full 38-tool registry
  (`npm-package/src/tools/registry.ts`) minus 8 tools that don't apply to a
  stateless serverless endpoint (`HOSTED_HIDDEN` in `api/mcp.ts` — write-gated
  account mutations, per-process debug state, and `novada_browser_flow`).
  Covers search, extract, crawl, research, map, site-copy-adjacent tools,
  the generic `novada_scrape` plus all 15 `novada_scrape_<platform>` tools,
  browser, proxy, discover, ai_monitor, monitor, setup, account,
  proxy_account_list, proxy_account_create.
- **Two auth modes** simultaneously: `?token=…` query param and
  `Authorization: Bearer …` header.
- **Per-token monthly quota** in Vercel KV (default 5000 calls/mo on free).
- **Per-IP rate limit** in Vercel KV (default 60 req/min/IP).
- **Stateless Edge runtime** — each request gets a fresh isolate; no session
  affinity needed.

## Prerequisites

- Node.js 18+
- Vercel account (recommended: a **personal account**, not `novadateam-mvps`
  which has hit build-minute limits before)
- Vercel CLI installed globally:
  ```bash
  npm install -g vercel
  ```

## 1. Install

```bash
cd ~/Projects/novada-mcp/hosted/vercel
npm install
```

> The package depends on the parent `novada-mcp` via `file:../..`. Run
> `npm run build` in `~/Projects/novada-mcp` first so `build/` exists.

## 2. Authenticate Vercel

```bash
vercel login
```

## 3. Link the project

```bash
vercel link
```

When prompted:
- **Set up "~/Projects/novada-mcp/hosted/vercel"?** → Y
- **Which scope?** → choose your personal account
- **Link to existing project?** → N (create new)
- **Project name?** → `novada-mcpserver`
- **In which directory is your code located?** → `./`

A `.vercel/` folder is created with the project linkage (gitignored).

## 4. Set the upstream Novada API key

```bash
vercel env add NOVADA_API_KEY production
# Paste your upstream Novada API key when prompted.
```

## 5. Create the Vercel KV store

Vercel KV (Upstash Redis under the hood) backs both the per-token monthly
quota counter AND the per-IP rate-limit counter.

1. Open https://vercel.com/dashboard/stores
2. **Create** → **KV**
3. Name: `novada-mcp-quota`
4. Connect it to the `novada-mcpserver` project
5. Vercel auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` as project
   env vars — no manual setup needed.

> If you skip this step, the function returns `500 KV_NOT_CONFIGURED` on
> every request, by design (fail loud, never silently bypass rate-limiting).

## 6. Set the other env vars

```bash
vercel env add STUB_AUTH_WARNING_ACCEPTED production
# Enter: false
# (must read PRE_LAUNCH_CHECKLIST.md before flipping to true)

vercel env add RATE_LIMIT_PER_MIN production
# Enter: 60

vercel env add FREE_PLAN_MONTHLY_QUOTA production
# Enter: 5000
```

## 7. Deploy

```bash
vercel deploy --prod
```

You'll get back something like:

```
✅  Production: https://novada-mcpserver.vercel.app [3s]
```

## 8. Smoke test (stub gate should be on)

```bash
curl -X POST 'https://novada-mcpserver.vercel.app/mcp?token=sk-eu-novada-test123' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

Expected: **`503 STUB_AUTH_UNACKED`**. This is correct — the gate is doing
its job, refusing to serve until the operator acknowledges the stub auth.

## 9. Flip the gate (only after reading PRE_LAUNCH_CHECKLIST.md)

```bash
vercel env rm STUB_AUTH_WARNING_ACCEPTED production
vercel env add STUB_AUTH_WARNING_ACCEPTED production
# Enter: true

vercel deploy --prod
```

Smoke test again:

```bash
curl -X POST 'https://novada-mcpserver.vercel.app/mcp?token=sk-eu-novada-test123' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

You should see the 30-tool catalog in the response.

Try a tool call:

```bash
curl -X POST 'https://novada-mcpserver.vercel.app/mcp?token=sk-eu-novada-test123' \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": { "name": "novada_setup", "arguments": {} }
  }'
```

## 10. Bind the custom domain `mcp.novada.com`

DNS stays on AWS Route 53 — Vercel only needs the CNAME.

1. Vercel dashboard → `novada-mcpserver` → **Settings** → **Domains**
   → **Add** `mcp.novada.com`
2. Vercel will show you the CNAME target (typically `cname.vercel-dns.com`,
   sometimes a project-specific subdomain — copy what Vercel shows).
3. AWS Route 53 → `novada.com` hosted zone → **Create record**:
   - **Name:** `mcp`
   - **Type:** `CNAME`
   - **Value:** (whatever Vercel showed)
   - **TTL:** 300
4. Vercel auto-issues an SSL cert via DNS-01 challenge (~1-5 minutes).
5. Verify on the real domain:
   ```bash
   curl -X POST 'https://mcp.novada.com/mcp?token=sk-eu-novada-test123' \
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
| Rate limit      | KV key `rl:<ip>:<minute>`, 120s TTL, 60 req/min default.            |
| Usage events    | `console.log` JSON (one line per call, view with `vercel logs`).    |

Search for `TODO(sub2api)` in `api/mcp.ts` to find the integration point.

## Known limitations (Edge runtime)

The following tools depend on Node-only modules and are wired up but return
`501`-style structured errors on the hosted endpoint — they're marked
`// TODO: port for Edge runtime` in `api/mcp.ts`:

- `novada_browser` — uses `playwright-core` CDP; Edge runtime has no native
  binaries.
- `novada_browser_flow` — depends on a cloud browser WebSocket; the Edge
  WebSocket surface needs verification against the upstream protocol.

Both tools return a structured `NOT_AVAILABLE_ON_HOSTED` error telling
agents to use the **local** MCP server (`npx novada-mcp`) for those two
tools. All other 30 tools on the hosted surface (of the npm package's 38)
work on the Edge runtime.

## Local development

```bash
# Pull env vars from Vercel for local dev:
vercel env pull .env.local

vercel dev
# → http://localhost:3000/mcp
```

## Useful commands

```bash
npm run typecheck       # tsc --noEmit
vercel logs             # live log stream from production
vercel logs --follow    # tail mode
vercel env ls           # list configured env vars
vercel domains ls       # list bound domains
```

## Rollback

If something goes wrong, the CF Worker at `../worker/` is still deployable as
a fallback. Repoint the CNAME at Cloudflare's worker URL and you're back.
