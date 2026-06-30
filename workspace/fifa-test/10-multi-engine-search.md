# Test 10: Multi-Engine Search Comparison

**Query:** `France Norway football match today score 2026`
**Date:** 2026-06-26
**Engines:** google, bing, duckduckgo
**Requested results per engine:** 5

## Summary

| Engine      | Status | Latency  | Response Size | Results Returned |
|-------------|--------|----------|---------------|------------------|
| google      | PASS   | 9,809ms  | 1,943 chars   | 3                |
| bing        | FAIL   | 7,589ms  | 338 chars     | 0                |
| duckduckgo  | PASS   | 15,766ms | 3,957 chars   | 10               |

**Overall:** 2/3 engines returned usable results. Bing returned zero results for this query.

## Per-Engine Analysis

### Google (PASS)

- **Results:** 3 (requested 5)
- **Quality:** High relevance. Top 3 results are ESPN, FIFA.com, and BBC Sport -- all authoritative live match sources.
- **Reranking:** Applied (`reranked:true`)
- **File saved:** Yes (JSON to Downloads)
- **Agent hints:** Present and correct
- **Chainable output:** Present with `top_urls` and `result_count`

Top results:
1. ESPN - Norway vs. France (Jun 26, 2026) Live Score
2. FIFA.com - Norway v France: Line-ups, Score & Live Updates
3. BBC Sport - Norway vs France - FIFA World Cup Group I LIVE

### Bing (FAIL)

- **Results:** 0
- **Quality:** N/A -- no results returned
- **Response:** `No results found` message with agent hints suggesting broader query or different engine
- **Note:** Bing's scraper API returned empty for this specific query. The fallback messaging is correct -- it suggests trying duckduckgo or rephrasing.

### DuckDuckGo (PASS)

- **Results:** 10 (requested 5, returned double)
- **Quality:** Highest breadth. Includes Indian Express, theScore, Sofascore, Standard.co.uk, LiveScore, NYT, and more.
- **Reranking:** Applied (`reranked:true`)
- **File saved:** Yes (JSON to Downloads)
- **Latency:** Slowest at 15.8s
- **Note:** Returned 10 results despite requesting 5. This is likely the scraper API returning its default page size. Not a bug per se, but the `num` parameter did not cap results.

## Findings

### Issues

1. **Bing: zero results** -- The bing scraper API returned no results for a straightforward current-events sports query. This is either an upstream issue with the Bing scraper endpoint or a query formatting problem specific to the Bing adapter. Severity: MEDIUM (affects one of three engines).

2. **DuckDuckGo: `num` parameter ignored** -- Requested 5 results, got 10. The `num` parameter does not appear to limit DuckDuckGo results. Severity: LOW (more results is arguably better, but the contract is broken).

3. **Google: 3 results instead of 5** -- Possibly fewer results available from the scraper for this query, or a pagination issue. Severity: LOW.

### Positives

- **Reranking works** -- Both google and duckduckgo results were reranked by relevance, and the top results are highly relevant to the query.
- **Agent hints and chainable output** -- Present on all responses including the empty bing response. Good for downstream agent consumption.
- **File saving** -- JSON files saved to `~/Downloads/novada-mcp/` with timestamped filenames for google and duckduckgo.
- **Error handling** -- Bing's zero-result case is handled gracefully with helpful suggestions rather than an error.
- **Content quality** -- DuckDuckGo's snippets are richer and more detailed than Google's for this query. Google's are more concise but from higher-authority sources.

## Verdict

Multi-engine search is functional. Google and DuckDuckGo produce good, relevant results. Bing has an upstream issue for this query. The `num` parameter enforcement should be investigated for DuckDuckGo.
