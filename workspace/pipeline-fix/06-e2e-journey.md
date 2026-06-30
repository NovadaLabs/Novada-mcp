# E2E User Journey Test — 2026-06-25

**Scenario:** User researching "web scraping APIs" — 5 sequential tasks simulating a real workflow.

## Summary

| # | Task | Status | Time (run 1) | Time (run 2) | Chars | Notes |
|---|------|--------|-------------|-------------|-------|-------|
| 1 | Search "best web scraping API 2026" (Google) | WARN | 2396ms | 2535ms | 321 | 0 results returned — passes char check but search came up empty |
| 2 | Extract Python docs (static) | PASS | 168ms | 166ms | 102190 | Fast static hit, quality 55/100 |
| 3 | Extract MDN (static → render escalation) | PASS | 24305ms | 6610ms | 26681 | First run very slow (render escalation); second run fast (cache) |
| 4 | Extract HN (dynamic) | PASS | 757ms | 857ms | 15488 | Static succeeded, quality 45/100 |
| 5 | Search again (cache hit) | PASS | 0ms | 0ms | 321 | In-memory cache working — instant |

**Overall: 5/5 tasks returned without error. 1 functional defect (Task 1 search returns 0 results).**

---

## Task-by-Task Details

### Task 1 — Search (Google)
- **Status:** WARN — tool returned success (321 chars, no error string) but 0 actual results
- **Root cause:** Google search returning empty results for this query. Likely backend rate-limit, geo-filter, or API key quota issue.
- **Agent hint surfaced:** "Try a different engine: engine=duckduckgo or engine=bing"
- **Impact:** User gets no search results; workflow stalls at first step
- **Action needed:** Investigate Google search backend; test with `engine: 'duckduckgo'` as fallback

### Task 2 — Extract Python docs (static)
- **Status:** PASS
- **Mode:** static (no escalation needed)
- **Performance:** 166–168ms — excellent
- **Content:** 102,190 chars, quality 55/100 (moderate) — full page extracted including nav noise
- **Title confirmed:** "urllib.request — Extensible library for opening URLs — Python 3.14.6"

### Task 3 — Extract MDN (render escalation)
- **Status:** PASS
- **Mode:** escalated to render (MDN is JS-heavy)
- **Performance:** 24.3s cold, 6.6s warm (cache) — cold start is high but acceptable for render path
- **Content:** 26,681 chars, quality 60/100 (good)
- **Title confirmed:** "Fetch API - Web APIs | MDN"
- **Note:** 24s cold run is a UX concern for render-path pages; users may perceive timeout

### Task 4 — Extract HN
- **Status:** PASS
- **Mode:** static (HN is lightweight HTML, no JS render needed)
- **Performance:** 757–857ms
- **Content:** 15,488 chars, quality 45/100 (moderate) — expected for link-list page
- **Note:** 198 links extracted; low quality score is structural (HN is mostly anchors)

### Task 5 — Search cache hit
- **Status:** PASS
- **Cache:** 0ms — in-memory cache works perfectly for identical query/engine/num
- **Content:** Identical 321-char result to Task 1 (same empty result cached)

---

## Issues Found

### P1 — Google Search Returns 0 Results
- All 5 `num` results are empty for `"best web scraping API 2026"` on Google engine
- The tool correctly formats the empty-result response (doesn't throw), so the char-based health check passes — a false positive
- The `ok` check in the test (`chars > 200 && !r.includes('ERR:')`) does NOT catch empty result sets
- **Fix required:** Add `results:0` detection to health check, or fix Google backend

### P2 — MDN Cold Render Latency (24s)
- Render escalation for JS-heavy pages can take 20–25s cold
- No timeout is surfaced to the caller; silent long wait
- **Mitigation:** Consider a render timeout warning at 10s, or pre-warming common domains

### P3 — Search Health Check Gap
- Test success criteria (`chars > 200 && !includes('ERR:')`) is insufficient
- Empty results look like successes; need `results > 0` assertion
- **Recommendation:** Update test harness to parse `results:N` from output and fail on 0

---

## Performance Baseline

| Metric | Value |
|--------|-------|
| Search latency (cold) | ~2.4–2.5s |
| Search latency (cache) | 0ms |
| Extract static (simple) | 166–168ms |
| Extract static (JS escalation, cold) | 24.3s |
| Extract static (JS escalation, warm) | 6.6s |
| Extract dynamic (HN) | 757–857ms |

---

## Test Harness Notes

- Run location: `/Users/tongwu/Projects/novada-mcp/`
- Build used: `./build/tools/{search,extract,research}.js`
- API key: live key used (real network calls)
- Cache: in-memory per-process (Task 5 = 0ms confirms)
- Two full runs executed; timings above are per-run actuals
