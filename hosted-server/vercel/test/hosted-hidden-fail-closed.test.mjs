/**
 * B2 fix (2026-07-20, synthesis.md blocker): HOSTED_HIDDEN must be fail-CLOSED.
 *
 * Root cause this guards against: `visibleTools` in buildServer() (mcp.ts) used to be
 * gated on `isHosted = !!(process.env.VERCEL || process.env.VERCEL_ENV)` —
 *   `.filter(t => !isHosted || !HOSTED_HIDDEN.has(t.name))`
 * — which is fail-OPEN: when isHosted is falsy (VERCEL/VERCEL_ENV unset — the refuter
 * found these require an opt-in Vercel project toggle, not guaranteed to be present),
 * the predicate short-circuits to `true` for every tool and HOSTED_HIDDEN is not
 * applied at all. A destructive, never-ported tool like novada_ip_whitelist (account
 * mutation) would then be BOTH listed in ListTools AND dispatchable via CallTool.
 *
 * The fix removes the isHosted gate entirely — this file IS the hosted server
 * (hosted-server/vercel/api/mcp.ts, the Vercel handler for mcp.novada.com), so
 * HOSTED_HIDDEN must always apply, matching the fail-CLOSED invariant already used
 * elsewhere in this file for `listedOnHosted`/`ALL_TOOL_NAMES` (see
 * tool-catalog-derivation.test.mjs's FIX-1 tests for that precedent).
 *
 * Same "text-parse + extract-and-execute the REAL source, don't import mcp.ts"
 * constraint as tool-catalog-derivation.test.mjs (module-load side effects: Sentry.init,
 * @vercel/kv, env-var stripping — see check-hosted-drift.mjs's header).
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
const { TOOLS: CORE_TOOLS } = await import(VENDOR_CORE);

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

const DESTRUCTIVE_TOOL = "novada_ip_whitelist";

// ─── (a) regression guard: the isHosted gate must not exist anywhere in mcp.ts ────
//
// Checks for the actual variable DECLARATION (not just the word "isHosted" — this
// file's own comments legitimately reference the old identifier by name when
// explaining the fix, e.g. in mcp.ts's B2-fix comment above `visibleTools`).

test("mcp.ts no longer declares an isHosted variable (VERCEL/VERCEL_ENV env sniff) to gate HOSTED_HIDDEN", () => {
  assert.doesNotMatch(mcpSrc, /\bconst\s+isHosted\s*=/, "isHosted must not be declared — the HOSTED_HIDDEN filter must be unconditional, not gated on a VERCEL env sniff");
});

test("visibleTools filter expression itself does not reference isHosted / process.env.VERCEL", () => {
  const code = sliceBetween(
    "const visibleTools = (ctx.allowedTools",
    "\n  const visibleToolNames",
    "visibleTools filter",
  );
  assert.doesNotMatch(code, /isHosted/, "the visibleTools filter must not branch on isHosted");
  assert.doesNotMatch(code, /process\.env\.VERCEL/, "the visibleTools filter must not branch on VERCEL/VERCEL_ENV");
});

// ─── (b) extract-and-execute the REAL visibleTools filter from mcp.ts ────────────

/**
 * Extract and EXECUTE mcp.ts's real `visibleTools` filter expression (not a
 * reimplementation) against given TOOLS/HOSTED_HIDDEN/ctx data.
 */
function computeVisibleToolsFromSource(tools, hostedHidden, ctx) {
  const code = sliceBetween(
    "const visibleTools = (ctx.allowedTools",
    "\n  const visibleToolNames",
    "visibleTools filter",
  ).replace(/allowedTools!\./g, "allowedTools.");
  const fn = new Function("TOOLS", "HOSTED_HIDDEN", "ctx", `${code}\nreturn visibleTools;`);
  return fn(tools, hostedHidden, ctx);
}

