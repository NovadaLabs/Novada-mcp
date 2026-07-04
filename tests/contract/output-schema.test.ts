/**
 * NOV-662 contract test: no tool definition may declare `outputSchema` unless its
 * CallTool handler returns `structuredContent`.
 *
 * Background: MCP spec requires that a tool declaring `outputSchema` MUST return matching
 * `structuredContent` in the CallTool response. The CallTool handler in src/index.ts always
 * returns `{ content: [{ type: "text", text: result }] }` and never returns `structuredContent`.
 * Any tool with `outputSchema` therefore causes strict MCP clients (Claude Code) to reject
 * every call with -32600 (InvalidRequest).
 *
 * This test guards against re-introduction of `outputSchema` without a matching
 * `structuredContent` handler. If it fails, see NOV-662.
 *
 * Implementation note: we parse src/index.ts as text (not import it) because index.ts boots
 * a stdio server at module top-level — importing it would start a server inside the test process.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Extract the TOOLS array block from src/core.ts as text. */
function readToolsBlock(): string {
  const indexPath = resolve(__dirname, "../../src/core.ts");
  const src = readFileSync(indexPath, "utf8");
  const start = src.indexOf("const TOOLS = [");
  if (start === -1) throw new Error("could not locate `const TOOLS = [` in src/core.ts");
  const after = src.slice(start);
  const endRel = after.search(/\n\];/);
  if (endRel === -1) throw new Error("could not locate end of TOOLS array in src/core.ts");
  return after.slice(0, endRel);
}

/** Slice the TOOLS block into per-tool name+body segments. */
function readToolSegments(): { name: string; body: string }[] {
  const block = readToolsBlock();
  const re = /name:\s*"([a-z_]+)"/g;
  const marks: { name: string; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) marks.push({ name: m[1], idx: m.index });
  return marks.map((mark, i) => ({
    name: mark.name,
    body: block.slice(mark.idx, i + 1 < marks.length ? marks[i + 1].idx : block.length),
  }));
}

describe("NOV-662 contract: outputSchema only when structuredContent is returned", () => {
  it("no tool declares outputSchema (none of the handlers return structuredContent)", () => {
    const segments = readToolSegments();
    expect(segments.length, "TOOLS array must be non-empty").toBeGreaterThan(0);

    // Check the CallTool handler returns no structuredContent anywhere in the file — this
    // is the guard's premise; if this ever changes the constraint can be loosened per tool.
    const src = readFileSync(resolve(__dirname, "../../src/index.ts"), "utf8");
    const hasStructuredContent = /structuredContent/.test(src);
    if (hasStructuredContent) {
      // If structuredContent is now returned, this test needs to be updated per tool.
      // Do not silently pass — surface the situation for human review.
      throw new Error(
        "src/index.ts now contains `structuredContent`. " +
        "Re-evaluate the outputSchema contract per tool and update this test. (NOV-662)"
      );
    }

    // No handler returns structuredContent, so no tool may declare outputSchema.
    const offenders = segments.filter(s => /outputSchema\s*:/.test(s.body)).map(s => s.name);
    expect(
      offenders,
      `These tools declare outputSchema but their handlers do not return structuredContent — ` +
      `MCP clients will reject calls with -32600 (see NOV-662): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
