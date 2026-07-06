# API Compliance Verification — Account & Wallet

**Verified:** 2026-06-23
**Sources:** `/tmp/novada-api-pages/04-user.md`, `/tmp/novada-api-pages/16-wallet.md`
**Implementation files checked:**
- `src/tools/proxy_account_create.ts`
- `src/tools/proxy_account_list.ts`
- `src/tools/wallet_balance.ts`
- `src/tools/wallet_usage_record.ts`
- `src/_core/developer_api.ts`

---

## Summary

| Check | Status | Notes |
|-------|--------|-------|
| Base URL `api-m.novada.com` | PASS | `DEVELOPER_API_BASE = "https://api-m.novada.com"` |
| All endpoints use POST | PASS | `devApiPost` wraps `axios.post` exclusively |
| Auth: Bearer token in `Authorization` header | PASS | `Authorization: \`Bearer ${apiKey}\`` |
| Request format: `multipart/form-data` | PASS | `toMultipart()` builds `FormData`; boundary injected via `form.getHeaders()` |
| `/v1/proxy_account/create` — endpoint path | PASS | Exact match |
| `/v1/proxy_account/create` — required fields | PASS | `product`, `account`, `password`, `status` all present |
| `/v1/proxy_account/create` — optional fields | PASS | `remark`, `limit_flow` conditionally appended |
| `/v1/proxy_account/list` — endpoint path | PASS | Exact match |
| `/v1/proxy_account/list` — required fields | PASS | `product`, `page`, `limit` always included in body |
| `/v1/wallet/balance` — endpoint path | PASS | Exact match |
| `/v1/wallet/balance` — no body fields required | PASS | Sends empty `{}` body; API spec has no required fields |
| `/v1/wallet/usage_record` — endpoint path | PASS | Exact match |
| `/v1/wallet/usage_record` — pagination fields | DIVERGENCE | See below |

---

## Detailed Findings

### 1. `/v1/proxy_account/create`

**Doc spec (multipart/form-data):**
- Required: `product` (string), `account` (string), `password` (string), `status` (integer)
- Optional: `remark` (string), `limit_flow` (string)

**Implementation:** Fully compliant. Fields map exactly. `status` is sent as a string in multipart (coerced via `String(v)` in `toMultipart`) — the API spec says type `integer` but multipart carries all scalars as strings; the server parses them. This matches the documented behavior and has been smoke-verified. The two-step confirm gate is an MCP-layer safety feature, not an API-layer concern.

**Product code discrepancy (minor, informational):** The doc lists products `1,2,3,9,10`; our enum is `["1","2","3","4","7","9"]`. Codes `4` (Unlimited) and `7` (Unblocker) are present in our enum but absent from `04-user.md`. Code `10` (Browser API) appears in the doc but is absent from our enum. This mismatch likely reflects the doc being incomplete rather than an API error — the live API smoke test confirmed code `7` works. **No fix required at this time; flag if `10` (Browser API) sub-accounts are needed.**

---

### 2. `/v1/proxy_account/list`

**Doc spec (multipart/form-data):**
- Required: `product` (integer), `page` (integer), `limit` (integer)
- Optional: `status` (integer), `account` (string)

**Implementation:** Compliant. Required fields `product`, `page`, `limit` always sent. Optional `status` and `account` conditionally appended. Type coercion (number → string in multipart) is handled by `toMultipart`.

**Note on `product` type:** Doc declares type `integer`; our schema uses `z.enum(["1","2",...])` (string enum). After `toMultipart` coercion both arrive at the server as strings. Smoke-verified to work.

---

### 3. `/v1/wallet/balance`

**Doc spec (multipart/form-data):** No fields. Auth only.

**Implementation:** Compliant. Sends empty body `{}`. Auth is Bearer token via shared `devApiPost`.

---

### 4. `/v1/wallet/usage_record` — DIVERGENCE FOUND

**Doc spec (multipart/form-data):**
```
page    integer  "Number of entries per page"   [NOTE: doc labels are SWAPPED — this is actually page_size]
limit   integer  "page number"                  [NOTE: doc labels are SWAPPED — this is actually page]
```
The official spec uses field names `page` and `limit` (with visibly swapped descriptions — the descriptions are wrong in the doc, but the **field names** are `page` and `limit`).

**Implementation uses:** `page` and `page_size`.

**Verdict: DIVERGENCE.** Our implementation sends `page_size` but the API spec field name is `limit`. The field `page_size` is not in the spec and will be silently ignored by the server. The effective result is that the server always uses its default page size.

**Additional fields in implementation:** `start_time` / `end_time` / `strat_time` (typo-compat). These fields do **not appear** in the spec for `/v1/wallet/usage_record`. They may be accepted server-side (unspecified optional fields) but are undocumented.

**Action required:** Rename `page_size` → `limit` in `wallet_usage_record.ts` body construction and schema. Update the Zod schema field name and the body object key. The `withDateRangeCompat` date fields are likely harmless extra fields but are unverified.

---

## Auth Method

`developer_api.ts` line 114:
```ts
Authorization: `Bearer ${apiKey}`,
```
Bearer token in `Authorization` header. Matches the `"security":[{"bearer":[]}]` scheme in all four API specs. **PASS.**

---

## Base URL

`developer_api.ts` line 27:
```ts
export const DEVELOPER_API_BASE = "https://api-m.novada.com";
```
Correct. The docs are hosted at `developer-api.novada.com` (GitBook/Next.js); the callable API host is `api-m.novada.com`. The file comment confirms this distinction with a smoke-test citation. **PASS.**

---

## Action Items

| Priority | File | Change |
|----------|------|--------|
| HIGH | `src/tools/wallet_usage_record.ts` | Rename `page_size` → `limit` in body construction (line 54). Update Zod schema field name and `.describe()`. |
| LOW | `src/tools/proxy_account_create.ts` | Consider adding product code `10` (Browser API) to enum if sub-account creation for Browser API is needed. |
