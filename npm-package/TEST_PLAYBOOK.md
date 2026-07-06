# novada-mcp Professional Testing Playbook

You are a professional MCP quality auditor. Your job is to evaluate novada-mcp as if you were
commissioned by an enterprise customer deciding between Novada, Bright Data, Firecrawl, and
Oxylabs. Be objective. Find real failures. Score each dimension honestly.

Work directory: ~/Projects/novada-mcp/

---

## Before You Start

Read these files to understand what the MCP does:
- `src/tools/index.ts` — all exported tools
- `src/resources/index.ts` — the guide document agents see
- `src/sdk/index.ts` — SDK interface
- `package.json` — version, dependencies
- `BACKEND_ISSUES.md` — known backend blockers (do not re-report these)

Then run:
```bash
npm run build
npm test
```

Confirm build is clean and all tests pass before proceeding.

---

## Test Suite

Run all 8 rounds. For each finding, classify as:
- **FAIL** — wrong behavior, data loss, silent error, crash
- **WARN** — suboptimal behavior, misleading output, missing signal
- **PASS** — correct behavior
- **SKIP** — cannot test without live credentials (note why)

---

### Round 1: Schema & Contract Validation

**Goal:** Verify every tool's output matches what it promises in the resource guide and type definitions.

**Steps:**

1. Read `src/tools/types.ts` — note every tool's input schema and required fields.

2. Read `src/resources/index.ts` — note every claim made in the Agent Guide (tool descriptions, parameter descriptions, output format examples).

3. For each of the 10 tools, check:
   - Does the Zod schema (if any) match the TypeScript types?
   - Does the resource guide description match what the code actually does?
   - Are all parameters documented? Any undocumented parameters in code?
   - Are default values in the code consistent with what the guide says?

4. Check `src/sdk/types.ts` vs `src/sdk/index.ts`:
   - Does each SDK method's return type match what it actually parses?
   - Can the parse logic ever produce data that doesn't satisfy the declared type?

5. Check `src/tools/extract.ts` output format:
   - Read the code and identify every field in the output string (title, description, mode, chars, etc.)
   - Are any fields emitted conditionally? Could an agent's parser fail if a field is missing?

**Report:** List every mismatch between documented behavior and actual code behavior.

---

### Round 2: Logic Correctness — Escalation Chain

**Goal:** Trace the complete auto-escalation path and find where it can go wrong.

**Steps:**

1. Read `src/utils/router.ts` fully — understand `routeFetch()` and `getModeCost()`.

2. Read `src/tools/extract.ts` fully — trace the `render='auto'` execution path from entry to output.

3. Manually trace these scenarios through the code (no execution needed — code reading):

   **Scenario A:** `render='auto'`, static fetch succeeds, content is rich HTML
   - Expected: mode=static, no escalation
   - Trace: which branches execute? Any unexpected side effects?

   **Scenario B:** `render='auto'`, static fetch returns Cloudflare challenge page
   - Expected: escalate to render, mode=render
   - Trace: does `detectBotChallenge()` fire on static result? Does escalation happen?

   **Scenario C:** `render='render'` explicitly, web unblocker returns error code != 0
   - Expected: throw, caller gets render-failed
   - Trace: does `fetchWithRender` throw correctly? Does the catch in `extractSingle` set mode=render-failed?

   **Scenario D:** `render='auto'`, static fails with bot challenge, render also returns bot challenge
   - Expected: mode=render-failed, agent hint says "try browser"
   - Trace: does `detectBotChallenge()` run on the render result? Is the correct hint emitted?

   **Scenario E:** `render='browser'` explicitly, but `NOVADA_BROWSER_WS` is not set
   - Expected: clean error message telling the user what to configure
   - Trace: where is this checked? Is the error message helpful?

4. Check the domain registry (`src/utils/domains.ts`):
   - How many domains are registered?
   - When a registered domain is requested with `render='auto'`, does the registry override actually fire?
   - Can a domain registry entry cause unexpected behavior on a subdomain of a registered domain?

**Report:** For each scenario: PASS/FAIL/WARN + the exact code path + line numbers where any issue occurs.

---

### Round 3: Data Quality — HTML Extraction

**Goal:** Verify that `extractMainContent` and related utilities return useful content, not garbage.

**Steps:**

1. Read `src/utils/html.ts` fully — understand `extractMainContent`, `extractLinks`, `extractTitle`, `extractDescription`, `extractStructuredData`.

