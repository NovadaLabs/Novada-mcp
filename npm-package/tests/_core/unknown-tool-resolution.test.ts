/**
 * F13 unit pins for core.ts's tool-name resolution primitives:
 *   KNOWN_TOOL_NAMES  — derived from _TOOL_DEFINITIONS ∪ HIDDEN_ALIASES (never a hand list)
 *   suggestToolName() — cheap close-name suggestion (Levenshtein ≤ 2 / prefix repair)
 *   makeUnknownToolError() — the ONE unknown-tool error builder dispatch() and the
 *                            stdio gate share, so their texts can never drift.
 */
import { describe, expect, it } from "vitest";
import {
  KNOWN_TOOL_NAMES,
  suggestToolName,
  makeUnknownToolError,
  dispatch,
  TOOLS,
  HIDDEN_ALIASES,
  _TOOL_DEFINITIONS,
} from "../../src/core.js";
import { classifyError, NovadaErrorCode } from "../../src/_core/errors.js";

describe("KNOWN_TOOL_NAMES — derived, class-not-instance", () => {
  it("contains every visible tool, every hidden alias, and every definition (incl. transport-level tools)", () => {
    for (const t of TOOLS) expect(KNOWN_TOOL_NAMES.has(t.name), t.name).toBe(true);
    for (const a of HIDDEN_ALIASES) expect(KNOWN_TOOL_NAMES.has(a), a).toBe(true);
    for (const d of _TOOL_DEFINITIONS) expect(KNOWN_TOOL_NAMES.has(d.name), d.name).toBe(true);
  });

  it("covers representative members of each family", () => {
    for (const name of [
      "novada_search",          // core
      "novada_extract",         // unauth tier
      "novada_scrape_amazon",   // factory-generated platform scraper
      "novada_unblock",         // hidden alias with no _TOOL_DEFINITIONS entry
      "novada_health",          // hidden account alias
      "novada_setup",           // transport-level (handled before dispatch)
      "novada_session_stats",
      "novada_search_feedback",
    ]) {
      expect(KNOWN_TOOL_NAMES.has(name), name).toBe(true);
    }
  });

  it("does NOT contain ghosts", () => {
    expect(KNOWN_TOOL_NAMES.has("novada_ghost_tool")).toBe(false);
    expect(KNOWN_TOOL_NAMES.has("novada_serch")).toBe(false);
  });
});

describe("suggestToolName", () => {
  it("repairs a 1-char typo", () => {
    expect(suggestToolName("novada_serch")).toBe("novada_search");
  });

  it("repairs a missing prefix", () => {
    expect(suggestToolName("search")).toBe("novada_search");
    expect(suggestToolName("extract")).toBe("novada_extract");
  });

  it("returns undefined when nothing is close", () => {
    expect(suggestToolName("novada_ghost_tool")).toBeUndefined();
    expect(suggestToolName("totally_unrelated")).toBeUndefined();
  });

  it("is cheap on hostile input: very long names short-circuit to undefined", () => {
    const long = "novada_" + "x".repeat(5000);
    const t0 = Date.now();
    expect(suggestToolName(long)).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe("makeUnknownToolError", () => {
  it("keeps the pinned 'Unknown tool:' prefix and the derived Available list", () => {
    const err = makeUnknownToolError("novada_ghost_tool");
    expect(err.message).toMatch(/^Unknown tool: novada_ghost_tool\./);
    expect(err.message).toContain("Available: ");
    expect(err.message).toContain("novada_search");
    expect(err.message).toContain("Backward-compat aliases");
  });

  it("adds a Did-you-mean line when a close name exists", () => {
    expect(makeUnknownToolError("novada_serch").message).toContain("Did you mean: novada_search?");
    expect(makeUnknownToolError("novada_ghost_tool").message).not.toContain("Did you mean");
  });

  it("truncates hostile long names instead of echoing them whole", () => {
    const err = makeUnknownToolError("novada_" + "x".repeat(5000));
    expect(err.message.length).toBeLessThan(4000);
  });

  it("classifyError keeps the existing INVALID_PARAMS classification + discover instruction", () => {
    const classified = classifyError(makeUnknownToolError("novada_ghost_tool"));
    expect(classified.code).toBe(NovadaErrorCode.INVALID_PARAMS);
    expect(classified.agent_instruction).toContain("novada_discover");
  });
});

describe("dispatch() default case", () => {
  it("still throws the unknown-tool error (hosted path unchanged)", async () => {
    await expect(dispatch("novada_ghost_tool", {}, "any-key")).rejects.toThrow(/Unknown tool: novada_ghost_tool/);
  });

  it("throws with the suggestion for a typo'd name", async () => {
    await expect(dispatch("novada_serch", { query: "x" }, "any-key")).rejects.toThrow(/Did you mean: novada_search\?/);
  });
});
