/**
 * F12 + E2 in-process pins (mocked upstreams, no real keys, no disk writes):
 *
 *   1. novada_extract's basic direct fetch behaves IDENTICALLY for a keyless
 *      caller and an invalid-key caller — same content, produced by the same
 *      code path that never exercises the key.
 *   2. E2: in the unauthenticated tier (keyless), NOTHING is written under
 *      ~/Downloads — the response carries no `path:` line and saveOutput's
 *      write branch is never reached.
 *   3. key_required tools refuse with the SAME error contract in both states:
 *      keyless → local Error [INVALID_API_KEY] / failure_class: auth (gate),
 *      invalid-key → upstream refusal classified to the SAME code + class.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import axios from "axios";
import { dispatch } from "../../src/core.js";
import { runUnauthenticatedTier } from "../../src/_core/gate.js";
import { NovadaError, NovadaErrorCode } from "../../src/_core/errors.js";
import { clearCache } from "../../src/_core/session-cache.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// Never let this suite touch the real filesystem's write path — reads stay real.
// vi.hoisted: the vi.mock factory below is hoisted above module consts, so the
// spies must be created in a hoisted block to avoid a TDZ crash.
const { writeFileSpy, mkdirSpy } = vi.hoisted(() => ({
  writeFileSpy: vi.fn(async () => undefined),
  mkdirSpy: vi.fn(async () => undefined),
}));
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    writeFile: (...args: unknown[]) => writeFileSpy(...args),
    mkdir: (...args: unknown[]) => mkdirSpy(...args),
  };
});

const INVALID_KEY = "sk-test-invalid-0000000000000000";

const sampleHtml = `
  <html>
    <head><title>Test Page</title><meta name="description" content="A test page"></head>
    <body><main>
      <h1>Main Content</h1>
      <p>This is the main content of the page with enough text to pass the threshold for
      content extraction. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
      eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.</p>
    </main></body>
  </html>
`;

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
});

describe("F12: extract basic fetch — keyless == invalid-key (unauthenticated tier)", () => {
  it("keyless (tier context) and invalid-key produce the same basic content", async () => {
    mockedAxios.get.mockResolvedValue({ data: sampleHtml });

    const keyless = await runUnauthenticatedTier(() =>
      dispatch("novada_extract", { url: "https://example.com/a" }, undefined)
    );
    const invalidKey = await dispatch("novada_extract", { url: "https://example.com/b" }, INVALID_KEY);

    for (const text of [keyless, invalidKey]) {
      expect(text).toContain("Test Page");
      expect(text).toContain("Main Content");
    }

    // Identical modulo the URL, the fetch timestamp, and the save-path header
    // (the invalid-key call still auto-saves today — a locally-undetectable
    // state; see W2 report).
    const normalize = (s: string, url: string) =>
      s
        .replace(/^path: .*$/m, "")
        .replace(/^fetched_at: .*$/m, "fetched_at: <TS>")
        .split(url).join("<URL>")
        .trim();
    expect(normalize(keyless, "https://example.com/a")).toBe(
      normalize(invalidKey, "https://example.com/b")
    );
  });

  it("E2: keyless tier call writes NOTHING under ~/Downloads and shows no path header", async () => {
    mockedAxios.get.mockResolvedValue({ data: sampleHtml });

    const keyless = await runUnauthenticatedTier(() =>
      dispatch("novada_extract", { url: "https://example.com/e2" }, undefined)
    );

    expect(keyless).not.toMatch(/^path: /m);
    const downloadWrites = writeFileSpy.mock.calls.filter((c) => String(c[0]).includes("novada-mcp"));
    expect(downloadWrites).toHaveLength(0);
    const downloadDirs = mkdirSpy.mock.calls.filter((c) => String(c[0]).includes("novada-mcp"));
    expect(downloadDirs).toHaveLength(0);
  });

  it("control: outside the tier context the save path IS reached (write mocked)", async () => {
    mockedAxios.get.mockResolvedValue({ data: sampleHtml });

    const keyed = await dispatch("novada_extract", { url: "https://example.com/ctrl" }, INVALID_KEY);
    expect(keyed).toMatch(/^path: /m);
    const downloadWrites = writeFileSpy.mock.calls.filter((c) => String(c[0]).includes("novada-mcp"));
    expect(downloadWrites.length).toBeGreaterThan(0);
  });
});

describe("F12: key_required tools refuse with the same contract in both key states", () => {
  it("invalid-key novada_search → upstream 10001 classifies to INVALID_API_KEY / auth (same contract as the keyless local gate)", async () => {
    mockedAxios.post.mockResolvedValue({ data: { code: 10001, msg: "invalid key" } });

    let thrown: unknown;
    try {
      await dispatch("novada_search", { query: "hello" }, INVALID_KEY);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NovadaError);
    const err = thrown as NovadaError;
    expect(err.code).toBe(NovadaErrorCode.INVALID_API_KEY);

    const text = err.toAgentString();
    // The three contract fields the keyless local refusal also carries
    // (pinned end-to-end in tests/audit/f12-f13-gate-order.test.ts):
    expect(text).toContain("Error [INVALID_API_KEY]");
    expect(text).toContain("failure_class: auth");
    expect(text).toContain("retry_recommended: false");
  });
});
