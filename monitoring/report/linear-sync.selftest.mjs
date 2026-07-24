#!/usr/bin/env node
/**
 * monitoring/report/linear-sync.selftest.mjs
 *
 * Dependency-free, OFFLINE self-test for linear-sync.mjs's delivery
 * pipeline. Makes ZERO network calls and needs NO LINEAR_API_KEY — it
 * injects a stub GraphQL transport (`requestFn`) into linear-sync.mjs's
 * exported `runSync`/`createIssue`/`createComment`/`findTrackerIssue` and
 * asserts on mutation call counts, not on live Linear state.
 *
 * This is the RATCHETING regression test for the TOW2-336 incident
 * (2026-07-24): an earlier version of linear-sync.mjs fired a live
 * `issueCreate` mutation on ANY run with a valid `LINEAR_API_KEY` present —
 * no separate "arm" switch existed. A local sanity-check run (`node
 * monitoring/report/linear-sync.mjs`) against a real key created a real
 * Linear issue. Assertion (1) below — dry-run fires ZERO mutations — is
 * exactly the check that would have caught it before it ever ran live.
 *
 * Run this after ANY change to linear-sync.mjs:
 *   node monitoring/report/linear-sync.selftest.mjs
 *
 * Assertions:
 *   1. DRY-RUN (live: false), alert-worthy report -> issueCreate/
 *      commentCreate mutation queries are NEVER sent over the transport
 *      (zero GraphQL calls whose query text contains "IssueCreateInput" or
 *      "CommentCreateInput") — createIssue/createComment must return a
 *      local stub instead of calling `requestFn`.
 *   2. LIVE (live: true), alert-worthy report -> exactly ONE issueCreate
 *      mutation call, ZERO commentCreate calls.
 *   3. LIVE, green (all-PASS) report, tracker ALREADY EXISTS -> the
 *      find-or-create step finds it (no issueCreate for the tracker) and
 *      exactly ONE commentCreate call follows.
 *   3b. LIVE, green report, tracker does NOT exist yet -> exactly ONE
 *       issueCreate (creates the tracker) followed by exactly ONE
 *       commentCreate.
 *   4. LIVE, green report, the tracker SEARCH itself fails (simulated
 *      GraphQL error) -> runSync returns "skipped-search-error" and NEITHER
 *      issueCreate NOR commentCreate is ever called — a search error must
 *      never be treated as "tracker not found" (that was the duplicate-
 *      heartbeat-issue bug; see findTrackerIssue's doc comment).
 *
 * Exit code: non-zero on ANY assertion mismatch, or if the pipeline itself
 * throws uncaught.
 */

import {
  TEAM_NAME,
  PROJECT_NAME,
  LABEL_NAME,
  TRACKER_TITLE,
  runSync,
} from "./linear-sync.mjs";

const FAKE_API_KEY = "fake-key-for-selftest-only";

/**
 * Build a stub GraphQL transport (matches linear-sync.mjs's `requestFn`
 * signature: `(apiKey, query, variables) => Promise<data>`). Routes by
 * inspecting the query text — the same shapes linear-sync.mjs actually
 * sends — and logs every call so assertions can count mutation calls
 * precisely.
 *
 * @param {{trackerExists?: boolean, trackerSearchError?: boolean}} [opts]
 */
function makeStub(opts = {}) {
  const callLog = [];

  async function requestFn(apiKey, query, variables) {
    callLog.push({ query, variables });

    if (query.includes("TeamFilter")) {
      return { teams: { nodes: [{ id: "team-1", name: TEAM_NAME }] } };
    }
    if (query.includes("ProjectFilter")) {
      return { projects: { nodes: [{ id: "project-1", name: PROJECT_NAME }] } };
    }
    if (query.includes("IssueLabelFilter")) {
      return { issueLabels: { nodes: [{ id: "label-1", name: LABEL_NAME }] } };
    }
    if (query.includes("viewer {")) {
      return { viewer: { id: "viewer-1", name: "Wu Tong" } };
    }
    if (query.includes("IssueFilter")) {
      // Tracker search (findTrackerIssue).
      if (opts.trackerSearchError) {
        throw new Error("simulated GraphQL search failure (transient blip)");
      }
      if (opts.trackerExists) {
        return { issues: { nodes: [{ id: "tracker-1", identifier: "TOW2-999", title: TRACKER_TITLE }] } };
      }
      return { issues: { nodes: [] } };
    }
    if (query.includes("IssueCreateInput")) {
      return {
        issueCreate: {
          success: true,
          issue: { id: "new-issue-1", identifier: "TOW2-1000", title: variables?.input?.title },
        },
      };
    }
    if (query.includes("CommentCreateInput")) {
      return { commentCreate: { success: true, comment: { id: "comment-1" } } };
    }
    throw new Error(`stub: unhandled query shape: ${query.slice(0, 80)}`);
  }

  return { requestFn, callLog };
}

function countMatching(callLog, needle) {
  return callLog.filter((c) => c.query.includes(needle)).length;
}

function makeAlertReport() {
  return {
    finishedAt: "2026-07-24T09:52:52.244Z",
    summary: { maxOursSeverity: null, maxSeverity: "P1", oursCount: 0, backendCount: 2 },
    results: [
      { name: "novada_scrape_amazon", status: "FAIL", domain: "③-backend", severity: "P1", platform: "amazon.com", advice: "backend issue" },
      { name: "novada_setup", status: "PASS", domain: "-", severity: null, platform: "-" },
    ],
  };
}

function makeGreenReport() {
  return {
    finishedAt: "2026-07-24T09:52:52.244Z",
    summary: { maxOursSeverity: null, maxSeverity: null, oursCount: 0, backendCount: 0 },
    results: [
      { name: "novada_setup", status: "PASS", domain: "-", severity: null, platform: "-" },
      { name: "novada_scrape_google", status: "PASS", domain: "-", severity: null, platform: "google.com" },
    ],
  };
}

