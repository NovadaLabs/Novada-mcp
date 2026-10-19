// distribution/test/check-cli.test.mjs — proves distribution/check.mjs's CLI entry point
// (`if (isMain())`) actually runs — and is never silently skipped — when invoked through a
// SYMLINKED path, not just via direct `import { runChecks }` the way every other test file in
// this suite exercises it.
//
// Found by an independent reviewer during brief-A2 (2026-10-15): isMain() compared
// `pathToFileURL(resolve(process.argv[1])).href` (the literal, unresolved argv[1] string)
// against `import.meta.url` (which Node's ESM loader resolves through symlinks). Those two
// disagree whenever the invocation path crosses a symlink — e.g. macOS's own `/tmp ->
// private/tmp` and `/var -> private/var` (which is why `os.tmpdir()`-based fixtures run
// through a symlink on every macOS machine already), a symlinked git worktree, or a symlinked
// CI/container mount. When they disagree, the `if (isMain())` block in check.mjs/generate.mjs
// never executes: nothing is printed, and the process exits 0 by Node's default — a silent
// false PASS on what should have been a failing drift-gate run.
//
// This file builds a SELF-CONTAINED fixture (the fixture carries its own copy of check.mjs +
// generate.mjs, since the CLI's `ROOT = resolve(HERE, "..")` is computed relative to wherever
// the script file itself physically lives — not configurable via a flag), creates an explicit
// symlink to it (so the test is deterministic on every OS/CI, not dependent on macOS's ambient
// /tmp symlink), and spawns `node <symlink>/distribution/check.mjs` as a real child process.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, cpSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildGreenFixture, cloneFixture, cleanupFixture } from "./fixtures.mjs";

const REAL_DISTRIBUTION_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * Makes a fixture root "CLI-runnable": copies the REAL distribution/check.mjs and
 * distribution/generate.mjs into <root>/distribution/, overwriting the data-only files
 * fixtures.mjs already wrote there. This is required because check.mjs's CLI entry point
 * hardcodes its own ROOT as two directories up from wherever IT (the script file) lives — it
 * has no --root flag — so the fixture must carry its own copy of the scripts to be invokable
 * as a standalone CLI target at all.
 */
function makeCliRunnable(root) {
  cpSync(join(REAL_DISTRIBUTION_DIR, "check.mjs"), join(root, "distribution", "check.mjs"));
  cpSync(join(REAL_DISTRIBUTION_DIR, "generate.mjs"), join(root, "distribution", "generate.mjs"));
  return root;
}

/** Creates a fresh symlink (in its own temp dir) pointing at `targetRoot`. */
function symlinkTo(targetRoot) {
  const linkParent = mkdtempSync(join(tmpdir(), "novada-dist-symlink-"));
  const link = join(linkParent, "linked-root");
  symlinkSync(targetRoot, link, "dir");
  return { linkParent, link };
}

function runCheckMjsCli(checkMjsPath) {
  const result = spawnSync(process.execPath, [checkMjsPath], { encoding: "utf8" });
  return result;
}

test("check.mjs CLI: green fixture via a SYMLINKED path exits 0 and prints all 5 PASS lines (not silent)", () => {
  const root = makeCliRunnable(cloneFixture(buildAndRememberGreen()));
  const { linkParent, link } = symlinkTo(root);
  try {
    const result = runCheckMjsCli(join(link, "distribution", "check.mjs"));
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`);
    assert.ok(result.stdout.trim().length > 0, "expected non-empty stdout — silence would mean the pre-fix bug regressed");
    for (const name of ["version_equal", "generated_clean", "no_orphans", "location_rules", "legibility"]) {
      assert.match(result.stdout, new RegExp(`\\[check\\] ${name}: PASS`), `expected a PASS line for ${name}`);
    }
  } finally {
    rmSync(link, { force: true });
    cleanupFixture(linkParent);
    cleanupFixture(root);
  }
});

// PREDICTION (recorded before running, per brief-A2 PHASE 4): deleting npm-package/glama.json
// from the green fixture produces EXACTLY 1 failure, under location_rules only — glama's row
// has generated_by:null (generated_clean skips it), version_field:null (version_equal skips
// it), and no_orphans/legibility both `continue` once a path is simply absent. Predicted:
// exit 1, exactly 1 "[check] location_rules: FAIL" line mentioning glama.json, the other 4
// checks still PASS. This is the SAME fixture mutation distribution/test/check.test.mjs's
// existing in-process "location_rules: red when a required manifest file is removed" test
// uses — reused here, invoked via subprocess through a symlink instead of via runChecks().
test("check.mjs CLI: red fixture (glama.json removed) via a SYMLINKED path exits 1 with the predicted single failure", () => {
  const root = makeCliRunnable(cloneFixture(buildAndRememberGreen()));
  rmSync(join(root, "npm-package", "glama.json"));
  const { linkParent, link } = symlinkTo(root);
  try {
    const result = runCheckMjsCli(join(link, "distribution", "check.mjs"));
    assert.equal(result.status, 1, `predicted exit 1, got ${result.status}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const combined = result.stdout + result.stderr;
    assert.ok(combined.trim().length > 0, "expected non-empty output — silence would mean the pre-fix bug regressed");
    const failLines = combined.split("\n").filter((l) => l.includes(": FAIL "));
    assert.equal(failLines.length, 1, `predicted exactly 1 FAIL line, got ${failLines.length}:\n${failLines.join("\n")}`);
    assert.match(failLines[0], /location_rules/);
    assert.match(failLines[0], /glama\.json/);
    for (const name of ["version_equal", "generated_clean", "no_orphans", "legibility"]) {
      assert.match(combined, new RegExp(`\\[check\\] ${name}: PASS`), `predicted ${name} stays PASS`);
    }
  } finally {
    rmSync(link, { force: true });
    cleanupFixture(linkParent);
    cleanupFixture(root);
  }
});

