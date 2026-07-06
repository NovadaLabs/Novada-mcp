# novada-mcp v2.0 Revamp Design Spec

**Date:** 2026-04-13  
**Author:** Agent (tongwu session)  
**Status:** APPROVED FOR IMPLEMENTATION  
**Scope:** Approach B — Agent-Native Redesign

---

## 1. Why We're Doing This

### Root Cause Analysis (from live testing)

Testing both novada-mcp and tavily-mcp via MCP stdio protocol revealed five categories of problems:

| Category | Symptom | Impact |
|----------|---------|--------|
| **Schema breakage** | `inputSchema: {}` on all 5 tools | Agent sees no parameters → wrong arguments → silent failures |
| **Response artifacts** | "Read more" text in search snippets | Agent parses pagination UI text as content |
| **Missing parameters** | No time filtering, no domain filtering, single-URL extract | Agent needs N tool calls where 1 would suffice |
| **Weak crawl control** | No NL instructions, no path filtering | Agents can't target crawls; get irrelevant pages |
| **Zero MCP primitives** | No Prompts, no Resources | LobeHub F score; agents can't discover capabilities |

### The schema bug is also why LobeHub shows 0 skills

LobeHub scans `tools/list` response. When `inputSchema: {}`, the tool has no detectable parameters, so LobeHub cannot identify it as a "Skill". This single bug causes the F/POOR rating.

**Root cause of empty schema:** `zod-to-json-schema@3.x` does not support Zod v4. The package returns `{}` for all schemas. Zod v4 introduced `.toJSONSchema()` as a native method — this works correctly.

### Comparison: novada vs tavily

Where novada wins:
- 5 search engines vs tavily's 1
- 195-country geo-targeting with real proxy infrastructure
- Anti-bot bypass via 100M+ IP residential proxies
- `nova` CLI (no equivalent in tavily)

Where tavily wins as an agent tool (our targets):
- Complete inputSchemas with descriptions for every param
- Batch URL extraction (array input)
- `search_depth` quality tiers (fast/basic/advanced)
- Time range + date filtering on search
- `include_domains` / `exclude_domains` filtering
- Crawl with natural-language `instructions` parameter
- Crawl with `select_paths` regex filtering
- Research with `mini/pro/auto` depth model
- Include raw content inline in search results

---

## 2. Goals

1. **Fix all P0 bugs** so the server works correctly as an agent tool
2. **Match tavily's parameter richness** where it serves agent workflows
3. **Add MCP Prompts + Resources** for ecosystem quality
4. **Reach LobeHub A-PREMIUM** (score ≥ 80/100)
5. **Keep novada's unique advantages** — do not simplify away geo-targeting, multi-engine, proxy infrastructure

---

## 3. What Does NOT Change

- Core tool names: `novada_search`, `novada_extract`, `novada_crawl`, `novada_map`, `novada_research`
- Authentication: `NOVADA_API_KEY` env var
- Transport: stdio (no HTTP/SSE in this sprint — that is v3 scope)
- URL safety validation (keep BLOCKED_HOSTS)
- Retry/error classification logic in `classifyError`
- `nova` CLI entry point and command names

---

## 4. Architecture Overview

```
src/
├── index.ts          ← MCP server: fix zodToMcpSchema, add Prompts/Resources handlers
├── cli.ts            ← add new flags: --depth, --from/--to, --include, --exclude
├── config.ts         ← no changes
├── tools/
│   ├── types.ts      ← expand all Zod schemas with new params
│   ├── search.ts     ← strip artifacts, add time/domain/depth params
│   ├── extract.ts    ← add batch URL support (string | string[])
│   ├── crawl.ts      ← add instructions + select_paths params
│   ├── map.ts        ← add SPA detection warning
│   ├── research.ts   ← add auto depth tier
│   └── index.ts      ← no changes
├── prompts/          ← NEW: MCP Prompts definitions
│   └── index.ts
└── resources/        ← NEW: MCP Resources definitions
    └── index.ts
```

---

## 5. Phase 0 — Critical Bug Fixes

**Target:** Day 1 | **Files:** `src/index.ts`, `src/tools/search.ts`, `src/tools/map.ts`

### 0.1 Fix Empty inputSchema (BLOCKER for LobeHub + agent usability)

**File:** `src/index.ts`

**Current code (broken):**
```typescript
function zodToMcpSchema(schema: any): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema, { target: "openApi3" });
  const { $schema, ...rest } = jsonSchema as Record<string, unknown>;
  return rest;
}
```

**Replace with:**
```typescript
function zodToMcpSchema(schema: any): Record<string, unknown> {
  // Zod v4 has native JSON Schema generation — use it instead of zod-to-json-schema
  // which only supports Zod v3.
  const jsonSchema = schema.toJSONSchema();
  // Strip $schema and $defs (MCP clients don't need meta-schema declarations)
  const { $schema, $defs, ...rest } = jsonSchema as Record<string, unknown>;
  return rest;
}
```

**Then remove the import** at the top of `src/index.ts`:
```typescript
// REMOVE THIS LINE:
import { zodToJsonSchema } from "zod-to-json-schema";
```

**Also remove from `package.json` dependencies:**
```json
// REMOVE: "zod-to-json-schema": "^3.25.2"
```

