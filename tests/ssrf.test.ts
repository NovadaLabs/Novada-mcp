/**
 * SSRF guard tests — safeUrl via validateExtractParams / validateMapParams / validateCrawlParams.
 * No network calls. All tests are pure schema validation.
 */

import { describe, it, expect } from "vitest";
import { validateExtractParams } from "../src/tools/types.js";
import { validateMapParams } from "../src/tools/types.js";
import { validateCrawlParams } from "../src/tools/types.js";
import { validateUnblockParams } from "../src/tools/types.js";
import { assertUrlSafe, isUrlSafe, isBlockedIp, isBlockedHost, safeLookup } from "../src/utils/ssrf.js";
import { fetchViaBrowser } from "../src/utils/browser.js";

// Helper: assert a URL is blocked by the SSRF guard
function expectBlocked(url: string) {
  expect(() => validateExtractParams({ url })).toThrow();
}

// Helper: assert a URL passes
function expectAllowed(url: string) {
  expect(() => validateExtractParams({ url })).not.toThrow();
}

describe("SSRF guard — blocked hosts", () => {
  it("blocks localhost", () => expectBlocked("http://localhost/secret"));
  it("blocks localhost with port", () => expectBlocked("http://localhost:8080/admin"));
  it("blocks 127.0.0.1", () => expectBlocked("http://127.0.0.1/"));
  it("blocks 127.x.x.x range", () => expectBlocked("http://127.0.0.2/"));
  it("blocks 10.x.x.x (private)", () => expectBlocked("http://10.0.0.1/"));
  it("blocks 192.168.x.x (private)", () => expectBlocked("http://192.168.1.1/"));
  it("blocks 172.16.x.x (private)", () => expectBlocked("http://172.16.0.1/"));
  it("blocks 172.31.x.x (private upper bound)", () => expectBlocked("http://172.31.255.255/"));
  it("blocks 169.254.x.x (link-local)", () => expectBlocked("http://169.254.169.254/latest/meta-data/"));
  it("blocks 0.0.0.0", () => expectBlocked("http://0.0.0.0/"));
  it("blocks IPv6 loopback ::1", () => expectBlocked("http://[::1]/"));
  it("blocks decimal IP 2130706433 (= 127.0.0.1)", () => expectBlocked("http://2130706433/"));
  it("blocks hex IP 0x7f000001 (= 127.0.0.1)", () => expectBlocked("http://0x7f000001/"));
  it("blocks file:// protocol", () => expectBlocked("file:///etc/passwd"));
  it("blocks ftp:// protocol", () => expectBlocked("ftp://example.com/file"));
  it("blocks URL with embedded newline", () => expectBlocked("https://example.com/\nHost: evil.com"));
  it("blocks URL with embedded carriage return", () => expectBlocked("https://example.com/\rHost: evil.com"));
});

describe("SSRF guard — allowed hosts", () => {
  it("allows public HTTPS URL", () => expectAllowed("https://example.com/page"));
  it("allows public HTTP URL", () => expectAllowed("http://example.com/page"));
  it("allows URL with path and query", () => expectAllowed("https://api.example.com/v1/items?page=1"));
  it("allows URL with port on public host", () => expectAllowed("https://example.com:8443/path"));
  it("does NOT block 172.15.x.x (just outside private range)", () =>
    expectAllowed("http://172.15.0.1/"));
  it("does NOT block 172.32.x.x (just outside private range)", () =>
    expectAllowed("http://172.32.0.1/"));
});

describe("SSRF guard — safeUrl applies across all relevant schemas", () => {
  it("validateMapParams blocks private IP", () => {
    expect(() => validateMapParams({ url: "http://192.168.0.1/" })).toThrow();
  });

  it("validateCrawlParams blocks private IP", () => {
    expect(() => validateCrawlParams({ url: "http://10.0.0.1/" })).toThrow();
  });

  it("validateUnblockParams blocks localhost", () => {
    expect(() => validateUnblockParams({ url: "http://localhost/admin" })).toThrow();
  });

  it("validateUnblockParams blocks decimal IP", () => {
    expect(() => validateUnblockParams({ url: "http://2130706433/" })).toThrow();
  });
});

describe("assertUrlSafe / isUrlSafe — fetch-layer chokepoint", () => {
  // This guard re-validates runtime-discovered URLs (sitemap/robots/llms.txt/BFS)
  // and redirect targets — the channels the Zod boundary never sees.
  const blocked = [
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/", // AWS metadata
    "http://127.0.0.1:8080/admin",
    "http://localhost/secret",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://2130706433/",   // decimal 127.0.0.1
    "http://0x7f000001/",   // hex 127.0.0.1
    "file:///etc/passwd",
    "ftp://example.com/x",
    "https://ok.com/\nHost: evil",
  ];
  for (const u of blocked) {
    it(`isUrlSafe=false + assertUrlSafe throws for ${u}`, () => {
      expect(isUrlSafe(u)).toBe(false);
      expect(() => assertUrlSafe(u)).toThrow(/SSRF guard/);
    });
  }

  const allowed = [
    "https://example.com/page",
    "http://api.example.com/v1/items?page=1",
    "https://example.com:8443/path",
    "http://172.15.0.1/",  // just outside private range
  ];
  for (const u of allowed) {
    it(`isUrlSafe=true + assertUrlSafe passes for ${u}`, () => {
      expect(isUrlSafe(u)).toBe(true);
      expect(() => assertUrlSafe(u)).not.toThrow();
    });
  }

  it("error message includes the supplied context", () => {
    expect(() => assertUrlSafe("http://169.254.169.254/", "redirect target"))
      .toThrow(/redirect target/);
  });
});

