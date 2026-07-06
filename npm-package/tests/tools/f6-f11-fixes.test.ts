/**
 * RED tests for F6 (prose-credential redaction) and F11 (urls alias validation).
 *
 * F6  — redactSecrets must mask prose-format credentials like
 *         "Account：secret" (full-width colon) and "Password: secret" (ASCII colon).
 *       The novadaExtract single-URL catch block must NOT embed raw error messages.
 *
 * F11 — validateExtractParams({ urls: [...] }) without `url` must succeed,
 *       promoting urls → url automatically instead of throwing ZodError.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ZodError } from "zod";
import { redactSecrets } from "../../src/_core/errors.js";
import { validateExtractParams } from "../../src/tools/types.js";
import { novadaExtract } from "../../src/tools/extract.js";
import { clearCache } from "../../src/_core/session-cache.js";

vi.mock("axios");
import axios from "axios";
const mockedAxios = vi.mocked(axios);

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
});

// ─── F6: prose-credential redaction ──────────────────────────────────────────

describe("F6: redactSecrets — prose credential patterns", () => {
  it("masks ASCII-colon credential: 'Account: secretval'", () => {
    const out = redactSecrets("Login failed — Account: secretval123");
    expect(out).not.toContain("secretval123");
    expect(out).toContain("Account: ***");
  });

  it("masks full-width-colon credential: 'Account：secretval'", () => {
    // U+FF1A full-width colon — common in non-ASCII API error responses
    const out = redactSecrets("认证失败 Account：secretval123");
    expect(out).not.toContain("secretval123");
    expect(out).toContain("Account: ***");
  });

  it("masks Password credential (ASCII colon)", () => {
    const out = redactSecrets("Error: Password: hunter2 is wrong");
    expect(out).not.toContain("hunter2");
    expect(out).toContain("Password: ***");
  });

  it("masks Passwd credential variant", () => {
    const out = redactSecrets("auth error: Passwd: mypass123");
    expect(out).not.toContain("mypass123");
    expect(out).toContain("Passwd: ***");
  });

  it("masks Pwd credential variant", () => {
    const out = redactSecrets("Connection error: Pwd: weakpassword");
    expect(out).not.toContain("weakpassword");
    expect(out).toContain("Pwd: ***");
  });

  it("masks Username credential variant", () => {
    const out = redactSecrets("Auth failed: Username: johndoe123");
    expect(out).not.toContain("johndoe123");
    expect(out).toContain("Username: ***");
  });

  it("masks User credential variant", () => {
    const out = redactSecrets("Authentication error: User: admin007");
    expect(out).not.toContain("admin007");
    expect(out).toContain("User: ***");
  });

  it("leaves unrelated text untouched", () => {
    const plain = "network timeout: could not reach host";
    expect(redactSecrets(plain)).toBe(plain);
  });

  it("is case-insensitive: lowercase 'account: x' also redacted", () => {
    const out = redactSecrets("proxy error: account: myuser");
    expect(out).not.toContain("myuser");
  });

  it("masks both full-width and ASCII colon credential in same string", () => {
    const out = redactSecrets("Account：userA Password: passB");
    expect(out).not.toContain("userA");
    expect(out).not.toContain("passB");
  });
});

// ─── F6: extract.ts single-URL error path must call redactSecrets ─────────────

describe("F6: novadaExtract single-URL catch block — no raw credential leak", () => {
  it("does NOT embed raw prose credential in ## Extract Failed block", async () => {
    // Simulate an upstream error message that contains a prose credential
    mockedAxios.get.mockRejectedValue(new Error("Account: secret_api_key_here auth failed"));

    const result = await novadaExtract(
      { url: "https://example-unreachable.tld/page", format: "markdown" },
      "test-api-key"
    );

    expect(result).toContain("## Extract Failed");
    // The raw credential value must NOT appear in the output
    expect(result).not.toContain("secret_api_key_here");
    // The field name may appear but only with redacted value
    if (result.includes("Account:")) {
      expect(result).toContain("Account: ***");
    }
  });

  it("does NOT embed raw prose credential in batch mode error item", async () => {
    // First URL succeeds, second throws a cred-bearing error
    const goodHtml = "<html><head><title>OK</title></head><body><main><p>Good content here lots of text.</p></main></body></html>";
    mockedAxios.get.mockImplementation(async (url: string) => {
      if ((url as string).includes("bad")) {
        throw new Error("Password: leaked_pass_value rejected by proxy");
      }
      return { data: goodHtml };
    });

    const result = await novadaExtract(
      {
        url: "https://example.com/good",
        urls: ["https://example-bad.tld/bad"],
        format: "markdown",
      },
      "test-api-key"
    );

    expect(result).not.toContain("leaked_pass_value");
  });
});

// ─── F11: urls alias promotion ────────────────────────────────────────────────

describe("F11: validateExtractParams — urls alias without url must succeed", () => {
  it("urls alone (no url) is accepted and promotes to url", () => {
    // This must NOT throw ZodError after the fix
    expect(() =>
      validateExtractParams({ urls: ["https://example.com/a", "https://example.com/b"] })
    ).not.toThrow();
  });

  it("urls alone produces correct url value (array of the passed urls)", () => {
    const result = validateExtractParams({ urls: ["https://a.example.com", "https://b.example.com"] });
    // url should be set to the array that was in urls
    const url = result.url;
    expect(Array.isArray(url)).toBe(true);
    expect((url as string[]).length).toBe(2);
    expect((url as string[])[0]).toBe("https://a.example.com");
  });

  it("single-element urls array also works", () => {
    const result = validateExtractParams({ urls: ["https://single.example.com"] });
    expect(result.url).toBeDefined();
  });

  it("url field still works normally (backward compat)", () => {
    const result = validateExtractParams({ url: "https://example.com" });
    expect(result.url).toBe("https://example.com");
  });

  it("url + urls together still works (existing batch behavior)", () => {
    const result = validateExtractParams({
      url: "https://example.com",
      urls: ["https://a.example.com", "https://b.example.com"],
    });
    expect(result.url).toBeDefined();
  });

  it("neither url nor urls throws ZodError naming the fields", () => {
    let zodErr: ZodError | undefined;
    try {
      validateExtractParams({});
    } catch (e) {
      if (e instanceof ZodError) zodErr = e;
    }
    expect(zodErr).toBeDefined();
    const msg = zodErr!.message.toLowerCase();
    // Error should reference url or urls as accepted shapes, not just "Invalid input"
    expect(msg).toMatch(/url/);
  });
});

// ─── F11: novadaExtract integration — urls alone routes to batch ──────────────

describe("F11: novadaExtract accepts urls alias without url param", () => {
  const sampleHtml = `
    <html>
      <head><title>Sample</title></head>
      <body><main><p>Sample content for batch test. ${"Lorem ipsum ".repeat(30)}</p></main></body>
    </html>
  `;

  it("urls alone triggers batch mode and returns Batch Extract Results", async () => {
    mockedAxios.get.mockResolvedValue({ data: sampleHtml });

    const result = await novadaExtract(
      { urls: ["https://f11-a.example.com", "https://f11-b.example.com"], format: "markdown" },
      "test-api-key"
    );

    expect(result).toContain("## Batch Extract Results");
    expect(result).toContain("urls:2");
  });
});
