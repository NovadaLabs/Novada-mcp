import type { BenchmarkProvider } from "./base.js";
import { scoreContentQuality, withLatency } from "./base.js";
import type { ExtractionResult, CategoryName } from "../types.js";

/** Tavily Extract API — https://docs.tavily.com/docs/rest-api/api-reference */
export class TavilyProvider implements BenchmarkProvider {
  name = "tavily" as const;
  private apiKey: string;
  private baseUrl = "https://api.tavily.com";

  constructor() {
    this.apiKey = process.env.TAVILY_API_KEY || "";
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
          const response = await fetch(`${this.baseUrl}/extract`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              api_key: this.apiKey,
              urls: [url],
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

      // Tavily extract returns { results: [{ url, raw_content }], failed_results: [] }
      const extracted = result?.results?.[0];
      const content: string = extracted?.raw_content || extracted?.content || "";
      const charCount = content.length;
      const qualityScore = scoreContentQuality(content, url);
      const failed = result?.failed_results?.length > 0;

      return {
        provider: "tavily",
        category,
        url,
        success: !failed && charCount > 0,
        latencyMs,
        charCount,
        qualityScore,
        timestamp,
      };
    } catch (err) {
      return {
        provider: "tavily",
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
