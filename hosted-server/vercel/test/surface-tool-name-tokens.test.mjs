/**
 * Round 4 (S1-connector, F1 — CLASS fix, independent judge 2026-10-13).
 *
 * Hosted-side mirror of npm-package's tests/consistency/surface-tool-name-tokens.test.ts —
 * same mechanical rule (every /novada_[a-z_]+/-shaped token in any description or param
 * description must name a tool actually listed on THIS surface, STRICT — no hidden-alias
 * exception), evaluated against HOSTED's own derived tool list instead of npm's.
 *
 * mcp.ts itself is never imported (module-load side effects: Sentry.init, @vercel/kv,
 * env-var stripping — see tool-catalog-derivation.test.mjs's header for the full
 * rationale, and check-hosted-drift.mjs). Instead this file:
 *   1. Does a REAL, side-effect-free import of the vendored core.js (TOOLS as
 *      CORE_TOOLS, buildToolsForSurface, HIDDEN_ALIASES as NPM_HIDDEN_ALIASES, and
 *      extractToolNameTokens from the vendored _core/description_surface.js) — the
 *      SAME module scripts/deploy-hosted.sh's own smoke-test imports.
 *   2. Text-parses mcp.ts's source ONLY for HOSTED_HIDDEN (the one hosted-specific
 *      policy that doesn't exist in core.js), reusing the exact same sliceBetween/
 *      namesIn helpers tool-catalog-derivation.test.mjs already established.
 *   3. Reproduces hosted's REAL TOOLS computation — HOSTED_AVAILABLE_FOR_SIBLING_
 *      MENTIONS = CORE_TOOLS names minus HOSTED_HIDDEN, then
 *      buildToolsForSurface(HOSTED_AVAILABLE_FOR_SIBLING_MENTIONS) — using the ACTUAL
 *      exported function (not a reimplementation), so a future change to
 *      buildToolsForSurface's own logic is exercised here too, not just on npm's side.
 *
 * Runs on plain Node ≥22.18 (`node --test`) — same runtime as the rest of this dir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");
const VENDOR_CORE = join(__dirname, "..", "vendor", "novada-mcp", "core.js");
const VENDOR_DESCRIPTION_SURFACE = join(__dirname, "..", "vendor", "novada-mcp", "_core", "description_surface.js");

const mcpSrc = readFileSync(MCP_TS, "utf8");
const { TOOLS: CORE_TOOLS, buildToolsForSurface, HIDDEN_ALIASES: NPM_HIDDEN_ALIASES } = await import(VENDOR_CORE);
const { extractToolNameTokens } = await import(VENDOR_DESCRIPTION_SURFACE);

/** Slice mcpSrc between two anchors (throws loudly if either is missing). */
function sliceBetween(startAnchor, endAnchor, label) {
  const start = mcpSrc.indexOf(startAnchor);
  assert.ok(start !== -1, `anchor not found for ${label}: ${JSON.stringify(startAnchor)}`);
  const end = mcpSrc.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end !== -1, `end anchor not found for ${label}: ${JSON.stringify(endAnchor)}`);
  return mcpSrc.slice(start, end);
}

