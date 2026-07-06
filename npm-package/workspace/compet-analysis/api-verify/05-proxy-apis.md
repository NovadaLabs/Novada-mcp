# Proxy API Compliance Verification
Generated: 2026-06-23

Sources compared:
- API docs: `/tmp/novada-api-pages/06-residential.md` through `11-dedicated-dc.md`
- Implementation: `src/tools/proxy_residential.ts`, `proxy_mobile.ts`, `proxy_isp.ts`, `proxy_datacenter.ts`, `proxy_static.ts`, `proxy_dedicated.ts`
- Supporting: `src/utils/credentials.ts`, `src/tools/proxy_account_list.ts`, `src/tools/plan_balance_all.ts`

---

## Summary

| Check | Status |
|---|---|
| Balance endpoint URLs (residential, ISP, DC, mobile) | PASS |
| Balance endpoint — static/dedicated | ISSUE (see §6) |
| proxy_account/list required fields (product, page, limit) | PASS |
| proxy_account/list product codes (1=res, 2=ISP, 3=DC, 9=mob) | PASS |
| Username zone format — residential | DIVERGENCE (see §2) |
| Username zone format — mobile | DIVERGENCE (see §2) |
| Username zone format — ISP (country targeting dropped) | NOTE (see §2) |
| Username zone format — datacenter | DIVERGENCE (see §2) |
| Static/Dedicated proxy architecture | ARCHITECTURE GAP (see §3) |
| fetchProxySubAccountCredentials — product code hardcoded to "1" | NOTE (see §5) |

Overall: 4 items need attention. No outright spec violations on the management API paths.

---

## 1. Endpoint URLs (Balance + Management)

### Balance endpoints in `plan_balance_all.ts`

| Product | Our endpoint | Spec endpoint |
|---|---|---|
| residential | `/v1/residential_flow/balance` | `/v1/residential_flow/balance` (06-residential.md) |
| isp | `/v1/isp_flow/balance` | `/v1/isp_flow/balance` (08-rotating-isp.md) |
| mobile | `/v1/mobile_flow/balance` | `/v1/mobile_flow/mobile_flow_balance` (07-mobile.md) |
| datacenter | `/v1/dc_flow/balance` | `/v1/dc_flow/balance` (09-rotating-dc.md) |
| static | `/v1/static_flow/balance` | **Not present in 10-static-isp.md** |
| capture | `/v1/capture/get_balance` | Outside proxy scope — not checked here |

**BUG — mobile balance URL mismatch.**
Our code calls `/v1/mobile_flow/balance` but the spec defines `/v1/mobile_flow/mobile_flow_balance`. This will 404.

**UNKNOWN — static balance URL.**
The spec page for Static ISP (10-static-isp.md) lists only `open`, `list`, `export`, `region`, `renew`, `renew_setting` — no balance endpoint. The URL `/v1/static_flow/balance` we call has no spec backing. Needs clarification from Novada.

### Consume-log endpoints (for `novada_traffic_daily`)

| Product | Spec endpoint |
|---|---|
| residential | `/v1/residential_flow/consume_log` |
| isp | `/v1/isp_flow/consume_log` |
| mobile | `/v1/mobile_flow/mobile_flow_use` (requires `start_time`, `end_time`, `day_or_hour`) |
| datacenter | `/v1/dc_flow/consume_log` |

Mobile consume-log also has a different path and an extra required field (`day_or_hour`). If `novada_traffic_daily` calls `/v1/mobile_flow/consume_log` it will fail. (This tool was not in scope for this review but flagged for completeness.)

### proxy_account/list management URL

Our code calls `https://api-m.novada.com/v1/proxy_account/list`. The spec doc does not cover this path directly (it lives in the proxy-user-management section, not the per-product pages). The call structure matches what was verified against the live API per the comment in `proxy_account_list.ts`.

---

## 2. Username / Zone Format

The spec pages (06–09) do not publish the proxy username format — they only cover the management/balance REST APIs. The zone-string format (`user-zone-{type}-region-{cc}-city-{city}-session-{id}`) is an undocumented convention that must be confirmed against the dashboard's Endpoint Generator.

What our code produces:

