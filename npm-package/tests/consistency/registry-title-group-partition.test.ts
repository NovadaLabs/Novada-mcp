/**
 * Registry `title` + `group` drift guard (F-1 P1 / F-7 audit, W-B1).
 *
 * W-B1 added two class-driven fields to every TOOL_REGISTRY row (src/tools/registry.ts):
 *   - `title`  — a non-empty MCP display title (F-7). Required at the TypeScript level
 *     (ToolMeta.title: string), so a missing title fails the BUILD — but nothing
 *     previously asserted this at the TEST level, so a future refactor that widens the
 *     type (e.g. `title?: string`) or bypasses it via `as ToolMeta` would silently ship
 *     titleless tools without any test catching it.
 *   - `group`  — one of TOOL_GROUPS ("core"|"scrapers"|"account"|"meta"), the opt-in
 *     filtering partition. Also TypeScript-enforced to be a single value per row, but —
 *     same rationale — the PARTITION property (every tool in exactly one group, no tool
 *     in zero or multiple) deserves its own runtime guard, independent of the type
 *     system, mirroring the house pattern used by tests/tools/discover.test.ts's
 *     `diffToolNames` and tests/consistency/server-json-descriptions.test.ts's
 *     `toolCountMentions` self-checks: prove the DETECTOR fires on synthetic drift before
 *     trusting it's green on real data for the right reason.
 *
 * Every assertion below ITERATES TOOL_REGISTRY / GROUP_TOOL_NAMES — no tool name is
 * hardcoded anywhere in this file (class-not-instance): a 39th tool is covered
 * automatically by every test here without editing this file again.
 */
import { describe, it, expect } from "vitest";
import {
  TOOL_REGISTRY,
  TOOL_GROUPS,
  GROUP_TOOL_NAMES,
  REGISTERED_TOOL_NAMES,
  type ToolGroup,
} from "../../src/tools/registry.js";
import { TOOLS } from "../../src/core.js";

/**
 * Pure partition-check, factored out so it can be exercised against SYNTHETIC
 * (fabricated) inputs below before trusting it against the real registry — the
 * same "not-inert" proof pattern discover.test.ts's diffToolNames uses.
 *
 * Returns:
 *   - missing: universe members that appear in NO group (a tool left unassigned)
 *   - duplicates: universe members that appear in MORE THAN ONE group (double-assigned)
 *   - extra: group members that aren't in the universe at all (a ghost/typo'd name)
 */