**Validation:** After rebuild, run:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | NOVADA_API_KEY=test node build/index.js 2>/dev/null | python3 -m json.tool
```
Verify: `inputSchema` for each tool is non-empty and contains `properties`.

---

### 0.2 Strip "Read more" Artifacts from Search Snippets

**File:** `src/tools/search.ts`

**Why:** Web scraping returns pagination link text ("Read more", "…Read more") from Google/Bing result snippets. This is presentation-layer text that agents should never see.

**Find line ~60:**
```typescript
return `${i + 1}. **${r.title || "Untitled"}**\n   URL: ${url}\n   ${r.description || r.snippet || "No description"}`;
```

**Replace with:**
```typescript
const rawSnippet = r.description || r.snippet || "";
const cleanSnippet = rawSnippet
  .replace(/\.{3}\s*Read\s+more\s*$/i, "...")
  .replace(/\s+Read\s+more\s*$/i, "")
  .replace(/\s+More\s*$/i, "")
  .trim() || "No description";
return `${i + 1}. **${r.title || "Untitled"}**\n   URL: ${url}\n   ${cleanSnippet}`;
```

---

### 0.3 Fix CLI --max-pages Flag Mismatch

**File:** `src/cli.ts`

**Why:** CLI help shows `--pages 5` but the MCP tool param is `max_pages`. The CLI correctly reads `flags.pages`, so `nova crawl --max-pages 3` silently falls back to the default. CLI and MCP parameter names should align.

**Current CLI help text (line ~18):**
```
nova crawl <url> [--pages 5] [--strategy bfs|dfs]
```

**Add `--max-pages` as an alias in the crawl case:**
```typescript
case "crawl":
  result = await novadaCrawl(
    validateCrawlParams({
      url: positional,
      max_pages: flags["max-pages"]
        ? parseInt(flags["max-pages"])
        : flags.pages
          ? parseInt(flags.pages)
          : 5,
      strategy: (flags.strategy as "bfs" | "dfs") || "bfs",
    }),
    API_KEY
  );
  break;
```

**Update help text** to show both flags:
```
nova crawl <url> [--max-pages 5] [--strategy bfs|dfs]
```

---

### 0.4 SPA Detection Warning in Map

**File:** `src/tools/map.ts`

**Why:** When `nova map https://some-spa.com` returns 0 or 1 URL (only root), the agent has no idea why and may retry or use wrong fallback. We should detect this and guide the agent.

**Find the return statement at the end of the function where URLs are formatted.**

**Add this check BEFORE returning the formatted list:**
```typescript
const urls = /* existing URL list */;

// SPA detection: if we only found the root URL (or zero URLs) with no filter applied,
// the site is likely a client-side rendered SPA that loads content via JavaScript.
// Proxy-fetched HTML won't contain the links that JavaScript would render.
if (urls.length <= 1 && !params.search) {
  const hint = urls.length === 0
    ? `No URLs found on ${params.url}.\n\n⚠ This site may be a JavaScript SPA (single-page app). Static crawling cannot discover JS-rendered links.\n→ Try: novada_extract on ${params.url} for the page content directly.`
    : `Only 1 URL found: ${urls[0]}\n\n⚠ This site may be a JavaScript SPA. Only the root URL was discoverable via static crawling.\n→ Try: novada_extract on ${params.url} for full page content, or novada_crawl with max_pages=3 which may follow JS-loaded links.`;
  return hint;
}
```

---

## 6. Phase 1 — Schema & Parameter Expansion

**Target:** Day 2-3 | **Files:** `src/tools/types.ts`, `src/tools/search.ts`, `src/tools/extract.ts`, `src/tools/crawl.ts`, `src/tools/research.ts`, `src/cli.ts`

### 1.1 Search: Add Time Filtering

**Why:** Agents doing news monitoring, fact-checking recent events, or tracking current prices need to filter by recency. Without this, an agent searching "GPT-5 release" gets outdated results mixed with recent news. This is one of the most common agent search use cases.

**File:** `src/tools/types.ts` — update `SearchParamsSchema`:
```typescript
export const SearchParamsSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  engine: z.enum(["google", "bing", "duckduckgo", "yahoo", "yandex"]).default("google"),
  num: z.number().int().min(1).max(20).default(10),
  country: z.string().default(""),
  language: z.string().default(""),
  // NEW: Time range filtering
  time_range: z.enum(["day", "week", "month", "year"]).optional()
    .describe("Limit results to a time window. 'day' = last 24h, 'week' = last 7 days, etc."),
  start_date: z.string().optional()
    .describe("ISO date string YYYY-MM-DD. Return results published after this date."),
  end_date: z.string().optional()
    .describe("ISO date string YYYY-MM-DD. Return results published before this date."),
  // NEW: Domain filtering
  include_domains: z.array(z.string()).optional()
    .describe("Only return results from these domains. E.g. ['github.com', 'arxiv.org']"),
  exclude_domains: z.array(z.string()).optional()
    .describe("Exclude results from these domains. E.g. ['reddit.com', 'quora.com']"),
});
```

**File:** `src/tools/search.ts` — pass new params to API:
```typescript
// In rawParams construction, add after existing fields:
if (params.time_range) rawParams.time_range = params.time_range;
if (params.start_date) rawParams.start_date = params.start_date;
if (params.end_date) rawParams.end_date = params.end_date;
if (params.include_domains?.length) rawParams.include_domains = params.include_domains.join(",");
if (params.exclude_domains?.length) rawParams.exclude_domains = params.exclude_domains.join(",");
```

**Note:** Verify with the Novada API team which parameter names the backend accepts for time filtering. If backend doesn't support it yet, add a TODO comment and return the params in the metadata header so agents know the filter was requested but couldn't be applied.

