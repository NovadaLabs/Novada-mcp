/**
 * H1 (S1-connector round 2, independent review): `?groups=browser` must not
 * brick a connection. The `browser` TOOL_GROUPS key was deleted (mcp.ts) rather
 * than left empty — this file extracts and EXECUTES the real `resolveAllowedTools`
 * + `TOOL_GROUPS` (not reimplementations) and proves `?groups=browser` now takes
 * the SAME path any other unknown/typo'd group name already took: falls back to
 * the `core` group, exactly like `resolveAllowedTools`'s own documented
 * "matched nothing real -> fall back to core" rule. Mirror row: a real, still-
 * valid group (`?groups=proxy`) continues to resolve normally — the fix didn't
 * collaterally break group resolution.
 *
 * Runs on plain Node (`node --test`) — same "extract-and-execute the real
 * source" convention as the rest of this test dir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");
const VENDOR_PLATFORM_SCRAPERS = join(__dirname, "..", "vendor", "novada-mcp", "tools", "platform_scrapers.js");
const mcpSrc = readFileSync(MCP_TS, "utf8");
// TOOL_GROUPS.scrapers spreads PLATFORM_SCRAPER_TOOLS (imported at the top of
// mcp.ts) — supply the real, vendored array so the extracted TOOL_GROUPS object
// literal evaluates without a ReferenceError.
const { PLATFORM_SCRAPER_TOOLS } = await import(VENDOR_PLATFORM_SCRAPERS);

function sliceBetween(startAnchor, endAnchor, label) {
  const start = mcpSrc.indexOf(startAnchor);
  assert.ok(start !== -1, `anchor not found for ${label}: ${JSON.stringify(startAnchor)}`);
  const end = mcpSrc.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end !== -1, `end anchor not found for ${label}: ${JSON.stringify(endAnchor)}`);
  return mcpSrc.slice(start, end);
}

/** Extract and EXECUTE the real TOOL_GROUPS object literal (not a reimplementation). */
function extractToolGroups(PLATFORM_SCRAPER_TOOLS) {
  const SIG = "const TOOL_GROUPS: Record<string, string[]> = {";
  const code = sliceBetween(SIG, "\n};", "TOOL_GROUPS").replace(SIG, "const TOOL_GROUPS = {");
  return new Function("PLATFORM_SCRAPER_TOOLS", `${code}\n};\nreturn TOOL_GROUPS;`)(PLATFORM_SCRAPER_TOOLS);
}

/** Extract and EXECUTE the real resolveAllowedTools body (not a reimplementation). */
function extractResolveAllowedTools(TOOL_GROUPS, ALL_TOOL_NAMES) {
  const SIG = "function resolveAllowedTools(url: URL): Set<string> | null {";
  const code = sliceBetween(SIG, "\n}\n", "resolveAllowedTools")
    .replace(SIG, "return (url) => {")
    .replace(/new Set<string>\(/g, "new Set(");
  return new Function("TOOL_GROUPS", "ALL_TOOL_NAMES", `${code}\n};`)(TOOL_GROUPS, ALL_TOOL_NAMES);
}

const TOOL_GROUPS = extractToolGroups(PLATFORM_SCRAPER_TOOLS);
const resolveAllowedTools = extractResolveAllowedTools(TOOL_GROUPS, new Set());

test("TOOL_GROUPS has no 'browser' key (the real, executed object, not just the source text)", () => {
  assert.ok(!("browser" in TOOL_GROUPS), "TOOL_GROUPS.browser must be deleted, not an empty array");
});

test("?groups=browser falls back to the SAME core group an unknown/typo'd group name already falls back to", () => {
  const url = new URL("https://mcp.novada.com/mcp?groups=browser");
  const resolved = resolveAllowedTools(url);
  const expected = new Set([...TOOL_GROUPS["core"], "novada_setup"]);
  assert.deepEqual(resolved, expected, "?groups=browser must resolve identically to an unknown group name (fallback to core), not grant zero usable tools");
  assert.ok(!resolved.has("novada_browser") && !resolved.has("novada_browser_flow"), "the fallback set must not contain either browser tool");
});

test("?groups=totally-made-up-typo resolves identically to ?groups=browser (same unknown-group path, not special-cased)", () => {
  const browserResolved = resolveAllowedTools(new URL("https://mcp.novada.com/mcp?groups=browser"));
  const typoResolved = resolveAllowedTools(new URL("https://mcp.novada.com/mcp?groups=totally-made-up-typo"));
  assert.deepEqual(browserResolved, typoResolved, "?groups=browser must not be special-cased — it should behave exactly like any other unknown group name");
});

test("MIRROR: a real, still-valid group (?groups=proxy) resolves normally — the fix didn't collaterally break group resolution", () => {
  const url = new URL("https://mcp.novada.com/mcp?groups=proxy");
  const resolved = resolveAllowedTools(url);
  assert.deepEqual(resolved, new Set(["novada_setup", "novada_proxy"]));
});

test("MIRROR: no params at all still resolves to null (no filter — unaffected by the browser-group removal)", () => {
  const url = new URL("https://mcp.novada.com/mcp");
  assert.equal(resolveAllowedTools(url), null);
});
