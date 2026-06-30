# Search `num` Parameter Trace — Findings & Status

## Summary

The `num` parameter is **sent correctly** to the Scraper API as the field name `num`. The field name matches what the API expects. However, there are two real issues:

1. **Bing always returns 0 results** — the `submitBingSearch` path never passes `num` (correct per `supports_num: false`), but the whole Bing path is broken: returns 0 results consistently.
2. **Google `num` is honoured by the API, but the API returns fewer results than requested** — requesting `num:8` returns 6, requesting `num:15` returns 8, requesting `num:3` returns 2. The API silently caps/varies its output; the code receives and renders all results the API returns.

---

## Trace: Where `num` Goes

### Google / DuckDuckGo path (`submitSearchScrapeTask`)

`search.ts` line 152:
```ts
if (supportsNum) form.append("num", String(num));
```

- `supportsNum` is `true` for `google` and `duckduckgo` (ENGINE_MAP lines 26, 28).
- `num` is sent verbatim as the form field `num` to `https://scraper.novada.com/request`.
- Confirmed correct by `docs/novada-api/scraper-api-complete-reference.md` line 43: `scraper_name=google.com&scraper_id=google_search&q=test&num=10`.

### Bing path (`submitBingSearch`)

`search.ts` lines 70–88: the `submitBingSearch` function constructs its form with NO `num` field — consistent with `supports_num: false` in ENGINE_MAP (line 27). The playground reference (`docs/novada-api/scraper-playground-reference.md` line 965–968) confirms Bing's `bing_search` scraper accepts no `num` param.

### Yandex

`supports_num: false` (ENGINE_MAP line 29). Yandex uses `keyword` as the query param. No `num` sent. Consistent with playground ref.

---

## Result Parsing: All Results Extracted

`parseScraperSearchResults` (lines 255–270) maps the entire `organic_results` / `organic` / `results` / `items` array — no slicing. All results returned by the API are included in the output.

The markdown renderer (lines 531–560) iterates `for (let i = 0; i < reranked.length; i++)` — every result gets its own `## N.` heading.

---

## Live Test Results

| Test | num param | Results rendered | Notes |
|------|-----------|-----------------|-------|
| `google`, `num:8` | sent as `num=8` | 6 | API returned 6; code rendered all 6 |
| `google`, `num:15` | sent as `num=15` | 8 | API capped at ~8 |
| `google`, `num:3` | sent as `num=3` | 2 | API returned 2 |
| `bing`, `num:8` | not sent (correct) | 0 | Bing path broken — no results |

---

## Issues Found

### Issue 1: `num` field name — CORRECT, no fix needed

The field is already sent as `num`. The API docs confirm `num` is the correct field name for `google_search`. No fix required.

### Issue 2: Google returns fewer results than `num` requests

The API silently delivers fewer results than requested (8 requested → 6 returned; 15 requested → 8 returned). This is **API-side behaviour** — the Novada scraper caps organic results. The MCP code is not at fault; it renders all results received.

**No code change needed.** The MCP tool description already states `num` defaults to 10 and has a max of 20 — the API may not honour high values.

### Issue 3: Bing returns 0 results (pre-existing bug)

`submitBingSearch` (lines 66–125) returns empty consistently. The three retry paths (task_id poll, HTML parse, sync organic) all come up empty. This is a pre-existing Bing-specific issue tracked separately (see `docs/bug-report-bing-null-taskid.md`). The `num` parameter is not a factor here.

---

## Conclusion

`num` is propagated correctly to the API for all engines that support it. The field name `num` matches the API spec. No fix needed for the `num` parameter itself.

The only actionable item from this investigation is the pre-existing Bing 0-results bug, which is out of scope for this ticket.
