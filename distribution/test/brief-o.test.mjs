// distribution/test/brief-o.test.mjs — round 2 fixes on PR #20, per the independent reviewer's
// pr20-fix-review-2026-10-19.md and the verifier's pr20-fix-verify-2026-10-19.md (mutation probe
// #1):
//
//   R1 (HIGH)  claims_consistent's MIN_CLAIM_VALUE=10 global floor silently exempted the real
//              distribution/dify/README.md "7 tools" claim from ever being compared, because the
//              floor was applied to the raw digits BEFORE a claim_surfaces fact_overrides was
//              consulted. Replaced with FACT_CLAIM_FLOOR, a per-fact table: every whole-catalog
//              fact keeps its original floor (10); dify_tools gets its own floor (0).
//   R2         surface (hand-declared per row) is now cross-checked against a DERIVED value read
//              out of the row's own manifest content (surface_derived_consistent, new check) —
//              closes the verifier's one surviving mutant: relabeling gemini-cli's surface from
//              "hosted" to "local" (leaving its real httpUrl untouched) no longer defeats
//              surface_claims undetected.
//   R3 (LOW)   checkSurfaceClaims's own try/catch around parseHostedHiddenNames was dead code
//              (claims_consistent's unguarded computeFacts() call always threw first, aborting the
//              ENTIRE run via the CLI's outer catch before surface_claims ever ran). Parsing now
//              goes through tryParseHostedHiddenNames (never throws) and a new, dedicated
//              hosted_hidden_parseable check is the one shared, reachable, named failure point.
//
// Same fixture discipline as the rest of this suite: every mutation happens on a cloned temp copy
// of the shared green fixture, never on the real worktree. R1's tests are the one deliberate
// exception required by this round's brief: they copy the REAL distribution/dify/ directory (not
// a synthetic N-tool fixture) into a cloned fixture, so the fix is proven against the actual file
// this bug lived in, not just a vehicle built to be >=10.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";

import {
  runChecks,
  loadConfig,
  checkClaimsConsistent,
  checkSurfaceClaims,
  checkHostedHiddenParseable,
  tryParseHostedHiddenNames,
  deriveSurfaceForRow,
  checkSurfaceDerivedConsistent,
  evaluateExternalRepoManifests,
  ROOT,
} from "../check.mjs";
import { generateAll } from "../generate.mjs";
import { buildGreenFixture, cloneFixture, cleanupFixture, readJson, writeJson, writeText } from "./fixtures.mjs";

let GREEN_ROOT;
test.before(() => {
  GREEN_ROOT = buildGreenFixture();
});
test.after(() => {
  cleanupFixture(GREEN_ROOT);
});

function findResult(results, name) {
  const r = results.find((x) => x.name === name);
  assert.ok(r, `no result for check "${name}"`);
  return r;
}

/** Replaces a cloned fixture's (synthetic) distribution/dify/ with the REAL repo's actual
 *  distribution/dify/ directory — manifest.yaml, provider/novada.yaml, README.md, and the real 7
 *  tools/*.yaml manifests. This is deliberately NOT fixtures.mjs's synthetic seed: R1's own bug
 *  (MIN_CLAIM_VALUE=10 silently exempting a real single-digit claim) was invisible to any fixture
 *  built to be >=10 tools, by construction — proving the fix means exercising the real file. */
function copyRealDifyInto(root) {
  rmSync(join(root, "distribution", "dify"), { recursive: true, force: true });
  cpSync(join(ROOT, "distribution", "dify"), join(root, "distribution", "dify"), { recursive: true });
}

// =========================================================================================
// R1 — per-fact claim floor (FACT_CLAIM_FLOOR), exercised against the REAL distribution/dify/
// =========================================================================================

test("R1 RED (real distribution/dify layout, not a synthetic fixture): an 8th tool yaml while README still says 7 tools fails claims_consistent on the real dify_tools fact", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    copyRealDifyInto(root);
    writeText(root, "distribution/dify/tools/novada_extra_tool.yaml", "identity:\n  name: novada_extra_tool\n");

    const ctx = loadConfig(root);
    const failures = await checkClaimsConsistent(ctx);
    assert.ok(
      failures.some((f) => f.includes("distribution/dify/README.md") && f.includes("fact=dify_tools") && f.includes("got=7") && f.includes("want=8")),
      `expected a dify_tools claims_consistent failure (got=7 want=8) against the REAL dify layout, got: ${JSON.stringify(failures)}`
    );
  } finally {
    cleanupFixture(root);
  }
});

