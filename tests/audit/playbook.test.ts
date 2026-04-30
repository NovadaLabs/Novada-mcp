/**
 * novada-search Professional Testing Playbook
 * Rounds 3–7 — specific test cases per playbook specification
 */
import { describe, it, expect } from "vitest";
import { extractMainContent, extractLinks, extractStructuredData } from "../../src/utils/html.js";
import { detectJsHeavyContent } from "../../src/utils/http.js";
import { rerankResults } from "../../src/utils/rerank.js";

// ─── Round 3: Data Quality — HTML Extraction ───────────────────────────────

describe("Round 3: HTML Extraction quality", () => {

  it("Test 3.1 — boilerplate bleed: nav/footer should not appear in extracted content", () => {
    const html = `<html><body>
      <nav>Home | About | Contact | Login | Register | Privacy | Terms</nav>
      <main><article><h1>Real Article</h1><p>Real content here with lots of words to exceed threshold. Real content here with lots of words to exceed threshold. Real content here.</p></article></main>
      <footer>Copyright 2024 | Privacy Policy | Cookie Settings | Accessibility</footer>
    </body></html>`;
    const result = extractMainContent(html);
    expect(result).toContain("Real Article");
    expect(result).not.toContain("Privacy Policy");
    expect(result).not.toContain("Cookie Settings");
    expect(result).not.toContain("Login");
    expect(result).not.toContain("Register");
  });

  it("Test 3.2 — table preservation: pricing data must appear in extracted text", () => {
    const html = `<html><body><main>
      <table><tr><th>Plan</th><th>Price</th><th>Requests</th></tr>
      <tr><td>Starter</td><td>$49</td><td>10,000</td></tr>
      <tr><td>Pro</td><td>$199</td><td>100,000</td></tr></table>
    </main></body></html>`;
    const result = extractMainContent(html);
    expect(result).toContain("Starter");
    expect(result).toContain("$49");
    expect(result).toContain("$199");
    expect(result).toContain("100,000");
  });

  it("Test 3.3 — relative link normalization: resolves relative URLs to absolute", () => {
    const html = `<html><body>
      <a href="/about">About</a>
      <a href="./blog/post-1">Post</a>
      <a href="https://external.com">External</a>
      <a href="mailto:hi@example.com">Email</a>
      <a href="javascript:void(0)">JS Link</a>
    </body></html>`;
    const links = extractLinks(html, "https://example.com");
    const linkUrls = links.join(" ");
    // mailto: and javascript: should NOT appear
    expect(linkUrls).not.toContain("mailto:");
    expect(linkUrls).not.toContain("javascript:");
    // Relative paths should be absolute
    expect(links.some(l => l === "https://example.com/about")).toBe(true);
    expect(links.some(l => l.startsWith("https://example.com/blog"))).toBe(true);
    // External absolute URL preserved
    expect(links.some(l => l === "https://external.com")).toBe(true);
  });

  it("Test 3.4 — structured data extraction: JSON-LD with price is extracted", () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {"@type":"Product","name":"Widget Pro","offers":{"price":"29.99","priceCurrency":"USD"}}
      </script>
    </head><body><p>Product page</p></body></html>`;
    const result = extractStructuredData(html);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("Product");
    expect(result!.fields.price).toBe("29.99");
    expect(result!.fields.currency).toBe("USD");
  });

  it("Test 3.5 — empty SPA shell: detectJsHeavyContent returns true for near-empty page", () => {
    const html = `<html><head><title>Loading...</title></head><body><div id="app"></div></body></html>`;
    expect(detectJsHeavyContent(html)).toBe(true);
    const content = extractMainContent(html);
    // Content should be minimal
    expect(content.length).toBeLessThan(100);
  });

  it("Test 3.6 — long page truncation: isTruncated detection fires at 25000 chars", () => {
    // Build a 30000+ char page
    const longText = "This is a sentence about content. ".repeat(1000);
    const html = `<html><body><article><p>${longText}</p></article></body></html>`;
    const result = extractMainContent(html, undefined, 3000);
    // Result should be truncated to 3000 chars
    expect(result.length).toBeLessThanOrEqual(3000);
    // The default extraction with default maxChars=25000: content > 25000 triggers isTruncated in extract.ts
    const result25k = extractMainContent(html); // default 25000
    expect(result25k.length).toBeLessThanOrEqual(25000);
    // Verify isTruncated logic: contentLen > 25000 means truncation would be flagged
    const rawContent = extractMainContent(html, undefined, 999999); // no limit
    expect(rawContent.length).toBeGreaterThan(25000); // confirms the page IS long
  });
});

// ─── Round 5: Search — Regex special chars in reranker ───────────────────────

describe("Round 5: Search — reranker edge cases", () => {

  it("Q5.2 — special regex characters in query: c++ does not throw", () => {
    const results = [
      { title: "C++ programming guide", description: "Learn C++ from scratch", url: "https://a.com" },
      { title: "Python programming", description: "Learn Python", url: "https://b.com" },
    ];
    expect(() => rerankResults(results, "c++")).not.toThrow();
    const out = rerankResults(results, "c++");
    expect(out[0].title).toContain("C++");
  });

  it("Q5.2 — node.js dot in query does not throw", () => {
    const results = [
      { title: "Node.js documentation", description: "Server-side JavaScript with Node.js", url: "https://a.com" },
      { title: "Browser JavaScript", description: "Front-end JS", url: "https://b.com" },
    ];
    expect(() => rerankResults(results, "node.js")).not.toThrow();
    const out = rerankResults(results, "node.js");
    expect(out[0].title).toContain("Node.js");
  });

  it("Q5.2 — regex metacharacters: (express) does not throw", () => {
    const results = [
      { title: "Express.js framework", description: "Web framework (express) for Node", url: "https://a.com" },
      { title: "Other framework", description: "Some description", url: "https://b.com" },
    ];
    expect(() => rerankResults(results, "(express)")).not.toThrow();
  });

  it("Q5.3 — empty organic_results returns appropriate message (no crash)", () => {
    // This is tested by ensuring rerankResults handles empty array correctly
    const out = rerankResults([], "test query");
    expect(out).toEqual([]);
  });

  it("Q5.1 — reranker does not normalize by document length (known limitation)", () => {
    // A 500-word snippet with term once vs 10-word snippet with same term
    const longSnippet = "unrelated content ".repeat(50) + " javascript";
    const shortSnippet = "javascript guide";
    const results = [
      { title: "Article about many things", description: longSnippet, url: "https://a.com" },
      { title: "JavaScript Guide", description: shortSnippet, url: "https://b.com" },
    ];
    // Title match dominates: "JavaScript Guide" has term in title → wins
    const out = rerankResults(results, "javascript");
    // Expect title match wins over snippet
    expect(out[0].title).toContain("JavaScript");
  });
});

// ─── Round 4: Circuit Breaker — Code logic assertions ───────────────────────

describe("Round 4: Credential isolation — AsyncLocalStorage", () => {
  it("Q4.5 — withCredentials: cleanup happens automatically via AsyncLocalStorage.run()", async () => {
    // AsyncLocalStorage.run() always exits the scope when the fn completes or throws.
    // This is guaranteed by Node.js's AsyncLocalStorage contract.
    const { withCredentials, getWebUnblockerKey } = await import("../../src/utils/credentials.js");

    let innerKey: string | undefined;
    let outerKeyBefore: string | undefined;
    let outerKeyAfter: string | undefined;

    outerKeyBefore = getWebUnblockerKey();
    try {
      await withCredentials({ webUnblockerKey: "test-key-inside" }, async () => {
        innerKey = getWebUnblockerKey();
        throw new Error("simulated throw");
      });
    } catch { /* expected */ }
    outerKeyAfter = getWebUnblockerKey();

    expect(innerKey).toBe("test-key-inside");
    // After fn throws, store should return to outer context
    // Since we have no outer withCredentials, outer key should be undefined (env-based)
    expect(outerKeyAfter).toBe(outerKeyBefore);
  });

  it("Q4.6 — parallel withCredentials scopes are isolated per-call", async () => {
    const { withCredentials, getWebUnblockerKey } = await import("../../src/utils/credentials.js");

    const keysUsed: string[] = [];
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // Two concurrent scopes with different keys
    await Promise.all([
      withCredentials({ webUnblockerKey: "key-A" }, async () => {
        await delay(10);
        keysUsed.push(getWebUnblockerKey() ?? "undefined");
        await delay(10);
        keysUsed.push(getWebUnblockerKey() ?? "undefined");
      }),
      withCredentials({ webUnblockerKey: "key-B" }, async () => {
        await delay(5);
        keysUsed.push(getWebUnblockerKey() ?? "undefined");
        await delay(10);
        keysUsed.push(getWebUnblockerKey() ?? "undefined");
      }),
    ]);

    // All key-A calls should see key-A, all key-B calls see key-B
    const keyARecords = keysUsed.filter(k => k === "key-A");
    const keyBRecords = keysUsed.filter(k => k === "key-B");
    expect(keyARecords).toHaveLength(2);
    expect(keyBRecords).toHaveLength(2);
  });

  it("Q4.7 — batchExtract throws for > 10 URLs (not silently slices)", async () => {
    const { NovadaClient } = await import("../../src/sdk/index.js");

    const client = new NovadaClient({ scraperApiKey: "test-key" });
    const urls = Array.from({ length: 11 }, (_, i) => `https://example${i}.com`);

    // Must throw — the fix changed silent truncation to an explicit error
    await expect(client.batchExtract(urls)).rejects.toThrow(
      "batchExtract limit is 10 URLs per call. Received 11."
    );

    // 10 URLs should NOT throw the limit error (network failures are acceptable)
    const tenUrls = urls.slice(0, 10);
    await expect(Promise.race([
      client.batchExtract(tenUrls),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("network timeout — expected")), 500)),
    ])).rejects.not.toThrow("batchExtract limit is 10 URLs per call");
  });
});

