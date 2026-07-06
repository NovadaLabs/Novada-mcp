# W1 — Health Probe 5001 Root Cause + Fix

## Status: DONE

---

## Root Cause

**One sentence:** The health probe was sending `js_render: false` to the Web Unblocker endpoint, which always returns `code=5001` (an internal "Internal Server Error" for that mode) regardless of account activation status — making the probe falsely report "not activated" for any account.

**Confirmed via live curl:**
```
POST webunlocker.novada.com/request  (js_render: false)
→ { code: 5001, data.code: 500, msg: "Internal Server Error", err_detail: 559 }

POST webunlocker.novada.com/request  (js_render: true)
→ { code: 0, data.code: 200 }  ← SUCCEEDS with same key
```

`code=5001` on `js_render:false` is an endpoint behavior, NOT a product-activation gate. It fires for every key including fully activated accounts.

---

## Findings

### Finding 1 — Probe sent js_render:false (root cause)
- **Evidence:** `build/tools/health_all.js:104` (stale build) had `js_render: false`
- **Evidence:** `build/tools/health.js:35` (stale build) had `js_render: false`
- **Evidence:** Live curl confirmed: `js_render:false` → `code: 5001` on the real endpoint for a working account key. `js_render:true` → `code: 0`.
- **Severity:** Critical — causes false "not_activated" for 100% of accounts
- **Confidence:** High (confirmed live)

### Finding 2 — Fix was already committed to source (d29dc9c), build was stale
- **Evidence:** `src/tools/health_all.ts:132` has `js_render: true` + comment explaining why
- **Evidence:** `src/tools/health.ts:44` also has `js_render: true`
- **Evidence:** The vendored `novada-mcpserver/vercel/vendor/novada-mcp/tools/health_all.js` already had `js_render: true` (manually patched)
- **Evidence:** The `build/` output was stale (timestamp 17:32 vs source commit earlier today)
- **Action taken:** Ran `npm run build` to regenerate build output

### Finding 3 — probeUnblockAll delegates to probeExtractAll (correct approach)
- **Evidence:** `health_all.ts:326-336` — Unblock probe reuses Extract probe with relabeling
- **Status:** Both rows ("Extract / Web Unblocker" and "Unblock API") return the same status — fixing the Extract probe fixes both. No separate fix needed.

### Finding 4 — code=5001 was misidentified as "not_activated" signal
- **Evidence:** The old code comment "code=5001 is the definitive 'product not activated' signal" is WRONG. Live test: `js_render:false` triggers `code=5001` for an activated account. The REAL "not activated" signal is still being investigated (5001 appears to be a general internal error, not product-specific).
- **Current fix:** The probe now sends `js_render:true` so code=5001 only fires when the product is genuinely unavailable for JS-render mode, not as a spurious false negative.
- **Residual:** If a real "not activated" account returns 5001 with js_render:true, the current mapping (5001 → not_activated) is directionally correct. Verified non-activated behavior not testable with the operator key.

---

## Fix Details

**Files modified:** None new — source was already correct in commit d29dc9c.

**Build regenerated:** `npm run build` (build/ was stale, vendor in novada-mcpserver was already manually correct)

**What changed in the probe (captured in d29dc9c):**

`src/tools/health_all.ts:probeExtractAll()` — changed payload from:
```json
{ "target_url": "...", "response_format": "html", "js_render": false, "country": "" }
```
to:
```json
{ "target_url": "...", "response_format": "html", "js_render": true, "country": "" }
```

Same change in `src/tools/health.ts:probeExtract()`.

Also fixed in d29dc9c:
- `probeExtractAll` note changed from "NOVADA_WEB_UNBLOCKER_KEY env var not set" → "NOVADA_API_KEY env var not set (covers Web Unblocker — no separate key needed)"
- `resolveProxyCredentials` used in health.ts probeProxy instead of raw env check
- 5001 mapping kept but no longer fires as false-negative

---

## Verification

```
npx tsc --noEmit    → EXIT:0 (clean)
npx vitest run tests/tools/health.test.ts  → 12/12 passed
npx vitest run (full suite)  → 8 test files fail, 30 tests fail (BASELINE — pre-existing failures, confirmed same as before my changes)
```

---

## Self-Review (mandatory 4-check)

1. **Traced ≥1 error path:** Yes — probeExtractAll catch block returns `status: "error"` with the error message. The `finally { clearTimeout(timer) }` fires correctly. The abort controller is cleared regardless of outcome. No `process.exit()` in this path.

2. **No global binaries assumed:** `npm run build` is the only command used — it uses the project-local tsc from devDependencies, not a global. `npx vitest` also uses the project-local install.

3. **Ternary ordering:** The code has: `if (code === 0) → active; if (code === 5001) → not_activated; else → error`. This is if/else-if chain, not a ternary, so no ordering issue. In the `statusIcon()` switch statement in health_all.ts:340-349, cases have no numerical comparison so ordering is irrelevant.

4. **Time logic vs TODAY:** No time-based logic in the probe. The `new Date().toISOString()` in the output is a wall-clock stamp for display only, not a decision gate.

---

## What Did NOT Require Changes

The following were investigated and found already correct in the source:
- Auth header format: `Authorization: Bearer ${unblockerKey}` (matches working `fetchWithRender` path)
- Endpoint URL: `https://webunlocker.novada.com/request` (matches config.ts `WEB_UNBLOCKER_BASE`)
- Credential resolution: `getWebUnblockerKey()` returns `store.apiKey` on hosted (caller's key via `withCredentials`)
- `probeUnblockAll` correctly delegates to `probeExtractAll` — no double-fix needed

---

## Dismissed Failure Mode

Could the fix NOT be the `js_render` flag, and instead be a request format difference (JSON vs form-urlencoded)?
- **Tested:** Both JSON and form-urlencoded with `js_render:true` return `code: 0`. Both with `js_render:false` return `code: 5001`. The format is NOT the root cause. The `js_render` flag is the sole discriminator.

---

## Files Owned (per brief)
- `src/tools/health_all.ts` — fix already present in source (commit d29dc9c)
- `src/tools/health.ts` — fix already present in source (commit d29dc9c)
- `tests/tools/health.test.ts` — 12/12 pass, no changes needed
- `build/` — regenerated by `npm run build`
