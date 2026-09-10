/**
 * E2 pin: saveOutput() must never write under ~/Downloads for a call running
 * in the unauthenticated tier (keyless caller admitted by the F12 gate).
 *
 * The guard is the CLASS-wide chokepoint (utils/output.ts) — every tool that
 * auto-saves (extract/search/research/scrape/site_copy) goes through it, so an
 * unauth-tier call from ANY tool is covered without per-tool branches, exactly
 * like the existing hosted (VERCEL) no-write guard beside it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { saveOutput } from "../../src/utils/output.js";
import { runUnauthenticatedTier } from "../../src/_core/gate.js";

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveOutput — unauthenticated-tier guard (E2)", () => {
  it("inside the tier: no write, no mkdir, empty filePath, honest summary", async () => {
    const result = await runUnauthenticatedTier(() =>
      saveOutput({ tool: "extract", hint: "example.com", format: "md", data: "# hello world" })
    );
    expect(result.filePath).toBe("");
    expect(result.summary).toMatch(/unauthenticated/i);
    expect(result.summary).toMatch(/not saved/i);
    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(mkdirSpy).not.toHaveBeenCalled();
  });

  it("outside the tier: the normal write path runs (control)", async () => {
    const result = await saveOutput({ tool: "extract", hint: "example.com", format: "md", data: "# hello world" });
    expect(result.filePath).toContain("novada-mcp");
    expect(writeFileSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves recordCount and cosUrl metadata in the no-write result", async () => {
    const result = await runUnauthenticatedTier(() =>
      saveOutput({ tool: "scrape", hint: "amazon.com", format: "json", data: [{ a: 1 }, { a: 2 }], cosUrl: "https://cos.example/x" })
    );
    expect(result.filePath).toBe("");
    expect(result.recordCount).toBe(2);
    expect(result.cosUrl).toBe("https://cos.example/x");
  });
});
