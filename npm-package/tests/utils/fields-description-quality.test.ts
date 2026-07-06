/**
 * F12 — description field quality: JSON-LD/meta before pattern fallback, boilerplate rejection,
 * per-field confidence warning for low-quality pattern matches.
 */
import { describe, it, expect } from "vitest";
import { extractFields } from "../../src/utils/fields.js";
import type { StructuredData } from "../../src/utils/html.js";

// Wikipedia-style HTML: has <meta name="description">, JSON-LD WebPage, and body text with
// "Category:" boilerplate that the old DESCRIPTION_PATTERNS would incorrectly grab.
const WIKI_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Web scraping - Wikipedia</title>
  <meta name="description" content="Web scraping, web harvesting, or web data extraction is data scraping used for extracting data from websites." />
  <meta property="og:description" content="Web scraping, web harvesting, or web data extraction is data scraping used for extracting data from websites." />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Web scraping",
    "url": "https://en.wikipedia.org/wiki/Web_scraping"
  }
  </script>
</head>
<body>
  <h1>Web scraping</h1>
  <p>Web scraping, web harvesting, or web data extraction is data scraping used for extracting data from websites.</p>
  <div class="catlinks">
    <a href="/wiki/Category:Articles_with_short_description">Category:Articles with short description</a>
  </div>
</body>
</html>`;

// Markdown that turndown would produce — category links appear as plain text
const WIKI_MARKDOWN = `# Web scraping

Web scraping, web harvesting, or web data extraction is data scraping used for extracting data from websites.

## Categories

[Category:Articles with short description](/wiki/Category:Articles_with_short_description)

Category:Articles with short description`;

describe("extractFields — F12 description field: meta/JSON-LD wins over pattern boilerplate", () => {
  it("description from <meta name=description> beats Category: boilerplate from markdown pattern", () => {
    // No structuredData.description key — Wikipedia's WebPage LD+JSON has no description.
    // The fix: the meta tag layer must run before pattern matching.
    const sd: StructuredData = {
      type: "WebPage",
      fields: { name: "Web scraping", url: "https://en.wikipedia.org/wiki/Web_scraping" },
    };
    const results = extractFields(["description"], sd, WIKI_MARKDOWN, WIKI_HTML);
    const r = results[0];
    expect(r.value).not.toBeNull();
    // Must not be the Category: garbage
    expect(r.value).not.toMatch(/^Category:/i);
    // Must contain the actual description text
    expect(r.value).toMatch(/web scraping|data extraction|web harvesting/i);
    // Must come from jsonld or meta source (not pattern)
    expect(r.source).toBe("jsonld");
    // Confidence must be high (jsonld/meta = 0.95)
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("description from JSON-LD description field takes priority (structuredData has it)", () => {
    const sd: StructuredData = {
      type: "Article",
      fields: {
        headline: "Web scraping - the complete guide",
        description: "Web scraping is the automated extraction of data from web pages.",
        author: "Jane Smith",
      },
    };
    const results = extractFields(["description"], sd, WIKI_MARKDOWN, WIKI_HTML);
    const r = results[0];
    expect(r.value).toBe("Web scraping is the automated extraction of data from web pages.");
    expect(r.source).toBe("jsonld");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("description from og:description when no meta name=description (og-only page)", () => {
    const OG_ONLY_HTML = `<html>
<head>
  <meta property="og:description" content="OpenGraph description only — this is the real one." />
  <title>OG-only page</title>
</head>
<body>
  <p>Category:Articles with short description is a maintenance category.</p>
</body>
</html>`;
    const OG_MARKDOWN = `Category:Articles with short description is a maintenance category.`;
    const results = extractFields(["description"], null, OG_MARKDOWN, OG_ONLY_HTML);
    const r = results[0];
    expect(r.value).toBe("OpenGraph description only — this is the real one.");
    expect(r.source).toBe("jsonld");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("Category: boilerplate from pattern match gets low confidence or is rejected", () => {
    // Only markdown with Category: boilerplate, no HTML meta tags
    const BOILERPLATE_MD = `Category:Articles with short description\nCategory:Wikipedia articles\n`;
    const results = extractFields(["description"], null, BOILERPLATE_MD);
    const r = results[0];
    // Either unresolved (best) or confidence must be very low, NOT 0.60
    if (r.source !== "unresolved") {
      expect(r.confidence).toBeLessThan(0.3);
      // Must carry a warning when confidence is low
      expect(r.warning).toBeDefined();
    }
  });

  it("boilerplate-filtered description emits a field-level warning", () => {
    // Page with meta description + Category: boilerplate in markdown
    // The result should be the meta description, not the boilerplate
    const sd: StructuredData = {
      type: "WebPage",
      fields: { name: "Web scraping" },
    };
    const results = extractFields(["description"], sd, WIKI_MARKDOWN, WIKI_HTML);
    const r = results[0];
    // No warning on high-confidence meta description
    // (warning is only emitted on low-confidence pattern hits)
    expect(r.source).toBe("jsonld");
    expect(r.warning).toBeUndefined();
  });

  it("title field behavior unchanged — still resolves from H1/title element", () => {
    const results = extractFields(["title"], null, "# My Page Title\n\nSome content here.");
    expect(results[0].value).toBe("My Page Title");
    expect(results[0].source).toBe("pattern");
  });

  it("description falls back gracefully when no meta/jsonld/pattern — unresolved, not garbage", () => {
    // No meta tags, no structured data, markdown has no description-like content
    const SPARSE_MD = `# Just a title\n\nCategory:Stubs`;
    const results = extractFields(["description"], null, SPARSE_MD);
    const r = results[0];
    // If it resolves, it must not be Category: boilerplate
    if (r.source !== "unresolved") {
      expect(r.value).not.toMatch(/^Category:/i);
    }
  });
});
