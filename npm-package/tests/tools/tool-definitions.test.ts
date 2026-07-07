/**
 * Tool-definition invariants for the ListTools surface (src/index.ts `TOOLS` array).
 *
 * Covers NOV-326 + NOV-324 + NOV-662:
 *   1. Every tool definition declares `annotations` (readOnly/destructive/idempotent/openWorld hints).
 *   2. NOV-662: No tool may declare `outputSchema` unless its handler returns `structuredContent`.
 *      Since no handler in this codebase returns `structuredContent`, the invariant is:
 *      `outputSchema` must be absent from every tool definition. Any re-introduction without
 *      a matching `structuredContent` handler causes strict MCP clients (Claude Code) to
 *      reject calls with -32600. See NOV-662.
 *   3. novada_monitor's description opens with the session-scope limitation.
 *   4. novada_scraper_submit's description documents the REAL params (platform/operation/
 *      params) and does NOT advertise a non-existent `scraper_type` param (NOV-324).
 *
 * Why read src/index.ts as TEXT instead of importing it: index.ts constructs and runs the
 * MCP server at module top-level (`new NovadaMCPServer(); server.run()`). Importing it would
 * boot a stdio server inside the test process. Parsing the file text is side-effect-free —
 * the same approach used by tests/tools/discover.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ToolSegment {
  name: string;
  body: string;
}

/**
 * Slice src/core.ts into per-tool segments from `const _TOOL_DEFINITIONS = [` up to
 * the first top-level `];`, so we never pick up `name:` keys from other arrays.
 * _TOOL_DEFINITIONS holds ALL dispatchable tool schemas (visible + hidden);
 * the exported TOOLS array derives from it by filtering to REGISTERED_TOOL_NAMES.
 * Annotation contracts apply to ALL definitions, so we read the full set.
 */
function readToolSegments(): ToolSegment[] {
  const indexPath = resolve(__dirname, "../../src/core.ts");
  const src = readFileSync(indexPath, "utf8");
  const start = src.indexOf("const _TOOL_DEFINITIONS");
  expect(start, "could not locate `const _TOOL_DEFINITIONS` in src/core.ts").toBeGreaterThan(-1);
  const after = src.slice(start);
  const endRel = after.search(/\n\];/);
  expect(endRel, "could not locate end of _TOOL_DEFINITIONS array").toBeGreaterThan(-1);
  const block = after.slice(0, endRel);

  const re = /name:\s*"([a-z_]+)"/g;
  const marks: { name: string; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) marks.push({ name: m[1], idx: m.index });

  return marks.map((mark, i) => ({
    name: mark.name,
    body: block.slice(mark.idx, i + 1 < marks.length ? marks[i + 1].idx : block.length),
  }));
}

const segments = readToolSegments();

describe("tool definitions (src/core.ts _TOOL_DEFINITIONS)", () => {
  it("declares at least the full dispatchable tool set", () => {
    // _TOOL_DEFINITIONS contains all tools (visible + hidden). 22 in registry + 11 hidden = 33.
    expect(segments.length).toBeGreaterThanOrEqual(30);
  });

  it("every tool has an `annotations` block (NOV-326)", () => {
    const missing = segments.filter(s => !/annotations:\s*\{/.test(s.body)).map(s => s.name);
    expect(missing, `tools missing annotations: ${missing.join(", ")}`).toEqual([]);
  });

  it("every annotations block sets openWorldHint explicitly", () => {
    const missing = segments
      .filter(s => !/openWorldHint:\s*(true|false)/.test(s.body))
      .map(s => s.name);
    expect(missing, `tools missing openWorldHint: ${missing.join(", ")}`).toEqual([]);
  });

  it("no tool declares outputSchema without a matching structuredContent handler (NOV-662)", () => {
    // The CallTool handler in src/index.ts always returns { content:[{type:"text",text:result}] }
    // and never returns structuredContent. Per MCP spec, a tool declaring outputSchema MUST
    // return matching structuredContent — otherwise strict clients (Claude Code) reject every
    // call with -32600. Until structuredContent support is added, outputSchema must be absent
    // from all tool definitions.
    const withOutputSchema = segments.filter(s => /outputSchema:\s*\{/.test(s.body)).map(s => s.name);
    expect(
      withOutputSchema,
      `Tools re-introduced outputSchema without structuredContent support (see NOV-662): ${withOutputSchema.join(", ")}`,
    ).toEqual([]);
  });

  it("novada_monitor description opens with the session-scope limitation (NOV-324)", () => {
    const seg = segments.find(s => s.name === "novada_monitor");
    expect(seg, "novada_monitor not found").toBeTruthy();
    const descStart = seg!.body.indexOf("description: `");
    expect(descStart).toBeGreaterThan(-1);
    const firstLine = seg!.body.slice(descStart + "description: `".length).split("\n")[0];
    expect(firstLine).toMatch(/Session-scoped only/);
  });

  it("novada_scraper_submit description matches the real schema params, not a bogus scraper_type (NOV-324)", () => {
    const seg = segments.find(s => s.name === "novada_scraper_submit");
    expect(seg, "novada_scraper_submit not found").toBeTruthy();
    // NOV-324: ScraperSubmitParamsSchema has only platform/operation/params — there is no
    // scraper_type field, so the description must not document one (it misleads agents).
    expect(seg!.body, "scraper_submit description must not mention a non-existent scraper_type param").not.toMatch(/scraper_type/);
    // The description must document the REAL params instead.
    expect(seg!.body).toMatch(/platform/);
    expect(seg!.body).toMatch(/operation/);
    expect(seg!.body).toMatch(/params/);
  });
});
