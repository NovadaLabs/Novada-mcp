# Round 2 Test Prompts — After Restart
# Run these IN ORDER after restarting Claude Code
# Each prompt is a separate message to send

---

## BLOCK 1: Proxy Tools (were broken, should work now)

### Test 1: Residential proxy credentials
```
Use novada_proxy_residential with format="env" — show me the proxy credentials
```

### Test 2: ISP proxy
```
Use novada_proxy_isp with format="curl" — show me the curl flag
```

### Test 3: Datacenter proxy
```
Use novada_proxy_datacenter with format="url" — just the URL
```

### Test 4: Mobile proxy (US)
```
Use novada_proxy_mobile with country="us" and format="env"
```

### Test 5: Static ISP proxy
```
Use novada_proxy_static with country="us", session_id="test-001", format="curl"
```

### Test 6: Dedicated datacenter proxy
```
Use novada_proxy_dedicated with session_id="test-001", format="url"
```

---

## BLOCK 2: Core Tools (should already work)

### Test 7: Health check
```
Run novada_health — show me status of all env vars and tools
```

### Test 8: Web extraction
```
Use novada_extract to get the content of https://httpbin.org/get
```

### Test 9: Web Unblocker
```
Use novada_unblock on https://example.com — method should be "render"
```

### Test 10: URL map
```
Use novada_map on https://docs.anthropic.com — limit 10 URLs
```

### Test 11: Crawl
```
Use novada_crawl on https://httpbin.org — max_pages=3
```

---

## BLOCK 3: Scraper API (test live)

### Test 12: Amazon product search
```
Use novada_scrape with platform="amazon.com", operation="amazon_product_keywords", params={"keywords": "iPhone case"}
```

### Test 13: LinkedIn jobs
```
Use novada_scrape with platform="linkedin.com", operation="linkedin_job_listings", params={"keywords": "AI engineer", "location": "San Francisco"}
```

---

## BLOCK 4: SERP Tools (expect backend 500 — verify error message quality)

### Test 14: Google search
```
Use novada_search to search for "claude mcp tools 2025" — up to 5 results
```
Expected: structured error with agent_instruction (SERP backend down)

### Test 15: Research
```
Use novada_research to research "what is model context protocol"
```
Expected: structured error or partial fallback

---

## BLOCK 5: Browser API

### Test 16: Browser automation
```
Use novada_browser to navigate to https://example.com and take a snapshot — return the page title
```

### Test 17: Full health check
```
Run novada_health_all — full connectivity check on all services
```

---

## PASS CRITERIA

| Test | Expected |
|------|----------|
| 1-6 (proxy) | Returns real credentials, not "not configured" |
| 7 (health) | All env vars show as configured |
| 8-11 (core) | Returns content, no errors |
| 12-13 (scraper) | Returns structured data OR error with task_id |
| 14-15 (SERP) | Returns structured error with agent_instruction (backend down is expected) |
| 16 (browser) | Returns page snapshot |
| 17 (health_all) | Shows which services are up/down |

**Stop condition:** If tests 1-6 still show "not configured" → restart Claude Code again (MCP process still stale)
