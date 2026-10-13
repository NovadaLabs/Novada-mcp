/**
 * hasAnyWorkingOp — platform-tool factory empty-working-op-set exclusion (Round 3,
 * S1-connector item 2, 2026-10-13).
 *
 * Class rule, not a SHEIN special case: a platform-scraper tool must not be
 * registered/listed when EVERY one of its configured operations resolves to a
 * catalog entry whose status is "backend_broken" (or is missing from the catalog
 * entirely). This file proves the discriminator itself works on SYNTHETIC configs
 * (so the test doesn't depend on SHEIN's specific catalog data staying broken
 * forever — the mechanism is what's under test here, not today's data), then
 * cross-checks that the real SHEIN config is correctly excluded end-to-end via
 * the real aggregator (platform_scrapers.ts) — the behavioral proof lives there;
 * this file is the "non-inert" proof that the function genuinely discriminates.
 */
import { describe, it, expect } from "vitest";
import { hasAnyWorkingOp, type PlatformScraperConfig } from "../../src/tools/platform_scraper.js";

/** Minimal synthetic config — only the fields hasAnyWorkingOp actually reads
 *  (`platform`, `operations[].scraperId`) need to be realistic; the rest are
 *  filler since this function never touches them. */
function makeConfig(platform: string, operations: Record<string, { scraperId: string }>): PlatformScraperConfig {
  return {
    platform,
    platformLabel: platform,
    toolName: `novada_scrape_${platform}`,
    category: "Scraping & Verification",
    registryDescription: "test fixture",
    operations,
    paramsFieldDoc: "test fixture",
    description: {
      core: "test fixture",
      useWhen: [],
      notFor: [],
      returns: "test fixture",
      operationsNote: "test fixture",
    },
  };
}

describe("hasAnyWorkingOp — non-inert proof (synthetic configs, independent of today's catalog data)", () => {
  it("returns true when a config has at least one op resolving to a status:'ok' catalog entry", () => {
    // amazon.com / amazon_product_keywords is a real, live status:"ok" catalog op —
    // used here only as a stable, known-working anchor, not to test amazon specifically.
    const config = makeConfig("amazon.com", {
      working_op: { scraperId: "amazon_product_keywords" },
    });
    expect(hasAnyWorkingOp(config)).toBe(true);
  });

  it("returns false when EVERY op resolves to a status:'backend_broken' catalog entry", () => {
    // shein_products_keyword is a real, live status:"backend_broken" catalog op —
    // used here only as a stable, known-broken anchor.
    const config = makeConfig("shein.com", {
      broken_op: { scraperId: "shein_products_keyword" },
    });
    expect(hasAnyWorkingOp(config)).toBe(false);
  });

  it("returns true when ONE of several ops is working, even if another is broken (mixed set) — this is exactly why youtube.com stays included while shein.com doesn't", () => {
    const mixedConfig = makeConfig("amazon.com", {
      broken_ish: { scraperId: "amazon_global-product_keywords" }, // backend_broken (pre-existing)
      working: { scraperId: "amazon_product_keywords" }, // ok
    });
    expect(hasAnyWorkingOp(mixedConfig)).toBe(true);
  });

  it("returns false when every op's scraperId is entirely ABSENT from the catalog (fail-closed, not fail-open)", () => {
    const config = makeConfig("not-a-real-domain.example", {
      phantom_op: { scraperId: "totally_made_up_slug" },
    });
    expect(hasAnyWorkingOp(config)).toBe(false);
  });
});

describe("hasAnyWorkingOp — real cross-check against today's live catalog", () => {
  it("SHEIN_SCRAPER_CONFIG (5/5 ops backend_broken as of 2026-10-13) is correctly excluded", async () => {
    const { SHEIN_SCRAPER_CONFIG } = await import("../../src/tools/scrape_shein.js");
    expect(hasAnyWorkingOp(SHEIN_SCRAPER_CONFIG)).toBe(false);
  });

  it("YOUTUBE_SCRAPER_CONFIG (12/13 ops ok — only transcript_by_video is broken) is correctly INCLUDED", async () => {
    const { YOUTUBE_SCRAPER_CONFIG } = await import("../../src/tools/scrape_youtube.js");
    expect(hasAnyWorkingOp(YOUTUBE_SCRAPER_CONFIG)).toBe(true);
  });
});
