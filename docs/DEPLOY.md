# Deploy — Novada Hosted MCP

> Audience: Novada ops + future maintainers. End users do **not** read this file.

---

## Prerequisites

- Cloudflare account with Workers + KV access (Workers Paid plan recommended for >100k req/day).
- `wrangler` CLI installed: `npm i -g wrangler` (v3.80+).
- DNS control of `novada.com` (via Cloudflare).
- Access to the `Goldentrii/novada-mcp` GitHub repo (or wherever the Worker lives).

---

## One-time setup

```bash
# 1. Clone + install
git clone https://github.com/NovadaLabs/novada-mcp.git
cd novada-mcp/hosted/worker
npm install

# 2. Authenticate wrangler
wrangler login

# 3. Set upstream Novada API key secret
#    The worker proxies tool calls to the Novada upstream API and needs a valid
#    Novada API key. Set as a Worker secret (not a plain env var) so it never
#    lands in source. When prompted, paste the upstream Novada API key (the one
#    you'd use with `npx novada-mcp` locally). Verify with `wrangler secret list`.
wrangler secret put NOVADA_API_KEY

# 4. Create KV namespace for quota tracking
wrangler kv namespace create NOVADA_MCP_QUOTA
# → output ends with: id = "abc123def456..."
# Paste that id into wrangler.toml under [[kv_namespaces]]

# 5. First deploy (lands on a *.workers.dev subdomain)
wrangler deploy
# → e.g. https://novada-mcp-hosted.YOUR-CF-SUBDOMAIN.workers.dev

# 6. DNS: add CNAME on Cloudflare DNS for novada.com
#    Name:   mcp
#    Target: novada-mcp-hosted.YOUR-CF-SUBDOMAIN.workers.dev
#    Proxy:  ON (orange cloud)

# 7. Workers Routes: add a route binding
#    Cloudflare Dashboard → Workers & Pages → novada-mcp-hosted → Triggers → Add Route
#    Route:  mcp.novada.com/mcp*
#    Zone:   novada.com

# 8. Redeploy so the route picks up
wrangler deploy

# 9. Verify
curl 'https://mcp.novada.com/mcp?token=sk-eu-novada-test'
# expect: 401 invalid_token (since test token isn't valid) — confirms routing works
```

---

## Token rotation runbook (v0.2 — sub2api)

Once sub2api is integrated, tokens are looked up live; no Worker redeploy needed when keys rotate. Procedure:

1. User regenerates key in `novada.com/dashboard`.
2. sub2api receives the rotation event and revokes the old token.
3. Worker sees `validateToken(old)` → 401 on next call.
4. End user updates their MCP client config with the new URL.

For emergency manual revocation (pre-sub2api):

```bash
wrangler kv key put --binding NOVADA_MCP_REVOKED "sk-eu-novada-LEAKED" "revoked"
```

---

## Monitoring + alerting

- **Dashboard:** Cloudflare → Workers & Pages → `novada-mcp-hosted` → **Metrics**.
  - Watch: request count, error rate, p95 CPU time.
- **Daily check (manual until automated):** KV usage / quota burn — `wrangler kv key list --binding NOVADA_MCP_QUOTA | wc -l` gives rough active-key count.
- **Alerts** — Cloudflare → **Notifications** → **Create**:
  - Alert if 5xx rate > 1% for 10 min (Workers HTTP error rate notification).
  - Alert if request rate drops > 80% vs trailing 24h (proxy for outage).
  - Channel: email `oncall@novada.com` + Slack `#mcp-ops`.

---

## Rollback

```bash
# List recent deploys
wrangler deployments list

# Rollback to a specific deploy id
wrangler rollback <DEPLOYMENT_ID>
```

Rollback is atomic and propagates to all CF edge POPs within ~30 s.

---

## Cost

- **Workers Free:** 100k requests / day. Sufficient for v0.1 beta.
- **Workers Paid ($5/mo):** 10M requests / month included, then $0.30 per million.
- **KV:** 100k reads/day + 1k writes/day free, then $0.50 / million reads.
- **Trigger to upgrade:** sustained > 3M req / month (~100k req/day average) → move to Workers Paid.

---

## Common ops tasks

```bash
# Tail live logs
wrangler tail

# Inspect a quota counter
wrangler kv key get --binding NOVADA_MCP_QUOTA "sk-eu-novada-XXXX:2026-06"

# Manually grant extra calls to a user (subtract from counter)
wrangler kv key put --binding NOVADA_MCP_QUOTA "sk-eu-novada-XXXX:2026-06" "0"

# Force a redeploy (no code change)
wrangler deploy --compatibility-date $(date -u +%Y-%m-%d)
```
