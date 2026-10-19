// distribution/test/brief-k.test.mjs — brief-K (2026-10-15): red/green coverage for K1
// (dynamic/format pins — originally on marketplace.json's plugins[0].source.url/.sha, migrated
// brief-N 2026-10-19 to server.json's remotes[0].url/packages[0].version, see K1's own section
// comment below — + the reviewer-visible pinned-hashes.json branch-diff summary), K2 (the
// raw-text JSON duplicate-key scanner), and K4 (the claim_excludes match-count summary). K3 (the
// ci.yml job-layout fix) has its own dedicated file, distribution/test/ci-layout.test.mjs.
//
// Same fixture discipline as the rest of this suite: every mutation happens on a cloned temp
// copy of the shared green fixture (or a hand-crafted in-memory string for findDuplicateJsonKeys'
// own unit tests), never on the real worktree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runChecks, findDuplicateJsonKeys, computePinnedHashesBranchSummary, collectClaimExcludeSummary } from "../check.mjs";
import { readPinnedHashes, repinRow, generateAll } from "../generate.mjs";
import { buildGreenFixture, cloneFixture, cleanupFixture, readJson, writeJson, writeText } from "./fixtures.mjs";

const REAL_DISTRIBUTION_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..");

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

/** Inserts an exact duplicate of the (single-line) "key": value entry for `key` directly after
 *  its first occurrence — raw TEXT manipulation, deliberately NOT via JSON.parse/stringify
 *  (which cannot represent a duplicate key at all; that is exactly the hole this finding is
 *  about). `key` must not be the LAST property in its object (so the original line already
 *  carries its own trailing comma — duplicating it then yields two valid, comma-separated
 *  sibling key/value pairs). */
function injectDuplicateJsonKeyLine(raw, key) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*"${esc}":.*$`, "m");
  const m = raw.match(re);
  assert.ok(m, `test setup: expected to find a "${key}": ... line in the target file`);
  return raw.replace(re, (line) => `${line}\n${line}`);
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed (status ${result.status}): ${result.stderr}`);
  return result.stdout;
}

/** Makes a fixture root CLI-runnable — copies the REAL distribution/check.mjs and
 *  distribution/generate.mjs into <root>/distribution/, same technique as
 *  distribution/test/check-cli.test.mjs's own makeCliRunnable (duplicated here rather than
 *  imported, since that file does not export it — a 2-line helper, not worth a shared-module
 *  refactor for this round's scope). */
function makeCliRunnable(root) {
  cpSync(join(REAL_DISTRIBUTION_DIR, "check.mjs"), join(root, "distribution", "check.mjs"));
  cpSync(join(REAL_DISTRIBUTION_DIR, "generate.mjs"), join(root, "distribution", "generate.mjs"));
  return root;
}

function runCheckMjsCli(root) {
  return spawnSync(process.execPath, [join(root, "distribution", "check.mjs")], { encoding: "utf8" });
}

// =========================================================================================
// K1 — dynamic pins on server.json's remotes[0].url (pinned_fields_template) and
// packages[0].version (pinned_fields_format).
//
// brief-N (2026-10-19, D2 — independent review of PR #20): this section originally exercised
// npm-package/.claude-plugin/marketplace.json's plugins[0].source.url/.sha — that row
// (claude-code-marketplace) was retired (replaced by the external, kind:"external"
// claude-plugins-external row, which has no local file and no closed_shape to pin at all).
// mcp-registry's server.json migrated the SAME two pin mechanisms onto its own
// remotes[0].url/packages[0].version (see that row's pinned_fields_template/pinned_fields_format
// in distribution/channels.json) specifically so this mechanism keeps a real, exercised
// production row — every test below is the identical attack shape, repointed.
// =========================================================================================

