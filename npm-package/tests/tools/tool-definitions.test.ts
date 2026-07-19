/**
 * Tool-definition invariants for the ListTools surface (src/core.ts `_TOOL_DEFINITIONS`).
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
 * Why import src/core.ts's `_TOOL_DEFINITIONS` directly instead of parsing text: core.ts
 * documents itself as side-effect-free (no server construction, no process.exit, no stdio
 * boot) — unlike src/index.ts, which boots a stdio server at module top-level and must never
 * be imported by a test. `_TOOL_DEFINITIONS` is exported specifically for this kind of
 * test/introspection use. Checking the actual objects (not their source-text representation)
 * is also strictly MORE robust than a regex over the literal `name: "novada_x"` pattern: a
 * tool definition GENERATED and spread in from another module (e.g. tools/platform_scraper.ts's
 * per-platform scraper factory, used by novada_scrape_amazon and its future 15 siblings) has
 * no literal `name: "..."` text sitting inside core.ts's array at all — a text-parser would
 * silently stop covering it, while an import-based check keeps seeing it because it inspects
 * the real, computed object.
 */
import { describe, it, expect } from "vitest";
import { _TOOL_DEFINITIONS } from "../../src/core.js";

describe("tool definitions (src/core.ts _TOOL_DEFINITIONS)", () => {
  it("declares at least the full dispatchable tool set", () => {
    // _TOOL_DEFINITIONS contains all tools (visible + hidden). 22 in registry + 11 hidden = 33.
    expect(_TOOL_DEFINITIONS.length).toBeGreaterThanOrEqual(30);
  });

  it("every tool has an `annotations` object (NOV-326)", () => {
    const missing = _TOOL_DEFINITIONS
      .filter((t) => t.annotations === undefined || typeof t.annotations !== "object" || t.annotations === null)
      .map((t) => t.name);
    expect(missing, `tools missing annotations: ${missing.join(", ")}`).toEqual([]);
  });

  it("every annotations object sets openWorldHint explicitly", () => {
    const missing = _TOOL_DEFINITIONS
      .filter((t) => typeof t.annotations?.openWorldHint !== "boolean")
      .map((t) => t.name);
    expect(missing, `tools missing openWorldHint: ${missing.join(", ")}`).toEqual([]);
  });

  it("no tool declares outputSchema without a matching structuredContent handler (NOV-662)", () => {
    // The CallTool handler in src/index.ts always returns { content:[{type:"text",text:result}] }
    // and never returns structuredContent. Per MCP spec, a tool declaring outputSchema MUST
    // return matching structuredContent — otherwise strict clients (Claude Code) reject every
    // call with -32600. Until structuredContent support is added, outputSchema must be absent
    // from all tool definitions.
    const offenders = _TOOL_DEFINITIONS
      .filter((t) => Object.prototype.hasOwnProperty.call(t, "outputSchema"))
      .map((t) => t.name);
    expect(
      offenders,
      `Tools re-introduced outputSchema without structuredContent support (see NOV-662): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("novada_monitor description opens with purpose and contains hosted-endpoint warning (NOV-324 updated)", () => {
    const tool = _TOOL_DEFINITIONS.find((t) => t.name === "novada_monitor");
    expect(tool, "novada_monitor not found").toBeTruthy();
    // Description now leads with purpose; hosted-endpoint warning appears later in the body.
    const firstLine = tool!.description.split("\n")[0];
    expect(firstLine).toMatch(/Detect changes/);
    expect(tool!.description).toMatch(/Hosted endpoint|hosted endpoint/);
    expect(tool!.description).toMatch(/baseline_recorded/);
  });

  it("novada_scraper_submit description matches the real schema params, not a bogus scraper_type (NOV-324)", () => {
    const tool = _TOOL_DEFINITIONS.find((t) => t.name === "novada_scraper_submit");
    expect(tool, "novada_scraper_submit not found").toBeTruthy();
    // NOV-324: ScraperSubmitParamsSchema has only platform/operation/params — there is no
    // scraper_type field, so the description must not document one (it misleads agents).
    expect(tool!.description, "scraper_submit description must not mention a non-existent scraper_type param").not.toMatch(/scraper_type/);
    // The description must document the REAL params instead.
    expect(tool!.description).toMatch(/platform/);
    expect(tool!.description).toMatch(/operation/);
    expect(tool!.description).toMatch(/params/);
  });
});
