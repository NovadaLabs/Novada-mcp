# Pre-launch Checklist (Worker)

Read this before flipping `STUB_AUTH_WARNING_ACCEPTED = "true"` in `wrangler.toml`.

## 🔴 BLOCKING — must clear before any public exposure

### 1. Token validation is a stub
`src/index.ts:validateToken()` accepts **any** token starting with `sk-eu-novada-`. There is **no** lookup against a database; there is **no** quota enforcement at the auth layer (quota is enforced separately via KV). An attacker who learns the prefix `sk-eu-novada-` can generate unlimited valid-looking tokens and each one gets a fresh 5000-call quota.

**To fix before launch:**
- Wire `validateToken()` to sub2api / your customer DB
- Reject unknown tokens with `INVALID_TOKEN` (401)
- Return real `quota_remaining` from the DB record

**Until fixed:** keep `STUB_AUTH_WARNING_ACCEPTED = "false"` (the worker will refuse all requests with 503).

### 2. Bundle size check
Parent `novada-mcp` package depends on `axios`, `playwright-core`, `exceljs`, `pdf-parse`, `cheerio`. CF Workers has a **1 MB script size limit (3 MB compressed)**. Run before deploy:

```bash
cd ~/Projects/novada-mcp/hosted/worker
npx wrangler deploy --dry-run --outdir=./dist
ls -lh dist/
```

If `dist/index.js` exceeds 3 MB, the deploy will fail. Mitigation:
- Identify the largest module via `npx esbuild-visualizer` or `wrangler deploy --dry-run --metafile`
- Move heavy imports (Playwright, pdf-parse) out of the hot path — the browser tools are already disabled via 501 responses; ensure their imports aren't reachable from the entry

### 3. NOVADA_API_KEY secret set
The worker returns `500 WORKER_MISCONFIGURED` on every tool call without this secret. Set via:

```bash
wrangler secret put NOVADA_API_KEY
# Paste the upstream Novada API key when prompted
```

Verify with `wrangler secret list`.

### 4. KV namespace ID set
`wrangler.toml` ships with `id = ""`. Wrangler will refuse to deploy. Run:

```bash
wrangler kv namespace create NOVADA_MCP_QUOTA
```

Copy the returned id into `wrangler.toml`.

## 🟡 RECOMMENDED — before declaring "v1 stable"

### 5. Quota atomicity
`decrementQuota()` is read-then-write — concurrent requests can race past the limit. CF KV is eventually consistent. If strict enforcement matters, migrate to **Durable Objects** for quota counters. Document the soft-cap behavior in INSTALL.md if you keep KV.

### 6. CORS scope
Currently `Access-Control-Allow-Origin: *` on tool results. Tool results may include scraped content. If you don't expect browser-based MCP clients, restrict to known origins or remove CORS headers from non-OPTIONS responses.

### 7. Zod major version pin
`src/index.ts:zodToMcpSchema()` calls `.toJSONSchema()` which is **Zod 4 only**. If peer-dep resolution drops to Zod 3, schemas silently break. Pin in both `package.json`s:

```json
"zod": "4.x"
```

### 8. Stretch: per-token rate limit
Per-IP rate limit is in place (60/min default). Consider also adding per-token rate limit to detect abusive single-user behavior, e.g., 1000/hour/token.

## Deploy sequence after all clears

```bash
# 1. Set secret
wrangler secret put NOVADA_API_KEY

# 2. Create KV namespace (paste id into wrangler.toml)
wrangler kv namespace create NOVADA_MCP_QUOTA

# 3. Dry-run bundle size check
wrangler deploy --dry-run --outdir=./dist
ls -lh dist/

# 4. Edit wrangler.toml: STUB_AUTH_WARNING_ACCEPTED = "true"
#    (only after items 1-2 of BLOCKING are addressed)

# 5. Deploy
wrangler deploy

# 6. Smoke test
curl -X POST "https://novada-mcp-hosted.YOUR-SUBDOMAIN.workers.dev/mcp?token=sk-eu-novada-test" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# 7. Bind custom domain (CF dashboard → Workers → Triggers → Custom Domain)

# 8. Verify on real domain
curl -X POST "https://mcp.novada.com/mcp?token=sk-eu-novada-test" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```
