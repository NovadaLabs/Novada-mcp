# Agent-8: Error Handling Agent Feedback
role: defensive / error-testing agent
task: test error handling and recovery guidance
tools_used: [novada_extract, novada_map, novada_browser_flow]

---

## Error Scenario Results

### Scenario 1: novada_extract on non-existent domain
- **URL:** `https://this-domain-definitely-does-not-exist-xyz123.com`
- **Tool:** `novada_extract` (render=auto)
- **Error code:** none (no structured error code returned)
- **Error message:** `Error: getaddrinfo ENOTFOUND this-domain-definitely-does-not-exist-xyz123.com`
- **agent_instruction:** Embedded as bullet list under `## Agent Hints`:
  - "If the URL returns JSON or binary data, it cannot be extracted as HTML."
  - "If the URL is unreachable, check the domain and try novada_map first."
  - "For JS-heavy pages returning empty content, try with render='render'."
- **What it implied:** Check the domain spelling; try novada_map; consider render mode.
- **Was it correct?** Partially. The first two hints are sensible. The third hint ("render='render'") is irrelevant — a DNS-not-found error has nothing to do with JS rendering. The generic hint set is not filtered for error type.

---

### Scenario 2: novada_map on a PDF URL
- **URL:** `https://www.w3.org/WAI/WCAG21/wcag21.pdf`
- **Tool:** `novada_map`
- **Error code:** none
- **Error message:** Not a hard error — returned 0 URLs with warning: "Only the root URL found — likely a JavaScript SPA."
- **agent_instruction:** Under `## Agent Hints`:
  - Try `novada_extract` on the URL to get page content directly.
  - Use `novada_crawl` with render="render" for JS-rendered pages.
  - Use `novada_unblock` with method="render" for rendered HTML.
  - Use `novada_search` with `site:www.w3.org` for indexed subpages.
  - `## Agent Notice — Under-delivery`: explains requested=50, returned=0, reason: "JavaScript SPA", next_steps: crawl with render.
- **What it implied:** The tool misidentified a PDF as a JavaScript SPA. It suggested rendering tools for what is actually a binary document.
- **Was it correct?** No. The root cause is that the input is a PDF (binary), not a SPA. None of the suggested actions (crawl with render, novada_unblock render, etc.) will work on a PDF. The tool gave plausible-sounding but incorrect guidance.

---

### Scenario 3: novada_extract on cloudflare.com with render="static"
- **URL:** `https://www.cloudflare.com`
- **Tool:** `novada_extract` (render=static)
- **Outcome:** SUCCESS — no error. Returned 3,525 chars of clean markdown content with quality score 60.
- **agent_instruction:** Only a positive hint: "To discover more pages: novada_map with url=..."
- **Was it correct?** Yes, not an error scenario in practice. Cloudflare's own homepage served clean static HTML even without JS rendering. Bot protection did not trigger for this tool combination (residential proxy + static fetch). This is a non-finding: the "heavily bot-protected" test did not produce an error.

---

### Scenario 4: novada_browser_flow with an invalid action sequence
- **URL:** `https://example.com`
- **Actions:** click on `#this-element-does-not-exist-xyz999`, then type, then screenshot
- **Tool:** `novada_browser_flow`
- **Error code:** `authentication failure:10000`
- **Error message:** `Error: authentication failure:10000`
- **agent_instruction:** Under `## Agent Hints` / `agent_instruction`:
  1. Verify the URL is publicly accessible.
  2. Check that the Browser Flow product is activated at dashboard link.
  3. Fallback: use `novada_browser` (CDP) for higher reliability.
  4. Fallback: use `novada_proxy_residential` for IP geo-targeting.
- **What it implied:** This is an authentication/credential failure, not a bad selector error. The action sequence was never reached.
- **Was it correct?** Partially. The fallback suggestions (novada_browser) are actionable. However, the root cause here is an API key / product-not-activated problem, not the invalid selector. The error code `10000` is opaque and the error type label "authentication failure" does not tell me whether this means: wrong API key, product not enabled, or quota exceeded. The invalid action sequence was never tested because the credential gate blocked execution entirely.

---

## agent_instruction Quality

| Scenario | Rating | Notes |
|----------|--------|-------|
| S1: DNS not found | VAGUE | Generic hints; the render hint is irrelevant to a DNS failure |
| S2: PDF mapped as SPA | WRONG | Diagnosed as JS SPA, suggested JS render fixes — wrong root cause |
| S3: Cloudflare static | N/A (success) | No error occurred |
| S4: Auth failure 10000 | CLEAR (partially) | Good fallback options, but error code is opaque; URL accessibility hint is off-target |