test("R1 mirror (real distribution/dify layout): the real README's \"7 tools\" claim against the real 7 tool manifests passes claims_consistent — proves the per-fact floor fix actually compares the real file, not just a synthetic >=10-tool fixture", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    copyRealDifyInto(root);
    const ctx = loadConfig(root);
    const failures = await checkClaimsConsistent(ctx);
    const difyFailures = failures.filter((f) => f.includes("distribution/dify/README.md"));
    assert.deepEqual(difyFailures, [], `expected zero distribution/dify/README.md claims_consistent failures against the real, correct layout, got: ${JSON.stringify(difyFailures)}`);
  } finally {
    cleanupFixture(root);
  }
});

test("R1 no-false-positive: an unrelated small number next to an unrelated noun (\"2 steps\") added to the real README never triggers a claims_consistent failure, and the real \"7 tools\" dify_tools claim still correctly passes", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    copyRealDifyInto(root);
    const readmePath = join(root, "distribution", "dify", "README.md");
    const original = readFileSync(readmePath, "utf8");
    writeFileSync(readmePath, original + "\nSetup takes 2 steps to configure.\n");

    const ctx = loadConfig(root);
    const failures = await checkClaimsConsistent(ctx);
    const difyFailures = failures.filter((f) => f.includes("distribution/dify/README.md"));
    assert.deepEqual(
      difyFailures,
      [],
      `an unrelated "2 steps" sentence must never produce a claims_consistent failure — lowering dify_tools' own floor to 0 only changes WHICH FACT a resolved noun is checked against, never which nouns the regex matches in the first place; got: ${JSON.stringify(difyFailures)}`
    );
  } finally {
    cleanupFixture(root);
  }
});

test("R1 control (unchanged behavior): a whole-catalog fact's single-digit occurrence is still silently skipped — FACT_CLAIM_FLOOR keeps tools/platforms/scrapers at the original floor of 10", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "hosted-server/landing/index.html", "<div>1 tool</div><div>0 tools</div>\n");
    const results = await runChecks(root);
    assert.equal(findResult(results, "claims_consistent").failures.length, 0, "single-digit tools/platforms/scrapers claims must stay below their (unchanged) floor of 10");
  } finally {
    cleanupFixture(root);
  }
});

// =========================================================================================
// R2 — surface derivation (new check: surface_derived_consistent)
// =========================================================================================

test("R2 RED (verifier mutation probe #1 reproduction): hand-relabeling gemini-cli's surface from \"hosted\" to \"local\" (no manifest change) now fails surface_derived_consistent — the one real gap the round-2 review found", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const channels = readJson(root, "distribution/channels.json");
    const row = channels.rows.find((r) => r.id === "gemini-cli");
    assert.equal(row.surface, "hosted", "test setup: gemini-cli must start declared hosted");
    row.surface = "local";
    writeJson(root, "distribution/channels.json", channels);
    // Mirrors the verifier's exact repro step: regenerate. httpUrl keeps pointing at the hosted
    // endpoint regardless of row.surface — generate.mjs's gemini-cli full_template never reads it.
    generateAll(root, { checkOnly: false });

    const results = await runChecks(root);
    const sdc = findResult(results, "surface_derived_consistent");
    assert.equal(sdc.failures.length, 1, `expected exactly 1 surface_derived_consistent failure, got: ${JSON.stringify(sdc.failures)}`);
    assert.match(sdc.failures[0], /row=gemini-cli/);
    assert.match(sdc.failures[0], /got="local"/);
    assert.match(sdc.failures[0], /derived="hosted"/);

    // Confirm this is genuinely the NEW backstop: surface_claims alone (round 1's own check) is
    // still defeated exactly as the reviewer found — it now skips this row entirely because
    // row.surface !== "hosted". surface_derived_consistent is the mechanism that actually catches it.
    assert.equal(
      findResult(results, "surface_claims").failures.length,
      0,
      "surface_claims alone is still blind to this exact relabel (documented, unchanged behavior) — surface_derived_consistent is the new, independent backstop"
    );
  } finally {
    cleanupFixture(root);
  }
});

test("R2 mirror: the real repo's own (correct) surface labels produce zero surface_derived_consistent failures", async () => {
  const results = await runChecks(GREEN_ROOT);
  assert.equal(findResult(results, "surface_derived_consistent").failures.length, 0);
});