test("K1 attack: server.json repository.url swapped to a fork — PREDICTED exactly 2 failures (closed_shape(pinned_template) + tamper_evident, since the whole-file hash also moves)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const sj = readJson(root, "npm-package/server.json");
    sj.repository.url = "https://github.com/evil-fork/novada-mcp";
    writeJson(root, "npm-package/server.json", sj);

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    // repository.url is NOT this row's url_field (/remotes/0/url, the HOSTED endpoint — already
    // separately covered by endpoint_equal + a static pinned_fields entry) — it is neither
    // version_field/name_field/description_field/url_field, so it is NOT excluded from
    // tamper_evident's hash the way those four are. PREDICTED exactly 2, the SAME shape the
    // retired marketplace.json/source.url example (brief-K K1's original) demonstrated.
    assert.equal(total, 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1);
    assert.match(cs.failures[0], /pinned_template/);
    assert.match(cs.failures[0], /repository\/url/);
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 1);
    assert.match(te.failures[0], /row=mcp-registry/);
    assert.equal(findResult(results, "endpoint_equal").failures.length, 0, "endpoint_equal only ever reads THIS row's url_field, /remotes/0/url — untouched by this mutation");

    // Mutation probe: with tamper_evident disabled, the template pin ALONE still catches this.
    const probed = await runChecks(root, { skip: new Set(["tamper_evident"]) });
    const probedTotal = probed.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(probedTotal, 1, "disabling tamper_evident should leave exactly the pinned_template failure");
  } finally {
    cleanupFixture(root);
  }
});

test("K1 attack (the concrete hole this finding names): a fork-swap repository.url survives --repin on tamper_evident, but closed_shape(pinned_template) still catches it — PREDICTED exactly 1 failure after repin", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const sj = readJson(root, "npm-package/server.json");
    sj.repository.url = "https://github.com/evil-fork/novada-mcp";
    writeJson(root, "npm-package/server.json", sj);

    // Before this round's fix, running --repin here would have made EVERY check pass, laundering
    // the tamper through the same command a legitimate maintainer would run.
    const channels = readJson(root, "distribution/channels.json");
    const registryRow = channels.rows.find((r) => r.id === "mcp-registry");
    const pinned = readPinnedHashes(root);
    repinRow(root, registryRow, pinned);
    writeJson(root, "distribution/pinned-hashes.json", pinned);

    const results = await runChecks(root);
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 0, "tamper_evident must accept the repinned content as its new baseline — this is expected, not the bug");
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1, "closed_shape(pinned_template) must STILL catch the fork swap, independent of what pinned-hashes.json says");
    assert.match(cs.failures[0], /pinned_template/);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 1, `predicted exactly 1 total failure after repin, got:\n${JSON.stringify(results, null, 2)}`);
  } finally {
    cleanupFixture(root);
  }
});

test("K1 attack: server.json packages[0].version tampered to a non-semver string — PREDICTED exactly 2 failures (closed_shape(pinned_format) + tamper_evident)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const sj = readJson(root, "npm-package/server.json");
    // version_equal checks the TOP-LEVEL "/version" pointer only (a separate pointer from this
    // one — see distribution/channels.json's mcp-registry row) — left untouched here, so this
    // attack isolates packages[0].version's OWN pin, pinned_fields_format, same isolation
    // reasoning as every other single-field attack in this suite.
    sj.packages[0].version = "not-a-real-version";
    writeJson(root, "npm-package/server.json", sj);

    const results = await runChecks(root);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1);
    assert.match(cs.failures[0], /pinned_format/);
    assert.match(cs.failures[0], /packages\/0\/version/);
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 1);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    assert.equal(findResult(results, "version_equal").failures.length, 0, "version_equal checks a DIFFERENT pointer (top-level /version) and must stay green");

    const probed = await runChecks(root, { skip: new Set(["tamper_evident"]) });
    const probedTotal = probed.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(probedTotal, 1, "disabling tamper_evident should leave exactly the pinned_format failure");
  } finally {
    cleanupFixture(root);
  }
});

test("K1 attack: server.json packages[0].version tampered to a prerelease suffix (same prefix, still wrong format) is still caught by the pinned format — PREDICTED exactly 2 failures", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const sj = readJson(root, "npm-package/server.json");
    // Looks almost right (same major.minor.patch prefix as the fixture's real version) — this
    // attack needs a value that is CLOSE to legitimate, not obviously wrong, to meaningfully
    // exercise the format pin rather than something any check would catch by inspection alone.
    sj.packages[0].version = `${sj.packages[0].version}-rc1`;
    writeJson(root, "npm-package/server.json", sj);

    const results = await runChecks(root);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1);
    assert.match(cs.failures[0], /pinned_format/);
    const te = findResult(results, "tamper_evident");
    assert.equal(te.failures.length, 1);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
  } finally {
    cleanupFixture(root);
  }
});

