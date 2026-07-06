# API Compliance Verification — IP Whitelist & Prohibit Domain

Date: 2026-06-23
Spec sources: `/tmp/novada-api-pages/05-whitelist.md`, `/tmp/novada-api-pages/17-prohibit-domain.md`
Implementation: `src/tools/ip_whitelist.ts`, `src/index.ts`

---

## Summary

| API Endpoint | Spec Required Fields | Implemented | Registered in server | Verdict |
|---|---|---|---|---|
| POST /v1/white_list/add | product (int, req), ip (req), remark (opt) | YES | NO | BROKEN — code exists, not wired |
| POST /v1/white_list/list | product (int, req), ip (opt), start_time, end_time, lock | YES | NO | BROKEN — code exists, not wired |
| POST /v1/white_list/del | product (str, req), ips (req, comma-sep) | YES | NO | BROKEN — code exists, not wired |
| POST /v1/white_list/remark | product (int, req), id (req), remark (opt) | YES | NO | BROKEN — code exists, not wired |
| POST /v1/prohibit_domain/add | address (req) | NO | NO | MISSING |
| POST /v1/prohibit_domain/list | (no required fields) | NO | NO | MISSING |
| POST /v1/prohibit_domain/del | id (req), is_all (req: "1"=All, "2"=No) | NO | NO | MISSING |

---

## IP Whitelist — Detailed Findings

### Implementation quality: CORRECT

`src/tools/ip_whitelist.ts` implements all 4 whitelist endpoints correctly:

**Field compliance per endpoint:**

**add (`/v1/white_list/add`):**
- `product`: sent as string (enum "1"|"4"|"5") — spec says integer, but multipart/form-data serialization is fine
- `ip`: required, validated with early error return
- `remark`: optional, max 200 chars — COMPLIANT
- WRITE gate (`confirm: true`) implemented correctly

**list (`/v1/white_list/list`):**
- `product`: required — COMPLIANT
- `ip`: optional filter — COMPLIANT
- `start_time`, `end_time`: optional datetime filters — COMPLIANT
- `lock`: optional integer (0=Unlocked, 1=Locked) — COMPLIANT

**del (`/v1/white_list/del`):**
- `product`: sent as string — spec says string for this endpoint — COMPLIANT
- `ips`: required, comma-separated — COMPLIANT
- WRITE gate implemented correctly

**remark (`/v1/white_list/remark`):**
- `product`: required — COMPLIANT
- `id`: required, validated with early error return — COMPLIANT
- `remark`: optional — COMPLIANT

### Product codes: CORRECT

Implementation uses `WL_PRODUCT_CODES = ["1", "4", "5"]` mapping to:
- `"1"` = Residential (spec: `1=Residential`)
- `"4"` = Unlimited (spec: `4=Unlimited proxies`)
- `"5"` = Static ISP (spec: `5=Static isp`)

All three codes match spec exactly.

### CRITICAL BUG: Tool not registered in server

`novada_ip_whitelist` is exported from `src/tools/index.ts` (line 66-67) but:
- NOT in the MCP tool list in `src/index.ts`
- NOT in the `switch(name)` handler in `src/index.ts`
- NOT in the CLI help text in `src/index.ts`

The tool is unreachable by any MCP client. It would fall through to the "Unknown tool" error branch.

---

## Prohibit Domain — Detailed Findings

### Status: ENTIRELY MISSING

No file exists for prohibit domain. The grep for `prohibit` across all of `src/` returns zero results.

**Missing endpoints:**

**POST /v1/prohibit_domain/add:**
- Required: `address` (string — domain to block)
- No implementation

**POST /v1/prohibit_domain/list:**
- No required fields (empty body)
- No implementation

**POST /v1/prohibit_domain/del:**
- Required: `id` (string), `is_all` (string: "1"=delete all, "2"=delete by ID)
- No implementation

---

## Action Items

### P0 — Fixes required for whitelist to work at all

1. Register `novada_ip_whitelist` in `src/index.ts`:
   - Add tool descriptor to the tools array
   - Add `case "novada_ip_whitelist":` in the switch handler
   - Add to CLI help text
   - Add to "Available" list in the unknown-tool error message

### P1 — New tool for prohibit domain (currently not covered)

2. Create `src/tools/prohibit_domain.ts` implementing all 3 endpoints:
   - `add`: single param `address` (string, required), WRITE-gated
   - `list`: no required params, read-only
   - `del`: `id` (required) + `is_all` ("1"|"2", required), WRITE-gated
3. Register in `src/index.ts` as `novada_prohibit_domain`

---

## Files Checked

- `/tmp/novada-api-pages/05-whitelist.md` — spec for 4 whitelist endpoints
- `/tmp/novada-api-pages/17-prohibit-domain.md` — spec for 3 prohibit domain endpoints
- `/Users/tongwu/Projects/novada-mcp/src/tools/ip_whitelist.ts` — implementation (correct but unregistered)
- `/Users/tongwu/Projects/novada-mcp/src/tools/static_ip_mgmt.ts` — unrelated (static ISP purchase/renew)
- `/Users/tongwu/Projects/novada-mcp/src/index.ts` — server registration (whitelist absent)
