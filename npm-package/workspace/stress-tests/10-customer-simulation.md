# Stress Test 10: New Customer Simulation

**Date:** 2026-06-25
**Persona:** AI developer building a research assistant
**API Key:** `1f35...adfa`
**Goal:** Simulate a complete zero-to-value journey through core tools

---

## Results Summary

| Step | Tool | Result | Latency | Output Size |
|------|------|--------|---------|-------------|
| 1. Setup check | `novadaSetup` | PASS (sync) | <1ms | 1,355 ch |
| 2. First search | `novadaSearch` | PASS | 2,115ms | 2,309 ch |
| 3. Extract result | `novadaExtract` | PASS | 17,317ms | 14,721 ch |
| 4. Research report | `novadaResearch` | PASS | 61,892ms | 6,839 ch |
| 5. Saved files | filesystem | PASS | <1ms | 81 folders |

**Score: 5/5 (all steps functional)**
**Verdict: Customer would continue using**

---

## Step-by-Step Details

### Step 1: Setup Check

`novadaSetup({})` returns a synchronous string (not a Promise). The original simulation script called `.catch()` on it, causing a `TypeError: novadaSetup(...).catch is not a function`. This is a **test script bug**, not a product bug.

When called correctly:
- Shows masked API key: `1f35...adfa`
- Reports "Status: Ready. Core tools are active."
- Lists optional tools not configured (browser, proxy)
- Clean, readable output with check/cross marks

**Finding:** The function signature differs from other tools (sync vs async). This is intentional since setup does no network I/O, but agents calling it generically with `.catch()` will hit this. Not a real customer issue since MCP dispatch handles it.

### Step 2: First Search

Query: `"how to build AI research assistant"`
- Engine: Google, 5 results requested
- Returned markdown with `##` headers and URLs
- 2,309 characters of structured results
- Latency: 2.1s (good for a search)

Extracted URL from results: `https://community.make.com/t/how-to-build-your-own-ai-research-assistant-quick-guide/55928`

### Step 3: Extract First Result

- URL: community.make.com guide page
- Format: markdown, render: auto
- 14,721 characters extracted
- Latency: 17.3s (auto-escalated from static to JS render)

Content was substantial and well-structured. No errors.

### Step 4: Research Report

Query: `"best tools for building AI research assistant 2026"`
- Depth: quick (3 parallel searches)
- 6,839 characters of synthesized report
- Latency: 61.9s (expected for multi-query + extract pipeline)

The research tool is the slowest step (by design - it runs multiple searches and extracts). 62s is acceptable for a "quick" depth report.

### Step 5: File Persistence

Output directory: `~/Downloads/novada-mcp/2026-06-25/`
- 81 folders found (accumulated from previous test runs)
- Today's extractions saved correctly
- Folder naming follows domain-based convention

---

## Customer Journey Assessment

### What works well
1. **Search is fast and useful** - 2s to get structured results with URLs
2. **Extract delivers real content** - 14K chars of clean markdown from a random URL
3. **Research is the differentiator** - One call produces a multi-source synthesized report
4. **File persistence works** - Outputs saved to predictable local paths
5. **Setup is clear** - Shows exactly what's configured and what's optional

### Potential friction points
1. **Extract latency (17s)** - Auto-escalation from static to JS render adds time. Customer might think it's stuck. Consider progress indication in MCP description.
2. **Research latency (62s)** - Acceptable but long. The "quick" depth label sets expectations correctly.
3. **81 folders accumulated** - No cleanup mechanism. Long-term users will accumulate hundreds of folders in `~/Downloads/novada-mcp/`. Consider TTL or size cap.

### Customer value proposition confirmed
An AI developer can go from zero to:
- Running a web search (2s)
- Extracting full page content (17s)
- Getting a synthesized research report (62s)

All with a single API key, no additional configuration needed. The setup check clearly shows what's active and what's optional. The journey from "I have an API key" to "I have a research report" takes under 90 seconds total.

---

## Bugs Found

| ID | Severity | Description |
|----|----------|-------------|
| SIM-1 | LOW | `novadaSetup` is sync but other tools are async. Generic `.catch()` wrapping fails. Not a real customer issue (MCP handles dispatch). |

## Recommendations

1. **No blocking issues** - The core journey works end-to-end
2. **Consider output directory cleanup** - 81 folders from test runs, no TTL
3. **Extract auto-escalation could log** - "Trying static... escalating to JS render" would help debug slow extractions
