# Benchmark: novada_scrape Latency

## Objective
Measure end-to-end latency of novada_scrape across 3 platforms, 3 rounds each. The scraper is async (submit + poll + download), so total time includes all phases.

## Test Operations
1. google_search (flat params) — `{q: "test", json: 1}`
2. amazon_product_asin (scraper_params) — `{asin: "B0DGHMNQ5Z"}`  
3. github_repository_url (scraper_params) — `{url: "https://github.com/anthropics/anthropic-sdk-python"}`

## Method
```bash
NOVADA_API_KEY="1f35b477c9e1802778ec64aee2a6adfa"

START=$(python3 -c "import time; print(int(time.time()*1000))")
node -e "
const {novadaScrape} = require('/Users/tongwu/.npm/_npx/eb1018bc9d026439/node_modules/novada-search/build/tools/scrape.js');
novadaScrape({platform:'PLATFORM',operation:'OPERATION',params:PARAMS,format:'json',limit:1}, '$NOVADA_API_KEY')
  .then(r => { console.log('OK', r.length); process.exit(0); })
  .catch(e => { console.log('ERR', e.message.substring(0,100)); process.exit(1); });
" 2>/dev/null
END=$(python3 -c "import time; print(int(time.time()*1000))")
echo "Time: $((END-START))ms"
```

## Output Format
```
| Platform | Round 1 | Round 2 | Round 3 | Avg | Status |
```

## Also measure
- Submit latency alone (time from call to task_id returned)
- Poll count (how many 2s intervals before result)
- Download latency (time to fetch completed result)

## Comparison Data
- Oxylabs Amazon: 2,260ms (sync)
- Novada Amazon (prior): 23,398ms (async)
- Novada GitHub (prior): 23,398ms
