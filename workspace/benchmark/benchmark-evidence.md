# MCP Web Scraping Benchmark — Test Evidence
Generated: 2026-05-22T07:55:42.126Z
Rounds per task per competitor: 10 measured + 1 warmup
Total measurements: 300

## Competitors Tested
- Novada (webunlocker.novada.com + scraper.novada.com)
- BrightData (api.brightdata.com/request) — NO PROXY ZONES CONFIGURED
- Firecrawl (api.firecrawl.dev)
- Tavily (api.tavily.com)
- Oxylabs (realtime.oxylabs.io/v1/queries)

## Summary Table

| Task | Description | Novada | Firecrawl | Tavily | Oxylabs |
|------|-------------|--------|-----------|--------|---------|
| T1 | Static Scrape — news.ycombinator.com | 4.4s ✓ 10/10 | 474.5ms ✓ 10/10 | 130ms ✓ 10/10 | 8.9s ✓ 10/10 |
| T2 | JS-Heavy Scrape — linear.app | 7.6s ✓ 10/10 | 579.5ms ✓ 10/10 | 128ms ✓ 10/10 | 16.3s ✓ 10/10 |
| T3 | Search — Financial (bitcoin price 2025) | 1.8s ✓ 10/10 | N/A | 115.5ms ✓ 10/10 | 9.7s ✓ 10/10 |
| T4 | Search — AI (agent memory system AI) | 2.0s ✓ 10/10 | N/A | 124ms ✓ 10/10 | 11.2s ✓ 10/10 |
| T5 | Crawl — docs.python.org/3 (3 pages) | 29.5s ✓ 9/10 | 3.9s ✓ 1/10 | N/A | N/A |
| T6 | Amazon Structured Data — AirPods Pro 2 (B0BDHWDR12) | 8.5s ✓ 10/10 | N/A | N/A | 5.3s ✓ 10/10 |

## Raw Round-by-Round Data

### NOVADA

#### T1 — Static Scrape — news.ycombinator.com
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 4429 | 5 | 3 |  |
| R2 | ✅ ok | 5135 | 5 | 3 |  |
| R3 | ✅ ok | 9596 | 5 | 3 |  |
| R4 | ✅ ok | 4229 | 5 | 3 |  |
| R5 | ✅ ok | 4219 | 5 | 3 |  |
| R6 | ✅ ok | 4459 | 5 | 3 |  |
| R7 | ✅ ok | 4860 | 5 | 3 |  |
| R8 | ✅ ok | 4365 | 5 | 3 |  |
| R9 | ✅ ok | 4277 | 5 | 3 |  |
| R10 | ✅ ok | 4105 | 5 | 3 |  |
| **Summary** | **10/10** | **4.4s median** | | | |

#### T2 — JS-Heavy Scrape — linear.app
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 8015 | 5 | 3 |  |
| R2 | ✅ ok | 6222 | 5 | 3 |  |
| R3 | ✅ ok | 9830 | 5 | 3 |  |
| R4 | ✅ ok | 7348 | 5 | 3 |  |
| R5 | ✅ ok | 7282 | 5 | 3 |  |
| R6 | ✅ ok | 7786 | 5 | 3 |  |
| R7 | ✅ ok | 6522 | 5 | 3 |  |
| R8 | ✅ ok | 7342 | 5 | 3 |  |
| R9 | ✅ ok | 27813 | 5 | 3 |  |
| R10 | ✅ ok | 9450 | 5 | 3 |  |
| **Summary** | **10/10** | **7.6s median** | | | |

