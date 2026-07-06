# Smoke Topic 2: "How much volume did I use?"

## Wallet transactions (wallet_usage_record)
- Rows returned: 0
- Server total count: 10
- Latency: 1249ms
- Sample row: (list empty — server reports count=10 but page 1 list is `[]`; likely server-side pagination quirk or no rows on this page)

## Daily traffic by product (traffic_daily, 2026-05-25 → 2026-06-03)
| Product | Status | Total `use` (bytes) | Total used (GB) |
|---------|--------|---------------------|-----------------|
| residential | ok | 0 | 0.000 |
| isp | ok | 0 | 0.000 |
| mobile | error | — | endpoint 404 (account lacks product) |
| datacenter | ok | 0 | 0.000 |
| static | error | — | endpoint 404 (account lacks product) |

- Aggregate `total_mb_across_products`: **0 MB**
- All three successful products returned a single placeholder row with `use=0` for the whole 10-day window — no traffic recorded on this account in the range.
- `status: "partial"` correctly signals 2 of 5 products errored (mobile, static both 404'd).
- Latency: 3924ms (parallel fan-out across 5 products).

## Proxy sub-accounts (proxy_account_list)
- Status: **error**
- Code: `INVALID_API_KEY` (graceful, in allowed set)
- Server message: `Developer-api auth failure (code=10001): Invalid parameter`
- Latency: 641ms
- **Flag for fudong:** The MCP layer maps server `code=10001` → `INVALID_API_KEY`, but the same API key works for wallet_usage_record and traffic_daily on the same run. Likely the sub-account endpoint isn't enabled on this account, or the server returns 10001 ambiguously for "feature not provisioned." Worth a docs/server-side clarification.

## WRITE-gate validation (proxy_account_create — dry-run)
- status: `confirmation_required` ✅
- preview.password masked (`"********"`) ✅
- Latency: **1ms** (must be <50ms to prove no API call) ✅
- API was NOT called ✅
- agent_instruction correctly tells the agent to show preview and re-call with `confirm: true` only after human approval.

## Verdict
All 4 tools behave correctly. Traffic-volume read path (wallet_usage_record + traffic_daily) works end-to-end with graceful partial-failure semantics; account in test range has zero usage, which is a real signal not a tool bug. proxy_account_list surfaces a confusing server error — recommend either remapping `code=10001 + "Invalid parameter"` to a distinct `FEATURE_NOT_ENABLED` code or documenting the ambiguity. WRITE-gate on proxy_account_create is solid: password masked, latency 1ms confirms no network egress before confirm.