let failureCount = 0;
function expect(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failureCount += 1;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function main() {
  const filename = "full-2026-07-24T09-52-52-244Z.json";

  // ── Assertion 1: DRY-RUN, alert-worthy report -> ZERO mutation calls ──────
  console.log("[selftest] (1) dry-run (live:false), alert-worthy report -> zero mutations...");
  {
    const { requestFn, callLog } = makeStub({});
    const result = await runSync(FAKE_API_KEY, makeAlertReport(), filename, { requestFn, live: false });
    expect(result.action === "issue-created", `runSync returns action "issue-created" even in dry-run (got "${result.action}")`);
    expect(
      countMatching(callLog, "IssueCreateInput") === 0,
      `ZERO issueCreate GraphQL calls were sent (got ${countMatching(callLog, "IssueCreateInput")}) — this is the exact TOW2-336 regression check`
    );
    expect(
      countMatching(callLog, "CommentCreateInput") === 0,
      `ZERO commentCreate GraphQL calls were sent (got ${countMatching(callLog, "CommentCreateInput")})`
    );
    expect(result.issue?.identifier === "DRY-RUN", `dry-run createIssue returns a local stub identifier (got "${result.issue?.identifier}")`);
  }

  // ── Assertion 2: LIVE, alert-worthy report -> exactly ONE issueCreate ─────
  console.log("\n[selftest] (2) live (live:true), alert-worthy report -> exactly one issueCreate...");
  {
    const { requestFn, callLog } = makeStub({});
    const result = await runSync(FAKE_API_KEY, makeAlertReport(), filename, { requestFn, live: true });
    expect(result.action === "issue-created", `runSync returns action "issue-created" (got "${result.action}")`);
    expect(countMatching(callLog, "IssueCreateInput") === 1, `exactly one issueCreate call (got ${countMatching(callLog, "IssueCreateInput")})`);
    expect(countMatching(callLog, "CommentCreateInput") === 0, `zero commentCreate calls on the alert path (got ${countMatching(callLog, "CommentCreateInput")})`);
    expect(result.issue?.identifier === "TOW2-1000", `created issue identifier is the stub's real return value (got "${result.issue?.identifier}")`);
  }

  // ── Assertion 3: LIVE, green report, tracker EXISTS -> find (no create) + one commentCreate ──
  console.log("\n[selftest] (3) live, green report, tracker already exists -> find + exactly one commentCreate...");
  {
    const { requestFn, callLog } = makeStub({ trackerExists: true });
    const result = await runSync(FAKE_API_KEY, makeGreenReport(), filename, { requestFn, live: true });
    expect(result.action === "heartbeat", `runSync returns action "heartbeat" (got "${result.action}")`);
    expect(countMatching(callLog, "IssueCreateInput") === 0, `tracker already existed -> zero issueCreate calls (got ${countMatching(callLog, "IssueCreateInput")})`);
    expect(countMatching(callLog, "CommentCreateInput") === 1, `exactly one commentCreate call (got ${countMatching(callLog, "CommentCreateInput")})`);
    expect(result.tracker?.identifier === "TOW2-999", `used the EXISTING tracker, not a new one (got "${result.tracker?.identifier}")`);
  }

  // ── Assertion 3b: LIVE, green report, tracker MISSING -> create + one commentCreate ──
  console.log("\n[selftest] (3b) live, green report, tracker missing -> creates it + exactly one commentCreate...");
  {
    const { requestFn, callLog } = makeStub({ trackerExists: false });
    const result = await runSync(FAKE_API_KEY, makeGreenReport(), filename, { requestFn, live: true });
    expect(result.action === "heartbeat", `runSync returns action "heartbeat" (got "${result.action}")`);
    expect(countMatching(callLog, "IssueCreateInput") === 1, `tracker missing -> exactly one issueCreate call to create it (got ${countMatching(callLog, "IssueCreateInput")})`);
    expect(countMatching(callLog, "CommentCreateInput") === 1, `exactly one commentCreate call after creating the tracker (got ${countMatching(callLog, "CommentCreateInput")})`);
  }

  // ── Assertion 4: LIVE, green report, tracker SEARCH errors -> no create at all ──
  console.log("\n[selftest] (4) live, green report, tracker search fails -> zero mutations, delivery skipped...");
  {
    const { requestFn, callLog } = makeStub({ trackerSearchError: true });
    const result = await runSync(FAKE_API_KEY, makeGreenReport(), filename, { requestFn, live: true });
    expect(
      result.action === "skipped-search-error",
      `runSync returns action "skipped-search-error" (got "${result.action}") — a search ERROR must never be treated as "not found"`
    );
    expect(
      countMatching(callLog, "IssueCreateInput") === 0,
      `a tracker-search failure creates ZERO issues (got ${countMatching(callLog, "IssueCreateInput")}) — this is the exact duplicate-heartbeat regression check`
    );
    expect(countMatching(callLog, "CommentCreateInput") === 0, `a tracker-search failure posts ZERO comments (got ${countMatching(callLog, "CommentCreateInput")})`);
  }

  console.log("");
  if (failureCount > 0) {
    console.error(`[selftest] FAILED: ${failureCount} assertion(s) did not hold.`);
    process.exitCode = 1;
    return;
  }
  console.log("[selftest] OK — all dry-run/live/search-error delivery assertions passed, 0 crashes.");
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(`[selftest] FATAL (the pipeline crashed — this is exactly what this self-test exists to catch): ${err?.stack || err}`);
  process.exitCode = 1;
});
