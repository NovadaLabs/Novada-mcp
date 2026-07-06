import type { BenchmarkProvider } from "./base.js";
import { scoreContentQuality, withLatency } from "./base.js";
import type { ExtractionResult, CategoryName } from "../types.js";

/** Firecrawl API v1 — https://docs.firecrawl.dev/api-reference */
export class FirecrawlProvider implements BenchmarkProvider {
  name = "firecrawl" as const;
  private apiKey: string;
  private baseUrl = "https://api.firecrawl.dev/v1";

  constructor() {
    this.apiKey = process.env.FIRECRAWL_API_KEY || "";
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async extract(url: string, category: CategoryName, timeout: number): Promise<ExtractionResult> {
    const timestamp = new Date().toISOString();

    try {
      const { result, latencyMs } = await withLatency(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(`${this.baseUrl}/scrape`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              url,
              formats: ["markdown"],
              waitFor: category === "js_heavy" || category === "anti_bot" ? 5000 : undefined,
              timeout: Math.max(1000, Math.floor(timeout / 1000) * 1000),
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
          }

          return await response.json();
        } finally {
          clearTimeout(timer);
        }
      });

      const content: string = result?.data?.markdown || result?.data?.content || "";
      const charCount = content.length;
      const qualityScore = scoreContentQuality(content, url);

      return {
        provider: "firecrawl",
        category,
        url,
        success: result?.success === true && charCount > 0,
        latencyMs,
        charCount,
        qualityScore,
        timestamp,
      };
    } catch (err) {
      return {
        provider: "firecrawl",
        category,
        url,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: 0,
        charCount: 0,
        qualityScore: 0,
        timestamp,
      };
    }
  }
}