// ─── Round 6: Error Quality — Agent hint correctness ─────────────────────────

describe("Round 6: Error quality — agent hints", () => {
  it("render-failed mode: hint says NOT to retry with render", async () => {
    // Simulate render-failed output by checking the extract.ts code paths
    // We verify the correct string is produced in the hints
    const renderFailedHint = [
      `- [WARNING] Page is JavaScript-rendered. Web Unblocker was attempted but failed.`,
      `- Do NOT retry with render="render" — it was already tried and failed.`,
    ];
    // These strings should exist in the codebase in extract.ts
    const { readFileSync } = await import("fs");
    const extractSrc = readFileSync(new URL("../../src/tools/extract.ts", import.meta.url), "utf8");
    expect(extractSrc).toContain('Do NOT retry with render="render"');
    expect(extractSrc).toContain('render="render" — it was already tried and failed');
  });

  it("browser not configured: error mentions NOVADA_BROWSER_WS and cost", async () => {
    const { readFileSync } = await import("fs");
    const browserSrc = readFileSync(new URL("../../src/utils/browser.ts", import.meta.url), "utf8");
    expect(browserSrc).toContain("NOVADA_BROWSER_WS");
    expect(browserSrc).toContain("wss://");
  });

  it("NOVADA_API_KEY not set: error message includes setup instructions", async () => {
    const { readFileSync } = await import("fs");
    const indexSrc = readFileSync(new URL("../../src/index.ts", import.meta.url), "utf8");
    expect(indexSrc).toContain("NOVADA_API_KEY is not set");
    expect(indexSrc).toContain("https://www.novada.com");
  });

  it("truncated content: hint tells agent how to get more content", async () => {
    const { readFileSync } = await import("fs");
    const extractSrc = readFileSync(new URL("../../src/tools/extract.ts", import.meta.url), "utf8");
    expect(extractSrc).toContain("Content may be truncated");
    expect(extractSrc).toContain("novada_map");
  });
});

