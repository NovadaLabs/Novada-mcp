// distribution/test/brief-m.test.mjs — brief-M wave 7 (2026-10-15): red/green coverage for
// M1 (parseClaimsIgnoreMarker only recognizes an actual HTML-comment directive, never a bare
// prose MENTION of the feature name), M2 (distribution/research/** is a documented
// claim_excludes entry), and M4 (a committed-tree node:test proving claims_consistent's
// tracked-files-only scan behaves correctly end to end, plus the new
// collectUntrackedProseFileWarning summary that makes the gap this whole brief exists to fix
// reviewer-visible instead of silently invisible).
//
// M3 (distribution/README.md's own content fix — illustrative examples no longer state fake
// counts as facts, genuinely stale numbers corrected to the true facts) has no dedicated unit
// test here: it is a content change, not a code change, and the regression guard for it is
// M4's own committed-copy mechanism — the exact technique the brief's own verifier used to find
// the 16 failures this round fixes. See report-M-wave7's verification log for the real-repo
// before/after (manual rsync --exclude .git / git init / git add -A / commit run, never
// reproduced against the real worktree from inside this synthetic-fixture-only suite — same
// PHASE 5 invariant every other file in this directory follows).
//
// Same fixture discipline as the rest of this suite: every mutation happens on a cloned temp
// copy of the shared green fixture, never on the real worktree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runChecks, parseClaimsIgnoreMarker, collectUntrackedProseFileWarning } from "../check.mjs";
import { buildGreenFixture, cloneFixture, cleanupFixture, writeText } from "./fixtures.mjs";

const REAL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

function gitInitCommit(root) {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.email=brief-m@test.local", "-c", "user.name=brief-m-test", "commit", "-q", "-m", "base"], { cwd: root });
}

// =========================================================================================
// M1 unit tests — parseClaimsIgnoreMarker must require an actual HTML-comment DIRECTIVE
// (`<!-- claims-ignore...`), never just the bare substring "claims-ignore" anywhere on the line.
// =========================================================================================

test("parseClaimsIgnoreMarker unit (brief-M M1): a backticked PROSE MENTION of the feature name, with no HTML comment, is present:false — not a marker, not an error", () => {
  const r = parseClaimsIgnoreMarker("See the `claims-ignore` marker syntax for details.");
  assert.deepEqual(r, { present: false, valid: false, reason: "" });
});

test("parseClaimsIgnoreMarker unit (brief-M M1) control: bare 'claims-ignore: <reason>' text with NO HTML-comment wrapper is ALSO present:false — the directive requires the comment syntax, not just a colon", () => {
  const r = parseClaimsIgnoreMarker("claims-ignore: a reason that is long enough to pass the length check");
  assert.deepEqual(r, { present: false, valid: false, reason: "" });
});

test("parseClaimsIgnoreMarker unit (brief-M M1): a real, well-formed HTML-comment marker is present:true, valid:true with the reason extracted", () => {
  const r = parseClaimsIgnoreMarker('Some claim text. <!-- claims-ignore: a genuinely good reason here -->');
  assert.equal(r.present, true);
  assert.equal(r.valid, true);
  assert.equal(r.reason, "a genuinely good reason here");
});

test("parseClaimsIgnoreMarker unit (brief-M M1): a malformed HTML-comment marker (no colon) is present:true, valid:false — unchanged by the narrowing", () => {
  const r = parseClaimsIgnoreMarker("Some claim text. <!-- claims-ignore -->");
  assert.equal(r.present, true);
  assert.equal(r.valid, false);
});

test("parseClaimsIgnoreMarker unit (brief-M M1): a malformed HTML-comment marker (reason under 10 chars) is present:true, valid:false — unchanged by the narrowing", () => {
  const r = parseClaimsIgnoreMarker("Some claim text. <!-- claims-ignore: short -->");
  assert.equal(r.present, true);
  assert.equal(r.valid, false);
});

// =========================================================================================
// M1 integration tests — through checkClaimsConsistent (via runChecks), proving the backticked
// mention neither suppresses a real wrong claim nor itself gets reported as invalid_marker.
// GREEN_ROOT's own built registry has tools=5 (see fixtures.mjs's comment), so "999 tools" is a
// deliberate, large mismatch.
// =========================================================================================

