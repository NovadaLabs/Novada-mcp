/**
 * novada_discover — ledger display + billing note (C-7/G-10 audit, W-B4).
 *
 * Asserts the Ledger/Cost columns render for every registered tool, the
 * "which ledger funds what" note is present, and the "cost is not reported"
 * admission is never silenced for a billable tool.
 */
import { describe, it, expect } from "vitest";
import { novadaDiscover, validateDiscoverParams } from "../../src/tools/discover.js";
import { TOOL_REGISTRY, TOOL_LEDGERS, LEDGER_EXPLAINER } from "../../src/tools/registry.js";

const COST_NOT_REPORTED_LITERAL = "not reported (backend ③)";

/**
 * Row shape is `| \`name\` | <description, may itself contain "|"> | <ledger> |
 * <cost> | <status> |`. novada_proxy's own description literally contains "|"
 * characters ("type=residential|isp|datacenter|..."), so a naive pipe-split or
 * a non-anchored regex would misparse that row's later columns. This parser
 * anchors on the FIXED, small-vocabulary tail (ledger/cost/status), which
 * greedy `.*` correctly backtracks onto regardless of how much "|" noise sits
 * in the free-text description in between.
 */
function parseToolRows(markdown: string): Array<{ name: string; ledger: string; cost: string }> {
  const ROW_RE = /^\|\s*`(novada_[a-z_]+)`\s*\|.*\|\s*(wallet|capture|mixed|none|unset)\s*\|\s*(free|not reported \(backend ③\))\s*\|\s*(?:✅ active|🔜 todo)\s*\|$/;
  const rows: Array<{ name: string; ledger: string; cost: string }> = [];
  for (const line of markdown.split("\n")) {
    const m = ROW_RE.exec(line.trim());
    if (m) rows.push({ name: m[1], ledger: m[2], cost: m[3] });
  }
  return rows;
}

describe("parseToolRows self-check: correctly parses a row whose description contains '|' (novada_proxy shape)", () => {
  it("does not misattribute a mid-description pipe as the ledger column", () => {
    const fakeRow = "| `novada_fake` | desc with a|pipe|inside type=a|b|c | capture | not reported (backend ③) | ✅ active |";
    const rows = parseToolRows(fakeRow);
    expect(rows).toEqual([{ name: "novada_fake", ledger: "capture", cost: "not reported (backend ③)" }]);
  });
});

describe("novadaDiscover — Ledger column covers all 38 tools", () => {
  it("renders exactly one row per active registered tool, and none say 'unset'", async () => {
    const out = await novadaDiscover(validateDiscoverParams({}));
    const rows = parseToolRows(out);
    expect(rows.length).toBeGreaterThan(0);

    const activeNames = TOOL_REGISTRY.filter((t) => t.status === "active").map((t) => t.name).sort();
    expect(TOOL_REGISTRY.length).toBe(38);
    expect(activeNames.length).toBe(38); // every registered tool is active today

    const renderedNames = [...new Set(rows.map((r) => r.name))].sort();
    expect(renderedNames, "discover must render every active registered tool exactly once").toEqual(activeNames);

    const ledgerByName = new Map(TOOL_REGISTRY.map((t) => [t.name, t.ledger]));
    for (const row of rows) {
      expect(row.ledger, `${row.name} rendered "unset" — a registry row shipped with no ledger`).not.toBe("unset");
      expect(TOOL_LEDGERS as readonly string[], `${row.name} rendered an unknown ledger value: ${row.ledger}`).toContain(row.ledger);
      expect(row.ledger, `${row.name}'s rendered ledger disagrees with its registry row`).toBe(ledgerByName.get(row.name));
    }
  });

  it("category filter still shows the Ledger column for that category's tools", async () => {
    const out = await novadaDiscover(validateDiscoverParams({ category: "Proxy" }));
    expect(out).toContain("| Tool | Description | Ledger | Cost | Status |");
    const rows = parseToolRows(out);
    expect(rows).toEqual([{ name: "novada_proxy", ledger: "wallet", cost: COST_NOT_REPORTED_LITERAL }]);
  });
});

describe("novadaDiscover — Cost column never silences 'not reported' for billable tools", () => {
  it("every non-'none'-ledger tool's Cost cell reads the literal not-reported string", async () => {
    const out = await novadaDiscover(validateDiscoverParams({}));
    const rows = parseToolRows(out);
    const billableRows = rows.filter((r) => r.ledger !== "none");
    expect(billableRows.length).toBeGreaterThan(0);
    for (const row of billableRows) {
      expect(row.cost, `${row.name} (ledger=${row.ledger}) must show the not-reported cost string, never silence it`).toBe(
        COST_NOT_REPORTED_LITERAL,
      );
    }
  });

  it("free ('none'-ledger) tools are labeled 'free', not the not-reported string", async () => {
    const out = await novadaDiscover(validateDiscoverParams({}));
    const rows = parseToolRows(out);
    const freeRows = rows.filter((r) => r.ledger === "none");
    expect(freeRows.length).toBeGreaterThan(0);
    for (const row of freeRows) {
      expect(row.cost).toBe("free");
    }
  });
});

describe("novadaDiscover — '## Billing' section: which-ledger-funds-what note", () => {
  it("renders a Billing section with one bullet per ToolLedger value and non-empty explainer copy", async () => {
    const out = await novadaDiscover(validateDiscoverParams({}));
    expect(out).toContain("## Billing");
    for (const l of TOOL_LEDGERS) {
      expect(out, `Billing section must mention ledger "${l}"`).toContain(`**${l}**`);
      // The explainer copy itself (or at least a meaningful prefix) must be present,
      // not just the bucket name — proves the note isn't a stub.
      const firstSentence = LEDGER_EXPLAINER[l].split(" — ")[0] ?? LEDGER_EXPLAINER[l].slice(0, 20);
      expect(out).toContain(firstSentence);
    }
  });

  it("points the agent at novada_account for real balances", async () => {
    const out = await novadaDiscover(validateDiscoverParams({}));
    expect(out).toContain("novada_account");
    expect(out).toMatch(/section="balance"/);
    expect(out).toMatch(/section="plans"/);
  });
});