| Tool | Zone string built |
|---|---|
| residential | `{user}-zone-res-region-{cc}-city-{city}-session-{id}` |
| mobile | `{user}-zone-mob-region-{cc}-carrier-{carrier}-session-{id}` |
| isp | `{user}-zone-isp-session-{id}` (country param accepted but silently dropped) |
| datacenter | `{user}-zone-dcp-region-{cc}-session-{id}` |

**ISP country targeting silently dropped.** `proxy_isp.ts` accepts a `country` param in the schema but `buildIspUsername()` does not include it. The output message warns the user, but the param is accepted without error — this is intentional per comment in the file. If the `zone-isp` pool does support country targeting via `region-{cc}`, we are not using it.

**Zone names cannot be verified against these spec docs.** The docs only cover REST endpoints, not proxy endpoint configuration. Risk: if Novada changes zone names (`zone-res` → `residential`, etc.) we break silently. Recommendation: add an integration test that validates at least one credential against the actual proxy endpoint.

---

## 3. Static ISP and Dedicated Datacenter Architecture

Both `proxy_static.ts` and `proxy_dedicated.ts` explicitly document that they do **not** use zone-based routing. Instead they expect pre-purchased per-IP credentials in `NOVADA_STATIC_PROXY_LIST` / `NOVADA_DEDICATED_PROXY_LIST` (format: `IP:PORT:USER:PASS` per line).

This matches the spec model: Static ISP (10) and Dedicated DC (11) are IP-leasing products — `POST /v1/static_house/list` returns individual IPs each with their own credentials, not a single rotating pool endpoint. The current implementation correctly defers to per-IP credentials and returns an actionable `configuration_required` response when the env var is absent.

**No compliance bug here.** The architecture is correct. The `NOVADA_STATIC_PROXY_LIST` / `NOVADA_DEDICATED_PROXY_LIST` env vars are a reasonable bridge. Long-term, these tools could be wired to call `/v1/static_house/list` and `/v1/static/list` directly using the API key to fetch live IP lists automatically.

---

## 4. proxy_account/list — Required Fields

Spec (from proxy-user-management docs, also reflected in `proxy_account_list.ts` comments):

```
Required: product, page, limit
Optional: status, account
```

Our implementation sends exactly `product`, `page`, `limit` as required, plus optional `status` and `account` when provided. **PASS.**

Product code mapping:

| Code | Product |
|---|---|
| "1" | Residential |
| "2" | Rotating ISP |
| "3" | Rotating Datacenter |
| "4" | Unlimited |
| "7" | Unblocker |
| "9" | Mobile |

These match the documented enum values. **PASS.**

---

## 5. Auto-provision in credentials.ts

`fetchProxySubAccountCredentials()` in `credentials.ts` hardcodes `product: "1"` (Residential). This means auto-provisioned credentials always come from the Residential sub-account pool regardless of which proxy type tool is called (mobile, ISP, etc.).

This is a **logic concern, not a spec bug** — the API call itself is correctly formed. But if a user has a Mobile plan but no Residential plan, auto-provision will fail to find credentials even though valid sub-accounts exist under product "9". The fix would be to try multiple product codes in priority order, or accept a `product` hint parameter.

---

## 6. Issues Requiring Action

### HIGH — mobile balance URL
- **File:** `src/tools/plan_balance_all.ts` line 11
- **Current:** `"/v1/mobile_flow/balance"`
- **Spec:** `"/v1/mobile_flow/mobile_flow_balance"` (07-mobile.md)
- **Impact:** `novada_plan_balance_all` with `products: ["mobile"]` will always fail with 404.

### MEDIUM — static balance URL unverified
- **File:** `src/tools/plan_balance_all.ts` line 13
- **Current:** `"/v1/static_flow/balance"`
- **Spec:** No balance endpoint exists in 10-static-isp.md
- **Impact:** Unknown — may 404. Needs Novada confirmation of the correct endpoint.

### LOW — ISP country targeting silently dropped
- **File:** `src/tools/proxy_isp.ts` `buildIspUsername()` (line 31–37)
- **Current:** `country` param accepted by schema, not included in zone string
- **Spec:** Not specified (zone format undocumented)
- **Impact:** User passes `country` to `novada_proxy_isp`, gets no error, but targeting has no effect.

### INFO — auto-provision hardcoded to product "1"
- **File:** `src/utils/credentials.ts` line 89
- **Current:** `form.append("product", "1")` always
- **Impact:** Auto-provision fails for users with Mobile/ISP plans but no Residential plan.