test("claims_consistent (brief-M M1): a line stating a WRONG claim that ALSO backtick-mentions `claims-ignore` (no HTML comment) is reported ONLY as the numeric mismatch — PREDICTED exactly 1 total failure, zero invalid_marker failures", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "README.md", "# novada-mcp\n\nAll 999 tools in one place (see the `claims-ignore` marker syntax for exceptions).\n");

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 1, `predicted exactly 1 total failure, got:\n${JSON.stringify(results, null, 2)}`);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 1);
    assert.match(cc.failures[0], /rule=claims_consistent noun="tools"/);
    assert.match(cc.failures[0], /got=999/);
    assert.ok(!cc.failures.some((f) => /invalid_marker/.test(f)), "a bare prose mention must never be reported as invalid_marker");

    // mutation probe: skip claims_consistent -> its own failure list for this fixture must go to 0.
    const probed = findResult(await runChecks(root, { skip: new Set(["claims_consistent"]) }), "claims_consistent");
    assert.equal(probed.failures.length, 0, "disabling claims_consistent should make it report 0 failures");
  } finally {
    cleanupFixture(root);
  }
});

test("claims_consistent (brief-M M1) control: the SAME wrong claim WITH a real, valid HTML-comment marker on its line is fully suppressed — PREDICTED exactly 0 failures (proves the fix did not break real markers)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "README.md", "# novada-mcp\n\nAll 999 tools in one place. <!-- claims-ignore: historical count, pre-v1, kept for the archive -->\n");

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 0, `predicted exactly 0 total failures, got:\n${JSON.stringify(results, null, 2)}`);
  } finally {
    cleanupFixture(root);
  }
});

test("claims_consistent (brief-M M1) control: a MALFORMED real marker (bare, inside the comment) still fails exactly as before — PREDICTED exactly 2 failures (invalid_marker + the underlying numeric mismatch, unchanged by the narrowing)", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    writeText(root, "README.md", "# novada-mcp\n\nAll 999 tools in one place. <!-- claims-ignore -->\n");

    const results = await runChecks(root);
    const total = results.reduce((n, r) => n + r.failures.length, 0);
    assert.equal(total, 2, `predicted exactly 2 total failures, got:\n${JSON.stringify(results, null, 2)}`);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 2);
    assert.ok(cc.failures.some((f) => /invalid_marker/.test(f)));
    assert.ok(cc.failures.some((f) => /got=999/.test(f)));
  } finally {
    cleanupFixture(root);
  }
});

// =========================================================================================
// M2 — distribution/research/** must be a documented claim_excludes entry in the REAL, shipped
// channels.json (not a fixture — this is config content, not check.mjs behavior).
// =========================================================================================

test("channels.json (brief-M M2, real shipped config): distribution/research/** is a claim_excludes entry with a non-empty reason", () => {
  const channels = JSON.parse(readFileSync(join(REAL_ROOT, "distribution", "channels.json"), "utf8"));
  const entry = (channels.claim_excludes ?? []).find((e) => e.glob === "distribution/research/**");
  assert.ok(entry, "expected a claim_excludes entry for distribution/research/**");
  assert.equal(typeof entry.reason, "string");
  assert.ok(entry.reason.trim().length > 0, "the exclude's reason must not be empty");
});

// =========================================================================================
// M4 — "make this class impossible to miss again": a committed-tree node:test proving
// claims_consistent's tracked-files-only scan behaves correctly end to end, and the new
// collectUntrackedProseFileWarning summary that surfaces exactly the gap that let this round's
// 16 real failures go unreported in every prior local run of the real (uncommitted) worktree.
// =========================================================================================

