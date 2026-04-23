import { describe, it, expect, vi } from "vitest";
import axios from "axios";
import { detectJsHeavyContent, detectBotChallenge, fetchWithRender } from "../../src/utils/http.js";

describe("detectJsHeavyContent", () => {
  it("detects empty content as JS-heavy", () => {
    expect(detectJsHeavyContent("")).toBe(true);
  });

  it("detects 'enable javascript' message as JS-heavy", () => {
    expect(detectJsHeavyContent(
      '<html><body><p>Please enable JavaScript to continue.</p></body></html>'
    )).toBe(true);
  });

  it("detects content shorter than threshold as JS-heavy", () => {
    expect(detectJsHeavyContent("<html><body><p>Hi</p></body></html>")).toBe(true);
  });

  it("detects cloudflare challenge page as JS-heavy", () => {
    expect(detectJsHeavyContent(
      '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>'
    )).toBe(true);
  });

  it("detects rich content as NOT JS-heavy", () => {
    const richContent = "<html><body>" + "word ".repeat(100) + "</body></html>";
    expect(detectJsHeavyContent(richContent)).toBe(false);
  });
});

describe("detectBotChallenge", () => {
  it("returns true for Cloudflare page with 'just a moment'", () => {
    const html = `
      <html><head><title>Just a moment...</title></head>
      <body><p>Please wait while we verify your browser.</p></body></html>
    `;
    expect(detectBotChallenge(html)).toBe(true);
  });

  it("returns true for Cloudflare page with cf-browser-verification signal", () => {
    const html = `
      <html><head><title>Checking...</title></head>
      <body><div id="cf-browser-verification">Checking your browser</div></body></html>
    `;
    expect(detectBotChallenge(html)).toBe(true);
  });

  it("returns true for Akamai page with _abck signal", () => {
    const html = `
      <html><head><title>Loading</title></head>
      <body><script>window._abck = 'abc';</script><div>wait</div></body></html>
    `;
    expect(detectBotChallenge(html)).toBe(true);
  });

  it("returns true for blank title combined with tiny body text", () => {
    const html = `<html><head><title></title></head><body><div>hi</div></body></html>`;
    expect(detectBotChallenge(html)).toBe(true);
  });

  it("returns false for a normal content page", () => {
    const richContent = "word ".repeat(200);
    const html = `
      <html><head><title>A Normal Page</title></head>
      <body>
        <div>
          <h1>Welcome</h1>
          <p>${richContent}</p>
          <p>Another paragraph of real content to make sure this passes all heuristic checks.</p>
        </div>
      </body></html>
    `;
    expect(detectBotChallenge(html)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(detectBotChallenge("")).toBe(false);
  });
});

describe("fetchWithRender", () => {
  it("POSTs to webunlocker.novada.com when NOVADA_WEB_UNBLOCKER_KEY is set", async () => {
    vi.mock("axios");
    const mockedAxios = vi.mocked(axios);
    const originalKey = process.env.NOVADA_WEB_UNBLOCKER_KEY;
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "unblocker-key";

    mockedAxios.post.mockResolvedValue({
      data: { code: 0, data: { code: 200, html: "<html><body><p>Rendered content</p></body></html>", msg: "", msg_detail: "" } },
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    const result = await fetchWithRender("https://example.com", "test-key");
    expect(result.data).toContain("Rendered content");
    // Must use POST to webunlocker, not GET to scraper
    expect(mockedAxios.post).toHaveBeenCalled();
    const [url, body] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("webunlocker.novada.com");
    expect((body as Record<string, unknown>).js_render).toBe(true);
    expect((body as Record<string, unknown>).target_url).toBe("https://example.com");

    process.env.NOVADA_WEB_UNBLOCKER_KEY = originalKey;
  });

  it("falls back to scraper GET when NOVADA_WEB_UNBLOCKER_KEY is not set", async () => {
    vi.mock("axios");
    const mockedAxios = vi.mocked(axios);
    const originalKey = process.env.NOVADA_WEB_UNBLOCKER_KEY;
    delete process.env.NOVADA_WEB_UNBLOCKER_KEY;

    mockedAxios.get.mockResolvedValue({
      data: "<html><body><p>Fallback content</p></body></html>",
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    const result = await fetchWithRender("https://example.com", "test-key");
    expect(result.data).toContain("Fallback content");
    const calledUrl = (mockedAxios.get.mock.calls[0][0] as string);
    expect(calledUrl).toContain("scraper.novada.com");

    process.env.NOVADA_WEB_UNBLOCKER_KEY = originalKey;
  });
});
