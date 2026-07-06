import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import {
  validateSearchParams,
  validateExtractParams,
  validateCrawlParams,
  validateResearchParams,
  validateMapParams,
  validateUnblockParams,
  validateBrowserParams,
  validateProxyParams,
  validateSiteCopyParams,
  classifyError,
  NovadaErrorCode,
} from "../../src/tools/types.js";

describe("validateSearchParams", () => {
  it("returns params when query is a valid string", () => {
    const result = validateSearchParams({ query: "test search" });
    expect(result.query).toBe("test search");
  });

  it("applies defaults for optional fields", () => {
    const result = validateSearchParams({ query: "test" });
    expect(result.engine).toBe("google");
    expect(result.num).toBe(10);
    expect(result.country).toBe("");
  });

  it("preserves provided optional fields", () => {
    const result = validateSearchParams({ query: "test", engine: "bing", num: 5, country: "us" });
    expect(result.engine).toBe("bing");
    expect(result.num).toBe(5);
    expect(result.country).toBe("us");
  });

  it("throws ZodError on undefined args", () => {
    expect(() => validateSearchParams(undefined)).toThrow(ZodError);
  });

  it("throws ZodError on missing query", () => {
    expect(() => validateSearchParams({})).toThrow(ZodError);
  });

  it("throws ZodError on empty query string", () => {
    expect(() => validateSearchParams({ query: "" })).toThrow(ZodError);
  });

  it("throws ZodError when query is a number", () => {
    expect(() => validateSearchParams({ query: 123 })).toThrow(ZodError);
  });

  it("throws ZodError for invalid engine", () => {
    expect(() => validateSearchParams({ query: "test", engine: "altavista" })).toThrow(ZodError);
  });

  it("throws ZodError for num out of range", () => {
    expect(() => validateSearchParams({ query: "test", num: 100 })).toThrow(ZodError);
  });
});

describe("validateExtractParams", () => {
  it("returns params when url is a valid URL", () => {
    const result = validateExtractParams({ url: "https://example.com" });
    expect(result.url).toBe("https://example.com");
  });

  it("applies default format", () => {
    const result = validateExtractParams({ url: "https://example.com" });
    expect(result.format).toBe("markdown");
  });

  it("preserves provided format", () => {
    const result = validateExtractParams({ url: "https://example.com", format: "html" });
    expect(result.format).toBe("html");
  });

  it("throws ZodError on undefined args", () => {
    expect(() => validateExtractParams(undefined)).toThrow(ZodError);
  });

  it("throws ZodError on missing url", () => {
    expect(() => validateExtractParams({})).toThrow(ZodError);
  });

  it("throws ZodError on empty url string", () => {
    expect(() => validateExtractParams({ url: "" })).toThrow(ZodError);
  });

  it("throws ZodError on invalid url", () => {
    expect(() => validateExtractParams({ url: "not-a-url" })).toThrow(ZodError);
  });
});

describe("validateCrawlParams", () => {
  it("returns params when url is valid", () => {
    const result = validateCrawlParams({ url: "https://example.com" });
    expect(result.url).toBe("https://example.com");
  });

  it("applies defaults", () => {
    const result = validateCrawlParams({ url: "https://example.com" });
    expect(result.max_pages).toBe(5);
    expect(result.strategy).toBe("bfs");
  });

  it("preserves optional fields", () => {
    const result = validateCrawlParams({ url: "https://example.com", max_pages: 10, strategy: "dfs" });
    expect(result.max_pages).toBe(10);
    expect(result.strategy).toBe("dfs");
  });

  it("throws ZodError on undefined args", () => {
    expect(() => validateCrawlParams(undefined)).toThrow(ZodError);
  });

  it("throws ZodError on missing url", () => {
    expect(() => validateCrawlParams({})).toThrow(ZodError);
  });

  it("throws ZodError on empty url", () => {
    expect(() => validateCrawlParams({ url: "" })).toThrow(ZodError);
  });

  it("throws ZodError for max_pages out of range", () => {
    expect(() => validateCrawlParams({ url: "https://example.com", max_pages: 50 })).toThrow(ZodError);
  });
});