#### T3 — Search — Financial (bitcoin price 2025)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 1863 | 5 | 4 |  |
| R2 | ✅ ok | 1530 | 5 | 4 |  |
| R3 | ✅ ok | 1474 | 5 | 4 |  |
| R4 | ✅ ok | 2403 | 5 | 4 |  |
| R5 | ✅ ok | 2984 | 5 | 4 |  |
| R6 | ✅ ok | 1753 | 5 | 4 |  |
| R7 | ✅ ok | 2585 | 5 | 4 |  |
| R8 | ✅ ok | 1518 | 5 | 4 |  |
| R9 | ✅ ok | 3571 | 5 | 4 |  |
| R10 | ✅ ok | 1495 | 5 | 4 |  |
| **Summary** | **10/10** | **1.9s median** | | | |

#### T4 — Search — AI (agent memory system AI)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 1807 | 4 | 4 |  |
| R2 | ✅ ok | 2118 | 4 | 4 |  |
| R3 | ✅ ok | 1614 | 4 | 4 |  |
| R4 | ✅ ok | 2413 | 4 | 4 |  |
| R5 | ✅ ok | 1611 | 4 | 4 |  |
| R6 | ✅ ok | 3183 | 4 | 4 |  |
| R7 | ✅ ok | 1808 | 4 | 4 |  |
| R8 | ✅ ok | 1556 | 4 | 4 |  |
| R9 | ✅ ok | 6618 | 4 | 4 |  |
| R10 | ✅ ok | 3033 | 4 | 4 |  |
| **Summary** | **10/10** | **2.1s median** | | | |

#### T5 — Crawl — docs.python.org/3 (3 pages)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 40236 | 5 | 3 |  |
| R2 | ✅ ok | 20049 | 5 | 3 |  |
| R3 | ✅ ok | 40677 | 5 | 3 |  |
| R4 | ✅ ok | 43593 | 5 | 3 |  |
| R5 | ✅ ok | 29538 | 5 | 3 |  |
| R6 | ❌ timeout | - | 0 | 0 | TIMEOUT |
| R7 | ✅ ok | 43000 | 5 | 3 |  |
| R8 | ✅ ok | 22488 | 5 | 3 |  |
| R9 | ✅ ok | 21033 | 5 | 3 |  |
| R10 | ✅ ok | 23778 | 5 | 3 |  |
| **Summary** | **9/10** | **29.5s median** | | | |

#### T6 — Amazon Structured Data — AirPods Pro 2 (B0BDHWDR12)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 9336 | 4 | 4 |  |
| R2 | ✅ ok | 7410 | 4 | 4 |  |
| R3 | ✅ ok | 5881 | 4 | 4 |  |
| R4 | ✅ ok | 6866 | 4 | 4 |  |
| R5 | ✅ ok | 8761 | 4 | 4 |  |
| R6 | ✅ ok | 8294 | 4 | 4 |  |
| R7 | ✅ ok | 39013 | 4 | 4 |  |
| R8 | ✅ ok | 10324 | 4 | 4 |  |
| R9 | ✅ ok | 12471 | 4 | 4 |  |
| R10 | ✅ ok | 6720 | 4 | 4 |  |
| **Summary** | **10/10** | **8.5s median** | | | |

### BRIGHTDATA

#### T1 — Static Scrape — news.ycombinator.com
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ❌ error | 152 | 1 | 1 | Request failed with status code 400 |
| R2 | ❌ error | 138 | 1 | 1 | Request failed with status code 400 |
| R3 | ❌ error | 119 | 1 | 1 | Request failed with status code 400 |
| R4 | ❌ error | 112 | 1 | 1 | Request failed with status code 400 |
| R5 | ❌ error | 114 | 1 | 1 | Request failed with status code 400 |
| R6 | ❌ error | 306 | 1 | 1 | Request failed with status code 400 |
| R7 | ❌ error | 105 | 1 | 1 | Request failed with status code 400 |
| R8 | ❌ error | 120 | 1 | 1 | Request failed with status code 400 |
| R9 | ❌ error | 120 | 1 | 1 | Request failed with status code 400 |
| R10 | ❌ error | 126 | 1 | 1 | Request failed with status code 400 |
| **Summary** | **0/10** | **—** | | | |

