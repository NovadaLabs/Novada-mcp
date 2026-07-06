/**
 * NOV-334: opt-in structured request logging.
 *
 * Verifies the env gate (NOVADA_LOG), JSON-to-stderr shape, and — most importantly —
 * that URL userinfo / NOVADA_BROWSER_WS / internal hosts are redacted before emit.
 *
 * Note: tests/setup.ts strips every NOVADA_* env var before each test, so each case
 * sets NOVADA_LOG (and NOVADA_BROWSER_WS where relevant) explicitly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isRequestLogEnabled, logRequest } from "../../src/_core/request-log.js";

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

/** Parse the single JSON line written to stderr by the last logRequest call. */
function lastLogLine(): Record<string, unknown> {
  expect(stderrSpy).toHaveBeenCalledTimes(1);
  const arg = stderrSpy.mock.calls[0][0] as string;
  return JSON.parse(arg.trim());
}

describe("isRequestLogEnabled", () => {
  it("is false when NOVADA_LOG is unset", () => {
    expect(isRequestLogEnabled()).toBe(false);
  });

  it("is true for NOVADA_LOG=debug", () => {
    process.env.NOVADA_LOG = "debug";
    expect(isRequestLogEnabled()).toBe(true);
  });

  it("is true for NOVADA_LOG=trace", () => {
    process.env.NOVADA_LOG = "trace";
    expect(isRequestLogEnabled()).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    process.env.NOVADA_LOG = "  DEBUG  ";
    expect(isRequestLogEnabled()).toBe(true);
  });

  it("is false for non-debug levels (info/warn/error)", () => {
    for (const lvl of ["info", "warn", "error", "0", "yes"]) {
      process.env.NOVADA_LOG = lvl;
      expect(isRequestLogEnabled()).toBe(false);
    }
  });
});

describe("logRequest gating", () => {
  it("writes nothing when disabled", () => {
    logRequest({ tool: "extract", url: "https://example.com" });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("writes one JSON line to stderr when enabled", () => {
    process.env.NOVADA_LOG = "debug";
    logRequest({ tool: "extract", url: "https://example.com", status: 200, ms: 42, mode: "static" });
    const entry = lastLogLine();
    expect(entry.msg).toBe("upstream_request");
    expect(entry.tool).toBe("extract");
    expect(entry.url).toBe("https://example.com");
    expect(entry.status).toBe(200);
    expect(entry.ms).toBe(42);
    expect(entry.mode).toBe("static");
    expect(entry.level).toBe("debug");
    expect(typeof entry.ts).toBe("string");
  });

  it("omits optional fields that are not provided", () => {
    process.env.NOVADA_LOG = "debug";
    logRequest({ tool: "search", url: "https://example.com" });
    const entry = lastLogLine();
    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("ms");
    expect(entry).not.toHaveProperty("mode");
    expect(entry).not.toHaveProperty("error");
  });

  it("appends a trailing newline (one line per request)", () => {
    process.env.NOVADA_LOG = "debug";
    logRequest({ tool: "extract", url: "https://example.com" });
    const arg = stderrSpy.mock.calls[0][0] as string;
    expect(arg.endsWith("\n")).toBe(true);
  });
});

describe("redaction (no secrets in logs)", () => {
  beforeEach(() => {
    process.env.NOVADA_LOG = "debug";
  });

  it("strips URL userinfo (user:pass@host) from the logged url", () => {
    logRequest({ tool: "extract", url: "https://alice:s3cret@target.example.com/path" });
    const entry = lastLogLine();
    expect(entry.url).toBe("https://target.example.com/path");
    expect(JSON.stringify(entry)).not.toContain("s3cret");
    expect(JSON.stringify(entry)).not.toContain("alice");
  });

  it("redacts the NOVADA_BROWSER_WS value if it appears in the url", () => {
    process.env.NOVADA_BROWSER_WS = "wss://user:pass@upg-scbr2.novada.com:9999";
    logRequest({ tool: "browser", url: "wss://user:pass@upg-scbr2.novada.com:9999/session" });
    const entry = lastLogLine();
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("user:pass");
    expect(serialized).not.toContain("upg-scbr2.novada.com");
  });

  it("redacts internal *.novada.com hosts not on the public allowlist", () => {
    logRequest({ tool: "extract", url: "https://scraperapi.novada.com/v1/request" });
    const entry = lastLogLine();
    expect(entry.url).toContain("[novada-internal-host]");
    expect(JSON.stringify(entry)).not.toContain("scraperapi.novada.com");
  });

  it("redacts secrets in the error field too", () => {
    logRequest({
      tool: "extract",
      url: "https://example.com",
      error: "connect failed to https://bob:hunter2@internal.novada.com",
    });
    const entry = lastLogLine();
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("internal.novada.com");
  });
});

describe("logRequest never throws", () => {
  it("swallows stderr write failures", () => {
    process.env.NOVADA_LOG = "debug";
    stderrSpy.mockImplementation(() => {
      throw new Error("EPIPE");
    });
    expect(() => logRequest({ tool: "extract", url: "https://example.com" })).not.toThrow();
  });
});
