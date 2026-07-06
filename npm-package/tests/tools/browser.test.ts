import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: vi.fn() },
}));

import { novadaBrowser } from "../../src/tools/browser.js";
import { chromium } from "playwright-core";
import { closeSession, listSessions } from "../../src/utils/browser.js";

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
    close: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    selectOption: vi.fn().mockResolvedValue(undefined),
    ariaSnapshot: vi.fn().mockResolvedValue("- document:\n  - button \"Submit\""),
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
    // Clean up any sessions from previous tests
    for (const id of listSessions()) {
      void closeSession(id);
    }
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

  it("includes session_id and session_active in response when session_id provided", async () => {
    process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";
    setupBrowserMock();

    const result = await novadaBrowser({
      actions: [{ action: "navigate", url: "https://example.com", wait_until: "domcontentloaded" }],
      timeout: 60000,
      session_id: "test-persistent-session",
    });

    expect(result).toContain("session_id: test-persistent-session");
    expect(result).toContain("session_active: true");
    // Cleanup
    await closeSession("test-persistent-session");
  });

  it("close_session action returns closed status when session exists", async () => {
    process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";
    setupBrowserMock();

    // Create a session first
    await novadaBrowser({
      actions: [{ action: "navigate", url: "https://example.com", wait_until: "domcontentloaded" }],
      timeout: 60000,
      session_id: "close-test-session",
    });

    const result = await novadaBrowser({
      actions: [{ action: "close_session" }],
      timeout: 60000,
      session_id: "close-test-session",
    });

    expect(result).toContain("Session Closed");
    expect(result).toContain("close-test-session");
  });

  it("close_session returns not_found for unknown session", async () => {
    process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";

    const result = await novadaBrowser({
      actions: [{ action: "close_session" }],
      timeout: 60000,
      session_id: "nonexistent-session-xyz",
    });

    expect(result).toContain("not_found");
  });

  it("list_sessions returns active sessions", async () => {
    process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";

    const result = await novadaBrowser({
      actions: [{ action: "list_sessions" }],
      timeout: 60000,
    });

    expect(result).toContain("Active Browser Sessions");
    expect(result).toContain("count:");
  });
});

describe("new browser actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const id of listSessions()) {
      void closeSession(id);
    }
    process.env.NOVADA_BROWSER_WS = "wss://test:test@example.com";
  });

  it("hover: calls page.hover with selector and returns ok", async () => {
    const mockPage = setupBrowserMock();

    const result = await novadaBrowser({
      actions: [{ action: "hover", selector: ".menu-item" }],
      timeout: 60000,
    });

    expect(mockPage.hover).toHaveBeenCalledWith(".menu-item");
    expect(result).toContain("hover [ok]");
    expect(result).toContain(".menu-item");
  });

  it("press_key without selector: presses key and returns ok", async () => {
    const mockPage = setupBrowserMock();

    const result = await novadaBrowser({
      actions: [{ action: "press_key", key: "Enter" }],
      timeout: 60000,
    });

    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Enter");
    expect(mockPage.focus).not.toHaveBeenCalled();
    expect(result).toContain("press_key [ok]");
    expect(result).toContain("Pressed: Enter");
  });

  it("press_key with selector: focuses element then presses key", async () => {
    const mockPage = setupBrowserMock();

    const result = await novadaBrowser({
      actions: [{ action: "press_key", key: "Tab", selector: "#input-field" }],
      timeout: 60000,
    });

    expect(mockPage.focus).toHaveBeenCalledWith("#input-field");
    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Tab");
    expect(result).toContain("press_key [ok]");
    expect(result).toContain("focused: #input-field");
  });

  it("select: calls page.selectOption with selector and value, returns ok", async () => {
    const mockPage = setupBrowserMock();

    const result = await novadaBrowser({
      actions: [{ action: "select", selector: "#country-dropdown", value: "us" }],
      timeout: 60000,
    });

    expect(mockPage.selectOption).toHaveBeenCalledWith("#country-dropdown", "us");
    expect(result).toContain("select [ok]");
    expect(result).toContain("us");
    expect(result).toContain("#country-dropdown");
  });

  it("aria_snapshot: calls page.ariaSnapshot() and returns YAML accessibility tree", async () => {
    const mockPage = setupBrowserMock();
    const ariaYaml = `- document:\n  - button "Submit" [focused]\n  - textbox "Email"`;
    mockPage.ariaSnapshot.mockResolvedValue(ariaYaml);

    const result = await novadaBrowser({
      actions: [{ action: "aria_snapshot" }],
      timeout: 60000,
    });

    expect(mockPage.ariaSnapshot).toHaveBeenCalled();
    expect(result).toContain("aria_snapshot [ok]");
    expect(result).toContain("button");
  });

  it("aria_snapshot: returns graceful message when ariaSnapshot returns null", async () => {
    const mockPage = setupBrowserMock();
    mockPage.ariaSnapshot.mockResolvedValue(null);

    const result = await novadaBrowser({
      actions: [{ action: "aria_snapshot" }],
      timeout: 60000,
    });

    expect(result).toContain("aria_snapshot [ok]");
    expect(result).toContain("no accessible content");
  });
});
