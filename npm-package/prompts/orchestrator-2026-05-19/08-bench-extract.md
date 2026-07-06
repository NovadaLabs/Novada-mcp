# Benchmark: novada_extract Latency

## Objective
Measure real end-to-end latency of novada_extract across 5 different sites, 3 rounds each. Compare with raw API call latency to measure MCP overhead.

## Test Sites
1. https://example.com — trivial static (baseline)
2. https://httpbin.org/html — simple HTML
3. https://news.ycombinator.com — real static site with content
4. https://www.wikipedia.org — medium complexity
5. https://www.reddit.com/r/artificial — JS-heavy SPA

## Method
For each site, run 3 rounds:
```bash
NOVADA_API_KEY="<NOVADA_API_KEY_REDACTED>"
NOVADA_WEB_UNBLOCKER_KEY="<NOVADA_API_KEY_REDACTED>"

# MCP tool call (measures full pipeline)
START=$(python3 -c "import time; print(int(time.time()*1000))")
node -e "
const {novadaExtract} = require('/Users/tongwu/.npm/_npx/eb1018bc9d026439/node_modules/novada-search/build/tools/extract.js');
novadaExtract({url:'URL_HERE',format:'markdown',render:'auto'}, '$NOVADA_API_KEY')
  .then(r => { console.log('OK', r.length); process.exit(0); })
  .catch(e => { console.log('ERR', e.message.substring(0,100)); process.exit(1); });
" 2>/dev/null
END=$(python3 -c "import time; print(int(time.time()*1000))")
echo "Time: $((END-START))ms"
```

## Output Format
```
| Site | Round 1 | Round 2 | Round 3 | Avg | Status |
```

## Comparison Data (from prior tests)
- Oxylabs static: 3,110ms
- Oxylabs render: 42,680ms
- Novada extract (example.com, prior): 1,067ms