**Update meta header in search.ts** to show active filters:
```typescript
const filters = [
  params.country && `country:${params.country}`,
  params.time_range && `time:${params.time_range}`,
  params.include_domains?.length && `only:${params.include_domains.join(",")}`,
  params.exclude_domains?.length && `exclude:${params.exclude_domains.join(",")}`,
].filter(Boolean).join(" | ");

const meta = `[Results: ${results.length} | Engine: ${engine}${filters ? ` | ${filters}` : ""} | Via: Novada proxy]`;
```

---

### 1.2 Extract: Add Batch URL Support

**Why:** The most common agent workflow is: search → get 5 URLs → extract all 5. Currently this requires 5 sequential tool calls. Batch support reduces this to 1 call with parallel execution.

**File:** `src/tools/types.ts` — update `ExtractParamsSchema`:
```typescript
// The safeUrl validator stays the same.
// Change url from single to union:
export const ExtractParamsSchema = z.object({
  url: z.union([
    safeUrl,
    z.array(safeUrl).min(1).max(10)
  ]).describe("URL or array of URLs to extract. Max 10 URLs per batch."),
  format: z.enum(["text", "markdown", "html"]).default("markdown"),
  // NEW: Query-based relevance reranking
  query: z.string().optional()
    .describe("If provided, extracted content chunks are relevance-ranked to this query. Useful when extracting long pages for RAG."),
});

// Update inferred type:
export type ExtractParams = z.infer<typeof ExtractParamsSchema>;
```

**File:** `src/tools/extract.ts` — handle array input:
```typescript
export async function novadaExtract(params: ExtractParams, apiKey?: string): Promise<string> {
  // Handle batch URLs
  if (Array.isArray(params.url)) {
    const results = await Promise.all(
      params.url.map(url => novadaExtract({ ...params, url }, apiKey).catch(err =>
        `[FAILED: ${url}]\nError: ${err.message}`
      ))
    );
    return results.join("\n\n---\n\n");
  }
  
  // Single URL: existing logic...
}
```

**File:** `src/cli.ts` — the CLI uses positional arg for URL, so batch is MCP-only. No CLI changes needed for batch. Document this in the help text.

---

### 1.3 Crawl: Add Natural Language Instructions

**Why:** Tavily's `instructions` parameter is the most powerful crawl feature for agents. Instead of writing regex patterns, the agent says "only return pages about authentication" or "skip blog posts, focus on API reference". This dramatically reduces irrelevant pages in crawl output and saves tokens.

**File:** `src/tools/types.ts` — update `CrawlParamsSchema`:
```typescript
export const CrawlParamsSchema = z.object({
  url: safeUrl,
  max_pages: z.number().int().min(1).max(20).default(5),
  strategy: z.enum(["bfs", "dfs"]).default("bfs"),
  // NEW:
  instructions: z.string().optional()
    .describe("Natural language guide for which pages to include. E.g. 'only API reference pages', 'skip blog and changelog'. Applied as a post-filter on discovered pages."),
  select_paths: z.array(z.string()).optional()
    .describe("Regex patterns to restrict which URL paths to crawl. E.g. ['/docs/.*', '/api/.*']. Applied as a pre-filter before fetching."),
  exclude_paths: z.array(z.string()).optional()
    .describe("Regex patterns for URL paths to skip. E.g. ['/blog/.*', '/changelog/.*']."),
});
```

**File:** `src/tools/crawl.ts` — apply path filters before fetching, instructions as post-filter:

For `select_paths` and `exclude_paths`: apply during the queue population step when adding discovered links:
```typescript
// In the link-following logic, before adding to queue:
const shouldCrawl = (url: string): boolean => {
  const path = new URL(url).pathname;
  if (params.select_paths?.length) {
    const matches = params.select_paths.some(pattern => new RegExp(pattern).test(path));
    if (!matches) return false;
  }
  if (params.exclude_paths?.length) {
    const excluded = params.exclude_paths.some(pattern => new RegExp(pattern).test(path));
    if (excluded) return false;
  }
  return true;
};
```

For `instructions`: after collecting all pages, add a note in the response:
```typescript
// At the top of the crawl response, include instructions context:
if (params.instructions) {
  // Pass instructions to the response header so the calling agent can apply them
  // as a content filter. The MCP server itself does keyword matching as a heuristic.
  const keyword = params.instructions.toLowerCase();
  // Simple keyword filter: if a page's title/content doesn't mention any keyword
  // from instructions, flag it as potentially off-topic
  // Full LLM-based filtering is out of scope for this server (that's the agent's job)
  header += `\nInstructions applied: "${params.instructions}" (path filters applied; content filtering is agent-side)`;
}
```

**Note:** Full LLM-based page filtering is intentionally out of scope for the MCP server — that would make the server stateful and slow. The agent calls the tool and then filters using its own reasoning. The server handles path-level filtering (fast, deterministic) and the agent handles semantic filtering.

---

### 1.4 Research: Add Auto Depth + Comprehensive Tier

**Why:** "quick" (3 searches) is often too shallow; "deep" (5-6 searches) is overkill for simple questions. Adding `auto` lets agents delegate depth selection. Adding `comprehensive` (8-10 searches) handles competitive analysis cases.