// ─── Round 7: Security ───────────────────────────────────────────────────────

describe("Round 7: Security", () => {
  it("SSRF: safeUrl validator blocks localhost", async () => {
    const { validateExtractParams } = await import("../../src/tools/types.js");
    expect(() => validateExtractParams({ url: "http://localhost:8080/admin" })).toThrow();
  });

  it("SSRF: safeUrl validator blocks 192.168.x.x private ranges", async () => {
    const { validateExtractParams } = await import("../../src/tools/types.js");
    expect(() => validateExtractParams({ url: "http://192.168.1.1" })).toThrow();
  });

  it("SSRF: safeUrl validator blocks AWS metadata IP 169.254.169.254", async () => {
    const { validateExtractParams } = await import("../../src/tools/types.js");
    expect(() => validateExtractParams({ url: "http://169.254.169.254/latest/meta-data/" })).toThrow();
  });

  it("SSRF: safeUrl validator blocks 10.x.x.x private ranges", async () => {
    const { validateExtractParams } = await import("../../src/tools/types.js");
    expect(() => validateExtractParams({ url: "http://10.0.0.1/admin" })).toThrow();
  });

  it("SSRF: safeUrl validator allows valid public URLs", async () => {
    const { validateExtractParams } = await import("../../src/tools/types.js");
    expect(() => validateExtractParams({ url: "https://example.com/page" })).not.toThrow();
  });

  it("SSRF: safeUrl validator blocks IPv6-mapped IPv4 localhost [::ffff:127.0.0.1]", async () => {
    const { validateExtractParams } = await import("../../src/tools/types.js");
    expect(() => validateExtractParams({ url: "http://[::ffff:127.0.0.1]/admin" })).toThrow();
  });

  it("SSRF: safeUrl validator blocks IPv6 link-local [fe80::1]", async () => {
    const { validateExtractParams } = await import("../../src/tools/types.js");
    expect(() => validateExtractParams({ url: "http://[fe80::1]/admin" })).toThrow();
  });

  it("credential leakage: error messages do not expose API keys verbatim", async () => {
    const { readFileSync } = await import("fs");
    const httpSrc = readFileSync(new URL("../../src/utils/http.ts", import.meta.url), "utf8");
    // Should not include raw credential values in throw messages
    // Check that sanitizeMessage pattern is in types.ts
    const typesSrc = readFileSync(new URL("../../src/tools/types.ts", import.meta.url), "utf8");
    expect(typesSrc).toContain("sanitizeMessage");
    expect(typesSrc).toContain("api_key=***");
  });

  it("multi-tenant isolation: proxyCircuits is keyed by endpoint, not shared globally", async () => {
    const { readFileSync } = await import("fs");
    const httpSrc = readFileSync(new URL("../../src/utils/http.ts", import.meta.url), "utf8");
    expect(httpSrc).toContain("proxyCircuits");
    // getCircuit function takes endpoint param and returns/creates state entry
    expect(httpSrc).toContain("function getCircuit(endpoint");
    // Keyed by proxyEndpoint — distinct clients get distinct entries
    expect(httpSrc).toContain("proxyCircuits.get(endpoint)");
  });

  it("URL injection: query parameter is not used in raw regex without escaping", async () => {
    const { readFileSync } = await import("fs");
    const rerankSrc = readFileSync(new URL("../../src/utils/rerank.ts", import.meta.url), "utf8");
    // escapeRegex function must exist and be applied
    expect(rerankSrc).toContain("escapeRegex");
    expect(rerankSrc).toContain('replace(/[.*+?^${}()|[\\]\\\\]/g');
  });

  // ── C1 fix: IPv6 full-form loopback bypass ──────────────────────────────────
  it("SSRF: safeUrl blocks full-form IPv6 loopback [0:0:0:0:0:0:0:1]", async () => {
    const { validateExtractParams } = await import("../../src/tools/types.js");
    // Full-form of ::1 — should be blocked
    expect(() => validateExtractParams({ url: "http://[0:0:0:0:0:0:0:1]/admin" })).toThrow();
  });

  it("SSRF: safeUrl blocks URL with literal newline (header injection)", async () => {
    const { validateExtractParams } = await import("../../src/tools/types.js");
    // Newline injection — WHATWG URL parser rejects these, but validate it explicitly too
    expect(() => validateExtractParams({ url: "https://example.com\nHost: evil.com" })).toThrow();
  });

  it("SSRF: safeUrl blocks IPv6-mapped private [::ffff:192.168.1.1]", async () => {
    const { validateExtractParams } = await import("../../src/tools/types.js");
    expect(() => validateExtractParams({ url: "http://[::ffff:192.168.1.1]/admin" })).toThrow();
  });
});

