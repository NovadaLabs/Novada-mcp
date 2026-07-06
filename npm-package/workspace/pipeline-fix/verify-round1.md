# Verification Round 1 — NOVADA_API_KEY Isolation

**Date:** 2026-06-25
**Result: PASS (4/4)**

## Test Conditions

- `NOVADA_API_KEY` set to provided value
- `NOVADA_BROWSER_WS` explicitly unset
- `NOVADA_WEB_UNBLOCKER_KEY` explicitly unset
- `NOVADA_PROXY_USER` / `NOVADA_PROXY_PASS` explicitly unset

## Results

| # | Check | Status | Latency |
|---|-------|--------|---------|
| 1 | `novada_extract` — static (example.com) | PASS | 92ms |
| 2 | Web Unblocker key resolves to `NOVADA_API_KEY` (no separate key) | PASS | — |
| 3 | Browser API auto-provisions WS URL from API key | PASS | — |
| 4 | `novada_search` — google query | PASS | 2275ms |

## Key Findings

- `novada_extract` returns valid markdown (>500 chars) with only `NOVADA_API_KEY`.
- `getWebUnblockerKey()` returns `NOVADA_API_KEY` as fallback — `NOVADA_WEB_UNBLOCKER_KEY` is optional override only.
- `resolveBrowserWs()` auto-provisions a WS URL (`wss://...@upg-scbr2.novada.com`) from the API key — `NOVADA_BROWSER_WS` is optional pre-set only.
- `novada_search` returns structured markdown results with only `NOVADA_API_KEY`.

## Confirmed: ONE API KEY covers

- Search (`novada_search`, `novada_research`)
- Extract (`novada_extract`, `novada_unblock`)
- Web Unblocker (via API key fallback)
- Browser API (auto-provisioned WS URL)
- Scraper API
- Crawl/Map

## Exception

`NOVADA_PROXY_ENDPOINT` (proxy hostname) is still required for proxy tools (`novada_proxy_*`). This is the proxy network endpoint, not a credential — it's a routing address. All proxy credentials (user/pass) are auto-fetched from the API key.
