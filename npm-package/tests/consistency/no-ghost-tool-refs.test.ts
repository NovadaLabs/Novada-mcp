/**
 * No-ghost-tool-refs guard.
 *
 * NOV-847: Novada's own agent-facing guidance (MCP resources + prompts) recommended
 * tool names that were HIDDEN from ListTools by the TOW2-256 registry refactor —
 * e.g. `novada_proxy_residential`, `novada_scraper_submit`, `novada_unblock`,
 * `novada_health`. An agent that trusted the guide and called one of those names
 * got rejected by its own MCP client (the name was never in ListTools) — the
 * literal root cause behind "the agent is always confused."
 *
 * This test scans the RENDERED TEXT of every piece of agent-facing guidance —
 * the novada://guide and novada://llms-txt resources (plus every resource's
 * catalog description), and every prompt in prompts/index.ts (list description
 * + fully-rendered getPrompt() output) — for tokens matching /novada_[a-z0-9_]+/,
 * and asserts each one names a tool that is ACTUALLY present in
 * REGISTERED_TOOL_NAMES (src/tools/registry.ts — the same source of truth
 * tests/tools/discover.test.ts guards against ListTools drift).
 *
 * A token that matches the pattern but isn't in the registry is a "ghost":
 * guidance steering an agent toward a tool call its client will reject.
 *
 * This is a PERMANENT CI gate, not a one-time cleanup — any future edit to
 * resources/index.ts or prompts/index.ts that reintroduces, renames-without-
 * updating, or typos a tool name fails this test immediately, turning
 * "keep guidance in sync" from discipline into structure.
 *
 * Not-inert proof (performed manually during NOV-847, not re-run here since it
 * requires mutating source): temporarily reinserting the string "novada_unblock"
 * into the novada://guide text made the
 * "novada://guide references only registered tools" test below fail with a
 * clear ghost-token message; removing it restored green. See the NOV-847
 * worklog for the exact diff used.
 */
import { describe, it, expect } from "vitest";
import { RESOURCES, readResource } from "../../src/resources/index.js";
import { PROMPTS, getPrompt } from "../../src/prompts/index.js";
import { REGISTERED_TOOL_NAMES } from "../../src/tools/registry.js";

/**
 * Explicit allowlist for tokens that match /novada_[a-z0-9_]+/ but are NOT tool
 * names (e.g. a resource-URI fragment written without "://"). Empty today —
 * kept so a genuinely legitimate non-tool token has a documented escape hatch
 * that doesn't require loosening the pattern. NEVER add a real hidden/legacy
 * tool name here — that defeats the entire point of this guard.
 */
const ALLOWLISTED_NON_TOOL_TOKENS: ReadonlySet<string> = new Set([]);

const GHOST_TOKEN_PATTERN = /novada_[a-z0-9_]+/g;

/** Extract distinct candidate tool-name tokens from a blob of guidance text. */
function extractTokens(text: string): string[] {
  const matches = text.match(GHOST_TOKEN_PATTERN) ?? [];
  return [...new Set(matches)];
}

/** Assert every token in `text` is either a registered tool or explicitly allowlisted. */
function assertNoGhostTokens(label: string, text: string): void {
  const tokens = extractTokens(text);
  const ghosts = tokens.filter(
    (t) => !REGISTERED_TOOL_NAMES.has(t) && !ALLOWLISTED_NON_TOOL_TOKENS.has(t)
  );
  expect(
    ghosts,
    `${label} references tool name(s) NOT in REGISTERED_TOOL_NAMES (hidden/renamed/typo'd — an agent following this guidance would call a tool its MCP client never saw): ${ghosts.join(", ")}`
  ).toEqual([]);
}

describe("no-ghost-tool-refs: agent-facing guidance only names REGISTERED tools", () => {
  it("sanity: REGISTERED_TOOL_NAMES is populated (guards against an empty registry silently passing everything)", () => {
    expect(REGISTERED_TOOL_NAMES.size).toBeGreaterThan(10);
  });

  describe("MCP resources", () => {
    it("novada://guide body text references only registered tools", () => {
      const { contents } = readResource("novada://guide");
      assertNoGhostTokens("novada://guide", contents[0]!.text);
    });

    it("novada://llms-txt body text references only registered tools", () => {
      const { contents } = readResource("novada://llms-txt");
      assertNoGhostTokens("novada://llms-txt", contents[0]!.text);
    });

    it("every RESOURCES catalog entry (name + description) references only registered tools", () => {
      for (const r of RESOURCES) {
        assertNoGhostTokens(`RESOURCES catalog entry ${r.uri} (name)`, r.name);
        assertNoGhostTokens(`RESOURCES catalog entry ${r.uri} (description)`, r.description);
      }
    });
  });

  describe("MCP prompts", () => {
    it("PROMPTS catalog entries (name + description) reference only registered tools", () => {
      for (const p of PROMPTS) {
        assertNoGhostTokens(`PROMPTS catalog entry ${p.name} (description)`, p.description);
      }
    });

    // Representative args covering every declared argument (required + optional)
    // for each prompt, so the rendered text is fully populated — a ghost token
    // hidden behind an unfilled optional-arg branch would otherwise slip past
    // this guard. Keys MUST match PROMPTS[].name exactly (enforced below).
    const SAMPLE_ARGS: Record<string, Record<string, string>> = {
      research_topic: { topic: "MCP servers", country: "us", focus: "technical" },
      extract_and_summarize: {
        urls: "https://example.com/a,https://example.com/b",
        focus: "pricing",
      },
      site_audit: { url: "https://example.com", sections: "pricing, docs, api" },
      scrape_platform_data: {
        platform: "amazon.com",
        data_type: "product listings",
        query: "iphone 16",
      },
      browser_stateful_workflow: {
        url: "https://example.com",
        workflow: "log in, click reports, download csv",
        session_id: "sess-1",
      },
      "novada-which-tool": { task: "get all docs pages from a site" },
      "novada-extract-format": { goal: "just the price and title" },
    };

    it("every declared prompt has a SAMPLE_ARGS entry (test coverage sanity — fails loudly if a new prompt is added without updating this test)", () => {
      const promptNames = PROMPTS.map((p) => p.name).sort();
      const sampledNames = Object.keys(SAMPLE_ARGS).sort();
      expect(sampledNames).toEqual(promptNames);
    });

    for (const prompt of PROMPTS) {
      it(`prompt "${prompt.name}" (rendered) references only registered tools`, () => {
        const args = SAMPLE_ARGS[prompt.name];
        expect(args, `no SAMPLE_ARGS entry for prompt "${prompt.name}" — add one above`).toBeDefined();
        const { messages } = getPrompt(prompt.name, args!);
        const text = messages.map((m) => m.content.text).join("\n");
        assertNoGhostTokens(`prompt "${prompt.name}"`, text);
      });
    }
  });
});
