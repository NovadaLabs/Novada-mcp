# Issue Ownership Matrix — MCP vs Novada Backend
**Date:** 2026-04-22 | **Purpose:** Determine what WE fix vs what Novada backend must fix

---

## Classification

| # | Issue | Owner | Severity | Evidence |
|---|-------|-------|----------|----------|
| 1 | Yahoo search 410 "empty query built" | **NOVADA BACKEND** | CRITICAL | MCP sends `q=vector+databases+comparison+2025` correctly. Backend drops the param. Verified via URL inspection. |
| 2 | Bing query silently dropped → wrong results | **NOVADA BACKEND** | CRITICAL | MCP sends `q=LLM+fine-tuning+techniques`. Backend returns generic LLM pages. Query string lost at scraperapi layer. |
| 3 | DuckDuckGo API_DOWN (all calls, all rounds) | **NOVADA BACKEND** | HIGH | Workers down or DDG blocking Novada IPs. MCP can't fix. |
| 4 | Yandex INVALID_API_KEY | **NOVADA BACKEND** | MEDIUM | No Yandex Search API key provisioned on the account. |
| 5 | Google 413 WorkerPool on parallel calls | **NOVADA BACKEND** | MEDIUM | Backend can't handle concurrent requests. Sequential calls work. |
| 6 | scraperapi.novada.com root path returns 404 | **NOVADA BACKEND** | CRITICAL | `scraperapi.novada.com?url=...&api_key=...` returns 404. Only `/search` sub-path works. The entire extract/crawl/map proxy path was dead. |
| 7 | Stripe geo-redirect (EU proxy IPs → German) | **NOVADA BACKEND** | MEDIUM | Proxy exit IPs are in EU. No country targeting available on scraperapi. Web Unblocker returns US content (verified). |
| 8 | Research query over-generalization (BUG-6) | **MCP (OUR FAULT)** | CRITICAL | `generateSearchQueries()` breaks compound terms. "production AI agents" → "building production" → construction results. Pure MCP logic bug. |
| 9 | No content quality detection | **MCP (OUR FAULT)** | HIGH | Tool returns 144-char German content as "success." No check for suspicious length, wrong language, or CAPTCHA pages. We should detect and flag this. |
| 10 | Agent Hints are static/generic | **MCP (OUR FAULT)** | HIGH | Same 3 lines regardless of result quality. Should be context-specific. This is our formatting logic. |
| 11 | No auto-fallback for failed search engines | **MCP (OUR FAULT)** | HIGH | When Yahoo fails, we throw an error instead of automatically retrying with Google. Easy to implement. |
| 12 | Crawl truncates to 3000 chars per page silently | **MCP (OUR FAULT)** | MEDIUM | `crawl.ts` line 78: `.slice(0, 3000)`. No metadata tells the agent how much was cut. |
| 13 | Research has no relevance filtering | **MCP (OUR FAULT)** | HIGH | All 15 sources returned blindly. No check whether sources match the original question domain. |
| 14 | Content truncation metadata incomplete | **MCP (OUR FAULT)** | MEDIUM | Extract shows `chars:144` but doesn't show original page size or truncation ratio. Agent can't judge completeness. |
| 15 | No language/locale detection in responses | **MCP (OUR FAULT)** | MEDIUM | Agent gets German content with no warning. A simple title-language check would catch this. |

---

## Summary

| Owner | Count | Severity Breakdown |
|-------|-------|-------------------|
| **NOVADA BACKEND** | 7 issues | 3 CRITICAL, 2 HIGH, 2 MEDIUM |
| **MCP (OUR FAULT)** | 8 issues | 1 CRITICAL, 4 HIGH, 3 MEDIUM |

### Novada Backend Issues (7) — Need Feedback to Novada

These are product/infrastructure issues we cannot fix at the MCP layer:
1. **Search engine failures** (#1-5) — 4/5 engines broken, Google overloaded on parallel calls
2. **Proxy endpoint dead** (#6) — scraperapi root path returns 404
3. **Geo-targeting absent** (#7) — EU proxy IPs cause wrong-locale content

### MCP Issues (8) — We Fix These Now

These are OUR code, OUR logic, OUR responsibility:
1. **Research query generation** (#8) — broken sub-query construction
2. **No content quality detection** (#9) — accept garbage as success
3. **Static Agent Hints** (#10) — same boilerplate every time
4. **No search auto-fallback** (#11) — error instead of retry
5. **Silent crawl truncation** (#12) — 3000 char limit hidden
6. **No relevance filtering in research** (#13) — return noise with signal
7. **Incomplete truncation metadata** (#14) — agent can't judge completeness
8. **No language detection** (#15) — wrong-language content passes silently

---

## Action Plan

### Phase A: MCP Fixes (We Do Now — Our Fault)

| Priority | Issue | File | Change | Impact |
|----------|-------|------|--------|--------|
| **P0** | #8 Research query anchoring | `research.ts` | Keep original question as anchor in all sub-queries | Fixes 73% irrelevant results |
| **P0** | #13 Research relevance filter | `research.ts` | Score sources against question keywords, drop <30% match | Eliminates noise sources |
| **P0** | #11 Search auto-fallback | `search.ts` | On engine failure, auto-retry with Google | Fixes effective search rate from 20% to ~90% |
| **P1** | #9 Content quality detector | `utils/html.ts` | Check: length < 500, wrong language, CAPTCHA indicators | Agents warned before consuming garbage |
| **P1** | #10 Dynamic Agent Hints | All 5 tool files | Hints reflect THIS response (truncation amount, quality flags, result count context) | Agents get actionable next steps |
| **P1** | #15 Language detection | `utils/html.ts` | Check `<html lang=...>` and `<title>` for expected vs actual language | Catch geo-redirect pages |
| **P2** | #12 Crawl truncation metadata | `crawl.ts` | Show `words:457 (of ~1200, truncated)` in per-page metadata | Agent knows what it's missing |
| **P2** | #14 Extract truncation metadata | `extract.ts` | Show `chars:30000 (full page: 47210)` when truncated | Agent can decide whether to get more |

### Phase B: Novada Backend Feedback (Send to Novada)

Separate document: `novada-backend-feedback.md` — formal issue report with evidence, reproduction steps, and competitive pressure context.
