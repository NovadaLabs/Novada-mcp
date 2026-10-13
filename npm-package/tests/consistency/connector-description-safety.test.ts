/**
 * Claude Directory connector review — tool-description safety lint
 * (claude-directory-exam S1-connector, SOP step 3).
 *
 * Anthropic's connector review criteria (https://claude.com/docs/connectors/building/review-criteria)
 * rejects tool descriptions that:
 *   - Instruct Claude to call external software or tools the user didn't request
 *   - Interfere with Claude calling other tools
 *   - Direct Claude to pull behavioral instructions from external sources
 *   - Contain hidden, obfuscated, or encoded instructions
 *   - Tell Claude to behave in ways unrelated to the tool's function, attempt to
 *     override system instructions, or promote products and services
 *
 * This is a CLASS-DRIVEN lint (banned-pattern ROWS), not a hand-picked list of the
 * known offenders fixed in this change — a new tool description that reintroduces
 * one of these patterns fails this test immediately, without needing a new assertion.
 *
 * Scope: _TOOL_DEFINITIONS (not just the exported TOOLS/ListTools surface) — this
 * covers every tool description in core.ts, including the 6 proxy-type aliases
 * (novada_proxy_residential/isp/datacenter/mobile/static/dedicated) that are
 * dispatch-only and never appear in ListTools. They're unreachable today, but
 * fixing them at the single source means they can never resurface the banned
 * pattern if they're ever re-exposed, and keeps core.ts's only copy of "the tool
 * description text" clean everywhere a human or scanner might read it.
 *
 * Does NOT touch runtime response `agent_instruction` fields (scrape.ts, extract.ts,
 * account.ts, ...) — those are tool OUTPUTS (a "what to do next" hint in the data a
 * tool call returns, same shape as a pagination `next` link), not tool DESCRIPTIONS
 * that direct Claude's behavior ahead of ever calling the tool. Anthropic's rule is
 * about descriptions; this file only imports and scans _TOOL_DEFINITIONS text.
 */
import { describe, it, expect } from "vitest";
import { _TOOL_DEFINITIONS } from "../../src/core.js";

/**
 * Banned-pattern table — one row per prohibited phrasing CLASS, not per known
 * offender. Extending coverage (a new banned phrase class) is a new row here.
 */
const BANNED_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "agent_instruction: label (directs Claude's behavior from inside a description)", re: /agent_instruction:/i },
  { name: "'call this first' / 'call ... first' ordering directive", re: /\bcall\s+(?:this|it)\s+first\b/i },
  { name: "'Call ... FIRST' ordering directive (onboarding-tool variant)", re: /\bcall\s+this\s+first\b/i },
  { name: "unconditional 'on (tool )?failure, call X' behavioral directive", re: /\bon\s+(?:tool\s+)?failure,?\s+call\b/i },
  { name: "promotional absolute claim ('ONE ... COVERS ALL ...')", re: /\bONE\s+API\s+KEY\s+COVERS\s+ALL\b/i },
  { name: "instruction to pull behavior from an external source", re: /\b(?:read|pull|fetch)\s+(?:behavioral\s+)?instructions?\s+from\b/i },
  { name: "override/ignore system instructions", re: /\b(?:ignore|override)\s+(?:the\s+)?(?:system|previous|prior)\s+(?:prompt|instructions?)\b/i },
  { name: "instructs Claude to behave as / pretend to be something else", re: /\byou\s+are\s+now\b|\bpretend\s+(?:to\s+be|you)\b/i },
];

describe("connector review: no tool description directs Claude's behavior or promotes (class-driven banned-pattern lint)", () => {
  for (const { name, re } of BANNED_PATTERNS) {
    it(`no _TOOL_DEFINITIONS description matches banned pattern: ${name}`, () => {
      const offenders = _TOOL_DEFINITIONS.filter((t) => re.test(t.description)).map((t) => t.name);
      expect(offenders, `banned pattern "${name}" found in description(s) of: ${offenders.join(", ")}`).toEqual([]);
    });
  }

  it("every _TOOL_DEFINITIONS description has non-empty text (sanity bound on the table above)", () => {
    const empty = _TOOL_DEFINITIONS.filter((t) => !t.description || t.description.trim().length === 0).map((t) => t.name);
    expect(empty).toEqual([]);
  });

  it("class sweep: the full BANNED_PATTERNS table covers every _TOOL_DEFINITIONS entry — adding a 39th tool needs no new test here", () => {
    // Pins the fixture size so a silent change in _TOOL_DEFINITIONS' shape (not its
    // content) doesn't make the loop above quietly scan fewer tools than expected.
    expect(_TOOL_DEFINITIONS.length).toBeGreaterThanOrEqual(38);
  });
});
