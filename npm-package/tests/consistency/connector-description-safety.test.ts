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
  // Round 2 (S1-connector, independent review H3): broadened from
  // /\bcall\s+(?:this|it)\s+first\b/i, which required "this"/"it" IMMEDIATELY
  // adjacent to "first" — "call this tool first" or "call it right away first"
  // slipped through untouched. Now tolerates 0-3 intervening words between
  // "call" and "first" (covers "call this tool first", "call the discover tool
  // first", "call it immediately and always first", etc.) while still requiring
  // both anchor words to appear as an ordering directive, not just coincidentally
  // in the same sentence far apart.
  { name: "'call ... first' ordering directive (tolerates 0-3 intervening words)", re: /\bcall\s+\S+(?:\s+\S+){0,3}\s+first\b/i },
  // Round 2 (H3): the original only matched the literal "on (tool )?failure,
  // call" phrasing — "if this tool fails, call novada_account" (an equally
  // common, equally directive phrasing) did not match. Tolerates 0-4
  // intervening words between the fails/call anchors.
  { name: "conditional 'if/when ... fails, call X' behavioral directive", re: /\b(?:if|when)\s+\S+(?:\s+\S+){0,4}\s+fails,?\s+call\b/i },
  { name: "unconditional 'on (tool )?failure, call X' behavioral directive", re: /\bon\s+(?:tool\s+)?failure,?\s+call\b/i },
  { name: "imperative 'always use' / 'you must (use|call)' directive", re: /\balways\s+use\b|\byou\s+must\s+(?:use|call)\b/i },
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

/**
 * Self-check (synthetic fixtures only, never the real registry) — proves the
 * lint is not "trivially satisfiable": it actually FIRES on injected variants of
 * each banned pattern, not merely green today because nothing happens to match.
 * Round 2 (H3, independent review) specifically found the original "call this
 * first" / "on failure, call" rows were keyword-anchored tightly enough that an
 * obvious rephrasing ("call this tool first", "if this tool fails, call X")
 * slipped through silently. This block is the direct, falsifiable proof that
 * the broadened rows now catch exactly those rephrasings — and the mirror rows
 * prove legitimate scope-describing text ("Not for: X — use novada_y") still
 * passes clean, so the broadening didn't turn the lint into a blunt instrument
 * that flags normal sibling-pointer prose.
 */
describe("self-check: banned-pattern rows actually fire on the reviewer's exact variants (not trivially satisfiable)", () => {
  function findRow(nameSubstring: string) {
    const row = BANNED_PATTERNS.find((r) => r.name.includes(nameSubstring));
    if (!row) throw new Error(`no BANNED_PATTERNS row matching "${nameSubstring}" — update this self-check if the row was renamed`);
    return row.re;
  }

  it('"call ... first" row fires on "call this tool first" (the exact gap the original tight regex missed)', () => {
    expect(findRow("call ... first").test("Call this tool first when starting a task.")).toBe(true);
  });

  it('"call ... first" row fires on "call it right away first" (an inserted word breaking the old immediate-adjacency match)', () => {
    expect(findRow("call ... first").test("Always call it right away first.")).toBe(true);
  });

  it('"if/when ... fails, call X" row fires on the reviewer\'s exact example', () => {
    expect(findRow("if/when ... fails, call X").test("If this tool fails, call novada_account for diagnostics.")).toBe(true);
  });

  it('"if/when ... fails, call X" row fires on a "when" variant too', () => {
    expect(findRow("if/when ... fails, call X").test("When the search call fails, call novada_research instead.")).toBe(true);
  });

  it('"always use" / "you must" row fires on both imperative variants', () => {
    const re = findRow("'always use' / 'you must");
    expect(re.test("Always use novada_extract for this.")).toBe(true);
    expect(re.test("You must call novada_setup before anything else.")).toBe(true);
  });

  it("MIRROR: legitimate scope-describing text ('Not for: X — use novada_y') does not trip any broadened row", () => {
    const legitimate = [
      "Not for: a known URL (novada_extract) or a multi-source report (novada_research).",
      "general web pages outside this platform list — use novada_extract instead.",
      "Use novada_y for X when the scope differs.",
    ];
    for (const text of legitimate) {
      for (const { name, re } of BANNED_PATTERNS) {
        expect(re.test(text), `legitimate scope text wrongly matched banned pattern "${name}": "${text}"`).toBe(false);
      }
    }
  });

  it("MIRROR: real, unmodified core.ts descriptions still pass clean after the broadening (no regression introduced by H3)", () => {
    for (const { name, re } of BANNED_PATTERNS) {
      const offenders = _TOOL_DEFINITIONS.filter((t) => re.test(t.description)).map((t) => t.name);
      expect(offenders, `broadened pattern "${name}" now false-positives on real description(s): ${offenders.join(", ")}`).toEqual([]);
    }
  });
});
