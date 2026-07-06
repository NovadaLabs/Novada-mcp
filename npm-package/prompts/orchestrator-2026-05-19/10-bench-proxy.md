# Benchmark: Proxy Latency

## Objective
Measure residential proxy latency across 3 regions, 3 rounds each. Test both connection time and total request time.

## Credentials
```
USER=tongwu_TRDI7X
PASS=_Asd1644asd_
```

## Test Endpoints (3 regions)
1. US West: `1b9b0a2b9011e022.vtv.na.novada.pro:7777`
2. Europe: `1b9b0a2b9011e022.qzc.eu.novada.pro:7777`
3. Asia: `1b9b0a2b9011e022.lwy.as.novada.pro:7777`

## Method
For each region, 3 rounds:
```bash
curl -s --max-time 15 -w "connect:%{time_connect} ttfb:%{time_starttransfer} total:%{time_total}\n" \
  -x "http://tongwu_TRDI7X-zone-res-country-us:_Asd1644asd_@ENDPOINT:7777" \
  "https://httpbin.org/ip" -o /dev/null
```

Also test with different target sites:
- httpbin.org/ip (minimal)
- example.com (static)
- amazon.com (real e-commerce, anti-bot)

## Output Format
```
| Region | Target | Connect | TTFB | Total | IP Returned |
```