**File:** `src/tools/types.ts` — update `ResearchParamsSchema`:
```typescript
export const ResearchParamsSchema = z.object({
  question: z.string().min(5),
  depth: z.enum(["quick", "deep", "auto", "comprehensive"]).default("auto")
    .describe("quick=3 searches, deep=5-6 searches, comprehensive=8-10 searches, auto=server decides based on question complexity"),
  // NEW: Focus area (helps generate better sub-queries)
  focus: z.string().optional()
    .describe("Optional context to focus research. E.g. 'technical implementation', 'business impact', 'recent news only'"),
});
```

**File:** `src/tools/research.ts` — implement auto tier:
```typescript
// Determine actual depth from 'auto' mode:
function resolveDepth(depth: string, question: string): "quick" | "deep" {
  if (depth === "auto") {
    // Heuristic: complex questions (longer, with comparisons/analysis/why) → deep
    const isComplex = question.length > 80
      || /\b(compare|versus|vs|why|how does|best|worst|difference between|trade-off)\b/i.test(question);
    return isComplex ? "deep" : "quick";
  }
  if (depth === "comprehensive") return "deep"; // Maps to backend deep + more queries
  return depth as "quick" | "deep";
}
```

---

### 1.5 Map: Add Depth Control

**Why:** By default, map does BFS at depth 1. For large documentation sites, agents need to go deeper.

**File:** `src/tools/types.ts` — update `MapParamsSchema`:
```typescript
export const MapParamsSchema = z.object({
  url: safeUrl,
  search: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  include_subdomains: z.boolean().default(false),
  // NEW:
  max_depth: z.number().int().min(1).max(5).default(2)
    .describe("How many link-hops from the root URL to follow. Default 2. Higher values find more pages but are slower."),
});
```

---

## 7. Phase 2 — Response Structure Redesign

**Target:** Day 4-5 | **Files:** all `src/tools/*.ts`

**Design principle:** Responses must be machine-parseable by agents with no ambiguity, while remaining readable by humans for debugging. Use structured markdown (not raw JSON) with:
- A metadata line at the top (parseable key:value pairs on one line)
- Clean separator `---`
- Content section
- Optional `## Agent Hints` section at the bottom

### 7.1 Search Response Format

**Current (broken):**
```
[Results: 4 | Engine: google | Via: Novada proxy]

1. **Title**
   URL: https://...
   Description...Read more
```

**New format:**
```
## Search Results
results:4 | engine:google | country:us | time_range:week

---

### 1. Title
url: https://...
snippet: Clean description with no pagination artifacts.
published: 2025-03-15  (only if available from API)

### 2. Title
url: https://...
snippet: ...

---
## Agent Hints
- To read any result in full, call novada_extract with its url
- To batch-extract all results: novada_extract with url=[url1, url2, ...]
- For deeper research on this topic: novada_research
```

**Why this format:**
- `results:4` on a single line is parseable with a simple regex
- Each result's `url:` on its own line means agent can extract all URLs with `grep "^url: "` equivalent
- `## Agent Hints` section is the key innovation — the server itself suggests the next tool call. Agent no longer needs to guess what to do with results.

### 7.2 Extract Response Format

**Current:**
```
[Extracted: URL | Format: markdown | Content: 8000 chars | Links: 50 | Via: Novada proxy]
# Title
> description
## Content
...
## Links (50)
```

**New format (single URL):**
```
## Extracted Content
url: https://...
title: Page Title
description: Meta description text
format: markdown | chars:8000 | links:50

---

<actual content here>

---
## Discovered Links (top 15, filtered to same-domain)
- https://...
- https://...

## Agent Hints
- Links above are same-domain. For off-domain links, check the full list.
- If content seems truncated, try novada_map on the domain to find specific subpages.
```

**For batch extract (array of URLs):**
```
## Batch Extract Results
urls:3 | successful:3 | failed:0

---

### [1/3] https://example.com/page1
title: ...
chars: 2400

<content>

---

### [2/3] https://example.com/page2
title: ...
chars: 1800

<content>

---
## Agent Hints
- Successfully extracted 3/3 URLs
```

**Key change on Links:** Currently extract returns ALL 50 links including external, navigation links, footer links. New behavior: return top 15 same-domain content links only. This reduces token waste. If agent needs all links, they can use novada_map.

### 7.3 Map Response Format

**Current:**
```
# Site Map: https://...
URLs discovered: 20

## URLs
1. https://...
```

**New format:**
```
## Site Map
root: https://...
urls:20 | depth:2 | filtered:0

---

1. https://...
2. https://...
...

---
## Agent Hints
- Use novada_extract to read any of these pages
- Use novada_crawl to extract content from multiple pages at once
- Use 'search' parameter to filter: novada_map with search="pricing"
```

### 7.4 Crawl Response Format

**Current:**
```
# Crawl Results for URL
Pages crawled: 5/5 | Strategy: bfs | Total words: 1186

## Title
**URL:** url | **Depth:** 0 | **Words:** 344
<content>
```

**New format:**
```
## Crawl Results
root: https://...
pages:5 | strategy:bfs | total_words:1186 | failed:0

---

### [1/5] https://...
title: Page Title
depth:0 | words:344

<content>

---

### [2/5] https://...
...

---
## Agent Hints
- 5 pages crawled. For more coverage, increase max_pages or use novada_map first to select specific pages.
```

### 7.5 Research Response Format

The current research format is actually the best of the five — it already has structured sections. Main change: add Agent Hints and clean up the "For deeper analysis" footer.

**Keep:** `## Search Queries Used`, `## Key Findings`, `## Sources`  
**Add at top:**
```
## Research Report
question: "..."
depth:deep | searches:6 | results:23 | unique_sources:15

---
```

