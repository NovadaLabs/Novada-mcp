# Benchmark: Proxy Latency

## Objective
Measure residential proxy latency across 3 regions, 3 rounds each. Test both connection time and total request time.

## Credentials
```
USER=<NOVADA_PROXY_USER_REDACTED>
PASS=<NOVADA_PROXY_PASS_REDACTED>
```

## Test Endpoints (3 regions)
1. US West: `<NOVADA_PROXY_HOST_REDACTED>:7777`
2. Europe: `<NOVADA_PROXY_HOST_REDACTED>:7777`
3. Asia: `<NOVADA_PROXY_HOST_REDACTED>:7777`

## Method
For each region, 3 rounds:
```bash
curl -s --max-time 15 -w "connect:%{time_connect} ttfb:%{time_starttransfer} total:%{time_total}\n" \
  -x "http://<NOVADA_PROXY_USER_REDACTED>-zone-res-country-us:<NOVADA_PROXY_PASS_REDACTED>@ENDPOINT:7777" \
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
