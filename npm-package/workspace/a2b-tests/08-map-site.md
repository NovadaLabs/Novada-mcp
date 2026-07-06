# Test 08 — novada_map: Site + Topic → URL List

**Scenario:** SEO analyst finds all blog posts on smashingmagazine.com about JavaScript.
**A (input):** site=smashingmagazine.com, topic=javascript
**B (expected):** list of relevant URLs

## Result: FAIL

| Metric | Value |
|--------|-------|
| Status | FAIL |
| Latency | 1347ms |
| Response length | 360ch |
| URLs found | 0 (2ch hits, no actual article URLs) |
| JS-related URLs | 0 |
| A→B | NOT COMPLETE |

## Raw Output

```
## Site Map
root: https://www.smashingmagazine.com
urls:0

No URLs found matching "javascript" on https://www.smashingmagazine.com.

## Agent Hints
- Remove the 'search' filter to see all 15 discovered URLs.
- Try a broader search term or check the URL spelling.
- Use `novada_search` with `site:www.smashingmagazine.com javascript` to find indexed pages.
```

## Root Cause

The `search` parameter on `novada_map` relies on finding the keyword in discovered URLs. Smashing Magazine structures URLs as `/YYYY/MM/article-slug/` — "javascript" rarely appears verbatim in the path. The tool returns 0 matching URLs even though hundreds of JavaScript articles exist on the site.

The sitemap/BFS discovery returns 0 URLs before the search filter is applied, suggesting `smashingmagazine.com` is blocking or rate-limiting the crawler at the sitemap/robots level.

## Agent Hints (surfaced correctly)

The tool does correctly suggest the right workaround: `novada_search site:www.smashingmagazine.com javascript`. This is good agent-first guidance, but the primary tool failed the scenario.

## Verdict

**PARTIAL** — Tool returns 0 URLs for the given scenario. The A→B mapping fails. The `agent_instruction` fallback hint is correct and useful, but the core map+search flow does not work for this site topology.

## Recommended Fix

1. When `url_count == 0` after search filter, also try sitemap.xml discovery and report total discovered before filter.
2. Log whether the root domain returned 0 pages from crawl (crawler blocked) vs 0 after filter (search mismatch). These are different failure modes needing different hints.
3. Consider: if sitemap discovery returns 0, surface "site blocked crawler" as explicit error rather than "no URLs matching search term."
