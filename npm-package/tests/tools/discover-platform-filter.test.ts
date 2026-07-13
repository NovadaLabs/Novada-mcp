// ─── novadaDiscover: optional platform param ────────────────────────────────
// Verifies that passing `platform` returns catalog ops without a backend call.

import { describe, it, expect } from "vitest";
import { novadaDiscover } from "../../src/tools/discover.js";

describe("novadaDiscover — platform param", () => {
  it("returns operation table for amazon.com", async () => {
    const result = await novadaDiscover({ platform: "amazon.com" });
    expect(result).toContain("amazon.com");
    expect(result).toContain("amazon_product_keywords");
    expect(result).toContain("Operations");
  });

  it("returns operation table for google.com", async () => {
    const result = await novadaDiscover({ platform: "google.com" });
    expect(result).toContain("google.com");
    expect(result).toContain("google_search");
    expect(result).toContain("google_map-details_placeid");
  });

  it("returns error message for unknown platform", async () => {
    const result = await novadaDiscover({ platform: "reddit.com" });
    expect(result).toContain("not in the scraper catalog");
    expect(result).toContain("novada_extract");
  });

  it("includes broken-op warning in table", async () => {
    const result = await novadaDiscover({ platform: "shein.com" });
    expect(result).toContain("backend-broken");
  });

  it("includes perplexity.ai (new platform)", async () => {
    const result = await novadaDiscover({ platform: "perplexity.ai" });
    expect(result).toContain("perplexity.ai");
  });

  it("platform takes priority — returns ops even if category is also set", async () => {
    const result = await novadaDiscover({ platform: "tiktok.com", category: "Scraping & Verification" } as Parameters<typeof novadaDiscover>[0]);
    expect(result).toContain("tiktok.com");
    expect(result).toContain("tiktok_posts_url");
  });
});
