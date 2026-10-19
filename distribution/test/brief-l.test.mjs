// distribution/test/brief-l.test.mjs — brief-L (2026-10-15): red/green coverage for L1 (raw-text
// JSON duplicate-key scanner now decodes each key literal before dedup), L2 (no_orphans no longer
// prunes distribution/test/** or distribution/research/** wholesale), and L3 (claims_consistent's
// hosted_tools fact now rejects a HOSTED_HIDDEN entry naming a tool that doesn't exist in the
// built registry). L4 (ci.yml job-layout `needs:` guard) lives in distribution/test/
// ci-layout.test.mjs, alongside every other ci.yml-structure test.
//
// Same fixture discipline as the rest of this suite: every mutation happens on a cloned temp
// copy of the shared green fixture (or a hand-crafted in-memory string for findDuplicateJsonKeys'
// own unit tests), never on the real worktree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runChecks, findDuplicateJsonKeys } from "../check.mjs";
import { buildGreenFixture, cloneFixture, cleanupFixture, writeText } from "./fixtures.mjs";

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

// =========================================================================================
// L1 — findDuplicateJsonKeys must decode each key literal (JSON.parse('"'+raw+'"')) before
// comparing it against its scope's already-seen keys, so two keys that DECODE to the same
// string are caught even when their RAW, on-disk escaping differs.
// =========================================================================================

test("findDuplicateJsonKeys unit (brief-L L1): a \\u-escaped duplicate decodes to the SAME key as its unescaped sibling and is caught — PREDICTED exactly 1 duplicate", () => {
  // "name" decodes to "name" — same string as the plain "name" key two lines above it.
  const text = ["{", '  "name": 1,', '  "n\\u0061me": 2', "}"].join("\n");
  const dups = findDuplicateJsonKeys(text);
  assert.equal(dups.length, 1, `predicted exactly 1 duplicate, got: ${JSON.stringify(dups)}`);
  assert.deepEqual(dups[0], { key: "name", firstLine: 2, duplicateLine: 3 });
});

test("findDuplicateJsonKeys unit (brief-L L1): a \\/-escaped duplicate decodes to the SAME key as its unescaped sibling and is caught — PREDICTED exactly 1 duplicate", () => {
  // "a\/b" decodes to "a/b" — same string as the plain "a/b" key two lines above it.
  const text = ["{", '  "a/b": 1,', '  "a\\/b": 2', "}"].join("\n");
  const dups = findDuplicateJsonKeys(text);
  assert.equal(dups.length, 1, `predicted exactly 1 duplicate, got: ${JSON.stringify(dups)}`);
  assert.deepEqual(dups[0], { key: "a/b", firstLine: 2, duplicateLine: 3 });
});

test("findDuplicateJsonKeys unit control (brief-L L1): two keys that decode to DIFFERENT strings are never falsely flagged, even though one of them contains an escape sequence (proves decoding isn't over-matching)", () => {
  // "name2" decodes to "name2" — genuinely different from "name". Zero duplicates expected.
  const text = ["{", '  "name": 1,', '  "n\\u0061me2": 2', "}"].join("\n");
  assert.deepEqual(findDuplicateJsonKeys(text), []);
});

