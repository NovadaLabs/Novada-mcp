# Agent Brief: Functional Tester — Advanced Tools (Agent D)

## Role
QA engineer specializing in infrastructure and edge cases. You test the advanced/infrastructure tools and document exact failure modes.

## Project
novada-search v0.8.3 — MCP server for web intelligence.
Location: ~/Projects/novada-mcp/
Build: ~/Projects/novada-mcp/build/ (already compiled)

## API Key
NOVADA_API_KEY=1f35b477c9e1802778ec64aee2a6adfa

## Tools to Test
- novada_health (no key needed for some checks)
- novada_scrape (async flow — submit → poll → result)
- novada_proxy (credentials check)
- novada_verify (expect 402)
- novada_unblock (needs NOVADA_WEB_UNBLOCKER_KEY)

## How to Run Tests
Use node directly against built JS:

```bash
cat > /tmp/test-adv.mjs << 'EOF'
import { novadaHealth } from '/Users/tongwu/Projects/novada-mcp/build/tools/health.js';
const result = await novadaHealth({}, "1f35b477c9e1802778ec64aee2a6adfa");
console.log(result);
EOF
node /tmp/test-adv.mjs
```

## Test Cases to Run

### novada_health
1. Full health check: `{}` with real API key
2. No API key: `{}` with empty string — how does it fail?
3. Read the output carefully — what does each probe report?
4. Check the actual health check URLs in src/tools/health.ts against what's really running

### novada_scrape (IMPORTANT — async flow)
The scrape API is async:
- POST scraper.novada.com/request → returns task_id
- Poll GET api.novada.com/g/api/proxy/scraper_download?task_id=...&file_type=json&apikey=...
- code:27202 = pending, array = done

Test cases:
1. google_search: `{ platform: "google.com", operation: "google_search", params: { q: "proxy services", num: 3, json: "1" }, format: "markdown", limit: 5 }`
   - Note: Tasks may fail with 500 (known backend issue since 2026-04-27)
   - Document exact error shape returned to user
2. amazon — expect 11006: `{ platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "laptop" }, format: "markdown", limit: 5 }`
3. Unknown platform: `{ platform: "fakebook.com", operation: "anything", params: {}, format: "markdown", limit: 5 }`
4. Timeout simulation: What happens after 90s if task never completes? (read code, don't wait 90s)

### novada_proxy
1. Read src/tools/proxy.ts first — what does it actually do?
2. Call with just API key: `{}` — what credentials does it derive?
3. Check if NOVADA_PROXY_USER env var affects output
4. Does it validate the proxy endpoint is reachable?

### novada_verify
1. Basic URL verify: `{ url: "https://example.com" }`
2. Document the 402 error shape — is it actionable for agents?
3. Read src/tools/verify.ts — is the error message clear about what to do?

### novada_unblock  
1. Read src/tools/unblock.ts — what's the logic?
2. Attempt static unblock (might work without Unblocker key): `{ url: "https://example.com" }`
3. Cloudflare test: `{ url: "https://www.cloudflare.com" }`
4. What happens when NOVADA_WEB_UNBLOCKER_KEY is missing?

### novada_browser
1. Read src/tools/browser.ts — what does it do without NOVADA_BROWSER_WS?
2. What's the error message when WS endpoint is missing?

## For Each Test, Record

```
Tool: novada_scrape
Test: google_search for "proxy services"
Input: { platform: "google.com", ... }
Status: PASS / FAIL / ERROR / BACKEND_ERROR
Duration: Xms (include poll wait time)
Output (first 300 chars): ...
Error (if any): exact error message shown to user
Issues: ...
```

## Consistency Checks
After testing all tools:
1. Are error messages consistent in format across all tools?
2. Do all tools that need NOVADA_API_KEY give a clear error when it's missing?
3. Is the output format (markdown sections, headers) consistent?
4. Do all tools return structured output that an LLM can parse?

## Output Format
Write to: docs/review/2026-04-29/report-functional-advanced.md

```
# Functional Test Report — Advanced Tools (Agent D)

## Test Environment
- Date: 2026-04-29
- API Key: 1f35b477...adfa  
- Known env: NOVADA_BROWSER_WS not set, NOVADA_WEB_UNBLOCKER_KEY not set

## Results Summary
| Tool | Tests | Pass | Fail | Backend Error | Notes |
|---|---|---|---|---|---|

## Detailed Results
[per tool section]

## Cross-Tool Consistency Issues
[issues that span multiple tools]

## Backend Issues (not fixable client-side)
[document for Novada team]
```
