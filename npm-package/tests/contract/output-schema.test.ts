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
 * Implementation note: `_TOOL_DEFINITIONS` is imported directly from src/core.ts (exported
 * specifically for test/introspection use) rather than parsed as text. core.ts is
 * side-effect-free and safe to import (no server construction, no stdio boot) — unlike
 * src/index.ts, which boots a stdio server at module top-level and is still read as text
 * below (only to check for `structuredContent`, an unrelated grep over that one file).
 * Checking the real objects instead of source text is also more robust: a tool definition
 * GENERATED and spread in from another module (e.g. tools/platform_scraper.ts's per-platform
 * scraper factory) has no literal `name: "..."` text sitting inside core.ts's array — a
 * text-parser would silently stop covering it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { _TOOL_DEFINITIONS } from "../../src/core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("NOV-662 contract: outputSchema only when structuredContent is returned", () => {
  it("no tool declares outputSchema (none of the handlers return structuredContent)", () => {
    expect(_TOOL_DEFINITIONS.length, "TOOLS array must be non-empty").toBeGreaterThan(0);

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
    const offenders = _TOOL_DEFINITIONS
      .filter((t) => Object.prototype.hasOwnProperty.call(t, "outputSchema"))
      .map((t) => t.name);
    expect(
      offenders,
      `These tools declare outputSchema but their handlers do not return structuredContent — ` +
      `MCP clients will reject calls with -32600 (see NOV-662): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
