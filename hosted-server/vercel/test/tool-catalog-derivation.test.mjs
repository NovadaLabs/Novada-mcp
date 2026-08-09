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

/**
 * Extract and EXECUTE mcp.ts's real HOSTED_NEVER_ROUTABLE_NPM_ALIASES +
 * HOSTED_ROUTABLE_ALIASES expressions (not a reimplementation) against the given
 * NPM_HIDDEN_ALIASES input. Mirrors test/hosted-hidden-fail-closed.test.mjs's helper
 * of the same name.
 *
 * This file used to reconstruct HOSTED_ROUTABLE_ALIASES by hand as
 * `new Set([...NPM_HIDDEN_ALIASES, ...namesIn(hostedRoutableAliasesSlice)])` — the
 * UNFILTERED, pre-fix spread that omits the HOSTED_NEVER_ROUTABLE_NPM_ALIASES filter
 * mcp.ts actually applies (see hosted-hidden-fail-closed.test.mjs's part (d) tests for
 * the regression that filter guards against: novada_scraper_task_mgmt leaking through
 * as routable, canary run 31300731838 / TOW2-349). That hand reconstruction only
 * avoided a false-pass here because this file's own assertions never probed
 * novada_scraper_task_mgmt — extract-and-execute keeps this file's
 * HOSTED_ROUTABLE_ALIASES in lockstep with production even if the filter expression
 * changes again.
 */
function computeHostedRoutableAliasesFromSource(npmHiddenAliases) {
  const code = sliceBetween(
    "const HOSTED_NEVER_ROUTABLE_NPM_ALIASES = new Set(",
    "\n]);",
    "HOSTED_ROUTABLE_ALIASES",
  ).replace("Set<string>", "Set");
  const fn = new Function(
    "NPM_HIDDEN_ALIASES",
    `${code}\n]);\nreturn HOSTED_ROUTABLE_ALIASES;`,
  );
  return fn(npmHiddenAliases);
}

const HOSTED_ROUTABLE_ALIASES = computeHostedRoutableAliasesFromSource(NPM_HIDDEN_ALIASES);

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

// ─── (h) C3 fix (2026-07-20, synthesis.md): hosted "30-tool" count guard ──────────────
//
// The "38 tools" / "30 tools" headline is hand-typed in ~6 files across both packages
// (see npm-package's tests/tools/discover.test.ts for the npm-side README/SKILL guards).
// hosted-server/vercel/README.md's "30-tool" mentions were previously completely
// unguarded — nothing would fail if CORE_TOOLS.length or HOSTED_HIDDEN's size ever
// changed and the README's hand-typed numbers silently went stale. This derives the
// expected hosted-visible count the SAME way mcp.ts's real `visibleTools` filter does
// (CORE_TOOLS.length minus HOSTED_HIDDEN.size) and asserts the README states it.

const HOSTED_README = readFileSync(join(__dirname, "..", "README.md"), "utf8");

test("core registry has exactly 38 tools (pinned — mirrors npm-package discover.test.ts's EXPECTED_CURATED_COUNT)", () => {
  assert.equal(CORE_TOOL_NAMES.size, 38, `core registry size changed — update this pinned count, npm-package's discover.test.ts, and every README/SKILL count to ${CORE_TOOL_NAMES.size}`);
});

test("HOSTED_HIDDEN has exactly 8 entries (pinned)", () => {
  assert.equal(HOSTED_HIDDEN.size, 8, `HOSTED_HIDDEN size changed — update this pinned count and the hosted-visible-count derivation below to ${HOSTED_HIDDEN.size}`);
});

test("hosted-visible count (CORE_TOOLS minus HOSTED_HIDDEN) is 30", () => {
  assert.equal(CORE_TOOL_NAMES.size - HOSTED_HIDDEN.size, 30, "hosted-visible tool count drifted from 30 — update hosted-server/vercel/README.md's '30-tool' mentions to match");
});

test("hosted-server/vercel/README.md states the derived hosted-visible count ('30-tool'/'30 tools')", () => {
  const expectedHostedCount = CORE_TOOL_NAMES.size - HOSTED_HIDDEN.size;
  assert.match(
    HOSTED_README,
    new RegExp(`${expectedHostedCount}[- ]tool`),
    `hosted-server/vercel/README.md must state "${expectedHostedCount}-tool"/"${expectedHostedCount} tool(s)" (derived: CORE_TOOLS ${CORE_TOOL_NAMES.size} - HOSTED_HIDDEN ${HOSTED_HIDDEN.size}) — not a stale hand-count`,
  );
});

test("hosted-server/vercel/README.md states the full core registry count ('38-tool registry')", () => {
  assert.match(
    HOSTED_README,
    new RegExp(`${CORE_TOOL_NAMES.size}[- ]tool`),
    `hosted-server/vercel/README.md must state "${CORE_TOOL_NAMES.size}-tool" (the full npm-package registry size) — not a stale hand-count`,
  );
});

