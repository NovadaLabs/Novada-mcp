import { describe, it, expect, afterEach } from "vitest";
import { isBrowserConfigured, fetchViaBrowser } from "../../src/utils/browser.js";

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

describe("isBrowserConfigured", () => {
  it("returns false when NOVADA_BROWSER_WS not set", () => {
    delete process.env.NOVADA_BROWSER_WS;
    expect(isBrowserConfigured()).toBe(false);
  });

  it("returns true when NOVADA_BROWSER_WS is set", () => {
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@upg-scbr.novada.com";
    expect(isBrowserConfigured()).toBe(true);
  });
});

describe("fetchViaBrowser", () => {
  it("throws when Browser API not configured", async () => {
    delete process.env.NOVADA_BROWSER_WS;
    await expect(fetchViaBrowser("https://example.com")).rejects.toThrow("NOVADA_BROWSER_WS not configured");
  });
});
