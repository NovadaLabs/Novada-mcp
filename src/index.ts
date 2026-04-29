#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  novadaSearch,
  novadaExtract,
  novadaCrawl,
  novadaResearch,
  novadaMap,
  novadaProxy,
  novadaScrape,
  novadaVerify,
  novadaUnblock,
  novadaBrowser,
  novadaHealth,
  validateSearchParams,
  validateExtractParams,
  validateCrawlParams,
  validateResearchParams,
  validateMapParams,
  validateProxyParams,
  validateScrapeParams,
  validateVerifyParams,
  validateUnblockParams,
  validateBrowserParams,
  validateHealthParams,
  classifyError,
} from "./tools/index.js";
import { ZodError } from "zod";
import {
  SearchParamsSchema,
  ExtractParamsSchema,
  CrawlParamsSchema,
  ResearchParamsSchema,
  MapParamsSchema,
  ProxyParamsSchema,
  ScrapeParamsSchema,
  VerifyParamsSchema,
  UnblockParamsSchema,
  BrowserParamsSchema,
  HealthParamsSchema,
} from "./tools/types.js";

// ─── Configuration ───────────────────────────────────────────────────────────

import { VERSION } from "./config.js";
import { listPrompts, getPrompt } from "./prompts/index.js";
import { listResources, readResource } from "./resources/index.js";

const API_KEY = process.env.NOVADA_API_KEY;

