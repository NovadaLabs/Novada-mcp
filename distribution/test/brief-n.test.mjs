// distribution/test/brief-n.test.mjs — brief-N (2026-10-19): red/green coverage for an
// independent review's 3 owner decisions on PR #20 (distribution channel registry):
//
//   D1 (HIGH)     surface_claims — a surface:"hosted" row's description must never mention a
//                 HOSTED_HIDDEN tool's capability; a surface:"local" row keeping the phrase is
//                 the documented mirror case.
//   D2 (CRITICAL) external_repo_consistent / isExternalRow — a kind:"external" row's manifest
//                 lives in a different repo; the pure assertion logic is unit-tested directly
//                 (no real network call — see checkExternalRepoConsistent's own ROOT-equality
//                 guard), and the three per-row checks that assume a LOCAL file
//                 (location_rules/shape_declared/ci_paths_cover) must exempt it while still
//                 enforcing normally on every OTHER row.
//   D3            dify-plugin/dify-provider — no_orphans must fail if either row is removed
//                 while its file remains; claims_consistent must fail on a wrong tool count in
//                 distribution/dify/README.md (the new dify_tools fact).
//
// Same fixture discipline as the rest of this suite: every mutation happens on a cloned temp
// copy of the shared green fixture, never on the real worktree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

import { runChecks, loadConfig, evaluateExternalRepoManifests, checkExternalRepoConsistent, isExternalRow, ROOT } from "../check.mjs";
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