test("K1 attack: re-repinning after a version-format tamper does not launder it either — PREDICTED exactly 1 failure after repin (closed_shape(pinned_format) alone)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const sj = readJson(root, "npm-package/server.json");
    sj.packages[0].version = "1.2"; // valid-looking digits, but the wrong SHAPE (missing a segment)
    writeJson(root, "npm-package/server.json", sj);

    const channels = readJson(root, "distribution/channels.json");
    const registryRow = channels.rows.find((r) => r.id === "mcp-registry");
    const pinned = readPinnedHashes(root);
    repinRow(root, registryRow, pinned);
    writeJson(root, "distribution/pinned-hashes.json", pinned);

    const results = await runChecks(root);
    assert.equal(findResult(results, "tamper_evident").failures.length, 0);
    const cs = findResult(results, "closed_shape");
    assert.equal(cs.failures.length, 1);
    assert.match(cs.failures[0], /pinned_format/);
    assert.equal(findResult(results, "version_equal").failures.length, 0, "version_equal checks a DIFFERENT pointer (top-level /version), unaffected by this repin");
  } finally {
    cleanupFixture(root);
  }
});

test("K1 control: the real repo's own server.json repository.url/packages[0].version pass both new pins cleanly (green fixture already proves this, re-asserted directly against the real worktree's files for extra confidence)", () => {
  const realChannels = JSON.parse(readFileSync(join(REAL_DISTRIBUTION_DIR, "channels.json"), "utf8"));
  const realListing = JSON.parse(readFileSync(join(REAL_DISTRIBUTION_DIR, "listing.json"), "utf8"));
  const realServerJson = JSON.parse(readFileSync(join(REAL_DISTRIBUTION_DIR, "..", "npm-package", "server.json"), "utf8"));
  const row = realChannels.rows.find((r) => r.id === "mcp-registry");
  assert.equal(realServerJson.repository.url, realListing.repository, "the real server.json's repository.url must already equal listing.repository");
  assert.match(
    realServerJson.packages[0].version,
    new RegExp(row.pinned_fields_format["/packages/0/version"]),
    "the real server.json's packages[0].version must already look like semver"
  );
});

// =========================================================================================
// K1 — the reviewer-visible pinned-hashes.json branch-diff summary (git merge-base HEAD
// origin/main), printed unconditionally by check.mjs's CLI.
// =========================================================================================

test("K1 branch summary: a legitimate repinned edit shows up as 'changed in this branch' against a fixture git repo's merge-base", () => {
  const root = makeCliRunnable(cloneFixture(GREEN_ROOT));
  try {
    git(root, ["init", "-q"]);
    git(root, ["add", "-A"]);
    git(root, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "baseline"]);
    const baselineSha = git(root, ["rev-parse", "HEAD"]).trim();
    git(root, ["update-ref", "refs/remotes/origin/main", baselineSha]);

    // A legitimate, reviewed content change to smithery.yaml (same pattern as brief-j.test.mjs's
    // "J1 green" test) — then repin it, exactly the real maintenance workflow.
    const smitheryPath = join(root, "npm-package", "smithery.yaml");
    const raw = readFileSync(smitheryPath, "utf8");
    writeFileSync(smitheryPath, raw + '  - name: novada_new_tool\n    description: "A brand-new, legitimately reviewed tool entry."\n');
    const channels = readJson(root, "distribution/channels.json");
    const smitheryRow = channels.rows.find((r) => r.id === "smithery");
    const pinned = readPinnedHashes(root);
    const oldHash = pinned.smithery.sha256;
    const newHash = repinRow(root, smitheryRow, pinned);
    writeJson(root, "distribution/pinned-hashes.json", pinned);

    git(root, ["add", "-A"]);
    git(root, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "repin smithery"]);

    const result = runCheckMjsCli(root);
    assert.equal(result.status, 0, `expected exit 0 (a repinned legitimate edit should pass every check), got ${result.status}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`tamper_evident\\(branch-summary\\): 1 hand-authored manifest\\(s\\) changed in this branch \\(merge-base ${baselineSha}\\):`));
    assert.match(result.stdout, new RegExp(`tamper_evident\\(branch-summary\\):\\s+smithery ${oldHash} -> ${newHash}`));
    // The other closed_shape rows were untouched — they must NOT appear in the changed list.
    for (const otherRow of ["mcp-registry", "glama", "dify-plugin", "dify-provider"]) {
      assert.doesNotMatch(result.stdout, new RegExp(`tamper_evident\\(branch-summary\\):\\s+${otherRow} `));
    }
  } finally {
    cleanupFixture(root);
  }
});

test("K1 branch summary: when git/origin-main is unavailable (not a git work tree at all), check.mjs reports the summary as SKIPPED rather than failing or staying silent", () => {
  const root = makeCliRunnable(cloneFixture(GREEN_ROOT));
  try {
    const result = runCheckMjsCli(root);
    assert.equal(result.status, 0, `expected exit 0 (green fixture, unrelated to this summary), got ${result.status}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /tamper_evident\(branch-summary\): skipped —/);
  } finally {
    cleanupFixture(root);
  }
});

