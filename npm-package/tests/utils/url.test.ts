import { describe, it, expect } from "vitest";
import { normalizeUrl, isContentLink, decodeBingRedirect } from "../../src/utils/url.js";

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

describe("decodeBingRedirect", () => {
  const TARGET = "https://example.com/some/real/page?x=1";
  // Standard base64 encoding of TARGET, "a1"-prefixed, as the `u` param carries it.
  const STD_B64_A1 = "a1aHR0cHM6Ly9leGFtcGxlLmNvbS9zb21lL3JlYWwvcGFnZT94PTE=";

  it("decodes the standard bing.com/ck/a shape (a1 prefix, u param, base64)", () => {
    const wrapped = `https://www.bing.com/ck/a?ld=xyz&u=${STD_B64_A1}&ntb=1`;
    expect(decodeBingRedirect(wrapped)).toBe(TARGET);
  });

  it("decodes via the sibling r param instead of u", () => {
    const wrapped = `https://www.bing.com/ck/a?ld=xyz&r=${STD_B64_A1}`;
    expect(decodeBingRedirect(wrapped)).toBe(TARGET);
  });

  it("decodes on the r.bing.com redirect host", () => {
    const wrapped = `https://r.bing.com/rr?u=${STD_B64_A1}`;
    expect(decodeBingRedirect(wrapped)).toBe(TARGET);
  });

  it("decodes base64url (URL-safe alphabet) with missing padding", () => {
    // Encodes a target whose base64 body contains '/' — converted to '_' and
    // stripped of '=' padding to prove the url-safe + padding-tolerant path.
    const target = "https://example.com/path-10/page?ref=aaaaaaaaaaaaaaaaaaaaaaa10";
    const std = Buffer.from(target, "utf8").toString("base64"); // contains '/'
    expect(std).toContain("/");
    const urlSafeNoPad = std.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const wrapped = `https://www.bing.com/ck/a?u=a1${urlSafeNoPad}`;
    expect(decodeBingRedirect(wrapped)).toBe(target);
  });

  it("returns the input unchanged when the u/r param is missing", () => {
    const wrapped = "https://www.bing.com/ck/a?ld=xyz&ntb=1";
    expect(decodeBingRedirect(wrapped)).toBe(wrapped);
  });

  it("returns the input unchanged when the param is malformed base64 that decodes to non-URL bytes", () => {
    // "a1!!!not-base64!!!" strips to "!!!not-base64!!!" which fails the base64
    // alphabet check outright (rejected before ever reaching Buffer.from).
    const wrapped = "https://www.bing.com/ck/a?u=a1%21%21%21not-base64%21%21%21";
    const url = new URL(wrapped);
    expect(decodeBingRedirect(url.toString())).toBe(url.toString());
  });

  it("returns the input unchanged when decoded bytes are valid base64 but not a URL", () => {
    const notAUrl = Buffer.from("just some random text, not a url", "utf8").toString("base64");
    const wrapped = `https://www.bing.com/ck/a?u=a1${notAUrl}`;
    expect(decodeBingRedirect(wrapped)).toBe(wrapped);
  });

  it("passes through a non-bing host unchanged, even with a matching u param", () => {
    const notBing = `https://example.org/ck/a?u=${STD_B64_A1}`;
    expect(decodeBingRedirect(notBing)).toBe(notBing);
  });

  it("passes through a spoofed host containing the substring 'bing.com' unchanged (security hardening)", () => {
    // "evilbing.com" contains "bing.com" as a raw substring — the old
    // url.includes("bing.com/ck/a") gate would have matched this; the
    // hostname-based check must not.
    const spoofed = `https://evilbing.com/ck/a?u=${STD_B64_A1}`;
    expect(decodeBingRedirect(spoofed)).toBe(spoofed);
  });

  it("passes through a plain http(s) URL unchanged", () => {
    expect(decodeBingRedirect("https://example.com/normal-page")).toBe("https://example.com/normal-page");
  });

  it("passes through an unparseable/relative string unchanged without throwing", () => {
    expect(decodeBingRedirect("not a url at all")).toBe("not a url at all");
  });

  it("passes through an empty string unchanged without throwing", () => {
    expect(decodeBingRedirect("")).toBe("");
  });

  it("decodes the legacy bare-base64 fallback shape (no scheme, no bing host)", () => {
    const bare = Buffer.from(TARGET, "utf8").toString("base64");
    expect(decodeBingRedirect(bare)).toBe(TARGET);
  });

  it("leaves a bare non-base64 string unchanged", () => {
    expect(decodeBingRedirect("this-is-just-a-slug-not-base64")).toBe("this-is-just-a-slug-not-base64");
  });

  it("leaves valid base64 that decodes to non-URL text unchanged (legacy fallback)", () => {
    const notAUrl = Buffer.from("this decodes fine but is not a url at all, just prose", "utf8").toString("base64");
    expect(decodeBingRedirect(notAUrl)).toBe(notAUrl);
  });

  // ─── Reviewer follow-ups (2026-07-30 code review) ─────────────────────────

  it("decodes on the DNS-valid trailing-dot FQDN variant (bing.com.)", () => {
    const wrapped = `https://www.bing.com./ck/a?u=${STD_B64_A1}`;
    expect(decodeBingRedirect(wrapped)).toBe(TARGET);
  });

  it("falls back to r when u is present but fails to decode to a URL (order-independent resolution)", () => {
    // No live Bing capture confirms u-vs-r precedence when both are present
    // (reviewer-flagged) — the function must not just trust u blindly and give
    // up; it should fall through to a sibling param that DOES decode cleanly.
    const garbageU = Buffer.from("not a url, just prose that happens to be valid base64", "utf8").toString("base64");
    const validR = STD_B64_A1;
    const wrapped = `https://www.bing.com/ck/a?u=${garbageU}&r=${validR}`;
    expect(decodeBingRedirect(wrapped)).toBe(TARGET);
  });

  it("prefers u over r when both independently decode to a (different) valid URL", () => {
    const otherTarget = "https://other.example.com/different-page";
    const otherB64A1 = "a1" + Buffer.from(otherTarget, "utf8").toString("base64");
    const wrapped = `https://www.bing.com/ck/a?u=${otherB64A1}&r=${STD_B64_A1}`;
    expect(decodeBingRedirect(wrapped)).toBe(otherTarget);
  });

  it("recovers a target that was double percent-encoded (nested %25)", () => {
    // One layer of percent-encoding is consumed automatically by
    // URLSearchParams.get(); a second, Bing-style layer must still be
    // resolved by the function's own decodeURIComponent fallback pass.
    const target = "https://example.com/double-encoded-test";
    const onceEncoded = encodeURIComponent(target);       // "https%3A%2F%2F..."
    const twiceEncoded = encodeURIComponent(onceEncoded);  // "https%253A%252F%252F..."
    const wrapped = `https://www.bing.com/ck/a?u=a1${twiceEncoded}`;
    expect(decodeBingRedirect(wrapped)).toBe(target);
  });

  it("recovers a u param that is an unencoded absolute URL directly (no base64, no percent-encoding)", () => {
    const target = "https://example.com/already-plain";
    const wrapped = `https://www.bing.com/ck/a?u=${encodeURIComponent(target)}`;
    expect(decodeBingRedirect(wrapped)).toBe(target);
  });

  it("rejects an oversized param instead of running decode against it (sanity length cap)", () => {
    const huge = "a1" + "A".repeat(5000); // exceeds MAX_REDIRECT_PARAM_LENGTH (4096)
    const wrapped = `https://www.bing.com/ck/a?u=${huge}`;
    expect(decodeBingRedirect(wrapped)).toBe(wrapped);
  });
});