function writeTextDeep(root, relPath, content) {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

// =========================================================================================
// D1 — surface_claims
// =========================================================================================

test("D1 RED: a surface:\"hosted\" row's description mentioning the forbidden HOSTED_HIDDEN capability phrase is caught — PREDICTED exactly 2 failures (surface_claims + generated_clean, since the hand-edit no longer matches the resolved description_hosted rebuild)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const ext = readJson(root, "gemini-extension.json");
    ext.description = "AI agents' single API key for web search and browser automation.";
    writeJson(root, "gemini-extension.json", ext);

    const results = await runChecks(root);
    const sc = findResult(results, "surface_claims");
    assert.equal(sc.failures.length, 1, `expected exactly 1 surface_claims failure, got: ${JSON.stringify(sc.failures)}`);
    assert.match(sc.failures[0], /row=gemini-cli/);
    assert.match(sc.failures[0], /browser automation/);
    assert.equal(findResult(results, "generated_clean").failures.length, 1, "the hand-edited description no longer matches resolveDescriptionForRow's rebuild — a cascade, not a surprise");
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);

    // Mutation probe: skip surface_claims -> its own failure list for this fixture must go to 0.
    const probed = findResult(await runChecks(root, { skip: new Set(["surface_claims"]) }), "surface_claims");
    assert.equal(probed.failures.length, 0, "disabling surface_claims should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("D1 mirror: a surface:\"local\" row (smithery) keeping the browser-automation phrase is NOT flagged — control case proving surface_claims only ever inspects surface:\"hosted\" rows", async () => {
  const results = await runChecks(GREEN_ROOT);
  const channels = readJson(GREEN_ROOT, "distribution/channels.json");
  const smitheryRow = channels.rows.find((r) => r.id === "smithery");
  assert.equal(smitheryRow.surface, "local", "test setup: smithery must be surface:\"local\"");
  const smitheryYaml = readFileSync(join(GREEN_ROOT, "npm-package", "smithery.yaml"), "utf8");
  assert.match(smitheryYaml, /description:.*browser automation/, "test setup: the fixture's own generated smithery.yaml description must still carry the phrase");
  assert.equal(findResult(results, "surface_claims").failures.length, 0);
});

// =========================================================================================
// D2 — external_repo_consistent (pure logic) / isExternalRow (per-row exemptions)
// =========================================================================================

const SAMPLE_ROW = {
  id: "claude-plugins-external",
  kind: "external",
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
const SAMPLE_LISTING = { hosted_endpoint: "https://mcp.novada.com/mcp" };
const GOOD_MARKETPLACE = JSON.stringify({ name: "novada", plugins: [{ name: "novada-mcp", source: "./plugins/novada-mcp" }] });
const GOOD_PLUGIN = JSON.stringify({ name: "novada-mcp", version: "0.9.28" });
const GOOD_MCP_CONFIG = JSON.stringify({ mcpServers: { novada: { type: "http", url: "https://mcp.novada.com/mcp" } } });

test("D2 (evaluateExternalRepoManifests) GREEN: all three files correct returns zero failures", () => {
  const failures = evaluateExternalRepoManifests(
    SAMPLE_ROW,
    { marketplaceText: GOOD_MARKETPLACE, pluginText: GOOD_PLUGIN, mcpConfigText: GOOD_MCP_CONFIG },
    SAMPLE_LISTING
  );
  assert.deepEqual(failures, []);
});

test("D2 RED: a renamed plugin.json name is caught — PREDICTED exactly 1 failure", () => {
  const badPlugin = JSON.stringify({ name: "novada-mcp-renamed", version: "0.9.28" });
  const failures = evaluateExternalRepoManifests(
    SAMPLE_ROW,
    { marketplaceText: GOOD_MARKETPLACE, pluginText: badPlugin, mcpConfigText: GOOD_MCP_CONFIG },
    SAMPLE_LISTING
  );
  assert.equal(failures.length, 1, `predicted exactly 1 failure, got: ${JSON.stringify(failures)}`);
  assert.match(failures[0], /field=name/);
  assert.match(failures[0], /got="novada-mcp-renamed"/);
});

test("D2 RED: an .mcp.json pointed at the wrong URL is caught — PREDICTED exactly 1 failure", () => {
  const badMcpConfig = JSON.stringify({ mcpServers: { novada: { type: "http", url: "https://evil-fork.example.com/mcp" } } });
  const failures = evaluateExternalRepoManifests(
    SAMPLE_ROW,
    { marketplaceText: GOOD_MARKETPLACE, pluginText: GOOD_PLUGIN, mcpConfigText: badMcpConfig },
    SAMPLE_LISTING
  );
  assert.equal(failures.length, 1, `predicted exactly 1 failure, got: ${JSON.stringify(failures)}`);
  assert.match(failures[0], /field=\/mcpServers\/novada\/url/);
  assert.match(failures[0], /want="https:\/\/mcp\.novada\.com\/mcp"/);
});

test("D2 RED: an unparseable marketplace.json (repo root missing/broken) is caught — PREDICTED exactly 1 failure", () => {
  const failures = evaluateExternalRepoManifests(
    SAMPLE_ROW,
    { marketplaceText: "404: not found", pluginText: GOOD_PLUGIN, mcpConfigText: GOOD_MCP_CONFIG },
    SAMPLE_LISTING
  );
  assert.equal(failures.length, 1, `predicted exactly 1 failure, got: ${JSON.stringify(failures)}`);
  assert.match(failures[0], /marketplace\.json does not exist or does not parse/);
});

test("D2 RED: multiple independent breaks (wrong name AND wrong url) are ALL reported, never just the first", () => {
  const badPlugin = JSON.stringify({ name: "wrong-name", version: "0.9.28" });
  const badMcpConfig = JSON.stringify({ mcpServers: { novada: { type: "http", url: "https://evil.example.com/mcp" } } });
  const failures = evaluateExternalRepoManifests(
    SAMPLE_ROW,
    { marketplaceText: GOOD_MARKETPLACE, pluginText: badPlugin, mcpConfigText: badMcpConfig },
    SAMPLE_LISTING
  );
  assert.equal(failures.length, 2, `predicted exactly 2 failures, got: ${JSON.stringify(failures)}`);
});

test("D2: checkExternalRepoConsistent never performs a network call against a non-real root (every fixture in this suite) — deterministic, not flaky", async () => {
  const ctx = loadConfig(GREEN_ROOT);
  assert.notEqual(ctx.root, ROOT, "test setup: the fixture root must differ from the real repo root");
  const failures = await checkExternalRepoConsistent(ctx);
  assert.deepEqual(failures, [], "a non-ROOT ctx must short-circuit to zero failures with no network attempt");
});

test("D2 isExternalRow exemption: location_rules/shape_declared/ci_paths_cover all skip the claude-plugins-external row in the green fixture (it has no local file by design) while every OTHER row is still fully enforced", async () => {
  const channels = readJson(GREEN_ROOT, "distribution/channels.json");
  const externalRow = channels.rows.find((r) => r.id === "claude-plugins-external");
  assert.ok(externalRow, "test setup: the fixture's copied real channels.json must carry the claude-plugins-external row");
  assert.ok(isExternalRow(externalRow), "isExternalRow must recognize this row's kind:\"external\"");
  const results = await runChecks(GREEN_ROOT);
  for (const name of ["location_rules", "shape_declared", "ci_paths_cover"]) {
    const r = findResult(results, name);
    assert.ok(
      !r.failures.some((f) => f.includes("claude-plugins-external")),
      `${name} must never mention claude-plugins-external (its file lives in a different repo) — got: ${JSON.stringify(r.failures)}`
    );
  }
});

test("D2 isExternalRow mirror: a NON-external row missing its file is still caught by location_rules exactly as before (the exemption is row-specific, not a blanket skip)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    rmSync(join(root, "npm-package", "glama.json"));
    const results = await runChecks(root);
    const lr = findResult(results, "location_rules");
    assert.ok(lr.failures.some((f) => f.includes("glama.json")), "a normal row's missing file must still be reported");
  } finally {
    cleanupFixture(root);
  }
});