describe("fetchViaBrowser — SSRF guard at the CDP fetch path", () => {
  // fetchViaBrowser is the ONE fetch primitive that bypasses http.ts's assertUrlSafe.
  // The enrich_top path feeds it non-Zod-validated scraped SERP URLs in render="auto",
  // which can escalate to the browser. The guard must reject private/loopback/link-local
  // targets BEFORE any CDP connection is attempted (no NOVADA_BROWSER_WS needed for these).
  const blocked = [
    "http://169.254.169.254/latest/meta-data/", // AWS metadata
    "http://localhost:6379/",                    // local Redis
    "http://127.0.0.1:8080/admin",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://2130706433/",                        // decimal 127.0.0.1
    "file:///etc/passwd",
  ];
  for (const u of blocked) {
    it(`rejects ${u} with the SSRF guard before connecting`, async () => {
      await expect(fetchViaBrowser(u)).rejects.toThrow(/SSRF guard/);
    });
  }
});

describe("SSRF guard — non-literal private ranges (numeric-parse blocklist)", () => {
  // These dotted/bracketed forms slipped past the old string-alternation blocklist.
  // Asserted at BOTH the Zod boundary (validateExtractParams) and the runtime helper.
  const newlyBlocked = [
    "http://0.0.0.1/",                   // 0.0.0.0/8 "this host" — routes to loopback on Linux
    "http://0.255.255.255/",             // 0.0.0.0/8 upper
    "http://100.64.0.1/",                // 100.64.0.0/10 CGNAT
    "http://100.127.255.255/",           // CGNAT upper bound
    "http://[fc00::1]/",                 // IPv6 ULA fc00::/7
    "http://[fd00::1]/",                 // IPv6 ULA fd00::
    "http://[::127.0.0.1]/",             // IPv4-compatible loopback
    "http://[::ffff:127.0.0.1]/",        // IPv4-mapped loopback
    "http://[::ffff:169.254.169.254]/",  // IPv4-mapped link-local metadata
    "http://[::ffff:10.0.0.1]/",         // IPv4-mapped private
  ];
  for (const u of newlyBlocked) {
    it(`Zod boundary blocks ${u}`, () => expect(() => validateExtractParams({ url: u })).toThrow());
    it(`isUrlSafe=false + assertUrlSafe throws for ${u}`, () => {
      expect(isUrlSafe(u)).toBe(false);
      expect(() => assertUrlSafe(u)).toThrow(/SSRF guard/);
    });
  }

  // Adjacent public addresses must NOT be falsely blocked (range boundaries are exact).
  const stillAllowed = [
    "http://100.63.255.255/",            // just below CGNAT
    "http://100.128.0.1/",               // just above CGNAT
    "http://1.1.1.1/",                   // public
    "http://[2606:4700:4700::1111]/",    // Cloudflare public IPv6
  ];
  for (const u of stillAllowed) {
    it(`isUrlSafe=true for public ${u}`, () => expect(isUrlSafe(u)).toBe(true));
  }

  it("isBlockedIp classifies literal IPs by numeric range", () => {
    expect(isBlockedIp("0.0.0.1")).toBe(true);
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456::1")).toBe(true);
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("not-an-ip")).toBe(false);
  });

  it("isBlockedHost shares the boundary + chokepoint logic (localhost, decimal, hex)", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("sub.localhost")).toBe(true);
    expect(isBlockedHost("2130706433")).toBe(true); // decimal 127.0.0.1
    expect(isBlockedHost("0x7f000001")).toBe(true); // hex 127.0.0.1
    expect(isBlockedHost("[fc00::1]")).toBe(true);   // bracketed ULA
    expect(isBlockedHost("example.com")).toBe(false);
  });
});

describe("safeLookup — DNS-rebinding guard (resolved-IP re-check)", () => {
  // The ONLY defense against a PUBLIC hostname whose A/AAAA record points at a private IP.
  // safeLookup resolves, then refuses any blocked result before the socket connects.
  function call(host: string, opts: object = {}): Promise<{ err?: string; addr?: unknown }> {
    return new Promise((resolve) => {
      safeLookup(host, opts, (err, addr) => resolve({ err: err?.message, addr }));
    });
  }

  it("rejects a literal private IP without hitting DNS", async () => {
    const r = await call("127.0.0.1");
    expect(r.err).toMatch(/SSRF guard/);
  });

  it("rejects a literal link-local metadata IP", async () => {
    const r = await call("169.254.169.254");
    expect(r.err).toMatch(/SSRF guard/);
  });

  it("rejects a hostname that RESOLVES to loopback (rebinding) — localhost", async () => {
    const r = await call("localhost");
    expect(r.err).toMatch(/SSRF guard|resolved to private/);
  });

  it("allows a public hostname that resolves to a public IP", async () => {
    const r = await call("example.com");
    // Either resolves to a public address, or DNS is unavailable in CI — but it must NOT
    // be rejected by the SSRF guard.
    if (r.err) expect(r.err).not.toMatch(/SSRF guard/);
    else expect(typeof r.addr).toBe("string");
  });
});
