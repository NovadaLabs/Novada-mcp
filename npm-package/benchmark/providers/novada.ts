import type { BenchmarkProvider } from "./base.js";
import { scoreContentQuality, withLatency } from "./base.js";
import type { ExtractionResult, CategoryName } from "../types.js";

export class NovadaProvider implements BenchmarkProvider {
  name = "novada" as const;
  private client: any = null;

  constructor() {
    // Will be initialized lazily
  }

  isAvailable(): boolean {
    const key = process.env.NOVADA_API_KEY || process.env.NOVADA_SCRAPER_API_KEY;
    return !!key;
  }

  private async getClient() {
    if (this.client) return this.client;

    const { NovadaClient } = await import("../../src/sdk/index.js");
    const apiKey = process.env.NOVADA_API_KEY || process.env.NOVADA_SCRAPER_API_KEY || "";

    this.client = new NovadaClient({
      scraperApiKey: apiKey,
      webUnblockerKey: process.env.NOVADA_WEB_UNBLOCKER_KEY,
      browserWs: process.env.NOVADA_BROWSER_WS,
      proxy: process.env.NOVADA_PROXY_USER
        ? {
            user: process.env.NOVADA_PROXY_USER,
            pass: process.env.NOVADA_PROXY_PASS || "",
            endpoint: process.env.NOVADA_PROXY_ENDPOINT || "",
          }
        : undefined,
    });

    return this.client;
  }

  async extract(url: string, category: CategoryName, timeout: number): Promise<ExtractionResult> {
    const timestamp = new Date().toISOString();

    try {
      const client = await this.getClient();

      const { result, latencyMs } = await withLatency(async () => {
        // Timeout is handled internally by the Novada SDK; no AbortController needed.
        // Fair comparison: each provider uses its best available mode.
        // Novada uses render mode for js_heavy and anti_bot (JS rendering + unblocking).
        return await client.extract(url, {
          format: "markdown",
          render: category === "js_heavy" || category === "anti_bot" ? "render" : "auto",
        });
      });

      const content = result.content || "";
      const charCount = content.length;
      const qualityScore = scoreContentQuality(content, url);

      return {
        provider: "novada",
        category,
        url,
        success: charCount > 0,
        latencyMs,
        charCount,
        qualityScore,
        timestamp,
      };
    } catch (err) {
      return {
        provider: "novada",
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
