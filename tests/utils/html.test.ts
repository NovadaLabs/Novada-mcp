import { describe, it, expect } from "vitest";
import { extractMainContent, extractTitle, extractDescription, extractStructuredData } from "../../src/utils/html.js";

describe("extractMainContent", () => {
  it("extracts content from <main> tag", () => {
    const html = `
      <html><body>
        <nav>Navigation</nav>
        <main>
          <h1>Main Heading</h1>
          <p>This is the main content of the page with enough text to pass the 200-char threshold.
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
        </main>
        <footer>Footer</footer>
      </body></html>
    `;
    const result = extractMainContent(html);
    expect(result).toContain("Main Heading");
    expect(result).toContain("main content");
    expect(result).not.toContain("Navigation");
    expect(result).not.toContain("Footer");
  });

  it("extracts content from <article> tag when no <main>", () => {
    const html = `
      <html><body>
        <nav>Nav</nav>
        <article>
          <h2>Article Title</h2>
          <p>Article body text that is long enough to exceed the minimum threshold for content extraction.
          We need more than 200 characters here to make the selector match properly in the implementation.</p>
        </article>
      </body></html>
    `;
    const result = extractMainContent(html);
    expect(result).toContain("Article Title");
    expect(result).toContain("Article body text");
  });

  it("falls back to boilerplate removal when no semantic tags", () => {
    const html = `
      <html><body>
        <nav>Nav Links</nav>
        <header>Site Header</header>
        <div>
          <p>Actual page content here.</p>
        </div>
        <footer>Copyright 2024</footer>
      </body></html>
    `;
    const result = extractMainContent(html);
    expect(result).toContain("Actual page content");
    expect(result).not.toContain("Nav Links");
    expect(result).not.toContain("Site Header");
    expect(result).not.toContain("Copyright 2024");
  });

  it("strips <script> and <style> tags", () => {
    const html = `
      <html><body>
        <script>var x = 1;</script>
        <style>.red { color: red; }</style>
        <div><p>Visible content only.</p></div>
      </body></html>
    `;
    const result = extractMainContent(html);
    expect(result).not.toContain("var x");
    expect(result).not.toContain(".red");
    expect(result).toContain("Visible content");
  });

  it("converts headings to markdown format", () => {
    const html = `
      <html><body>
        <div><h1>Title One</h1><h2>Subtitle</h2><p>Paragraph text long enough to be real content body.</p></div>
      </body></html>
    `;
    const result = extractMainContent(html);
    expect(result).toContain("# Title One");
    expect(result).toContain("## Subtitle");
  });

  it("converts list items to markdown", () => {
    const html = `
      <html><body>
        <div><ul><li>First item</li><li>Second item</li></ul></div>
      </body></html>
    `;
    const result = extractMainContent(html);
    expect(result).toContain("- First item");
    expect(result).toContain("- Second item");
  });

  it("decodes HTML entities", () => {
    const html = `
      <html><body>
        <div><p>Tom &amp; Jerry &lt;friends&gt; said &quot;hello&quot;</p></div>
      </body></html>
    `;
    const result = extractMainContent(html);
    expect(result).toContain('Tom & Jerry <friends> said "hello"');
  });

  it("returns empty string for empty HTML", () => {
    expect(extractMainContent("")).toBe("");
  });

  it("truncates output to 30000 characters", () => {
    const longParagraph = "A".repeat(40000);
    const html = `<html><body><div><p>${longParagraph}</p></div></body></html>`;
    const result = extractMainContent(html);
    expect(result.length).toBeLessThanOrEqual(30000);
  });

  it("strips HTML comments", () => {
    const html = `
      <html><body>
        <!-- This is a comment -->
        <div><p>Real content here.</p></div>
      </body></html>
    `;
    const result = extractMainContent(html);
    expect(result).not.toContain("This is a comment");
    expect(result).toContain("Real content");
  });

  it("density scoring picks content-dense div over nav-heavy div", () => {
    // No semantic selectors (<main>, <article>, etc.) — forces density path
    const contentText = "This is a long article with meaningful paragraphs. ".repeat(10);
    const html = `
      <html><body>
        <div id="nav">
          <a href="/a">Link A</a>
          <a href="/b">Link B</a>
          <a href="/c">Link C</a>
          <a href="/d">Link D</a>
          <a href="/e">Link E</a>
          <a href="/f">Link F</a>
          <a href="/g">Link G</a>
          <a href="/h">Link H</a>
        </div>
        <div id="content">
          <h2>Article Heading</h2>
          <p>${contentText}</p>
          <p>Second paragraph with more real content to make this clearly the winner.</p>
        </div>
      </body></html>
    `;
    const result = extractMainContent(html);
    expect(result).toContain("Article Heading");
    expect(result).toContain("long article with meaningful");
  });

  it("density scoring works when no semantic selectors match", () => {
    // No <main>, <article>, [role=main], or *[class*=content] elements
    const html = `
      <html><body>
        <div id="wrapper">
          <div id="sidebar">
            <a href="/1">Nav 1</a><a href="/2">Nav 2</a>
          </div>
          <div id="main-text">
            <h1>Main Heading</h1>
            <p>First paragraph with substantial text content to ensure this wins the density contest
            and the scorer correctly identifies it as the primary content area of the page.</p>
            <p>Second paragraph adds more evidence that this div is content, not navigation.</p>
          </div>
        </div>
      </body></html>
    `;
    const result = extractMainContent(html);
    expect(result).toContain("Main Heading");
    expect(result).toContain("substantial text content");
  });
});

