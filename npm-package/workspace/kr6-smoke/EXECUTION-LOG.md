# KR-6 Multipart Fix — Execution Log

**Started:** 2026-06-07
**Branch:** `kr6-account-tools` (local only — NO push, NO publish per hard rules)
**Orchestrator:** Claude Sonnet 4.6

---

## Plan (confirmed by user 2026-06-07)

- **Phase 0** Spec audit — 6 parallel research agents read API docs per tool
- **Phase 1** Apply field-name fixes to 6 remaining KR-6 tools
- **Phase 2** Build verification
- **Phase 3** Smoke test harness — per-tool smoke scripts + README
- **Phase 4** KR-5 close-out — mobile hero-pill wrap fix
- **Phase 5** Documentation — PROJECT_STATE.md changelog + AgentRecall memory
- **Phase 6** Two local commits, no push
- **Phase 7** Final report

Hard rules: no `git push`, no `npm publish`, no Vercel deploy, no version bump, no AWS/Vercel UI changes. When spec is ambiguous → surface to fudong, don't guess.

---

## Phase 0 — Spec Audit · COMPLETE

Six parallel Sonnet research agents reported. Consolidated findings:

| Tool | Verdict | Code change needed? |
|---|---|---|
| `wallet_balance` | ✅ correct | None |
| `wallet_usage_record` | ✅ correct (`page_size` IS right here per 2026-06-03 live smoke) | None |
| `traffic_daily` | ⚠️ residential/isp/datacenter paths correct; mobile/static paths unconfirmed | None (graceful 404 handling already present) |
| `plan_balance_all` | ✅ paths + body correct; mobile/static unconfirmed; 404 handled gracefully | None |
| `account_summary` | ✅ internal calls all match current schemas; no cascade from proxy_account_* rewrite | None |
| `capture_logs` | ⚠️ undocumented endpoint `/v1/capture/logs` — audit agent's "fix" conflated it with `/v1/proxy_account/consume_log` (different feature). Rejected. | None until fudong confirms `/v1/capture/logs` exists |

### Key insight

**Pagination convention is per-endpoint, NOT global.** `proxy_account/list` wants `limit`. `wallet/usage_record` wants `page_size`. We confirmed this from the developer-api-requirements.html smoke results (2026-06-03). So our prior assumption "rename every `page_size` to `limit`" would have been wrong. The proxy_account_* rewrite was correct, but the other tools should stay as-is.

### Independent reviewer cross-check (manual)

The `capture_logs` audit agent claimed the tool should target `/v1/proxy_account/consume_log` instead of `/v1/capture/logs`. **Rejected on re-read** — the tool description in `src/index.ts:548` and `agent_instruction` clearly state this tool is for **scraper/capture task logs** (different feature from proxy sub-account traffic logs). The agent conflated two unrelated endpoints because both have "log" in the name. This is exactly why we run reviews — a bad fix here would have replaced one bug with another.

---

## Phase 1 — Field-name fixes · SKIPPED (audit shows no fixes needed beyond proxy_account_*)

Trying to fix what isn't broken is a risky move. Per audit:

- 4 tools confirmed correct (wallet_balance, wallet_usage_record, account_summary, plan_balance_all)
- 2 tools have undocumented endpoints (traffic_daily mobile/static, capture_logs) — code paths chosen by symmetry, graceful 404 handling, won't crash; just may return null for those products

Decision: **no speculative changes**. Document open questions for fudong instead.

---

## Phase 2 — Build verification · PENDING (re-run after KR-5 mobile fix to confirm nothing slipped)

---

## Phase 3 — Smoke test harness · IN PROGRESS

Write per-tool smoke scripts so fudong can run them with a real key and see exactly what each tool sends. Files written to `workspace/kr6-smoke/`:

- `smoke-proxy-account.ts` — list & create (preview-only, no live create) — ALREADY WRITTEN
- `smoke-wallet-balance.ts` — NEW
- `smoke-wallet-usage-record.ts` — NEW
- `smoke-plan-balance-all.ts` — NEW
- `smoke-traffic-daily.ts` — NEW
- `smoke-account-summary.ts` — NEW
- `smoke-capture-logs.ts` — NEW (will likely fail until fudong confirms endpoint path)
- `README.md` — NEW: how to run, what to expect

---

## Phase 4 — KR-5 close-out · PENDING

Fix hero status pill mobile wrap; re-screenshot; done.

---

## Phase 5 — Documentation · PENDING

- `PROJECT_STATE.md` §11 changelog entry for 2026-06-07
- AgentRecall `remember` tagged `novada-mcp` capturing the multipart root cause

---

## Phase 6 — Local commits · PENDING

Two commits, explicit file staging, no `git add -A`, no push, no publish.

---

## FUDONG-CLARIFY LIST (open questions)

These need a real backend answer before we can claim KR-6 is "done for fudong":

1. **`/v1/capture/logs`** — does this endpoint exist? If yes, what are its required fields? (Currently we send `page`, `page_size`, optional `start_time`/`end_time`, optional `status`. Spec is silent.)
2. **`/v1/mobile_flow/balance`** and **`/v1/mobile_flow/consume_log`** — do these exist for mobile (product code 9), or is mobile not a flow-based product?
3. **`/v1/static_flow/balance`** and **`/v1/static_flow/consume_log`** — same question. Static may be IP-based (`/v1/static_house/*`), in which case no `_flow` endpoints exist.
4. **`/v1/capture/get_balance`** response shape — confirmed live as bare float (39.46). Is `data` always a bare number, or sometimes an object with `.balance` key?
5. **`strat_time` typo** — server-side typo for `start_time`? Code emits both for forward-compat, but no captured docs mention `strat_time`. Confirm whether to keep this shim.
6. **`consume_log` response per-row schema** — what fields? (currently `extractTotalMb` in `traffic_daily` tries `traffic_mb` / `mb` / `consume_mb` / `total_mb` / `value` — pure guesses; if all wrong, totals will always be 0).
7. **`/v1/wallet/balance`** GET vs POST — code uses POST, prior smoke used GET; both worked. Canonical method per docs?

All 7 will be packaged into a single message we can paste to fudong after he's done with the multipart change.