**Replace hardcoded footer** `*Research conducted via Novada API...` **with:**
```
---
## Agent Hints
- N sources found. Extract the most relevant with: novada_extract with url=[url1, url2]
- For narrower research: novada_research with focus="specific aspect"
- For primary source verification: novada_extract on any source URL above
```

---

## 8. Phase 3 — MCP Primitives

**Target:** Day 6-7 | **New files:** `src/prompts/index.ts`, `src/resources/index.ts`

### 8.1 MCP Prompts

MCP Prompts are pre-defined interaction templates shown in client UIs (LobeHub, Claude Desktop). They solve two problems: (1) LobeHub Prompts criterion, (2) giving agents reusable workflow patterns.

**File:** `src/prompts/index.ts`

```typescript
import type { GetPromptResult, ListPromptsResult } from "@modelcontextprotocol/sdk/types.js";

export const PROMPTS = [
  {
    name: "research_topic",
    description: "Deep research on any topic with optional country and focus constraints",
    arguments: [
      { name: "topic", description: "What to research", required: true },
      { name: "country", description: "Country context, e.g. 'us', 'de', 'cn'", required: false },
      { name: "focus", description: "Focus area, e.g. 'technical', 'market', 'news'", required: false },
    ],
  },
  {
    name: "extract_and_summarize",
    description: "Extract content from one or more URLs and prepare it for analysis",
    arguments: [
      { name: "urls", description: "URL or comma-separated list of URLs", required: true },
      { name: "focus", description: "What to focus on in the extracted content", required: false },
    ],
  },
  {
    name: "site_audit",
    description: "Discover all pages on a website, then extract key sections",
    arguments: [
      { name: "url", description: "Root URL of the site to audit", required: true },
      { name: "sections", description: "Which sections to focus on, e.g. 'pricing, docs, api'", required: false },
    ],
  },
];

export function listPrompts(): ListPromptsResult {
  return { prompts: PROMPTS };
}

export function getPrompt(name: string, args: Record<string, string>): GetPromptResult {
  switch (name) {
    case "research_topic":
      return {
        description: `Research: ${args.topic}`,
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: [
              `Please research the following topic thoroughly: "${args.topic}"`,
              args.country ? `Focus on information relevant to ${args.country}.` : "",
              args.focus ? `Specifically focus on: ${args.focus}.` : "",
              "",
              "Use novada_research with depth='deep' to get comprehensive coverage.",
              "Then use novada_extract on the most relevant sources for full details.",
            ].filter(Boolean).join("\n"),
          },
        }],
      };

    case "extract_and_summarize":
      return {
        description: `Extract: ${args.urls}`,
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: [
              `Please extract and analyze content from the following URL(s): ${args.urls}`,
              args.focus ? `Focus specifically on: ${args.focus}` : "",
              "",
              "Use novada_extract with the URL(s) above. If multiple URLs, pass them as an array.",
              "After extracting, summarize the key information.",
            ].filter(Boolean).join("\n"),
          },
        }],
      };

    case "site_audit":
      return {
        description: `Audit: ${args.url}`,
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: [
              `Please audit the website at ${args.url}.`,
              args.sections ? `Pay special attention to these sections: ${args.sections}` : "",
              "",
              "Step 1: Use novada_map to discover all pages on the site.",
              "Step 2: Identify the most important pages (pricing, docs, API, about).",
              "Step 3: Use novada_extract on the key pages to get their full content.",
              "Step 4: Summarize what you found: structure, key content, any gaps.",
            ].filter(Boolean).join("\n"),
          },
        }],
      };

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
```

**File:** `src/index.ts` — register Prompts handlers:
```typescript
import { listPrompts, getPrompt } from "./prompts/index.js";
import { ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// In constructor capabilities:
{ capabilities: { tools: {}, prompts: {} } }

// In setupHandlers():
this.server.setRequestHandler(ListPromptsRequestSchema, async () => listPrompts());
this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return getPrompt(name, args || {});
});
```

---

### 8.2 MCP Resources

MCP Resources are read-only data that agents can access before making decisions. This reduces hallucination ("does novada support yandex?") and gives LobeHub the Resources criterion.

**File:** `src/resources/index.ts`

```typescript
import type { ListResourcesResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

export const RESOURCES = [
  {
    uri: "novada://engines",
    name: "Supported Search Engines",
    description: "List of search engines available in novada_search with characteristics",
    mimeType: "text/plain",
  },
  {
    uri: "novada://countries",
    name: "Supported Country Codes",
    description: "Top 50 country codes for geo-targeted search. Pass as 'country' param.",
    mimeType: "text/plain",
  },
  {
    uri: "novada://guide",
    name: "Agent Usage Guide",
    description: "Tool selection guide: when to use search vs extract vs research vs map vs crawl",
    mimeType: "text/plain",
  },
];

export function listResources(): ListResourcesResult {
  return { resources: RESOURCES };
}

export function readResource(uri: string): ReadResourceResult {
  switch (uri) {
    case "novada://engines":
      return {
        contents: [{
          uri,
          mimeType: "text/plain",
          text: `# Supported Search Engines

google     — Best for general queries, highest relevance, default choice
bing       — Good alternative, required for mkt-based locale targeting  
duckduckgo — Privacy-focused, no personalization bias, good for neutral results
yahoo      — Older index, sometimes surfaces different results than Google
yandex     — Best for Russian/Eastern European content and queries

