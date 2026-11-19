import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios, { AxiosError } from "axios";
import { detectJsHeavyContent, detectBotChallenge, fetchWithRender, fetchWithRetry } from "../../src/utils/http.js";

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
    // Body is a URLSearchParams string — parse it before asserting field values.
    const parsed = new URLSearchParams(body as string);
    expect(parsed.get("js_render")).toBe("true");
    expect(parsed.get("target_url")).toBe("https://example.com");

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

/**
 * #4 (2026-11-19, irs.gov/sec.gov PDF repro): axios's own default responseType
 * ("json", falling back to its implicit string decode) reads the socket as text —
 * for a real PDF this silently drops any byte that is not valid UTF-8 (every
 * continuation byte in a compressed stream is a candidate), corrupting the
 * xref/trailer table and producing pdf-parse's "Invalid Root reference". Fix:
 * fetchWithRetry always requests `responseType: "arraybuffer"` and decides,
 * post-response, whether to hand back the raw Buffer (PDF) or a utf-8 string
 * (everything else — unchanged shape for every existing non-PDF caller).
 */
describe("fetchWithRetry — byte-exact PDF fetch (#4)", () => {
  beforeEach(() => {
    vi.mock("axios");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A byte sequence that is NOT valid UTF-8 on its own (a lone continuation byte,
   *  0xE9, with no leading byte) — exactly the class of byte a naive
   *  decode-then-Buffer.from(str,"binary") round trip mangles, since the decoder
   *  replaces it with U+FFFD (3 bytes) before the "binary" re-encode ever runs. */
  function corruptibleBytes(): Buffer {
    return Buffer.from([0x25, 0x50, 0x44, 0x46, 0xe9, 0x00, 0x01, 0xff, 0xfe, 0x41, 0x42]);
  }

  it("always requests responseType: arraybuffer from axios, regardless of caller options", async () => {
    const mockedAxios = vi.mocked(axios);
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from("<html><body>hi</body></html>", "utf-8"),
      status: 200, headers: { "content-type": "text/html" }, config: {} as never, statusText: "OK",
    });
    await fetchWithRetry("https://example.com/page", { tool: "extract" });
    const config = mockedAxios.get.mock.calls[0][1] as Record<string, unknown>;
    expect(config.responseType).toBe("arraybuffer");
  });

  it("returns the exact original bytes (no mangling) for a PDF content-type, instead of a lossy string round trip", async () => {
    const mockedAxios = vi.mocked(axios);
    const raw = corruptibleBytes();
    mockedAxios.get.mockResolvedValue({
      data: raw, status: 200, headers: { "content-type": "application/pdf" }, config: {} as never, statusText: "OK",
    });
    const resp = await fetchWithRetry("https://example.com/report.pdf", { tool: "extract" });
    expect(Buffer.isBuffer(resp.data)).toBe(true);
    expect(Buffer.compare(resp.data as Buffer, raw)).toBe(0);
  });

  it("detects PDF by URL extension alone, even when the server omits/misreports content-type", async () => {
    const mockedAxios = vi.mocked(axios);
    const raw = corruptibleBytes();
    mockedAxios.get.mockResolvedValue({
      data: raw, status: 200, headers: {}, config: {} as never, statusText: "OK", // no content-type header
    });
    const resp = await fetchWithRetry("https://example.com/f1040.pdf", { tool: "extract" });
    expect(Buffer.isBuffer(resp.data)).toBe(true);
    expect(Buffer.compare(resp.data as Buffer, raw)).toBe(0);
  });

  it("mirror: a non-PDF response is still decoded to a plain string (unchanged shape for every existing caller)", async () => {
    const mockedAxios = vi.mocked(axios);
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from("<html><body>hello world</body></html>", "utf-8"),
      status: 200, headers: { "content-type": "text/html" }, config: {} as never, statusText: "OK",
    });
    const resp = await fetchWithRetry("https://example.com/page", { tool: "extract" });
    expect(typeof resp.data).toBe("string");
    expect(resp.data).toContain("hello world");
  });

  it("a mocked transport that hands back an already-parsed object (bypassing responseType) is passed through untouched, not crashed on", async () => {
    const mockedAxios = vi.mocked(axios);
    mockedAxios.get.mockResolvedValue({
      data: { already: "parsed" }, status: 200, headers: { "content-type": "application/json" }, config: {} as never, statusText: "OK",
    });
    const resp = await fetchWithRetry("https://api.example.com/data.json", { tool: "extract" });
    expect(resp.data).toEqual({ already: "parsed" });
  });
});