describe("validateResearchParams", () => {
  it("returns params when question is valid", () => {
    const result = validateResearchParams({ question: "What is MCP?" });
    expect(result.question).toBe("What is MCP?");
  });

  it("applies default depth", () => {
    const result = validateResearchParams({ question: "What is MCP?" });
    expect(result.depth).toBe("auto");
  });

  it("preserves depth field", () => {
    const result = validateResearchParams({ question: "What is MCP?", depth: "deep" });
    expect(result.depth).toBe("deep");
  });

  it("throws ZodError on undefined args", () => {
    expect(() => validateResearchParams(undefined)).toThrow(ZodError);
  });

  it("throws ZodError on missing question", () => {
    expect(() => validateResearchParams({})).toThrow(ZodError);
  });

  it("throws ZodError on short question", () => {
    expect(() => validateResearchParams({ question: "hi" })).toThrow(ZodError);
  });

  it("throws ZodError when question is not a string", () => {
    expect(() => validateResearchParams({ question: true })).toThrow(ZodError);
  });
});

describe("validateMapParams", () => {
  it("returns params when url is valid", () => {
    const result = validateMapParams({ url: "https://example.com" });
    expect(result.url).toBe("https://example.com");
  });

  it("applies defaults", () => {
    const result = validateMapParams({ url: "https://example.com" });
    expect(result.limit).toBe(50);
    expect(result.include_subdomains).toBe(false);
  });

  it("preserves search and limit", () => {
    const result = validateMapParams({ url: "https://example.com", search: "docs", limit: 20 });
    expect(result.search).toBe("docs");
    expect(result.limit).toBe(20);
  });

  it("throws ZodError on invalid url", () => {
    expect(() => validateMapParams({ url: "not-a-url" })).toThrow(ZodError);
  });

  it("throws ZodError for limit out of range", () => {
    expect(() => validateMapParams({ url: "https://example.com", limit: 200 })).toThrow(ZodError);
  });
});

describe("classifyError", () => {
  it("classifies 401 as INVALID_API_KEY", () => {
    const err = classifyError(new Error("HTTP 401: Unauthorized"));
    expect(err.code).toBe(NovadaErrorCode.INVALID_API_KEY);
    expect(err.retryable).toBe(false);
  });

  it("classifies 429 as RATE_LIMITED", () => {
    const err = classifyError(new Error("HTTP 429: Rate limit exceeded"));
    expect(err.code).toBe(NovadaErrorCode.RATE_LIMITED);
    expect(err.retryable).toBe(true);
  });

  it("classifies timeout as URL_UNREACHABLE", () => {
    const err = classifyError(new Error("timeout of 30000ms exceeded"));
    expect(err.code).toBe(NovadaErrorCode.URL_UNREACHABLE);
    expect(err.retryable).toBe(true);
  });

  it("classifies 503 as API_DOWN", () => {
    const err = classifyError(new Error("HTTP 503: Service Unavailable"));
    expect(err.code).toBe(NovadaErrorCode.API_DOWN);
    expect(err.retryable).toBe(true);
  });

  it("classifies unknown errors as UNKNOWN", () => {
    const err = classifyError(new Error("Something weird happened"));
    expect(err.code).toBe(NovadaErrorCode.UNKNOWN);
    expect(err.retryable).toBe(false);
  });

  it("handles non-Error objects", () => {
    const err = classifyError("just a string");
    expect(err.code).toBe(NovadaErrorCode.UNKNOWN);
    expect(err.message).toBe("just a string");
  });

  it("classifies ZodError as INVALID_PARAMS", () => {
    const zodErr = new ZodError([
      { code: "invalid_type", expected: "string", received: "number", path: ["query"], message: "Expected string, received number" },
    ]);
    const err = classifyError(zodErr);
    expect(err.code).toBe(NovadaErrorCode.INVALID_PARAMS);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("query");
  });
});