// R2 round-3 fix (brief-O, pr20-round2-review-2026-10-19.md HIGH; this test's own assertion is
// INTENTIONALLY INVERTED from round 2's version, per that review's explicit call-out — round 2's
// test asserted `!failures.some(...)` (a null derivation on this row is NEVER flagged); the review
// showed that is the exact D1 overclaim bug reopened via a 2-field channels.json edit
// (relabel surface "hosted"->"local" + delete surface_peers), with all 17 checks staying green.
// checkSurfaceDerivedConsistent now treats a null derivation on a row with description_field set
// (antigravity-plugin/openai-codex-plugin: their own {name,description}-only manifest can NEVER
// carry a url/stdio signal, so surface_peers is their ONLY path to provability) as a FAIL, not a
// skip — so this test now asserts the opposite of round 2: the mismatch IS caught.
test("R2 round-3 (surface_peers required-by-construction for a row surface_claims inspects): antigravity-plugin's own plugin.json carries no structural signal at all — deleting its surface_peers declaration leaves its claimed surface unprovable, and surface_derived_consistent now FAILS it instead of silently skipping, closing the exact relabel+delete-surface_peers reopening the round-2 review found", async () => {
  const ctx = loadConfig(GREEN_ROOT);
  const row = ctx.channels.rows.find((r) => r.id === "antigravity-plugin");
  assert.deepEqual(row.surface_peers, ["antigravity-mcp-config"], "test setup: this round's channels.json must declare the peer");
  assert.equal(deriveSurfaceForRow(ctx, row), "hosted", "own file (name/description only) has no signal — must resolve via the declared peer");
  assert.ok(row.description_field, "test setup: this row must be one surface_claims actively inspects, or the fix's predicate doesn't apply");

  const root = cloneFixture(GREEN_ROOT);
  try {
    const channels = readJson(root, "distribution/channels.json");
    const row2 = channels.rows.find((r) => r.id === "antigravity-plugin");
    row2.surface = "local"; // the review's exact 2-field attack: relabel...
    delete row2.surface_peers; // ...and delete the only path back to a provable signal
    writeJson(root, "distribution/channels.json", channels);
    generateAll(root, { checkOnly: false }); // regenerate plugin.json's description — still says "browser automation", now unprovably labeled "local" anyway, which is the point: the FAIL must fire even before regeneration, purely because the row is unprovable

    const ctx2 = loadConfig(root);
    const derived = deriveSurfaceForRow(ctx2, row2);
    assert.equal(derived, null, "with no peer declared and no own-file signal, derivation must still be null (undeterminable) — the fix does not fabricate a guess");

    const failures = await checkSurfaceDerivedConsistent(ctx2);
    const rowFailures = failures.filter((f) => f.includes("row=antigravity-plugin"));
    assert.equal(rowFailures.length, 1, `expected exactly 1 surface_derived_consistent failure for the now-unprovable row, got: ${JSON.stringify(failures)}`);
    assert.match(rowFailures[0], /rule=surface_derived_consistent/);
    assert.match(rowFailures[0], /surface_peers/, "the failure must point the maintainer at surface_peers as the fix");
  } finally {
    cleanupFixture(root);
  }
});

test("R2 round-3 mirror: the real repo's correct antigravity-plugin/openai-codex-plugin rows (surface_peers intact) produce zero surface_derived_consistent failures — the fix does not newly flag any row surface_peers already makes provable", async () => {
  const results = await runChecks(GREEN_ROOT);
  const sdc = findResult(results, "surface_derived_consistent");
  assert.equal(sdc.failures.length, 0, `expected zero surface_derived_consistent failures on the real, correct tree, got: ${JSON.stringify(sdc.failures)}`);
});

const EXTERNAL_SAMPLE_ROW = {
  id: "claude-plugins-external",
  kind: "external",
  surface: "hosted",
  external_repo: {
    owner: "NovadaLabs",
    repo: "claude-plugins",
    ref: "main",
    marketplace_path: ".claude-plugin/marketplace.json",
    plugin_path: "plugins/novada-mcp/.claude-plugin/plugin.json",
    mcp_config_path: "plugins/novada-mcp/.mcp.json",
    expected_plugin_name: "novada-mcp",
    mcp_url_field: "/mcpServers/novada/url",
  },
};
const EXTERNAL_SAMPLE_LISTING = { hosted_endpoint: "https://mcp.novada.com/mcp" };
const EXTERNAL_GOOD_MARKETPLACE = JSON.stringify({ name: "novada", plugins: [{ name: "novada-mcp", source: "./plugins/novada-mcp" }] });
const EXTERNAL_GOOD_PLUGIN = JSON.stringify({ name: "novada-mcp", version: "0.9.28" });
const EXTERNAL_GOOD_MCP_CONFIG = JSON.stringify({ mcpServers: { novada: { type: "http", url: "https://mcp.novada.com/mcp" } } });

test("R2 RED (external row): a relabeled surface:\"local\" on claude-plugins-external is caught against the FETCHED .mcp.json's real hosted endpoint — PREDICTED exactly 1 surface_derived_consistent failure", () => {
  const mislabeledRow = { ...EXTERNAL_SAMPLE_ROW, surface: "local" };
  const failures = evaluateExternalRepoManifests(
    mislabeledRow,
    { marketplaceText: EXTERNAL_GOOD_MARKETPLACE, pluginText: EXTERNAL_GOOD_PLUGIN, mcpConfigText: EXTERNAL_GOOD_MCP_CONFIG },
    EXTERNAL_SAMPLE_LISTING
  );
  const surfaceFailures = failures.filter((f) => f.includes("rule=surface_derived_consistent"));
  assert.equal(surfaceFailures.length, 1, `predicted exactly 1 surface_derived_consistent failure, got: ${JSON.stringify(failures)}`);
  assert.match(surfaceFailures[0], /got="local"/);
  assert.match(surfaceFailures[0], /derived="hosted"/);
});

