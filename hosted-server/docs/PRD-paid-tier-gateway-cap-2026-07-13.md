# PRD — Paid-Tier Gateway Cap Exemption (P0)

**Date:** 2026-07-13 · **Owner:** tongwu · **Status:** Approved for local implementation (deploy gated on owner approval)
**Incident:** Ethan Pan (paying customer, own API key, per-call billing active) hit the 1000/month Free Gateway Cap on mcp.novada.com. ALL tools failed identically — including `novada_discover`, which should be free. Remote connector fully non-functional for a paying customer.

## Success Standard (owner-defined)

> **A customer who is really spending their own money must never be limited by the free gateway cap.**

Concretely:
1. A key belonging to an account with real payment history passes call #1001+ without cap errors.
2. Meta tools (`novada_discover`, `novada_setup`, `novada_account` + aliases) work in ANY state — even for a cap-exhausted free key. Users must always be able to self-diagnose.
3. Trial-credit / coupon-only accounts remain capped at 1000/month (anti-abuse intact).

## Root Cause (3 defects, all in `hosted-server/vercel/api/mcp.ts`)

| # | Defect | Evidence |
|---|--------|----------|
| RC1 | Plan resolution never implemented: `validateToken` always returns `plan: "free"`; `decrementQuota(ctx.tokenHash, env, "free")` hardcodes free at the only call site. The `"pro"` skip-cap branch exists but is dead code. | `mcp.ts:488` (TODO sub2api stub), `mcp.ts:503-535`, `mcp.ts:848`, `mcp.ts:598` |
| RC2 | Cap check is a blanket gate BEFORE tool routing — everything except `novada_setup` decrements quota, including `novada_discover`. A capped key cannot even list tools or check its own account. | `mcp.ts:847-870`, discover handling at `mcp.ts:916-924` is scope-only |
| RC3 | "Paid" was never modeled. Balance > 0 is NOT a valid proxy (trial credit pollution); no per-call billing-confirmation signal exists in upstream responses (verified: `dispatch()` returns bare content strings; `/v1/capture/request_log` covers only scraper/unblocker). | Investigation 2026-07-13 |

## Paid-User Definition (canonical — reuse everywhere)

> **paid := the account has ≥1 successful order paid with real money.**

