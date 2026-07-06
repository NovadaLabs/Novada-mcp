# Pre-launch Checklist (Vercel)

Read this before flipping `STUB_AUTH_WARNING_ACCEPTED` to `true` on the Vercel
project.

## 🔴 BLOCKING — must clear before any public exposure

### 1. Token validation is a stub
`api/mcp.ts:validateToken()` accepts **any** token starting with `sk-eu-novada-`. There is **no** lookup against a database; there is **no** quota enforcement at the auth layer (quota is enforced separately via Vercel KV). An attacker who learns the prefix `sk-eu-novada-` can generate unlimited valid-looking tokens and each one gets a fresh 5000-call quota.

**To fix before launch:**
- Wire `validateToken()` to sub2api / your customer DB
- Reject unknown tokens with `INVALID_TOKEN` (401)
- Return real `quota_remaining` from the DB record

**Until fixed:** keep `STUB_AUTH_WARNING_ACCEPTED = "false"` in Vercel env (the function will refuse all requests with 503).

### 2. Bundle size check
Parent `novada-mcp` package depends on `axios`, `playwright-core`, `exceljs`, `pdf-parse`, `cheerio`. Vercel Edge Functions have a **4 MB compressed / 16 MB total** size limit per function. Run before deploy:

```bash
cd ~/Projects/novada-mcp/hosted/vercel
vercel build
ls -lh .vercel/output/functions/api/mcp.func/
```

If the build fails with a size error, mitigation:
- Identify the largest module via the Vercel build output (it prints per-module sizes when over budget)
- Move heavy imports (Playwright, pdf-parse) out of the hot path — the browser tools are already disabled via structured-error responses; ensure their imports aren't reachable from the entry
- Consider splitting per-tool functions if the catalog grows further

### 3. NOVADA_API_KEY env var set
The function returns `500 FUNCTION_MISCONFIGURED` on every tool call without this env var. Set via:

```bash
vercel env add NOVADA_API_KEY production
# Paste the upstream Novada API key when prompted
```

Verify with `vercel env ls`.

### 4. Vercel KV store connected
The function returns `500 KV_NOT_CONFIGURED` on every request without `KV_REST_API_URL` and `KV_REST_API_TOKEN` (auto-injected by Vercel when a KV store is linked).

**Setup:**
1. Vercel dashboard → **Storage** → **Create** → **KV**
2. Name: `novada-mcp-quota`
3. **Connect to project** → `novada-mcpserver`
4. Vercel auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` as project env vars

Verify with `vercel env ls` — both should appear.

## 🟡 RECOMMENDED — before declaring "v1 stable"

### 5. Quota atomicity
`decrementQuota()` is read-then-write — concurrent requests can race past the limit. Vercel KV (Upstash Redis) is strongly consistent for single keys, but our increment is *not* atomic (GET → +1 → SET). To fix, switch to Upstash's `INCR` command directly via `@upstash/redis` (Vercel KV is just a thin wrapper), which is atomic. Document the soft-cap behavior in INSTALL.md if you keep the current pattern.

### 6. CORS scope
Currently `Access-Control-Allow-Origin: *` on tool results. Tool results may include scraped content. If you don't expect browser-based MCP clients, restrict to known origins or remove CORS headers from non-OPTIONS responses.

### 7. Zod major version pin
`api/mcp.ts:zodToMcpSchema()` calls `.toJSONSchema()` which is **Zod 4 only**. If peer-dep resolution drops to Zod 3, schemas silently break. Pin in both `package.json`s:

```json
"zod": "4.x"
```

### 8. Stretch: per-token rate limit
Per-IP rate limit is in place (60/min default). Consider also adding per-token rate limit to detect abusive single-user behavior, e.g., 1000/hour/token.

## Deploy sequence after all clears

```bash
# 1. Set the upstream Novada API key
vercel env add NOVADA_API_KEY production

# 2. Create + connect the KV store (Vercel dashboard → Storage → Create → KV)
#    Name: novada-mcp-quota
#    Connect to project: novada-mcpserver

# 3. Build dry-run / size check
vercel build
ls -lh .vercel/output/functions/api/mcp.func/

# 4. Flip the stub-auth gate (only after items 1-2 of BLOCKING are addressed)
vercel env rm STUB_AUTH_WARNING_ACCEPTED production
vercel env add STUB_AUTH_WARNING_ACCEPTED production
# Enter: true

# 5. Deploy
vercel deploy --prod

# 6. Smoke test on the .vercel.app domain first
curl -X POST "https://novada-mcpserver.vercel.app/mcp?token=sk-eu-novada-test" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# 7. Bind custom domain (Vercel dashboard → Domains → Add mcp.novada.com)
#    Add CNAME mcp.novada.com → cname.vercel-dns.com in AWS Route 53

# 8. Verify on the real domain
curl -X POST "https://mcp.novada.com/mcp?token=sk-eu-novada-test" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# 9. Tail logs to watch the first real traffic
vercel logs --follow
```

## CF Worker → Vercel translation cheat sheet

| Cloudflare Worker                              | Vercel equivalent                                            |
|------------------------------------------------|--------------------------------------------------------------|
| `wrangler deploy --dry-run`                    | `vercel build` (checks size at build time)                   |
| `wrangler secret put NOVADA_API_KEY`           | `vercel env add NOVADA_API_KEY production`                   |
| `wrangler kv namespace create NOVADA_MCP_QUOTA`| Vercel dashboard → Storage → Create → KV → connect to project|
| `wrangler.toml`                                | `vercel.json` + env vars in dashboard                        |
| `wrangler tail`                                | `vercel logs --follow`                                       |
| `env.NOVADA_MCP_QUOTA.get/put`                 | `kv.get` / `kv.set` from `@vercel/kv`                        |
| `CF-Connecting-IP` header                      | `x-forwarded-for` / `x-real-ip`                              |
| `routes = [{ pattern, custom_domain: true }]`  | Vercel dashboard → Domains → Add                             |
| 1 MB script / 3 MB compressed limit            | 4 MB compressed / 16 MB total per Edge function              |
| `nodejs_compat` compatibility flag             | Edge runtime auto — uses Web APIs only                       |
