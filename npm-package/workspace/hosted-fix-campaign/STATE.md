# Hosted-Fix Campaign — STATE (single source of truth)
Date: 2026-07-03 | Orchestrator: main session | Budget: 4h
Mission: make unblocker / web-unblocker / browser / proxy WORK via https://mcp.novada.com/mcp ONLY.

## Constraints (from owner, non-negotiable)
- Verification ONLY via the hosted endpoint (no local MCP for testing/verifying)
- Proxy: guided setup acceptable, but returned config must be REAL and usable
- Fix at npm SOURCE (~/Projects/novada-mcp/src/), then vendor-refresh → deploy hosted
- Deploy to Vercel hosted: AUTHORIZED for this campaign. npm publish: NOT authorized.
- DO NOT touch: search, scraper, static extract, API-key auth path (verified healthy)

## Auth model (load-bearing)
- Hosted is PASS-THROUGH: customer token = their real Novada API key → billed to them
- Test key (operator): 1f35b477c9e1802778ec64aee2a6adfa (works: search/scraper/unblock/account tools)
- Vercel env: NOVADA_API_KEY(fallback only), KV_*, RATE_LIMIT, STUB_AUTH, SENTRY_DSN. NO proxy/browser/unblocker envs.

## Live evidence (2026-07-03 sweep, hosted, real key)
1. 31/32 tools return structured responses; novada_unblock(method=render) SUCCEEDS on example.com (6.4s)
2. novada_health_all LIES: reports "Extract/Web Unblocker ❌ 未激活 code=5001" + "Unblock ❌ 5001"
   while unblock render call succeeds with same key → probe bug (wrong endpoint/auth/parsing)
3. Proxy tools → "not configured": hosted env lacks NOVADA_PROXY_ENDPOINT (endpoint is PER-ACCOUNT,
   e.g. xxx.vtv.na.novada.pro:7777 — cannot be a global env; must derive from customer key)
4. novada_proxy_account_list/create WORK via developer-api with the key → per-customer provisioning is possible
5. Browser: prior test showed connectOverCDP reached Novada and failed AUTH (WS close 1006,
   "Account or Password verification failed") → transport works from Vercel within a single invocation;
   missing piece is per-customer browser-zone credentials (example format:
   wss://<user>-zone-browser:<pass>@upg-scbr2.novada.com)
6. npm package history: v0.8.0 shipped "proxy auto-provision", v0.8.3 "Browser API auto-provision" —
   auto-provision code EXISTS in src/; find why it doesn't engage on hosted

## Success standard (verify each via hosted endpoint only)
S1 unblock: novada_unblock method=render returns live content on a JS-heavy page (regression control: keep working)
S2 extract: render=js and render=auto succeed on JS-heavy page; auto NEVER attempts CDP when browser unavailable;
   top-available-tier real error surfaced on failure (no CDP AuthorizationError leakage)
S3 health: novada_health_all reports Web Unblocker/Unblock=Active (matches reality); real upstream codes on
   genuine failures; Browser row truthful; Proxy row actionable guidance not dead "未配置"
S4 browser: novada_browser runs a one-shot task (navigate example.com + snapshot) via hosted, OR if proven
   impossible after live experiments: structured actionable error (fallback acceptance, needs orchestrator sign-off)
S5 proxy: with ONLY a customer API key, proxy tools return WORKING credentials (auto-provisioned via developer-api)
   or a guided flow ending in a verified-usable config (curl through the proxy must succeed)

## Repos / procedures
- Source: ~/Projects/novada-mcp (main, v0.9.2 released today). Build: npm run build. Tests: npx vitest run (baseline 37 fail).
- Hosted: ~/Projects/novada-mcpserver. Vendor refresh: rsync -a --delete build/ vercel/vendor/novada-mcp/ + cp package.json.
  Check NEW deps → vercel/package.json. Gate: node --input-type=module -e "import('./vendor/novada-mcp/tools/index.js')...".
  Deploy: cd ~/Projects/novada-mcpserver && vercel deploy --prod --scope novadateam-mvps. Verify ONLY via mcp.novada.com.
- Sweep harness: /tmp/mcp-tool-sweep.py (adapt for verification matrix)
- Hosted wall-clock: 56s/tool call. Runtime: Vercel Node serverless (NOT Edge). playwright-core vendored (check stub status!)

## Worker board
| ID | Scope | Status | Findings file |
|----|-------|--------|---------------|
| W1 | health_all 5001 probe root cause + fix design | dispatched | w1-health-probe.md |
| W2 | extract auto-ladder gating + browser error UX (Bug1/Bug3) | dispatched | w2-render-ladder.md |
| W3 | proxy auto-provision on hosted via customer key | dispatched | w3-proxy.md |
| W4 | browser one-shot CDP feasibility on hosted + auto-provision | dispatched | w4-browser.md |

## Decisions log
- (orchestrator fills)
