import { describe, it, expect } from "vitest";
import { extractFields, isStatValue } from "../../src/utils/fields.js";
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
    expect(results[0].source).toBe("jsonld");
    expect(results[0].confidence).toBeGreaterThan(0.9);
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
    expect((results[0].value ?? "").toLowerCase()).toContain("in stock");
  });

  it("unresolved when field does not exist in content — value null + agent_instruction", () => {
    const markdown = "Here is a delicious chocolate cake recipe with flour and eggs.";
    const results = extractFields(["salary"], null, markdown);
    expect(results[0].value).toBeNull();
    expect(results[0].source).toBe("unresolved");
    expect(results[0].confidence).toBe(0);
    expect(results[0].agent_instruction).toBeDefined();
    expect(results[0].agent_instruction).toContain("salary");
    expect(Array.isArray(results[0].attempted)).toBe(true);
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
    expect(results[0].source).toBe("jsonld");
  });
});

describe("extractFields — NOV-564 finance fallback", () => {
  // MRVL-style finance page: hero price in a <span class="price">, plus a row-label
  // stat table (label in first <td>, value in second) for Market Cap / P/E / 52-week range.
  const MRVL_HTML = `
    <html>
      <head><title>Marvell Technology (MRVL)</title></head>
      <body>
        <header><nav>Site nav and links that should be ignored</nav></header>
        <section class="quote">
          <h1>Marvell Technology, Inc. (MRVL)</h1>
          <span class="price">72.13</span>
          <span class="change">+1.24%</span>
        </section>
        <table class="key-stats">
          <tbody>
            <tr><td>Market Cap</td><td>62.41B</td></tr>
            <tr><td>P/E Ratio</td><td>28.40</td></tr>
            <tr><td>52 Week Range</td><td>60.10 - 88.41</td></tr>
            <tr><td>Volume</td><td>12.5M</td></tr>
          </tbody>
        </table>
      </body>
    </html>
  `;
  const MRVL_MARKDOWN = `# Marvell Technology, Inc. (MRVL)

72.13 +1.24%

| Market Cap | 62.41B |
| P/E Ratio | 28.40 |
| 52 Week Range | 60.10 - 88.41 |
| Volume | 12.5M |
`;

  it("resolves >=4/5 finance fields with source tagged (table/adjacent)", () => {
    const fields = ["price", "market cap", "pe ratio", "52 week range", "change"];
    const results = extractFields(fields, null, MRVL_MARKDOWN, MRVL_HTML);
    const resolvedCount = results.filter(r => r.source !== "unresolved").length;
    expect(resolvedCount).toBeGreaterThanOrEqual(4);
    // Every resolved field carries a non-pattern-or-pattern source and a confidence.
    for (const r of results) {
      if (r.source !== "unresolved") {
        expect(r.value).not.toBeNull();
        expect(r.confidence).toBeGreaterThan(0);
        expect(["jsonld", "infobox", "table", "microdata", "pattern", "heading", "llm"]).toContain(r.source);
      }
    }
  });

  it("hero price resolves from <span class=price>", () => {
    const results = extractFields(["price"], null, "", MRVL_HTML);
    expect(results[0].value).toBe("72.13");
    // Adjacent hero block matches by class/attr token (not a real table row), so it is
    // tagged at the pattern tier — not "table". Confidence is the pattern-tier value.
    expect(results[0].source).toBe("pattern");
    expect(results[0].confidence).toBe(0.6);
  });

  it("market cap resolves from row-label table", () => {
    const results = extractFields(["market cap"], null, MRVL_MARKDOWN, MRVL_HTML);
    expect(results[0].value).toBe("62.41B");
    expect(results[0].source).toBe("table");
  });

  it("52 week range keeps the full hyphenated value (row layer before proximity regex)", () => {
    const results = extractFields(["52 week range"], null, MRVL_MARKDOWN, MRVL_HTML);
    expect(results[0].value).toBe("60.10 - 88.41");
    expect(results[0].source).toBe("table");
  });

  it("GFM pipe + multi-space tolerant regex resolves market cap without HTML", () => {
    const md = "| Market Cap | 233.37B |\nOther prose here.";
    const results = extractFields(["market cap"], null, md);
    expect(results[0].value).toBe("233.37B");
    expect(results[0].source).toBe("pattern");
  });
});