// =========================================================================================
// K2 — the raw-text JSON duplicate-key scanner (findDuplicateJsonKeys unit tests, then
// json_no_duplicate_keys integration against real manifest shapes).
// =========================================================================================

test("findDuplicateJsonKeys unit: no duplicates anywhere returns an empty array", () => {
  assert.deepEqual(findDuplicateJsonKeys('{\n  "a": 1,\n  "b": 2\n}'), []);
});

test("findDuplicateJsonKeys unit: a top-level duplicate key is reported with correct 1-based line numbers", () => {
  const text = ['{', '  "a": 1,', '  "a": 2', "}"].join("\n");
  const dups = findDuplicateJsonKeys(text);
  assert.equal(dups.length, 1);
  assert.deepEqual(dups[0], { key: "a", firstLine: 2, duplicateLine: 3 });
});

test("findDuplicateJsonKeys unit: a key duplicated inside a NESTED object is caught at its own nesting level, not confused with the outer object", () => {
  const text = ["{", '  "outer": {', '    "x": 1,', '    "x": 2', "  }", "}"].join("\n");
  const dups = findDuplicateJsonKeys(text);
  assert.equal(dups.length, 1);
  assert.deepEqual(dups[0], { key: "x", firstLine: 3, duplicateLine: 4 });
});

test("findDuplicateJsonKeys unit control: the SAME key name across SIBLING objects inside an array is NOT a duplicate (normal, every-element-has-a-name shape)", () => {
  const text = ["{", '  "arr": [', '    { "name": "a" },', '    { "name": "b" }', "  ]", "}"].join("\n");
  assert.deepEqual(findDuplicateJsonKeys(text), []);
});

test("findDuplicateJsonKeys unit: an escaped quote inside a string VALUE does not confuse the scanner into losing track of object boundaries or the duplicate key", () => {
  const text = ["{", '  "desc": "a \\"quoted\\" value",', '  "desc": "second"', "}"].join("\n");
  const dups = findDuplicateJsonKeys(text);
  assert.equal(dups.length, 1);
  assert.deepEqual(dups[0], { key: "desc", firstLine: 2, duplicateLine: 3 });
});

test("findDuplicateJsonKeys unit: THREE occurrences of the same key report TWO duplicate entries (2nd-vs-1st, 3rd-vs-1st), not just one", () => {
  const text = ["{", '  "a": 1,', '  "a": 2,', '  "a": 3', "}"].join("\n");
  const dups = findDuplicateJsonKeys(text);
  assert.equal(dups.length, 2);
  assert.deepEqual(dups[0], { key: "a", firstLine: 2, duplicateLine: 3 });
  assert.deepEqual(dups[1], { key: "a", firstLine: 2, duplicateLine: 4 });
});

// --- integration: duplicate key in server.json, marketplace.json, glama.json (closed_shape
// rows, each with a DIFFERENT generated_clean exposure), and one json-full row.

test("json_no_duplicate_keys: a duplicate top-level key (identical value) in server.json (mcp-registry, generated_by != generate.mjs) — PREDICTED exactly 1 failure (json_no_duplicate_keys only; generated_clean never touches this row at all, tamper_evident is blind because JSON.parse collapses to the SAME value)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const path = join(root, "npm-package", "server.json");
    writeFileSync(path, injectDuplicateJsonKeyLine(readFileSync(path, "utf8"), "description"));

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 1, `predicted exactly 1 total failure, got:\n${JSON.stringify(results, null, 2)}`);
    const jd = findResult(results, "json_no_duplicate_keys");
    assert.equal(jd.failures.length, 1);
    assert.match(jd.failures[0], /row=mcp-registry/);
    assert.match(jd.failures[0], /key="description"/);
    assert.equal(findResult(results, "tamper_evident").failures.length, 0, "tamper_evident is blind here BY CONSTRUCTION — this is the concrete gap K2 closes");
    assert.equal(findResult(results, "closed_shape").failures.length, 0);
  } finally {
    cleanupFixture(root);
  }
});

