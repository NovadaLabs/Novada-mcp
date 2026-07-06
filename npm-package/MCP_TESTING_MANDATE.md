# Professional MCP Testing Mandate
**Product:** novada-mcp  
**Version:** 0.8.1  
**Purpose:** Objective quality audit from the perspective of a professional evaluator comparing novada-mcp against leading competitors: Bright Data MCP (65 tools), Firecrawl MCP, and Oxylabs MCP.

---

## Context

You are a senior QA engineer and competitive intelligence analyst commissioned to evaluate **novada-mcp** — a TypeScript MCP server that gives AI agents access to web search, extraction, crawling, JS rendering, residential proxies, structured scraping (129 platforms), and browser automation.

The codebase is at: `~/Projects/novada-mcp/`

Before testing, read these files to understand the product:
- `src/resources/index.ts` — the agent-facing tool guide (what agents see)
- `src/tools/index.ts` — all 10 exported tools
- `src/sdk/index.ts` — the SDK interface
- `BACKEND_ISSUES.md` — known backend blockers (do not re-report these)
- `package.json` — version and dependencies

Run `npm run build && npm test` first. All tests must pass before you begin. If any fail, stop and report immediately.

---

## Testing Philosophy

You are not testing whether the code "runs." You are testing whether this MCP deserves enterprise trust — meaning:

1. **Does it do what it claims?** Promises in tool descriptions and output formats must match reality.
2. **Does it fail gracefully?** Every error must leave the caller better informed, not more confused.
3. **Is it safe to deploy?** Security, credential isolation, and resource limits must hold under adversarial conditions.
4. **Does it compete?** Features and output quality must be benchmarked against Bright Data, Firecrawl, and Oxylabs equivalents.
5. **Is the AI agent UX correct?** An LLM reading tool outputs and hints must be guided toward correct decisions, not misled into loops or wasted calls.

---

## Testing Angles

### Angle 1: Extraction Fidelity
*"Is the data actually correct, or just non-empty?"*

Most tools return *something*. Professional testing checks whether what's returned is *right*.

- **Completeness:** Does the extractor return the full article, or just the first section? Test with long-form content (5,000+ word pages).
- **Accuracy:** Are prices, dates, and named entities preserved correctly? Test structured product and news pages.
- **Boilerplate contamination:** Do nav bars, cookie banners, and footers bleed into extracted content? The extractor must filter these.
- **Table and list preservation:** Do structured data elements survive extraction with their relationships intact?
- **Relative link normalization:** Does `extractLinks` return absolute URLs? Relative links are useless to downstream agents.
- **Structured data (schema.org):** When a page has JSON-LD (Product price, Article date, Organization info), is it extracted separately and surfaced?
- **Truncation signal:** When content exceeds the extraction limit, is the caller informed? Silent truncation causes agents to treat incomplete data as complete.
- **Multi-language content:** UTF-8 encoding must be preserved for Chinese, Arabic, Japanese, and emoji content.

---

### Angle 2: Anti-Bot Bypass Quality
*"Can it actually get past the sites that matter?"*

Test against a tiered gauntlet — not example.com:

| Tier | Examples | Expected |
|------|----------|----------|
| 1 — Open web | Wikipedia, GitHub, BBC | Static fetch succeeds |
| 2 — Rate-limited | Amazon, Reddit, NYTimes | Proxy or render required |
| 3 — JS-heavy SPA | LinkedIn, Booking.com, Zillow | JS render required |
| 4 — Actively hostile | Cloudflare Turnstile, Akamai BMP | Unblocker required |
| 5 — Auth-gated | Twitter/X logged-in, banking dashboards | Should fail gracefully, not silently |

Critical failure mode: **false success** — the tool returns HTTP 200 with a bot challenge page HTML, and the caller believes the real content was retrieved. `detectBotChallenge()` must run on every response path.

For each tier: measure success rate, check that returned HTML is real content (not a challenge page), and verify the mode metadata reported (`static`, `render`, `browser`, `render-failed`) matches how the content was actually fetched.

---

### Angle 3: Escalation Chain Correctness
*"Does the auto-routing engine make the right call every time?"*

novada-mcp has a 3-tier escalation: `static → render → browser`. This is its main differentiator. It must be correct.

Trace these scenarios through the code:

- **Happy path:** Static fetch returns rich content → mode=static, no escalation. No unnecessary costs incurred.
- **JS-heavy detection:** Static fetch returns empty shell or Cloudflare page → `detectJsHeavyContent` fires → escalates to render.
- **Bot challenge detection:** Static or render result contains Akamai/Imperva signals (`_abck`, `bm_sz`, `incap_ses`) → `detectBotChallenge` fires → escalates or returns `render-failed`. **Both `extract.ts` and `router.ts` must have this check.**
- **Render-failed loop prevention:** When render mode fails, the agent hint must say "do NOT retry with render='render' — escalate to browser or try a different URL." Not doing so creates an infinite loop in agent pipelines.
- **Browser fallback:** When `render='browser'` is requested but `NOVADA_BROWSER_WS` is not configured, the error message must tell the agent exactly which environment variable to set and where to get the credentials.
- **Mode metadata integrity:** The `mode:` field in the output must always match how content was actually fetched. A static fallback must never be labeled as `render`.
- **Cost awareness:** Agent hints must mention that browser mode costs ~$3/GB so agents can make cost-aware routing decisions.

---

### Angle 4: Reliability and State Management
*"Does it hold up under concurrent load and edge conditions?"*

- **Circuit breaker correctness:** The per-endpoint proxy circuit breaker (`proxyCircuits` Map) must correctly isolate failures per endpoint. Two SDK clients with different proxy endpoints must not interfere with each other.
- **AsyncLocalStorage isolation:** When `batchExtract` dispatches 10 parallel `extract()` calls, each call's credential scope must be fully isolated. Key-A must never leak into Key-B's request context.
- **Timeout boundaries:** Test behavior at exactly the timeout boundary (e.g., t=29.9s vs t=30.0s). The tool must return a clean, actionable error — not a hanging promise or partial result.
- **Retry correctness:** Mock a 429 → 429 → 200 sequence and verify exponential backoff is applied correctly. Max 3 retries, delays must double each attempt.
- **Response size cap:** A 100MB HTML page must not be fully buffered. The 10MB `maxContentLength` cap must apply to both GET requests (`fetchWithRetry`) and POST requests (`fetchWithRender` / Web Unblocker). Verify both paths.
- **Oversized content handling:** When the 10MB cap triggers, the error must be informative. It should not look like a generic network error.

---

### Angle 5: Security Surface
*"Can it be weaponized or exploited in a multi-tenant MCP deployment?"*

- **SSRF protection:** Test all blocked address categories:
  - IPv4 loopback: `http://127.0.0.1`, `http://localhost`
  - RFC-1918 private: `http://10.0.0.1`, `http://192.168.1.1`, `http://172.16.0.1`
  - AWS metadata: `http://169.254.169.254/latest/meta-data/`
  - IPv6 loopback: `http://[::1]`
  - **IPv6-mapped IPv4 (bypass vector):** `http://[::ffff:127.0.0.1]`, `http://[::ffff:192.168.1.1]`
  - IPv6 link-local: `http://[fe80::1]`
  All of the above must be rejected at the schema validation layer, before any network call is made.

- **Credential leakage in errors:** Trigger a proxy auth failure. Does the error message include the raw proxy password, API key, or WebSocket URL? It must not.

- **URL injection:** Pass `url="https://example.com\nHost: internal-service.local"` — HTTP header injection via newline in URL. Must be blocked or sanitized.

- **Multi-tenant isolation:** Two `NovadaClient` instances with different API keys running concurrent requests must never share state. Verify via credential store (`AsyncLocalStorage`) and circuit breaker (`proxyCircuits` keyed by endpoint, not global).

- **Dependency vulnerabilities:** Run `npm audit`. Report any HIGH or CRITICAL findings with CVE numbers. Evaluate whether they affect the production attack surface or are dev-only.

---

### Angle 6: Error Quality — "Does the error help the agent?"
*"Every error is a conversation between the MCP and the AI agent. Grade them."*

Error messages must be Grade A for every recoverable failure:
- **Grade A:** Tells the agent what happened AND what to do next (specific tool, parameter, or action)
- **Grade B:** Explains what happened but not what to do
- **Grade C:** Generic HTTP error with no context
- **Grade F:** Silent failure, wrong mode reported, or misleading output

Test these failure conditions and grade each error:

| Failure | Expected Grade |
|---------|---------------|
| API key not configured | A |
| Invalid API key (401) | A |
| Malformed URL input | A |
| Browser WS not configured | A |
| Proxy credentials wrong (407) | A |
| All escalation paths exhausted | A |
| Unknown scraper platform | A |
| `batchExtract` called with >10 URLs | A |
| Network timeout | B minimum |
| Response over 10MB cap | B minimum |

Also evaluate the `## Agent Hints` sections appended to every tool output — do they point to genuinely optimal next steps, or do they suggest actions that would waste tokens, create loops, or incur unnecessary cost?

