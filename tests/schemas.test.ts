/**
 * Zod schema validation tests — all validate*() functions.
 * No network calls. All pure schema parsing.
 */

import { describe, it, expect } from "vitest";
import {
  validateSearchParams,
  validateExtractParams,
  validateCrawlParams,
  validateResearchParams,
  validateMapParams,
  validateVerifyParams,
  validateProxyParams,
  validateScrapeParams,
  validateUnblockParams,
  validateBrowserParams,
} from "../src/tools/types.js";
import { validateScraperStatusParams } from "../src/tools/scraper_status.js";
import { validateScraperResultParams } from "../src/tools/scraper_result.js";
import { validateScraperSubmitParams } from "../src/tools/scraper_submit.js";

// ─── validateSearchParams ─────────────────────────────────────────────────────

describe("validateSearchParams", () => {
  it("parses valid query", () => {
    const p = validateSearchParams({ query: "hello world" });
    expect(p.query).toBe("hello world");
    expect(p.engine).toBe("google");
    expect(p.num).toBe(10);
  });

  it("throws on missing query", () => {
    expect(() => validateSearchParams({})).toThrow();
  });

  it("throws on empty query", () => {
    expect(() => validateSearchParams({ query: "" })).toThrow();
  });

  it("throws on invalid engine", () => {
    expect(() => validateSearchParams({ query: "test", engine: "ask" })).toThrow();
  });

  it("accepts all valid engines", () => {
    for (const engine of ["google", "bing", "duckduckgo", "yahoo", "yandex"]) {
      expect(() => validateSearchParams({ query: "test", engine })).not.toThrow();
    }
  });

  it("throws on num out of range", () => {
    expect(() => validateSearchParams({ query: "test", num: 0 })).toThrow();
    expect(() => validateSearchParams({ query: "test", num: 21 })).toThrow();
  });
});

// ─── validateExtractParams ────────────────────────────────────────────────────

describe("validateExtractParams", () => {
  it("parses single URL", () => {
    const p = validateExtractParams({ url: "https://example.com" });
    expect(p.url).toBe("https://example.com");
  });

  it("parses array of URLs", () => {
    const p = validateExtractParams({ url: ["https://a.com", "https://b.com"] });
    expect(Array.isArray(p.url)).toBe(true);
  });

  it("throws on empty array", () => {
    expect(() => validateExtractParams({ url: [] })).toThrow();
  });

  it("throws on array > 10 URLs", () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://example${i}.com`);
    expect(() => validateExtractParams({ url: urls })).toThrow();
  });

  it("throws on missing url", () => {
    expect(() => validateExtractParams({})).toThrow();
  });

  it("throws on invalid render value", () => {
    expect(() => validateExtractParams({ url: "https://example.com", render: "full" })).toThrow();
  });

  it("accepts all valid render modes", () => {
    for (const render of ["auto", "static", "render", "browser"]) {
      expect(() => validateExtractParams({ url: "https://example.com", render })).not.toThrow();
    }
  });

  it("throws on max_chars below minimum", () => {
    expect(() => validateExtractParams({ url: "https://example.com", max_chars: 500 })).toThrow();
  });
});

// ─── validateCrawlParams ──────────────────────────────────────────────────────

describe("validateCrawlParams", () => {
  it("parses valid url", () => {
    const p = validateCrawlParams({ url: "https://example.com" });
    expect(p.max_pages).toBe(5);
    expect(p.strategy).toBe("bfs");
  });

  it("throws on max_pages > 20", () => {
    expect(() => validateCrawlParams({ url: "https://example.com", max_pages: 21 })).toThrow();
  });

  it("throws on invalid strategy", () => {
    expect(() => validateCrawlParams({ url: "https://example.com", strategy: "random" })).toThrow();
  });
});

// ─── validateResearchParams ───────────────────────────────────────────────────

describe("validateResearchParams", () => {
  it("accepts question field", () => {
    const p = validateResearchParams({ question: "What is MCP?" });
    expect(p.question).toBe("What is MCP?");
  });

  it("accepts query alias", () => {
    const p = validateResearchParams({ query: "What is MCP?" });
    expect(p.query).toBe("What is MCP?");
  });

  it("throws when neither question nor query provided", () => {
    expect(() => validateResearchParams({})).toThrow();
  });

  it("throws on question shorter than 5 chars", () => {
    expect(() => validateResearchParams({ question: "Hi" })).toThrow();
  });

  it("accepts all depth values", () => {
    for (const depth of ["quick", "deep", "auto", "comprehensive"]) {
      expect(() => validateResearchParams({ question: "What is AI?", depth })).not.toThrow();
    }
  });
});