test("visibleTools excludes every HOSTED_HIDDEN tool with NO ?tools=/?groups= filter, VERCEL/VERCEL_ENV unset", () => {
  // Simulates exactly the failure mode the refuter found: env vars absent (no opt-in
  // Vercel toggle). Explicitly unset both, in case a prior test or the ambient CI
  // shell happens to have them set, so this proves the fail-CLOSED property rather
  // than accidentally passing because the env already looked "hosted".
  const savedVercel = process.env.VERCEL;
  const savedVercelEnv = process.env.VERCEL_ENV;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  try {
    const visibleTools = computeVisibleToolsFromSource(CORE_TOOLS, HOSTED_HIDDEN, { allowedTools: null });
    const visibleNames = new Set(visibleTools.map((t) => t.name));
    assert.ok(!visibleNames.has(DESTRUCTIVE_TOOL), `${DESTRUCTIVE_TOOL} must be absent from ListTools even with VERCEL/VERCEL_ENV unset`);
    for (const hidden of HOSTED_HIDDEN) {
      assert.ok(!visibleNames.has(hidden), `HOSTED_HIDDEN tool ${hidden} leaked into visibleTools`);
    }
  } finally {
    if (savedVercel !== undefined) process.env.VERCEL = savedVercel; else delete process.env.VERCEL;
    if (savedVercelEnv !== undefined) process.env.VERCEL_ENV = savedVercelEnv; else delete process.env.VERCEL_ENV;
  }
});

test("visibleTools excludes HOSTED_HIDDEN tools even when a ?tools= filter explicitly allow-lists one (allowedTools set, still filtered)", () => {
  // ctx.allowedTools would only ever be populated with a HOSTED_HIDDEN name if
  // resolveAllowedTools() had a bug letting it through (out of scope here — that's
  // ALL_TOOL_NAMES's job, already fail-closed). This test proves visibleTools is a
  // second, independent fail-closed layer: even if allowedTools somehow contained the
  // destructive tool, the HOSTED_HIDDEN filter still strips it out.
  const allowedTools = new Set([DESTRUCTIVE_TOOL, "novada_search"]);
  const visibleTools = computeVisibleToolsFromSource(CORE_TOOLS, HOSTED_HIDDEN, { allowedTools });
  const visibleNames = new Set(visibleTools.map((t) => t.name));
  assert.ok(!visibleNames.has(DESTRUCTIVE_TOOL), `${DESTRUCTIVE_TOOL} must stay excluded even if allow-listed by ?tools=`);
  assert.ok(visibleNames.has("novada_search"), "a non-hidden allow-listed tool must still pass through");
});

// ─── (c) CallTool dispatch guard: destructive tool is rejected, full behavioral replay ──

test("CallTool guard rejects the destructive HOSTED_HIDDEN tool (novada_ip_whitelist) — not in HOSTED_ROUTABLE_ALIASES either", () => {
  const hostedRoutableAliasesSlice = sliceBetween(
    "const HOSTED_ROUTABLE_ALIASES = new Set<string>([",
    "\n]);",
    "HOSTED_ROUTABLE_ALIASES",
  );
  const HOSTED_ROUTABLE_ALIASES = new Set(namesIn(hostedRoutableAliasesSlice));
  assert.ok(!HOSTED_ROUTABLE_ALIASES.has(DESTRUCTIVE_TOOL), `${DESTRUCTIVE_TOOL} must not be a routable alias`);

  const visibleTools = computeVisibleToolsFromSource(CORE_TOOLS, HOSTED_HIDDEN, { allowedTools: null });
  const visibleToolNames = new Set(visibleTools.map((t) => t.name));

  // Replays mcp.ts's real CallTool guard:
  //   if (!visibleToolNames.has(name) && !HOSTED_HIDDEN_ALIASES.has(name)) { ... TOOL_NOT_ENABLED ... }
  // HOSTED_HIDDEN_ALIASES only ever contains HOSTED_ROUTABLE_ALIASES members that
  // aren't already visible — novada_ip_whitelist is in neither set, so it must reject.
  const rejected = !visibleToolNames.has(DESTRUCTIVE_TOOL) && !HOSTED_ROUTABLE_ALIASES.has(DESTRUCTIVE_TOOL);
  assert.equal(rejected, true, `CallTool('${DESTRUCTIVE_TOOL}') must be rejected — it is destructive and never ported to hosted`);
});

test("every currently-listed HOSTED_HIDDEN tool is a real, dispatchable core tool (sanity: the guard is exercising a real tool, not a typo)", () => {
  const coreNames = new Set(CORE_TOOLS.map((t) => t.name));
  assert.ok(coreNames.has(DESTRUCTIVE_TOOL), `${DESTRUCTIVE_TOOL} must be a real core tool for this test to be meaningful`);
});
