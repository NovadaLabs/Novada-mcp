/**
 * F-5 (class-not-instance): core.ts's dispatch() unknown-tool error message
 * must be DERIVED from the live TOOLS/HIDDEN_ALIASES registry, not a
 * hand-maintained string. The old hardcoded list omitted 14 of the 15 pinned
 * scrapers plus novada_session_stats/novada_search_feedback, and presented
 * 10 hidden aliases as if they were listed/available tools.
 */
import { describe, expect, it } from "vitest";
import { TOOLS, HIDDEN_ALIASES, dispatch } from "../../src/core.js";

describe("dispatch() unknown-tool error — derived catalog", () => {
  it("names every visible tool, including all 15 pinned platform scrapers", async () => {
    await expect(dispatch("novada_totally_bogus_tool", {})).rejects.toThrow();
    let message = "";
    try {
      await dispatch("novada_totally_bogus_tool", {});
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    for (const tool of TOOLS) {
      expect(message, `expected the unknown-tool message to list ${tool.name}`).toContain(tool.name);
    }
    // Sanity: this is the exact regression the old hardcoded list had —
    // only novada_scrape_amazon of the 15 pinned scrapers was present.
    expect(message).toContain("novada_scrape_google");
    expect(message).toContain("novada_scrape_perplexity");
    expect(message).toContain("novada_session_stats");
    expect(message).toContain("novada_search_feedback");
  });

  it("separately labels hidden aliases as backward-compat, not as regular available tools", async () => {
    let message = "";
    try {
      await dispatch("novada_totally_bogus_tool", {});
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("Backward-compat aliases");
    for (const alias of HIDDEN_ALIASES) {
      expect(message).toContain(alias);
    }
  });

  it("TOOLS has 38 entries and HIDDEN_ALIASES is non-empty (sanity — guards the test itself against a silently-empty registry)", () => {
    expect(TOOLS.length).toBe(38);
    expect(HIDDEN_ALIASES.size).toBeGreaterThan(0);
  });
});
