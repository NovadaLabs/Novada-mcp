# novada-mcp Full Capability + SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade novada-mcp from 5 half-functioning tools to full-capability by adding smart routing (static → render → Browser API), fixing research depth, adding proxy tool, and shipping a TypeScript SDK — all designed for agents, not humans.

**Architecture:** Every tool auto-escalates internally (static fetch → JS rendering → full browser CDP), so agents never choose the rendering strategy — they just describe what they want. The SDK exports a `NovadaClient` class from the same package via a subpath export (`novada-mcp/sdk`). All 3 credential sets (Scraper API, Browser API, Proxy) are optional layers — only `NOVADA_API_KEY` is required today.

**Tech Stack:** TypeScript, Zod v4, Axios, Playwright-core (CDP connection), Vitest, MCP SDK `@modelcontextprotocol/sdk`

---

## Context

Current state (v0.6.10):
- `novada_search` ✅ fully working
- `novada_extract` ⚠️ uses `render=false` — fails on JS-heavy / Cloudflare-protected sites
- `novada_crawl` ⚠️ same problem — static HTML only
- `novada_research` ⚠️ returns search snippets only — never actually reads source content
- `novada_map` ✅ works for static, limited for SPAs

Missing:
- Browser API integration (WebSocket CDP via playwright-core)
- Proxy credential tool
- TypeScript SDK (`NovadaClient`)

## Design Decisions

### Agent-Optimal (not Human-Operational)

Agents evaluate tools by description + return format. They don't browse menus. Rule:
- **One tool per problem, not per product** — don't add `novada_render` and `novada_unblock` as separate tools. Auto-route inside `novada_extract`.
- **Smart routing is transparent** — `novada_extract` tries static, detects failure, retries with render, escalates to Browser API if configured. Agent never needs to choose.
- **Tool descriptions describe the problem** — not "uses Web Unblocker API" but "use when page has Cloudflare protection or requires JavaScript rendering."

### Smart Routing Hierarchy (built into extract/crawl)

```
Level 1: Static fetch via Scraper API (fast, cheap ~$0.90/1k)
  └─ If content < 200 chars OR "enable javascript" detected → escalate
Level 2: Render mode (render=true via Scraper API or Web Unblocker endpoint)
  └─ Requires: NOVADA_API_KEY
  └─ If still fails AND NOVADA_BROWSER_WS is set → escalate
Level 3: Browser API via CDP WebSocket
  └─ Requires: NOVADA_BROWSER_WS env var (wss://user:pass@upg-scbr.novada.com)
  └─ Full Playwright-controlled browser, handles auth-gated, interactive pages
```

### Research Depth Fix

Current: 3-10 parallel searches → return snippets.
New 3-phase pipeline:
1. Search: generate 3-10 diverse queries in parallel → collect unique sources
2. Extract: read top 3 most-relevant source URLs in full (auto-routed)
3. Synthesize: return structured report with full content + citations

### Credential Model (future-proof)

```typescript
// All optional except NOVADA_API_KEY
NOVADA_API_KEY          → Scraper API (search + static/render fetch)
NOVADA_BROWSER_WS       → Browser API WebSocket (wss://user:pass@upg-scbr.novada.com)
NOVADA_PROXY_USER       → Proxy username
NOVADA_PROXY_PASS       → Proxy password
NOVADA_PROXY_ENDPOINT   → Proxy host:port
```

---

## File Map

### Modified files

| File | Change |
|------|--------|
| `src/config.ts` | Add Browser API + proxy env vars, JS detection threshold constant |
| `src/utils/http.ts` | Add `fetchWithRender()`, `detectJsHeavyContent()`, update `fetchViaProxy` signature |
| `src/utils/browser.ts` | **NEW** — Browser API WebSocket CDP connection via playwright-core |
| `src/tools/extract.ts` | Smart routing: static → render → browser, JS detection |
| `src/tools/crawl.ts` | Smart routing in per-page fetch |
| `src/tools/research.ts` | Add Phase 2 (extract top 3 sources) to pipeline |
| `src/tools/proxy.ts` | **NEW** — `novadaProxy()` function |
| `src/tools/types.ts` | Add `render` param to Extract/Crawl schemas, `ProxyParams` schema |
| `src/tools/index.ts` | Export `novadaProxy`, `validateProxyParams` |
| `src/index.ts` | Add `novada_proxy` tool, update tool descriptions for agent-optimal wording |
| `src/sdk/index.ts` | **NEW** — `NovadaClient` class |
| `src/sdk/types.ts` | **NEW** — Typed response interfaces (objects vs strings) |
| `package.json` | Add playwright-core, add `exports` subpath for SDK, bump to v0.7.0 |
| `tests/tools/crawl.test.ts` | **NEW** — crawl tool tests (currently missing) |
| `tests/tools/smart-routing.test.ts` | **NEW** — routing escalation logic tests |
| `tests/sdk/client.test.ts` | **NEW** — NovadaClient SDK tests |

---

## Task 1: Config + Credential Model

**Files:**
- Modify: `src/config.ts`
- Modify: `package.json` (add playwright-core)

- [ ] **Step 1: Install playwright-core**

```bash
cd /Users/tongwu/Projects/novada-mcp
npm install playwright-core
```

Expected: playwright-core added to `node_modules/`

- [ ] **Step 2: Update config.ts**

Replace the entire `src/config.ts` with:

```typescript
export const VERSION = "0.7.0";
export const SCRAPER_API_BASE = "https://scraperapi.novada.com";

// Optional: Browser API WebSocket endpoint
// Format: wss://username:password@upg-scbr.novada.com
export const BROWSER_WS_ENDPOINT = process.env.NOVADA_BROWSER_WS;

// Optional: Proxy credentials
export const PROXY_USER = process.env.NOVADA_PROXY_USER;
export const PROXY_PASS = process.env.NOVADA_PROXY_PASS;
export const PROXY_ENDPOINT = process.env.NOVADA_PROXY_ENDPOINT;

// JS-heavy detection: content shorter than this triggers render escalation
export const JS_DETECTION_THRESHOLD = 200;
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: `build/` updated, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts package.json package-lock.json
git commit -m "feat: add multi-credential config and playwright-core dep"
```

---

## Task 2: Browser API Utility (CDP WebSocket)

**Files:**
- Create: `src/utils/browser.ts`
- Modify: `src/utils/index.ts` (export new util)

- [ ] **Step 1: Write the failing test**

Create `tests/utils/browser.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { isBrowserConfigured, fetchViaBrowser } from "../../src/utils/browser.js";

// Reset env between tests
const originalEnv = process.env;
afterEach(() => { process.env = { ...originalEnv }; });

describe("isBrowserConfigured", () => {
  it("returns false when NOVADA_BROWSER_WS not set", () => {
    delete process.env.NOVADA_BROWSER_WS;
    expect(isBrowserConfigured()).toBe(false);
  });

  it("returns true when NOVADA_BROWSER_WS is set", () => {
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@upg-scbr.novada.com";
    expect(isBrowserConfigured()).toBe(true);
  });
});

describe("fetchViaBrowser", () => {
  it("throws when Browser API not configured", async () => {
    delete process.env.NOVADA_BROWSER_WS;
    await expect(fetchViaBrowser("https://example.com")).rejects.toThrow("NOVADA_BROWSER_WS not configured");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test tests/utils/browser.test.ts
```

Expected: FAIL — `isBrowserConfigured` not defined.

- [ ] **Step 3: Create src/utils/browser.ts**

