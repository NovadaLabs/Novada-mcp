# 09 - Full Workflow: End-to-End with Project Folder

**Date:** 2026-06-26
**Test:** Complete research pipeline (Search -> Extract -> Research) with `project` parameter grouping all outputs.

## Scenario

Simulate a competitive analysis workflow where an agent:
1. Searches for "web scraping API market share 2026"
2. Extracts the top search result
3. Runs a quick research report comparing scraping API pricing

All three calls use `project: "competitive-analysis"` to group outputs into a single folder.

## Results

| Step     | Tool           | Latency   | Output Size | Status |
|----------|----------------|-----------|-------------|--------|
| Search   | novadaSearch   | 2,353 ms  | 2,749 ch    | PASS   |
| Extract  | novadaExtract  | 495 ms    | 43,450 ch   | PASS   |
| Research | novadaResearch | 15,896 ms | 7,287 ch    | PASS   |

**Total wall time:** ~18.7 seconds (dominated by research which runs 3 parallel sub-searches + extractions).

## Project Folder Output

```
~/Downloads/novada-mcp/2026-06-26/competitive-analysis/
  web-scraping-API-market/
    2026-06-26_203737810_web-scraping-API.json        # search results
  mordorintelligence-com/
    2026-06-26_203738306_mordorintelligence-com.md     # extracted page
  compare-web-scraping-APIs/
    2026-06-26_203754202_compare-web-scraping.md       # research report
```

- **Folders:** 3 (one per tool invocation)
- **Files:** 3
- **All outputs grouped under the `competitive-analysis` project subfolder.**

## Observations

1. **Project grouping works correctly.** All three tools wrote their output into the same `competitive-analysis/` subfolder under the date directory. An agent can point users to a single folder containing all artifacts from a research session.

2. **Search -> Extract chaining is fast.** The search returned URLs in ~2.4s and the extract grabbed the first result in under 500ms (static/auto mode, cache likely warm from the search's own fetch).

3. **Research is the bottleneck.** At ~16s for `depth: "quick"`, the research tool dominates total latency. This is expected -- it runs 3 parallel searches, deduplicates, then extracts top sources before synthesizing.

4. **Output sizes are reasonable.** Search returns a compact 2.7K result set, extract delivers a full 43K page, and research synthesizes down to a 7.3K report. No truncation issues.

5. **No errors across the pipeline.** All three calls completed without fallback or retry, indicating the Scraper API was healthy during the test window.

## Verdict

**PASS** -- The end-to-end workflow (search, extract, research) completes reliably with project folder grouping. All outputs land in a single navigable directory structure, making it easy for agents or users to find all artifacts from a research session.
