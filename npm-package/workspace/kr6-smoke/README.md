# KR-6 Smoke Tests

End-to-end smoke tests for every KR-6 developer-api tool. Run any one to verify that tool's MCP wrapper actually talks to `api-m.novada.com` correctly after the 2026-06-05 multipart fix.

## Setup

```bash
export NOVADA_DEVELOPER_API_KEY="your-key"   # or NOVADA_API_KEY as fallback
cd ~/Projects/novada-mcp
```

## Run individual smoke tests

| Tool | Command | Confidence |
|---|---|---|
| `wallet_balance` | `npx tsx workspace/kr6-smoke/smoke-wallet-balance.ts` | HIGH (live-smoked 2026-06-03) |
| `wallet_usage_record` | `npx tsx workspace/kr6-smoke/smoke-wallet-usage-record.ts` | HIGH |
| `proxy_account_list` | `npx tsx workspace/kr6-smoke/smoke-proxy-account.ts` | MED (newly rewritten; verifies fix worked) |
| `plan_balance_all` | `npx tsx workspace/kr6-smoke/smoke-plan-balance-all.ts` | MED (mobile/static may 404) |
| `traffic_daily` | `npx tsx workspace/kr6-smoke/smoke-traffic-daily.ts` | LOW (response field names guessed) |
| `account_summary` | `npx tsx workspace/kr6-smoke/smoke-account-summary.ts` | MED (composite of above) |
| `capture_logs` | `npx tsx workspace/kr6-smoke/smoke-capture-logs.ts` | UNKNOWN (endpoint path undocumented) |

## What "green" looks like

Each smoke prints the tool's JSON output to stdout. Success = top-level `"status": "ok"` (or `"partial"` with mobile/static unavailable for plan/traffic — that's account state, not a bug).

## What to do if you see `code:10001 Invalid parameter`

That's the signature of either (a) Content-Type wrong (multipart helper broken) or (b) field names wrong. Capture the raw envelope and the request URL, paste to fudong. If `wallet_balance` works but `proxy_account_list` shows 10001, it's a field-name issue; if BOTH fail with 10001, the multipart helper itself regressed.

## Open questions (fudong-clarify)

See `FUDONG-CLARIFY.md` in this directory — 7 open spec questions that affect tool correctness. We chose not to make speculative changes; instead we have honest smoke tests that will reveal the actual server behavior.

## Files

- `smoke-*.ts` — one file per tool
- `FUDONG-CLARIFY.md` — open questions for backend team
- `EXECUTION-LOG.md` — what we did, when, and why (read this for context)
- `topic1-money-quota.md`, `topic2-volume-used.md` — earlier orchestrator notes