describe("extractTitle", () => {
  it("extracts title from <title> tag", () => {
    const html = `<html><head><title>My Page Title</title></head><body></body></html>`;
    expect(extractTitle(html)).toBe("My Page Title");
  });

  it("trims whitespace from title", () => {
    const html = `<html><head><title>  Spaced Title  </title></head></html>`;
    expect(extractTitle(html)).toBe("Spaced Title");
  });

  it("returns 'Untitled' when no title tag exists", () => {
    const html = `<html><head></head><body>No title</body></html>`;
    expect(extractTitle(html)).toBe("Untitled");
  });

  it("returns 'Untitled' for empty HTML", () => {
    expect(extractTitle("")).toBe("Untitled");
  });
});

describe("extractDescription", () => {
  it("extracts meta description", () => {
    const html = `<html><head><meta name="description" content="A great page about testing."></head></html>`;
    expect(extractDescription(html)).toBe("A great page about testing.");
  });

  it("handles single-quoted meta attributes", () => {
    const html = `<html><head><meta name='description' content='Single quoted desc'></head></html>`;
    expect(extractDescription(html)).toBe("Single quoted desc");
  });

  it("returns empty string when no meta description", () => {
    const html = `<html><head><meta name="keywords" content="test"></head></html>`;
    expect(extractDescription(html)).toBe("");
  });

  it("returns empty string for empty HTML", () => {
    expect(extractDescription("")).toBe("");
  });
});

describe("extractStructuredData", () => {
  it("extracts Product JSON-LD with price, name, and availability", () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "Wireless Headphones",
      "description": "High-quality audio.",
      "sku": "WH-1000",
      "brand": { "name": "SoundCo" },
      "offers": {
        "@type": "Offer",
        "price": "99.99",
        "priceCurrency": "USD",
        "availability": "https://schema.org/InStock"
      },
      "aggregateRating": { "ratingValue": "4.5", "reviewCount": "120" }
    });
    const html = `<html><head><script type="application/ld+json">${ld}</script></head><body></body></html>`;
    const result = extractStructuredData(html);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("Product");
    expect(result!.fields.name).toBe("Wireless Headphones");
    expect(result!.fields.price).toBe("99.99");
    expect(result!.fields.currency).toBe("USD");
    expect(result!.fields.availability).toBe("InStock");
    expect(result!.fields.sku).toBe("WH-1000");
    expect(result!.fields.brand).toBe("SoundCo");
    expect(result!.fields.ratingValue).toBe("4.5");
    expect(result!.fields.reviewCount).toBe("120");
  });

  it("extracts Article JSON-LD with headline and author", () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": "How AI Is Changing the Web",
      "author": { "name": "Jane Doe" },
      "datePublished": "2024-01-15",
      "publisher": { "name": "Tech Times" }
    });
    const html = `<html><head><script type="application/ld+json">${ld}</script></head><body></body></html>`;
    const result = extractStructuredData(html);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("Article");
    expect(result!.fields.headline).toBe("How AI Is Changing the Web");
    expect(result!.fields.author).toBe("Jane Doe");
    expect(result!.fields.datePublished).toBe("2024-01-15");
    expect(result!.fields.publisher).toBe("Tech Times");
  });

  it("parses JSON-LD array and extracts NewsArticle", () => {
    const ld = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": "Breaking: New Discovery",
        "author": "Bob Smith",
        "datePublished": "2024-06-01"
      }
    ]);
    const html = `<html><head><script type="application/ld+json">${ld}</script></head><body></body></html>`;
    const result = extractStructuredData(html);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("NewsArticle");
    expect(result!.fields.headline).toBe("Breaking: New Discovery");
    expect(result!.fields.author).toBe("Bob Smith");
  });

  it("returns null for malformed JSON-LD", () => {
    const html = `<html><head><script type="application/ld+json">{ this is not valid json }</script></head><body></body></html>`;
    const result = extractStructuredData(html);
    expect(result).toBeNull();
  });

  it("returns null when no JSON-LD is present", () => {
    const html = `<html><head><title>No structured data</title></head><body><p>Content here.</p></body></html>`;
    const result = extractStructuredData(html);
    expect(result).toBeNull();
  });

  it("extracts nested offers.price correctly", () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "Fancy Widget",
      "offers": {
        "@type": "Offer",
        "price": "49.00",
        "priceCurrency": "EUR"
      }
    });
    const html = `<html><head><script type="application/ld+json">${ld}</script></head><body></body></html>`;
    const result = extractStructuredData(html);
    expect(result).not.toBeNull();
    expect(result!.fields.price).toBe("49.00");
    expect(result!.fields.currency).toBe("EUR");
  });

  it("prioritises Product over WebPage when both are present", () => {
    const ldWebPage = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "Home",
      "url": "https://example.com"
    });
    const ldProduct = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "Super Gadget",
      "offers": { "price": "199", "priceCurrency": "USD" }
    });
    const html = `
      <html><head>
        <script type="application/ld+json">${ldWebPage}</script>
        <script type="application/ld+json">${ldProduct}</script>
      </head><body></body></html>
    `;
    const result = extractStructuredData(html);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("Product");
    expect(result!.fields.name).toBe("Super Gadget");
  });
});
