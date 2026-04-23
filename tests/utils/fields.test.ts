import { describe, it, expect } from "vitest";
import { extractFields } from "../../src/utils/fields.js";
import type { StructuredData } from "../../src/utils/html.js";

describe("extractFields", () => {
  it("structured data takes priority over pattern match for price", () => {
    const sd: StructuredData = {
      type: "Product",
      fields: { price: "49.99", currency: "USD" },
    };
    const markdown = "Price: $99.99 — this is the wrong value";
    const results = extractFields(["price"], sd, markdown);
    expect(results[0].value).toBe("49.99");
    expect(results[0].source).toBe("structured_data");
  });

  it("price pattern match from markdown when no structured data", () => {
    const results = extractFields(["price"], null, "Price: $99.99");
    expect(results[0].value).toBe("$99.99");
    expect(results[0].source).toBe("pattern");
  });

  it("author pattern from markdown", () => {
    const results = extractFields(["author"], null, "By John Doe, updated January 2024");
    expect(results[0].value).toBe("John Doe");
    expect(results[0].source).toBe("pattern");
  });

  it("rating pattern from markdown", () => {
    const results = extractFields(["rating"], null, "Customers rated this product 4.8/5 stars");
    expect(results[0].value).toBe("4.8");
    expect(results[0].source).toBe("pattern");
  });

  it("availability pattern found in text", () => {
    const results = extractFields(["availability"], null, "Status: In Stock — order now");
    expect(results[0].source).toBe("pattern");
    expect(results[0].value.toLowerCase()).toContain("in stock");
  });

  it("not found when field does not exist in content", () => {
    const markdown = "Here is a delicious chocolate cake recipe with flour and eggs.";
    const results = extractFields(["salary"], null, markdown);
    expect(results[0].value).toBe("");
    expect(results[0].source).toBe("not_found");
  });

  it("generic key-value extraction from markdown", () => {
    const results = extractFields(["Author"], null, "Author: Jane Smith\nSome other content here.");
    expect(results[0].value).toBe("Jane Smith");
    expect(results[0].source).toBe("pattern");
  });

  it("structured data fuzzy match for ratingValue", () => {
    const sd: StructuredData = {
      type: "Product",
      fields: { ratingValue: "4.7", reviewCount: "120" },
    };
    const results = extractFields(["ratingValue"], sd, "no rating here");
    expect(results[0].value).toBe("4.7");
    expect(results[0].source).toBe("structured_data");
  });
});