---

### Angle 7: Agent UX and Output Consistency
*"Would an LLM reliably parse and act on this output?"*

- **Tool selection accuracy:** Give the 10 tool descriptions to a language model and ask: "Which tool do I use to extract Amazon product prices?" "Which tool do I use to search the web?" "Which tool do I use if a page needs JavaScript?" — verify the descriptions uniquely and correctly guide selection.
- **Output format consistency:** Run 20 `novada_extract` calls on varied URLs. Can a parser always find `title:`, `mode:`, `chars:`, `## Agent Hints` in consistent positions? Format instability forces agents to write brittle parsers.
- **SDK type accuracy:** In `sdk/index.ts`, does the `ExtractResult.content` field contain only the article content, or does it accidentally include the "Same-Domain Links" section? Blended content degrades downstream processing.
- **Token efficiency:** Is the output compact, or does it include repeated headers, padded separators, and redundant boilerplate? Token waste directly costs money at scale.
- **Disambiguation:** When two tools could apply (e.g., `novada_extract` vs `novada_unblock` for a JS-heavy page), does the guide make the distinction clear?

---

### Angle 8: Competitive Benchmark
*"How does novada-mcp compare to Bright Data, Firecrawl, and Oxylabs?"*

Run a structured comparison across the feature matrix:

| Feature | Bright Data | Firecrawl | Oxylabs | novada-mcp | Gap? |
|---------|-------------|-----------|---------|------------|------|
| Structured platform scrapers | 38 datasets | ✗ | ✗ | 129 platforms | **BETTER** |
| Web search (SERP) | ✓ | ✓ | ✓ | Partial (B1 blocker) | Gap |
| JS rendering | ✓ | ✓ | ✓ | ✓ (Web Unblocker) | Parity |
| Browser automation | ✓ (14 tools) | ✓ | ✗ | ✓ (8 actions) | Parity |
| Persistent browser sessions | ✓ | ✓ | ✗ | ✗ | Gap |
| Auto-escalation routing | ✗ | ✗ | ✗ | ✓ | **UNIQUE** |
| Claim verification | ✗ | ✗ | ✗ | ✓ (`novada_verify`) | **UNIQUE** |
| Multi-source research synthesis | ✗ | ✗ | ✗ | ✓ (`novada_research`) | **UNIQUE** |
| Residential proxy tool | ✓ | ✗ | ✓ | ✓ | Parity |
| PDF extraction | ✓ | ✓ | ✗ | ✗ | Gap |
| Async webhook callbacks | ✓ | ✓ | ✗ | ✗ | Gap |
| Batch URL extraction | ✓ | ✓ | ✗ | ✓ (max 10) | Parity |
| Output formats (JSON/CSV/Excel) | ✓ | Partial | ✗ | ✓ (5 formats) | Parity |
| Geo-targeted proxy | ✓ | ✗ | ✓ | ✓ | Parity |

For each gap: is it a code gap (fixable now), a backend gap (needs API), or a design gap (out of scope)?

For each unique advantage: is the implementation robust enough to be a true selling point, or does it have reliability issues that undermine the claim?

---

## Scoring Rubric

After completing all 8 angles, assign a score for each dimension:

| Dimension | Score (1–10) |
|-----------|-------------|
| Extraction fidelity | |
| Anti-bot bypass quality | |
| Escalation chain correctness | |
| Reliability and state management | |
| Security posture | |
| Error quality | |
| Agent UX and output consistency | |
| Competitive feature parity | |
| **Overall** | |

**Score guide:**
- 9–10: Enterprise-grade, ready for production at scale
- 7–8: Production-ready with documented limitations
- 5–6: Functional but has reliability or quality gaps that limit enterprise use
- 3–4: Significant issues — not recommended without remediation
- 1–2: Not production-ready

---

## Output Format

Deliver a structured audit report:

```
## novada-mcp Professional Audit Report
Version: [version]
Date: [date]

### Executive Summary
[3 sentences: overall verdict, biggest strength, biggest gap]

### Critical Findings (block deployment)
[Each finding: description — file:line — impact — fix]

### Medium Findings (fix in next release)
[Each finding: description — file:line — impact — fix]

### Low / Advisory Findings
[Each finding: description — accept or fix]

### Scorecard
[Table]

### Competitive Position
[Paragraph: where novada-mcp wins, where it loses, and why it matters]

### Recommended Actions (priority order)
1. ...
2. ...
3. ...
```

For any Critical or Medium finding: write the fix directly into the source code, then run `npm test` to confirm nothing broke. Report the before/after test count.