test("json_no_duplicate_keys: a duplicate top-level key (identical value) in glama.json (generated_by: null) — PREDICTED exactly 1 failure", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const path = join(root, "npm-package", "glama.json");
    writeFileSync(path, injectDuplicateJsonKeyLine(readFileSync(path, "utf8"), "$schema"));

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 1, `predicted exactly 1 total failure, got:\n${JSON.stringify(results, null, 2)}`);
    const jd = findResult(results, "json_no_duplicate_keys");
    assert.equal(jd.failures.length, 1);
    assert.match(jd.failures[0], /row=glama/);
    assert.match(jd.failures[0], /key="\$schema"/);
  } finally {
    cleanupFixture(root);
  }
});

// brief-N (2026-10-19, D2): the retired npm-package/.claude-plugin/marketplace.json row
// (claude-code-marketplace) was this suite's ONLY "closed_shape AND generate.mjs-owned via
// json-owned-fields" example — no remaining production row has that exact combination (every
// remaining generate.mjs-owned JSON row is writer_kind "json-full", not "json-owned-fields";
// "json-owned-fields" itself is still a live, generic WRITERS entry in generate.mjs, just
// currently unused by any row). Rather than silently dropping coverage of this interaction, this
// test builds a fully SYNTHETIC, minimal distribution tree (not distribution/test/fixtures.mjs's
// shared green fixture, which always copies the REAL channels.json) with one hand-built row
// carrying exactly that shape, proving the interaction itself (a json-owned-fields writer's
// text-rebuild byte-differs from a duplicated-key raw file even though parsed VALUES match) is
// still real and still caught, independent of which production row (if any) currently exercises
// it.
function buildSyntheticJsonOwnedFieldsRoot() {
  const root = mkdtempSync(join(tmpdir(), "novada-dist-synthetic-"));
  const channels = {
    version_source: "npm-package/package.json#/version",
    manifest_patterns: [],
    known_orphans: [],
    claim_surfaces: [],
    claim_excludes: [],
    claims: [],
    rows: [
      {
        id: "synthetic-json-owned",
        path: "thing.json",
        location_rule: "thing.json must exist.",
        writer_kind: "json-owned-fields",
        owned_fields: ["/name"],
        version_field: null,
        name_field: "/name",
        description_field: null,
        generated_by: "distribution/generate.mjs",
        closed_shape: { "": ["name", "other"] },
        closed_shape_reason: "synthetic test row.",
        install_snippet: "n/a",
      },
    ],
  };
  writeTextDeep(root, "distribution/channels.json", JSON.stringify(channels, null, 2) + "\n");
  writeTextDeep(root, "distribution/listing.json", JSON.stringify({ name: "x", description: "y", hosted_endpoint: "https://example.com/mcp" }, null, 2) + "\n");
  writeTextDeep(root, "npm-package/package.json", JSON.stringify({ name: "x", version: "1.0.0" }, null, 2) + "\n");
  writeTextDeep(root, "thing.json", JSON.stringify({ name: "placeholder", other: 1 }, null, 2) + "\n");
  writeTextDeep(root, ".github/workflows/ci.yml", "name: CI\non:\n  push:\n    branches: [main]\n");
  // Establish a fully clean baseline (owned field written, distribution/INSTALL.md generated)
  // through the REAL write path BEFORE the test's own mutation — same discipline as
  // fixtures.mjs's buildGreenFixture, so this synthetic root starts from "green by construction",
  // not a hand-guessed expected value.
  generateAll(root, { checkOnly: false });
  const pinned = {};
  repinRow(root, channels.rows[0], pinned);
  writeTextDeep(root, "distribution/pinned-hashes.json", JSON.stringify(pinned, null, 2) + "\n");
  return root;
}