2. Write and run test cases (using Node.js or vitest) for these HTML inputs:

   **Test 3.1 — Boilerplate bleed:** Does nav/footer content bleed into extracted text?
   ```html
   <html><body>
     <nav>Home | About | Contact | Login | Register | Privacy | Terms</nav>
     <main><article><h1>Real Article</h1><p>Real content here with lots of words to exceed threshold. Real content here with lots of words to exceed threshold. Real content here.</p></article></main>
     <footer>Copyright 2024 | Privacy Policy | Cookie Settings | Accessibility</footer>
   </body></html>
   ```
   Expected: extracted text should NOT contain "Privacy Policy", "Cookie Settings", "Login", "Register"

   **Test 3.2 — Table preservation:** Are HTML tables preserved in extracted content?
   ```html
   <html><body><main>
     <table><tr><th>Plan</th><th>Price</th><th>Requests</th></tr>
     <tr><td>Starter</td><td>$49</td><td>10,000</td></tr>
     <tr><td>Pro</td><td>$199</td><td>100,000</td></tr></table>
   </main></body></html>
   ```
   Expected: pricing data must appear in extracted text. Format doesn't matter but values must be present.

   **Test 3.3 — Relative link normalization:** Does `extractLinks` return absolute URLs?
   ```html
   <html><body>
     <a href="/about">About</a>
     <a href="./blog/post-1">Post</a>
     <a href="https://external.com">External</a>
     <a href="mailto:hi@example.com">Email</a>
     <a href="javascript:void(0)">JS Link</a>
   </body></html>
   ```
   Call `extractLinks(html, 'https://example.com')`.
   Expected: `/about` → `https://example.com/about`, `./blog/post-1` → absolute URL, `mailto:` and `javascript:` should NOT be in results.

   **Test 3.4 — Structured data extraction:** Does schema.org JSON-LD get extracted?
   ```html
   <html><head>
     <script type="application/ld+json">
     {"@type":"Product","name":"Widget Pro","offers":{"price":"29.99","priceCurrency":"USD"}}
     </script>
   </head><body><p>Product page</p></body></html>
   ```
   Expected: `extractStructuredData` returns the parsed object with price data.

   **Test 3.5 — Empty/minimal page:** What happens on a near-empty page?
   ```html
   <html><head><title>Loading...</title></head><body><div id="app"></div></body></html>
   ```
   Expected: `detectJsHeavyContent` returns true, extraction returns minimal content.

   **Test 3.6 — Long page truncation signal:** When content exceeds limit, is the truncation flagged?
   Create a 30,000+ character HTML page. Call `extractMainContent(html, url, 3000)`.
   Expected: the returned text is ≤3000 chars AND somewhere in the extract.ts output there is a signal that truncation occurred (check the `isTruncated` logic).

3. For each test: write the assertion, run it, report PASS/FAIL.

**Report:** List which tests pass/fail. For failures, include the actual vs expected output.

---

### Round 4: Circuit Breaker & Credentials — State Machine Audit

**Goal:** Verify the per-endpoint circuit breaker and AsyncLocalStorage credentials are correct.

**Steps:**

1. Read `src/utils/http.ts` — focus on `fetchViaProxy` and the `proxyCircuits` Map.

2. Answer these questions by reading the code:

   **Q4.1:** If two different proxy endpoints are configured concurrently (via withCredentials), do they get separate circuit entries in `proxyCircuits`? Trace the key used: is it `proxyEndpoint` or something else?

   **Q4.2:** If `proxyEndpoint` is undefined (no proxy configured), which branch executes? Does it fall through to direct fetch without touching `proxyCircuits`?

   **Q4.3:** The TTL reset condition is: `Date.now() - state.disabledAt > PROXY_CIRCUIT_RESET_MS`. Is `PROXY_CIRCUIT_RESET_MS` exported or accessible for testing? Can the TTL be verified in a test without mocking `Date.now()`?

   **Q4.4:** In the "unknown state" race: both proxy and direct are launched with `Promise.all`. If the proxy succeeds (sets `state.available = true`) but the direct also resolves first, which result is returned? Is there a TOCTOU window?

   **Q4.5:** In `withCredentials`, if the callback `fn` throws synchronously, does `AsyncLocalStorage.run()` still clean up the store context? (Read Node.js docs behavior — answer based on knowledge.)

3. Read `src/sdk/index.ts` — focus on the `batchExtract` method.

   **Q4.6:** `batchExtract` calls `this.extract()` in parallel. Each `this.extract()` internally calls `withCredentials(this.toolCreds, ...)`. Are the parallel `withCredentials` scopes isolated, or do they share the same store context?

   **Q4.7:** If `batchExtract` is called with 11 URLs, what happens? (Check the `.slice(0, 10)` fix.)

