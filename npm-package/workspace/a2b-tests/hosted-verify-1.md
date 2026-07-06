# INC-189 to INC-193 Hosted MCP Verification

**Date:** 2026-06-25
**Endpoint:** mcp.novada.com (hosted MCP tools via session)
**Local build:** novada-mcp v0.8.3
**Hosted vendor:** novada-mcp v0.8.3 (vercel/vendor/novada-mcp)
**Vendor parity:** `diff` confirms scrape.js IDENTICAL between local build and hosted vendor

---

## Results Summary

| INC   | Issue                          | Hosted | Local | Verdict           |
|-------|--------------------------------|--------|-------|-------------------|
| INC-189 | proxy_account_list passwords | PASS   | PASS  | FIXED             |
| INC-190 | scrape code 10000            | FAIL*  | PASS  | CODE FIXED, infra issue |
| INC-191 | traffic_daily 10001          | PASS   | PASS  | FIXED             |
| INC-192 | ai_monitor returns data      | PASS   | PASS  | FIXED             |
| INC-193 | wallet_usage_record empty    | PASS   | PASS  | FIXED             |

---

## Detailed Results

### INC-189: proxy_account_list password masking -- PASS

**Hosted MCP:** Password field returned as `"password": "****"` (masked).
**Local build:** Same -- `"password": "****"`.
**Vendor code confirms:** `proxy_account_list.js:68` has `rec.password = "****"` with
comment `// INC-189 (Security): Mask plaintext passwords in API response.`
**Verdict:** Fix deployed and working on hosted endpoint.

### INC-190: scrape code 10000 handling -- FAIL (infra, not code)

**Hosted MCP:** Error thrown: `Scraper task completed but collected no valid data (code 10000)`.
Tested twice with different keywords (`laptop`, `iphone case`) -- both failed.
**Local build:** PASS -- returned 9195 chars of Amazon product data in 41762ms.
**Key finding:** `diff` confirms `scrape.js` is **byte-identical** between local build and hosted vendor.
The code fix IS deployed (line 130-132: `if (errCode === 10000) { await sleep(...); continue; }`).
The error message "no valid data" does NOT exist in our codebase -- it originates from the
hosted MCP service wrapper layer (Vercel/worker adapter), not from the novada-mcp tool code.
**Root cause:** The hosted endpoint's scraper infrastructure is returning empty results for
Amazon queries (possibly IP/geo restrictions on the Vercel edge), while the local machine's
scraper API calls succeed. This is a server-side scraper infrastructure issue, not a code bug.
**Verdict:** Code fix is deployed. Failure is due to hosted infra returning empty scraper results.

### INC-191: traffic_daily 10001 error -- PASS

**Hosted MCP:** Returned valid response with `status: "partial"` (static product not provisioned
on test account, which is expected). No 10001 error. Residential/ISP/mobile/datacenter all
returned `status: "ok"` with traffic data.
**Local build:** Same behavior -- 2090 chars, no 10001 error.
**Verdict:** Fix deployed and working. Date parameters handled correctly.

### INC-192: ai_monitor returns data -- PASS

**Hosted MCP:** Returned 732 chars of structured response. Brand "novada" has 0 mentions across
ChatGPT/Perplexity/Grok (expected for a niche brand). Response includes proper structure:
models_checked, mentions_found, sentiment breakdown, agent hints, chainable output.
**Local build:** Same -- 732 chars.
**Verdict:** Fix deployed and working. Tool returns structured data even when no mentions found.

### INC-193: wallet_usage_record pagination -- PASS

**Hosted MCP:** Returned `status: "ok"` with `count: 12` and `list` containing 10 records
(page_size=10, page=1). Records include order types: capture, residential_flow, dc_flow,
isp_flow, browser_flow, scraper. Each record has full detail (money, description, dates).
**Local build:** Same -- 12263 chars with matching data.
**Verdict:** Fix deployed and working. Count matches list, pagination works correctly.

---

## Action Items

1. **INC-190 needs investigation** at the hosted infra level. The novada-mcp code is correct
   and deployed, but the hosted MCP server's scraper API calls consistently return empty results
   while the same API key works locally. Possible causes:
   - Vercel edge function IP range blocked by Amazon scraper targets
   - The hosted MCP wrapper layer catches and re-wraps the poll timeout with its own error message
   - Scraper API rate limiting on the server IP vs local IP

2. The error message `Scraper task completed but collected no valid data (code 10000)` is NOT
   from our codebase. Locate where this string is generated in the hosted MCP wrapper layer.