// Cache one green fixture across both tests in this file (cloned per-test, never mutated
// in place) — mirrors check.test.mjs's test.before()/test.after() pattern without needing a
// shared module-level mutable in a file that also does subprocess spawning.
let _green;
function buildAndRememberGreen() {
  if (!_green) _green = buildGreenFixture();
  return _green;
}

test.after(() => {
  if (_green) cleanupFixture(_green);
});

// =========================================================================================
// brief-F R5 (2026-10-15): check.mjs's CLI entry point previously had no try/catch around
// runChecks(ROOT) — a missing/malformed distribution/channels.json, distribution/listing.json,
// or npm-package/package.json threw a raw, uncaught Node stack trace with no indication of
// WHICH file or WHAT to do. Fixed to match generate.mjs's existing CLI error shape exactly: one
// "[check] FATAL <reason> fix=<hint>" line on stderr, exit 1, never a bare stack trace. These 3
// tests cover 2 MISSING-file scenarios and 1 MALFORMED (invalid JSON) scenario, spawning the
// real CLI (not runChecks() in-process) so they exercise the actual try/catch wrapper.
// =========================================================================================

function assertFatalNotStackTrace(result) {
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /^\[check\] FATAL /m, `expected a "[check] FATAL ..." line, got stderr:\n${result.stderr}`);
  assert.doesNotMatch(result.stderr, /at Object\.<anonymous>|at Module\._compile|node:internal\/modules/, "must never leak a raw Node stack trace to the user");
}

test("check.mjs CLI R5: missing distribution/channels.json produces a FATAL line, not a raw stack trace", () => {
  const root = makeCliRunnable(cloneFixture(buildAndRememberGreen()));
  rmSync(join(root, "distribution", "channels.json"));
  const { linkParent, link } = symlinkTo(root);
  try {
    const result = runCheckMjsCli(join(link, "distribution", "check.mjs"));
    assertFatalNotStackTrace(result);
  } finally {
    rmSync(link, { force: true });
    cleanupFixture(linkParent);
    cleanupFixture(root);
  }
});

test("check.mjs CLI R5: missing distribution/listing.json produces a FATAL line, not a raw stack trace", () => {
  const root = makeCliRunnable(cloneFixture(buildAndRememberGreen()));
  rmSync(join(root, "distribution", "listing.json"));
  const { linkParent, link } = symlinkTo(root);
  try {
    const result = runCheckMjsCli(join(link, "distribution", "check.mjs"));
    assertFatalNotStackTrace(result);
  } finally {
    rmSync(link, { force: true });
    cleanupFixture(linkParent);
    cleanupFixture(root);
  }
});

test("check.mjs CLI R5: malformed (truncated/invalid-JSON) npm-package/package.json produces a FATAL line, not a raw stack trace", () => {
  const root = makeCliRunnable(cloneFixture(buildAndRememberGreen()));
  const pkgPath = join(root, "npm-package", "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  writeFileSync(pkgPath, raw.slice(0, -5)); // truncate -> invalid JSON
  const { linkParent, link } = symlinkTo(root);
  try {
    const result = runCheckMjsCli(join(link, "distribution", "check.mjs"));
    assertFatalNotStackTrace(result);
  } finally {
    rmSync(link, { force: true });
    cleanupFixture(linkParent);
    cleanupFixture(root);
  }
});