test("brief-M M4: a git-committed copy of the green fixture reports 0 claims_consistent failures AND 0 untracked prose files — PREDICTED exactly 0 failures, empty untracked list", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    gitInitCommit(root);

    const results = await runChecks(root);
    const cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 0, `predicted 0 claims_consistent failures on a fully-committed clean fixture, got:\n${JSON.stringify(cc.failures, null, 2)}`);

    const untracked = await collectUntrackedProseFileWarning(root);
    assert.deepEqual(untracked, [], "a fully committed tree has zero untracked prose files");
  } finally {
    cleanupFixture(root);
  }
});

test("brief-M M4: the exact class this brief fixes, reproduced end to end — an UNCOMMITTED prose file with a wrong claim is invisible to claims_consistent itself (the documented, intentional gap), but IS named by collectUntrackedProseFileWarning; once `git add`ed it becomes visible to BOTH — PREDICTED 0/1/1 failures across the three states, exactly 1 file named by the warning in states 1-2 and 0 in state 3", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    gitInitCommit(root);

    // State 1: a brand-new file on disk, never `git add`ed at all.
    writeText(root, "NEW_UNCOMMITTED.md", "# scratch notes\n\nAll 999 tools, allegedly.\n");

    let results = await runChecks(root);
    let cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 0, "state 1 (untracked): the wrong claim must be invisible to the scan itself — this is the documented gap, not a new bug");

    let untracked = await collectUntrackedProseFileWarning(root);
    assert.deepEqual(untracked, ["NEW_UNCOMMITTED.md"], "state 1: the warning must name exactly this file");

    // State 2: `git add`ed (staged) but NOT yet committed — `git ls-files` already reports a
    // staged file (it reads the index, not HEAD), so this is the exact boundary the brief's own
    // verification recipe (`git add -A` before `git commit`) actually depends on.
    execFileSync("git", ["add", "NEW_UNCOMMITTED.md"], { cwd: root });

    results = await runChecks(root);
    cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 1, "state 2 (staged, uncommitted): the wrong claim must now be caught — `git ls-files` sees the index, not just HEAD");
    assert.match(cc.failures[0], /NEW_UNCOMMITTED\.md/);
    assert.match(cc.failures[0], /got=999/);

    untracked = await collectUntrackedProseFileWarning(root);
    assert.deepEqual(untracked, [], "state 2: once staged, the file is no longer 'untracked' — the warning must clear");

    // State 3: committed. Same visibility as state 2 (committing doesn't change `git ls-files`'
    // tracked set), included for completeness and to mirror the brief's own full recipe exactly.
    execFileSync("git", ["-c", "user.email=brief-m@test.local", "-c", "user.name=brief-m-test", "commit", "-q", "-m", "add scratch file"], { cwd: root });

    results = await runChecks(root);
    cc = findResult(results, "claims_consistent");
    assert.equal(cc.failures.length, 1, "state 3 (committed): still caught, same as state 2");

    untracked = await collectUntrackedProseFileWarning(root);
    assert.deepEqual(untracked, []);
  } finally {
    cleanupFixture(root);
  }
});

test("collectUntrackedProseFileWarning (brief-M M4) control: an untracked file matched by an EXISTING claim_excludes glob is NOT named by the warning — warning only about files that would actually be scanned once tracked", async () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    gitInitCommit(root);
    // GREEN_ROOT's own channels.json is the real, shipped one (fixtures.mjs copies it verbatim)
    // — it already carries the real monitoring/RUNBOOK.md claim_excludes entry.
    writeText(root, "monitoring/RUNBOOK.md", "## Run log\n\n2026-07-23: 30/30 tools, all green.\n");

    const untracked = await collectUntrackedProseFileWarning(root);
    assert.deepEqual(untracked, [], "a file matched by claim_excludes is excluded from the untracked-file warning, same as from the scan itself");
  } finally {
    cleanupFixture(root);
  }
});

test("collectUntrackedProseFileWarning (brief-M M4) control: a non-git directory (no .git at all) returns an empty list, never throws — same posture as listTrackedProseFiles' own fallback", async () => {
  // GREEN_ROOT itself is never git-initialized (fixtures.mjs's own documented design) — reuse it
  // directly rather than cloning, since this assertion is read-only.
  const untracked = await collectUntrackedProseFileWarning(GREEN_ROOT);
  assert.deepEqual(untracked, []);
});
