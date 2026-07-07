/**
 * Tests for TOW2-238 subcategory_rank pollution (S3) and description chrome (S4).
 *
 * Root cause: UPSTREAM. Both bugs originate in the scraper API's raw output:
 *   S3 – subcategory_rank contains JS/page artefacts ("languageCode":"en_US",
 *        review text, "ASIN B..." trailing page text) and entries are duplicated
 *        4–16× by the upstream parser.
 *   S4 – `description` is a full-page text dump (Add to Cart, Previous/Next page,
 *        comparison tables, FAQs). The `features` array is the clean alternative.
 *
 * Our fix: defensive filter + dedup for S3; prefer `features` for S4.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { normalizeProductRecord, filterSubcategoryRank, descriptionHasChrome } = await import(
  "../../src/tools/scrape.js"
);

const __dirname = dirname(fileURLToPath(import.meta.url));
// Real (sanitized) upstream Amazon records captured live 2026-07-06 (TOW2-238):
// subcategory_rank polluted with JS artefacts + duplicated 4–16×;
// description is a full-page dump containing "Add to Cart"/"Previous page" etc.
const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/amazon-scrape-extraction-bug.json"), "utf8"),
) as Record<string, unknown>[];

// Item indices in the fixture
const IDX_POLLUTED_SR_AND_CHROME_DESC = 0; // B0CFQ5T5F6 – 37 raw sr entries, description has chrome
const IDX_HEAVY_SR_DUPS = 1;               // B0GW2MWGKC – 42 raw sr entries, all dups
const IDX_CLEAN_APPLE = 2;                 // B0DCH5B2HF – Apple cable, 0 sr, clean description
const IDX_EMPTY_DESC = 3;                  // B0F4D5ZKD2 – short desc, no chrome, good features

// ─── Fixture integrity guards ────────────────────────────────────────────────

describe("fixture integrity — TOW2-238 bugs present in raw upstream data", () => {
  it("S3: item 0 subcategory_rank has JS/review artefacts in the raw fixture", () => {
    const sr = FIXTURE[IDX_POLLUTED_SR_AND_CHROME_DESC].subcategory_rank as Array<Record<string, unknown>>;
    expect(sr.length).toBeGreaterThan(10);
    const hasJsArtefact = sr.some(e =>
      typeof e.subcategory_name === "string" && e.subcategory_name.includes("languageCode"),
    );
    expect(hasJsArtefact).toBe(true);
  });

  it("S3: item 0 subcategory_rank has duplicate entries in the raw fixture", () => {
    const sr = FIXTURE[IDX_POLLUTED_SR_AND_CHROME_DESC].subcategory_rank as Array<Record<string, unknown>>;
    const keys = sr.map(e => `${e.subcategory_rank}:${String(e.subcategory_name).toLowerCase()}`);
    const unique = new Set(keys);
    expect(keys.length).toBeGreaterThan(unique.size); // duplicates present
  });

  it("S4: item 0 description contains UI chrome in the raw fixture", () => {
    const desc = FIXTURE[IDX_POLLUTED_SR_AND_CHROME_DESC].description as string;
    expect(desc).toContain("Add to Cart");
    expect(desc).toContain("Previous page");
    expect(desc).toContain("Next page");
  });

  it("item 0 features field is clean and non-empty", () => {
    const features = FIXTURE[IDX_POLLUTED_SR_AND_CHROME_DESC].features as string[];
    expect(Array.isArray(features)).toBe(true);
    expect(features.length).toBeGreaterThan(0);
    // Features must not contain UI chrome
    const featureText = features.join(" ");
    expect(featureText).not.toContain("Add to Cart");
    expect(featureText).not.toContain("Previous page");
  });
});

// ─── filterSubcategoryRank unit tests ────────────────────────────────────────

describe("filterSubcategoryRank — S3 defensive filter", () => {
  it("drops entries whose name contains JSON syntax (languageCode artefact)", () => {
    const polluted = [
      { subcategory_name: 'USB C Cable","languageCode":"en_US","holderId":"holder', subcategory_rank: "240" },
      { subcategory_name: "USB Cables", subcategory_rank: "4" },
    ];
    const result = filterSubcategoryRank(polluted);
    expect(result).toHaveLength(1);
    expect(result[0].subcategory_name).toBe("USB Cables");
  });

  it("drops entries whose name exceeds 80 chars (long prose/review text)", () => {
    const longName = "USB C Port）Google Pixel: Pixel is using Google's private charging protocol.It can only charge normally";
    const rows = [
      { subcategory_name: longName, subcategory_rank: "25" },
      { subcategory_name: "USB Cables", subcategory_rank: "4" },
    ];
    const result = filterSubcategoryRank(rows);
    expect(result).toHaveLength(1);
    expect(result[0].subcategory_name).toBe("USB Cables");
  });

  it("drops entries whose name has ASIN trailing page text", () => {
    const rows = [
      { subcategory_name: "USB Cables                         ASIN         B0CFQ5T5F6", subcategory_rank: "4" },
      { subcategory_name: "Cell Phones & Accessories", subcategory_rank: "3153" },
    ];
    const result = filterSubcategoryRank(rows);
    expect(result).toHaveLength(1);
    expect(result[0].subcategory_name).toBe("Cell Phones & Accessories");
  });

  it("deduplicates identical (rank, name) pairs", () => {
    const rows = Array.from({ length: 16 }, () => ({
      subcategory_name: "Cell Phone Wall Chargers",
      subcategory_rank: "294",
    }));
    const result = filterSubcategoryRank(rows);
    expect(result).toHaveLength(1);
  });

  it("keeps distinct (rank, name) pairs even when name repeats with different rank", () => {
    const rows = [
      { subcategory_name: "Cell Phones & Accessories", subcategory_rank: "3153" },
      { subcategory_name: "Cell Phones & Accessories", subcategory_rank: "3153" }, // dup
      { subcategory_name: "Cell Phones & Accessories", subcategory_rank: "5000" }, // different rank
    ];
    const result = filterSubcategoryRank(rows);
    expect(result).toHaveLength(2);
  });

  it("returns empty array when all entries are polluted", () => {
    const rows = [
      { subcategory_name: 'junk","foo":"bar', subcategory_rank: "1" },
      { subcategory_name: "USB C Port）Pixel is using Google's private charging protocol. It can only charge normally but can not support fast charge", subcategory_rank: "25" },
    ];
    const result = filterSubcategoryRank(rows);
    expect(result).toHaveLength(0);
  });

  it("drops entries with non-numeric rank", () => {
    const rows = [
      { subcategory_name: "USB Cables", subcategory_rank: "not-a-number" },
      { subcategory_name: "USB Cables", subcategory_rank: "" },
      { subcategory_name: "USB Cables", subcategory_rank: "4" },
    ];
    const result = filterSubcategoryRank(rows);
    expect(result).toHaveLength(1);
    expect(result[0].subcategory_rank).toBe("4");
  });
});

// ─── descriptionHasChrome unit tests ─────────────────────────────────────────

describe("descriptionHasChrome — chrome detection", () => {
  it("detects Add to Cart in description", () => {
    expect(descriptionHasChrome("Great cable. Add to Cart more info.")).toBe(true);
  });

  it("detects Previous page in description (including concatenated 'Previous pageNext page' as upstream emits)", () => {
    // Upstream concatenates nav tokens without space: "Previous pageNext page"
    // The pattern uses /\bPrevious page/i (no trailing \b) to match this.
    expect(descriptionHasChrome("Previous pageNext page LISEN USB")).toBe(true);
    expect(descriptionHasChrome("more info Previous page in the description")).toBe(true);
  });

  it("returns false for a clean description", () => {
    expect(descriptionHasChrome("60W fast charging cable, 5-pack.")).toBe(false);
  });
});

// ─── normalizeProductRecord integration — S3 ─────────────────────────────────

describe("normalizeProductRecord — S3 subcategory_rank cleanup via fixture", () => {
  it("item 0: subcategory_rank has no JS/JSON artefacts after normalization", () => {
    const raw = FIXTURE[IDX_POLLUTED_SR_AND_CHROME_DESC];
    const out = normalizeProductRecord(raw);
    const sr = out.subcategory_rank as Array<Record<string, unknown>>;

    expect(Array.isArray(sr)).toBe(true);
    for (const entry of sr) {
      const name = String(entry.subcategory_name ?? "");
      expect(name).not.toContain("languageCode");
      expect(name).not.toMatch(/"[^"]*"/);  // no embedded JSON strings
      expect(name.length).toBeLessThanOrEqual(80);
    }
  });

  it("item 0: no duplicate (rank, name) pairs remain after normalization", () => {
    const raw = FIXTURE[IDX_POLLUTED_SR_AND_CHROME_DESC];
    const out = normalizeProductRecord(raw);
    const sr = out.subcategory_rank as Array<Record<string, unknown>>;

    const keys = sr.map(e => `${e.subcategory_rank}:${String(e.subcategory_name).toLowerCase()}`);
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size);
  });

  it("item 0: result has fewer entries than raw (dups + pollution stripped)", () => {
    const raw = FIXTURE[IDX_POLLUTED_SR_AND_CHROME_DESC];
    const rawSr = raw.subcategory_rank as Array<unknown>;
    const out = normalizeProductRecord(raw);
    const outSr = out.subcategory_rank as Array<unknown>;
    expect(outSr.length).toBeLessThan(rawSr.length);
  });

  it("item 1 (heavy dups B0GW2MWGKC): 42 raw entries collapse to ≤2 clean unique categories", () => {
    // Raw has 42 entries: 2 distinct patterns ("Cell Phones & Accessories" rank=3153
    // and "Cell Phone Wall Chargers ASIN B..." rank=294) each repeated 21×. The ASIN-
    // containing entry is also polluted so after filtering only ≤2 real categories remain.
    // Bound is 2 so a filter regression (passing many dups through) cannot silently pass.
    const raw = FIXTURE[IDX_HEAVY_SR_DUPS];
    const rawSr = raw.subcategory_rank as Array<unknown>;
    expect(rawSr.length).toBe(42);
    const out = normalizeProductRecord(raw);
    const outSr = out.subcategory_rank as Array<unknown>;
    expect(outSr.length).toBeLessThanOrEqual(2);
  });

  it("item 2 (Apple cable): subcategory_rank is empty — passthrough unchanged", () => {
    const raw = FIXTURE[IDX_CLEAN_APPLE];
    const out = normalizeProductRecord(raw);
    // Not present in this item — should not be added
    const rawSr = (raw.subcategory_rank as Array<unknown> | undefined) ?? [];
    expect(rawSr.length).toBe(0);
  });
});

// ─── normalizeProductRecord integration — S4 ─────────────────────────────────

describe("normalizeProductRecord — S4 description cleanup via fixture", () => {
  it("item 0: description does not contain 'Add to Cart' after normalization", () => {
    const raw = FIXTURE[IDX_POLLUTED_SR_AND_CHROME_DESC];
    const out = normalizeProductRecord(raw);
    expect(String(out.description ?? "")).not.toContain("Add to Cart");
  });

  it("item 0: description does not contain 'Previous page' after normalization", () => {
    const raw = FIXTURE[IDX_POLLUTED_SR_AND_CHROME_DESC];
    const out = normalizeProductRecord(raw);
    expect(String(out.description ?? "")).not.toContain("Previous page");
  });

  it("item 0: description does not contain 'Next page' after normalization", () => {
    const raw = FIXTURE[IDX_POLLUTED_SR_AND_CHROME_DESC];
    const out = normalizeProductRecord(raw);
    expect(String(out.description ?? "")).not.toContain("Next page");
  });

  it("item 0: description is sourced from features when features are available", () => {
    const raw = FIXTURE[IDX_POLLUTED_SR_AND_CHROME_DESC];
    const out = normalizeProductRecord(raw);
    // The clean description should come from features bullets
    expect(out._description_source).toBe("features");
    // Spot-check: features content is present in the cleaned description
    const features = raw.features as string[];
    const firstFeatureSnippet = features[0].slice(0, 30);
    expect(String(out.description ?? "")).toContain(firstFeatureSnippet);
  });

  it("item 2 (Apple cable): description with no chrome passes through unchanged", () => {
    const raw = FIXTURE[IDX_CLEAN_APPLE];
    const origDesc = raw.description as string;
    const out = normalizeProductRecord(raw);
    // No chrome in Apple description → must not add _description_source marker
    expect(descriptionHasChrome(origDesc)).toBe(false);
    expect(out._description_source).toBeUndefined();
    expect(out.description).toBe(origDesc);
  });

  it("item 3 (short desc): features-only item — no chrome flag, no modification", () => {
    const raw = FIXTURE[IDX_EMPTY_DESC];
    const out = normalizeProductRecord(raw);
    // Short description has no chrome → no change
    expect(out._description_source).toBeUndefined();
  });
});
