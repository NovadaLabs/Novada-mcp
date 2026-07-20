/**
 * Hosted tool-catalog core-derivation (2026-07-20 Option A refactor).
 *
 * hosted-server/vercel/api/mcp.ts no longer hand-curates a 15-tool `TOOLS` literal —
 * it now builds `const TOOLS = CORE_TOOLS.map(...)` from npm-package's core.ts `TOOLS`
 * (imported as `CORE_TOOLS`), so every npm-registered tool (including the 15
 * novada_scrape_<platform> tools) is visible on hosted by default, with `HOSTED_HIDDEN`
 * as the one deliberate exclusion list. This suite proves that refactor didn't regress
 * anything, mirroring the existing STATIC-analysis style this test dir already uses for
 * mcp.ts (see truthful-self-report.test.mjs, paid-tier-cap.test.mjs's "Layer 3: STATIC"):
 * mcp.ts itself is never imported (module-load side effects: Sentry.init, @vercel/kv,
 * env-var stripping — see check-hosted-drift.mjs's header for the full rationale), so
 * this file combines (1) a real, side-effect-free import of the vendored core.js (same
 * module scripts/deploy-hosted.sh's own smoke-test imports) with (2) text-parsing of
 * mcp.ts's source for the pieces that only exist in that file (HOSTED_HIDDEN, TOOL_GROUPS,
 * the derivation markers).
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

const mcpSrc = readFileSync(MCP_TS, "utf8");
const { TOOLS: CORE_TOOLS, HIDDEN_ALIASES: NPM_HIDDEN_ALIASES } = await import(VENDOR_CORE);
const CORE_TOOL_NAMES = new Set(CORE_TOOLS.map((t) => t.name));

/** Slice mcpSrc between two anchors (throws loudly if either is missing — same
 *  fail-loud contract scripts/check-hosted-drift.mjs uses for the same reason). */
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

const toolGroupsSlice = sliceBetween("const TOOL_GROUPS: Record<string, string[]> = {", "\n};", "TOOL_GROUPS");

/** Extract one named group's array contents from the TOOL_GROUPS slice, e.g. "ecommerce". */
function groupNames(groupKey) {
  const re = new RegExp(`\\b${groupKey}:\\s*\\[([^\\]]*)\\]`);
  const m = toolGroupsSlice.match(re);
  assert.ok(m, `TOOL_GROUPS.${groupKey} not found in mcp.ts`);
  return namesIn(m[1]);
}

const PLATFORM_SCRAPER_NAMES = [...CORE_TOOL_NAMES].filter((n) => /^novada_scrape_[a-z0-9]+$/.test(n));

// ─── (a) core-derivation markers present (not reverted to a hand-curated literal) ──

test("mcp.ts: TOOLS is imported from core as CORE_TOOLS (single source of truth)", () => {
  assert.match(mcpSrc, /TOOLS\s+as\s+CORE_TOOLS/, "mcp.ts must import core's TOOLS as CORE_TOOLS");
});