#### T2 — JS-Heavy Scrape — linear.app
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ❌ error | 115 | 1 | 1 | Request failed with status code 400 |
| R2 | ❌ error | 109 | 1 | 1 | Request failed with status code 400 |
| R3 | ❌ error | 118 | 1 | 1 | Request failed with status code 400 |
| R4 | ❌ error | 135 | 1 | 1 | Request failed with status code 400 |
| R5 | ❌ error | 128 | 1 | 1 | Request failed with status code 400 |
| R6 | ❌ error | 115 | 1 | 1 | Request failed with status code 400 |
| R7 | ❌ error | 106 | 1 | 1 | Request failed with status code 400 |
| R8 | ❌ error | 108 | 1 | 1 | Request failed with status code 400 |
| R9 | ❌ error | 183 | 1 | 1 | Request failed with status code 400 |
| R10 | ❌ error | 139 | 1 | 1 | Request failed with status code 400 |
| **Summary** | **0/10** | **—** | | | |

#### T3 — Search — Financial (bitcoin price 2025)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ❌ error | 167 | 1 | 1 | Request failed with status code 400 |
| R2 | ❌ error | 143 | 1 | 1 | Request failed with status code 400 |
| R3 | ❌ error | 107 | 1 | 1 | Request failed with status code 400 |
| R4 | ❌ error | 109 | 1 | 1 | Request failed with status code 400 |
| R5 | ❌ error | 109 | 1 | 1 | Request failed with status code 400 |
| R6 | ❌ error | 172 | 1 | 1 | Request failed with status code 400 |
| R7 | ❌ error | 136 | 1 | 1 | Request failed with status code 400 |
| R8 | ❌ error | 118 | 1 | 1 | Request failed with status code 400 |
| R9 | ❌ error | 116 | 1 | 1 | Request failed with status code 400 |
| R10 | ❌ error | 111 | 1 | 1 | Request failed with status code 400 |
| **Summary** | **0/10** | **—** | | | |

#### T4 — Search — AI (agent memory system AI)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ❌ error | 119 | 1 | 1 | Request failed with status code 400 |
| R2 | ❌ error | 103 | 1 | 1 | Request failed with status code 400 |
| R3 | ❌ error | 116 | 1 | 1 | Request failed with status code 400 |
| R4 | ❌ error | 101 | 1 | 1 | Request failed with status code 400 |
| R5 | ❌ error | 176 | 1 | 1 | Request failed with status code 400 |
| R6 | ❌ error | 141 | 1 | 1 | Request failed with status code 400 |
| R7 | ❌ error | 115 | 1 | 1 | Request failed with status code 400 |
| R8 | ❌ error | 117 | 1 | 1 | Request failed with status code 400 |
| R9 | ❌ error | 118 | 1 | 1 | Request failed with status code 400 |
| R10 | ❌ error | 153 | 1 | 1 | Request failed with status code 400 |
| **Summary** | **0/10** | **—** | | | |

#### T5 — Crawl — docs.python.org/3 (3 pages)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R2 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R3 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R4 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R5 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R6 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R7 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R8 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R9 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R10 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| **Summary** | **0/10** | **—** | | | |

#### T6 — Amazon Structured Data — AirPods Pro 2 (B0BDHWDR12)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R2 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R3 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R4 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R5 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R6 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R7 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R8 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R9 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R10 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| **Summary** | **0/10** | **—** | | | |

### FIRECRAWL

#### T1 — Static Scrape — news.ycombinator.com
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 523 | 5 | 4 |  |
| R2 | ✅ ok | 650 | 5 | 4 |  |
| R3 | ✅ ok | 443 | 5 | 4 |  |
| R4 | ✅ ok | 447 | 5 | 4 |  |
| R5 | ✅ ok | 455 | 5 | 4 |  |
| R6 | ✅ ok | 503 | 5 | 4 |  |
| R7 | ✅ ok | 494 | 5 | 4 |  |
| R8 | ✅ ok | 419 | 5 | 4 |  |
| R9 | ✅ ok | 547 | 5 | 4 |  |
| R10 | ✅ ok | 439 | 5 | 4 |  |
| **Summary** | **10/10** | **0.5s median** | | | |

