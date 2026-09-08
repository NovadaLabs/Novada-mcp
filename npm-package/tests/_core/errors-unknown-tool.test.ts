/**
 * F-5 follow-on: classifyError() gives the "Unknown tool: ..." error (thrown
 * by core.ts's dispatch() default case, whose message is now DERIVED from the
 * live TOOLS/HIDDEN_ALIASES registry instead of a hand-maintained string) a
 * specific agent_instruction instead of falling through to the generic
 * UNKNOWN template.
 */
import { describe, expect, it } from "vitest";
import { classifyError, NovadaErrorCode } from "../../src/_core/errors.js";

describe("classifyError — unknown tool name", () => {
  it("classifies as INVALID_PARAMS with a specific, actionable instruction", () => {
    const err = classifyError(new Error("Unknown tool: novada_bogus. Available: novada_search, novada_extract."));
    expect(err.code).toBe(NovadaErrorCode.INVALID_PARAMS);
    expect(err.agent_instruction).toContain("novada_discover");
    expect(err.agent_instruction).not.toMatch(/unexpected error/i);
  });

  it("toAgentString() preserves the full available-tools list from the original message", () => {
    const err = classifyError(new Error("Unknown tool: novada_bogus. Available: novada_search, novada_extract."));
    const text = err.toAgentString();
    expect(text).toContain("novada_search");
    expect(text).toContain("novada_extract");
    expect(text).toMatch(/^agent_instruction:/m);
  });
});