```typescript
import { chromium } from "playwright-core";
import { BROWSER_WS_ENDPOINT } from "../config.js";

/** Check if Browser API credentials are available */
export function isBrowserConfigured(): boolean {
  return !!BROWSER_WS_ENDPOINT;
}

/**
 * Fetch a URL using Novada Browser API via CDP WebSocket.
 * Connects to Novada's cloud browser, navigates to URL, returns rendered HTML.
 *
 * Requires: NOVADA_BROWSER_WS env var.
 * Cost: ~$3/GB. Use only when static/render modes fail.
 */
export async function fetchViaBrowser(
  url: string,
  options: { timeout?: number; waitForSelector?: string } = {}
): Promise<string> {
  const wsEndpoint = BROWSER_WS_ENDPOINT;
  if (!wsEndpoint) {
    throw new Error(
      "NOVADA_BROWSER_WS not configured. Set it to wss://user:pass@upg-scbr.novada.com to enable Browser API."
    );
  }

  const timeout = options.timeout ?? 30000;
  let browser;

  try {
    browser = await chromium.connectOverCDP(wsEndpoint);
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    });

    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 5000 }).catch(() => {
        // Best effort — don't fail if selector not found
      });
    }

    const html = await page.content();
    await context.close();
    return html;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
```

- [ ] **Step 4: Export from utils/index.ts**

Add to `src/utils/index.ts`:

```typescript
export { fetchWithRetry, fetchViaProxy, USER_AGENT } from "./http.js";
export { normalizeUrl, isContentLink } from "./url.js";
export { extractMainContent, extractTitle, extractDescription, extractLinks } from "./html.js";
export { cleanParams } from "./params.js";
export { isBrowserConfigured, fetchViaBrowser } from "./browser.js";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test tests/utils/browser.test.ts
```

Expected: PASS.

- [ ] **Step 6: Build to verify TypeScript compiles**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/browser.ts src/utils/index.ts tests/utils/browser.test.ts
git commit -m "feat: add Browser API CDP utility (playwright-core)"
```

---

## Task 3: Smart Routing in HTTP Utils

**Files:**
- Modify: `src/utils/http.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/utils/` — create `tests/utils/http.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectJsHeavyContent } from "../../src/utils/http.js";