function partitionCheck(
  groups: Readonly<Record<string, readonly string[]>>,
  universe: readonly string[]
): { missing: string[]; duplicates: string[]; extra: string[] } {
  const universeSet = new Set(universe);
  const counts = new Map<string, number>();
  const extra: string[] = [];

  for (const members of Object.values(groups)) {
    for (const name of members) {
      if (!universeSet.has(name)) {
        extra.push(name);
        continue;
      }
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const missing = universe.filter((name) => !counts.has(name));
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name);

  return { missing, duplicates, extra };
}

describe("partitionCheck self-check: the detector fires on injected drift (not inert)", () => {
  const universe = ["novada_a", "novada_b", "novada_c"];

  it("flags a tool left unassigned (present in the universe, absent from every group — the exact class of bug a 39th unrouted tool would introduce)", () => {
    const { missing, duplicates, extra } = partitionCheck(
      { g1: ["novada_a"], g2: ["novada_b"] },
      universe
    );
    expect(missing).toEqual(["novada_c"]);
    expect(duplicates).toEqual([]);
    expect(extra).toEqual([]);
  });

  it("flags a tool double-assigned to two groups", () => {
    const { missing, duplicates, extra } = partitionCheck(
      { g1: ["novada_a", "novada_c"], g2: ["novada_b", "novada_c"] },
      universe
    );
    expect(missing).toEqual([]);
    expect(duplicates).toEqual(["novada_c"]);
    expect(extra).toEqual([]);
  });

  it("flags a group member that isn't in the universe at all (ghost/typo'd name)", () => {
    const { missing, duplicates, extra } = partitionCheck(
      { g1: ["novada_a", "novada_ghost"], g2: ["novada_b", "novada_c"] },
      universe
    );
    expect(missing).toEqual([]);
    expect(duplicates).toEqual([]);
    expect(extra).toEqual(["novada_ghost"]);
  });

  it("reports a clean partition as clean (sanity — the detector isn't just always-fail)", () => {
    const { missing, duplicates, extra } = partitionCheck(
      { g1: ["novada_a"], g2: ["novada_b", "novada_c"] },
      universe
    );
    expect(missing).toEqual([]);
    expect(duplicates).toEqual([]);
    expect(extra).toEqual([]);
  });
});

describe("every TOOL_REGISTRY entry has a non-empty title (F-7)", () => {
  it("no tool has a missing, empty, or whitespace-only title", () => {
    const offenders = TOOL_REGISTRY.filter(
      (t) => typeof t.title !== "string" || t.title.trim().length === 0
    ).map((t) => t.name);
    expect(offenders, `tools missing a title: ${offenders.join(", ")}`).toEqual([]);
  });

  it("TOOLS (src/core.ts's wired ListTools surface) carries the SAME title for every tool — no drift between the registry and what's actually served", () => {
    const titleByName = new Map(TOOL_REGISTRY.map((t) => [t.name, t.title]));
    const offenders = TOOLS.filter(
      (t) => typeof (t as { title?: unknown }).title !== "string" || (t as { title: string }).title.trim().length === 0
    ).map((t) => t.name);
    expect(offenders, `wired tools missing a title: ${offenders.join(", ")}`).toEqual([]);

    const drifted = TOOLS.filter(
      (t) => (t as { title: string }).title !== titleByName.get(t.name)
    ).map((t) => t.name);
    expect(drifted, `wired tool title disagrees with registry title: ${drifted.join(", ")}`).toEqual([]);
  });

  it("sanity: covers all 38 registered tools (guards against an empty-import false pass)", () => {
    expect(TOOL_REGISTRY.length).toBeGreaterThan(20);
  });
});

describe("TOOL_GROUPS (core|scrapers|account|meta) is a TRUE partition of the full registry", () => {
  const registryNames = TOOL_REGISTRY.map((t) => t.name);

  it("every declared group name has at least one member (no empty/dead group)", () => {
    for (const g of TOOL_GROUPS) {
      expect(GROUP_TOOL_NAMES[g].length, `group "${g}" has zero members`).toBeGreaterThan(0);
    }
  });

  it("pairwise-disjoint AND union == the full registered-tool set — derived from GROUP_TOOL_NAMES/TOOL_REGISTRY, no hardcoded tool names", () => {
    const groupsAsRecord: Record<string, readonly string[]> = Object.fromEntries(
      TOOL_GROUPS.map((g) => [g, GROUP_TOOL_NAMES[g]])
    );
    const { missing, duplicates, extra } = partitionCheck(groupsAsRecord, registryNames);
    expect(missing, `tool(s) not assigned to ANY group (would silently be excluded from every group filter): ${missing.join(", ")}`).toEqual([]);
    expect(duplicates, `tool(s) assigned to MORE THAN ONE group (ToolMeta.group is meant to be exactly one): ${duplicates.join(", ")}`).toEqual([]);
    expect(extra, `group member(s) referencing a tool name not in TOOL_REGISTRY at all (ghost/typo): ${extra.join(", ")}`).toEqual([]);
  });

  it("every TOOL_REGISTRY row's own `group` field matches GROUP_TOOL_NAMES membership (single-field ToolMeta.group is internally consistent with the derived table)", () => {
    const offenders = TOOL_REGISTRY.filter(
      (t) => !GROUP_TOOL_NAMES[t.group as ToolGroup]?.includes(t.name)
    ).map((t) => `${t.name} (group=${t.group})`);
    expect(offenders, `registry row .group disagrees with derived GROUP_TOOL_NAMES: ${offenders.join(", ")}`).toEqual([]);
  });

  it("group sizes sum to the full registry length (38)", () => {
    const sum = TOOL_GROUPS.reduce((acc, g) => acc + GROUP_TOOL_NAMES[g].length, 0);
    expect(sum).toBe(TOOL_REGISTRY.length);
  });
});

describe("default tools/list (no NOVADA_TOOLS/NOVADA_GROUPS filter) returns all registered tools", () => {
  it("TOOLS (the unfiltered ListTools surface) has exactly REGISTERED_TOOL_NAMES.size entries — same set, no omission, no ghost", () => {
    expect(TOOLS.length).toBe(REGISTERED_TOOL_NAMES.size);
    const wiredNames = new Set(TOOLS.map((t) => t.name));
    for (const name of REGISTERED_TOOL_NAMES) {
      expect(wiredNames.has(name), `registered tool "${name}" is missing from the default (unfiltered) TOOLS surface`).toBe(true);
    }
    for (const name of wiredNames) {
      expect(REGISTERED_TOOL_NAMES.has(name), `TOOLS contains "${name}" which is not a registered tool`).toBe(true);
    }
  });
});
