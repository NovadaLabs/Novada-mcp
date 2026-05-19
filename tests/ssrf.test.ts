/**
 * SSRF guard tests — safeUrl via validateExtractParams / validateMapParams / validateCrawlParams.
 * No network calls. All tests are pure schema validation.
 */

import { describe, it, expect } from "vitest";
import { validateExtractParams } from "../src/tools/types.js";
import { validateMapParams } from "../src/tools/types.js";
import { validateCrawlParams } from "../src/tools/types.js";
import { validateUnblockParams } from "../src/tools/types.js";

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
