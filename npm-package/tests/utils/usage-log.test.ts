import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logUsage, summarizeTarget, pruneOld } from "../../src/utils/usage-log.js";

const originalEnv = { ...process.env };
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "novada-usage-"));
  process.env = { ...originalEnv, NOVADA_MCP_LOG_DIR: dir };
  delete process.env.NOVADA_MCP_LOG;
});
afterEach(() => {
  process.env = { ...originalEnv };
  rmSync(dir, { recursive: true, force: true });
});

function todayFile(): string {
  return join(dir, `usage-${new Date().toISOString().slice(0, 10)}.jsonl`);
}

describe("logUsage — local usage trail", () => {
  it("writes one JSON line per call with tool/status/ms/target/ts", async () => {
    await logUsage({ tool: "novada_scrape", status: "success", ms: 1234, target: "amazon.com" });
    const obj = JSON.parse(readFileSync(todayFile(), "utf8").trim());
    expect(obj.tool).toBe("novada_scrape");
    expect(obj.status).toBe("success");
    expect(obj.ms).toBe(1234);
    expect(obj.target).toBe("amazon.com");
    expect(typeof obj.ts).toBe("string");
  });

  it("writes ONLY the event fields — no apikey, no arg blobs (secret-free by construction)", async () => {
    await logUsage({ tool: "x", status: "success", ms: 1 });
    const obj = JSON.parse(readFileSync(todayFile(), "utf8").trim());
    expect(Object.keys(obj).sort()).toEqual(["ms", "status", "tool", "ts"]);
  });

  it("appends: two calls → two lines, error line carries a truncated error", async () => {
    await logUsage({ tool: "a", status: "success", ms: 1 });
    await logUsage({ tool: "b", status: "error", ms: 2, error: "boom" });
    const lines = readFileSync(todayFile(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).error).toBe("boom");
  });

  it("redacts secrets in the error before writing (no proxy creds / userinfo reach disk)", async () => {
    await logUsage({ tool: "x", status: "error", ms: 1, error: "ECONNREFUSED https://user:pass@proxy.host:8080 while fetching" });
    const obj = JSON.parse(readFileSync(todayFile(), "utf8").trim());
    expect(obj.error).not.toContain("user:pass@");
    expect(obj.error).toContain("proxy.host");   // the non-secret part survives — still useful
  });

  it("opt-out NOVADA_MCP_LOG=off writes nothing", async () => {
    process.env.NOVADA_MCP_LOG = "off";
    await logUsage({ tool: "a", status: "success", ms: 1 });
    expect(existsSync(todayFile())).toBe(false);
  });

  it("fail-silent: an unwritable log dir resolves without throwing (never breaks a tool call)", async () => {
    const asFile = join(dir, "not-a-dir");
    writeFileSync(asFile, "x");                       // a FILE where a dir is expected
    process.env.NOVADA_MCP_LOG_DIR = join(asFile, "sub"); // mkdir under a file → ENOTDIR
    await expect(logUsage({ tool: "a", status: "success", ms: 1 })).resolves.toBeUndefined();
  });
});

describe("pruneOld — 7-day retention", () => {
  it("removes stale day-files, keeps recent ones and ignores non-matching names", async () => {
    const stale = join(dir, "usage-2000-01-01.jsonl");
    const recent = todayFile();
    const unrelated = join(dir, "notes.txt");
    writeFileSync(stale, "{}\n");
    writeFileSync(recent, "{}\n");
    writeFileSync(unrelated, "keep me");
    await pruneOld(dir);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
  });
});

describe("summarizeTarget — descriptor extraction, secret-free", () => {
  it("pulls the first allowlisted descriptor key in priority order", () => {
    expect(summarizeTarget({ url: "https://x.com/a" })).toBe("https://x.com/a");
    expect(summarizeTarget({ keyword: "shoes" })).toBe("shoes");
    expect(summarizeTarget({ asin: "B0ABC" })).toBe("B0ABC");
  });
  it("arrays → first value + (+N more)", () => {
    expect(summarizeTarget({ urls: ["a", "b", "c"] })).toBe("a (+2 more)");
    expect(summarizeTarget({ urls: ["only"] })).toBe("only");
  });
  it("truncates to 120 chars with an ellipsis", () => {
    const out = summarizeTarget({ query: "x".repeat(200) })!;
    expect(out.length).toBe(120);
    expect(out.endsWith("…")).toBe(true);
  });
  it("ignores non-allowlisted keys → never leaks an apikey or arbitrary blob", () => {
    expect(summarizeTarget({ apikey: "sk-secret", foo: "bar" })).toBeUndefined();
  });
  it("redacts embedded basic-auth in a target URL", () => {
    const out = summarizeTarget({ url: "https://user:pass@example.com/page" })!;
    expect(out).not.toContain("user:pass@");
    expect(out).toContain("example.com");
  });
  it("returns undefined for non-objects and empty args", () => {
    expect(summarizeTarget(undefined)).toBeUndefined();
    expect(summarizeTarget(null)).toBeUndefined();
    expect(summarizeTarget({})).toBeUndefined();
  });
});