4. Write and run a test for concurrent credential isolation:
   - Create two `NovadaClient` instances with different `webUnblockerKey` values
   - Call `batchExtract` on both simultaneously (Promise.all)
   - Mock `getWebUnblockerKey` to record which key was used for each request
   - Assert: client A's requests only used key-A, client B's requests only used key-B

**Report:** Answer each Q with PASS/FAIL/WARN + line number evidence.

---

### Round 5: Search Tool — Result Quality

**Goal:** Verify that `novada_search` output is actually useful for downstream agents.

**Steps:**

1. Read `src/tools/search.ts` fully.

2. Read `src/utils/rerank.ts` — understand the scoring algorithm.

3. Answer by code reading:

   **Q5.1:** The reranker uses term frequency in title/snippet to score results. Does it normalize for document length? (A 500-word snippet containing a term once should score lower than a 10-word snippet containing the same term.)

   **Q5.2:** What happens when `query` contains special regex characters like `c++` or `node.js`? Trace through `rerankResults` — is the query split and used in a regex? If so, is it escaped?

   **Q5.3:** The search tool formats output as numbered markdown blocks. Does it handle the case where `organic_results` is an empty array? Does it return a helpful message or an empty/malformed markdown block?

   **Q5.4:** Are knowledge panel results (if returned by the SERP API) surfaced in the output? Read the code — is there any handling for `knowledge_panel`, `answer_box`, or `featured_snippet` fields?

4. Run the existing rerank tests and check if Q5.2 is covered:
   ```bash
   npx vitest run tests/utils/rerank.test.ts --reporter=verbose
   ```
   Is there a test with special characters in the query? If not, write one.

**Report:** Answer each Q + test result.

---

### Round 6: Error Quality — "Does the error help the agent?"

**Goal:** Every error message should tell an AI agent exactly what to do next. Test all error paths.

**Steps:**

1. For each error condition below, find the exact code location, read the error message, and grade it:
   - **Grade A:** Tells the agent what happened AND what to do next (tool name, parameter to change, etc.)
   - **Grade B:** Tells the agent what happened but not what to do
   - **Grade C:** Generic error (HTTP 429, connection refused) with no context
   - **Grade F:** Misleading, wrong, or swallowed (no error surfaced)

   | Error Condition | File to check | Expected Grade |
   |----------------|---------------|----------------|
   | NOVADA_API_KEY not set | `src/index.ts` or tool entry | A |
   | Invalid API key (401) from scraper | `src/tools/scrape.ts:89-97` | A |
   | URL is malformed | `src/tools/extract.ts` | A |
   | Browser WS not configured but `render='browser'` requested | `src/utils/browser.ts` | A |
   | Proxy auth failure (407) | `src/utils/http.ts` | A |
   | All escalation paths exhausted (render-failed) | `src/tools/extract.ts` | A |
   | `novada_scrape` unknown platform | `src/tools/scrape.ts:107` | A |
   | Research with no search results found | `src/tools/research.ts` | B |
   | Network timeout | `src/utils/http.ts` | B |

2. For any error graded C or F: read the actual error message in the code, note file:line, suggest improvement.

3. Check the `## Agent Hints` section in `src/tools/extract.ts`:
   - In `render-failed` mode: does the hint correctly say NOT to retry with render?
   - In `browser` mode: does the hint mention cost ($3/GB)?
   - When content is truncated: does the hint tell the agent how to get more (e.g., chunked extraction)?

**Report:** Full error quality table with actual grades and line numbers.

---

### Round 7: Security Surface

**Goal:** Find any security vulnerabilities — especially those relevant to MCP deployments.

**Steps:**

1. **Credential leakage in error messages:**
   Read every `throw new Error(...)` and `return \`...\`` in:
   - `src/utils/http.ts`
   - `src/tools/proxy.ts`
   - `src/index.ts`
   
   Do any error messages include the proxy password, API key, or WebSocket URL verbatim?

