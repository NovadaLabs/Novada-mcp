# FIFA Test: France vs Norway Search

**Date:** 2026-06-25
**Tool:** `novadaSearch` via `novada-mcp/build/tools/search.js`
**API Key:** NOVADA_API_KEY only (no other credentials)
**Query:** `France vs Norway FIFA 2026 today lineup squad players`
**Engine:** google | **Requested:** 10 | **Returned:** 9

## Performance

- **Latency:** 4332 ms
- **Response size:** 4481 chars
- **Reranked:** true
- **Source:** live (via scraper-api)

## Raw Output

```
## Search Results
results:9 | engine:google (via scraper-api) | source: live | reranked:true

---

## 1. [Norway vs. France at World Cup 2026: TV channel, how to ...](https://www.espn.com/soccer/story/_/id/49162941/norway-vs-france-fifa-world-cup-2026-tv-channel-how-watch-kick-live-stream-injury-predicted-line-ups)
published: 8 hours ago
8 hours ago—It's the big fixture in Group I of the FIFA World Cup 2026 withFrance taking on Norway in Boston on Friday.Read

## 2. [France Predicted Lineup vs. Norway: World Cup Group I](https://www.si.com/soccer/france-predicted-lineup-vs-norway-world-cup-6-26-26)
published: 1 day ago
1 day ago—DM: Adrien Rabiot—Only Kylian MbappéandN'Golo Kanté have been used more frequently by Deschamps than Rabiot amongcurrent squadmembers, ...

## 3. [Norway v France: Line-ups, Score & Live Updates](https://www.fifa.com/en/match-centre/match/17/285023/289273/400021489)
published: 4 hours ago
4 hours ago—Norway vs.France; MbappeandOlise hint at a partnership for the ages ;Francemove up to second in theFIFARanking ;World Cup 2026: Routes to the final ...

## 4. [Norway vs France lineups: Predicted XIs, confirmed team ...](https://www.standard.co.uk/sport/football/norway-vs-france-lineups-predicted-xi-confirmed-team-news-injury-latest-world-cup-2026-b1287632.html)
published: 8 hours ago
8 hours ago—Manu Kone partnered Adrien Rabiot in midfield, with Aurelien Tchouameni dropping to the bench, and Bradley Barcola was given the nod over Desire ...

## 5. [Your combined Norway vs France XI is simply put...not very ...](https://www.instagram.com/p/DaAQG1rnyc5/)
GROUPNORWAYPOSSIBLELINEUPNORGE NF STANLEYFIFAHAALAND + SORLOTH + A. NUSA + AURSINES + S. BERGE + ∅DEGAARD + M. WOLFE + AJER + HEGGEM + ...

## 6. [World Cup 2026 Group I Preview: France, Senegal, Iraq & ...](https://www.rotowire.com/soccer/article/2026-world-cup-group-i-preview-france-senegal-iraq-norway-tactics-lineups-set-pieces-odds-111129)
published: Jun 1, 2026
Jun 1, 2026—Your complete2026 World CupGroup I breakdown:France, Senegal, Iraq &Norwaytactics, predictedlineups, set piecesandlatest betting odds.Read

## 7. [France's expected lineup against Norway Both teams have ...](https://www.facebook.com/61552599328344/posts/latest-frances-expected-lineup-against-norwayboth-teams-have-qualified-wholl-win/122271404918086644/)
Netherlands probablelineup(4-3-3): Cillessen; Berghuis, De Vrij, Van Dijk, Ake; Wijnaldum, De Roon, Geertruida; Depay, Weghorst, Malen. Can ...

## 8. [2026 FIFA World Cup Group I](https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_Group_I)
published: 5 hours ago
5 hours ago—The group consists ofFrance, Senegal, Iraq,and Norway. The top two teams, possibly along with the third-placed team, will advance to the round of 32.Read

## 9. [France's Aurelian Tchouameni isn't sure whether he should ...](https://www.tiktok.com/@bbcsport/video/7655629699984657687)
France's Aurelian Tchouameniisn't sure whether he should believe Norway's Erling Haaland or not #FifaWorldCup #France #Norway #Tchouameni # ...

---
## Agent Hints
- Results are reranked by relevance to your query (title + snippet keyword scoring)
- To read any result in full: `novada_extract` with its url
- To batch-read multiple results: `novada_extract` with `url=[url1, url2, ...]`
- For deeper multi-source research: `novada_research`

## Chainable Output
result_count: 9
top_urls:
  [1] https://www.espn.com/soccer/story/_/id/49162941/norway-vs-france-fifa-world-cup-2026-tv-channel-how-watch-kick-live-stream-injury-predicted-line-ups
  [2] https://www.si.com/soccer/france-predicted-lineup-vs-norway-world-cup-6-26-26
  [3] https://www.fifa.com/en/match-centre/match/17/285023/289273/400021489
  [4] https://www.standard.co.uk/sport/football/norway-vs-france-lineups-predicted-xi-confirmed-team-news-injury-latest-world-cup-2026-b1287632.html
  [5] https://www.instagram.com/p/DaAQG1rnyc5/
agent_instruction: Search complete. Call novada_extract with any url above to read the full page. Call novada_research for deeper multi-source investigation.
```

## Assessment

| Metric | Result |
|--------|--------|
| Search succeeded | YES |
| Real-time results | YES (published 4-8 hours ago) |
| Relevant to query | YES (lineups, squads, match info) |
| Source diversity | ESPN, SI, FIFA.com, Standard, Wikipedia, RotoWire, Instagram, Facebook, TikTok |
| Reranking working | YES (ESPN/SI/FIFA.com top 3) |
| Agent hints present | YES |
| Chainable output | YES (top_urls block) |