// ─── (i) NPM_HIDDEN_ALIASES cardinality tripwire (class-not-instance structural
// defense — security-review follow-up, 2026-08-09, on top of the
// HOSTED_NEVER_ROUTABLE_NPM_ALIASES fix in commit 6561658) ────────────────────────
//
// Root problem this guards against: `HOSTED_ROUTABLE_ALIASES` folds in
// `...NPM_HIDDEN_ALIASES` (npm core's OWN "dispatched-but-unlisted" set) minus a
// deny-set (`HOSTED_NEVER_ROUTABLE_NPM_ALIASES`, currently just
// novada_scraper_task_mgmt). That deny-set is hand-enumerated — if npm core ever
// adds a 20th HIDDEN_ALIASES member (e.g. a new destructive/account-mutation
// backward-compat alias), it silently defaults to ROUTABLE on hosted unless a human
// explicitly adds it to the deny-set first. This is exactly the "hardcoding one
// member of a class instead of enumerating the class" failure mode: the fix for
// novada_scraper_task_mgmt (one instance) didn't add a structural check that a
// FUTURE new member of NPM_HIDDEN_ALIASES (the class) gets the same triage.
//
// This test pins NPM_HIDDEN_ALIASES.size AND requires every member not in the deny
// list to be an explicitly reviewed, enumerated routable name (a table, not a
// branch). If npm adds a 20th HIDDEN_ALIASES member, this test fails loudly,
// forcing a human to triage "hosted-routable (add to REVIEWED_HOSTED_ROUTABLE_
// NPM_ALIASES below) or never-ported (add to HOSTED_NEVER_ROUTABLE_NPM_ALIASES in
// mcp.ts)?" instead of it silently riding through the `...NPM_HIDDEN_ALIASES`
// spread as routable. Mirrors the "HOSTED_HIDDEN has exactly 8 entries (pinned)"
// guard above (test (h)) — same pattern, applied to npm core's hidden-alias class
// instead of hosted's own never-ported class.
//
// NPM_HIDDEN_ALIASES itself is the REAL imported Set from the vendored core.js
// (same import at the top of this file used by every other test here) — this is
// NOT a hardcoded private copy of the 19 names standing in as the source of truth.
// The pin is on `.size` plus an explicit reviewed allow/deny enumeration of the
// CURRENT members, so a genuinely new member (not just a reshuffled existing one)
// is what trips this test.

const hostedNeverRoutableSlice = sliceBetween(
  "const HOSTED_NEVER_ROUTABLE_NPM_ALIASES = new Set([",
  "]);",
  "HOSTED_NEVER_ROUTABLE_NPM_ALIASES",
);
const HOSTED_NEVER_ROUTABLE_NPM_ALIASES = new Set(namesIn(hostedNeverRoutableSlice));

// Explicitly reviewed as safe to route on hosted (backward-compat aliases that fold
// into novada_extract/novada_account/novada_proxy/novada_scrape — see
// npm-package/src/core.ts's HIDDEN_ALIASES comment for what each folds into). This
// is the full current NPM_HIDDEN_ALIASES membership MINUS
// HOSTED_NEVER_ROUTABLE_NPM_ALIASES (today: just novada_scraper_task_mgmt).
const REVIEWED_HOSTED_ROUTABLE_NPM_ALIASES = new Set([
  // → novada_extract(format:"html")
  "novada_unblock",
  // → novada_account(section=...)
  "novada_health",
  "novada_health_all",
  "novada_wallet_balance",
  "novada_wallet_usage_record",
  "novada_traffic_daily",
  "novada_plan_balance_all",
  "novada_capture_logs",
  "novada_account_summary",
  // → novada_proxy(type=...)
  "novada_proxy_residential",
  "novada_proxy_isp",
  "novada_proxy_datacenter",
  "novada_proxy_mobile",
  "novada_proxy_static",
  "novada_proxy_dedicated",
  // → novada_scrape / benign stubs
  "novada_scraper_submit",
  "novada_scraper_status",
  "novada_scraper_result",
]);

test("NPM_HIDDEN_ALIASES has exactly 19 entries (pinned)", () => {
  assert.equal(
    NPM_HIDDEN_ALIASES.size,
    19,
    `npm core's HIDDEN_ALIASES size changed from 19 — a NEW hidden alias must be triaged by a human: either add it to HOSTED_NEVER_ROUTABLE_NPM_ALIASES in mcp.ts (if it's a never-ported/destructive tool) or to REVIEWED_HOSTED_ROUTABLE_NPM_ALIASES in this test (if it's safe to route on hosted) — do not let it silently default to routable via the unfiltered spread.`,
  );
});

test("every NPM_HIDDEN_ALIASES member not in HOSTED_NEVER_ROUTABLE_NPM_ALIASES is an explicitly reviewed, enumerated routable alias (class-not-instance tripwire)", () => {
  const untriaged = [...NPM_HIDDEN_ALIASES].filter(
    (n) => !HOSTED_NEVER_ROUTABLE_NPM_ALIASES.has(n) && !REVIEWED_HOSTED_ROUTABLE_NPM_ALIASES.has(n),
  );
  assert.deepEqual(
    untriaged,
    [],
    `untriaged NPM_HIDDEN_ALIASES member(s) found: ${untriaged.join(", ")} — each must be explicitly added to either HOSTED_NEVER_ROUTABLE_NPM_ALIASES (mcp.ts, never-ported) or REVIEWED_HOSTED_ROUTABLE_NPM_ALIASES (this test, reviewed-routable) before it is allowed to reach hosted.`,
  );
});

test("HOSTED_NEVER_ROUTABLE_NPM_ALIASES (real, extracted from mcp.ts) plus REVIEWED_HOSTED_ROUTABLE_NPM_ALIASES together equal NPM_HIDDEN_ALIASES exactly (no member double-classified, none missing)", () => {
  const union = new Set([...HOSTED_NEVER_ROUTABLE_NPM_ALIASES, ...REVIEWED_HOSTED_ROUTABLE_NPM_ALIASES]);
  assert.deepEqual([...union].sort(), [...NPM_HIDDEN_ALIASES].sort(), "the deny-set + reviewed-routable-set must partition NPM_HIDDEN_ALIASES exactly");
  const overlap = [...HOSTED_NEVER_ROUTABLE_NPM_ALIASES].filter((n) => REVIEWED_HOSTED_ROUTABLE_NPM_ALIASES.has(n));
  assert.deepEqual(overlap, [], `a name must not be in BOTH the deny-set and the reviewed-routable set: ${overlap.join(", ")}`);
});