Recommendation: Use google for most queries. Use yandex for Russian-language content.
For localized results, always pair engine with country + language params.`,
        }],
      };

    case "novada://countries":
      return {
        contents: [{
          uri,
          mimeType: "text/plain",
          text: `# Country Codes for Geo-Targeted Search
Pass as the 'country' parameter in novada_search.

us — United States    gb — United Kingdom    de — Germany
fr — France           jp — Japan             cn — China
kr — South Korea      in — India             br — Brazil
ca — Canada           au — Australia         mx — Mexico
es — Spain            it — Italy             nl — Netherlands
se — Sweden           no — Norway            dk — Denmark
fi — Finland          ch — Switzerland       at — Austria
pl — Poland           cz — Czech Republic    ru — Russia
tr — Turkey           sa — Saudi Arabia      ae — UAE
sg — Singapore        hk — Hong Kong         tw — Taiwan
id — Indonesia        th — Thailand          vn — Vietnam
ph — Philippines      my — Malaysia          ng — Nigeria
za — South Africa     eg — Egypt             ar — Argentina
co — Colombia         cl — Chile             pe — Peru

Total supported: 195 countries. The above are the most commonly used.`,
        }],
      };

    case "novada://guide":
      return {
        contents: [{
          uri,
          mimeType: "text/plain",
          text: `# novada-mcp Tool Selection Guide

## Decision Tree

You have a URL → novada_extract
You need to find URLs on a site → novada_map, then novada_extract on specific ones
You have a question needing web data → novada_research (deep questions) or novada_search (simple lookups)
You need content from multiple pages of a site → novada_crawl
You have search results and want to read them → novada_extract with array of URLs (batch)

## Tool Comparison

| Tool           | Input          | Output           | Best for                              |
|----------------|----------------|------------------|---------------------------------------|
| novada_search  | query          | URL list+snippets| Finding pages, getting current facts  |
| novada_extract | url or [urls]  | Page content     | Reading specific pages                |
| novada_map     | root url       | URL list only    | Discovering what pages exist          |
| novada_crawl   | root url       | Content of pages | Getting content from multiple pages   |
| novada_research| question       | Synthesized report| Complex research needing many sources|

## Common Workflows

### RAG Pipeline
1. novada_search → get relevant URLs
2. novada_extract with array of top URLs → batch extract
3. Feed content to your vector store

### Competitive Analysis
1. novada_map competitor.com → discover all pages
2. novada_crawl competitor.com --select_paths ['/pricing', '/features'] → extract key pages
3. novada_research "competitor strengths weaknesses" → multi-source synthesis

### Real-time Grounding
1. novada_search with time_range="week" → recent results
2. novada_extract on top result → full current content

### Documentation Scraping
1. novada_map docs.example.com → discover all doc pages
2. novada_crawl docs.example.com --instructions "only API reference pages" → targeted content`,
        }],
      };

    default:
      throw new Error(`Unknown resource URI: ${uri}`);
  }
}
```

**File:** `src/index.ts` — register Resources handlers:
```typescript
import { listResources, readResource } from "./resources/index.js";
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// In capabilities:
{ capabilities: { tools: {}, prompts: {}, resources: {} } }

// In setupHandlers():
this.server.setRequestHandler(ListResourcesRequestSchema, async () => listResources());
this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  return readResource(request.params.uri);
});
```

---

### 8.3 Tool Annotations (MCP 2025-11)

Add `annotations` to tool definitions to give agents semantic hints about tool behavior.

**File:** `src/index.ts` — add to each tool in TOOLS array:
```typescript
// novada_search
annotations: {
  readOnlyHint: true,        // does not modify anything
  idempotentHint: true,      // same query → same results (cache-safe)
  openWorldHint: true,       // accesses external internet
},

// novada_extract (same for search)
annotations: {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
},

// novada_crawl (NOT idempotent — crawl order may vary)
annotations: {
  readOnlyHint: true,
  idempotentHint: false,
  openWorldHint: true,
},

// novada_map, novada_research — same as search
annotations: {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
},
```

---

## 9. Phase 4 — Ecosystem Registration

**Target:** Day 8 | **Files:** `smithery.yaml`, `server.json`, `README.md`

### 9.1 Fix smithery.yaml — Add Tools Declaration

LobeHub and Smithery detect tools from `smithery.yaml`. The current file has no `tools` section.

**File:** `smithery.yaml` — add tools section:
```yaml
name: novada-mcp
description: "Real-time web data — search (5 engines, 195 countries), extract, crawl, map, research. Anti-bot bypass via 100M+ proxy IPs."
startCommand:
  type: stdio
  configSchema:
    type: object
    properties:
      novadaApiKey:
        type: string
        description: "Novada API key from novada.com"
    required:
      - novadaApiKey
  commandFunction: |
    config => ({ command: 'npx', args: ['-y', 'novada-mcp@latest'], env: { NOVADA_API_KEY: config.novadaApiKey } })

tools:
  - name: novada_search
    description: "Search the web via 5 engines with geo-targeting"
  - name: novada_extract
    description: "Extract content from any URL or batch of URLs"
  - name: novada_crawl
    description: "Crawl a website and extract multiple pages"
  - name: novada_map
    description: "Discover all URLs on a website"
  - name: novada_research
    description: "Multi-step research with parallel queries and synthesis"
```

### 9.2 Sync server.json Version

**File:** `server.json` — update version from `0.6.0` to match current npm package version.

