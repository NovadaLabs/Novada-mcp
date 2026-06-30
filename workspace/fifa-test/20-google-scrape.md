# Test 20 — Google Scrape (FIFA Match News)

## Command
```bash
cd ~/Projects/novada-mcp
NOVADA_API_KEY=*** node << 'EOF'
process.env.NOVADA_API_KEY = '***';
const { novadaScrape } = await import('./build/tools/scrape.js');

const t = Date.now();
const r = await novadaScrape({
  platform: 'google.com',
  operation: 'google_search',
  params: { q: 'France vs Norway FIFA World Cup 2026 score lineup', num: 5 },
  limit: 5,
  format: 'markdown'
}, process.env.NOVADA_API_KEY).catch(e=>'ERR:'+e.message);

console.log('Google scrape:', Date.now()-t+'ms |', r.length+'ch');
console.log(r);
EOF
```

## Notes

The original command used `operation: 'google_search_keywords'` and `params: { keyword: ... }`,
which fails with error code 11006. The correct operation is `google_search` with param `q` (not `keyword`).

Reference: `novada://scraper-platforms` resource lists:
```
google.com (platform_id=25)
- google_search → params: { q: string, device?: string, domain?: string, country?: string, hl?: string }
```

## Result

- **Status**: PASS
- **Latency**: 2814ms
- **Records**: 3
- **Output size**: 4026 characters

## Raw Output

```
## Scrape Results
platform: google.com | operation: google_search | records: 3 | source: live

---

| title | position | display_link | source | link | description |
| --- | --- | --- | --- | --- | --- |
| Norway v France: Line-ups, Score & Live Updates | 1 | https://www.fifa.com | FIFA | https://www.fifa.com/en/match-centre/match/17/285023/289273/400021489 | Norway vs. France; Mbappe and Olise hint at a partnership for the ages; France… |
| Norway VS France: Live Scores, Lineups, H2H & Odds | 2 | https://www.365scores.com | 365Scores | https://www.365scores.com/football/match/fifa-world-cup-5930/france-norway-2376… | About Norway vs France. Norway will take on France on Friday, June 26, 2026 at Gi… |
| 2026 FIFA World Cup Group I | 3 | https://en.wikipedia.org | Wikipedia | https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_Group_I | The group consists of France, Senegal, Iraq, and Norway. The top two teams, possi… |

---
```

## Key Findings

1. **Match scheduled**: Norway vs France on Friday, June 26, 2026 at Gillette Stadium (Foxborough).
2. **Group I**: France, Senegal, Iraq, Norway.
3. **Sources**: FIFA.com (official match centre), 365Scores (live scores/lineups), Wikipedia (group overview).
4. **Mbappe & Olise partnership** highlighted in FIFA.com snippet.
