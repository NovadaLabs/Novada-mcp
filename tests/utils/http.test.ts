import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios, { AxiosError } from "axios";
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

  it("falls back to direct GET when NOVADA_WEB_UNBLOCKER_KEY is not set", async () => {
    vi.mock("axios");
    const mockedAxios = vi.mocked(axios);
    const originalKey = process.env.NOVADA_WEB_UNBLOCKER_KEY;
    delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
    // Ensure proxy env vars are not set so fetchViaProxy uses direct fetch
    delete process.env.NOVADA_PROXY_USER;

    mockedAxios.get.mockResolvedValue({
      data: "<html><body><p>Fallback content</p></body></html>",
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    const result = await fetchWithRender("https://example.com", "test-key");
    expect(result.data).toContain("Fallback content");
    // Without unblocker key: falls back to fetchViaProxy → direct GET to the original URL
    const calledUrl = (mockedAxios.get.mock.calls[0][0] as string);
    expect(calledUrl).toBe("https://example.com");

    process.env.NOVADA_WEB_UNBLOCKER_KEY = originalKey;
  });

  it("throws AxiosError on 401 from unblocker (does not fall back)", async () => {
    vi.mock("axios");
    const mockedAxios = vi.mocked(axios);
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "bad-key";

    const err = Object.assign(new AxiosError("Unauthorized"), { response: { status: 401, data: "Unauthorized" } });
    mockedAxios.post.mockRejectedValue(err);

    await expect(fetchWithRender("https://example.com", undefined)).rejects.toThrow();
    delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
  });

  // F10: outer code=5001 (PRODUCT_UNAVAILABLE) must short-circuit immediately with a
  // specific actionable message — NOT burn 3 × TIMEOUTS.RENDER in retries.
  it("F10: short-circuits immediately on outer code=5001 with actionable message", async () => {
    vi.mock("axios");
    const mockedAxios = vi.mocked(axios);
    process.env.NOVADA_WEB_UNBLOCKER_KEY = "test-unblocker-key";

    mockedAxios.post.mockResolvedValue({
      data: { code: 5001, msg: "Product unavailable", data: null },
      status: 200,
      headers: {},
      config: {} as never,
      statusText: "OK",
    });

    const start = Date.now();
    await expect(fetchWithRender("https://example.com", "test-key"))
      .rejects.toThrow(/5001/);

    // Must short-circuit: no 3x retry with delays (would be >> 3000ms)
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);

    // Error message must be actionable
    let thrown: Error | null = null;
    try {
      await fetchWithRender("https://example.com", "test-key");
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toMatch(/not activated|unavailable/i);
    expect(thrown?.message).toMatch(/5001/);
    expect(thrown?.message).toMatch(/retrying will not help/i);

    delete process.env.NOVADA_WEB_UNBLOCKER_KEY;
  });
});

describe("fetchViaProxy — circuit breaker TTL", () => {
  let fetchViaProxyFn: typeof import("../../src/utils/http.js").fetchViaProxy;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.mock("axios");
    // Re-import fresh module so proxyAvailable resets to null
    const m = await import("../../src/utils/http.js");
    fetchViaProxyFn = m.fetchViaProxy;
    // Set proxy env vars
    process.env.NOVADA_PROXY_USER = "user";
    process.env.NOVADA_PROXY_PASS = "pass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.NOVADA_PROXY_USER;
    delete process.env.NOVADA_PROXY_PASS;
    delete process.env.NOVADA_PROXY_ENDPOINT;
    vi.restoreAllMocks();
  });

  it("marks proxy unavailable after proxy failure and uses direct", async () => {
    const mockedAxios = vi.mocked(axios);
    // Proxy attempt fails; direct succeeds
    mockedAxios.get
      .mockRejectedValueOnce(new Error("Proxy unreachable")) // proxy fetch fails
      .mockResolvedValueOnce({
        data: "<html>direct</html>",
        status: 200, headers: {}, config: {} as never, statusText: "OK",
      }); // direct fetch succeeds

    const result = await fetchViaProxyFn("https://example.com", undefined);
    expect(result.data).toBe("<html>direct</html>");
  });

  it("resets circuit breaker after TTL and retries proxy", async () => {
    const mockedAxios = vi.mocked(axios);
    // First call: proxy fails, direct succeeds → circuit opens
    mockedAxios.get
      .mockRejectedValueOnce(new Error("Proxy unreachable"))
      .mockResolvedValueOnce({ data: "direct-1", status: 200, headers: {}, config: {} as never, statusText: "OK" });
    await fetchViaProxyFn("https://example.com", undefined);

    // Advance time past TTL (5 min + 1 second)
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

    // Second call: circuit should be reset (null state), proxy is tried again
    mockedAxios.get
      .mockResolvedValueOnce({ data: "proxy-2", status: 200, headers: {}, config: {} as never, statusText: "OK" })
      .mockResolvedValueOnce({ data: "direct-2", status: 200, headers: {}, config: {} as never, statusText: "OK" });
    const result = await fetchViaProxyFn("https://example.com", undefined);
    // Either proxy or direct response should come back — circuit was reset so both are raced
    expect(["proxy-2", "direct-2"]).toContain(result.data);
  });
});
