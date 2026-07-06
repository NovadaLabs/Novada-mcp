# Smoke Topic 1: "How much money/quota do I have left?"

## Wallet (master)
- Balance: €254.4
- Latency: 1269ms
- Status: ok

## Per-product quota (plan_balance_all)

Overall status: **partial** (4 ok, 2 known-good 404s)
Latency: 4963ms

| Product | Status | Balance | Expires |
|---------|--------|---------|---------|
| residential | ok | 0 | 2026-05-29 (expired) |
| isp | ok | 0 | 2026-05-29 (expired) |
| mobile | error | — | HTTP 404 (endpoint not provisioned) |
| datacenter | ok | 0 | 2026-05-29 (expired) |
| static | error | — | HTTP 404 (endpoint not provisioned) |
| capture | ok | 39.463547 | (no expire field) |

Notes:
- residential/isp/datacenter plans all expired on 2026-05-29 (5 days before today 2026-06-03), balances zeroed out. Consistent with master wallet still showing €254.4 — money is in wallet, not pre-paid plans.
- mobile + static 404s match the known-good failure path documented in the spec ("mobile/static may legitimately 404 on this account").
- capture has live balance 39.46 (units = capture-task credits).

## Capture logs sample
- Latency: 1646ms
- Status: ok
- Total rows in page: 1 (returned `data.list[]`)
- Sample row: `{"time_label":"00:00","unlocker_total_cost":0,"scraper_total_cost":0,"unlocker_used_res":0,"scraper_used_res":0,"scraper_used_flow":0,"browser_total_cost":0,"browser_used_flow":0}`
- Note: only the 00:00 bucket returned despite page_size=3 — likely because account has no capture activity yet today.

## Verdict
All 3 tools fully working end-to-end against live `api-m.novada.com`. `wallet_balance` and `capture_logs` returned clean `ok` status; `plan_balance_all` returned `partial` as designed, with mobile/static surfacing the documented known-good 404 path and the other 4 products responding cleanly. Real finding: residential/isp/datacenter plans all expired on 2026-05-29 — the agent_instruction wording is correct but a human reading this would want a UX hint like `expired: true` flag rather than having to convert unix timestamps.