Also update the tools descriptions to match Phase 2 improvements:
```json
"tools": [
  { "name": "novada_search", "description": "Web search via 5 engines (Google, Bing, DuckDuckGo, Yahoo, Yandex) with 195-country geo-targeting, time filtering, and domain filtering" },
  { "name": "novada_extract", "description": "Extract main content from any URL or batch of URLs. Returns clean markdown, text, or HTML." },
  { "name": "novada_crawl", "description": "Multi-page website crawl with BFS/DFS strategy, path filtering, and natural language instructions" },
  { "name": "novada_map", "description": "Discover all URLs on a website without extracting content. Fast site structure mapping." },
  { "name": "novada_research", "description": "Multi-step research: runs 3-10 parallel searches, deduplicates, returns cited report" }
]
```

### 9.3 Add LobeHub Badge to README

Add at the top of README.md, after the title:
```markdown
[![MCP Badge](https://lobehub.com/badge/mcp-full/goldentrii-novada-mcp?theme=dark)](https://lobehub.com/mcp/goldentrii-novada-mcp)
```

Then go to https://lobehub.com/mcp/goldentrii-novada-mcp → Score tab → "Check Claim Status" to verify ownership.

### 9.4 Add Smithery Install to README

Add to Installation section:
```markdown
#### Via Smithery (Claude Desktop auto-install)
npx -y @smithery/cli install goldentrii/novada-mcp --client claude
```

---

## 10. Phase 5 — Testing & Validation

**Target:** Day 9-10

### 10.1 Schema Validation Test

```bash
# After rebuild, verify all tools have non-empty schemas
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | \
  NOVADA_API_KEY=test node build/index.js 2>/dev/null | \
  python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line)
        if 'result' in d and 'tools' in d['result']:
            for t in d['result']['tools']:
                schema = t.get('inputSchema', {})
                props = schema.get('properties', {})
                print(f\"{'OK' if props else 'FAIL'}: {t['name']} — {len(props)} params\")
    except: pass
"
```
**Expected:** All 5 tools show OK with ≥2 params each.

### 10.2 Prompts Validation Test

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","id":2,"method":"prompts/list","params":{}}' | \
  NOVADA_API_KEY=test node build/index.js 2>/dev/null
```
**Expected:** JSON response with 3 prompts.

### 10.3 Resources Validation Test

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","id":2,"method":"resources/list","params":{}}' | \
  NOVADA_API_KEY=test node build/index.js 2>/dev/null
```
**Expected:** JSON response with 3 resources (engines, countries, guide).

### 10.4 Functional Tests

Run existing test suite: `npm test`  
Update any tests that relied on old schema format.

Add new tests in `tests/`:
- `search.test.ts`: test time_range, include_domains, exclude_domains params
- `extract.test.ts`: test batch URL array input
- `crawl.test.ts`: test select_paths and exclude_paths filtering
- `map.test.ts`: test SPA detection warning trigger

### 10.5 LobeHub Score Verification

After publishing new npm version:
1. Wait 24-48h for LobeHub to rescan
2. Visit https://lobehub.com/mcp/goldentrii-novada-mcp?activeTab=score
3. Verify:
   - `Includes At Least One Skill` → passes (≥1 skill detected)
   - `Installation Methods` count ≥ 2 (NPX + Smithery)
   - `Includes Prompts` → passes
   - `Includes Resources` → passes
   - Score target: ≥80/100 (Grade A)

---

## 11. Implementation Checklist

Use this to track progress. Check off each item as completed.

### Phase 0 — Bug Fixes
- [ ] 0.1 Replace `zodToMcpSchema` with Zod v4 native `.toJSONSchema()`
- [ ] 0.1 Remove `zod-to-json-schema` import from `src/index.ts`
- [ ] 0.1 Remove `zod-to-json-schema` from `package.json` dependencies
- [ ] 0.1 Rebuild and verify `inputSchema` is non-empty for all 5 tools
- [ ] 0.2 Strip "Read more" / "More" artifacts in `search.ts` snippet formatter
- [ ] 0.3 Add `--max-pages` alias in `cli.ts` crawl case
- [ ] 0.3 Update CLI help text to show `--max-pages`
- [ ] 0.4 Add SPA detection warning in `map.ts` when ≤1 URL found

### Phase 1 — Schema Expansion
- [ ] 1.1 Add `time_range`, `start_date`, `end_date` to `SearchParamsSchema`
- [ ] 1.1 Add `include_domains`, `exclude_domains` to `SearchParamsSchema`
- [ ] 1.1 Pass new search params to Novada API call in `search.ts`
- [ ] 1.1 Update search meta header to show active filters
- [ ] 1.2 Change `ExtractParamsSchema.url` to accept `string | string[]`
- [ ] 1.2 Add `query` param to `ExtractParamsSchema` for relevance hinting
- [ ] 1.2 Implement batch extraction with `Promise.all` in `extract.ts`
- [ ] 1.3 Add `instructions`, `select_paths`, `exclude_paths` to `CrawlParamsSchema`
- [ ] 1.3 Implement path filtering in `crawl.ts` queue management
- [ ] 1.4 Add `auto` and `comprehensive` to `ResearchParamsSchema.depth`
- [ ] 1.4 Implement `resolveDepth` heuristic in `research.ts`
- [ ] 1.5 Add `max_depth` to `MapParamsSchema`
- [ ] 1.x Update `src/cli.ts` with new flags for search (--from, --to, --include, --exclude) and crawl (--instructions, --select)
- [ ] 1.x Update CLI help text with new flags