// ─── Unblock Params ────────────────────────────────────────────────────────

describe("validateUnblockParams", () => {
  it("accepts valid URL with defaults", () => {
    const result = validateUnblockParams({ url: "https://example.com" });
    expect(result.url).toBe("https://example.com");
    expect(result.method).toBe("render");
    expect(result.timeout).toBe(30000);
  });

  it("accepts browser method", () => {
    const result = validateUnblockParams({ url: "https://example.com", method: "browser" });
    expect(result.method).toBe("browser");
  });

  it("accepts wait_for selector", () => {
    const result = validateUnblockParams({ url: "https://example.com", wait_for: ".price" });
    expect(result.wait_for).toBe(".price");
  });

  it("rejects missing URL", () => {
    expect(() => validateUnblockParams({})).toThrow(ZodError);
  });

  it("rejects private IPs", () => {
    expect(() => validateUnblockParams({ url: "http://127.0.0.1/admin" })).toThrow(ZodError);
  });
});

// ─── Browser Params ────────────────────────────────────────────────────────

describe("validateBrowserParams", () => {
  it("accepts single navigate action", () => {
    const result = validateBrowserParams({
      actions: [{ action: "navigate", url: "https://example.com" }],
    });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].action).toBe("navigate");
    expect(result.timeout).toBe(60000);
  });

  it("accepts multiple chained actions", () => {
    const result = validateBrowserParams({
      actions: [
        { action: "navigate", url: "https://example.com" },
        { action: "click", selector: "#btn" },
        { action: "type", selector: "#input", text: "hello" },
        { action: "screenshot" },
      ],
    });
    expect(result.actions).toHaveLength(4);
  });

  it("rejects empty actions array", () => {
    expect(() => validateBrowserParams({ actions: [] })).toThrow(ZodError);
  });

  it("rejects more than 20 actions", () => {
    const actions = Array.from({ length: 21 }, () => ({ action: "screenshot" as const }));
    expect(() => validateBrowserParams({ actions })).toThrow(ZodError);
  });

  it("accepts scroll action with direction", () => {
    const result = validateBrowserParams({
      actions: [{ action: "scroll", direction: "bottom" }],
    });
    expect(result.actions[0].action).toBe("scroll");
  });

  it("accepts evaluate action", () => {
    const result = validateBrowserParams({
      actions: [{ action: "evaluate", script: "document.title" }],
    });
    expect(result.actions[0].action).toBe("evaluate");
  });

  it("accepts wait action with selector", () => {
    const result = validateBrowserParams({
      actions: [{ action: "wait", selector: ".loaded", timeout: 10000 }],
    });
    expect(result.actions[0].action).toBe("wait");
  });
});

// ─── camelCase → snake_case backwards-compat aliasing (NOV-327) ───────────────