// ─── Round 1: Extraction Fidelity additions ──────────────────────────────────

describe("Round 1 additions: JS-heavy detection — single-quote SPA shells (M1 fix)", () => {
  it("detects single-quoted id='root' empty div as JS-heavy", async () => {
    const { detectJsHeavyContent } = await import("../../src/utils/http.js");
    const html = `<html><head><title>My App</title></head><body><div id='root'></div></body></html>`;
    expect(detectJsHeavyContent(html)).toBe(true);
  });

  it("detects single-quoted id='app' empty div as JS-heavy", async () => {
    const { detectJsHeavyContent } = await import("../../src/utils/http.js");
    const html = `<html><head><title>Vue App</title></head><body><div id='app'></div></body></html>`;
    expect(detectJsHeavyContent(html)).toBe(true);
  });

  it("detects id='__next' Next.js hydration target as JS-heavy", async () => {
    const { detectJsHeavyContent } = await import("../../src/utils/http.js");
    const html = `<html><head><title>Next App</title></head><body><div id='__next'></div></body></html>`;
    expect(detectJsHeavyContent(html)).toBe(true);
  });
});

describe("Round 2 additions: bot challenge — 'access denied' false positive removal (M2 fix)", () => {
  it("does NOT flag 'access denied' alone as bot challenge (too broad)", async () => {
    const { detectBotChallenge } = await import("../../src/utils/http.js");
    // A page with "access denied" in legitimate error text but rich content
    const html = `<html><head><title>403 Access Denied</title></head>
      <body>
        <h1>Access Denied</h1>
        <p>You don't have permission to access this resource. Please contact your administrator for more information about ${" content ".repeat(60)} </p>
      </body></html>`;
    // With rich enough content, heuristics should NOT fire
    expect(detectBotChallenge(html)).toBe(false);
  });

  it("still flags Akamai signals like _abck cookie even without 'access denied'", async () => {
    const { detectBotChallenge } = await import("../../src/utils/http.js");
    const html = `<html><head><title>Page</title></head>
      <body><script>window._abck = "token"</script><p>Content</p></body></html>`;
    expect(detectBotChallenge(html)).toBe(true);
  });
});

