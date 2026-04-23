/** Config for NovadaClient */
export interface NovadaClientConfig {
  /** Novada Scraper API key. Required. Get one at https://www.novada.com */
  scraperApiKey: string;
  /**
   * Optional: Novada Web Unblocker key (separate from scraperApiKey).
   * Enables JS rendering for novada_extract and novada_crawl on JS-heavy sites.
   * Without this, extract/crawl falls back to static fetch only.
   */
  webUnblockerKey?: string;
  /** Optional: Browser API WebSocket endpoint. wss://user:pass@upg-scbr.novada.com */
  browserWs?: string;
  /** Optional: Proxy credentials */
  proxy?: {
    user: string;
    pass: string;
    endpoint: string;
  };
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published?: string;
}

export interface ExtractResult {
  url: string;
  title: string;
  description: string;
  content: string;
  links: string[];
  /** render-failed = escalation was attempted but JS rendering failed; content is from static fallback */
  mode: "static" | "render" | "browser" | "render-failed";
  chars: number;
}

export interface CrawlPage {
  url: string;
  title: string;
  content: string;
  depth: number;
  wordCount: number;
}

export interface ResearchResult {
  question: string;
  depth: string;
  sources: Array<{ title: string; url: string; snippet: string }>;
  extracted: Array<{ title: string; url: string; content: string }>;
  queriesUsed: string[];
}

export interface MapResult {
  root: string;
  urls: string[];
  filtered?: number;
}

export interface ProxyConfig {
  proxyUrl: string;
  username: string;
  endpoint: string;
  type: string;
  country?: string;
  sessionId?: string;
}

export interface ScrapeResult {
  /** Platform domain (e.g. 'amazon.com') */
  platform: string;
  /** Operation ID (e.g. 'amazon_product_by-keywords') */
  operation: string;
  /** Parsed records array (available when format='json') */
  records: Record<string, unknown>[];
  /** Formatted output string (markdown/csv/html/xlsx depending on format option) */
  formatted: string;
}

export interface VerifyResult {
  claim: string;
  verdict: "supported" | "unsupported" | "contested" | "insufficient_data";
  /** 0 = completely uncertain, 100 = all evidence agrees */
  confidence: number;
  /** Full formatted output from novada_verify */
  raw: string;
}