Operationally, from `POST https://api-m.novada.com/v1/wallet/usage_record` (Bearer = caller's own key, multipart `page=1&limit=50`):

```
paid := ∃ entry in data.list where
          entry.pay_status == 2            // payment succeeded
      AND (entry.pay_money - entry.coupon_money) > 0   // real dollars, not coupon
```

**Why this formula (verified live 2026-07-13 against tongwu's account, 14 orders):**
- Response contains full order history: `order_type`, `money`, `pay_money`, `coupon_money`, `pay_status`, `pay_time`, `pay_type`.
- Coupon-only orders exist in the wild (observed: ISP order `pay_money=14, coupon_money=14` → net $0). `pay_money > 0` alone would misclassify them as paid. The subtraction excludes them.
- Balance is NOT used: balance is state (polluted by gifts/trials); payment is an event (irreversible evidence of real money).
- Account-level, not key-level: `usage_record` authenticated by any of the account's keys returns the same account orders → key rotation and multi-key teams inherit paid status correctly.

## Design — three layers

### Layer 1 (availability): meta tools never counted, never blocked
- Define `CAP_EXEMPT_TOOLS = new Set(["novada_setup", "novada_discover", "novada_account", ...accountAliases])`.
- In the `CallToolRequestSchema` handler, skip `decrementQuota` entirely for exempt tools (replaces today's charge-then-refund dance for `novada_account` at `mcp.ts:941-948` and the blanket decrement that blocked `novada_discover`).
- These tools also bypass the cap-reached rejection: a capped key can still discover/setup/account.
- Keep the existing pre-quota rejection of invisible tools (`mcp.ts:824-832`) unchanged.

### Layer 2 (correctness): lazy plan resolution → existing "pro" skip path
New function `resolvePlan(apiKey, tokenHash, env): Promise<"free" | "pro">`:

```
cached = kv.get(`${tokenHash}:plan`)
IF cached in {"free","pro"} AND not expired: return cached

TRY:
  resp = devApiPost("/v1/wallet/usage_record", {page:1, limit:50}, apiKey)   // caller's key
  paid = resp.list.some(e => e.pay_status === 2 && (e.pay_money - e.coupon_money) > 0)
  plan = paid ? "pro" : "free"
  kv.set(`${tokenHash}:plan`, plan, { ex: plan === "pro" ? 30*24*3600 : 6*3600 })
  return plan
CATCH (upstream error / timeout):
  IF stale cached value exists: return it        // degrade gracefully
  ELSE: return "free"                            // status quo, never throw
  // log plan_resolution_failed with tokenHash prefix — NEVER the key
```

- TTL asymmetry is deliberate: **pro is sticky (30d)** — once paid, always paid in practice; **free re-checks every 6h** — a user who tops up today gets exempted within hours, not next month.

**Trigger timing (AMENDED 2026-07-13, owner input): lazy at cap-crossing, not at token validation.**
Keys under the cap never trigger a plan lookup at all — 99% of keys cost zero extra upstream calls and zero latency:

```
used = kv.incr(quotaKey)                    // existing atomic decrementQuota path
IF used > PREFETCH_THRESHOLD (900) AND no cached plan:
    fire resolvePlan async (do NOT await)    // pre-warm before the boundary
IF used > monthlyQuota:                      // the 1001st call
    plan    = await resolvePlan(...)         // KV-cached after first resolution
    balance = ctx.balance                    // already fetched by validateToken (mcp.ts:515);
                                             // if absent/stale, one POST /v1/wallet/balance
    IF plan == "pro" OR balance > 0: ALLOW (skip cap)   // orders = primary; balance = OR-fallback
    ELSE: reject with cap error
```

- **Why the OR-fallback:** balance alone lies in both directions (trial credit → false paid; spent-down paid user → false free), so it must never be the sole signal. But as a fallback beyond the cap it is safe: every allowed call bills that balance, so trial-credit overflow is bounded by the trial amount itself, and it covers order-history lag for brand-new payers. Orders formula remains the canonical paid definition.
- `decrementQuota` "pro" branch semantics unchanged; the pro/balance decision wraps the over-cap rejection, not the counter.
- Latency guard: on cache hit resolvePlan is one KV read; the 900-prefetch keeps the 1001 boundary from paying the upstream round-trip synchronously in the common case.

### Layer 3 (UX): cap error copy update
When a **free** key hits the cap, the error message must now say topping up lifts the gateway cap (it does, via Layer 2). Replace option 2 in the message: "Top up your Novada balance … does not raise the free-gateway cap" → "Make any real top-up/purchase — paid accounts are exempt from the gateway cap (takes effect within ~6 hours)." Keep `agent_instruction` field, update `retry_recommended` guidance accordingly.

## Edge Cases (must be covered by tests)

| Scenario | Expected |
|----------|----------|
| Trial user, 0 orders, call #1001 | Blocked (cap), meta tools still work |
| Coupon-only orders (net $0) | Treated as free |
| Paid user ($ orders), call #1001+ | Passes, no cap |
| Paid user, balance now $0 | Still pro (payment is an event, not state); upstream billing errors surface naturally |
| User tops up mid-month after being capped | Exempt within ≤6h (free TTL expiry) |
| Key rotation / second key, same account | Inherits paid (account-level orders) |
| usage_record endpoint down, no cache | Default free (status quo), request proceeds through normal quota path, error logged |
| usage_record down, stale cache exists | Use stale value |
| `pay_status != 2` (pending/failed/refund states) | Not counted as paid |
| Concurrent first calls on uncached key | Both may resolve plan; benign double-write to same KV key |
| Key at call #500 (under cap) | Zero plan lookups, zero added latency (lazy trigger) |
| Trial-credit user, balance>0, call #1001 | Allowed via balance fallback; every call bills trial balance → abuse bounded by trial amount |
| Paid user, orders exist, balance $0, call #1001 | Allowed via pro (orders primary) |
| No orders, no balance, call #1001 | Blocked (cap) — correct |
| Upstream down exactly at 1001 crossing, no cache | Default free → blocked; 900-prefetch makes this window rare; meta tools still work |

## Non-Goals (v1)

- Per-call "billed = exempt" (no reliable synchronous billing signal upstream — requires backend work; see Follow-ups).
- sub2api plan resolution (`mcp.ts:488` TODO stays; this PRD's `resolvePlan` is the interim that may later be swapped).
- Refund/chargeback demotion of pro status (rare; 30d TTL naturally re-evaluates).

## Amendment 2 (2026-07-13): uid-keyed plan cache

`usage_record` responses include `uid` (account ID). When resolvePlan runs, store the plan cache under BOTH `${tokenHash}:plan` and `uid:${uid}:plan` — and check the uid-keyed entry too (when uid is known) so multi-key paid accounts share one resolution. Zero extra upstream calls: uid arrives for free with the payload we already fetch.

REVERTED 2026-07-14 — simplicity audit: 2 extra KV writes per resolution for a near-nonexistent multi-key staggered-TTL scenario. Single-key cache retained.

## Known accepted limitation: cap is per-key, not per-account

Each account can create up to 10 keys → a determined free rider gets ~10×1000 calls/month. Accepted for v1: (a) per-account counting from call #1 would require an upstream key→uid resolution on first call, destroying the zero-cost-under-cap property; (b) multi-ACCOUNT abuse is unbounded at gateway level anyway (signup friction's job); (c) post-fix, the cap only binds non-paying users, so the leak is bounded to cents of serverless compute. The uid-keyed cache above lays the foundation if per-account capping is ever justified by real abuse data.

## Follow-ups (file in Linear, team NOV)

1. **Backend ask (fudong):** expose per-call billing metadata OR a `/v1/account/tier` endpoint so the MCP layer stops inferring. Also confirm `pay_status`/`source`/`type` enum semantics.
2. **Backend ask (fudong):** confirm EVERY content tool call bills the caller (no free/cached upstream paths). The balance>0 over-cap fallback's "abuse is bounded" argument depends on it; if some tools are free upstream, exclude them from the fallback allowance. Verifier must also probe this.
3. **Ops:** unblock Ethan immediately — either deploy this fix, or manually `kv del <sha256(his key)>:2026-07` (requires Vercel KV access + owner approval).
4. Monitor: log `plan_resolution` outcomes for 2 weeks; alert if pro-rate is anomalously high (abuse signal). Revisit per-account capping ONLY if logs show real multi-key abuse.

## Test Plan (TDD — write these FIRST)

Extract pure function `classifyPlanFromUsageRecord(payload): "free" | "pro"` so unit tests need no network:
1. Empty list → free. 2. Coupon-only order → free. 3. One real-money order → pro. 4. pay_status=1 (unpaid) real-money → free. 5. Mixed → pro.
Integration-level (mock KV + mock devApiPost): cap skip for pro at call 1001; meta tools never decrement; fail-safe default free; TTL values as specified.
Golden-file check: `scripts/golden/` baselines must be regenerated if tool responses change (error copy change affects them).

## Deployment (REDLINE)

Local implementation + tests + review only. **No commit to main / no deploy to mcp.novada.com without explicit owner approval.** Work on branch `fix/paid-tier-cap`.