#### T2 — JS-Heavy Scrape — linear.app
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 607 | 5 | 4 |  |
| R2 | ✅ ok | 591 | 5 | 4 |  |
| R3 | ✅ ok | 587 | 5 | 4 |  |
| R4 | ✅ ok | 552 | 5 | 4 |  |
| R5 | ✅ ok | 584 | 5 | 4 |  |
| R6 | ✅ ok | 575 | 5 | 4 |  |
| R7 | ✅ ok | 568 | 5 | 4 |  |
| R8 | ✅ ok | 465 | 5 | 4 |  |
| R9 | ✅ ok | 567 | 5 | 4 |  |
| R10 | ✅ ok | 7386 | 5 | 4 |  |
| **Summary** | **10/10** | **0.6s median** | | | |

#### T3 — Search — Financial (bitcoin price 2025)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R2 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R3 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R4 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R5 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R6 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R7 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R8 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R9 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R10 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| **Summary** | **0/10** | **—** | | | |

#### T4 — Search — AI (agent memory system AI)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R2 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R3 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R4 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R5 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R6 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R7 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R8 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R9 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R10 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| **Summary** | **0/10** | **—** | | | |

#### T5 — Crawl — docs.python.org/3 (3 pages)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 3876 | 5 | 4 |  |
| R2 | ❌ error | 108 | 1 | 1 | Request failed with status code 429 |
| R3 | ❌ error | 108 | 1 | 1 | Request failed with status code 429 |
| R4 | ❌ error | 108 | 1 | 1 | Request failed with status code 429 |
| R5 | ❌ error | 173 | 1 | 1 | Request failed with status code 429 |
| R6 | ❌ error | 136 | 1 | 1 | Request failed with status code 429 |
| R7 | ❌ error | 111 | 1 | 1 | Request failed with status code 429 |
| R8 | ❌ error | 113 | 1 | 1 | Request failed with status code 429 |
| R9 | ❌ error | 113 | 1 | 1 | Request failed with status code 429 |
| R10 | ❌ error | 164 | 1 | 1 | Request failed with status code 429 |
| **Summary** | **1/10** | **3.9s median** | | | |

#### T6 — Amazon Structured Data — AirPods Pro 2 (B0BDHWDR12)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R2 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R3 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R4 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R5 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R6 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R7 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R8 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R9 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R10 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| **Summary** | **0/10** | **—** | | | |

### TAVILY

#### T1 — Static Scrape — news.ycombinator.com
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 140 | 5 | 3 |  |
| R2 | ✅ ok | 123 | 5 | 3 |  |
| R3 | ✅ ok | 127 | 5 | 3 |  |
| R4 | ✅ ok | 202 | 5 | 3 |  |
| R5 | ✅ ok | 144 | 5 | 3 |  |
| R6 | ✅ ok | 120 | 5 | 3 |  |
| R7 | ✅ ok | 118 | 5 | 3 |  |
| R8 | ✅ ok | 121 | 5 | 3 |  |
| R9 | ✅ ok | 133 | 5 | 3 |  |
| R10 | ✅ ok | 136 | 5 | 3 |  |
| **Summary** | **10/10** | **0.1s median** | | | |

#### T2 — JS-Heavy Scrape — linear.app
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 128 | 5 | 3 |  |
| R2 | ✅ ok | 171 | 5 | 3 |  |
| R3 | ✅ ok | 144 | 5 | 3 |  |
| R4 | ✅ ok | 122 | 5 | 3 |  |
| R5 | ✅ ok | 128 | 5 | 3 |  |
| R6 | ✅ ok | 125 | 5 | 3 |  |
| R7 | ✅ ok | 121 | 5 | 3 |  |
| R8 | ✅ ok | 144 | 5 | 3 |  |
| R9 | ✅ ok | 119 | 5 | 3 |  |
| R10 | ✅ ok | 135 | 5 | 3 |  |
| **Summary** | **10/10** | **0.1s median** | | | |

