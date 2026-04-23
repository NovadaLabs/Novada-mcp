import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: vi.fn() },
}));

import { novadaBrowser } from "../../src/tools/browser.js";
import { chromium } from "playwright-core";

function createMockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue("Test Page"),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue("<html><body>snapshot</body></html>"),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    evaluate: vi.fn().mockResolvedValue({ result: "ok" }),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    setDefaultTimeout: vi.fn(),
  };
}

function setupBrowserMock() {
  const mockPage = createMockPage();
  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(chromium.connectOverCDP).mockResolvedValue(mockBrowser as never);
  return mockPage;
}

describe("novadaBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns setup instructions when NOVADA_BROWSER_WS is not set", async () => {
    delete process.env.NOVADA_BROWSER_WS;
    const result = await novadaBrowser({
      actions: [{ action: "navigate", url: "https://example.com", wait_until: "domcontentloaded" }],
      timeout: 60000,
    });
    expect(result).toContain("Not Configured");
    expect(result).toContain("NOVADA_BROWSER_WS");
  });

  it("executes navigate action", async () => {
    process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";
    const mockPage = setupBrowserMock();

    const result = await novadaBrowser({
      actions: [{ action: "navigate", url: "https://example.com", wait_until: "domcontentloaded" }],
      timeout: 60000,
    });

    expect(mockPage.goto).toHaveBeenCalledWith("https://example.com", expect.objectContaining({ waitUntil: "domcontentloaded" }));
    expect(result).toContain("navigate [ok]");
    expect(result).toContain("Test Page");
  });

  it("chains multiple actions", async () => {
    process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";
    setupBrowserMock();

    const result = await novadaBrowser({
      actions: [
        { action: "navigate", url: "https://example.com", wait_until: "domcontentloaded" },
        { action: "click", selector: "#login-btn" },
        { action: "type", selector: "#email", text: "test@test.com" },
        { action: "snapshot" },
      ],
      timeout: 60000,
    });

    expect(result).toContain("actions: 4");
    expect(result).toContain("succeeded: 4");
    expect(result).toContain("failed: 0");
  });

  it("handles action failures gracefully", async () => {
    process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";
    const mockPage = setupBrowserMock();
    mockPage.click.mockRejectedValue(new Error("Element not found"));

    const result = await novadaBrowser({
      actions: [
        { action: "navigate", url: "https://example.com", wait_until: "domcontentloaded" },
        { action: "click", selector: "#nonexistent" },
        { action: "snapshot" },
      ],
      timeout: 60000,
    });

    expect(result).toContain("succeeded: 2");
    expect(result).toContain("failed: 1");
    expect(result).toContain("Element not found");
  });

  it("executes evaluate action", async () => {
    process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";
    const mockPage = setupBrowserMock();
    mockPage.evaluate.mockResolvedValue({ price: "€1,579" });

    const result = await novadaBrowser({
      actions: [
        { action: "navigate", url: "https://example.com", wait_until: "domcontentloaded" },
        { action: "evaluate", script: "document.querySelector('.price').textContent" },
      ],
      timeout: 60000,
    });

    expect(result).toContain("evaluate [ok]");
    expect(result).toContain("€1,579");
  });

  it("reports session time", async () => {
    process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";
    setupBrowserMock();

    const result = await novadaBrowser({
      actions: [{ action: "navigate", url: "https://example.com", wait_until: "domcontentloaded" }],
      timeout: 60000,
    });

    expect(result).toMatch(/time: \d+ms/);
  });
});