// =========================================================================================
// D3 — dify-plugin / dify-provider
// =========================================================================================

test("D3 RED: removing the dify-plugin row while distribution/dify/manifest.yaml stays on disk makes no_orphans FAIL (mirror test required by this round's brief)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const channels = readJson(root, "distribution/channels.json");
    channels.rows = channels.rows.filter((r) => r.id !== "dify-plugin");
    writeJson(root, "distribution/channels.json", channels);

    const results = await runChecks(root);
    const no = findResult(results, "no_orphans");
    assert.equal(no.failures.length, 1, `expected exactly 1 no_orphans failure, got: ${JSON.stringify(no.failures)}`);
    assert.match(no.failures[0], /distribution\/dify\/manifest\.yaml/);
  } finally {
    cleanupFixture(root);
  }
});

test("D3 RED: removing the dify-provider row while distribution/dify/provider/novada.yaml stays on disk makes no_orphans FAIL", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const channels = readJson(root, "distribution/channels.json");
    channels.rows = channels.rows.filter((r) => r.id !== "dify-provider");
    writeJson(root, "distribution/channels.json", channels);

    const results = await runChecks(root);
    const no = findResult(results, "no_orphans");
    assert.equal(no.failures.length, 1, `expected exactly 1 no_orphans failure, got: ${JSON.stringify(no.failures)}`);
    assert.match(no.failures[0], /distribution\/dify\/provider\/novada\.yaml/);
  } finally {
    cleanupFixture(root);
  }
});

// check.mjs's claims_consistent skips any match below MIN_CLAIM_VALUE (10) outright (see that
// file's own comment) — so this fixture needs >=10 real tool manifests for a claim about them to
// even be evaluated at all, not silently skipped as a per-category/UI-counter-sized number.
const SYNTHETIC_DIFY_TOOL_COUNT = 11;
function seedSyntheticDifyTools(root) {
  for (let i = 0; i < SYNTHETIC_DIFY_TOOL_COUNT; i++) {
    writeText(root, `distribution/dify/tools/novada_tool_${i}.yaml`, `identity:\n  name: novada_tool_${i}\n`);
  }
}

test("D3 RED: a wrong tool count in distribution/dify/README.md makes claims_consistent FAIL (mirror test required by this round's brief) — dify_tools is derived from distribution/dify/tools/*.yaml, never hardcoded", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    seedSyntheticDifyTools(root); // dify_tools fact = 11 for this fixture
    writeText(root, "distribution/dify/README.md", "This plugin wires 15 tools from novada-mcp.\n");

    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.ok(
      cc.failures.some((f) => f.includes("distribution/dify/README.md") && f.includes("fact=dify_tools") && f.includes("got=15") && f.includes(`want=${SYNTHETIC_DIFY_TOOL_COUNT}`)),
      `expected a dify_tools claims_consistent failure (got=15 want=${SYNTHETIC_DIFY_TOOL_COUNT}), got: ${JSON.stringify(cc.failures)}`
    );
  } finally {
    cleanupFixture(root);
  }
});

test("D3 mirror: a CORRECT tool count in distribution/dify/README.md passes claims_consistent — control case proving the fact (not just the check's existence) is real", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    seedSyntheticDifyTools(root); // dify_tools fact = 11 for this fixture
    writeText(root, "distribution/dify/README.md", `This plugin wires ${SYNTHETIC_DIFY_TOOL_COUNT} tools from novada-mcp.\n`);

    const results = await runChecks(root);
    assert.equal(findResult(results, "claims_consistent").failures.length, 0);
  } finally {
    cleanupFixture(root);
  }
});
