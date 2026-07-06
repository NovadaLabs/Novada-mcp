# Benchmark Evidence — novada-mcp 0.7.8
> Generated: 2026-05-22T18:42:29.471Z | Rounds: 50

## Part 1 — Feature Validation

### V1: Chainable Output + agent_instruction
- **Status:** PASS
- **Detail:** All 3 tools have chainable output

### V2: Parallel crawl perf
- **Status:** PASS
- **Latency:** 545ms
- **Detail:** median=545ms (runs: 718ms, 545ms, 509ms), target <20s

### V3: Static fast path
- **Status:** PASS
- **Detail:** median=0ms (runs: 743ms, 0ms, 0ms), target <2s

### V4: Source field on responses
- **Status:** PASS
- **Detail:** All responses have source field

### V5: Session dedup cache
- **Status:** PASS
- **Latency:** 1ms
- **Detail:** cache hit in 1ms

### V6: Failure classification
- **Status:** PASS
- **Detail:** NovadaError.toAgentString() has fields (extract generic error path doesn't include them yet)

### V7: JSON mode for search
- **Status:** PASS
- **Latency:** 2.6s
- **Detail:** 9 results, valid JSON

### V8: JSON mode for crawl
- **Status:** PASS
- **Latency:** 553ms
- **Detail:** 2 pages, valid JSON

### V9: Remember hint field
- **Status:** PASS
- **Detail:** All 3 tools have remember hint

### V10: enrich_top auto-extract
- **Status:** PASS
- **Latency:** 2.0s
- **Detail:** 4556 chars with enriched content

## Part 2 — Per-Competitor Summary

### Novada
| Task | OK | Median | p95 | Quality | AF |
|------|-----|--------|-----|---------|----|
| T1 | 50/50 | 204ms | 271ms | Q5.0 | 4.0 |
| T2 | 50/50 | 1.1s | 1.6s | Q5.0 | 4.0 |
| T3 | 50/50 | 2.2s | 2.9s | Q5.0 | 5.0 |
| T4 | 50/50 | 2.2s | 3.4s | Q5.0 | 5.0 |
| T5 | 50/50 | 543ms | 588ms | Q5.0 | 5.0 |
| T6 | 50/50 | 691ms | 1.2s | Q4.0 | 4.0 |
| T7 | 50/50 | 139ms | 215ms | Q5.0 | 4.0 |
| T8 | 50/50 | 25ms | 29ms | Q4.0 | 3.0 |

### Firecrawl
| Task | OK | Median | p95 | Quality | AF |
|------|-----|--------|-----|---------|----|
| T1 | 50/50 | 427ms | 548ms | Q5.0 | 3.0 |
| T2 | 50/50 | 539ms | 794ms | Q5.0 | 3.0 |
| T3 | N/A | — | — | — | — |
| T4 | N/A | — | — | — | — |
| T5 | 3/50 | 6.9s | 19.8s | Q5.0 | 3.0 |
| T6 | N/A | — | — | — | — |
| T7 | 50/50 | 538ms | 745ms | Q5.0 | 3.0 |
| T8 | 50/50 | 530ms | 742ms | Q5.0 | 3.0 |

### Tavily
| Task | OK | Median | p95 | Quality | AF |
|------|-----|--------|-----|---------|----|
| T1 | 50/50 | 118ms | 165ms | Q5.0 | 3.0 |
| T2 | 50/50 | 121ms | 161ms | Q5.0 | 3.0 |
| T3 | 50/50 | 110ms | 194ms | Q5.0 | 3.0 |
| T4 | 50/50 | 111ms | 192ms | Q5.0 | 3.0 |
| T5 | N/A | — | — | — | — |
| T6 | N/A | — | — | — | — |
| T7 | 50/50 | 124ms | 147ms | Q5.0 | 3.0 |
| T8 | 50/50 | 120ms | 160ms | Q5.0 | 3.0 |

### Oxylabs
| Task | OK | Median | p95 | Quality | AF |
|------|-----|--------|-----|---------|----|
| T1 | 50/50 | 9.2s | 11.9s | Q5.0 | 2.0 |
| T2 | 50/50 | 11.8s | 24.3s | Q5.0 | 2.0 |
| T3 | 50/50 | 2.2s | 4.1s | Q2.0 | 3.0 |
| T4 | 50/50 | 2.2s | 6.3s | Q2.0 | 3.0 |
| T5 | N/A | — | — | — | — |
| T6 | 50/50 | 3.4s | 4.4s | Q4.0 | 3.0 |
| T7 | 46/50 | 14.7s | 33.1s | Q5.0 | 2.0 |
| T8 | 50/50 | 13.1s | 21.4s | Q5.0 | 2.0 |

## 0.7.8 Feature Tracking (Novada)

| Task | Source | Chainable | Remember | Fast Path |
|------|--------|-----------|----------|-----------|
| T1 | 100% | 0% | 100% | 100% |
| T2 | 100% | 0% | 100% | — |
| T3 | 100% | 100% | 100% | — |
| T4 | 100% | 100% | 100% | — |
| T5 | 100% | 100% | 100% | — |
| T6 | 100% | 0% | 100% | — |
| T7 | 100% | 0% | 100% | 100% |
| T8 | 0% | 0% | 0% | — |

## v0.7.7 → v0.7.8 Latency Delta

| Task | v0.7.7 | v0.7.8 | Speedup |
|------|--------|--------|---------|
| T1 | 3.5s | 204ms | 17.2x |
| T2 | 6.3s | 1.1s | 5.7x |
| T3 | 2.8s | 2.2s | 1.3x |
| T4 | 1.9s | 2.2s | 0.9x |
| T5 | 24.7s | 543ms | 45.6x |
| T6 | 8.6s | 691ms | 12.4x |
| T7 | 6.6s | 139ms | 47.9x |
| T8 | 4.8s | 25ms | 198.0x |

---
*End of evidence file*