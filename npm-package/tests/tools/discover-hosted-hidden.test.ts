import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { HOSTED_HIDDEN_TOOLS } from "../../src/tools/discover.js";
import { TOOL_REGISTRY } from "../../src/tools/registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const mcpTs = resolve(here, "../../../hosted-server/vercel/api/mcp.ts");

describe("discover: hosted-hidden tool list", () => {
  it("names only real registry tools, no duplicates", () => {
    const names = new Set(TOOL_REGISTRY.map((t) => t.name));
    for (const n of HOSTED_HIDDEN_TOOLS) expect(names.has(n)).toBe(true);
    expect(new Set(HOSTED_HIDDEN_TOOLS).size).toBe(HOSTED_HIDDEN_TOOLS.length);
  });

  // B6 (#44, 2026-11-18): this used to be a drift GUARD — two independently-
  // maintained arrays (this file's HOSTED_HIDDEN_TOOLS and mcp.ts's own
  // `HOSTED_HIDDEN = new Set([...])` literal), hand-synced, regex-diffed here
  // to catch divergence. Now there is only ONE list: mcp.ts imports
  // HOSTED_HIDDEN_TOOLS from this exact module and derives
  // `HOSTED_HIDDEN = new Set(HOSTED_HIDDEN_TOOLS)` — drift is no longer
  // POSSIBLE, not just caught after the fact. This test asserts that
  // structural fact (the import + derivation are both present) rather than
  // diffing two separately-maintained literals. Skipped when the monorepo's
  // hosted-server is not alongside (e.g. a standalone npm-package checkout).
  it.skipIf(!existsSync(mcpTs))("mcp.ts derives HOSTED_HIDDEN from THIS module's HOSTED_HIDDEN_TOOLS — one source, not two hand-synced copies", () => {
    const src = readFileSync(mcpTs, "utf8");
    expect(src, "mcp.ts must import HOSTED_HIDDEN_TOOLS from the vendored discover.js").toMatch(
      /import \{ HOSTED_HIDDEN_TOOLS \} from "\.\.\/vendor\/novada-mcp\/tools\/discover\.js";/,
    );
    expect(src, "mcp.ts's HOSTED_HIDDEN must be derived from the imported HOSTED_HIDDEN_TOOLS, not a hand-written literal array").toMatch(
      /const HOSTED_HIDDEN = new Set\(HOSTED_HIDDEN_TOOLS\);/,
    );
    // Regression fence: the OLD hand-written literal form must never reappear.
    expect(src).not.toMatch(/const HOSTED_HIDDEN = new Set\(\[/);
  });
});
