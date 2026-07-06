# Test 03 — Competitor Pricing Monitor
Date: 2026-06-26
Scenario: Extract pricing data from 3 proxy competitors and save to disk (A=URL → B=pricing data on disk)

---

## Results Summary

| # | Competitor | Status | Latency | Content Size | Prices Found |
|---|-----------|--------|---------|--------------|-------------|
| 1 | brightdata.com | PASS | 560ms | 28,972 chars | YES |
| 2 | oxylabs.io | PASS | 325ms | 12,073 chars | YES |
| 3 | smartproxy.com | PASS | 795ms | 37,978 chars | YES |

All 3 extractions succeeded. All 3 returned live pricing data.

---

## Saved Files (B — data on disk)

Tool auto-saved timestamped markdown files under `~/Downloads/novada-mcp/`:

- `brightdata-com` → `/Users/tongwu/Downloads/novada-mcp/2026-06-26/brightdata-com/2026-06-26_145354_brightdata-com.md`
- `oxylabs-io` → `/Users/tongwu/Downloads/novada-mcp/2026-06-26/oxylabs-io/2026-06-26_145355_oxylabs-io.md`
- `smartproxy-com` → `/Users/tongwu/Downloads/novada-mcp/2026-06-26/smartproxy-com/2026-06-26_145357_smartproxy-com.md`

---

## Extracted Pricing Data

### Bright Data (brightdata.com/pricing)

| Product | Price |
|---------|-------|
| Unlocker API | from $1/1K req (free tier) |
| Crawl API | from $1/1K req |
| SERP API | from $1/1K req (free tier) |
| Browser API | from $5/GB |
| Scraper APIs | from $0.75/1K rec (was $1, free tier) |
| Scraper Studio | from $1/1K req (free tier) |
| Datasets | from $250/100K rec |
| Data Firehose | from $0.2/1K HTML |
| Retail Insights | from $250/mo |
| Managed Data Acquisition | from $1,500/mo |
| Residential Proxies | from $2.5/GB (50% OFF, was $5) |
| Datacenter Proxies | from $0.9/IP |
| ISP Proxies | from $1.3/IP |

Notable: Active 50% OFF promo on residential proxies at time of extraction.

### Oxylabs (oxylabs.io/pricing)

| Product | Price |
|---------|-------|
| Residential Proxies | $2.5/GB |
| Datacenter Proxies | $0.7/IP |
| ISP Proxies | $1.2/IP |
| Static Residential | $1.2/IP |
| Mobile Proxies | $2.5/IP |
| Web Scraper API | $3.5/GB |
| SERP Scraper | $0.25/1K results |
| E-commerce Scraper | $4.7/GB |
| Entry plan | $5 |
| Scraping Robot | $3/GB |

### Smartproxy / Decodo (smartproxy.com/pricing)

| Product | Price |
|---------|-------|
| Residential Proxies | from $2/GB |
| Static Residential (ISP) | from $0.27/IP |
| Mobile Proxies | from $2.25/GB |
| Datacenter Proxies | from $0.02/IP |
| Site Unblocker | from $0.95/1K req |
| Web Scraping API | from $0.09/1K req (new) |

Notable: Datacenter at $0.02/IP is notably aggressive. Web Scraping API labeled "New" at launch.

---

## A→B Flow Assessment

- A (URL) → extract tool → parsed pricing data + structured fields: WORKING
- Auto-save to `~/Downloads/novada-mcp/{date}/{host}/` with timestamps: WORKING
- `fields:['price','plan','GB','monthly']` param triggered structured extraction alongside markdown: WORKING
- `render:'auto'` handled all 3 sites correctly without requiring JS escalation (560ms, 325ms, 795ms — all fast)

---

## Issues / Observations

None blocking. One note:

- Bright Data content (28,972 chars) is nearly 3x Oxylabs (12,073 chars). The BD page is dense — nav + product list + pricing links. The `fields` param helped surface the actual numbers despite noise.
- Oxylabs returned the cleanest pricing table — prices appeared as direct `$X.X/unit` strings without surrounding prose.
- Smartproxy/Decodo uses different branding on pricing page (Decodo) — tool still extracted correctly.

---

## Verdict

Scenario PASS. `novadaExtract` with `render:'auto'` and `fields` param is production-ready for competitor pricing monitoring. Data landed on disk with timestamps suitable for diff-based change detection on repeated runs.
