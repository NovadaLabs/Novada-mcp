#!/usr/bin/env node
/**
 * scripts/check-hosted-drift.mjs
 *
 * DRIFT GUARD for the hosted (mcp.novada.com) tool surface.
 *
 * UPDATED 2026-07-20 (Option A — core-derivation refactor): hosted-server/vercel/api/mcp.ts
 * no longer hand-curates its `TOOLS` array. It now builds it as
 *   `const TOOLS = CORE_TOOLS.map((t) => ({ ... }))`
 * where `CORE_TOOLS` is imported straight from npm-package's `core.ts` (`TOOLS as
 * CORE_TOOLS`) — the SAME single source of truth the npm stdio server and every test
 * import. This makes silent tool drift on the *listing* structurally much harder than
 * the old hand-curated-array world this script was originally written for: there is no
 * longer a parallel, independently-typed 15-tool literal that could quietly diverge from
 * core's real registry. What CAN still drift, and what this script now guards:
 *
 *   (1) DERIVATION REGRESSION — someone reverts `const TOOLS = CORE_TOOLS.map(...)` back
 *       to a hand-written literal array (or removes the `TOOLS as CORE_TOOLS` import),
 *       silently reintroducing the exact duplication this refactor eliminated.
 *   (2) HOSTED_HIDDEN drift — mcp.ts's `HOSTED_HIDDEN` exclusion set (the ONLY thing that
 *       keeps a core tool OFF the hosted listing now) silently gains or loses an entry
 *       without config/surfaces.json's "hosted" manifest being updated in the same
 *       reviewed diff — i.e. the manifest stops accurately documenting what's excluded
 *       and why.
 *   (3) Ghost/renamed exclusions — HOSTED_HIDDEN (or the manifest's mirror of it) names a
 *       tool that isn't even in npm-package's registry (typo, or the tool was renamed/
 *       removed and the exclusion entry was never cleaned up).
 *   (4) Regression on the PINNED "hosted-15" eval fixture — the original 15 tools the
 *       Layer-5 eval harness (npm-package/eval/model-eval-runner.mjs --surface=hosted-15)
 *       assumes are always reachable on hosted must remain a SUBSET of whatever the live
 *       "hosted" surface derives to. If a future HOSTED_HIDDEN edit accidentally excluded
 *       one of those 15 (e.g. novada_search), the eval fixture's core assumption would be
 *       silently false.
 *   (5) The LIVE RUNTIME FILTER regressing — (1)-(4) above only ever compare CATALOG-level
 *       name sets (TOOLS, HOSTED_HIDDEN, surfaces.json). None of them prove the actual
 *       ListTools/discover code path (`visibleTools` in buildServer(), which applies
 *       `.filter(t => !isHosted || !HOSTED_HIDDEN.has(t.name))`) still excludes HOSTED_HIDDEN
 *       tools from what's served. Deleting that one clause would serve every HOSTED_HIDDEN
 *       tool to every hosted caller while (1)-(4) kept reporting PASS.
 *   (6) A dynamic bypass mutating `TOOLS`/`visibleTools` AFTER their declarations
 *       (`.push`/`.splice`/`.concat`/`.unshift`, `...TOOLS` spreads, `Object.assign(TOOLS, ...)`,
 *       length-based truncate/append) — the pre-refactor version of this script had a
 *       mutation gate that caught exactly this shape (2026-07-18 red-team finding); the
 *       2026-07-20 core-derivation rewrite dropped it.
 *
 * Five gates, run in this order (see main()):
 *   (derivation gate) mcp.ts is scanned for the two structural markers that prove TOOLS is
 *       still derived from core (the `TOOLS as CORE_TOOLS` import AND the
 *       `const TOOLS = CORE_TOOLS.map(` construction). Either marker missing = hard fail
 *       — this script refuses to trust anything else it parses out of mcp.ts once the
 *       derivation itself can't be confirmed (mirrors the pre-refactor mutation-gate's
 *       "don't report false PASS against an unverifiable state" philosophy).
 *   (runtime-filter gate) the LIVE `.filter(t => !isHosted || !HOSTED_HIDDEN.has(t.name))`
 *       clause that builds `visibleTools` (what ListTools/discover actually serve) must be
 *       present in mcp.ts — see (5) above.
 *   (mutation gate) mcp.ts is scanned, AFTER `TOOLS`'s declaration, for any dynamic mutation
 *       of TOOLS or visibleTools — see (6) above.
 *   (a) every tool name in config/surfaces.json's "hosted" AND "hosted-15" surfaces is a
 *       member of npm-package's REGISTERED_TOOL_NAMES (npm-package/src/tools/registry.ts)
 *       — no ghost/renamed tool reaches the hosted endpoint or the eval fixture.
 *   (b) the LIVE mcp.ts HOSTED_HIDDEN set, read directly off disk right now, is an exact
 *       SET match against `REGISTERED_TOOL_NAMES \ surfaces.json["hosted"].tools` — i.e.
 *       the manifest's "hosted" list and mcp.ts's real exclusion set agree on exactly
 *       which tools are cut, so any future silent HOSTED_HIDDEN edit fails until
 *       surfaces.json is updated in the same reviewed diff.
 *   (c) surfaces.json's "hosted-15" tools are a SUBSET of "hosted" tools — the pinned eval
 *       fixture's tools must never fall out of what's actually live on hosted.
 *
 * ── Loading method: plain TEXT PARSING of mcp.ts, NOT import/execution. Why this is
 *    the stable choice (unchanged from the pre-refactor version of this script): ────────
 *
 *   - hosted-server/vercel/api/mcp.ts constructs a real MCP `Server`, runs Sentry.init(),
 *     imports @vercel/kv / @vercel/functions, strips process.env consumption creds as a
 *     MODULE-LOAD side effect, and pulls from hosted-server/vercel/vendor/ (generated by
 *     deploy-hosted.sh, never hand-edited — see repo CLAUDE.md). None of that is safe,
 *     meaningful, or even possible to `import` from a plain Node script without a
 *     Vercel-shaped environment (KV creds, Sentry DSN, etc.) — and mcp.ts is TypeScript,
 *     so plain `node` cannot execute it directly regardless.
 *   - npm-package/src/tools/registry.ts IS side-effect-free by its own docstring, but
 *     importing it as TS would need either a build step (npm-package/build/tools/
 *     registry.js — a compiled artifact that can go stale relative to src/ between
 *     builds) or a TS loader (ts-node/tsx) this repo does not wire up for one-off
 *     scripts. Depending on build freshness would make this "CI-runnable node script"
 *     secretly require `npm run build` first — a hidden precondition that itself could
 *     drift.
 *
 *   Both files are read as plain text; the `HOSTED_HIDDEN` / `TOOL_REGISTRY` array
 *   literals are sliced out with anchor strings unique to each file (verified against the
 *   current source before writing this script), then every `"novada_..."` string inside
 *   that slice is extracted with a regex. Each extraction is asserted non-empty so a
 *   broken anchor fails loudly instead of silently passing a vacuous check.
 *
 * ── THREAT MODEL — read this before trusting (or extending) this script ──────────────
 *
 * A round-2 red-team pass (2026-07-19, pre-refactor) proved that no amount of additional
 * regex-pattern-matching can make a text-based check complete against a determined
 * committer — text-pattern matching over a Turing-complete language is fundamentally an
 * incomplete defense. This script's honest, bounded job:
 *
 * CATCHES:
 *   - Accidental drift: mcp.ts's HOSTED_HIDDEN literal and config/surfaces.json's
 *     "hosted" list silently falling out of sync because ONE of the two was edited and
 *     the other forgotten.
 *   - Reverting the derivation itself: TOOLS going back to a hand-curated literal, or the
 *     `TOOLS as CORE_TOOLS` import disappearing.
 *   - A HOSTED_HIDDEN entry (or a surfaces.json "hosted"/"hosted-15" entry) that names a
 *     tool no longer in npm-package's registry.
 *   - The pinned "hosted-15" eval fixture silently falling out of what's live on hosted.
 *
 * DOES NOT DEFEND against a committer DELIBERATELY obfuscating a bypass inside an
 * otherwise-reviewed PR — e.g. a computed HOSTED_HIDDEN entry, an aliased mutation of the
 * same Set reference under a different local name, or a mutation performed from a
 * DIFFERENT file that imports and changes the served list at module-load time. That class
 * of attack is CODE REVIEW's responsibility, not a static script's — this script exists to
 * make the common, honest, or careless failure modes impossible to ship by accident, not
 * to prove every diff is safe.
 *
 * Usage:  node scripts/check-hosted-drift.mjs
 * Exit codes: 0 = no drift, 1 = drift detected or manifest/parse error.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SURFACES_PATH = path.join(ROOT, "config", "surfaces.json");
const REGISTRY_PATH = path.join(ROOT, "npm-package", "src", "tools", "registry.ts");
const TOOLS_DIR = path.join(ROOT, "npm-package", "src", "tools");
const MCP_TS_PATH = path.join(ROOT, "hosted-server", "vercel", "api", "mcp.ts");

// Anchor pair for the `const TOOLS = CORE_TOOLS.map((t) => ({ ... }));` construction —
// used by the post-declaration mutation scan below to know where TOOLS's declaration
// ENDS (i.e. where to start scanning for dynamic mutation of TOOLS/visibleTools).
const MCP_TOOLS_DECL_START = "const TOOLS = CORE_TOOLS.map((t) => ({";
const MCP_TOOLS_DECL_END = "\n}));";

// The runtime clause that actually EXCLUDES HOSTED_HIDDEN tools from the served
// ListTools/discover output (applied to `visibleTools` in buildServer). The (a)/(b)/(c)
// checks below only compare CATALOG-level name sets (TOOLS, HOSTED_HIDDEN, the
// manifest) — none of them prove the live server actually filters HOSTED_HIDDEN out of
// what it serves. Without this gate, someone could delete this one runtime `.filter(...)`
// clause (so every request gets the full unfiltered TOOLS list back) and every other
// check in this script would still report PASS, because they never look at the
// ListTools/visibleTools code path at all.
const RUNTIME_FILTER_PATTERN = /\.filter\(\s*t\s*=>\s*!isHosted\s*\|\|\s*!HOSTED_HIDDEN\.has\(t\.name\)\s*\)/;

/**
 * Slice `source` between the first occurrence of `startAnchor` and the next occurrence
 * of `endAnchor` after it, then extract every `"novada_xxx"` tool name inside that slice.
 * Throws (never silently returns []) if an anchor is missing or the slice yields zero
 * names — both indicate the source file's shape changed and this script's anchors need
 * updating, not a real "0 tools" result.
 */
