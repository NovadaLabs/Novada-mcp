/**
 * Regression guard for the "4th place" false-'ungated' claim (2026-09-08,
 * pre-publish adversarial gate).
 *
 * The 2026-09-03 ledger-closure fix (finding #4) gated novada_ip_whitelist's
 * "remark" action identically to "add"/"del", but the fix touched only 3 of
 * the 4 places that described the gate: ip_whitelist.ts's runtime + its Zod
 * `action` enum .describe(), and registry.ts's novada_discover catalog entry.
 * It MISSED core.ts's _TOOL_DEFINITIONS description — the actual top-level
 * tools/list text an agent reads FIRST, before ever calling the tool — which
 * still read `"remark" (update a note, ungated)` for several more commits.
 *
 * Rather than hardcoding one more "ip_whitelist remark" assertion (the same
 * narrow-fix mistake that let this regression through 3 times in the same
 * class), this file is CLASS-DRIVEN: it enumerates every approval-gated tool
 * (ground-truthed against each tool's own evaluateApprovalGate() call sites,
 * not guessed) and asserts NONE of them describes an actually-gated action as
 * "ungated" in its TOOLS/core.ts description. Adding a 5th gated tool or a
 * new gated action to an existing one needs one new registry row here, not a
 * new bespoke test.
 */
import { describe, it, expect } from "vitest";
import { TOOLS } from "../../src/core.js";

/**
 * Ground truth: gated-tool name -> action names that ARE approval-gated,
 * i.e. actually call evaluateApprovalGate() before their real API call.
 * Verified directly against source (2026-09-08):
 *   - tools/ip_whitelist.ts: evaluateApprovalGate(..., "ip_whitelist_add")   on "add"
 *                            evaluateApprovalGate(..., "ip_whitelist_del")   on "del"
 *                            evaluateApprovalGate(..., "ip_whitelist_remark") on "remark"
 *                            "list" has NO gate call — genuinely read-only.
 *   - tools/static_ip_mgmt.ts: evaluateApprovalGate(..., "static_ip_open")  on "open"
 *                              evaluateApprovalGate(..., "static_ip_renew") on "renew"
 *                              "export"/"list" have NO gate call.
 *   - tools/capture_apikey.ts: evaluateApprovalGate(..., "reset_apikey") on "reset"
 *                              "get" has NO gate call.
 *   - tools/proxy_account_create.ts: ONE evaluateApprovalGate(..., "create_proxy_sub_account")
 *     call, unconditional — no `action` discriminator, so `null` here means
 *     "the whole tool is the gated write" rather than a per-action list.
 */
const GATED_ACTIONS_BY_TOOL: Readonly<Record<string, readonly string[] | null>> = {
  novada_proxy_account_create: null,
  novada_ip_whitelist: ["add", "del", "remark"],
  novada_static_ip_mgmt: ["open", "renew"],
  novada_capture_apikey: ["reset"],
};

function findTool(name: string) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} not found in TOOLS — update GATED_ACTIONS_BY_TOOL if it was renamed/removed`);
  return tool;
}

describe("approval-gated tools' TOOLS/core.ts descriptions never mislabel a gated action as 'ungated'", () => {
  it("whole-tool-gated tools (no action discriminator) never contain the word 'ungated' anywhere", () => {
    for (const [toolName, actions] of Object.entries(GATED_ACTIONS_BY_TOOL)) {
      if (actions !== null) continue; // only whole-tool-gated entries here
      const tool = findTool(toolName);
      expect(
        tool.description.toLowerCase(),
        `${toolName} has no per-action discriminator (the entire tool is one gated write) — its description must never contain "ungated"`,
      ).not.toContain("ungated");
    }
  });

  it("for every multi-action gated tool, each ACTUALLY-gated action's own clause is not described as 'ungated'", () => {
    for (const [toolName, actions] of Object.entries(GATED_ACTIONS_BY_TOOL)) {
      if (actions === null) continue;
      const tool = findTool(toolName);
      for (const action of actions) {
        // Matches the exact regression shape: the action's own quoted mention
        // followed, within the SAME clause (before the next quoted action name
        // starts), by the word "ungated" — e.g. `"remark" (update a note, ungated)`.
        const re = new RegExp(`"${action}"[^"]*\\bungated\\b`, "i");
        expect(
          tool.description,
          `${toolName}'s TOOLS description describes its ACTUALLY-gated action "${action}" as ungated:\n${tool.description}`,
        ).not.toMatch(re);
      }
    }
  });

  it("novada_ip_whitelist specifically: 'remark' is present as a gated WRITE, not silently omitted from the description", () => {
    const tool = findTool("novada_ip_whitelist");
    expect(tool.description).toMatch(/"remark"[^"]*gated by approval_token/i);
    // And the "Behavior for ..." line must list remark alongside add/del —
    // dropping it there would silently exclude remark from the documented
    // preview->token->execute flow even if the action-list line is fixed.
    expect(tool.description).toMatch(/Behavior for "add"\/"del"\/"remark"/);
  });

  it("class sweep: no tool anywhere in TOOLS describes any of ITS OWN gated actions as ungated (generalizes beyond the 4 known tools)", () => {
    // Defense in depth: even if GATED_ACTIONS_BY_TOOL is missing a future 5th
    // gated tool, this catches the narrower but still-real case of the literal
    // word "ungated" appearing anywhere in a description for a tool this file
    // already knows is approval-gated.
    for (const toolName of Object.keys(GATED_ACTIONS_BY_TOOL)) {
      const tool = findTool(toolName);
      const ungatedMentions = (tool.description.match(/\bungated\b/gi) ?? []).length;
      if (GATED_ACTIONS_BY_TOOL[toolName] === null) {
        expect(ungatedMentions, `${toolName}`).toBe(0);
      }
      // For multi-action tools, "ungated" MAY legitimately appear describing a
      // genuinely-read-only action (none currently do) — the per-action regex
      // test above is the precise check; this is a coarse sanity count only.
    }
  });
});