test("json_no_duplicate_keys integration (brief-L L1): a \\u-escaped duplicate of glama.json's top-level \"$schema\" key (identical decoded value) is now caught end to end — PREDICTED exactly 1 total failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const path = join(root, "npm-package", "glama.json");
    // Same "identical value" construction brief-K's own glama.json duplicate-key test uses — this
    // isolates the mutation to json_no_duplicate_keys alone: tamper_evident (glama is a
    // closed_shape row) stays blind by construction because JSON.parse collapses both spellings
    // of the same key down to the SAME value, so the canonical hash never moves.
    writeFileSync(
      path,
      [
        "{",
        '  "$schema": "https://glama.ai/mcp/schemas/server.json",',
        '  "\\u0024schema": "https://glama.ai/mcp/schemas/server.json",',
        '  "maintainers": ["Goldentrii"]',
        "}",
        "",
      ].join("\n")
    );

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 1, `predicted exactly 1 total failure, got:\n${JSON.stringify(results, null, 2)}`);
    const jd = findResult(results, "json_no_duplicate_keys");
    assert.equal(jd.failures.length, 1);
    assert.match(jd.failures[0], /row=glama/);
    assert.match(jd.failures[0], /key="\$schema"/);
    assert.equal(findResult(results, "tamper_evident").failures.length, 0, "tamper_evident is blind here BY CONSTRUCTION — identical decoded value, same as every other json_no_duplicate_keys integration test in this suite");
    assert.equal(findResult(results, "closed_shape").failures.length, 0, "both spellings decode to an already-allowed top-level key (\"$schema\")");

    // mutation probe: skip json_no_duplicate_keys -> its own failure list for this fixture must
    // go to 0 (proves the 1 total failure above is attributable to THIS check, not a coincidence).
    const probed = findResult(await runChecks(root, { skip: new Set(["json_no_duplicate_keys"]) }), "json_no_duplicate_keys");
    assert.equal(probed.failures.length, 0, "disabling json_no_duplicate_keys should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

// =========================================================================================
// L2 — no_orphans must no longer prune distribution/test/** or distribution/research/**
// wholesale; a manifest-pattern-matching file planted in either tree is caught like anywhere
// else in the repo.
// =========================================================================================

test("no_orphans (brief-L L2): a stray manifest-pattern file planted under distribution/test/** is caught, not silently pruned — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    // Exact path named in the brief: distribution/test/evil/mcp.json, relative to this fixture's
    // own synthetic root (never the real worktree's distribution/test/ — fixtures.mjs's own
    // discipline comment applies here too).
    writeText(root, "distribution/test/evil/mcp.json", '{"mcpServers":{}}\n');

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 1, `predicted exactly 1 total failure, got:\n${JSON.stringify(results, null, 2)}`);
    const no = findResult(results, "no_orphans");
    assert.equal(no.failures.length, 1);
    assert.match(no.failures[0], /rule=no_orphans/);
    assert.match(no.failures[0], /distribution\/test\/evil\/mcp\.json/);

    const probed = findResult(await runChecks(root, { skip: new Set(["no_orphans"]) }), "no_orphans");
    assert.equal(probed.failures.length, 0, "disabling no_orphans should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("no_orphans (brief-L L2): a stray manifest-pattern file planted under distribution/research/** is ALSO caught — PREDICTED exactly 1 failure (proves the fix closes BOTH previously-pruned trees, not just one)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "distribution/research/notes/glama.json", "{}\n");

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 1, `predicted exactly 1 total failure, got:\n${JSON.stringify(results, null, 2)}`);
    const no = findResult(results, "no_orphans");
    assert.equal(no.failures.length, 1);
    assert.match(no.failures[0], /distribution\/research\/notes\/glama\.json/);
  } finally {
    cleanupFixture(root);
  }
});

// =========================================================================================
// L3 — claims_consistent's hosted_tools fact must reject a HOSTED_HIDDEN entry naming a tool
// that does not exist in the built npm-package/build/core.js TOOLS registry, instead of
// silently trusting the Set's raw size.
// =========================================================================================

test("computeFacts (brief-L L3): a ghost tool name in HOSTED_HIDDEN throws a typed FATAL error (agent_instruction set), instead of silently under-counting hosted_tools", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    // fixtures.mjs's own HOSTED_HIDDEN seed is exactly ["novada_browser"] (a real, registered
    // tool in this fixture's npm-package/build/core.js). Append a name that is NOT in that
    // registry — a stale/typo'd exclusion.
    const path = join(root, "hosted-server", "vercel", "api", "mcp.ts");
    const raw = readFileSync(path, "utf8");
    const mutated = raw.replace('"novada_browser",', '"novada_browser",\n  "novada_ghost_tool",');
    assert.notEqual(mutated, raw, "test setup: expected to find the HOSTED_HIDDEN seed entry to mutate");
    writeFileSync(path, mutated);

    await assert.rejects(
      () => runChecks(root),
      (err) => {
        assert.match(err.message, /HOSTED_HIDDEN/);
        assert.match(err.message, /novada_ghost_tool/);
        assert.ok(err.agent_instruction, "a config error here must carry an agent_instruction, same as every other thrown claims_consistent/computeFacts error");
        return true;
      }
    );
  } finally {
    cleanupFixture(root);
  }
});

test("computeFacts (brief-L L3) mutation probe: a VALID HOSTED_HIDDEN name (the unmodified fixture seed, \"novada_browser\") never throws — control case proving the guard above only fires on an actual ghost name", async () => {
  // The shared GREEN_ROOT fixture's own HOSTED_HIDDEN is ["novada_browser"], a real tool in its
  // build/core.js — runChecks() must resolve normally (claims_consistent is already exercised by
  // the suite-wide "green fixture: every check passes" test; this test exists locally in this
  // file to make the L3 contrast between "valid name passes" and "ghost name throws" explicit).
  await assert.doesNotReject(() => runChecks(GREEN_ROOT));
});
