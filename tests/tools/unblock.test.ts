import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("axios");
vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: vi.fn() },
}));

import { novadaUnblock } from "../../src/tools/unblock.js";
import axios from "axios";

const RENDERED_HTML = "<html><body><h1>Rendered Page</h1><p>JS content loaded successfully with plenty of text.</p></body></html>";

describe("novadaUnblock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-unblocker-key";
    delete process.env.NOVADA_BROWSER_WS;
  });

  it("returns rendered HTML via Web Unblocker", async () => {
    vi.mocked(axios).post.mockResolvedValue({
      data: { code: 0, data: { code: 200, html: RENDERED_HTML } },
      status: 200, statusText: "OK", headers: {}, config: {} as never,
    });

    const result = await novadaUnblock({
      url: "https://spa-app.com",
      method: "render",
      timeout: 30000,
    }, "api-key");

    expect(result).toContain("## Unblocked Content");
    expect(result).toContain("url: https://spa-app.com");
    expect(result).toContain("method: render");
    expect(result).toContain("Rendered Page");
  });

  it("includes cost metadata in output", async () => {
    vi.mocked(axios).post.mockResolvedValue({
      data: { code: 0, data: { code: 200, html: RENDERED_HTML } },
      status: 200, statusText: "OK", headers: {}, config: {} as never,
    });

    const result = await novadaUnblock({
      url: "https://example.com",
      method: "render",
      timeout: 30000,
    }, "api-key");

    expect(result).toContain("cost: medium");
  });

  it("shows agent hints for raw HTML", async () => {
    vi.mocked(axios).post.mockResolvedValue({
      data: { code: 0, data: { code: 200, html: RENDERED_HTML } },
      status: 200, statusText: "OK", headers: {}, config: {} as never,
    });

    const result = await novadaUnblock({
      url: "https://example.com",
      method: "render",
      timeout: 30000,
    }, "api-key");

    expect(result).toContain("raw HTML");
    expect(result).toContain("novada_extract");
  });

  it("truncates HTML over 50K chars", async () => {
    const bigHtml = "<html>" + "x".repeat(60000) + "</html>";
    vi.mocked(axios).post.mockResolvedValue({
      data: { code: 0, data: { code: 200, html: bigHtml } },
      status: 200, statusText: "OK", headers: {}, config: {} as never,
    });

    const result = await novadaUnblock({
      url: "https://example.com",
      method: "render",
      timeout: 30000,
    }, "api-key");

    expect(result).toContain("truncated to 50000");
  });
});
