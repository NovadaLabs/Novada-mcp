import { novadaSearch, novadaExtract, novadaCrawl, novadaResearch, novadaMap, novadaScrape, novadaVerify } from "../tools/index.js";
import type {
  NovadaClientConfig, SearchResult, ExtractResult, CrawlPage,
  ResearchResult, MapResult, ProxyConfig, ScrapeResult, VerifyResult,
} from "./types.js";

/**
 * NovadaClient — TypeScript SDK for Novada web intelligence APIs.
 *
 * Install: npm install novada-mcp
 * Import:  import { NovadaClient } from 'novada-mcp/sdk'
 */
export class NovadaClient {
  private config: NovadaClientConfig;

  constructor(config: NovadaClientConfig) {
    this.config = config;
    process.env.NOVADA_API_KEY = config.scraperApiKey;
    if (config.webUnblockerKey) process.env.NOVADA_WEB_UNBLOCKER_KEY = config.webUnblockerKey;
    if (config.browserWs) process.env.NOVADA_BROWSER_WS = config.browserWs;
    if (config.proxy) {
      process.env.NOVADA_PROXY_USER = config.proxy.user;
      process.env.NOVADA_PROXY_PASS = config.proxy.pass;
      process.env.NOVADA_PROXY_ENDPOINT = config.proxy.endpoint;
    }
    // TODO(v2): refactor to pass keys explicitly to tool functions instead of
    // mutating process.env — prevents multi-client interference in server environments
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

    // Parse the formatted markdown output into typed objects
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

  /** Extract content from a URL. Returns typed ExtractResult. */
  async extract(
    url: string,
    options: { format?: "text" | "markdown" | "html"; query?: string; render?: "auto" | "static" | "render" | "browser" } = {}
  ): Promise<ExtractResult> {
    const raw = await novadaExtract(
      { url, format: options.format ?? "markdown", query: options.query, render: options.render ?? "auto" },
      this.config.scraperApiKey
    );

    const modeMatch = raw.match(/\| mode:(\w+)/);
    const mode = (modeMatch?.[1] as ExtractResult["mode"]) ?? "static";
    const titleMatch = raw.match(/\ntitle: (.+)/);
    const descMatch = raw.match(/\ndescription: (.+)/);
    const charsMatch = raw.match(/chars:(\d+)/);

    // Content is between the first and second --- separators
    const parts = raw.split("\n---\n");
    const content = parts[1]?.trim() ?? "";

    const links: string[] = [];
    const linkSection = raw.split("## Same-Domain Links")[1];
    if (linkSection) {
      for (const m of linkSection.matchAll(/^- (https?:\/\/\S+)$/gm)) links.push(m[1]);
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
      const depthMatch = block.match(/depth:(\d+)/);
      const wordsMatch = block.match(/words:(\d+)/);
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

  /** Multi-step research. Returns structured report. */
  async research(
    question: string,
    options: { depth?: "quick" | "deep" | "auto" | "comprehensive"; focus?: string } = {}
  ): Promise<ResearchResult> {
    const raw = await novadaResearch(
      { question, depth: options.depth ?? "auto", focus: options.focus },
      this.config.scraperApiKey
    );

    const sources: ResearchResult["sources"] = [];
    const sourceSection = raw.split("## Key Findings")[1]?.split("## Key Sources")[0] ?? raw.split("## Source Index")[1]?.split("## Key Sources")[0] ?? "";
    for (const m of sourceSection.matchAll(/\*\*(.+?)\*\*\n\s+(https?:\/\/\S+)\n\s+(.+?)(?:\n|$)/gs)) {
      sources.push({ title: m[1], url: m[2], snippet: m[3].trim() });
    }

    const extracted: ResearchResult["extracted"] = [];
    const extractedSection = raw.split("## Key Sources (Extracted)")[1]?.split("## Sources")[0]?.split("## All Sources")[0] ?? "";
    for (const block of extractedSection.split(/\n### \[\d+\] /).slice(1)) {
      const title = block.split("\n")[0]?.trim() ?? "";
      const url = block.match(/url: (.+)/)?.[1]?.trim() ?? "";
      const content = block.split("\n").slice(3).join("\n").split("---")[0].trim();
      if (title && url) extracted.push({ title, url, content });
    }

    const queries: string[] = [];
    const queriesSection = raw.split("## Search Queries Used")[1]?.split(/## (Key Findings|Source Index)/)[0] ?? "";
    for (const m of queriesSection.matchAll(/^\d+\.\s+(.+)$/gm)) queries.push(m[1]);

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

    const urls: string[] = [];
    for (const m of raw.matchAll(/^\d+\.\s+(https?:\/\/\S+)$/gm)) urls.push(m[1]);

    const filteredMatch = raw.match(/urls:\d+\s+\(filtered.*?from (\d+) total\)/);

    return { root: url, urls, ...(filteredMatch ? { filtered: parseInt(filteredMatch[1], 10) } : {}) };
  }

  /**
   * Scrape structured data from 129 supported platforms.
   * Returns raw records array plus the formatted string output.
   */
  async scrape(
    platform: string,
    operation: string,
    params: Record<string, unknown> = {},
    options: { format?: "markdown" | "json" | "csv" | "html" | "xlsx"; limit?: number } = {}
  ): Promise<ScrapeResult> {
    const formatted = await novadaScrape(
      {
        platform,
        operation,
        params,
        format: options.format ?? "json",
        limit: options.limit ?? 20,
      },
      this.config.scraperApiKey
    );

    // Parse JSON fenced block if format=json
    const jsonMatch = formatted.match(/```json\n([\s\S]+?)\n```/);
    let records: Record<string, unknown>[] = [];
    if (jsonMatch) {
      try { records = JSON.parse(jsonMatch[1]); } catch { /* keep empty */ }
    }

    return { platform, operation, records, formatted };
  }

  /** Verify a factual claim against live web sources. Returns verdict + confidence. */
  async verify(claim: string, context?: string): Promise<VerifyResult> {
    const raw = await novadaVerify(
      { claim, context },
      this.config.scraperApiKey
    );

    // Parse verdict from output: "verdict: supported" etc.
    const verdictMatch = raw.match(/^verdict:\s*(supported|unsupported|contested|insufficient_data)/m);
    const verdict = (verdictMatch?.[1] ?? "insufficient_data") as VerifyResult["verdict"];

    // Parse confidence from output: "confidence: 73"
    const confidenceMatch = raw.match(/^confidence:\s*(\d+)/m);
    const confidence = parseInt(confidenceMatch?.[1] ?? "0", 10);

    return { claim, verdict, confidence, raw };
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
  NovadaClientConfig, SearchResult, ExtractResult, CrawlPage,
  ResearchResult, MapResult, ProxyConfig, ScrapeResult, VerifyResult,
} from "./types.js";