describe("extractFields — NOV-564 field aliases", () => {
  it("'stock price' alias resolves a price field from structured data", () => {
    const sd: StructuredData = { type: "Product", fields: { price: "199.99" } };
    const results = extractFields(["stock price"], sd, "no price in body");
    expect(results[0].value).toBe("199.99");
    expect(results[0].source).toBe("jsonld");
  });

  it("'P/E' alias resolves a pe ratio via pattern", () => {
    const results = extractFields(["P/E"], null, "The stock trades at P/E 28.4 today.");
    expect(results[0].value).toBe("28.4");
    expect(results[0].source).toBe("pattern");
  });

  it("'pe' does NOT resolve from a stray decimal in prose (no label)", () => {
    // RATIO_PATTERNS is label-anchored only: a percent-change or a time decimal
    // with no P/E label must leave the field unresolved, not mis-tag "3.21" as pe.
    const results = extractFields(
      ["pe"],
      null,
      "Shares rose 3.21 percent in early trading; the earnings call is at 4.30 PM.",
    );
    expect(results[0].value).toBeNull();
    expect(results[0].source).toBe("unresolved");
  });

  it("'change percent' alias resolves a percent change from hero block", () => {
    const html = `<html><body><span class="change">+1.24%</span></body></html>`;
    const results = extractFields(["change percent"], null, "", html);
    expect(results[0].value).toBe("+1.24%");
  });
});

describe("extractFields — finance false-positive guards (review fixes)", () => {
  // R2: PATTERN_MAP must NOT carry unanchored PERCENT/BIG_NUMBER entries, or step 7
  // (matchPatterns over the whole markdown) fires on the first %/big-number anywhere.
  it("'change' does NOT resolve from a stray percent elsewhere in prose", () => {
    const r = extractFields(["change"], null, "satisfaction improved 95% last year")[0];
    expect(r.value).toBeNull();
    expect(r.source).toBe("unresolved");
  });
  it("'volume' does NOT resolve from an unrelated big-number ('5K members')", () => {
    const r = extractFields(["volume"], null, "5K members joined the community")[0];
    expect(r.value).toBeNull();
    expect(r.source).toBe("unresolved");
  });
  it("'market cap' does NOT resolve from an unrelated big-number ('12K people')", () => {
    const r = extractFields(["market cap"], null, "we grew our team to 12K people")[0];
    expect(r.value).toBeNull();
    expect(r.source).toBe("unresolved");
  });

  // R3: adjacent-pair class selectors must be whole-word, not substring. exchange-rate /
  // changelog-version / price-disclaimer widgets are ubiquitous on finance pages.
  it("'change' does NOT match an exchange-rate widget (substring 'change' in 'exchange')", () => {
    const html = `<div class="exchange-rate">1 USD = 0.92 EUR</div>`;
    const r = extractFields(["change"], null, "", html)[0];
    expect(r.value).toBeNull();
    expect(r.source).toBe("unresolved");
  });
  it("'change' does NOT match a changelog-version element", () => {
    const html = `<div class="changelog-version">v2.3.1</div>`;
    const r = extractFields(["change"], null, "", html)[0];
    expect(r.value).toBeNull();
  });
  it("'price' does NOT match a price-disclaimer prose element", () => {
    const html = `<div class="price-disclaimer">Prices subject to change without notice</div>`;
    const r = extractFields(["price"], null, "", html)[0];
    expect(r.value).toBeNull();
  });

  // R3 positive: whole-word hyphenated class tokens still resolve a real numeric value.
  it("'change' STILL resolves from a hyphenated whole-word class (stock-change-positive)", () => {
    const html = `<span class="stock-change-positive">+1.24%</span>`;
    const r = extractFields(["change"], null, "", html)[0];
    expect(r.value).toBe("+1.24%");
  });
  it("'price' STILL resolves from a 'last-price' whole-word class", () => {
    const html = `<span class="last-price">72.13</span>`;
    const r = extractFields(["price"], null, "", html)[0];
    expect(r.value).toBe("72.13");
  });

  // R4: tolerant + generic layers must require a digit for numeric stat fields, so a
  // heading-like prose line can't resolve the stat to a sentence.
  it("'market cap' does NOT resolve to a prose sentence via the multi-space branch", () => {
    const md = "Market Cap     refers to total value of shares outstanding company";
    const r = extractFields(["market cap"], null, md)[0];
    expect(r.value).toBeNull();
    expect(r.source).toBe("unresolved");
  });
  it("'market cap' STILL resolves a real numeric value via the multi-space branch", () => {
    const r = extractFields(["market cap"], null, "Market Cap     62.41B")[0];
    expect(r.value).toBe("62.41B");
  });
  // Non-stat fields keep their prose-friendly multi-space behavior (digit guard is scoped).
  it("a non-stat field ('author') still resolves prose via multi-space", () => {
    const r = extractFields(["author"], null, "Author     Jane Smith")[0];
    expect(r.value).toBe("Jane Smith");
  });
});