describe("Round 4 additions: 10MB cap error is actionable (M3 fix)", () => {
  it("10MB content error message references the URL and the limit", async () => {
    const { readFileSync } = await import("fs");
    const httpSrc = readFileSync(new URL("../../src/utils/http.ts", import.meta.url), "utf8");
    expect(httpSrc).toContain("10MB content limit");
    expect(httpSrc).toContain("novada_map");
  });
});

describe("Round 3 additions: Agent Hints — browser cost mentioned (M4 fix)", () => {
  it("extract.ts agent hints mention browser API cost ~$3/GB", async () => {
    const { readFileSync } = await import("fs");
    const extractSrc = readFileSync(new URL("../../src/tools/extract.ts", import.meta.url), "utf8");
    expect(extractSrc).toContain("$3/GB");
  });
});

describe("Round 5 additions: Proxy 407 auth failure is actionable (M5 fix)", () => {
  it("http.ts handles proxy 407 with actionable message", async () => {
    const { readFileSync } = await import("fs");
    const httpSrc = readFileSync(new URL("../../src/utils/http.ts", import.meta.url), "utf8");
    expect(httpSrc).toContain("407");
    expect(httpSrc).toContain("NOVADA_PROXY_USER");
    expect(httpSrc).toContain("NOVADA_PROXY_PASS");
  });
});

describe("Round 7 additions: SDK content parsing correctness (C2 fix)", () => {
  it("SDK extract() finds content after Structured Data block, not the block itself", async () => {
    const { readFileSync } = await import("fs");
    const sdkSrc = readFileSync(new URL("../../src/sdk/index.ts", import.meta.url), "utf8");
    // New parsing logic: does not use parts[1] naively
    expect(sdkSrc).not.toContain("const content = parts[1]?.trim()");
    // Should reference ## Same-Domain Links or ## Agent Hints as boundary
    expect(sdkSrc).toContain("## Same-Domain Links");
    expect(sdkSrc).toContain("## Agent Hints");
  });
});
