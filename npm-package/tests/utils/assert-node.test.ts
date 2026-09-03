import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MIN_NODE_MAJOR, parseNodeMajor, assertNodeVersion } from "../../src/utils/assert-node.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VITE_NODE_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "vite-node");

describe("parseNodeMajor", () => {
  it("parses a plain version string", () => {
    expect(parseNodeMajor("20.11.24")).toBe(20);
  });

  it("parses a v-prefixed version string", () => {
    expect(parseNodeMajor("v18.20.4")).toBe(18);
  });

  it("parses single-digit-looking majors correctly", () => {
    expect(parseNodeMajor("8.17.0")).toBe(8);
  });

  it("returns 0 for an unparsable string", () => {
    expect(parseNodeMajor("not-a-version")).toBe(0);
    expect(parseNodeMajor("")).toBe(0);
  });
});

describe("assertNodeVersion (injected version + exit — no process kill risk)", () => {
  it("does NOT exit on the minimum supported major", () => {
    const exit = vi_fn();
    assertNodeVersion(`${MIN_NODE_MAJOR}.0.0`, exit.fn);
    expect(exit.calls).toEqual([]);
  });

  it("does NOT exit on a newer major", () => {
    const exit = vi_fn();
    assertNodeVersion("24.18.0", exit.fn);
    expect(exit.calls).toEqual([]);
  });

  it("exits(1) on Node 18", () => {
    const exit = vi_fn();
    assertNodeVersion("18.20.4", exit.fn);
    expect(exit.calls).toEqual([1]);
  });

  it("exits(1) on Node 19", () => {
    const exit = vi_fn();
    assertNodeVersion("19.9.0", exit.fn);
    expect(exit.calls).toEqual([1]);
  });

  it("exits(1) on a v-prefixed old version string", () => {
    const exit = vi_fn();
    assertNodeVersion("v16.20.2", exit.fn);
    expect(exit.calls).toEqual([1]);
  });

  it("does NOT exit (and does not false-positive-block) on an unparsable version string", () => {
    const exit = vi_fn();
    assertNodeVersion("garbage", exit.fn);
    expect(exit.calls).toEqual([]);
  });

  it("prints a one-line stderr message naming the minimum version when it exits", () => {
    const originalError = console.error;
    const printed: unknown[][] = [];
    console.error = (...args: unknown[]) => { printed.push(args); };
    try {
      assertNodeVersion("18.20.4", () => {});
    } finally {
      console.error = originalError;
    }
    expect(printed.length).toBe(1);
    const message = printed[0].join(" ");
    expect(message).toContain("FATAL");
    expect(message).toContain(`Node.js ${MIN_NODE_MAJOR}.0.0`);
    expect(message).toContain("18.20.4");
  });
});

// Minimal call-recorder — avoids pulling in vi.fn()'s module-level mock
// machinery for a one-off "was this called, with what arg" assertion.
function vi_fn(): { fn: (code: number) => void; calls: number[] } {
  const calls: number[] = [];
  return { fn: (code: number) => { calls.push(code); }, calls };
}

describe("assertNodeVersion — real spawned-process proof (default-argument auto-run path)", () => {
  it("Node <20 (stubbed): the module's own auto-run exits 1 with the FATAL message, before reaching fixture code after the import", () => {
    const result = spawnSync(process.execPath, [VITE_NODE_BIN, path.join(__dirname, "..", "fixtures", "node-gate-old.ts")], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FATAL");
    expect(result.stderr).toContain(`Node.js ${MIN_NODE_MAJOR}.0.0`);
    expect(result.stderr).toContain("18.20.4");
    // Proves the gate fired BEFORE control returned to the fixture's own code.
    expect(result.stdout).not.toContain("NODE_GATE_DID_NOT_EXIT");
  });
});