function namesIn(slice) {
  return [...slice.matchAll(/"(novada_[a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
}

const hostedHiddenSlice = sliceBetween("const HOSTED_HIDDEN = new Set([", "]);", "HOSTED_HIDDEN");
const HOSTED_HIDDEN = new Set(namesIn(hostedHiddenSlice));

// ─── Reproduce hosted's REAL TOOLS computation (not a copy of mcp.ts's output —
// the actual exported buildToolsForSurface, called the same way mcp.ts calls it) ──
const HOSTED_AVAILABLE_FOR_SIBLING_MENTIONS = new Set(
  CORE_TOOLS.map((t) => t.name).filter((n) => !HOSTED_HIDDEN.has(n)),
);
const CORE_TOOLS_FOR_HOSTED = buildToolsForSurface(HOSTED_AVAILABLE_FOR_SIBLING_MENTIONS);
// listedOnHosted mirrors mcp.ts's own `const listedOnHosted = ...TOOLS.filter((t) =>
// !HOSTED_HIDDEN.has(t.name))...` — the set an examiner's ListTools call would
// actually see (CORE_TOOLS_FOR_HOSTED still includes every tool buildToolsForSurface
// was asked to render FOR, but hosted's own mcp.ts additionally omits HOSTED_HIDDEN
// tools from what it returns to ListTools, even though their description was computed).
const LISTED_ON_HOSTED = CORE_TOOLS_FOR_HOSTED.filter((t) => !HOSTED_HIDDEN.has(t.name));
const LISTED_ON_HOSTED_NAMES = new Set(LISTED_ON_HOSTED.map((t) => t.name));

/**
 * Mirrors npm-side's ALLOWLISTED_NON_TOOL_TOKENS exactly — the literal template
 * placeholder "novada_scrape_<platform>" (regex stops at the trailing underscore,
 * since "<" is not a word character), not a concrete tool-name claim.
 */
const ALLOWLISTED_NON_TOOL_TOKENS = new Set(["novada_scrape_"]);

function tokensForTool(t) {
  const blob = `${t.description}\n${JSON.stringify(t.inputSchema)}`;
  return [...new Set(extractToolNameTokens(blob))];
}

function assertNoGhostTokens(label, tokens, registered) {
  const ghosts = tokens.filter((tok) => !registered.has(tok) && !ALLOWLISTED_NON_TOOL_TOKENS.has(tok));
  assert.deepEqual(
    ghosts,
    [],
    `${label} names tool(s) NOT in hosted's own listed-tool set (ghost reference): ${ghosts.join(", ")}`,
  );
}

// ─── Sanity ────────────────────────────────────────────────────────────────────

test("sanity: HOSTED_HIDDEN is non-empty and LISTED_ON_HOSTED is strictly smaller than CORE_TOOLS (hosted really does hide something)", () => {
  assert.ok(HOSTED_HIDDEN.size > 0);
  assert.ok(LISTED_ON_HOSTED_NAMES.size < CORE_TOOLS.length);
  assert.equal(LISTED_ON_HOSTED_NAMES.size, CORE_TOOLS.length - HOSTED_HIDDEN.size);
});

test("sanity: NPM_HIDDEN_ALIASES shares no names with LISTED_ON_HOSTED (an npm-hidden alias must never accidentally be hosted-visible either)", () => {
  for (const alias of NPM_HIDDEN_ALIASES) {
    assert.equal(LISTED_ON_HOSTED_NAMES.has(alias), false, `${alias} (an npm HIDDEN_ALIAS) is listed on hosted`);
  }
});

// ─── Per-tool token check — every hosted-LISTED tool's rendered description ───────

for (const t of LISTED_ON_HOSTED) {
  test(`hosted "${t.name}" description + param descriptions reference only hosted-LISTED tools (no alias exception)`, () => {
    const tokens = tokensForTool(t);
    assertNoGhostTokens(`hosted mcp.novada.com tool "${t.name}"`, tokens, LISTED_ON_HOSTED_NAMES);
  });
}

// ─── Not-inert proofs ──────────────────────────────────────────────────────────

test("not-inert proof: a HOSTED_HIDDEN tool name (novada_site_copy) planted in a description IS caught on hosted's surface", () => {
  const tokens = tokensForTool({ description: "Use novada_site_copy for this.", inputSchema: {} });
  const ghosts = tokens.filter((tok) => !LISTED_ON_HOSTED_NAMES.has(tok) && !ALLOWLISTED_NON_TOOL_TOKENS.has(tok));
  assert.ok(ghosts.includes("novada_site_copy"), "novada_site_copy must be flagged as a ghost on hosted (it is HOSTED_HIDDEN)");
});

test("not-inert proof: an NPM_HIDDEN_ALIASES name (e.g. the first entry) is caught on hosted's surface too", () => {
  const alias = [...NPM_HIDDEN_ALIASES][0];
  const tokens = tokensForTool({ description: `Call ${alias} for legacy behavior.`, inputSchema: {} });
  const ghosts = tokens.filter((tok) => !LISTED_ON_HOSTED_NAMES.has(tok) && !ALLOWLISTED_NON_TOOL_TOKENS.has(tok));
  assert.ok(ghosts.includes(alias), `${alias} must be flagged as a ghost on hosted`);
});

// ─── Mirror: hosted's crawl/map descriptions must NOT mention novada_site_copy ───
// (the exact original F1 defect — novada_site_copy is HOSTED_HIDDEN, so the
// {{sibling:}} span must resolve to STRIPPED on this surface, unlike npm's.)

test("mirror: hosted's novada_crawl description does NOT contain novada_site_copy (hosted hides it)", () => {
  const crawl = LISTED_ON_HOSTED.find((t) => t.name === "novada_crawl");
  assert.ok(crawl, "novada_crawl must be listed on hosted");
  assert.ok(!crawl.description.includes("novada_site_copy"), `hosted novada_crawl description still mentions novada_site_copy:\n${crawl.description}`);
  // And the stripped sentence must read cleanly (no leftover "()" / dangling comma).
  assert.doesNotMatch(crawl.description, /\(\s*\)/);
  assert.doesNotMatch(crawl.description, /,\s*\)/);
  assert.doesNotMatch(crawl.description, / {2,}/);
});

test("mirror: hosted's novada_map description does NOT contain novada_site_copy (hosted hides it)", () => {
  const map = LISTED_ON_HOSTED.find((t) => t.name === "novada_map");
  assert.ok(map, "novada_map must be listed on hosted");
  assert.ok(!map.description.includes("novada_site_copy"), `hosted novada_map description still mentions novada_site_copy:\n${map.description}`);
});

test("hosted's novada_scrape generic-tool example never names a platform with zero working operations as usable (the original F1 ChatGPT defect)", () => {
  const scrape = LISTED_ON_HOSTED.find((t) => t.name === "novada_scrape");
  assert.ok(scrape, "novada_scrape must be listed on hosted");
  assert.doesNotMatch(scrape.description, /no dedicated sibling.*chatgpt/is);
});

// ─── Round 4b (F-review "Round-4 review" error-path gap): {{sibling:}} leak guard ──
// Mirrors npm-package's scrape-description-platform-derivation.test.ts's own guard —
// no rendered description on HOSTED's surface may contain a literal "{{" (the only
// way that could happen is a malformed/unclosed {{sibling:...}} span surviving
// buildToolsForSurface, or a new markup convention renderDescriptionForSurface
// doesn't know about — either way, a real leak to a real client).

test("no rendered description on hosted's surface contains a literal '{{' (unclosed/malformed {{sibling:}} markup would leak through otherwise)", () => {
  for (const t of LISTED_ON_HOSTED) {
    assert.ok(!t.description.includes("{{"), `${t.name} description contains a literal '{{' after hosted rendering:\n${t.description}`);
  }
});

test("CORE_TOOLS_FOR_HOSTED (every tool buildToolsForSurface rendered FOR, including HOSTED_HIDDEN ones) also carries no literal '{{' — the render, not just the final listed subset, is clean", () => {
  for (const t of CORE_TOOLS_FOR_HOSTED) {
    assert.ok(!t.description.includes("{{"), `${t.name} description contains a literal '{{' in CORE_TOOLS_FOR_HOSTED:\n${t.description}`);
  }
});