test("json_no_duplicate_keys (synthetic): a duplicate top-level key (identical value) in a json-owned-fields + closed_shape row — PREDICTED exactly 2 failures (json_no_duplicate_keys + generated_clean, since the owned-fields writer's text-rebuild byte-differs from the duplicated raw file even though the parsed VALUES are identical)", async () => {
  const root = buildSyntheticJsonOwnedFieldsRoot();
  try {
    const path = join(root, "thing.json");
    writeFileSync(path, injectDuplicateJsonKeyLine(readFileSync(path, "utf8"), "name"));

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const jd = findResult(results, "json_no_duplicate_keys");
    assert.equal(jd.failures.length, 1);
    assert.match(jd.failures[0], /row=synthetic-json-owned/);
    assert.match(jd.failures[0], /key="name"/);
    assert.equal(findResult(results, "generated_clean").failures.length, 1, "the duplicated raw bytes differ from the canonical json-owned-fields rewrite, even though parsed values match — PREDICTED, not a surprise");
    assert.equal(findResult(results, "tamper_evident").failures.length, 0, "tamper_evident parses first, same identical-value blind spot as the server.json case");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("json_no_duplicate_keys: a duplicate key (identical value) in a json-full row (gemini-cli/gemini-extension.json) — PREDICTED exactly 2 failures (json_no_duplicate_keys + generated_clean, since json-full's generated_clean is an exact-TEXT diff against the full rebuild, which the extra duplicated line always differs from byte-for-byte)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    // brief-N (2026-10-19, D2): gemini-extension.json replaces the retired
    // npm-package/.claude-plugin/plugin.json as this suite's generic json-full example.
    const path = join(root, "gemini-extension.json");
    writeFileSync(path, injectDuplicateJsonKeyLine(readFileSync(path, "utf8"), "version"));

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const jd = findResult(results, "json_no_duplicate_keys");
    assert.equal(jd.failures.length, 1);
    assert.match(jd.failures[0], /row=gemini-cli/);
    assert.match(jd.failures[0], /key="version"/);
    assert.equal(findResult(results, "generated_clean").failures.length, 1);
  } finally {
    cleanupFixture(root);
  }
});

test("json_no_duplicate_keys control: a smithery.yaml (YAML, not JSON) nested same-named field is NOT scanned by this JSON-only check (yamlLooksValid's OWN top-level duplicate-key detection is a separate, pre-existing mechanism, out of this check's scope)", async () => {
  const results = await runChecks(GREEN_ROOT);
  assert.equal(findResult(results, "json_no_duplicate_keys").failures.length, 0, "the green fixture's smithery.yaml carries a nested 'description:' field with the SAME name as the top-level one by design (see fixtures.mjs) — json_no_duplicate_keys must not misfire on a YAML file at all");
});

// =========================================================================================
// K4 — the claim_excludes match-count summary.
// =========================================================================================

test("collectClaimExcludeSummary: reports zero matches for an exclude glob before a matching file exists, then exactly 1 after adding one", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const channels = readJson(root, "distribution/channels.json");
    const glob = "npm-package/docs/competitive/**";
    assert.ok(channels.claim_excludes.some((e) => e.glob === glob), "test setup: this glob must exist in the real channels.json's claim_excludes");

    const before = await collectClaimExcludeSummary(root);
    assert.equal(before.length, channels.claim_excludes.length);
    for (const entry of before) {
      assert.ok(typeof entry.reason === "string" && entry.reason.length > 0, `every exclude summary entry must carry a non-empty reason (glob ${entry.glob})`);
    }
    const beforeEntry = before.find((e) => e.glob === glob);
    assert.ok(beforeEntry, `expected a summary entry for glob ${glob}`);
    assert.equal(beforeEntry.matchedCount, 0, "this fixture has no npm-package/docs/competitive/** files yet");

    writeText(root, "npm-package/docs/competitive/old-research.md", "# Old research\n\nnovada-mcp shipped 999 tools at the time.\n");
    const after = await collectClaimExcludeSummary(root);
    const afterEntry = after.find((e) => e.glob === glob);
    assert.equal(afterEntry.matchedCount, 1, "adding one matching file must bump this exclude's matched count to exactly 1");
  } finally {
    cleanupFixture(root);
  }
});

test("K4: check.mjs's CLI prints the claim_excludes summary unconditionally (exclude glob + matched count + reason, one line per entry)", () => {
  const root = makeCliRunnable(cloneFixture(GREEN_ROOT));
  try {
    const result = runCheckMjsCli(root);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const channels = readJson(root, "distribution/channels.json");
    assert.match(result.stdout, new RegExp(`claims_consistent: ${channels.claim_excludes.length} claim_excludes entries in use`));
    const firstGlob = channels.claim_excludes[0].glob;
    assert.ok(
      result.stdout.includes(`claims_consistent:   exclude=${JSON.stringify(firstGlob)} matched=`),
      `expected a claim_excludes summary line for glob ${JSON.stringify(firstGlob)}, got stdout:\n${result.stdout}`
    );
  } finally {
    cleanupFixture(root);
  }
});
