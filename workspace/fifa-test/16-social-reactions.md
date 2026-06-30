# Test 16: Social Media Reactions Search

## Query
```
France Norway match reaction fans twitter site:x.com OR site:twitter.com
```

## Parameters
- engine: google
- num: 5
- time_range: day

## Result
- **Status**: SUCCESS
- **Latency**: ~3149ms
- **Results returned**: 5
- **Response size**: 2204 characters
- **Engine**: google (via scraper-api)
- **Reranked**: true

## Results Summary

| # | Account | Content |
|---|---------|---------|
| 1 | [@The90thMinute_](https://x.com/The90thMinute_) | Haaland post-match interview reaction after Norway's 3-2 win over Senegal |
| 2 | [@FOXSports](https://x.com/FOXSports) | Norway vs France Group I coverage |
| 3 | [@macdarabueller](https://x.com/macdarabueller) | Post-match reaction from Mexico City; France and Norway both win with braces |
| 4 | [@Footysm](https://x.com/Footysm) | Tactical analysis: gap between Norway's midfield and backline where France should dominate |
| 5 | [@FrenchTeam](https://x.com/FrenchTeam) | Official: Les Bleus move to top of Group I, top spot on the line against Norway on Friday |

## Observations
- All 5 results are from X/Twitter (x.com) as requested via site: operator
- Results include a mix of: fan accounts, official broadcasters, journalists, tactical analysts, and the official French team account
- `time_range: day` correctly scoped results to recent posts
- Reranking applied: results ordered by relevance to query keywords
- Snippets are truncated but provide enough context to identify content type
- Chainable output includes `top_urls` list for follow-up extraction via `novada_extract`
