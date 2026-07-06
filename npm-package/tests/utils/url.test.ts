import { describe, it, expect } from "vitest";
import { normalizeUrl, isContentLink } from "../../src/utils/url.js";

describe("normalizeUrl", () => {
  it("strips trailing slash", () => {
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
  });

  it("removes www prefix", () => {
    expect(normalizeUrl("https://www.example.com/page")).toBe("https://example.com/page");
  });

  it("removes hash fragment", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("sorts query parameters alphabetically", () => {
    expect(normalizeUrl("https://example.com/search?z=1&a=2&m=3")).toBe(
      "https://example.com/search?a=2&m=3&z=1"
    );
  });

  it("preserves root path as /", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("combines www removal, trailing slash strip, and hash removal", () => {
    expect(normalizeUrl("https://www.example.com/docs/#intro")).toBe(
      "https://example.com/docs"
    );
  });

  it("returns the original string for invalid URLs", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
  });

  it("returns the original string for empty string", () => {
    expect(normalizeUrl("")).toBe("");
  });

  it("handles URLs with port numbers", () => {
    const result = normalizeUrl("https://www.example.com:8080/path/");
    expect(result).toBe("https://example.com:8080/path");
  });

  it("handles multiple trailing slashes", () => {
    expect(normalizeUrl("https://example.com/path///")).toBe("https://example.com/path");
  });
});

describe("isContentLink", () => {
  it("returns true for regular content URLs", () => {
    expect(isContentLink("https://example.com/about")).toBe(true);
  });

  it("returns true for deep content paths", () => {
    expect(isContentLink("https://example.com/blog/post/2024/my-article")).toBe(true);
  });

  it("filters out CSS files", () => {
    expect(isContentLink("https://example.com/styles/main.css")).toBe(false);
  });

  it("filters out JS files", () => {
    expect(isContentLink("https://example.com/bundle.js")).toBe(false);
  });

  it("filters out image files (png)", () => {
    expect(isContentLink("https://example.com/logo.png")).toBe(false);
  });

  it("filters out image files (jpg)", () => {
    expect(isContentLink("https://example.com/photo.jpg")).toBe(false);
  });

  it("filters out font files", () => {
    expect(isContentLink("https://example.com/font.woff2")).toBe(false);
  });

  it("filters out JSON files", () => {
    expect(isContentLink("https://example.com/api/data.json")).toBe(false);
  });

  it("filters out Google Fonts CDN", () => {
    expect(isContentLink("https://fonts.googleapis.com/css?family=Roboto")).toBe(false);
  });

  it("filters out jsDelivr CDN", () => {
    expect(isContentLink("https://cdn.jsdelivr.net/npm/lodash")).toBe(false);
  });

  it("filters out Google Analytics", () => {
    expect(isContentLink("https://www.google-analytics.com/collect")).toBe(false);
  });

  it("filters out login paths", () => {
    expect(isContentLink("https://example.com/login")).toBe(false);
  });

  it("filters out auth paths", () => {
    expect(isContentLink("https://example.com/auth/callback")).toBe(false);
  });

  it("filters out settings paths", () => {
    expect(isContentLink("https://example.com/settings")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isContentLink("not-a-url")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isContentLink("")).toBe(false);
  });
});
