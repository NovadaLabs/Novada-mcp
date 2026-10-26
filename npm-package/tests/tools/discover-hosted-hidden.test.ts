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

  // Drift guard: this constant mirrors HOSTED_HIDDEN in mcp.ts. Skipped when the monorepo's
  // hosted-server is not alongside (e.g. a standalone npm-package checkout).
  it.skipIf(!existsSync(mcpTs))("equals HOSTED_HIDDEN in hosted-server/vercel/api/mcp.ts", () => {
    const src = readFileSync(mcpTs, "utf8");
    const start = src.indexOf("const HOSTED_HIDDEN = new Set([");
    expect(start).toBeGreaterThan(-1);
    const slice = src.slice(start, src.indexOf("]);", start));
    const hosted = [...slice.matchAll(/"(novada_[a-z_]+)"/g)].map((m) => m[1]).sort();
    expect([...HOSTED_HIDDEN_TOOLS].sort()).toEqual(hosted);
  });
});
