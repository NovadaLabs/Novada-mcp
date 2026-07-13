// ─── Catalog Integrity Tests ────────────────────────────────────────────────
// Verifies SCRAPER_CATALOG structural guarantees — no backend round-trips.

import { describe, it, expect } from "vitest";
import {
  SCRAPER_CATALOG,
  CATALOG_BY_DOMAIN,
  CATALOG_DOMAINS,
  CATALOG_OP_COUNT,
} from "../../src/data/scraper_catalog.js";

describe("SCRAPER_CATALOG structure", () => {
  it("has exactly 16 platforms", () => {
    expect(SCRAPER_CATALOG).toHaveLength(16);
  });

  it("catalog op count matches individual counts", () => {
    const manual = SCRAPER_CATALOG.reduce((s, p) => s + p.ops.length, 0);
    expect(CATALOG_OP_COUNT).toBe(manual);
  });

  it("CATALOG_DOMAINS has 16 entries", () => {
    expect(CATALOG_DOMAINS).toHaveLength(16);
  });

  it("every platform has a non-empty domain and positive platform_id", () => {
    for (const p of SCRAPER_CATALOG) {
      expect(p.domain.length).toBeGreaterThan(0);
      expect(p.platform_id).toBeGreaterThan(0);
    }
  });

  it("every op has a non-empty slug and valid format", () => {
    for (const p of SCRAPER_CATALOG) {
      for (const op of p.ops) {
        expect(op.slug.length).toBeGreaterThan(0);
        expect(["flat", "params"]).toContain(op.format);
      }
    }
  });

  it("every op has a valid status", () => {
    for (const p of SCRAPER_CATALOG) {
      for (const op of p.ops) {
        expect(["ok", "backend_broken"]).toContain(op.status);
      }
    }
  });

  it("backend_broken ops always have a broken_reason", () => {
    for (const p of SCRAPER_CATALOG) {
      for (const op of p.ops) {
        if (op.status === "backend_broken") {
          expect(op.broken_reason).toBeTruthy();
        }
      }
    }
  });

  it("has exactly 8 backend_broken ops", () => {
    const broken = SCRAPER_CATALOG.flatMap(p => p.ops).filter(op => op.status === "backend_broken");
    expect(broken).toHaveLength(8);
  });

  it("no duplicate slugs within a platform", () => {
    for (const p of SCRAPER_CATALOG) {
      const slugs = p.ops.map(op => op.slug);
      const unique = new Set(slugs);
      expect(unique.size).toBe(slugs.length);
    }
  });

  it("CATALOG_BY_DOMAIN is keyed by domain string", () => {
    for (const p of SCRAPER_CATALOG) {
      expect(CATALOG_BY_DOMAIN.has(p.domain)).toBe(true);
    }
  });
});

describe("CATALOG_BY_DOMAIN lookups", () => {
  it("google.com has google_search op", () => {
    const googleOps = CATALOG_BY_DOMAIN.get("google.com");
    expect(googleOps).toBeDefined();
    expect(googleOps!.has("google_search")).toBe(true);
  });

  it("amazon.com has amazon_product_keywords op", () => {
    const amazonOps = CATALOG_BY_DOMAIN.get("amazon.com");
    expect(amazonOps).toBeDefined();
    expect(amazonOps!.has("amazon_product_keywords")).toBe(true);
  });

  it("tiktok.com is in catalog", () => {
    expect(CATALOG_BY_DOMAIN.has("tiktok.com")).toBe(true);
  });

  it("shein.com is in catalog (new platform)", () => {
    expect(CATALOG_BY_DOMAIN.has("shein.com")).toBe(true);
  });

  it("chatgpt.com is in catalog (new platform)", () => {
    expect(CATALOG_BY_DOMAIN.has("chatgpt.com")).toBe(true);
  });

  it("perplexity.ai is in catalog (new platform)", () => {
    expect(CATALOG_BY_DOMAIN.has("perplexity.ai")).toBe(true);
  });

  it("unknown domain returns undefined", () => {
    expect(CATALOG_BY_DOMAIN.has("reddit.com")).toBe(false);
  });
});

describe("Format routing per-op", () => {
  it("google_search uses flat format", () => {
    const op = CATALOG_BY_DOMAIN.get("google.com")?.get("google_search");
    expect(op?.format).toBe("flat");
  });

  it("google_map-details_placeid uses params format (bug fix)", () => {
    const op = CATALOG_BY_DOMAIN.get("google.com")?.get("google_map-details_placeid");
    expect(op?.format).toBe("params");
  });

  it("google_map-details_location uses params format (bug fix)", () => {
    const op = CATALOG_BY_DOMAIN.get("google.com")?.get("google_map-details_location");
    expect(op?.format).toBe("params");
  });

  it("google_map-details_url uses params format (bug fix)", () => {
    const op = CATALOG_BY_DOMAIN.get("google.com")?.get("google_map-details_url");
    expect(op?.format).toBe("params");
  });

  it("google_map-details_cid uses params format (bug fix)", () => {
    const op = CATALOG_BY_DOMAIN.get("google.com")?.get("google_map-details_cid");
    expect(op?.format).toBe("params");
  });

  it("google_comment_url uses params format (bug fix)", () => {
    const op = CATALOG_BY_DOMAIN.get("google.com")?.get("google_comment_url");
    expect(op?.format).toBe("params");
  });

  it("google_shopping_keywords uses params format (bug fix)", () => {
    const op = CATALOG_BY_DOMAIN.get("google.com")?.get("google_shopping_keywords");
    expect(op?.format).toBe("params");
  });

  it("bing_search uses flat format", () => {
    const op = CATALOG_BY_DOMAIN.get("bing.com")?.get("bing_search");
    expect(op?.format).toBe("flat");
  });

  it("amazon ops use params format", () => {
    const op = CATALOG_BY_DOMAIN.get("amazon.com")?.get("amazon_product_keywords");
    expect(op?.format).toBe("params");
  });

  it("tiktok ops use params format", () => {
    const op = CATALOG_BY_DOMAIN.get("tiktok.com")?.get("tiktok_posts_url");
    expect(op?.format).toBe("params");
  });

  it("duckduckgo uses flat format", () => {
    const op = CATALOG_BY_DOMAIN.get("duckduckgo.com")?.get("duckduckgo");
    expect(op?.format).toBe("flat");
  });

  it("yandex uses flat format", () => {
    const op = CATALOG_BY_DOMAIN.get("yandex.com")?.get("yandex");
    expect(op?.format).toBe("flat");
  });
});