// ─── validateMapParams ────────────────────────────────────────────────────────

describe("validateMapParams", () => {
  it("parses valid url with defaults", () => {
    const p = validateMapParams({ url: "https://example.com" });
    expect(p.limit).toBe(50);
    expect(p.include_subdomains).toBe(false);
  });

  it("throws on limit > 100", () => {
    expect(() => validateMapParams({ url: "https://example.com", limit: 101 })).toThrow();
  });
});

// ─── validateVerifyParams ─────────────────────────────────────────────────────

describe("validateVerifyParams", () => {
  it("accepts valid claim", () => {
    const p = validateVerifyParams({ claim: "The sky is blue on a clear day" });
    expect(p.claim).toBeTruthy();
  });

  it("throws on claim shorter than 10 chars", () => {
    expect(() => validateVerifyParams({ claim: "Short" })).toThrow();
  });

  it("throws on missing claim", () => {
    expect(() => validateVerifyParams({})).toThrow();
  });
});

// ─── validateProxyParams ──────────────────────────────────────────────────────

describe("validateProxyParams", () => {
  it("defaults to residential type and url format", () => {
    const p = validateProxyParams({});
    expect(p.type).toBe("residential");
    expect(p.format).toBe("url");
  });

  it("accepts all proxy types", () => {
    for (const type of ["residential", "mobile", "isp", "datacenter"]) {
      expect(() => validateProxyParams({ type })).not.toThrow();
    }
  });

  it("throws on invalid country code (not 2 chars)", () => {
    expect(() => validateProxyParams({ country: "usa" })).toThrow();
  });

  it("throws on invalid session_id with special chars", () => {
    expect(() => validateProxyParams({ session_id: "my session!" })).toThrow();
  });

  it("accepts valid session_id", () => {
    expect(() => validateProxyParams({ session_id: "sess-123_abc" })).not.toThrow();
  });
});

// ─── validateScrapeParams ─────────────────────────────────────────────────────

describe("validateScrapeParams", () => {
  it("parses valid platform + operation", () => {
    const p = validateScrapeParams({ platform: "amazon.com", operation: "amazon_product_by-keywords", params: { keyword: "iphone" } });
    expect(p.platform).toBe("amazon.com");
    expect(p.format).toBe("markdown");
  });

  it("throws on empty platform", () => {
    expect(() => validateScrapeParams({ platform: "", operation: "op" })).toThrow();
  });

  it("throws on limit > 100", () => {
    expect(() => validateScrapeParams({ platform: "amazon.com", operation: "op", limit: 101 })).toThrow();
  });

  it("accepts valid formats", () => {
    for (const format of ["markdown", "json", "toon"]) {
      expect(() => validateScrapeParams({ platform: "x.com", operation: "op", format })).not.toThrow();
    }
  });
});

// ─── validateUnblockParams ────────────────────────────────────────────────────

describe("validateUnblockParams", () => {
  it("parses valid url with defaults", () => {
    const p = validateUnblockParams({ url: "https://example.com" });
    expect(p.method).toBe("render");
    expect(p.timeout).toBe(30000);
  });

  it("throws on timeout below minimum", () => {
    expect(() => validateUnblockParams({ url: "https://example.com", timeout: 100 })).toThrow();
  });

  it("throws on timeout above maximum", () => {
    expect(() => validateUnblockParams({ url: "https://example.com", timeout: 200000 })).toThrow();
  });

  it("accepts both methods", () => {
    expect(() => validateUnblockParams({ url: "https://example.com", method: "render" })).not.toThrow();
    expect(() => validateUnblockParams({ url: "https://example.com", method: "browser" })).not.toThrow();
  });
});

// ─── validateBrowserParams ────────────────────────────────────────────────────