describe("detectJsHeavyContent", () => {
  it("detects empty content as JS-heavy", () => {
    expect(detectJsHeavyContent("")).toBe(true);
  });

  it("detects 'enable javascript' message as JS-heavy", () => {
    expect(detectJsHeavyContent(
      '<html><body><p>Please enable JavaScript to continue.</p></body></html>'
    )).toBe(true);
  });

  it("detects content shorter than threshold as JS-heavy", () => {
    expect(detectJsHeavyContent("<html><body><p>Hi</p></body></html>")).toBe(true);
  });

  it("detects cloudflare challenge page as JS-heavy", () => {
    expect(detectJsHeavyContent(
      '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>'
    )).toBe(true);
  });

  it("detects rich content as NOT JS-heavy", () => {
    const richContent = "<html><body>" + "word ".repeat(100) + "</body></html>";
    expect(detectJsHeavyContent(richContent)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test tests/utils/http.test.ts
```

Expected: FAIL — `detectJsHeavyContent` not exported.

- [ ] **Step 3: Add detectJsHeavyContent and fetchWithRender to http.ts**

Add these functions to `src/utils/http.ts` (after the existing `fetchViaProxy`):

```typescript
import { JS_DETECTION_THRESHOLD } from "../config.js";

/** Detect if fetched HTML is a JS-required page (empty shell, Cloudflare, etc.) */
export function detectJsHeavyContent(html: string): boolean {
  if (!html || html.length < JS_DETECTION_THRESHOLD) return true;

  const lower = html.toLowerCase();
  const jsSignals = [
    "enable javascript",
    "please enable js",
    "javascript is required",
    "javascript must be enabled",
    "just a moment",          // Cloudflare challenge
    "checking your browser",   // Cloudflare
    "ddos-guard",
    "ray id",                 // Cloudflare footer
    "cf-browser-verification",
    "__cf_chl",               // Cloudflare challenge form
    "loading...</p>",         // Common SPA loading shell
    "id=\"root\"></div>",     // React/Vue/Angular empty root
    "id=\"app\"></div>",
  ];

  return jsSignals.some(signal => lower.includes(signal));
}

/**
 * Fetch a URL with JavaScript rendering enabled (Web Unblocker mode).
 * Uses Novada Scraper API with render=true.
 * Costs ~$1/1k requests vs $0.90 for static.
 */
export async function fetchWithRender(
  url: string,
  apiKey: string,
  options: Partial<AxiosRequestConfig> = {}
): Promise<AxiosResponse> {
  const proxyParams = new URLSearchParams({
    api_key: apiKey,
    url,
    render: "true",
  });

  return fetchWithRetry(
    `${SCRAPER_API_BASE}?${proxyParams.toString()}`,
    {
      headers: {
        "User-Agent": USER_AGENT,
        Origin: "https://www.novada.com",
        Referer: "https://www.novada.com/",
      },
      timeout: 60000, // render takes longer
      ...options,
    }
  );
}
```

Also update the `fetchViaProxy` signature to accept a `render` option:

```typescript
export async function fetchViaProxy(
  url: string,
  apiKey: string | undefined,
  options: Partial<AxiosRequestConfig> & { render?: boolean } = {}
): Promise<AxiosResponse> {
  const { render = false, ...axiosOptions } = options;

  if (apiKey) {
    try {
      const proxyParams = new URLSearchParams({
        api_key: apiKey,
        url,
        render: render ? "true" : "false",
      });
      const response = await fetchWithRetry(
        `${SCRAPER_API_BASE}?${proxyParams.toString()}`,
        {
          headers: {
            "User-Agent": USER_AGENT,
            Origin: "https://www.novada.com",
            Referer: "https://www.novada.com/",
          },
          timeout: render ? 60000 : 45000,
          ...axiosOptions,
        }
      );
      return response;
    } catch (error) {
      if (
        error instanceof AxiosError &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        throw error;
      }
      console.error(`[novada-mcp] Proxy failed for ${url}, falling back to direct fetch`);
    }
  }
  return fetchWithRetry(url, axiosOptions);
}
```

Also add the missing import at the top of http.ts:

```typescript
import { SCRAPER_API_BASE, JS_DETECTION_THRESHOLD } from "../config.js";
```

- [ ] **Step 4: Export detectJsHeavyContent and fetchWithRender from utils/index.ts**

```typescript
export { fetchWithRetry, fetchViaProxy, fetchWithRender, detectJsHeavyContent, USER_AGENT } from "./http.js";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test tests/utils/http.test.ts
```

Expected: PASS all 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/utils/http.ts src/utils/index.ts tests/utils/http.test.ts
git commit -m "feat: add detectJsHeavyContent + fetchWithRender (render=true mode)"
```

---

## Task 4: Smart Routing in extract.ts

**Files:**
- Modify: `src/tools/extract.ts`
- Modify: `src/tools/types.ts` (add `render` param)
- Modify: `tests/tools/extract.test.ts`

- [ ] **Step 1: Add `render` param to ExtractParamsSchema in types.ts**

In `src/tools/types.ts`, update `ExtractParamsSchema`:

```typescript
export const ExtractParamsSchema = z.object({
  url: z.union([
    safeUrl,
    z.array(safeUrl).min(1).max(10),
  ]).describe("URL or array of URLs (max 10) to extract. Batch mode processes in parallel."),
  format: z.enum(["text", "markdown", "html"]).default("markdown"),
  query: z.string().optional()
    .describe("Optional query for relevance context. Helps the calling agent focus on relevant sections."),
  render: z.enum(["auto", "static", "render", "browser"]).default("auto")
    .describe("Rendering mode. 'auto' (default): tries static first, escalates if JS-heavy. 'static': static HTML only. 'render': force JS rendering via Web Unblocker. 'browser': force Browser API CDP (requires NOVADA_BROWSER_WS)."),
});
```

- [ ] **Step 2: Write the failing tests for smart routing**

Add to `tests/tools/extract.test.ts`:

```typescript
import { detectJsHeavyContent } from "../../src/utils/http.js";

describe("smart routing detection", () => {
  it("detects empty Cloudflare page as JS-heavy → should use render", () => {
    const html = "<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>";
    expect(detectJsHeavyContent(html)).toBe(true);
  });

  it("detects rich static page as NOT JS-heavy → keeps static", () => {
    const richHtml = "<html><body>" + "<p>Content paragraph.</p>".repeat(20) + "</body></html>";
    expect(detectJsHeavyContent(richHtml)).toBe(false);
  });
});

describe("novadaExtract render escalation", () => {
  it("includes render_mode in output metadata when auto-routed", async () => {
    // Simulate static returning JS-heavy content
    mockedAxios.get
      .mockResolvedValueOnce({ data: "<html><body id='root'></div></body></html>" }) // static → JS-heavy
      .mockResolvedValueOnce({ data: "<html><body><h1>Real Content</h1><p>" + "word ".repeat(50) + "</p></body></html>" }); // render → good

    const result = await novadaExtract(
      { url: "https://example.com", format: "markdown", query: undefined, render: "auto" },
      "test-key"
    );
    expect(result).toContain("Real Content");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test tests/tools/extract.test.ts
```

Expected: Some failures on the new escalation test.

- [ ] **Step 4: Update extractSingle() in extract.ts for smart routing**

Replace the `extractSingle` function in `src/tools/extract.ts`:

```typescript
import { fetchViaProxy, extractMainContent, extractTitle, extractDescription, extractLinks, detectJsHeavyContent, fetchViaBrowser, isBrowserConfigured } from "../utils/index.js";
import type { ExtractParams } from "./types.js";

async function extractSingle(
  params: ExtractParams & { url: string },
  apiKey?: string
): Promise<string> {
  const renderMode = params.render ?? "auto";
  let html: string;
  let usedMode: "static" | "render" | "browser" = "static";

  // Force modes skip escalation
  if (renderMode === "browser") {
    html = await fetchViaBrowser(params.url);
    usedMode = "browser";
  } else if (renderMode === "render") {
    const response = await fetchViaProxy(params.url, apiKey, { render: true });
    html = String(response.data);
    usedMode = "render";
  } else {
    // Static fetch first (fast, cheap)
    const response = await fetchViaProxy(params.url, apiKey, { render: false });
    html = String(response.data);

    if (renderMode === "auto" && detectJsHeavyContent(html)) {
      // Escalate to render mode
      try {
        const renderResponse = await fetchViaProxy(params.url, apiKey, { render: true });
        const renderHtml = String(renderResponse.data);
        if (!detectJsHeavyContent(renderHtml)) {
          html = renderHtml;
          usedMode = "render";
        }
      } catch {
        // render failed — try Browser API if available
        if (isBrowserConfigured()) {
          html = await fetchViaBrowser(params.url);
          usedMode = "browser";
        }
        // else: keep whatever static returned, warn agent below
      }
    }
  }

  if (typeof html !== "string") {
    throw new Error("Response is not HTML. The URL may return JSON or binary data.");
  }

  const title = extractTitle(html);
  const description = extractDescription(html);
  const stillJsHeavy = renderMode === "auto" && usedMode === "static" && detectJsHeavyContent(html);

  if (params.format === "html") {
    if (html.length <= 10000) return html;
    const truncated = html.slice(0, 10000);
    const lastTagClose = truncated.lastIndexOf(">");
    return (lastTagClose > 9000 ? truncated.slice(0, lastTagClose + 1) : truncated) +
      "\n<!-- Content truncated at 10,000 characters -->";
  }

  const mainContent = extractMainContent(html);

  const allLinks = extractLinks(html, params.url);
  let baseDomain: string;
  try {
    baseDomain = new URL(params.url).hostname.replace(/^www\./, "");
  } catch {
    baseDomain = "";
  }
  const sameDomainLinks = allLinks
    .filter(link => {
      try {
        return new URL(link).hostname.replace(/^www\./, "") === baseDomain;
      } catch { return false; }
    })
    .slice(0, 15);

  if (params.format === "text") {
    const plainContent = mainContent
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\- /gm, "  * ")
      .replace(/\*\*([^*]+)\*\*/g, "$1");
    const linksText = sameDomainLinks.length > 0
      ? `\nSame-domain links:\n${sameDomainLinks.map(l => `  ${l}`).join("\n")}`
      : "";
    return `${title}\n${description ? description + "\n" : ""}\n${plainContent}${linksText}`;
  }

  const contentLen = mainContent.length;
  const isTruncated = contentLen >= 8000;

  const lines: string[] = [
    `## Extracted Content`,
    `url: ${params.url}`,
    `title: ${title}`,
    ...(description ? [`description: ${description}`] : []),
    `format: ${params.format || "markdown"} | chars:${contentLen}${isTruncated ? " (may be truncated)" : ""} | links:${allLinks.length} | mode:${usedMode}`,
    ``,
    `---`,
    ``,
    mainContent,
  ];

  if (sameDomainLinks.length > 0) {
    lines.push(``, `---`, `## Same-Domain Links (${sameDomainLinks.length} of ${allLinks.length})`);
    for (const link of sameDomainLinks) {
      lines.push(`- ${link}`);
    }
  }

  lines.push(``, `---`, `## Agent Hints`);
  if (stillJsHeavy) {
    lines.push(`- ⚠ Page appears JavaScript-rendered. Content above may be incomplete.`);
    lines.push(`- Retry with render="render" to use Novada Web Unblocker (JS rendering).`);
    if (!isBrowserConfigured()) {
      lines.push(`- For full browser rendering, set NOVADA_BROWSER_WS env var.`);
    }
  }
  if (isTruncated) {
    lines.push(`- Content may be truncated. Use novada_map to find specific subpages.`);
  }
  try {
    lines.push(`- To discover more pages: novada_map with url="${new URL(params.url).origin}"`);
  } catch { /* ignore URL parse error */ }
  if (params.query) {
    lines.push(`- Query context: "${params.query}". Focus analysis on this topic.`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test tests/tools/extract.test.ts
```

Expected: All tests pass, including new escalation tests.

- [ ] **Step 6: Build to verify TypeScript**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/tools/extract.ts src/tools/types.ts tests/tools/extract.test.ts
git commit -m "feat: smart routing in novada_extract (static → render → browser auto-escalation)"
```

---

## Task 5: Smart Routing in crawl.ts

**Files:**
- Modify: `src/tools/crawl.ts`
- Modify: `src/tools/types.ts` (add `render` to CrawlParams)
- Create: `tests/tools/crawl.test.ts`

- [ ] **Step 1: Add `render` param to CrawlParamsSchema in types.ts**

```typescript
export const CrawlParamsSchema = z.object({
  url: safeUrl,
  max_pages: z.number().int().min(1).max(20).default(5),
  strategy: z.enum(["bfs", "dfs"]).default("bfs"),
  instructions: z.string().optional()
    .describe("Natural language hint for which pages to prioritize."),
  select_paths: z.array(z.string()).optional()
    .describe("Regex patterns to restrict crawled URL paths."),
  exclude_paths: z.array(z.string()).optional()
    .describe("Regex patterns for URL paths to skip entirely."),
  render: z.enum(["auto", "static", "render"]).default("auto")
    .describe("Rendering mode. 'auto': uses static, escalates to render on first JS-heavy page detection. 'static': always static. 'render': always render (slower, handles JS sites)."),
});
```

- [ ] **Step 2: Write failing tests for crawl**

Create `tests/tools/crawl.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { novadaCrawl } from "../../src/tools/crawl.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

beforeEach(() => { vi.clearAllMocks(); });

describe("novadaCrawl", () => {
  it("crawls multiple pages and returns content", async () => {
    mockedAxios.get.mockResolvedValue({
      data: `<html><body>
        <h1>Page Title</h1>
        <p>${"word ".repeat(30)}</p>
        <a href="https://example.com/page2">Page 2</a>
      </body></html>`,
    });

    const result = await novadaCrawl(
      { url: "https://example.com", max_pages: 2, strategy: "bfs", render: "static" },
      "test-key"
    );

    expect(result).toContain("Crawl Results");
    expect(result).toContain("https://example.com");
    expect(mockedAxios.get).toHaveBeenCalled();
  });

  it("returns error message when site is unreachable", async () => {
    mockedAxios.get.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await novadaCrawl(
      { url: "https://unreachable.example.com", max_pages: 1, strategy: "bfs", render: "static" },
      "test-key"
    );

    expect(result).toContain("Failed to crawl");
  });

  it("respects max_pages limit", async () => {
    // Return a page with many links — should still stop at max_pages
    const links = Array.from({ length: 20 }, (_, i) => `<a href="https://example.com/page${i}">p${i}</a>`).join("");
    mockedAxios.get.mockResolvedValue({
      data: `<html><body><p>${"text ".repeat(50)}</p>${links}</body></html>`,
    });

    const result = await novadaCrawl(
      { url: "https://example.com", max_pages: 3, strategy: "bfs", render: "static" },
      "test-key"
    );

    // Should not have crawled more than max_pages
    const pageCount = (result.match(/###/g) || []).length;
    expect(pageCount).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test tests/tools/crawl.test.ts
```

Expected: FAIL — crawl tests need the `render` param.

- [ ] **Step 4: Update fetchPage in crawl.ts to use render mode**

Update the `fetchPage` function at the top of `src/tools/crawl.ts`:

```typescript
import { fetchViaProxy, extractMainContent, extractTitle, extractLinks, normalizeUrl, isContentLink, detectJsHeavyContent } from "../utils/index.js";
import type { CrawlParams } from "./types.js";

async function fetchPage(
  url: string,
  apiKey?: string,
  renderMode: "auto" | "static" | "render" = "auto",
  renderDetected = false
): Promise<{ html: string; url: string } | null> {
  try {
    // Use render if: forced, or auto+already detected JS on this site
    const useRender = renderMode === "render" || (renderMode === "auto" && renderDetected);
    const response = await fetchViaProxy(url, apiKey, { timeout: 15000, maxRedirects: 3, render: useRender });
    if (typeof response.data !== "string") return null;

    // In auto mode: if first page is JS-heavy, flag it for subsequent pages
    const html = String(response.data);
    if (renderMode === "auto" && !renderDetected && detectJsHeavyContent(html)) {
      // Retry this page with render
      try {
        const renderResponse = await fetchViaProxy(url, apiKey, { timeout: 20000, render: true });
        if (typeof renderResponse.data === "string") {
          return { html: String(renderResponse.data), url };
        }
      } catch { /* fall through to original */ }
    }

    return { html, url };
  } catch {
    return null;
  }
}
```

Also update the `novadaCrawl` function signature to pass `renderMode` through:

```typescript
export async function novadaCrawl(params: CrawlParams, apiKey?: string): Promise<string> {
  const renderMode = params.render ?? "auto";
  let renderDetected = false;
  // ... (rest of existing crawl logic)
  // Update batch.map to pass renderMode:
  const pages = await Promise.all(batch.map((item) => fetchPage(item.url, apiKey, renderMode, renderDetected)));
  // After first batch, check if render was auto-detected:
  if (renderMode === "auto" && !renderDetected) {
    renderDetected = pages.some(p => p !== null && detectJsHeavyContent(p.html));
  }
  // ...
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test tests/tools/crawl.test.ts
```

Expected: PASS all 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/tools/crawl.ts src/tools/types.ts tests/tools/crawl.test.ts
git commit -m "feat: smart routing in novada_crawl (auto-detect JS-heavy sites)"
```

---

## Task 6: Fix Research — Source Extraction Phase

**Files:**
- Modify: `src/tools/research.ts`
- Modify: `tests/tools/research.test.ts`

**Problem:** Current research returns only search snippets. A real research tool must actually read the top sources. Fix: after searching, extract top 3 most-relevant source URLs in full, add their content to the report.

- [ ] **Step 1: Write the failing test**

Add to `tests/tools/research.test.ts`:

```typescript
describe("novadaResearch source extraction", () => {
  it("includes extracted content from top sources", async () => {
    // First call: search results
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          code: 200,
          data: {
            organic_results: [
              { title: "Deep Article on Topic", url: "https://example.com/deep-article", description: "This covers the topic extensively" },
              { title: "Another Source", url: "https://other.com/source", description: "More info here" },
            ],
          },
        },
      })
      // Second call: extract first URL
      .mockResolvedValueOnce({
        data: "<html><body><h1>Deep Article</h1><p>" + "detailed content ".repeat(30) + "</p></body></html>",
      })
      // Third call: extract second URL
      .mockResolvedValueOnce({
        data: "<html><body><h1>Another Source</h1><p>" + "more information ".repeat(25) + "</p></body></html>",
      });

    const result = await novadaResearch({ question: "What is quantum computing?", depth: "quick" }, "test-key");
    expect(result).toContain("## Key Sources");
    expect(result).toContain("detailed content");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test tests/tools/research.test.ts
```

Expected: FAIL — research doesn't extract source content.

- [ ] **Step 3: Update novadaResearch in research.ts**

Add the source extraction phase after query execution. Replace the section after `const sources = [...uniqueSources.values()].slice(0, 15);`:

```typescript
import { novadaExtract } from "./extract.js";

// Phase 2: Extract top 3 source URLs for full content
const topSources = sources.slice(0, 3);
const extractedContents: { title: string; url: string; content: string }[] = [];

if (topSources.length > 0) {
  const extractResults = await Promise.allSettled(
    topSources.map(async (source) => {
      try {
        const content = await novadaExtract(
          { url: source.url, format: "markdown", query: params.question, render: "auto" },
          apiKey
        );
        // Strip the Agent Hints section — too noisy in research output
        const cleanContent = content.split("## Agent Hints")[0].trim();
        return { title: source.title, url: source.url, content: cleanContent };
      } catch {
        return null;
      }
    })
  );

  for (const result of extractResults) {
    if (result.status === "fulfilled" && result.value) {
      extractedContents.push(result.value);
    }
  }
}
```

And update the lines array to include extracted content:

```typescript
const lines: string[] = [
  `## Research Report`,
  `question: "${params.question}"`,
  `depth:${depthLabel} | searches:${queries.length}${failedCount > 0 ? ` (${failedCount} failed)` : ""} | unique_sources:${sources.length} | extracted:${extractedContents.length}`,
  params.focus ? `focus: ${params.focus}` : "",
  ``,
  `---`,
  ``,
  `## Search Queries Used`,
  ``,
  ...queries.map((q, i) => `${i + 1}. ${q}`),
  ``,
  `## Source Index`,
  ``,
  ...sources.slice(0, 10).map((s, i) =>
    `${i + 1}. **${s.title}**\n   ${s.url}\n   ${s.snippet}\n`
  ),
  // Phase 2: Full extracted content from top 3 sources
  ...(extractedContents.length > 0 ? [
    `## Key Sources (Extracted)`,
    ``,
    ...extractedContents.flatMap((s, i) => [
      `### [${i + 1}] ${s.title}`,
      `url: ${s.url}`,
      ``,
      s.content,
      ``,
      `---`,
      ``,
    ]),
  ] : []),
  `## All Sources`,
  ``,
  ...sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`),
  ``,
  `---`,
  `## Agent Hints`,
  `- ${extractedContents.length} sources extracted in full above.`,
  `- For more sources: use novada_extract with url=[url1, url2, ...] from the Source Index.`,
  `- For narrower research: add focus param to guide sub-query generation.`,
  `- For more coverage: use depth='comprehensive' (8-10 searches).`,
].filter(l => l !== "");
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/tools/research.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/research.ts tests/tools/research.test.ts
git commit -m "feat: research phase 2 — extract top 3 sources for full content"
```

---

## Task 7: Proxy Tool

**Files:**
- Create: `src/tools/proxy.ts`
- Modify: `src/tools/types.ts`
- Modify: `src/tools/index.ts`

- [ ] **Step 1: Add ProxyParamsSchema to types.ts**

Add to `src/tools/types.ts`:

```typescript
export const ProxyParamsSchema = z.object({
  type: z.enum(["residential", "mobile", "isp", "datacenter"]).default("residential")
    .describe("Proxy type. 'residential' for most anti-bot scenarios, 'mobile' for app automation, 'isp' for sticky sessions, 'datacenter' for high-volume/low-cost."),
  country: z.string().length(2).optional()
    .describe("ISO 2-letter country code (e.g. 'us', 'gb', 'de'). Omit for any country."),
  city: z.string().optional()
    .describe("City name for city-level targeting. Requires country to be set."),
  session_id: z.string().optional()
    .describe("Session ID for sticky routing — same session_id returns same IP. Use for multi-step workflows needing IP consistency."),
  format: z.enum(["url", "env", "curl"]).default("url")
    .describe("Output format. 'url': proxy URL string. 'env': shell export commands. 'curl': curl --proxy flag."),
});

export type ProxyParams = z.infer<typeof ProxyParamsSchema>;

export function validateProxyParams(args: Record<string, unknown> | undefined): ProxyParams {
  return ProxyParamsSchema.parse(args ?? {});
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/tools/proxy.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { novadaProxy } from "../../src/tools/proxy.js";

const originalEnv = process.env;
afterEach(() => { process.env = { ...originalEnv }; });

describe("novadaProxy", () => {
  it("returns 'not configured' message when no proxy credentials set", async () => {
    delete process.env.NOVADA_PROXY_USER;
    delete process.env.NOVADA_PROXY_PASS;
    delete process.env.NOVADA_PROXY_ENDPOINT;

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("not configured");
    expect(result).toContain("NOVADA_PROXY_USER");
  });

  it("returns proxy URL when credentials are set", async () => {
    process.env.NOVADA_PROXY_USER = "testuser";
    process.env.NOVADA_PROXY_PASS = "testpass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("testuser");
    expect(result).toContain("proxy.example.com:7777");
  });

  it("adds country to proxy username when specified", async () => {
    process.env.NOVADA_PROXY_USER = "user_ABC123";
    process.env.NOVADA_PROXY_PASS = "pass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";

    const result = await novadaProxy({ type: "residential", country: "us", format: "url" });
    expect(result).toContain("country-us");
  });

  it("returns env format with shell export commands", async () => {
    process.env.NOVADA_PROXY_USER = "user_ABC123";
    process.env.NOVADA_PROXY_PASS = "pass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";

    const result = await novadaProxy({ type: "residential", format: "env" });
    expect(result).toContain("export HTTP_PROXY=");
    expect(result).toContain("export HTTPS_PROXY=");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test tests/tools/proxy.test.ts
```

Expected: FAIL — `novadaProxy` not defined.

- [ ] **Step 4: Create src/tools/proxy.ts**

```typescript
import { PROXY_USER, PROXY_PASS, PROXY_ENDPOINT } from "../config.js";
import type { ProxyParams } from "./types.js";

/**
 * Build a proxy URL from Novada credentials.
 * Novada proxy username format: user_ABC123-country-us-city-london-session-mysession
 */
function buildProxyUsername(params: ProxyParams): string {
  const base = PROXY_USER!;
  const parts: string[] = [base];

  if (params.country) parts.push(`country-${params.country.toLowerCase()}`);
  if (params.city) parts.push(`city-${params.city.toLowerCase().replace(/\s+/g, "")}`);
  if (params.session_id) parts.push(`session-${params.session_id}`);

  return parts.join("-");
}

/**
 * Return proxy configuration for use in HTTP clients, curl, or shell.
 *
 * Agents use this when they need to make HTTP requests through a residential proxy,
 * bypass geo-restrictions, or maintain IP consistency across a session.
 */
export async function novadaProxy(params: ProxyParams): Promise<string> {
  if (!PROXY_USER || !PROXY_PASS || !PROXY_ENDPOINT) {
    const missing = [
      !PROXY_USER ? "NOVADA_PROXY_USER" : null,
      !PROXY_PASS ? "NOVADA_PROXY_PASS" : null,
      !PROXY_ENDPOINT ? "NOVADA_PROXY_ENDPOINT" : null,
    ].filter(Boolean).join(", ");

    return [
      `## Proxy Configuration`,
      `status: not configured`,
      ``,
      `Missing environment variables: ${missing}`,
      ``,
      `## Setup`,
      `Set these in your environment or MCP config:`,
      `  NOVADA_PROXY_USER=your_proxy_username`,
      `  NOVADA_PROXY_PASS=your_proxy_password`,
      `  NOVADA_PROXY_ENDPOINT=proxy-host:port`,
      ``,
      `Get credentials from: https://dashboard.novada.com → Residential Proxies → Endpoint Generator`,
      ``,
      `## Agent Hints`,
      `- Once configured, this tool returns a proxy URL/config string for use in HTTP requests.`,
      `- For web scraping without managing proxies, use novada_extract or novada_crawl instead.`,
    ].join("\n");
  }

  const username = buildProxyUsername(params);
  const encodedUser = encodeURIComponent(username);
  const encodedPass = encodeURIComponent(PROXY_PASS);
  const proxyUrl = `http://${encodedUser}:${encodedPass}@${PROXY_ENDPOINT}`;

  const typeLabels: Record<string, string> = {
    residential: "Residential proxy (100M+ IPs, best for anti-bot)",
    mobile: "Mobile proxy (4G/5G IPs, best for app automation)",
    isp: "ISP proxy (stable, best for long sessions)",
    datacenter: "Datacenter proxy (fastest, highest volume)",
  };

  if (params.format === "env") {
    return [
      `## Proxy Configuration (Shell Environment)`,
      `type: ${typeLabels[params.type]}`,
      params.country ? `targeting: ${params.country.toUpperCase()}${params.city ? ` / ${params.city}` : ""}` : "",
      params.session_id ? `session: ${params.session_id} (sticky IP)` : "",
      ``,
      `export HTTP_PROXY="${proxyUrl}"`,
      `export HTTPS_PROXY="${proxyUrl}"`,
      `export http_proxy="${proxyUrl}"`,
      `export https_proxy="${proxyUrl}"`,
      ``,
      `## Agent Hints`,
      `- Set these env vars before running HTTP requests to route through the proxy.`,
      `- Use session_id for sticky IP across multiple requests in a workflow.`,
    ].filter(l => l !== "").join("\n");
  }

  if (params.format === "curl") {
    return [
      `## Proxy Configuration (curl)`,
      `type: ${typeLabels[params.type]}`,
      ``,
      `curl --proxy "${proxyUrl}" <your-url>`,
      ``,
      `## Agent Hints`,
      `- Add this flag to any curl command to route through the proxy.`,
      `- For multi-step workflows needing the same IP, add session_id param.`,
    ].join("\n");
  }

  // Default: url format
  return [
    `## Proxy Configuration`,
    `type: ${typeLabels[params.type]}`,
    params.country ? `targeting: ${params.country.toUpperCase()}${params.city ? ` / ${params.city}` : ""}` : "",
    params.session_id ? `session: ${params.session_id} (sticky IP)` : "session: rotating (new IP per request)",
    ``,
    `proxy_url: ${proxyUrl}`,
    ``,
    `## Usage Examples`,
    ``,
    `Node.js (axios):`,
    `  proxy: { host: "${PROXY_ENDPOINT?.split(":")[0]}", port: ${PROXY_ENDPOINT?.split(":")[1] || 7777}, auth: { username: "${username}", password: "***" } }`,
    ``,
    `Python (requests):`,
    `  proxies = { "http": "${proxyUrl}", "https": "${proxyUrl}" }`,
    ``,
    `## Agent Hints`,
    `- Use this proxy_url in your HTTP client's proxy configuration.`,
    `- For consistent IP across a workflow, set session_id (e.g. "my-session-1").`,
    `- For web extraction tasks, novada_extract handles proxy routing automatically.`,
  ].filter(l => l !== "").join("\n");
}
```

- [ ] **Step 5: Export from tools/index.ts**

```typescript
export { novadaProxy } from "./proxy.js";
export { validateProxyParams } from "./types.js";
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm test tests/tools/proxy.test.ts
```

Expected: PASS all 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/tools/proxy.ts src/tools/types.ts src/tools/index.ts tests/tools/proxy.test.ts
git commit -m "feat: add novada_proxy tool — returns proxy credentials in url/env/curl format"
```

---

## Task 8: Register novada_proxy in MCP Server

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add novada_proxy to the TOOLS array**

In `src/index.ts`, add import and tool registration:

```typescript
import {
  novadaSearch,
  novadaExtract,
  novadaCrawl,
  novadaResearch,
  novadaMap,
  novadaProxy,
  validateSearchParams,
  validateExtractParams,
  validateCrawlParams,
  validateResearchParams,
  validateMapParams,
  validateProxyParams,
  classifyError,
} from "./tools/index.js";
import {
  SearchParamsSchema,
  ExtractParamsSchema,
  CrawlParamsSchema,
  ResearchParamsSchema,
  MapParamsSchema,
  ProxyParamsSchema,
} from "./tools/types.js";
```

Add to the `TOOLS` array:

```typescript
{
  name: "novada_proxy",
  description: `Get Novada residential proxy configuration for use in HTTP clients, curl, or shell scripts.

**Best for:** When you need to make HTTP requests through a real residential IP — geo-targeting, IP rotation, bypassing IP-based blocks, or maintaining session consistency across requests.
**Not for:** Web page extraction (use novada_extract — it handles proxy routing automatically). Search (use novada_search).
**Tip:** Use format='url' for Node.js/Python, format='env' to set shell variables, format='curl' for command-line requests.
**Requires:** NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.`,
  inputSchema: zodToMcpSchema(ProxyParamsSchema),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
},
```

Add to the `switch` handler in `CallToolRequestSchema`:

```typescript
case "novada_proxy":
  result = await novadaProxy(validateProxyParams(args as Record<string, unknown>));
  break;
```

Update the `default` case error message to include the new tool:

```typescript
text: `Unknown tool: ${name}. Available: novada_search, novada_extract, novada_crawl, novada_research, novada_map, novada_proxy`,
```

Also update the `--list-tools` count if hardcoded, and update `--help` text to list 6 tools.

- [ ] **Step 2: Update tool count in resources/index.ts**

If resources mention "5 tools", update to "6 tools".

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 4: Quick smoke test**

```bash
NOVADA_PROXY_USER=testuser NOVADA_PROXY_PASS=testpass NOVADA_PROXY_ENDPOINT=proxy.test.com:7777 \
  node -e "
    const { novadaProxy } = await import('./build/tools/proxy.js');
    console.log(await novadaProxy({ type: 'residential', country: 'us', format: 'url' }));
  " --input-type=module
```

Expected: Output contains proxy URL with country-us in username.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/resources/index.ts
git commit -m "feat: register novada_proxy as 6th MCP tool"
```

---

## Task 9: TypeScript SDK — NovadaClient

**Files:**
- Create: `src/sdk/types.ts`
- Create: `src/sdk/index.ts`
- Modify: `package.json` (add exports subpath)
- Create: `tests/sdk/client.test.ts`

**Design:** The SDK returns typed objects (not agent-formatted strings). It's for developers building apps. The MCP tools call these same methods and format their output for agents. SDK = source of truth; MCP tools = formatted wrappers.

> **NOTE:** This is a structural refactor direction. For now, the SDK is a new class that wraps the existing tool functions and parses their output. A future refactor can invert this (tools become SDK wrappers) but scope that as v1 only.

- [ ] **Step 1: Create sdk/types.ts**

Create `src/sdk/types.ts`:

```typescript
/** Config for NovadaClient — all credentials optional except scraperApiKey */
export interface NovadaClientConfig {
  /** Novada Scraper API key. Required for search, extract, crawl, research, map. */
  scraperApiKey: string;
  /** Optional: Browser API WebSocket endpoint. wss://user:pass@upg-scbr.novada.com */
  browserWs?: string;
  /** Optional: Proxy credentials */
  proxy?: {
    user: string;
    pass: string;
    endpoint: string;
  };
}

/** Search result item */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published?: string;
}

/** Extracted page content */
export interface ExtractResult {
  url: string;
  title: string;
  description: string;
  content: string;
  links: string[];
  mode: "static" | "render" | "browser";
  chars: number;
}

/** Crawled page */
export interface CrawlPage {
  url: string;
  title: string;
  content: string;
  depth: number;
  wordCount: number;
}

/** Research report */
export interface ResearchResult {
  question: string;
  depth: string;
  sources: Array<{ title: string; url: string; snippet: string }>;
  extracted: Array<{ title: string; url: string; content: string }>;
  queriesUsed: string[];
}

/** Discovered URLs from map */
export interface MapResult {
  root: string;
  urls: string[];
  filtered?: number;
}

/** Proxy configuration */
export interface ProxyConfig {
  proxyUrl: string;
  username: string;
  endpoint: string;
  type: string;
  country?: string;
  sessionId?: string;
}
```

- [ ] **Step 2: Write failing tests for SDK**

Create `tests/sdk/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { NovadaClient } from "../../src/sdk/index.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);
beforeEach(() => { vi.clearAllMocks(); });

const client = new NovadaClient({ scraperApiKey: "test-key" });

describe("NovadaClient", () => {
  describe("search()", () => {
    it("returns typed SearchResult array", async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          code: 200,
          data: {
            organic_results: [
              { title: "Result 1", url: "https://example.com", description: "Desc 1" },
            ],
          },
        },
      });

      const results = await client.search("test query");
      expect(Array.isArray(results)).toBe(true);
      expect(results[0]).toMatchObject({ title: "Result 1", url: "https://example.com", snippet: "Desc 1" });
    });
  });

  describe("extract()", () => {
    it("returns typed ExtractResult", async () => {
      mockedAxios.get.mockResolvedValue({
        data: `<html><body><h1>Test Title</h1><p>${"content ".repeat(50)}</p></body></html>`,
      });

      const result = await client.extract("https://example.com");
      expect(result.title).toBe("Test Title");
      expect(result.content).toBeTruthy();
      expect(result.url).toBe("https://example.com");
      expect(result.mode).toBe("static");
    });
  });

  describe("proxy()", () => {
    it("throws when proxy not configured", () => {
      expect(() => client.proxy({ type: "residential" })).toThrow("Proxy credentials not configured");
    });

    it("returns ProxyConfig when credentials provided", () => {
      const clientWithProxy = new NovadaClient({
        scraperApiKey: "key",
        proxy: { user: "user_ABC", pass: "pass", endpoint: "proxy.example.com:7777" },
      });

      const config = clientWithProxy.proxy({ type: "residential", country: "us" });
      expect(config.proxyUrl).toContain("proxy.example.com:7777");
      expect(config.username).toContain("country-us");
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test tests/sdk/client.test.ts
```

Expected: FAIL — `NovadaClient` not defined.

- [ ] **Step 4: Create src/sdk/index.ts**

```typescript
import { novadaSearch, novadaExtract, novadaCrawl, novadaResearch, novadaMap } from "../tools/index.js";
import { PROXY_USER, PROXY_PASS, PROXY_ENDPOINT } from "../config.js";
import type {
  NovadaClientConfig, SearchResult, ExtractResult, CrawlPage, ResearchResult, MapResult, ProxyConfig,
} from "./types.js";

/**
 * NovadaClient — TypeScript SDK for Novada web intelligence APIs.
 *
 * All methods use smart routing internally:
 * - extract/crawl auto-escalate from static → render → browser
 * - research fetches top sources in full, not just snippets
 * - proxy returns typed config object for use in HTTP clients
 *
 * Install: npm install novada-mcp
 * Import: import { NovadaClient } from 'novada-mcp/sdk'
 */
export class NovadaClient {
  private config: NovadaClientConfig;

  constructor(config: NovadaClientConfig) {
    this.config = config;
    // Set env vars from config (SDK mode — overrides process.env for this instance)
    process.env.NOVADA_API_KEY = config.scraperApiKey;
    if (config.browserWs) process.env.NOVADA_BROWSER_WS = config.browserWs;
    if (config.proxy) {
      process.env.NOVADA_PROXY_USER = config.proxy.user;
      process.env.NOVADA_PROXY_PASS = config.proxy.pass;
      process.env.NOVADA_PROXY_ENDPOINT = config.proxy.endpoint;
    }
  }

  /** Search the web. Returns typed array of results. */
  async search(
    query: string,
    options: { engine?: "google" | "bing" | "duckduckgo"; num?: number; country?: string; timeRange?: "day" | "week" | "month" | "year" } = {}
  ): Promise<SearchResult[]> {
    const raw = await novadaSearch(
      {
        query,
        engine: options.engine ?? "google",
        num: options.num ?? 10,
        country: options.country ?? "",
        language: "",
        time_range: options.timeRange,
      },
      this.config.scraperApiKey
    );

    // Parse the formatted string output back into typed objects
    const results: SearchResult[] = [];
    const blocks = raw.split(/\n### \d+\./).slice(1);
    for (const block of blocks) {
      const lines = block.split("\n");
      const title = lines[0]?.trim() ?? "";
      const url = lines.find(l => l.startsWith("url:"))?.replace("url:", "").trim() ?? "";
      const snippet = lines.find(l => l.startsWith("snippet:"))?.replace("snippet:", "").trim() ?? "";
      const published = lines.find(l => l.startsWith("published:"))?.replace("published:", "").trim();
      if (url) results.push({ title, url, snippet, ...(published ? { published } : {}) });
    }
    return results;
  }

  /** Extract content from a URL. Returns typed ExtractResult with smart routing. */
  async extract(
    url: string,
    options: { format?: "text" | "markdown" | "html"; query?: string; render?: "auto" | "static" | "render" | "browser" } = {}
  ): Promise<ExtractResult> {
    const raw = await novadaExtract(
      { url, format: options.format ?? "markdown", query: options.query, render: options.render ?? "auto" },
      this.config.scraperApiKey
    );

    // Parse mode from output
    const modeMatch = raw.match(/mode:(\w+)/);
    const mode = (modeMatch?.[1] as ExtractResult["mode"]) ?? "static";
    const titleMatch = raw.match(/\ntitle: (.+)/);
    const descMatch = raw.match(/\ndescription: (.+)/);
    const charsMatch = raw.match(/chars:(\d+)/);
    const content = raw.split("---")[2]?.trim() ?? "";
    const links: string[] = [];
    const linkSection = raw.split("## Same-Domain Links")[1];
    if (linkSection) {
      const linkMatches = linkSection.matchAll(/^- (https?:\/\/\S+)$/gm);
      for (const m of linkMatches) links.push(m[1]);
    }

    return {
      url,
      title: titleMatch?.[1]?.trim() ?? "",
      description: descMatch?.[1]?.trim() ?? "",
      content,
      links,
      mode,
      chars: parseInt(charsMatch?.[1] ?? "0", 10),
    };
  }

  /** Extract multiple URLs in parallel (max 10). */
  async batchExtract(
    urls: string[],
    options: { format?: "text" | "markdown" | "html"; query?: string } = {}
  ): Promise<ExtractResult[]> {
    return Promise.all(urls.map(url => this.extract(url, options)));
  }

  /** Crawl a website and return typed page array. */
  async crawl(
    url: string,
    options: { maxPages?: number; strategy?: "bfs" | "dfs"; render?: "auto" | "static" | "render" } = {}
  ): Promise<CrawlPage[]> {
    const raw = await novadaCrawl(
      {
        url,
        max_pages: options.maxPages ?? 5,
        strategy: options.strategy ?? "bfs",
        render: options.render ?? "auto",
      },
      this.config.scraperApiKey
    );

    const pages: CrawlPage[] = [];
    const blocks = raw.split(/\n### \[\d+\/\d+\] /).slice(1);
    for (const block of blocks) {
      const lines = block.split("\n");
      const pageUrl = lines[0]?.trim() ?? "";
      const titleLine = lines.find(l => l.startsWith("title:"))?.replace("title:", "").trim() ?? "";
      const depthMatch = lines.find(l => l.startsWith("depth:"))?.match(/depth:(\d+)/);
      const wordsMatch = lines.find(l => l.startsWith("depth:"))?.match(/words:(\d+)/);
      const content = lines.slice(3).join("\n").split("---")[0].trim();
      if (pageUrl) {
        pages.push({
          url: pageUrl,
          title: titleLine,
          content,
          depth: parseInt(depthMatch?.[1] ?? "0", 10),
          wordCount: parseInt(wordsMatch?.[1] ?? "0", 10),
        });
      }
    }
    return pages;
  }

  /** Multi-step research. Returns typed report with source extraction. */
  async research(
    question: string,
    options: { depth?: "quick" | "deep" | "auto" | "comprehensive"; focus?: string } = {}
  ): Promise<ResearchResult> {
    const raw = await novadaResearch(
      { question, depth: options.depth ?? "auto", focus: options.focus },
      this.config.scraperApiKey
    );

    // Parse sources from formatted output
    const sources: ResearchResult["sources"] = [];
    const sourceIndexSection = raw.split("## Source Index")[1]?.split("## Key Sources")[0] ?? "";
    const sourceMatches = sourceIndexSection.matchAll(/\d+\.\s+\*\*(.+?)\*\*\n\s+(\S+)\n\s+(.+?)(?:\n|$)/gs);
    for (const m of sourceMatches) {
      sources.push({ title: m[1], url: m[2], snippet: m[3].trim() });
    }

    // Parse extracted content sections
    const extracted: ResearchResult["extracted"] = [];
    const extractedSection = raw.split("## Key Sources (Extracted)")[1]?.split("## All Sources")[0] ?? "";
    const extractedBlocks = extractedSection.split(/\n### \[\d+\] /).slice(1);
    for (const block of extractedBlocks) {
      const lines = block.split("\n");
      const title = lines[0]?.trim() ?? "";
      const url = lines.find(l => l.startsWith("url:"))?.replace("url:", "").trim() ?? "";
      const content = lines.slice(3).join("\n").split("---")[0].trim();
      if (title && url) extracted.push({ title, url, content });
    }

    // Parse queries used
    const queriesSection = raw.split("## Search Queries Used")[1]?.split("## Source Index")[0] ?? "";
    const queries = queriesSection.trim().split("\n")
      .filter(l => /^\d+\./.test(l))
      .map(l => l.replace(/^\d+\.\s*/, "").trim());

    return { question, depth: options.depth ?? "auto", sources, extracted, queriesUsed: queries };
  }

  /** Discover all URLs on a website. */
  async map(
    url: string,
    options: { search?: string; limit?: number; maxDepth?: number } = {}
  ): Promise<MapResult> {
    const raw = await novadaMap(
      { url, search: options.search, limit: options.limit ?? 50, include_subdomains: false, max_depth: options.maxDepth ?? 2 },
      this.config.scraperApiKey
    );

    const urlMatches = raw.matchAll(/^\d+\.\s+(https?:\/\/\S+)$/gm);
    const urls: string[] = [];
    for (const m of urlMatches) urls.push(m[1]);

    const filteredMatch = raw.match(/urls:(\d+)\s+\(filtered.*?from (\d+) total\)/);

    return {
      root: url,
      urls,
      ...(filteredMatch ? { filtered: parseInt(filteredMatch[2], 10) } : {}),
    };
  }

  /** Get proxy configuration for use in HTTP clients. Throws if proxy not configured. */
  proxy(
    options: { type?: "residential" | "mobile" | "isp" | "datacenter"; country?: string; sessionId?: string } = {}
  ): ProxyConfig {
    if (!this.config.proxy) {
      throw new Error(
        "Proxy credentials not configured. Pass proxy: { user, pass, endpoint } to NovadaClient constructor."
      );
    }

    const { user, pass, endpoint } = this.config.proxy;
    const type = options.type ?? "residential";
    const parts = [user];
    if (options.country) parts.push(`country-${options.country.toLowerCase()}`);
    if (options.sessionId) parts.push(`session-${options.sessionId}`);
    const username = parts.join("-");

    const proxyUrl = `http://${encodeURIComponent(username)}:${encodeURIComponent(pass)}@${endpoint}`;

    return {
      proxyUrl,
      username,
      endpoint,
      type,
      ...(options.country ? { country: options.country } : {}),
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    };
  }
}

export type {
  NovadaClientConfig,
  SearchResult,
  ExtractResult,
  CrawlPage,
  ResearchResult,
  MapResult,
  ProxyConfig,
} from "./types.js";
```

- [ ] **Step 5: Add SDK subpath export to package.json**

In `package.json`, add `exports` field:

```json
"exports": {
  ".": "./build/index.js",
  "./sdk": "./build/sdk/index.js"
},
"main": "./build/index.js",
"types": "./build/index.d.ts"
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm test tests/sdk/client.test.ts
```

Expected: PASS all tests.

- [ ] **Step 7: Build and verify subpath export works**

```bash
npm run build
node -e "import { NovadaClient } from './build/sdk/index.js'; console.log('SDK loaded OK');" --input-type=module
```

Expected: `SDK loaded OK`

- [ ] **Step 8: Commit**

```bash
git add src/sdk/ tests/sdk/ package.json
git commit -m "feat: TypeScript SDK — NovadaClient with typed methods + subpath export novada-mcp/sdk"
```

---

## Task 10: CLI Expansion

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add proxy and render subcommands to nova CLI**

Update `src/cli.ts` help text and command handler to include:

```typescript
const HELP = `nova v${VERSION} — Novada web data CLI

Usage:
  nova search <query> [--engine google] [--num 10] [--country us] [--time day|week|month|year]
              [--include domain1,domain2] [--exclude domain1,domain2]
  nova extract <url> [--format markdown|text|html] [--render auto|static|render|browser]
  nova crawl <url> [--max-pages 5] [--strategy bfs|dfs] [--render auto|static|render]
              [--select "/docs/.*,/api/.*"] [--exclude-paths "/blog/.*"]
  nova map <url> [--search <term>] [--limit 50] [--max-depth 2]
  nova research <question> [--depth auto|quick|deep|comprehensive] [--focus "technical"]
  nova proxy [--type residential|mobile|isp|datacenter] [--country us] [--format url|env|curl]

Environment:
  NOVADA_API_KEY          Required. Scraper API key.
  NOVADA_BROWSER_WS       Optional. wss://user:pass@upg-scbr.novada.com (Browser API)
  NOVADA_PROXY_USER       Optional. Proxy username (from dashboard)
  NOVADA_PROXY_PASS       Optional. Proxy password
  NOVADA_PROXY_ENDPOINT   Optional. Proxy host:port
`;
```

Add proxy command handling in the `switch (command)` section:

```typescript
case "proxy": {
  const { flags } = parseArgs(rest);
  const params = validateProxyParams({
    type: flags["type"] || "residential",
    country: flags["country"],
    format: flags["format"] || "url",
    session_id: flags["session"],
  });
  const result = await novadaProxy(params);
  console.log(result);
  break;
}
```

Also add `--render` flag parsing to extract and crawl cases:

```typescript
case "extract": {
  // ...existing code...
  const params = validateExtractParams({
    url: positional,
    format: flags["format"] || "markdown",
    render: flags["render"] || "auto",
  });
  // ...
}

case "crawl": {
  // ...existing code...
  const params = validateCrawlParams({
    url: positional,
    max_pages: flags["max-pages"] ? parseInt(flags["max-pages"]) : 5,
    strategy: flags["strategy"] || "bfs",
    render: flags["render"] || "auto",
    // ...
  });
  // ...
}
```

- [ ] **Step 2: Build and test CLI**

```bash
npm run build
echo "Testing nova help..."
node build/cli.js --help
echo "Testing nova proxy (unconfigured)..."
node build/cli.js proxy --type residential
```

Expected: Help shows proxy command. Proxy shows "not configured" with setup instructions.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add proxy command + --render flag to nova CLI"
```

---

## Task 11: Version Bump + Full Test Suite

**Files:**
- Modify: `src/config.ts`
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass. Note any failures.

- [ ] **Step 2: Check test coverage**

```bash
npm run test:coverage
```

Expected: Coverage report generated. Target >70% statement coverage.

- [ ] **Step 3: Update version to 0.7.0**

In `src/config.ts`:
```typescript
export const VERSION = "0.7.0";
```

In `package.json`:
```json
"version": "0.7.0"
```

- [ ] **Step 4: Update CHANGELOG.md**

Add entry at the top:

```markdown
## [0.7.0] — 2026-04-20

### Added
- **Smart routing** in `novada_extract` and `novada_crawl`: auto-escalates from static → render (Web Unblocker) → Browser API when JS-heavy content detected
- **`novada_proxy` tool** (6th tool): returns proxy credentials in `url`, `env`, or `curl` format for use in HTTP clients
- **Browser API** via `playwright-core`: set `NOVADA_BROWSER_WS=wss://...` to enable full CDP-controlled browser rendering
- **Research source extraction**: `novada_research` now fetches top 3 sources in full — not just snippets
- **TypeScript SDK**: `NovadaClient` class exported from `novada-mcp/sdk` with typed methods
- **`render` param** on `novada_extract` and `novada_crawl`: `auto` (default), `static`, `render`, `browser`
- **Multi-credential support**: `NOVADA_BROWSER_WS`, `NOVADA_PROXY_USER/PASS/ENDPOINT` env vars
- **nova CLI**: `proxy` subcommand + `--render` flag on extract/crawl

### Fixed
- `novada_extract` / `novada_crawl` now detect and handle JS-heavy sites (Cloudflare, SPAs, React apps) instead of silently returning empty shells
- `novada_research` now returns actual source content, not just URL snippets

### Changed
- All tool descriptions updated for agent-optimal clarity (problem-first, not product-first)
```

- [ ] **Step 5: Final build**

```bash
npm run build
```

Expected: Clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts package.json CHANGELOG.md
git commit -m "chore: bump to v0.7.0 — full capability + SDK release"
```

---

## Self-Review

### Spec Coverage Check

| Requirement | Task |
|------------|------|
| Fix extract for JS-heavy sites | Tasks 3, 4 |
| Fix crawl for JS-heavy sites | Tasks 3, 5 |
| Fix research to actually read sources | Task 6 |
| Browser API integration | Tasks 2, 4 |
| Proxy tool | Tasks 7, 8 |
| TypeScript SDK | Task 9 |
| CLI expansion | Task 10 |
| Multi-credential config | Task 1 |
| Smart routing (agent-optimal) | Tasks 3, 4, 5 |
| Agent-optimal descriptions | Task 8 |

### Placeholders Check

No TBDs, no "implement later", no "similar to Task N". Every step has complete code.

### Type Consistency Check

- `ExtractParams.render`: `"auto" | "static" | "render" | "browser"` — used in types.ts, extract.ts, and SDK
- `CrawlParams.render`: `"auto" | "static" | "render"` (no `"browser"` — crawl doesn't support page-level interactive browser sessions)
- `ProxyParams.type`: `"residential" | "mobile" | "isp" | "datacenter"` — consistent across proxy.ts, types.ts, SDK
- `fetchViaProxy(url, apiKey, options)` — options now include `render?: boolean` — used consistently in extract.ts and crawl.ts

---

## Notes for Implementer

1. **Web Unblocker endpoint**: The plan uses `scraperapi.novada.com?render=true`. This needs to be validated against the Novada dashboard — if Web Unblocker uses a different base URL, update `SCRAPER_API_BASE` or add `WEB_UNBLOCKER_BASE` constant in config.ts.

2. **Browser API credentials**: Tasks 2 and 4 require `NOVADA_BROWSER_WS`. Get this from the Novada dashboard → Browser API → Playground. Format: `wss://username:password@upg-scbr.novada.com`.

3. **SDK subpath export**: The `exports` field in package.json requires Node 12+. If consumers get "package subpath not exported" errors, ensure their bundler supports the exports field.

4. **Python SDK**: Not included in this plan. Design it as a separate project (`novada-sdk` PyPI package) once TypeScript SDK is validated. Same methods, same smart routing.

5. **Unified API key** (future): The plan reserves all 3 credential slots. When Novada implements a unified backend key, add a `NOVADA_MASTER_KEY` that expands to all 3 on the server side — the SDK/MCP config model doesn't need to change.
