# Extract Quality Verification — 2026-06-26

## Test: 5-URL Quality Run (clean=false default)

| URL | ms | chars | mode | quality |
|---|---|---|---|---|
| Python docs | 114ms | 26,561 | static | 60/100 (good) |
| HackerNews | 703ms | 15,499 | static | 45/100 (moderate) |
| MDN Array | 11,317ms | 101,911 | render | 60/100 (good) |
| httpbin | 23,166ms | 1,440 | static | 25/100 (poor) |
| Quotes site | 6,013ms | 1,842 | static | 30/100 (poor) |

**Average: 29,451 chars vs baseline 7,149 chars — 4.1x improvement (+312%).**

Notes on outliers:
- `httpbin` and `quotes.toscrape.com` are both JS-heavy SPAs that return near-empty HTML on static fetch. The `content_ok:false` + `agent_instruction` hint to retry with `render="render"` is correctly emitted.
- MDN Array escalated to render mode automatically (11s) and returned 101k chars — full extraction working.
- All 5 URLs saved output to `~/Downloads/novada-mcp/`.

## Test: clean=true vs clean=false

Tested on `docs.python.org` and `news.ycombinator.com`.

| URL | clean=false chars | clean=true chars | diff |
|---|---|---|---|
| Python docs | 26,561 | 26,460 | −101 |
| HackerNews | 15,499 | 15,382 | −106 |

**Observation: The difference is negligible (~100 chars).**

Root cause: `extractFullPageContent` (clean=false) already removes `script/style/noscript/iframe/svg/canvas` and walks only semantic block elements. `extractMainContent` (clean=true) additionally strips nav/header/sidebar and uses density scoring to find the "main" content zone. For pages like Python docs and HN where nearly all content is in the body anyway, the overlap is high.

The distinction is meaningful on article pages with heavy chrome (nav bars, sidebars, footers with many links). On already-lean pages, both paths return nearly identical output.

The `clean` parameter is correctly wired — `params.clean !== true` → `extractFullPageContent`, `params.clean === true` → `extractMainContent`. No bug.

## Quality Score Interpretation

Scores come from `scoreExtraction()` in `src/utils/html.ts`. The `content_ok` flag gates warnings:
- `quality >= 50` and meaningful char count → `content_ok: true`
- `quality < 40` or chars < threshold → `content_ok: false` + `agent_instruction` with fix hint

The two "poor" URLs (httpbin, quotes.toscrape.com) correctly emit `agent_instruction: fix: retry with render="render"`.

## Summary

Full-page extraction (clean=false) is working correctly. Average output is 4.1x the pre-fix baseline (29,451 vs 7,149 chars). The `clean` flag is wired correctly but produces minimal difference on pages without heavy chrome. Low-quality pages correctly surface actionable `agent_instruction` hints.