/** Convert a Zod v4 schema to MCP-compatible JSON Schema.
 * Uses Zod's native .toJSONSchema() — zod-to-json-schema v3 does not support Zod v4.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToMcpSchema(schema: any): Record<string, unknown> {
  const jsonSchema = schema.toJSONSchema();
  // Strip meta-schema declarations that MCP clients don't need
  const { $schema, $defs, ...rest } = jsonSchema as Record<string, unknown>;
  return rest;
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "novada_search",
    description: `Use when you have a question or topic but no URL. Searches the web via 5 engines (Google, Bing, DuckDuckGo, Yahoo, Yandex) and returns titles, URLs, and snippets — reranked by relevance to your query.

**Best for:** Current events, finding relevant pages, fact lookup, competitive research. Add time_range="week" for recent results. Add include_domains to restrict sources.
**Not for:** Reading a URL you already have (use novada_extract), full multi-source report (use novada_research).
**Next step:** Call novada_extract with the returned URLs to read full content.`,
    inputSchema: zodToMcpSchema(SearchParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "novada_extract",
    description: `Use when you have a URL and need its content. Extracts main text, title, and links. Supports batch extraction — pass url as an array to fetch up to 10 pages in parallel. Auto-escalates from static fetch → JS render → Browser CDP on anti-bot pages.

**Best for:** Reading specific pages, batch-reading search results, extracting docs.
**Not for:** Discovering which URLs exist on a site (use novada_map first), crawling many pages (use novada_crawl).
**Tip:** If content looks incomplete or JS-heavy, set render="render" or render="browser".`,
    inputSchema: zodToMcpSchema(ExtractParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "novada_crawl",
    description: `Use when you need content from multiple pages of a site and don't have the URLs yet. Crawls BFS or DFS up to 20 pages, extracts content from each. Use select_paths regex to target specific sections (e.g. "/docs/api/.*").

**Best for:** Doc site ingestion, competitive content analysis, building knowledge bases from a domain.
**Not for:** A single page (use novada_extract), URL discovery without content extraction (use novada_map — much faster).`,
    inputSchema: zodToMcpSchema(CrawlParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "novada_research",
    description: `Use when you have a complex question needing multiple sources. Generates 3–10 diverse search queries in parallel, deduplicates results, extracts full content from top sources, returns a cited multi-source report.

**Best for:** Comparative analysis, topic overviews, questions needing multiple perspectives. One call replaces 3–10 manual searches.
**Not for:** Simple single-fact lookup (use novada_search), reading a specific URL (use novada_extract).
**Depth options:** "quick" (3 queries), "deep" (5–6), "comprehensive" (8–10), "auto" (default — inferred from question).`,
    inputSchema: zodToMcpSchema(ResearchParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "novada_map",
    description: `Use when you need to know what URLs exist on a site before deciding what to read. Tries sitemap.xml first (fast), falls back to BFS crawl. Returns URL list only — no content.

**Best for:** Site structure discovery, finding the correct subpage URL when you extracted the wrong page.
**Not for:** Reading page content (follow with novada_extract or novada_crawl).
**Note:** Limited results on JavaScript SPAs — will flag this in output.`,
    inputSchema: zodToMcpSchema(MapParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "novada_scrape",
    description: `Use when you need structured data from a specific platform — not raw HTML, but clean tabular records. Supports 129 platforms: Amazon, Reddit, TikTok, LinkedIn, Google Shopping, Glassdoor, GitHub, Zillow, Airbnb, and more.

**Best for:** E-commerce product data, social posts/comments, job listings, reviews, real estate, market data.
**Not for:** General web pages (use novada_extract), unknown domains not in the platform list (use novada_crawl).
**Output formats:** "markdown" (default, agent-optimized table), "json" (structured, for programmatic use).
**Example:** platform="amazon.com", operation="amazon_product_by-keywords", params={keyword:"iphone 16", num:5}
**Discover platforms:** Read the \`novada://scraper-platforms\` MCP resource for the complete platform list with operation IDs and required params.`,
    inputSchema: zodToMcpSchema(ScrapeParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "novada_proxy",
    description: `Use when you need to route your own HTTP requests through residential or mobile IPs — for geo-targeting, IP rotation, or bypassing IP-based rate limits. Returns proxy URL, shell export commands, or curl --proxy flag.

**Best for:** When you need a specific country/city IP, sticky sessions for multi-step workflows, or testing geo-restricted content.
**Not for:** Web page extraction (use novada_extract — proxy is automatic), web search (use novada_search).
**Formats:** "url" for Node.js/Python, "env" for shell variables, "curl" for CLI requests.
**Note:** Requires NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.`,
    inputSchema: zodToMcpSchema(ProxyParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "novada_verify",
    description: `Use when you have a factual claim and need to check if it's supported by web sources. Runs 3 parallel searches (supporting, skeptical, fact-check angles) and returns a verdict: supported / unsupported / contested / insufficient_data.

**Best for:** Checking claims before citing them, cross-validating research findings, detecting misinformation.
**Not for:** Open-ended questions (use novada_research), reading a specific URL (use novada_extract).
**Note:** Verdict is signal-based (search balance), not a definitive ruling. Confidence 0–100 indicates certainty.`,
    inputSchema: zodToMcpSchema(VerifyParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "novada_unblock",
    description: `Use when you need the raw rendered HTML of a blocked or JS-heavy page. Forces JS rendering via Web Unblocker or Browser API. Returns raw HTML, not cleaned text.

**Best for:** When you need raw HTML (not cleaned text) for custom DOM parsing. When novada_extract with render="render" still fails. Returns the full JS-rendered HTML source.
**Tip:** For most anti-bot pages, try novada_extract with render="render" first — it returns clean text. Use novada_unblock when you specifically need the raw HTML source.
**Not for:** Reading cleaned text (use novada_extract with render="render"), structured platform data (use novada_scrape).
**Methods:** "render" (Web Unblocker, faster/cheaper), "browser" (full Chromium CDP, handles complex SPAs).
**Wait hint:** Use wait_for to specify a CSS selector to wait for before capturing HTML.`,
    inputSchema: zodToMcpSchema(UnblockParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "novada_browser",
    description: `Use when you need to interact with a web page — click buttons, fill forms, scroll, take screenshots, or execute JavaScript. Chain multiple actions in one call for efficiency.

**Best for:** Login flows, paginated content, interactive SPAs, form submission, visual verification, scraping behind user interactions.
**Not for:** Simple page reading (use novada_extract), structured data (use novada_scrape), raw HTML (use novada_unblock).
**Actions:** navigate, click, type, screenshot, aria_snapshot, evaluate, wait, scroll, hover, press_key, select — up to 20 per call.
**Sessions:** Pass session_id to maintain state (cookies, login) across multiple calls. Sessions expire after 10 min of inactivity. Use close_session to release early.
**Requires:** NOVADA_BROWSER_WS environment variable.
**Platform note:** TikTok is geo-restricted in some regions — pass country="us" in actions that support it. Use wait with domcontentloaded (never networkidle) for SPAs.`,
    inputSchema: zodToMcpSchema(BrowserParamsSchema),
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "novada_health",
    description: `Check which Novada API products are active on your API key.

**Best for:** First-time setup, diagnosing why a tool is failing, confirming your account has the right products activated.
**Returns:** Status table for Search, Extract, Scraper API, Proxy, and Browser API — with activation links for anything not yet enabled.`,
    inputSchema: zodToMcpSchema(HealthParamsSchema),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
];

// ─── MCP Server ──────────────────────────────────────────────────────────────

class NovadaMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      { name: "novada-search", version: VERSION },
      { capabilities: { tools: {}, prompts: {}, resources: {} } }
    );
    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error: unknown) => {
      console.error("[novada-search]", error);
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => listPrompts() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return getPrompt(name, (args as Record<string, string>) || {}) as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => listResources() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return readResource(request.params.uri) as any;
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!API_KEY) {
        return {
          content: [{
            type: "text" as const,
            text: "Error: NOVADA_API_KEY is not set. Get your API key at https://www.novada.com and set it as an environment variable.\n\nSetup: claude mcp add novada -e NOVADA_API_KEY=your-key -- npx -y novada-search",
          }],
          isError: true,
        };
      }

      try {
        let result: string;

        switch (name) {
          case "novada_search":
            result = await novadaSearch(validateSearchParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_extract":
            result = await novadaExtract(validateExtractParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_crawl":
            result = await novadaCrawl(validateCrawlParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_research":
            result = await novadaResearch(validateResearchParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_map":
            result = await novadaMap(validateMapParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_proxy":
            result = await novadaProxy(validateProxyParams(args as Record<string, unknown>));
            break;
          case "novada_scrape":
            result = await novadaScrape(validateScrapeParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_verify":
            result = await novadaVerify(validateVerifyParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_unblock":
            result = await novadaUnblock(validateUnblockParams(args as Record<string, unknown>), API_KEY);
            break;
          case "novada_browser":
            result = await novadaBrowser(validateBrowserParams(args as Record<string, unknown>));
            break;
          case "novada_health":
            validateHealthParams(args as Record<string, unknown>);
            result = await novadaHealth(API_KEY);
            break;
          default:
            return {
              content: [{
                type: "text" as const,
                text: `Unknown tool: ${name}. Available: novada_search, novada_extract, novada_crawl, novada_research, novada_map, novada_scrape, novada_proxy, novada_verify, novada_unblock, novada_browser, novada_health`,
              }],
              isError: true,
            };
        }

        return { content: [{ type: "text" as const, text: result }] };
      } catch (error) {
        // Zod validation errors → clear message for the agent
        if (error instanceof ZodError) {
          const issues = error.issues.map(i => `  ${i.path.join(".")}: ${i.message}`).join("\n");
          return {
            content: [{
              type: "text" as const,
              text: `Invalid parameters for ${name}:\n${issues}`,
            }],
            isError: true,
          };
        }

        // Classified API/network errors with retry guidance
        const classified = classifyError(error);
        return {
          content: [{
            type: "text" as const,
            text: `Error [${classified.code}]: ${classified.message}${classified.retryable ? "\n(This error is retryable)" : ""}${classified.docsUrl ? `\nDocs: ${classified.docsUrl}` : ""}`,
          }],
          isError: true,
        };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Novada MCP server v${VERSION} running on stdio — 11 tools loaded`);
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);

if (cliArgs.includes("--list-tools")) {
  for (const tool of TOOLS) {
    const firstLine = tool.description.trim().split("\n")[0];
    console.log(`  ${tool.name} — ${firstLine}`);
  }
  process.exit(0);
}

if (cliArgs.includes("--help") || cliArgs.includes("-h")) {
  console.log(`novada-search v${VERSION} — MCP Server for Novada web data API

Usage:
  npx novada-search              Start the MCP server (stdio transport)
  npx novada-search --list-tools Show available tools
  npx novada-search --help       Show this help

Environment:
  NOVADA_API_KEY              Your Novada API key (required)
  NOVADA_WEB_UNBLOCKER_KEY    Web Unblocker key (enables JS rendering)
  NOVADA_BROWSER_WS           Browser API WebSocket (enables browser automation)
  NOVADA_PROXY_USER/PASS/ENDPOINT  Proxy credentials (enables novada_proxy)

Connect to Claude Code:
  claude mcp add novada -e NOVADA_API_KEY=your_key -- npx -y novada-search

Tools (11):
  novada_search    Search the web via Google, Bing, and 3 more engines
  novada_extract   Extract content from any URL (smart auto-routing)
  novada_crawl     Crawl a website (BFS/DFS, up to 20 pages)
  novada_research  Multi-step web research with synthesis
  novada_map       Discover all URLs on a website (fast)
  novada_scrape    Structured data from 129 platforms (Amazon, TikTok, etc.)
  novada_proxy     Get residential proxy credentials
  novada_verify    Verify a factual claim against web sources
  novada_unblock   Force JS rendering on blocked/SPA pages
  novada_browser   Interactive browser automation (navigate, click, type, screenshot)
  novada_health    Check which Novada products are active on your API key
`);
  process.exit(0);
}

const server = new NovadaMCPServer();
server.run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