#### T3 — Search — Financial (bitcoin price 2025)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 114 | 5 | 3 |  |
| R2 | ✅ ok | 114 | 5 | 3 |  |
| R3 | ✅ ok | 109 | 5 | 3 |  |
| R4 | ✅ ok | 130 | 5 | 3 |  |
| R5 | ✅ ok | 133 | 5 | 3 |  |
| R6 | ✅ ok | 111 | 5 | 3 |  |
| R7 | ✅ ok | 117 | 5 | 3 |  |
| R8 | ✅ ok | 110 | 5 | 3 |  |
| R9 | ✅ ok | 168 | 5 | 3 |  |
| R10 | ✅ ok | 137 | 5 | 3 |  |
| **Summary** | **10/10** | **0.1s median** | | | |

#### T4 — Search — AI (agent memory system AI)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 115 | 5 | 3 |  |
| R2 | ✅ ok | 148 | 5 | 3 |  |
| R3 | ✅ ok | 128 | 5 | 3 |  |
| R4 | ✅ ok | 124 | 5 | 3 |  |
| R5 | ✅ ok | 114 | 5 | 3 |  |
| R6 | ✅ ok | 116 | 5 | 3 |  |
| R7 | ✅ ok | 154 | 5 | 3 |  |
| R8 | ✅ ok | 136 | 5 | 3 |  |
| R9 | ✅ ok | 110 | 5 | 3 |  |
| R10 | ✅ ok | 124 | 5 | 3 |  |
| **Summary** | **10/10** | **0.1s median** | | | |

#### T5 — Crawl — docs.python.org/3 (3 pages)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R2 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R3 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R4 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R5 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R6 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R7 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R8 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R9 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R10 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| **Summary** | **0/10** | **—** | | | |

#### T6 — Amazon Structured Data — AirPods Pro 2 (B0BDHWDR12)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R2 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R3 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R4 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R5 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R6 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R7 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R8 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R9 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| R10 | ❌ na | 0 | 0 | 0 | Not supported by this competitor |
| **Summary** | **0/10** | **—** | | | |

### OXYLABS

#### T1 — Static Scrape — news.ycombinator.com
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 6939 | 5 | 2 |  |
| R2 | ✅ ok | 9153 | 5 | 2 |  |
| R3 | ✅ ok | 7459 | 5 | 2 |  |
| R4 | ✅ ok | 7459 | 5 | 2 |  |
| R5 | ✅ ok | 8891 | 5 | 2 |  |
| R6 | ✅ ok | 10283 | 5 | 2 |  |
| R7 | ✅ ok | 12265 | 5 | 2 |  |
| R8 | ✅ ok | 7447 | 5 | 2 |  |
| R9 | ✅ ok | 8999 | 5 | 2 |  |
| R10 | ✅ ok | 13019 | 5 | 2 |  |
| **Summary** | **10/10** | **9.0s median** | | | |

#### T2 — JS-Heavy Scrape — linear.app
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 15978 | 5 | 2 |  |
| R2 | ✅ ok | 15978 | 5 | 2 |  |
| R3 | ✅ ok | 45089 | 5 | 2 |  |
| R4 | ✅ ok | 16683 | 5 | 2 |  |
| R5 | ✅ ok | 17828 | 5 | 2 |  |
| R6 | ✅ ok | 16670 | 5 | 2 |  |
| R7 | ✅ ok | 46444 | 5 | 2 |  |
| R8 | ✅ ok | 12712 | 5 | 2 |  |
| R9 | ✅ ok | 11605 | 5 | 2 |  |
| R10 | ✅ ok | 11372 | 5 | 2 |  |
| **Summary** | **10/10** | **16.7s median** | | | |