/**
 * #2 (2026-11-19, follow-up to #4): #4 made the fetch byte-exact but the
 * DECODE was still an unconditional `buf.toString("utf-8")` — correct for
 * the overwhelming majority of pages, but mojibake on any page served in a
 * legacy charset (Shift_JIS, GBK/GB18030, windows-1252). Fixed by detecting
 * the real charset (Content-Type header → <meta charset> sniff → utf-8
 * default) and decoding with Node's ICU-backed TextDecoder.
 *
 * Fixture bytes below were generated with `iconv-lite` (real encode, not a
 * hand-rolled byte table) and round-trip-verified against Node's own
 * TextDecoder before being frozen as base64 literals, so these tests exercise
 * the exact decode path production code uses, not a tautological self-check.
 */
describe("decodeHtmlBuffer / detectCharset — legacy charset decoding (#2)", () => {
  // "<html><head><meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS">
  //  </head><body><p>こんにちは、世界。これは日本語のテストページです。(x3)</p></body></html>"
  const SJIS_B64 = "PGh0bWw+PGhlYWQ+PG1ldGEgaHR0cC1lcXVpdj0iQ29udGVudC1UeXBlIiBjb250ZW50PSJ0ZXh0L2h0bWw7IGNoYXJzZXQ9U2hpZnRfSklTIj48L2hlYWQ+PGJvZHk+PHA+grGC8YLJgr+CzYFBkKKKRYFCgrGC6oLNk/qWe4zqgsyDZYNYg2eDeYFbg1eCxYK3gUKCsYLxgsmCv4LNgUGQoopFgUKCsYLqgs2T+pZ7jOqCzINlg1iDZ4N5gVuDV4LFgreBQoKxgvGCyYK/gs2BQZCiikWBQoKxguqCzZP6lnuM6oLMg2WDWINng3mBW4NXgsWCt4FCPC9wPjwvYm9keT48L2h0bWw+";
  // "<html><head><meta charset="GBK"></head><body><p>你好，世界。这是一个中文测试页面，用于验证字符集解码是否正确。(x3)</p></body></html>"
  const GBK_B64 = "PGh0bWw+PGhlYWQ+PG1ldGEgY2hhcnNldD0iR0JLIj48L2hlYWQ+PGJvZHk+PHA+xOO6w6OsysC956Gj1eLKx9K7uPbW0M7EsuLK1NKzw+ajrNPD09rR6dak19a3+7yvveLC68rHt/HV/ci3oaPE47rDo6zKwL3noaPV4srH0ru49tbQzsSy4srU0rPD5qOs08PT2tHp1qTX1rf7vK+94sLryse38dX9yLeho8TjusOjrMrAveeho9XiysfSu7j21tDOxLLiytTSs8Pmo6zTw9Pa0enWpNfWt/u8r73iwuvKx7fx1f3It6GjPC9wPjwvYm9keT48L2h0bWw+";
  // "<html><head><meta charset="windows-1252"></head><body><p>Café précisément — le prix est de €99 par mois.(x3)</p></body></html>"
  const CP1252_B64 = "PGh0bWw+PGhlYWQ+PG1ldGEgY2hhcnNldD0id2luZG93cy0xMjUyIj48L2hlYWQ+PGJvZHk+PHA+Q2Fm6SBwculjaXPpbWVudCCXIGxlIHByaXggZXN0IGRlIIA5OSBwYXIgbW9pcy5DYWbpIHBy6WNpc+ltZW50IJcgbGUgcHJpeCBlc3QgZGUggDk5IHBhciBtb2lzLkNhZukgcHLpY2lz6W1lbnQglyBsZSBwcml4IGVzdCBkZSCAOTkgcGFyIG1vaXMuPC9wPjwvYm9keT48L2h0bWw+";
  // Same Japanese text, no meta tag at all — charset comes ONLY from Content-Type header.
  const SJIS_NOMETA_B64 = "PGh0bWw+PGJvZHk+PHA+grGC8YLJgr+CzZCiikWCsYLxgsmCv4LNkKKKRYKxgvGCyYK/gs2QoopFgrGC8YLJgr+CzZCiikWCsYLxgsmCv4LNkKKKRTwvcD48L2JvZHk+PC9odG1sPg==";

  it("Shift_JIS (meta http-equiv charset): decodes to real Japanese text, no mojibake", async () => {
    const mockedAxios = vi.mocked(axios);
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from(SJIS_B64, "base64"),
      status: 200, headers: { "content-type": "text/html" }, config: {} as never, statusText: "OK",
    });
    const resp = await fetchWithRetry("https://example.jp/page", { tool: "extract" });
    expect(resp.data as string).toContain("こんにちは、世界。");
    expect(resp.data as string).toContain("日本語のテストページ");
  });

  it("GBK/GB2312 (meta charset): decodes to real Chinese text, no mojibake", async () => {
    const mockedAxios = vi.mocked(axios);
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from(GBK_B64, "base64"),
      status: 200, headers: { "content-type": "text/html" }, config: {} as never, statusText: "OK",
    });
    const resp = await fetchWithRetry("https://example.cn/page", { tool: "extract" });
    expect(resp.data as string).toContain("你好，世界。");
    expect(resp.data as string).toContain("中文测试页面");
  });

  it("windows-1252 (meta charset): decodes accented Latin + the Euro sign correctly, no mojibake", async () => {
    const mockedAxios = vi.mocked(axios);
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from(CP1252_B64, "base64"),
      status: 200, headers: { "content-type": "text/html" }, config: {} as never, statusText: "OK",
    });
    const resp = await fetchWithRetry("https://example.fr/page", { tool: "extract" });
    expect(resp.data as string).toContain("Café précisément");
    expect(resp.data as string).toContain("€99");
  });

  it("Content-Type header charset takes precedence — no <meta> tag present at all", async () => {
    const mockedAxios = vi.mocked(axios);
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from(SJIS_NOMETA_B64, "base64"),
      status: 200, headers: { "content-type": "text/html; charset=Shift_JIS" }, config: {} as never, statusText: "OK",
    });
    const resp = await fetchWithRetry("https://example.jp/no-meta", { tool: "extract" });
    expect(resp.data as string).toContain("こんにちは世界");
  });

  it("mirror: a plain UTF-8 page (no charset signal anywhere) is still decoded correctly — unchanged default", async () => {
    const mockedAxios = vi.mocked(axios);
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from("<html><body><p>Hello world — café, 日本語, 你好</p></body></html>", "utf-8"),
      status: 200, headers: { "content-type": "text/html" }, config: {} as never, statusText: "OK",
    });
    const resp = await fetchWithRetry("https://example.com/utf8-page", { tool: "extract" });
    expect(resp.data as string).toContain("Hello world — café, 日本語, 你好");
  });

  it("an unrecognized/garbled Content-Type charset label never throws — falls back to utf-8", async () => {
    const mockedAxios = vi.mocked(axios);
    mockedAxios.get.mockResolvedValue({
      data: Buffer.from("<html><body><p>plain utf-8 content</p></body></html>", "utf-8"),
      status: 200, headers: { "content-type": "text/html; charset=totally-not-a-real-charset" }, config: {} as never, statusText: "OK",
    });
    const resp = await fetchWithRetry("https://example.com/bad-charset-header", { tool: "extract" });
    expect(resp.data as string).toContain("plain utf-8 content");
  });

  it("PDF detection still wins over charset decoding — a PDF content-type keeps the raw Buffer untouched", async () => {
    const mockedAxios = vi.mocked(axios);
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xe9, 0x00]); // %PDF + a byte invalid as UTF-8
    mockedAxios.get.mockResolvedValue({
      data: pdfBytes, status: 200, headers: { "content-type": "application/pdf; charset=Shift_JIS" }, config: {} as never, statusText: "OK",
    });
    const resp = await fetchWithRetry("https://example.com/report.pdf", { tool: "extract" });
    expect(Buffer.isBuffer(resp.data)).toBe(true);
    expect(Buffer.compare(resp.data as Buffer, pdfBytes)).toBe(0);
  });
});