describe("isStatValue — NOV-574 prose-with-a-digit rejection", () => {
  // NOV-574: a STAT_FIELDS value must BE a number (optionally currency / sign / % / K-M-B-T
  // or a numeric range), not prose that merely CONTAINS a digit. The old `/\d/.test(v)` guard
  // let a stray digit in a sentence resolve a numeric stat field to that sentence.
  it("rejects prose that merely contains a digit ('founded in 2009 by 3 people')", () => {
    expect(isStatValue("founded in 2009 by 3 people")).toBe(false);
  });

  it("accepts real stat values: currency, percent, and grouped numbers", () => {
    expect(isStatValue("$1.2B")).toBe(true);
    expect(isStatValue("42%")).toBe(true);
    expect(isStatValue("1,234")).toBe(true);
  });

  it("accepts a numeric range ('60.10 - 88.41') and signed percent ('-5.15%')", () => {
    expect(isStatValue("60.10 - 88.41")).toBe(true);
    expect(isStatValue("-5.15%")).toBe(true);
  });

  it("rejects other prose-with-a-digit ('top 5 holdings')", () => {
    expect(isStatValue("top 5 holdings")).toBe(false);
  });
});

describe("extractFields — NOV #13 cart-total is not the product price", () => {
  // The canonical confidently-wrong answer: an empty-cart running total ($0.00) rendered in a
  // mini-cart widget gets returned as the product price. The product price lives in its own
  // product/price container and must win; a cart-only total must yield an explained null.
  it("prefers the product-container price over a $0.00 cart total", () => {
    const html = `
      <html><body>
        <div class="mini-cart"><span class="cart-total-price">$0.00</span></div>
        <div class="product-info"><span class="price">$129.99</span></div>
      </body></html>`;
    const r = extractFields(["price"], null, "", html)[0];
    expect(r.value).toBe("$129.99");
    expect(r.source).toBe("pattern");
  });

  it("does NOT return a $0.00 cart total when that is the only price-shaped value (null + agent_instruction)", () => {
    const html = `
      <html><body>
        <header class="site-cart"><span class="cart-subtotal">$0.00</span></header>
        <div class="basket-summary"><span class="price">$0.00</span></div>
      </body></html>`;
    const r = extractFields(["price"], null, "", html)[0];
    expect(r.value).toBeNull();
    expect(r.source).toBe("unresolved");
    expect(r.agent_instruction).toBeDefined();
    expect(r.agent_instruction).toMatch(/cart|order-summary|total/i);
  });

  it("skips a price nested inside a cart container even when non-zero", () => {
    // A non-zero subtotal in a cart block is still the cart total, not the item's price.
    const html = `
      <html><body>
        <div class="cart-drawer"><span class="price">$59.98</span></div>
        <div class="product"><span class="price">$29.99</span></div>
      </body></html>`;
    const r = extractFields(["price"], null, "", html)[0];
    expect(r.value).toBe("$29.99");
  });

  it("a bare $0.00 in markdown does NOT resolve as the price (falls through to explained null)", () => {
    // No HTML cart context, but a stray $0.00 in body text must not become the price.
    const r = extractFields(["price"], null, "Your cart subtotal: $0.00\nFree shipping over $50.")[0];
    expect(r.value).toBeNull();
    expect(r.source).toBe("unresolved");
  });

  it("a legitimate product price in a plain price class still resolves (no cart context)", () => {
    const html = `<html><body><span class="product-price">$42.50</span></body></html>`;
    const r = extractFields(["price"], null, "", html)[0];
    expect(r.value).toBe("$42.50");
  });

  it("authoritative itemprop=price wins even inside a cart-ish wrapper", () => {
    // Schema.org product data is authoritative — not cart-guarded.
    const html = `<html><body><div class="cart"><span itemprop="price">$99.00</span></div></body></html>`;
    const r = extractFields(["price"], null, "", html)[0];
    expect(r.value).toBe("$99.00");
  });
});
