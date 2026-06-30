# API Compliance Fixes — Status

Date: 2026-06-23
Status: ALL DONE — tsc --noEmit exits 0

## Fix 1 — Mobile balance URL
File: src/tools/plan_balance_all.ts
Change: `/v1/mobile_flow/balance` → `/v1/mobile_flow/mobile_flow_balance`
Status: DONE

## Fix 2 — Mobile traffic URL + day_or_hour field
File: src/tools/traffic_daily.ts
Changes:
  - `/v1/mobile_flow/consume_log` → `/v1/mobile_flow/mobile_flow_use`
  - Added `day_or_hour: "2"` to mobile endpoint body (per-product override in devApiParallel map)
Status: DONE

## Fix 3 — wallet_usage_record page_size → limit in API body
File: src/tools/wallet_usage_record.ts
Change: body field `page_size` renamed to `limit` when sending to API (Zod param name preserved as `page_size`)
Status: DONE

## Fix 4 — Bing cache write before empty-result return
File: src/tools/search.ts
Change: Empty-result return path now writes to `_searchCache` before returning, same as non-empty paths.
This prevents re-polling the API for queries that returned 0 results.
Status: DONE

## Fix 5 — capture_apikey.ts domain text
File: src/tools/capture_apikey.ts
Change: `scraperapi.novada.com` → `scraper.novada.com`
Status: DONE

## Fix 6 — Register novada_ip_whitelist in src/index.ts
Changes in src/index.ts:
  - Import: `novadaIpWhitelist`, `validateIpWhitelistParams`, `IpWhitelistParamsSchema` added to import block
  - TOOLS array: new descriptor with description per brief
  - KR6_TOOLS set: `"novada_ip_whitelist"` added (bypasses NOVADA_API_KEY gate when developer key present)
  - CATEGORY_MAP account bundle: `"novada_ip_whitelist"` appended
  - switch/case: `case "novada_ip_whitelist"` handler added
  - CLI `--help` text: entry added
  - Default error unknown-tool string: `novada_ip_whitelist` appended
Status: DONE

## TypeScript Check
Command: npx tsc --noEmit 2>&1 | head -20
Result: exit 0, no errors