#### T3 — Search — Financial (bitcoin price 2025)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 8683 | 1 | 2 |  |
| R2 | ✅ ok | 6241 | 1 | 2 |  |
| R3 | ✅ ok | 10764 | 1 | 2 |  |
| R4 | ✅ ok | 7429 | 1 | 2 |  |
| R5 | ✅ ok | 13854 | 1 | 2 |  |
| R6 | ✅ ok | 6694 | 1 | 2 |  |
| R7 | ✅ ok | 6841 | 1 | 2 |  |
| R8 | ✅ ok | 11772 | 1 | 2 |  |
| R9 | ✅ ok | 12842 | 1 | 2 |  |
| R10 | ✅ ok | 10632 | 1 | 2 |  |
| **Summary** | **10/10** | **9.7s median** | | | |

#### T4 — Search — AI (agent memory system AI)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 7376 | 1 | 2 |  |
| R2 | ✅ ok | 12959 | 1 | 2 |  |
| R3 | ✅ ok | 13989 | 1 | 2 |  |
| R4 | ✅ ok | 7626 | 1 | 2 |  |
| R5 | ✅ ok | 16376 | 1 | 2 |  |
| R6 | ✅ ok | 9535 | 1 | 2 |  |
| R7 | ✅ ok | 23806 | 1 | 2 |  |
| R8 | ✅ ok | 15407 | 1 | 2 |  |
| R9 | ✅ ok | 8351 | 1 | 2 |  |
| R10 | ✅ ok | 6891 | 1 | 2 |  |
| **Summary** | **10/10** | **11.2s median** | | | |

#### T5 — Crawl — docs.python.org/3 (3 pages)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ❌ na | - | 0 | 0 | Not supported by this competitor |
| R2 | ❌ na | - | 0 | 0 | Not supported by this competitor |
| R3 | ❌ na | - | 0 | 0 | Not supported by this competitor |
| R4 | ❌ na | - | 0 | 0 | Not supported by this competitor |
| R5 | ❌ na | - | 0 | 0 | Not supported by this competitor |
| R6 | ❌ na | - | 0 | 0 | Not supported by this competitor |
| R7 | ❌ na | - | 0 | 0 | Not supported by this competitor |
| R8 | ❌ na | - | 0 | 0 | Not supported by this competitor |
| R9 | ❌ na | - | 0 | 0 | Not supported by this competitor |
| R10 | ❌ na | - | 0 | 0 | Not supported by this competitor |
| **Summary** | **0/10** | **—** | | | |

#### T6 — Amazon Structured Data — AirPods Pro 2 (B0BDHWDR12)
| Round | Status | Latency (ms) | Quality | AF Score | Notes |
|-------|--------|-------------|---------|----------|-------|
| R1 | ✅ ok | 5426 | 4 | 3 |  |
| R2 | ✅ ok | 5534 | 4 | 3 |  |
| R3 | ✅ ok | 4323 | 4 | 3 |  |
| R4 | ✅ ok | 6495 | 4 | 3 |  |
| R5 | ✅ ok | 2898 | 4 | 3 |  |
| R6 | ✅ ok | 4868 | 4 | 3 |  |
| R7 | ✅ ok | 2911 | 4 | 3 |  |
| R8 | ✅ ok | 9781 | 4 | 3 |  |
| R9 | ✅ ok | 5081 | 4 | 3 |  |
| R10 | ✅ ok | 11657 | 4 | 3 |  |
| **Summary** | **10/10** | **5.4s median** | | | |

## Metadata
- Test date: 2026-05-22
- Novada API key: 1f35b477...adfa (last 4)
- Novada Unblocker key: b27ad6e6...5e (last 2)
- Oxylabs user: berryclare__KAZhJ
- Firecrawl key: fc-a897ec...35
- Tavily key: tvly-dev-3CVPRi...
- BrightData: no proxy zones configured (T1-T4 failed), token 8a649e44...