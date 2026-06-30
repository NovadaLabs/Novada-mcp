# A2B Test 05 — Docs Extraction (Playwright)

**Date:** 2026-06-25
**Scenario:** Developer reads Playwright docs to understand browser automation.
**URL (A):** https://playwright.dev/docs/intro
**Output (B):** Saved markdown locally.

## Results

| Mode | Latency | Size | Notes |
|------|---------|------|-------|
| Full page (`clean:false`) | 499ms | 15,307 ch | Live fetch |
| Clean mode (`clean:true`) | 0ms | 15,308 ch | Cache hit as expected |

**Saved file path:** `/Users/tongwu/Downloads/novada-mcp/2026-06-26/playwright-dev/2026-06-26_145347_playwright-dev.md`

## Content Verification

- Has code blocks (` ``` ` or `npm`): PASS
- Has install/playwright content: PASS
- Size > 5,000 chars: PASS (15,307 ch)

## Verdict

**A→B COMPLETE.** Full extraction returned 15K+ chars of Playwright docs in 499ms. Cache hit on second call returned in 0ms. Content contains code blocks and installation instructions, confirming readable, usable docs were captured.

## Notes

- `clean:true` returned 1 char more than `clean:false` (15,308 vs 15,307) — negligible; both modes return full content for this page (nav/footer stripped in clean likely offset by whitespace normalization).
- No errors. Single API key (`NOVADA_API_KEY`) used throughout; no fallback needed.
