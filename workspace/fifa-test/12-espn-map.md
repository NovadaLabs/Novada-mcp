# Test 12: ESPN Map for Football Content

## Command
```bash
novadaMap({url:'https://www.espn.com/soccer/', search:'France Norway', limit:10, include_subdomains:false, max_depth:2})
```

## Results
- **Latency:** 2519ms
- **Response size:** 843 chars
- **URLs found:** 0 (only root URL returned)

## Raw Output
```
## Site Map
root: https://www.espn.com/soccer/
urls:0

---

Only the root URL found on https://www.espn.com/soccer/.
Possible causes: (1) single-page site with no internal links, (2) JavaScript SPA, (3) sitemap not available.

## Agent Hints
- Try `novada_extract` on https://www.espn.com/soccer/ to read the page content directly.
- Use `novada_crawl` with render="render" for JavaScript-rendered sites.
- Use `novada_unblock` with method="render" to fetch rendered HTML directly.
- Use `novada_search` with `site:www.espn.com` to find indexed subpages.

## Agent Notice - Under-delivery
requested: 10 | returned: 0 | shortfall: 10
reason: No additional URLs found - site may have no internal links, be a JavaScript SPA, or have no sitemap.
next_steps: Use novada_extract to read the page, or novada_crawl with render="render" for JS sites.
```

## Analysis
- ESPN is a JavaScript SPA -- the map tool correctly identified this and returned 0 URLs beyond the root.
- The tool provided appropriate fallback suggestions (extract, crawl with render, unblock, site-scoped search).
- The under-delivery notice with shortfall count (10) and next_steps is well-structured for agent consumption.
- **Limitation confirmed:** `novada_map` relies on sitemap/static HTML links; JS-rendered SPAs like ESPN return empty results. This is expected behavior, not a bug.