test("mcp.ts: hosted TOOLS is built via CORE_TOOLS.map(...), not a hand-curated literal", () => {
  assert.match(mcpSrc, /const TOOLS = CORE_TOOLS\.map\(/, "TOOLS must be derived from CORE_TOOLS");
});

// ─── (b) ListTools default surface includes all 15 platform-scraper tools ─────────

test("core.js: platform-scraper family has exactly 15 tools (novada_scrape_<platform>)", () => {
  // Bump this count when a 16th platform config is added (mirrors the eval harness's
  // own exact-count fixtures, e.g. eval-tasks.json's tasks.length===25 assertion).
  assert.equal(PLATFORM_SCRAPER_NAMES.length, 15, `expected 15 platform scrapers, found: ${PLATFORM_SCRAPER_NAMES.join(", ")}`);
});

test("hosted default surface: none of the 15 platform-scraper tools are in HOSTED_HIDDEN", () => {
  const hiddenScrapers = PLATFORM_SCRAPER_NAMES.filter((n) => HOSTED_HIDDEN.has(n));
  assert.deepEqual(hiddenScrapers, [], "platform-scraper tools must be visible by default (not in HOSTED_HIDDEN)");
});

test("hosted default surface: every platform-scraper tool is a real CORE_TOOLS entry (no ghost name)", () => {
  for (const name of PLATFORM_SCRAPER_NAMES) {
    assert.ok(CORE_TOOL_NAMES.has(name), `${name} must be in core's TOOLS`);
  }
});

// ─── (c) ?groups=ecommerce returns exactly {amazon, walmart, shein} ───────────────

test("TOOL_GROUPS.ecommerce is exactly {amazon, walmart, shein}", () => {
  const ecommerce = groupNames("ecommerce");
  assert.deepEqual(
    [...ecommerce].sort(),
    ["novada_scrape_amazon", "novada_scrape_shein", "novada_scrape_walmart"].sort(),
  );
});

test("every TOOL_GROUPS member across every group is a real CORE_TOOLS entry (no typo'd group name)", () => {
  const allGroupNames = namesIn(toolGroupsSlice);
  const ghosts = allGroupNames.filter((n) => !CORE_TOOL_NAMES.has(n));
  assert.deepEqual(ghosts, [], `TOOL_GROUPS references tool name(s) not in core's TOOLS: ${ghosts.join(", ")}`);
});

test("new BD-style groups (ecommerce/social/dev/ai) are present and non-empty", () => {
  for (const g of ["ecommerce", "social", "dev", "ai"]) {
    const names = groupNames(g);
    assert.ok(names.length > 0, `TOOL_GROUPS.${g} must not be empty`);
  }
});

// ─── (d) a HOSTED_HIDDEN tool is still hidden — and never leaks through a group ───

test("HOSTED_HIDDEN still hides novada_site_copy (never-ported: writes to read-only serverless FS)", () => {
  assert.ok(HOSTED_HIDDEN.has("novada_site_copy"), "novada_site_copy must stay in HOSTED_HIDDEN");
});

// Pre-existing (predates this refactor, not introduced by it): the `browser` group has
// always listed novada_browser_flow alongside novada_browser, even though browser_flow is
// hidden and structurally unreachable on hosted (HOSTED_HIDDEN filters it out of
// visibleTools, and it isn't in HOSTED_ROUTABLE_ALIASES either, so a direct call is
// refused with the generic TOOL_NOT_ENABLED message). Harmless — the group listing it
// doesn't make it reachable — but tracked here explicitly so it isn't silently
// rediscovered as "new" drift; not fixed by this diff since group CONTENTS for the
// existing groups were intentionally left untouched (only new groups were added).
const KNOWN_HOSTED_HIDDEN_IN_GROUP_EXCEPTIONS = new Set(["novada_browser_flow"]);

test("no HOSTED_HIDDEN tool is reachable through any TOOL_GROUPS entry (except the documented pre-existing exception)", () => {
  const allGroupNames = new Set(namesIn(toolGroupsSlice));
  const leaked = [...HOSTED_HIDDEN].filter(
    (n) => allGroupNames.has(n) && !KNOWN_HOSTED_HIDDEN_IN_GROUP_EXCEPTIONS.has(n),
  );
  assert.deepEqual(leaked, [], `HOSTED_HIDDEN tool(s) must not appear in any TOOL_GROUPS array: ${leaked.join(", ")}`);
});

test("the new BD-style groups (ecommerce/social/dev/ai) specifically contain zero HOSTED_HIDDEN tools", () => {
  for (const g of ["ecommerce", "social", "dev", "ai"]) {
    const leaked = groupNames(g).filter((n) => HOSTED_HIDDEN.has(n));
    assert.deepEqual(leaked, [], `TOOL_GROUPS.${g} must not reference any HOSTED_HIDDEN tool: ${leaked.join(", ")}`);
  }
});

// ─── (e) calling novada_scrape_amazon by name is NOT rejected by the tool-set filter ─

test("novada_scrape_amazon: real core tool, not hidden, reachable via ?groups=ecommerce — so neither the " +
     "?tools=/?groups= filter guard nor the HOSTED_HIDDEN visibility guard rejects a direct call to it", () => {
  assert.ok(CORE_TOOL_NAMES.has("novada_scrape_amazon"), "must be a real, dispatchable core tool");
  assert.ok(!HOSTED_HIDDEN.has("novada_scrape_amazon"), "must not be in HOSTED_HIDDEN");
  assert.ok(groupNames("ecommerce").includes("novada_scrape_amazon"), "must be reachable via ?groups=ecommerce");
});

// ─── (f) FIX 1 regression: novada_verify (alias-routable-but-hidden) direct-call ──────
//
// Root cause this guards against: HOSTED_HIDDEN_ALIASES was computed as
//   `visible = new Set(TOOLS.map(t => t.name))` (raw, UNFILTERED TOOLS — the full
//   38-tool core catalog) then `HOSTED_ROUTABLE_ALIASES.filter(n => !visible.has(n) && ...)`.
// Because novada_verify is BOTH a real core tool (so `visible.has("novada_verify")` was
// true) AND in HOSTED_ROUTABLE_ALIASES (the fail-safe allowlist that's supposed to keep it
// dispatchable), it was wrongly excluded from HOSTED_HIDDEN_ALIASES — so a direct
// CallTool("novada_verify") fell through to the "hidden/unwired-on-hosted" guard
// (`!visibleToolNames.has(name) && !HOSTED_HIDDEN_ALIASES.has(name)`) and was rejected
// with TOOL_NOT_ENABLED, even though novada_verify was never meant to be unreachable.
//
// This suite EXECUTES the real `listedOnHosted` / `HOSTED_HIDDEN_ALIASES` computation
// extracted straight from mcp.ts (not a hand-reimplementation) against real
// TOOLS/HOSTED_HIDDEN/HOSTED_ROUTABLE_ALIASES data, so a future revert of the computation
// itself — not just a change to its input data — fails this test loudly.

const hostedRoutableAliasesSlice = sliceBetween(
  "const HOSTED_ROUTABLE_ALIASES = new Set<string>([",
  "\n]);",
  "HOSTED_ROUTABLE_ALIASES",
);
// The block spreads `...NPM_HIDDEN_ALIASES` (not a quoted string, so namesIn() skips it)
// plus literal additions (today: just "novada_verify") — reconstruct the real runtime
// Set the exact same way mcp.ts builds it.
const HOSTED_ROUTABLE_ALIASES = new Set([...NPM_HIDDEN_ALIASES, ...namesIn(hostedRoutableAliasesSlice)]);

/**
 * Extract and EXECUTE mcp.ts's real `listedOnHosted` / `HOSTED_HIDDEN_ALIASES`
 * computation (not a reimplementation) against the given real TOOLS/HOSTED_HIDDEN/
 * HOSTED_ROUTABLE_ALIASES data, returning the resulting HOSTED_HIDDEN_ALIASES Set.
 * Strips the one TS-only annotation (`: ReadonlySet<string>`) so a plain `Function`
 * can evaluate it — same "text-parse, don't import mcp.ts" constraint as the rest of
 * this file (module-load side effects: Sentry.init, @vercel/kv, env stripping).
 */
function computeHostedHiddenAliasesFromSource(tools, hostedHidden, hostedRoutableAliases) {
  const code = sliceBetween(
    "const listedOnHosted = new Set(",
    "\n\n// ─── Tool-set filtering",
    "listedOnHosted / HOSTED_HIDDEN_ALIASES computation",
  ).replace(/:\s*ReadonlySet<string>/, "");
  const fn = new Function("TOOLS", "HOSTED_HIDDEN", "HOSTED_ROUTABLE_ALIASES", `${code}\nreturn HOSTED_HIDDEN_ALIASES;`);
  return fn(tools, hostedHidden, hostedRoutableAliases);
}

const executedHostedHiddenAliases = computeHostedHiddenAliasesFromSource(CORE_TOOLS, HOSTED_HIDDEN, HOSTED_ROUTABLE_ALIASES);

test("FIX 1: mcp.ts's REAL (executed) HOSTED_HIDDEN_ALIASES computation includes novada_verify", () => {
  assert.ok(
    executedHostedHiddenAliases.has("novada_verify"),
    "novada_verify must be in HOSTED_HIDDEN_ALIASES — otherwise a direct CallTool('novada_verify') is " +
    "wrongly rejected with TOOL_NOT_ENABLED (this exact regression: novada_verify is both a real core " +
    "tool and HOSTED_HIDDEN, so filtering against raw/unfiltered TOOLS wrongly concluded it was " +
    "'already visible' and dropped it from this allowlist).",
  );
});

test("FIX 1: a direct CallTool('novada_verify') is NOT rejected by the tool-set/hidden guard (full behavioral replay)", () => {
  // Replays the exact guard mcp.ts's CallTool handler applies for a hidden-from-listing tool:
  //   if (!visibleToolNames.has(name) && !HOSTED_HIDDEN_ALIASES.has(name)) { ... TOOL_NOT_ENABLED ... }
  // visibleToolNames (no ?tools=/?groups= filter, isHosted=true) = TOOLS minus HOSTED_HIDDEN.
  const visibleToolNames = new Set([...CORE_TOOL_NAMES].filter((n) => !HOSTED_HIDDEN.has(n)));
  const name = "novada_verify";
  assert.ok(!visibleToolNames.has(name), "novada_verify must be absent from the default ListTools output (HOSTED_HIDDEN)");
  const rejected = !visibleToolNames.has(name) && !executedHostedHiddenAliases.has(name);
  assert.equal(rejected, false, "a direct CallTool('novada_verify') must NOT be rejected by the tool-set/hidden guard");
});

// ─── (g) FIX 4 regression: deriveTitle brand capitalization ──────────────────────────
//
// Root cause this guards against: deriveTitle plain-Titlecased every underscore-split
// word, so "novada_scrape_duckduckgo" -> "Scrape Duckduckgo" instead of "Scrape
// DuckDuckGo" (same bug class for youtube/github/linkedin/tiktok). This suite EXTRACTS
// and EXECUTES the real TITLE_BRAND_MAP + deriveTitle straight from mcp.ts (not a
// reimplementation), so a future revert of the brand map fails this test loudly.

/** Extract and EXECUTE mcp.ts's real TITLE_BRAND_MAP + deriveTitle (not a reimplementation). */
function extractDeriveTitle() {
  const code = sliceBetween(
    "const TITLE_BRAND_MAP: Record<string, string> = {",
    "\n\nconst TOOLS = CORE_TOOLS.map(",
    "TITLE_BRAND_MAP / deriveTitle",
  )
    .replace(/:\s*Record<string,\s*string>/, "")
    .replace(/function deriveTitle\(name:\s*string\):\s*string/, "function deriveTitle(name)");
  const fn = new Function(`${code}\nreturn deriveTitle;`);
  return fn();
}

const deriveTitle = extractDeriveTitle();

test("FIX 4: deriveTitle brands duckduckgo/youtube/github/linkedin/tiktok correctly (not plain Titlecase)", () => {
  assert.equal(deriveTitle("novada_scrape_duckduckgo"), "Scrape DuckDuckGo");
  assert.equal(deriveTitle("novada_scrape_youtube"), "Scrape YouTube");
  assert.equal(deriveTitle("novada_scrape_github"), "Scrape GitHub");
  assert.equal(deriveTitle("novada_scrape_linkedin"), "Scrape LinkedIn");
  assert.equal(deriveTitle("novada_scrape_tiktok"), "Scrape TikTok");
});

test("FIX 4: deriveTitle produces a 'Scrape <Brand>' title for every real platform-scraper tool", () => {
  for (const name of PLATFORM_SCRAPER_NAMES) {
    const title = deriveTitle(name);
    assert.ok(title.startsWith("Scrape "), `${name} title must start with "Scrape ": got "${title}"`);
  }
});
