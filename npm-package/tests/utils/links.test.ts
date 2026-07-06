import { describe, it, expect } from "vitest";
import { extractLinks } from "../../src/utils/html.js";

describe("extractLinks", () => {
  it("extracts absolute URLs from anchor tags", () => {
    const html = `<html><body><a href="https://example.com/page1">Page 1</a><a href="https://example.com/page2">Page 2</a></body></html>`;
    const links = extractLinks(html);
    expect(links).toContain("https://example.com/page1");
    expect(links).toContain("https://example.com/page2");
  });

  it("resolves relative URLs when baseUrl is provided", () => {
    const html = `<html><body><a href="/about">About</a><a href="/contact">Contact</a></body></html>`;
    const links = extractLinks(html, "https://example.com");
    expect(links).toContain("https://example.com/about");
    expect(links).toContain("https://example.com/contact");
  });

  it("strips trailing slash from baseUrl when resolving", () => {
    const html = `<html><body><a href="/docs">Docs</a></body></html>`;
    const links = extractLinks(html, "https://example.com/");
    expect(links).toContain("https://example.com/docs");
  });

  it("skips anchor links (#)", () => {
    const html = `<html><body><a href="#section">Section</a><a href="https://example.com">Real</a></body></html>`;
    const links = extractLinks(html);
    expect(links).not.toContain("#section");
    expect(links).toHaveLength(1);
  });

  it("skips javascript: links", () => {
    const html = `<html><body><a href="javascript:void(0)">Click</a></body></html>`;
    expect(extractLinks(html)).toHaveLength(0);
  });

  it("skips mailto: links", () => {
    const html = `<html><body><a href="mailto:test@example.com">Email</a></body></html>`;
    expect(extractLinks(html)).toHaveLength(0);
  });

  it("deduplicates URLs", () => {
    const html = `<html><body>
      <a href="https://example.com/page">Link 1</a>
      <a href="https://example.com/page">Link 2</a>
    </body></html>`;
    const links = extractLinks(html);
    expect(links).toHaveLength(1);
  });

  it("returns all links without cap", () => {
    const anchors = Array.from({ length: 100 }, (_, i) => `<a href="https://example.com/p${i}">P${i}</a>`).join("");
    const html = `<html><body>${anchors}</body></html>`;
    const links = extractLinks(html);
    expect(links.length).toBe(100);
  });

  it("returns empty array for empty HTML", () => {
    expect(extractLinks("")).toHaveLength(0);
  });

  it("returns empty array for HTML with no links", () => {
    const html = `<html><body><p>No links here</p></body></html>`;
    expect(extractLinks(html)).toHaveLength(0);
  });
});
