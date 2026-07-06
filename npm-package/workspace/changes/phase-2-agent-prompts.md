# Phase 2 — Sub-agent Prompts
> Saved: 2026-05-22 | Dispatched in parallel

## Agent A — JSON mode for novada_search + novada_crawl

### Role
Worker agent implementing `format: "json"` output mode for two MCP tools.

### Scope
- Add `format` param to `SearchParamsSchema` and `CrawlParamsSchema` in `src/tools/types.ts`
- Add JSON output branch to `src/tools/search.ts` (before markdown output)
- Add JSON output branch to `src/tools/crawl.ts` (before markdown output)
- DO NOT modify extract.ts (already has JSON mode), scrape.ts, or errors.ts

### SOP
```pseudocode
FOR EACH tool IN [search, crawl]:
  1. READ types.ts → find the tool's ParamsSchema
  2. ADD format: z.enum(["markdown", "json"]).default("markdown")
     .describe("Output format. 'markdown': human-readable (default). 'json': structured object for programmatic agent use.")
  3. READ tool.ts → find the final output formatting section
  4. ADD early-return JSON branch BEFORE the existing markdown formatting
  5. JSON output MUST include all fields from the markdown format:
     - search: status, query, engine, result_count, source, results[], agent_instruction
     - crawl: status, root_url, pages_crawled, source, strategy, total_words, pages[], agent_instruction
  6. RUN npm run build → fix any TypeScript errors
  7. VERIFY: the JSON output includes the same information as the markdown output
```

### Search JSON schema
```json
{
  "status": "ok",
  "query": "...",
  "engine": "google (via scraper-api)",
  "source": "live",
  "result_count": 8,
  "results": [
    {
      "rank": 1,
      "title": "...",
      "url": "...",
      "snippet": "...",
      "published": "2026-05-20",
      "extracted_content": "..." // only if extract_options or enrich_top
    }
  ],
  "agent_instruction": "Search complete. Call novada_extract with results[0].url to read the full page."
}
```

### Crawl JSON schema
```json
{
  "status": "ok",
  "root_url": "https://docs.python.org/3",
  "pages_crawled": 5,
  "strategy": "bfs",
  "source": "live",
  "total_words": 12340,
  "failed": 0,
  "pages": [
    {
      "url": "...",
      "title": "...",
      "depth": 1,
      "word_count": 423,
      "js_content_missing": false,
      "text": "..."
    }
  ],
  "agent_instruction": "Crawl complete. 5 pages extracted. To read a specific page use novada_extract."
}
```

### Input files
- `/Users/tongwu/Projects/novada-mcp/src/tools/types.ts` (SearchParamsSchema ~line 38, CrawlParamsSchema — grep for it)
- `/Users/tongwu/Projects/novada-mcp/src/tools/search.ts` (~line 418-468: output formatting)
- `/Users/tongwu/Projects/novada-mcp/src/tools/crawl.ts` (~line 221-270: output formatting)

### Output
Modified files that pass `npm run build`.

---

## Agent D — `remember:` hints for all tools

### Role
Worker agent adding memory-compatible output hints to all MCP tool success responses.

### Scope
- Add `## Agent Memory` section with `remember:` line to success responses in:
  - `src/tools/search.ts`
  - `src/tools/crawl.ts`
  - `src/tools/extract.ts` (both JSON and markdown)
  - `src/tools/scrape.ts`
- DO NOT modify errors.ts, types.ts, or any other files

### SOP
```pseudocode
FOR EACH tool:
  1. READ the output section
  2. ADD a `## Agent Memory` section after `## Chainable Output` (or after `## Agent Hints` if no Chainable Output)
  3. Generate one `remember:` line with the single most valuable storable fact
  4. Template per tool:
     - search: "remember: Top result for '{query}': {title} — {url}"
     - crawl: "remember: {root_url} — {N} pages crawled, {total_words} words total"
     - extract: "remember: {title} at {url} — {quality_label} quality, {content_length} chars"
     - scrape: "remember: {platform}/{operation} — {N} records retrieved"
  5. For JSON mode (extract.ts only): add `remember` field to the JSON object
  6. RUN npm run build → fix any TypeScript errors
```

### Key constraint
- The `remember:` value must be a single concise fact (under 120 chars)
- It must include the URL or query so the memory has a pointer to its source
- It must include a quantitative signal (count, score, price) when available

### Input files
- `/Users/tongwu/Projects/novada-mcp/src/tools/search.ts`
- `/Users/tongwu/Projects/novada-mcp/src/tools/crawl.ts`
- `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts`
- `/Users/tongwu/Projects/novada-mcp/src/tools/scrape.ts`

### Output
Modified files that pass `npm run build`.