describe("snake_case param aliasing (NOV-327)", () => {
  it("extract: maps maxChars/waitFor/waitMs to snake_case", () => {
    const r = validateExtractParams({
      url: "https://example.com",
      maxChars: 5000,
      waitFor: ".price",
      waitMs: 1500,
    });
    expect(r.max_chars).toBe(5000);
    expect(r.wait_for).toBe(".price");
    expect(r.wait_ms).toBe(1500);
    // camelCase key must not leak through onto the validated object
    expect((r as Record<string, unknown>).maxChars).toBeUndefined();
  });

  it("crawl: maps maxPages/selectPaths/excludePaths to snake_case", () => {
    const r = validateCrawlParams({
      url: "https://example.com",
      maxPages: 12,
      selectPaths: ["/docs/**"],
      excludePaths: ["/blog/**"],
    });
    expect(r.max_pages).toBe(12);
    expect(r.select_paths).toEqual(["/docs/**"]);
    expect(r.exclude_paths).toEqual(["/blog/**"]);
  });

  it("map: maps includeSubdomains/maxDepth to snake_case", () => {
    const r = validateMapParams({
      url: "https://example.com",
      includeSubdomains: true,
      maxDepth: 3,
    });
    expect(r.include_subdomains).toBe(true);
    expect(r.max_depth).toBe(3);
  });

  it("unblock: maps waitFor/maxChars to snake_case", () => {
    const r = validateUnblockParams({
      url: "https://example.com",
      waitFor: ".ready",
      maxChars: 200000,
    });
    expect(r.wait_for).toBe(".ready");
    expect(r.max_chars).toBe(200000);
  });

  it("proxy: maps sessionId to session_id", () => {
    const r = validateProxyParams({ sessionId: "sess-123_abc" });
    expect(r.session_id).toBe("sess-123_abc");
  });

  it("site_copy: maps maxPages/maxDepth/includeSubdomains/selectPaths/excludePaths", () => {
    const r = validateSiteCopyParams({
      url: "https://example.com",
      maxPages: 50,
      maxDepth: 4,
      includeSubdomains: true,
      selectPaths: ["/x/**"],
      excludePaths: ["/y/**"],
    });
    expect(r.max_pages).toBe(50);
    expect(r.max_depth).toBe(4);
    expect(r.include_subdomains).toBe(true);
    expect(r.select_paths).toEqual(["/x/**"]);
    expect(r.exclude_paths).toEqual(["/y/**"]);
  });

  it("search: maps top-level camelCase keys to snake_case", () => {
    const r = validateSearchParams({
      query: "q",
      timeRange: "week",
      startDate: "2024-01-01",
      endDate: "2024-02-01",
      includeDomains: ["a.com"],
      excludeDomains: ["b.com"],
      sourceType: "news",
      excludeSocial: true,
      enrichTop: true,
    });
    expect(r.time_range).toBe("week");
    expect(r.start_date).toBe("2024-01-01");
    expect(r.end_date).toBe("2024-02-01");
    expect(r.include_domains).toEqual(["a.com"]);
    expect(r.exclude_domains).toEqual(["b.com"]);
    expect(r.source_type).toBe("news");
    expect(r.exclude_social).toBe(true);
    expect(r.enrich_top).toBe(true);
  });

  it("search: maps nested extract_options camelCase (extractOptions/maxChars/topN)", () => {
    const r = validateSearchParams({
      query: "q",
      extractOptions: { maxChars: 3000, topN: 2 },
    });
    expect(r.extract_options?.max_chars).toBe(3000);
    expect(r.extract_options?.top_n).toBe(2);
  });

  it("browser: maps top-level sessionId and per-action waitUntil", () => {
    const r = validateBrowserParams({
      actions: [{ action: "navigate", url: "https://example.com", waitUntil: "networkidle" }],
      sessionId: "b-1",
    });
    expect(r.session_id).toBe("b-1");
    expect(r.actions[0]).toMatchObject({ action: "navigate", wait_until: "networkidle" });
  });

  it("canonical snake_case wins when both forms are supplied", () => {
    const r = validateExtractParams({
      url: "https://example.com",
      max_chars: 2000,
      maxChars: 9999,
    });
    expect(r.max_chars).toBe(2000);
  });

  it("snake_case-only input is unaffected (no regression)", () => {
    const r = validateExtractParams({
      url: "https://example.com",
      max_chars: 7000,
      wait_for: ".z",
    });
    expect(r.max_chars).toBe(7000);
    expect(r.wait_for).toBe(".z");
  });

  it("still enforces validation on the aliased (snake_case) value", () => {
    // maxChars below the 1000 minimum must still fail after aliasing
    expect(() =>
      validateExtractParams({ url: "https://example.com", maxChars: 500 }),
    ).toThrow(ZodError);
  });
});