test("R2 mirror (external row): declared surface \"hosted\" matching the fetched .mcp.json's real endpoint produces zero surface_derived_consistent failures", () => {
  const failures = evaluateExternalRepoManifests(
    EXTERNAL_SAMPLE_ROW,
    { marketplaceText: EXTERNAL_GOOD_MARKETPLACE, pluginText: EXTERNAL_GOOD_PLUGIN, mcpConfigText: EXTERNAL_GOOD_MCP_CONFIG },
    EXTERNAL_SAMPLE_LISTING
  );
  assert.deepEqual(failures.filter((f) => f.includes("rule=surface_derived_consistent")), []);
});

// =========================================================================================
// R3 — hosted_hidden_parseable (shared, non-throwing parse step)
// =========================================================================================

test("R3 RED: renaming the HOSTED_HIDDEN literal no longer aborts the whole run with a [check] FATAL — it is now a named hosted_hidden_parseable check FAILURE, and every other check still runs and reports normally", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const path = join(root, "hosted-server", "vercel", "api", "mcp.ts");
    const raw = readFileSync(path, "utf8");
    const mutated = raw.replace("const HOSTED_HIDDEN", "const HOSTED_HIDDEN_RENAMED");
    assert.notEqual(mutated, raw, "test setup: expected to find the HOSTED_HIDDEN literal to rename");
    writeFileSync(path, mutated);

    // Must NOT reject — this is the whole point of the fix (it used to throw out of runChecks).
    const results = await runChecks(root);
    const hh = findResult(results, "hosted_hidden_parseable");
    assert.equal(hh.failures.length, 1, `predicted exactly 1 hosted_hidden_parseable failure, got: ${JSON.stringify(hh.failures)}`);
    assert.match(hh.failures[0], /could not locate/);

    // Every OTHER check still ran and reported normally — nothing was swallowed by the parse failure.
    assert.equal(findResult(results, "version_equal").failures.length, 0, "an unrelated check must still run and report normally");
    assert.equal(findResult(results, "claims_consistent").failures.length, 0, "claims_consistent must degrade gracefully (hosted_tools fact undefined) rather than re-throw");
    assert.deepEqual(findResult(results, "surface_claims").failures, [], "surface_claims must degrade to a clean no-op, never duplicate hosted_hidden_parseable's failure under its own name");
  } finally {
    cleanupFixture(root);
  }
});

test("R3 mirror: an intact HOSTED_HIDDEN literal produces zero hosted_hidden_parseable failures (control)", async () => {
  const results = await runChecks(GREEN_ROOT);
  assert.equal(findResult(results, "hosted_hidden_parseable").failures.length, 0);
});

test("checkHostedHiddenParseable unit: direct call matches runChecks' own result for the same fixture", () => {
  const ctx = loadConfig(GREEN_ROOT);
  assert.deepEqual(checkHostedHiddenParseable(ctx), []);
});

test("R3 (checkSurfaceClaims degrades cleanly, no duplicate failure): with HOSTED_HIDDEN unparseable, checkSurfaceClaims itself reports ZERO failures — hosted_hidden_parseable is already the one named failure, by design", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const path = join(root, "hosted-server", "vercel", "api", "mcp.ts");
    writeFileSync(path, readFileSync(path, "utf8").replace("const HOSTED_HIDDEN", "const HOSTED_HIDDEN_RENAMED"));
    const ctx = loadConfig(root);
    const failures = checkSurfaceClaims(ctx);
    assert.deepEqual(failures, []);
  } finally {
    cleanupFixture(root);
  }
});

test("tryParseHostedHiddenNames unit: never throws — returns {names, error:null} on success and {names:null, error} on failure", () => {
  const ok = tryParseHostedHiddenNames(GREEN_ROOT);
  assert.equal(ok.error, null);
  assert.ok(Array.isArray(ok.names));

  const root = cloneFixture(GREEN_ROOT);
  try {
    rmSync(join(root, "hosted-server", "vercel", "api", "mcp.ts"));
    const bad = tryParseHostedHiddenNames(root);
    assert.equal(bad.names, null);
    assert.ok(bad.error instanceof Error);
    assert.ok(bad.error.agent_instruction);
  } finally {
    cleanupFixture(root);
  }
});