2. **SSRF / internal network access:**
   In `src/tools/extract.ts` and `src/utils/http.ts` — is there any validation that the target URL is a public internet address?
   Check: can you pass `url=http://localhost:8080/admin`, `url=http://192.168.1.1`, `url=http://169.254.169.254/latest/meta-data/`?
   (Do NOT actually fetch these — just check if there's a blocklist or validation.)

3. **URL injection:**
   In `src/tools/search.ts` — is the `query` parameter sanitized before being sent to the SERP API? Could a crafted query inject additional API parameters?
   In `src/tools/extract.ts` — is the URL validated before being passed to axios? Could HTTP header injection occur via newline characters in the URL?

4. **Oversized response handling:**
   In `src/utils/html.ts` — `extractMainContent` takes a `maxLength` param. Is there also a cap on the raw HTML size before parsing? What happens if a 100MB HTML page is fetched?
   Check: is there a `maxContentLength` or `maxBodyLength` set in any axios config?

5. **Dependency audit:**
   Run: `npm audit 2>&1`
   Report any HIGH or CRITICAL vulnerabilities.

6. **Multi-tenant isolation:**
   Confirm the Bug 2 fix is complete: in `fetchViaProxy`, is circuit state keyed by endpoint so that two different proxy endpoints cannot interfere? Read `src/utils/http.ts:52-70`.

**Report:** For each issue found: file:line, severity (critical/medium/low), description, suggested fix.

---

### Round 8: Competitive Parity — Feature Gap Analysis

**Goal:** Compare novada-mcp's capabilities against Bright Data MCP (65 tools) and Firecrawl MCP.

**Steps:**

1. Read `src/resources/index.ts` — the complete tool guide. Note every capability.

2. Against this known Bright Data MCP feature list, check whether novada-mcp has an equivalent:

   | Bright Data Feature | novada-mcp equivalent? | Gap? |
   |--------------------|-----------------------|------|
   | 38 site-specific dataset scrapers (Amazon, LinkedIn, etc.) | `novada_scrape` with 129 platforms | BETTER |
   | Browser navigate + click + type + screenshot | `novada_browser` tool | CHECK |
   | Session management (persistent browser sessions) | ? | CHECK |
   | Proxy rotation with country/city targeting | `novada_proxy` tool | CHECK |
   | Structured output formats (JSON/CSV/Excel) | `novada_scrape` formats | CHECK |
   | Web search (SERP) | `novada_search` | CHECK — but B1 blocker |
   | Batch URL extraction | `batchExtract` in SDK, `novada_extract` multi-url | CHECK |
   | Screenshot-only mode | `novada_browser` screenshot action | CHECK |
   | PDF extraction | ? | CHECK |
   | CAPTCHA solving | built into unblocker? | CHECK |
   | Geolocation spoofing | proxy country param | CHECK |
   | Residential proxy network | `novada_proxy` | CHECK |

3. Against Firecrawl MCP:

   | Firecrawl Feature | novada-mcp equivalent? | Gap? |
   |------------------|-----------------------|------|
   | `/scrape` with LLM extraction | `novada_extract` with `query` param | CHECK |
   | `/crawl` with path filters | `novada_crawl` with select/exclude_paths | CHECK |
   | `/map` sitemap discovery | `novada_map` | CHECK |
   | `/search` web search | `novada_search` | CHECK |
   | Webhook callbacks for async crawl | ? | CHECK |
   | Rate limit info in response | ? | CHECK |
   | `actions` (click, scroll, fill form) | `novada_browser` | CHECK |

4. Check `src/tools/browser.ts` — what actions does `novada_browser` support? List them. Are `fill`, `click`, `scroll`, `waitForSelector` implemented?

5. What unique capabilities does novada-mcp have that competitors lack?
   - Check: does any competitor have a `novada_verify` (claim verification) tool?
   - Check: does any competitor have a `novada_research` (multi-step research synthesis) tool?
   - Check: does any competitor have smart auto-escalation routing (static→render→browser)?

**Report:** Full parity matrix with gaps highlighted. Unique advantages listed.

---

## Scoring Rubric

After completing all 8 rounds, assign a score 1-10 for each dimension:

| Dimension | Score (1-10) | Notes |
|-----------|-------------|-------|
| Schema & Contract accuracy | | |
| Escalation chain correctness | | |
| Data extraction quality | | |
| Reliability & state management | | |
| Search result quality | | |
| Error message quality | | |
| Security posture | | |
| Competitive feature parity | | |
| **Overall** | | |

Score guide: 9-10 = production-grade, 7-8 = solid with minor gaps, 5-6 = functional but rough edges, 3-4 = significant issues, 1-2 = not ready.

---

## Final Output Format

```
## novada-mcp Audit Report — v0.8.1
Date: [today]
Auditor: [agent]

### Summary
[3-sentence overall assessment]

### Critical Issues (must fix before publish)
- [issue]: [file:line] — [fix]

### Medium Issues (fix in next release)
- [issue]: [file:line] — [fix]

### Low / WARN Issues
- [issue]: [file:line] — [fix or accept]

### Scorecard
[table]

### Competitive Position
[paragraph]

### Recommended next actions (priority order)
1. ...
2. ...
3. ...
```

For any FAIL findings: also write the fix directly into the source file, then re-run `npm test` to confirm nothing broke.
