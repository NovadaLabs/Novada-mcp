/**
 * server.json ↔ registry drift guard.
 *
 * NOV-audit-2026-07-21: the shipped server.json was found stale — hand-written
 * `version` (0.9.17 vs package.json's 0.9.30), only 11 tools listed, and it
 * still named REMOVED tools (`novada_unblock`, `novada_health`). server.json is
 * now DERIVED by `scripts/gen-server-json.mjs` (run automatically at the end of
 * the `build` npm script) — this test guards that the committed file actually
 * reflects that derivation and never drifts back to a hand-edited stale copy.
 *
 * Not-inert proof (performed manually, reverted before committing): temporarily
 * edited server.json's "version" to "0.0.0-stale" and re-ran this test — the
 * "server.json version matches package.json version" assertion below failed
 * with a clear mismatch message; restoring the real value (via
 * `npm run gen:server-json`) made the suite green again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../../src/core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8"));
const serverJson = JSON.parse(readFileSync(resolve(__dirname, "../../server.json"), "utf8"));

// Tool names that were REMOVED from the visible registry (TOW2-256) and must
// never reappear in server.json's tools[] — a stale generator or a hand-edit
// reintroducing one of these is exactly the bug this guard exists to catch.
const REMOVED_TOOL_NAMES = ["novada_unblock", "novada_health", "novada_health_all"];

describe("server.json stays in sync with package.json + the registry", () => {
  it("server.json version matches package.json version", () => {
    expect(
      serverJson.version,
      `server.json version (${serverJson.version}) drifted from package.json (${pkg.version}) — run 'npm run gen:server-json' (or 'npm run build')`
    ).toBe(pkg.version);
  });

  it("server.json packages[].version matches package.json version (registry install target)", () => {
    // code-review HIGH (2026-07-21): the generator synced top-level `version` but left
    // `packages[0].version` at the stale 0.9.17, telling registries to install the wrong
    // npm version. This guards that the two can never disagree again.
    for (const p of (serverJson.packages ?? []) as Array<{ version?: string; identifier?: string }>) {
      expect(
        p.version,
        `server.json packages[${p.identifier ?? "?"}].version (${p.version}) drifted from package.json (${pkg.version}) — run 'npm run gen:server-json'`
      ).toBe(pkg.version);
    }
  });

  it("server.json tool names exactly match the visible TOOLS registry (no ghosts, no omissions)", () => {
    const serverJsonNames = (serverJson.tools as Array<{ name: string }>).map((t) => t.name).sort();
    const registryNames = TOOLS.map((t) => t.name).sort();
    expect(serverJsonNames).toEqual(registryNames);
  });

  it("server.json never lists a removed tool name", () => {
    const serverJsonNames = new Set((serverJson.tools as Array<{ name: string }>).map((t) => t.name));
    const reintroduced = REMOVED_TOOL_NAMES.filter((n) => serverJsonNames.has(n));
    expect(
      reintroduced,
      `server.json lists removed tool(s) that no longer exist in the registry: ${reintroduced.join(", ")}`
    ).toEqual([]);
  });

  it("every server.json tool entry has a non-empty, single-line description", () => {
    for (const t of serverJson.tools as Array<{ name: string; description: string }>) {
      expect(t.description.trim().length, `${t.name} has an empty description in server.json`).toBeGreaterThan(0);
      expect(t.description, `${t.name}'s server.json description contains a raw newline`).not.toMatch(/\n/);
    }
  });
});