describe("validateBrowserParams — evaluate script security", () => {
  const navigate = { action: "navigate" as const, url: "https://example.com" };

  it("parses valid navigate action", () => {
    const p = validateBrowserParams({ actions: [navigate] });
    expect(p.actions).toHaveLength(1);
  });

  it("throws on empty actions array", () => {
    expect(() => validateBrowserParams({ actions: [] })).toThrow();
  });

  it("throws on actions > 20", () => {
    const actions = Array.from({ length: 21 }, () => navigate);
    expect(() => validateBrowserParams({ actions })).toThrow();
  });

  it("throws on evaluate with fetch", () => {
    expect(() => validateBrowserParams({
      actions: [{ action: "evaluate", script: "fetch('https://evil.com')" }]
    })).toThrow();
  });

  it("throws on evaluate with XMLHttpRequest", () => {
    expect(() => validateBrowserParams({
      actions: [{ action: "evaluate", script: "new XMLHttpRequest()" }]
    })).toThrow();
  });

  it("throws on evaluate with WebSocket", () => {
    expect(() => validateBrowserParams({
      actions: [{ action: "evaluate", script: "new WebSocket('ws://evil.com')" }]
    })).toThrow();
  });

  it("throws on evaluate with eval()", () => {
    expect(() => validateBrowserParams({
      actions: [{ action: "evaluate", script: "eval('malicious')" }]
    })).toThrow();
  });

  it("throws on evaluate with new Function()", () => {
    expect(() => validateBrowserParams({
      actions: [{ action: "evaluate", script: "new Function('return fetch')" }]
    })).toThrow();
  });

  it("throws on evaluate with non-ASCII characters", () => {
    expect(() => validateBrowserParams({
      actions: [{ action: "evaluate", script: "document.title = 'héllo'" }]
    })).toThrow();
  });

  it("throws on evaluate using window bracket access", () => {
    expect(() => validateBrowserParams({
      actions: [{ action: "evaluate", script: "window['fetch']('evil')" }]
    })).toThrow();
  });

  it("throws on evaluate using globalThis bracket access", () => {
    expect(() => validateBrowserParams({
      actions: [{ action: "evaluate", script: "globalThis['eval']()" }]
    })).toThrow();
  });

  it("allows safe evaluate script", () => {
    expect(() => validateBrowserParams({
      actions: [{ action: "evaluate", script: "document.title" }]
    })).not.toThrow();
  });

  it("throws on invalid session_id with spaces", () => {
    expect(() => validateBrowserParams({
      actions: [navigate],
      session_id: "my session"
    })).toThrow();
  });
});

// ─── validateScraperStatusParams ─────────────────────────────────────────────

describe("validateScraperStatusParams", () => {
  it("accepts valid task_id", () => {
    const p = validateScraperStatusParams({ task_id: "abc-123_def.456" });
    expect(p.task_id).toBe("abc-123_def.456");
  });

  it("throws on empty task_id", () => {
    expect(() => validateScraperStatusParams({ task_id: "" })).toThrow();
  });

  it("throws on task_id with special characters", () => {
    expect(() => validateScraperStatusParams({ task_id: "id with spaces!" })).toThrow();
    expect(() => validateScraperStatusParams({ task_id: "../etc/passwd" })).toThrow();
    expect(() => validateScraperStatusParams({ task_id: "id<script>" })).toThrow();
  });

  it("throws on task_id longer than 128 chars", () => {
    expect(() => validateScraperStatusParams({ task_id: "a".repeat(129) })).toThrow();
  });

  it("accepts task_id at max length (128 chars)", () => {
    expect(() => validateScraperStatusParams({ task_id: "a".repeat(128) })).not.toThrow();
  });
});

// ─── validateScraperResultParams ─────────────────────────────────────────────

describe("validateScraperResultParams", () => {
  it("defaults to markdown format", () => {
    const p = validateScraperResultParams({ task_id: "abc123" });
    expect(p.format).toBe("markdown");
  });

  it("accepts all valid formats", () => {
    for (const format of ["markdown", "json", "raw"]) {
      expect(() => validateScraperResultParams({ task_id: "abc123", format })).not.toThrow();
    }
  });

  it("throws on invalid format", () => {
    expect(() => validateScraperResultParams({ task_id: "abc123", format: "csv" })).toThrow();
  });
});

// ─── validateScraperSubmitParams ─────────────────────────────────────────────

describe("validateScraperSubmitParams", () => {
  it("accepts valid params", () => {
    const p = validateScraperSubmitParams({
      url: "https://example.com",
      scraper_type: "universal",
    });
    expect(p.url).toBeTruthy();
    expect(p.scraper_type).toBe("universal");
  });

  it("throws on private IP in url", () => {
    expect(() => validateScraperSubmitParams({
      url: "http://127.0.0.1/",
      platform: "amazon.com",
    })).toThrow();
  });

  it("throws on missing url", () => {
    expect(() => validateScraperSubmitParams({ platform: "amazon.com" })).toThrow();
  });
});