function extractToolNames(source, startAnchor, endAnchor, label) {
  const startIdx = source.indexOf(startAnchor);
  if (startIdx === -1) {
    throw new Error(
      `[check-hosted-drift] anchor not found for ${label}: ${JSON.stringify(startAnchor)} — ` +
      `file structure changed; update this script's anchors to match`
    );
  }
  const endIdx = source.indexOf(endAnchor, startIdx + startAnchor.length);
  if (endIdx === -1) {
    throw new Error(
      `[check-hosted-drift] end anchor not found for ${label}: ${JSON.stringify(endAnchor)} — ` +
      `file structure changed; update this script's anchors to match`
    );
  }
  const slice = source.slice(startIdx, endIdx);
  const names = [...slice.matchAll(/"(novada_[a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
  if (names.length === 0) {
    throw new Error(
      `[check-hosted-drift] extracted ZERO tool names for ${label} — parsing is broken, ` +
      `refusing to pass a vacuous check`
    );
  }
  return names;
}

function loadSurfacesManifest() {
  const raw = readFileSync(SURFACES_PATH, "utf8");
  return JSON.parse(raw);
}

function getManifestSurfaceTools(manifest, surfaceName) {
  const surface = manifest?.surfaces?.[surfaceName];
  if (!surface || !Array.isArray(surface.tools)) {
    throw new Error(
      `[check-hosted-drift] ${SURFACES_PATH} is missing a surfaces["${surfaceName}"].tools array`
    );
  }
  return surface.tools;
}

/**
 * The 15 (and growing) platform-scraper tool names (novada_scrape_amazon and its
 * siblings) are NOT literal strings in registry.ts — that file spreads
 * `...PLATFORM_SCRAPER_REGISTRY_ENTRIES` (imported, factory-generated objects) into
 * TOOL_REGISTRY, so a plain text-regex over registry.ts's own source sees zero of them
 * (verified: undercounted the registry by exactly 15 before this fix was added). Each
 * platform's declarative config file (src/tools/scrape_<platform>.ts) DOES carry its
 * name as a literal `toolName: "novada_scrape_..."` string though — so recover the
 * platform-scraper names by scanning every `scrape_<platform>.ts` file in the tools/
 * directory (glob, not a hand-typed list of 15 filenames) for that literal. Zero build
 * step, zero import/execution — consistent with why this whole script text-parses
 * instead of importing (see file header).
 */
function loadPlatformScraperToolNames() {
  const files = readdirSync(TOOLS_DIR).filter((f) => /^scrape_[a-z0-9]+\.ts$/.test(f));
  if (files.length === 0) {
    throw new Error(
      `[check-hosted-drift] found ZERO scrape_<platform>.ts platform-scraper config files in ` +
      `${TOOLS_DIR} — parsing is broken, refusing to pass a vacuous check`
    );
  }
  const names = [];
  for (const file of files) {
    const src = readFileSync(path.join(TOOLS_DIR, file), "utf8");
    const m = src.match(/toolName:\s*"(novada_[a-zA-Z0-9_]+)"/);
    if (!m) {
      throw new Error(
        `[check-hosted-drift] ${file} has no \`toolName: "novada_..."\` literal — the platform-scraper ` +
        `config shape changed; update this script's extraction to match`
      );
    }
    names.push(m[1]);
  }
  return names;
}

/**
 * REGISTERED_TOOL_NAMES equivalent: every tool name in npm-package's canonical registry —
 * registry.ts's hand-written entries UNION the platform-scraper family recovered from
 * their own config files (see loadPlatformScraperToolNames above).
 */
function loadRegisteredToolNames() {
  const src = readFileSync(REGISTRY_PATH, "utf8");
  const handWritten = extractToolNames(
    src,
    "export const TOOL_REGISTRY: readonly ToolMeta[] = [",
    "\n];",
    "npm-package/src/tools/registry.ts TOOL_REGISTRY"
  );
  const platformScrapers = loadPlatformScraperToolNames();
  return new Set([...handWritten, ...platformScrapers]);
}

/** The LIVE mcp.ts HOSTED_HIDDEN set, read straight off disk (see file header for why text-parsed). */
function loadHostedHiddenNames(mcpSrc) {
  return new Set(extractToolNames(
    mcpSrc,
    "const HOSTED_HIDDEN = new Set([",
    "]);",
    "hosted-server/vercel/api/mcp.ts HOSTED_HIDDEN"
  ));
}

/**
 * DERIVATION GATE (replaces the pre-refactor "mutation gate"): proves mcp.ts's `TOOLS`
 * is still built from core's registry rather than a hand-curated literal. Checks for two
 * structural markers that only coexist when the derivation is intact:
 *   1. The import renames core's TOOLS to CORE_TOOLS (`TOOLS as CORE_TOOLS`) from the
 *      vendored core module.
 *   2. `const TOOLS = CORE_TOOLS.map(` — the actual derivation construction.
 * Either marker missing means TOOLS may have reverted to (or never left) a hand-curated
 * literal — refuse to trust the rest of this script's parse in that case, exactly as the
 * pre-refactor mutation-gate refused to trust its parse once TOOLS.push(...) was detected.
 */
function detectDerivationRegression(mcpSrc) {
  const issues = [];
  if (!/TOOLS\s+as\s+CORE_TOOLS/.test(mcpSrc)) {
    issues.push(
      `  mcp.ts no longer imports core's TOOLS as CORE_TOOLS — the "TOOLS as CORE_TOOLS" ` +
      `import from "../vendor/novada-mcp/core.js" is missing.`
    );
  }
  if (!/const TOOLS = CORE_TOOLS\.map\(/.test(mcpSrc)) {
    issues.push(
      `  mcp.ts's TOOLS is no longer built as "const TOOLS = CORE_TOOLS.map(...)" — it may ` +
      `have reverted to a hand-curated literal array (the exact duplication the 2026-07-20 ` +
      `core-derivation refactor eliminated).`
    );
  }
  return issues;
}

/**
 * RUNTIME-FILTER GATE — closes a real gap the derivation gate above does NOT cover:
 * that gate only proves TOOLS is built from CORE_TOOLS; it says nothing about whether
 * HOSTED_HIDDEN tools are actually excluded from what the server SERVES. That exclusion
 * happens at a different spot entirely: the `visibleTools` construction inside
 * buildServer(), which applies `.filter(t => !isHosted || !HOSTED_HIDDEN.has(t.name))` to
 * the list ListTools/discover actually return. If that one runtime clause is ever deleted
 * (accidentally or not), every HOSTED_HIDDEN tool (novada_site_copy, novada_ip_whitelist,
 * etc.) would be served to every hosted caller by default — and every other check in this
 * script would still report PASS, because none of them execute or otherwise observe this
 * code path; they only compare catalog-level name sets (TOOLS / HOSTED_HIDDEN /
 * surfaces.json), never what the ListTools handler actually filters and returns.
 */
function detectRuntimeFilterMissing(mcpSrc) {
  if (!RUNTIME_FILTER_PATTERN.test(mcpSrc)) {
    return [
      `  mcp.ts no longer applies the HOSTED_HIDDEN runtime filter to the served tool list — ` +
      `the ".filter(t => !isHosted || !HOSTED_HIDDEN.has(t.name))" clause that builds ` +
      `"visibleTools" in buildServer() (the thing ListTools/novada_discover actually serve) is ` +
      `missing or was reworded. Without it, HOSTED_HIDDEN tools would be served on hosted ` +
      `regardless of what TOOLS/HOSTED_HIDDEN/surfaces.json say.`,
    ];
  }
  return [];
}

/**
 * Locate the index immediately AFTER the `const TOOLS = CORE_TOOLS.map((t) => ({ ... }));`
 * construction in mcp.ts — the boundary past which the mutation scan below looks for a
 * dynamic bypass. Throws (never silently returns a boundary of -1 or the file length) if
 * either anchor is missing, so a renamed/reshaped declaration fails loud instead of the
 * mutation gate silently scanning zero bytes and reporting a false "clean" result.
 */
function findToolsDeclEnd(source) {
  const startIdx = source.indexOf(MCP_TOOLS_DECL_START);
  if (startIdx === -1) {
    throw new Error(
      `[check-hosted-drift] mutation-scan: start anchor not found: ${JSON.stringify(MCP_TOOLS_DECL_START)} — ` +
      `file structure changed; update this script's anchors to match`
    );
  }
  const endIdx = source.indexOf(MCP_TOOLS_DECL_END, startIdx + MCP_TOOLS_DECL_START.length);
  if (endIdx === -1) {
    throw new Error(
      `[check-hosted-drift] mutation-scan: end anchor not found: ${JSON.stringify(MCP_TOOLS_DECL_END)} — ` +
      `file structure changed; update this script's anchors to match`
    );
  }
  return endIdx + MCP_TOOLS_DECL_END.length;
}

/**
 * POST-DECLARATION MUTATION SCAN — re-added. The pre-refactor version of this script had a
 * mutation gate that caught exactly this bypass shape (red-team finding, 2026-07-18); the
 * 2026-07-20 core-derivation rewrite dropped it. Scans mcp.ts text starting right after
 * TOOLS's declaration for any shape that dynamically changes TOOLS OR visibleTools (the
 * actual runtime-served list, built later in buildServer()) after that point:
 * .push/.splice/.concat/.unshift calls, `...TOOLS`/`...visibleTools` spreads,
 * Object.assign(TOOLS|visibleTools, ...), or length-based truncate/append tricks.
 *
 * It is intentionally NOT trying to prove what such code does at runtime — text parsing
 * cannot answer that. It only proves the static name-comparisons elsewhere in this script
 * can no longer be trusted, and the caller (main()) must treat any hit here as an
 * unconditional hard failure — exactly the same "don't report a false PASS against an
 * unverifiable state" philosophy as the derivation gate above.
 */
function detectDynamicToolsMutation(source) {
  const scanStart = findToolsDeclEnd(source);
  const tail = source.slice(scanStart);

  const patterns = [];
  for (const name of ["TOOLS", "visibleTools"]) {
    patterns.push(
      { re: new RegExp(`\\b${name}\\.push\\s*\\(`, "g"), label: `${name}.push(...) — appends tool(s) after the declaration` },
      { re: new RegExp(`\\b${name}\\.splice\\s*\\(`, "g"), label: `${name}.splice(...) — inserts/removes tool(s) after the declaration` },
      { re: new RegExp(`\\b${name}\\.concat\\s*\\(`, "g"), label: `${name}.concat(...) — builds a served list beyond the declaration` },
      { re: new RegExp(`\\b${name}\\.unshift\\s*\\(`, "g"), label: `${name}.unshift(...) — prepends tool(s) after the declaration` },
      { re: new RegExp(`\\.\\.\\.\\s*${name}\\b`, "g"), label: `...${name} — spreads ${name} into another array (possible bypass list)` },
      { re: new RegExp(`\\bObject\\.assign\\s*\\(\\s*${name}\\b`, "g"), label: `Object.assign(${name}, ...) — mutates ${name} entries/shape in place` },
      { re: new RegExp(`\\b${name}\\.length\\s*=`, "g"), label: `${name}.length = ... — truncates/extends ${name} via length assignment` },
      { re: new RegExp(`\\b${name}\\[\\s*${name}\\.length\\s*\\]\\s*=`, "g"), label: `${name}[${name}.length] = ... — index-append after the declaration` },
    );
  }

  const hits = [];
  for (const { re, label } of patterns) {
    let m;
    while ((m = re.exec(tail)) !== null) {
      const lineNo = source.slice(0, scanStart + m.index).split("\n").length;
      hits.push(`  hosted-server/vercel/api/mcp.ts:${lineNo}: ${label}`);
    }
  }
  return hits;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function main() {
  const mcpSrc = readFileSync(MCP_TS_PATH, "utf8");

  // ── DERIVATION GATE — run FIRST, unconditionally, before trusting anything else ──
  const derivationIssues = detectDerivationRegression(mcpSrc);
  if (derivationIssues.length > 0) {
    console.error(
      `[check-hosted-drift] FAIL (derivation-gate): mcp.ts's TOOLS array can no longer be ` +
      `confirmed as derived from core.ts — the rest of this script's checks would be ` +
      `comparing against a name set it cannot vouch for.`
    );
    for (const issue of derivationIssues) console.error(issue);
    process.exit(1);
  }
  console.log(`[check-hosted-drift] PASS (derivation-gate): mcp.ts's TOOLS is confirmed derived from core.ts's CORE_TOOLS.`);

  // ── RUNTIME-FILTER GATE — run right after the derivation gate, before trusting anything
  // else. Proves the live ListTools/discover code path actually excludes HOSTED_HIDDEN
  // tools, not just that the catalog-level name sets *say* they should be excluded.
  const runtimeFilterIssues = detectRuntimeFilterMissing(mcpSrc);
  if (runtimeFilterIssues.length > 0) {
    console.error(
      `[check-hosted-drift] FAIL (runtime-filter-gate): the live HOSTED_HIDDEN exclusion filter ` +
      `is missing from mcp.ts's served-tool-list construction — every other check below only ` +
      `audits catalog-level name sets and cannot detect this.`
    );
    for (const issue of runtimeFilterIssues) console.error(issue);
    process.exit(1);
  }
  console.log(`[check-hosted-drift] PASS (runtime-filter-gate): mcp.ts applies the HOSTED_HIDDEN runtime filter to the served tool list.`);

  // ── MUTATION GATE — re-added (2026-07-20 rewrite had dropped it). Run before trusting
  // any of the name-set comparisons below: if TOOLS/visibleTools is mutated dynamically
  // after its declaration, those comparisons are auditing a name set that is provably NOT
  // what the live endpoint serves.
  const mutationHits = detectDynamicToolsMutation(mcpSrc);
  if (mutationHits.length > 0) {
    console.error(
      `[check-hosted-drift] FAIL (mutation-gate): TOOLS or visibleTools is being mutated ` +
      `dynamically after its declaration; the text-based drift check cannot verify the true ` +
      `served surface.`
    );
    console.error(`  Detected mutation site(s):`);
    for (const hit of mutationHits) console.error(hit);
    console.error(
      `  -> This check refuses to PASS when it cannot trust its own parse. Remove the dynamic ` +
      `mutation (fold it into the reviewed TOOLS/HOSTED_HIDDEN declarations themselves).`
    );
    process.exit(1);
  }
  console.log(`[check-hosted-drift] PASS (mutation-gate): no dynamic mutation of TOOLS/visibleTools detected after their declarations.`);

  const manifest = loadSurfacesManifest();
  const manifestHostedTools = getManifestSurfaceTools(manifest, "hosted");
  const manifestHosted15Tools = getManifestSurfaceTools(manifest, "hosted-15");

  const manifestHostedSet = new Set(manifestHostedTools);
  if (manifestHostedSet.size !== manifestHostedTools.length) {
    console.error(`[check-hosted-drift] FAIL: config/surfaces.json "hosted".tools contains duplicate name(s)`);
    process.exit(1);
  }
  const manifestHosted15Set = new Set(manifestHosted15Tools);
  if (manifestHosted15Set.size !== manifestHosted15Tools.length) {
    console.error(`[check-hosted-drift] FAIL: config/surfaces.json "hosted-15".tools contains duplicate name(s)`);
    process.exit(1);
  }

  const registeredNames = loadRegisteredToolNames();
  const hostedHiddenLive = loadHostedHiddenNames(mcpSrc);

  let failed = false;

  // (a) every manifest tool name (both surfaces) ∈ REGISTERED_TOOL_NAMES — no ghost/renamed tool.
  for (const [surfaceName, toolSet] of [["hosted", manifestHostedSet], ["hosted-15", manifestHosted15Set]]) {
    const ghosts = [...toolSet].filter((n) => !registeredNames.has(n));
    if (ghosts.length > 0) {
      failed = true;
      console.error(
        `[check-hosted-drift] FAIL (a): config/surfaces.json "${surfaceName}" lists tool(s) NOT in the ` +
        `${registeredNames.size}-tool registry (npm-package/src/tools/registry.ts): ${ghosts.join(", ")}`
      );
    } else {
      console.log(
        `[check-hosted-drift] PASS (a): all ${toolSet.size} "${surfaceName}" manifest tools ∈ ` +
        `${registeredNames.size}-tool registry`
      );
    }
  }

  // (b) live mcp.ts HOSTED_HIDDEN === REGISTERED_TOOL_NAMES \ manifest "hosted".tools, as a SET.
  // Also require every HOSTED_HIDDEN name to be a real registered tool (a ghost exclusion is a
  // dead/stale entry, not a real exclusion, and would silently mask this gate).
  const hostedHiddenGhosts = [...hostedHiddenLive].filter((n) => !registeredNames.has(n));
  if (hostedHiddenGhosts.length > 0) {
    failed = true;
    console.error(
      `[check-hosted-drift] FAIL (b): mcp.ts's HOSTED_HIDDEN names tool(s) NOT in the ` +
      `${registeredNames.size}-tool registry (stale/renamed exclusion?): ${hostedHiddenGhosts.join(", ")}`
    );
  }
  const derivedExclusion = new Set([...registeredNames].filter((n) => !manifestHostedSet.has(n)));
  if (!setsEqual(hostedHiddenLive, derivedExclusion)) {
    failed = true;
    const excludedButNotHidden = [...derivedExclusion].filter((n) => !hostedHiddenLive.has(n));
    const hiddenButNotExcluded = [...hostedHiddenLive].filter((n) => !derivedExclusion.has(n));
    console.error(
      `[check-hosted-drift] FAIL (b): live mcp.ts HOSTED_HIDDEN (${hostedHiddenLive.size} tools) does NOT ` +
      `match config/surfaces.json's implied exclusion set (registry \\ "hosted".tools, ${derivedExclusion.size} tools).`
    );
    if (excludedButNotHidden.length) {
      console.error(`  Missing from "hosted".tools but NOT in HOSTED_HIDDEN either (registered but nowhere accounted for): ${excludedButNotHidden.join(", ")}`);
    }
    if (hiddenButNotExcluded.length) {
      console.error(`  In HOSTED_HIDDEN but ALSO in "hosted".tools (contradictory — listed as both hidden and visible): ${hiddenButNotExcluded.join(", ")}`);
    }
    console.error(`  -> Update config/surfaces.json's "hosted" list (or mcp.ts's HOSTED_HIDDEN) in the SAME reviewed diff.`);
  } else {
    console.log(
      `[check-hosted-drift] PASS (b): live mcp.ts HOSTED_HIDDEN (${hostedHiddenLive.size} tools) exactly matches ` +
      `config/surfaces.json's implied exclusion set`
    );
  }

  // (c) "hosted-15" ⊆ "hosted" — the pinned eval fixture must stay live on hosted.
  const droppedFromHosted15 = [...manifestHosted15Set].filter((n) => !manifestHostedSet.has(n));
  if (droppedFromHosted15.length > 0) {
    failed = true;
    console.error(
      `[check-hosted-drift] FAIL (c): config/surfaces.json "hosted-15" tool(s) are no longer in "hosted" ` +
      `— the pinned eval fixture assumes these stay reachable on the live hosted surface: ${droppedFromHosted15.join(", ")}`
    );
  } else {
    console.log(`[check-hosted-drift] PASS (c): "hosted-15" (${manifestHosted15Set.size} tools) ⊆ "hosted" (${manifestHostedSet.size} tools)`);
  }

  if (failed) {
    process.exit(1);
  }
  console.log("[check-hosted-drift] OK — hosted surface is not drifting.");
}

main();
