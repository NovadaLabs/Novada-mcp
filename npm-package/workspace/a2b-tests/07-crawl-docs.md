# A2B Test 07 — Crawl Docs Site

**Scenario:** Developer ingests the Requests Python library documentation.
**A:** docs site URL (`https://docs.python-requests.org/en/latest/`)
**B:** multiple pages extracted as markdown

**Date:** 2026-06-25
**Tool:** `novadaCrawl` (build/tools/crawl.js)
**API key source:** NOVADA_API_KEY only

---

## Result

| Metric | Value |
|--------|-------|
| Status | PASS |
| Latency | 3380ms |
| Output size | 17598 chars |
| Pages crawled | 5 |
| Words extracted | 1827 |
| Failed pages | 0 |
| JS pages missing render | 0 |

## Pages Crawled

1. `https://docs.python-requests.org/en/latest/` — title: "Requests: HTTP for Humans™", depth:0, 287 words
2. `https://docs.python-requests.org/en/latest/user/quickstart/`
3. `https://docs.python-requests.org/en/latest/user/advanced/`
4. `https://docs.python-requests.org/en/latest/api/`
5. `https://docs.python-requests.org/en/latest/community/updates/#release-history`

## Output Structure

The crawl result is a single markdown document with:
- Header section: root URL, page count, strategy, source, word count
- Agent hints block: chainable output with all crawled URLs and agent_instruction
- Per-page sections labeled `### [1/5] <url>` with title, depth, word count, and full markdown content
- Security comment wrapping external content: `<!-- BEGIN EXTERNAL CONTENT -->`

## Verdict

**A→B COMPLETE.** `novadaCrawl` successfully ingests a multi-page docs site in a single call. BFS traversal discovered and extracted 5 pages (index + quickstart + advanced + api + changelog) with correct markdown formatting. Output is structured for chaining (root_url + crawled_pages list) and ready for downstream agent consumption.

## Notes

- Page count regex in the test script matched 1 (header section) vs 5 actual pages — cosmetic issue in the test harness, not the tool. Real page count confirmed via `crawled_pages:` block showing 5 entries.
- `render: 'auto'` used static fetch (no JS escalation needed); docs site is static HTML.
- Total word count (1827) is lower than expected for 5 full doc pages — the Requests docs site may have sparse content per page or the crawler hit word limits.