### Phase 2 — Response Redesign
- [ ] 2.1 Search: new header format `results:N | engine:X | filters` 
- [ ] 2.1 Search: new result format with `url:` on own line
- [ ] 2.1 Search: add `## Agent Hints` section
- [ ] 2.2 Extract: new header with `url:`, `title:`, `description:` on own lines
- [ ] 2.2 Extract: filter links to top 15 same-domain content links
- [ ] 2.2 Extract: batch response format with numbered sections
- [ ] 2.2 Extract: add `## Agent Hints` section
- [ ] 2.3 Map: new header format, add `## Agent Hints` section
- [ ] 2.4 Crawl: new header format with `pages:N | strategy:X | failed:N`
- [ ] 2.5 Research: add structured metadata header
- [ ] 2.5 Research: replace hardcoded footer with `## Agent Hints`

### Phase 3 — MCP Primitives
- [ ] 3.1 Create `src/prompts/index.ts` with 3 prompts (research_topic, extract_and_summarize, site_audit)
- [ ] 3.1 Register `prompts/list` and `prompts/get` handlers in `src/index.ts`
- [ ] 3.1 Add `prompts: {}` to server capabilities
- [ ] 3.2 Create `src/resources/index.ts` with 3 resources (engines, countries, guide)
- [ ] 3.2 Register `resources/list` and `resources/read` handlers in `src/index.ts`
- [ ] 3.2 Add `resources: {}` to server capabilities
- [ ] 3.3 Add `annotations` to all 5 tool definitions in TOOLS array

### Phase 4 — Ecosystem
- [ ] 4.1 Add `tools` section to `smithery.yaml`
- [ ] 4.2 Sync `server.json` version to current npm version
- [ ] 4.2 Update `server.json` tool descriptions to match new descriptions
- [ ] 4.3 Add LobeHub badge to `README.md` top section
- [ ] 4.3 Add Smithery install command to README Installation section
- [ ] 4.4 Claim LobeHub listing (badge check at lobehub.com)

### Phase 5 — Testing
- [ ] 5.1 Run schema validation test — all 5 tools pass
- [ ] 5.2 Run prompts validation test — 3 prompts returned
- [ ] 5.3 Run resources validation test — 3 resources returned
- [ ] 5.4 Run `npm test` — all existing tests pass
- [ ] 5.4 Update broken tests (schema-related assertions)
- [ ] 5.5 Add tests for batch extract
- [ ] 5.5 Add tests for crawl path filtering
- [ ] 5.5 Add tests for map SPA warning
- [ ] 5.6 Bump version in `package.json` (suggest 2.0.0 for this overhaul)
- [ ] 5.6 Rebuild: `npm run build`
- [ ] 5.6 Publish: `npm publish`
- [ ] 5.7 Wait 24h then verify LobeHub score ≥ 80

---

## 12. Anti-Patterns — What NOT To Do

1. **Do NOT add LLM-based content filtering inside the MCP server.**  
   The crawl `instructions` parameter should do path-level filtering only. Semantic filtering is the agent's job. Adding LLM calls inside the server would add latency, cost, and complexity with no benefit (the calling agent already has LLM reasoning).

2. **Do NOT change tool names** (`novada_search` → `web_search` etc.).  
   Users and agents that have already integrated these tools would break. The namespace `novada_*` is also a branding signal.

3. **Do NOT return raw JSON as tool responses.**  
   MCP tool responses are text content. Raw JSON requires the agent to parse it explicitly. Structured markdown with consistent key:value patterns is both human-readable and agent-parseable.

4. **Do NOT add HTTP/SSE transport in this sprint.**  
   Remote MCP is a v3 initiative. Adding it now would introduce auth, hosting, and rate-limiting complexity that distracts from the core agent UX work.

5. **Do NOT over-engineer the `auto` depth in research.**  
   The heuristic (question length + keyword signals) is good enough. Adding ML-based complexity detection would require a model call per research request.

6. **Do NOT truncate extract content at a hard character limit without warning.**  
   If content exceeds limits, include a clear `[Content truncated at N chars. Full content: N chars total.]` message so the agent knows it has partial data and can adjust strategy.

7. **Do NOT remove the proxy metadata from response headers.**  
   `Via: Novada proxy` is a trust signal. Agents and users should know the request went through anti-bot infrastructure, especially for sites that typically block scrapers.

---

## 13. Version Target

This revamp targets **novada-mcp v2.0.0** — a major version bump is appropriate because:
- Tool schemas change (breaking for clients that relied on no-parameter behavior)
- Response format changes (agents that parse old format will need adjustment)
- New capabilities (prompts, resources, batch extract)

Suggested changelog entry:
```
## v2.0.0 — Agent-Native Redesign

### Breaking Changes
- Tool response format changed: structured markdown with metadata header + Agent Hints
- novada_extract: url param now accepts string | string[] (backward compatible)
- SearchParamsSchema: new optional params (backward compatible)

### New Features
- MCP Prompts: research_topic, extract_and_summarize, site_audit
- MCP Resources: engines, countries, agent guide
- Batch URL extraction in novada_extract
- Time range + domain filtering in novada_search  
- Natural language instructions + path filtering in novada_crawl
- Auto depth resolution in novada_research
- Tool annotations (readOnlyHint, idempotentHint, openWorldHint)

### Bug Fixes
- Fixed empty inputSchema (Zod v4 + zod-to-json-schema incompatibility)
- Fixed "Read more" artifacts in search snippets
- Fixed --max-pages CLI flag
- Added SPA detection warning in novada_map
```