---

## Retryable Flag

No `retryable` field was present in any of the four responses. None of the error outputs included a machine-readable `retryable: true/false` field. Retry guidance was embedded only in free-text hints, which means an agent cannot programmatically decide whether to retry vs. escalate vs. abort. This is a gap.

---

## What Worked Well

1. **Structured hint sections exist.** Every error response had an `## Agent Hints` block. The intent is correct — giving agents a next step rather than just an exception string.

2. **Fallback suggestions in browser_flow were actionable.** The hint to switch from `novada_browser_flow` to `novada_browser` (CDP) is specific and correct. An agent can immediately act on it.

3. **Under-delivery notice in novada_map is transparent.** The `requested: 50 | returned: 0 | shortfall: 50` notice is excellent — an agent knows it got nothing and why (as stated, even if the stated reason is wrong for PDFs).

4. **Cloudflare static extraction succeeded.** This demonstrates the residential proxy layer handles lightly-protected sites without requiring render escalation. Good for performance-sensitive agents.

---

## What Was Confusing or Missing

1. **No structured error code field.** Errors are returned as free-text markdown. An agent parsing the response has to regex-match `Error: getaddrinfo ENOTFOUND` or `authentication failure:10000` to know what happened. A structured `error_code` enum (e.g., `DNS_FAILURE`, `AUTH_FAILURE`, `BOT_DETECTED`, `BINARY_CONTENT`) would allow programmatic branching.

2. **PDF detection is absent.** `novada_map` on a `.pdf` URL produced a "JavaScript SPA" misdiagnosis. The tool should detect binary/PDF content type from the HTTP response and return a specific error: `BINARY_CONTENT_UNSUPPORTED — this URL serves a PDF, not an HTML page. Use a PDF extraction tool instead.`

3. **Generic hints not filtered by error type.** In Scenario 1, the render hint is meaningless for a DNS failure. Hints should be conditional on the error class. Sending an agent down the render retry path for a NXDOMAIN wastes credits and time.

4. **`retryable` flag is absent.** An agent needs to know: should I retry this with different params, or is this permanently unrecoverable? DNS failure = not retryable. Auth failure = not retryable without credential fix. Bot detection = retryable with render escalation. None of these distinctions are machine-readable.

5. **Auth error `10000` is opaque.** `authentication failure:10000` does not tell the agent whether this is a bad API key, a product-not-activated issue, an account suspension, or a regional restriction. Each requires a different recovery action. The error code alone is insufficient.

6. **No `ok: false` envelope at the top level.** The response is markdown prose, not a parseable JSON envelope. For error cases, an `ok: false` + `error: {...}` structure at the top would be far more reliable for agent decision trees than parsing markdown.

---

## Top 3 Improvements for Agent Experience

1. **Add a machine-readable error envelope with typed error codes.**
   Every failure response should include a structured block:
   ```
   error_code: DNS_FAILURE | AUTH_FAILURE | BOT_DETECTED | BINARY_CONTENT | TIMEOUT | RATE_LIMITED
   retryable: true | false
   retry_with: { tool: "novada_extract", params: { render: "render" } }  # optional
   ```
   This lets an agent branch without natural-language parsing.

2. **Implement binary/PDF content-type detection in novada_map and novada_extract.**
   Check the HTTP `Content-Type` header before attempting HTML parsing. If it is `application/pdf`, `application/octet-stream`, or similar, return `error_code: BINARY_CONTENT` with the message: "This URL serves a PDF/binary file, not an HTML page. HTML extraction is not applicable." This prevents the misleading SPA misdiagnosis entirely.

3. **Filter Agent Hints by error class, not by a generic template.**
   Hints for `DNS_FAILURE` should only suggest: verify domain spelling, check for typos, confirm URL is public. They should NOT suggest render escalation (which requires a reachable host). Hints for `AUTH_FAILURE` should link to the credential setup docs, not the URL accessibility checklist. Context-appropriate hints save agents from credit-burning retry loops on unrecoverable errors.

---

## Overall Score (error recovery friendliness): 5/10

**Rationale:** The tooling has the right instinct — every error produces some guidance rather than a bare exception. The fallback suggestions in browser_flow and the under-delivery notice in map are genuinely useful patterns. However, all guidance is free-text only, error codes are missing or opaque, the PDF misdiagnosis demonstrates a real classification gap, and the absence of a `retryable` flag means agents cannot make automated recovery decisions. The foundation is sound; it needs structured error types and content-aware hint filtering to reach 8+/10.
