import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { isBrowserConfigured, fetchViaBrowser, getSession, storeSession, closeSession, listSessions, sanitizeBrowserError } from "../../src/utils/browser.js";
import type { Page } from "playwright-core";

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

// ─── P0 SECURITY (#2): Browser API error must never leak creds / internal host ──

describe("sanitizeBrowserError", () => {
  it("strips wss userinfo (wss://user:pass@host → wss://host)", () => {
    const out = sanitizeBrowserError("connect wss://bot:hunter2@upg-scbr2.novada.com/cdp failed");
    expect(out).not.toContain("bot");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("bot:hunter2@");
  });

  it("redacts internal upg-scbr2.novada.com host from a raw playwright error", () => {
    const out = sanitizeBrowserError("Target page closed: upg-scbr2.novada.com");
    expect(out).not.toContain("upg-scbr2.novada.com");
    expect(out).toContain("[novada-internal-host]");
  });

  it("redacts the exact NOVADA_BROWSER_WS value when set in env", () => {
    process.env.NOVADA_BROWSER_WS = "wss://leaku:leakp@upg-scbr2.novada.com";
    const out = sanitizeBrowserError("CDP error: wss://leaku:leakp@upg-scbr2.novada.com closed");
    expect(out).not.toContain("leaku");
    expect(out).not.toContain("leakp");
    expect(out).not.toContain("upg-scbr2.novada.com");
  });
});

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
    delete process.env.NOVADA_API_KEY;
    await expect(fetchViaBrowser("https://example.com")).rejects.toThrow("Browser API not available");
  });
});

// ─── Session Management Tests ─────────────────────────────────────────────────

function createMockPage(): Page {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue("<html>session content</html>"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("storeSession / getSession", () => {
  beforeEach(() => {
    // Clean up any sessions from previous tests by closing them
    for (const id of listSessions()) {
      void closeSession(id);
    }
  });

  it("storeSession stores a page and getSession retrieves it", () => {
    const page = createMockPage();
    storeSession("test-session-1", page);
    const retrieved = getSession("test-session-1");
    expect(retrieved).toBe(page);
    // Cleanup
    void closeSession("test-session-1");
  });

  it("getSession returns null for unknown session ID", () => {
    expect(getSession("nonexistent-session")).toBeNull();
  });

  it("getSession returns null after TTL expires (mock Date.now)", () => {
    const page = createMockPage();
    storeSession("expired-session", page);

    // Advance time past the 10-minute TTL
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000);

    const result = getSession("expired-session");
    expect(result).toBeNull();
    // Verify page.close was called
    expect(page.close).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

describe("closeSession", () => {
  beforeEach(() => {
    for (const id of listSessions()) {
      void closeSession(id);
    }
  });

  it("closeSession removes session and returns true", async () => {
    const page = createMockPage();
    storeSession("close-test", page);
    const result = await closeSession("close-test");
    expect(result).toBe(true);
    expect(getSession("close-test")).toBeNull();
    expect(page.close).toHaveBeenCalled();
  });

  it("closeSession returns false for unknown session ID", async () => {
    const result = await closeSession("does-not-exist");
    expect(result).toBe(false);
  });
});

describe("listSessions", () => {
  beforeEach(() => {
    for (const id of listSessions()) {
      void closeSession(id);
    }
  });

  it("listSessions returns only non-expired sessions", () => {
    const page1 = createMockPage();
    const page2 = createMockPage();
    storeSession("list-active-1", page1);
    storeSession("list-active-2", page2);

    const ids = listSessions();
    expect(ids).toContain("list-active-1");
    expect(ids).toContain("list-active-2");

    void closeSession("list-active-1");
    void closeSession("list-active-2");
  });

  it("listSessions cleans up expired sessions", () => {
    const page = createMockPage();
    storeSession("list-expired", page);

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000);

    const ids = listSessions();
    expect(ids).not.toContain("list-expired");
    expect(page.close).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("returns empty array when no active sessions", () => {
    // All sessions should have been cleaned up by beforeEach
    const ids = listSessions();
    // Filter to our test namespace to avoid flakiness with any lingering sessions
    const testIds = ids.filter(id => id.startsWith("list-"));
    expect(testIds).toHaveLength(0);
  });
});
