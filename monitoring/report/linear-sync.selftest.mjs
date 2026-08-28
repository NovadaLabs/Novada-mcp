#!/usr/bin/env node
/**
 * monitoring/report/linear-sync.selftest.mjs
 *
 * Dependency-free, OFFLINE self-test for linear-sync.mjs's delivery
 * pipeline. Makes ZERO network calls, touches NO real filesystem paths, and
 * needs NO LINEAR_API_KEY — it injects a stub GraphQL transport
 * (`requestFn`) AND a stub file uploader (`uploadFn`) into linear-sync.mjs's
 * exported `runSync`/`createIssue`/`createComment`/`findTrackerIssue` and
 * asserts on mutation/upload call counts, not on live Linear state.
 *
 * This is the RATCHETING regression test for the TOW2-336 incident
 * (2026-07-24): an earlier version of linear-sync.mjs fired a live
 * `issueCreate` mutation on ANY run with a valid `LINEAR_API_KEY` present —
 * no separate "arm" switch existed. A local sanity-check run (`node
 * monitoring/report/linear-sync.mjs`) against a real key created a real
 * Linear issue. Assertion (1) below — dry-run fires ZERO mutations — is
 * exactly the check that would have caught it before it ever ran live.
 *
 * Every LIVE-mode test case below passes an explicit `uploadFn` stub (never
 * relies on the module's default `uploadFileToLinear`) so this self-test
 * NEVER reads a real file off disk or opens a real network connection, even
 * by accident — see the "Do NOT run linear-sync.mjs against a live key"
 * constraint this file exists to uphold.
 *
 * Run this after ANY change to linear-sync.mjs:
 *   node monitoring/report/linear-sync.selftest.mjs
 *
 * Assertions:
 *   1. DRY-RUN (live: false), alert-worthy report -> issueCreate/
 *      commentCreate mutation queries are NEVER sent over the transport
 *      (zero GraphQL calls whose query text contains "IssueCreateInput" or
 *      "CommentCreateInput") — createIssue/createComment must return a
 *      local stub instead of calling `requestFn`. ALSO: zero upload calls
 *      (dry-run never uploads the report attachment either).
 *   2. LIVE (live: true), alert-worthy report -> exactly ONE issueCreate
 *      mutation call, ZERO commentCreate calls, exactly ONE upload call, and
 *      the created issue's body contains the stub's returned assetUrl link.
 *   3. LIVE, green (all-PASS) report, tracker ALREADY EXISTS -> the
 *      find-or-create step finds it (no issueCreate for the tracker),
 *      exactly ONE commentCreate call follows, exactly ONE upload call, and
 *      the comment body contains the stub's returned assetUrl link.
 *   3b. LIVE, green report, tracker does NOT exist yet -> exactly ONE
 *       issueCreate (creates the tracker) followed by exactly ONE
 *       commentCreate, and exactly ONE upload call overall (the tracker's
 *       own creation body has no attachment link — only the heartbeat
 *       comment does, same as the pre-attachment archive-link behavior).
 *   4. LIVE, green report, the tracker SEARCH itself fails (simulated
 *      GraphQL error) -> runSync returns "skipped-search-error" and NEITHER
 *      issueCreate NOR commentCreate NOR the uploader is ever called — a
 *      search error must never be treated as "tracker not found" (that was
 *      the duplicate-heartbeat-issue bug; see findTrackerIssue's doc
 *      comment), and must never even attempt the attachment upload.
 *   5. LIVE, alert-worthy report, the uploader ITSELF throws (simulated
 *      upload failure) -> delivery is still fail-soft: exactly ONE
 *      issueCreate still fires (never crashes, never blocks delivery), and
 *      the issue body contains the "(report attachment upload failed —
 *      see CI logs)" fallback note instead of a broken/missing link.
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
const FAKE_ASSET_URL = "https://uploads.linear.app/fake-asset/full-report.xlsx";

/**
 * Build a stub uploader (matches runSync's injectable `uploadFn` signature:
 * `(filePath) => Promise<assetUrl>`). Never touches disk or network — logs
 * every call so assertions can count them precisely.
 *
 * @param {{throwError?: boolean, assetUrl?: string}} [opts]
 */
function makeUploadStub(opts = {}) {
  const uploadLog = [];
  async function uploadFn(filePath) {
    uploadLog.push({ filePath });
    if (opts.throwError) {
      throw new Error("simulated upload failure (network or fileUpload mutation)");
    }
    return opts.assetUrl || FAKE_ASSET_URL;
  }
  return { uploadFn, uploadLog };
}

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

// 2026-08-27: a "product-green but test-key DEGRADED" run — the shared test
// key is unfunded/over-cap so 2 tools came back configFault. maxOursSeverity/
// maxSeverity are null (configFault excluded upstream in full-tools-probe.mjs),
// so this routes to the HEARTBEAT path — the exact run that must NOT post
// "✅ all healthy". testKeyDegradedCount/monitoringDegraded carry the signal.
function makeDegradedReport() {
  return {
    finishedAt: "2026-07-24T09:52:52.244Z",
    summary: {
      maxOursSeverity: null,
      maxSeverity: null,
      oursCount: 0,
      backendCount: 0,
      testKeyDegradedCount: 2,
      monitoringDegraded: true,
    },
    results: [
      { name: "novada_search", status: "FAIL", domain: "②-gateway", severity: "P0", configFault: true, platform: "-", advice: "test key over cap" },
      { name: "novada_scrape_amazon", status: "FAIL", domain: "②-gateway", severity: "P1", configFault: true, platform: "amazon.com", advice: "test key over cap" },
      { name: "novada_setup", status: "PASS", domain: "-", severity: null, platform: "-" },
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

/** Find the variables of the (first) GraphQL call whose query text contains `needle`. */
function findCallVariables(callLog, needle) {
  return callLog.find((c) => c.query.includes(needle))?.variables;
}

async function main() {
  const filename = "full-2026-07-24T09-52-52-244Z.json";

  // ── Assertion 1: DRY-RUN, alert-worthy report -> ZERO mutation calls, ZERO uploads ──
  console.log("[selftest] (1) dry-run (live:false), alert-worthy report -> zero mutations, zero uploads...");
  {
    const { requestFn, callLog } = makeStub({});
    const { uploadFn, uploadLog } = makeUploadStub();
    const result = await runSync(FAKE_API_KEY, makeAlertReport(), filename, { requestFn, live: false, uploadFn });
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
    expect(uploadLog.length === 0, `ZERO report-attachment upload calls in dry-run (got ${uploadLog.length})`);
  }

  // ── Assertion 2: LIVE, alert-worthy report -> exactly ONE issueCreate + ONE upload, body has the link ──
  console.log("\n[selftest] (2) live (live:true), alert-worthy report -> exactly one issueCreate + one upload, body has the assetUrl link...");
  {
    const { requestFn, callLog } = makeStub({});
    const { uploadFn, uploadLog } = makeUploadStub();
    const result = await runSync(FAKE_API_KEY, makeAlertReport(), filename, { requestFn, live: true, uploadFn });
    expect(result.action === "issue-created", `runSync returns action "issue-created" (got "${result.action}")`);
    expect(countMatching(callLog, "IssueCreateInput") === 1, `exactly one issueCreate call (got ${countMatching(callLog, "IssueCreateInput")})`);
    expect(countMatching(callLog, "CommentCreateInput") === 0, `zero commentCreate calls on the alert path (got ${countMatching(callLog, "CommentCreateInput")})`);
    expect(result.issue?.identifier === "TOW2-1000", `created issue identifier is the stub's real return value (got "${result.issue?.identifier}")`);
    expect(uploadLog.length === 1, `exactly one report-attachment upload call (got ${uploadLog.length})`);
    expect(
      uploadLog[0]?.filePath?.endsWith("full-2026-07-24T09-52-52-244Z.xlsx"),
      `upload was called with the sibling .xlsx path derived from the report's own filename (got "${uploadLog[0]?.filePath}")`
    );
    const issueBody = findCallVariables(callLog, "IssueCreateInput")?.input?.description || "";
    expect(issueBody.includes(FAKE_ASSET_URL), `issue body contains the uploaded assetUrl link (body: ${JSON.stringify(issueBody.slice(-120))})`);
  }

  // ── Assertion 3: LIVE, green report, tracker EXISTS -> find (no create) + one commentCreate + one upload, comment has the link ──
  console.log("\n[selftest] (3) live, green report, tracker already exists -> find + exactly one commentCreate + one upload, comment has the assetUrl link...");
  {
    const { requestFn, callLog } = makeStub({ trackerExists: true });
    const { uploadFn, uploadLog } = makeUploadStub();
    const result = await runSync(FAKE_API_KEY, makeGreenReport(), filename, { requestFn, live: true, uploadFn });
    expect(result.action === "heartbeat", `runSync returns action "heartbeat" (got "${result.action}")`);
    expect(countMatching(callLog, "IssueCreateInput") === 0, `tracker already existed -> zero issueCreate calls (got ${countMatching(callLog, "IssueCreateInput")})`);
    expect(countMatching(callLog, "CommentCreateInput") === 1, `exactly one commentCreate call (got ${countMatching(callLog, "CommentCreateInput")})`);
    expect(result.tracker?.identifier === "TOW2-999", `used the EXISTING tracker, not a new one (got "${result.tracker?.identifier}")`);
    expect(uploadLog.length === 1, `exactly one report-attachment upload call (got ${uploadLog.length})`);
    const commentBody = findCallVariables(callLog, "CommentCreateInput")?.input?.body || "";
    expect(commentBody.includes(FAKE_ASSET_URL), `heartbeat comment body contains the uploaded assetUrl link (body: ${JSON.stringify(commentBody)})`);
  }

  // ── Assertion 3b: LIVE, green report, tracker MISSING -> create + one commentCreate + one upload overall ──
  console.log("\n[selftest] (3b) live, green report, tracker missing -> creates it + exactly one commentCreate + exactly one upload...");
  {
    const { requestFn, callLog } = makeStub({ trackerExists: false });
    const { uploadFn, uploadLog } = makeUploadStub();
    const result = await runSync(FAKE_API_KEY, makeGreenReport(), filename, { requestFn, live: true, uploadFn });
    expect(result.action === "heartbeat", `runSync returns action "heartbeat" (got "${result.action}")`);
    expect(countMatching(callLog, "IssueCreateInput") === 1, `tracker missing -> exactly one issueCreate call to create it (got ${countMatching(callLog, "IssueCreateInput")})`);
    expect(countMatching(callLog, "CommentCreateInput") === 1, `exactly one commentCreate call after creating the tracker (got ${countMatching(callLog, "CommentCreateInput")})`);
    expect(uploadLog.length === 1, `exactly one report-attachment upload call overall — the tracker-creation body itself carries no attachment link, only the comment does (got ${uploadLog.length})`);
  }

  // ── Assertion 4: LIVE, green report, tracker SEARCH errors -> no create, no comment, no upload at all ──
  console.log("\n[selftest] (4) live, green report, tracker search fails -> zero mutations, zero uploads, delivery skipped...");
  {
    const { requestFn, callLog } = makeStub({ trackerSearchError: true });
    const { uploadFn, uploadLog } = makeUploadStub();
    const result = await runSync(FAKE_API_KEY, makeGreenReport(), filename, { requestFn, live: true, uploadFn });
    expect(
      result.action === "skipped-search-error",
      `runSync returns action "skipped-search-error" (got "${result.action}") — a search ERROR must never be treated as "not found"`
    );
    expect(
      countMatching(callLog, "IssueCreateInput") === 0,
      `a tracker-search failure creates ZERO issues (got ${countMatching(callLog, "IssueCreateInput")}) — this is the exact duplicate-heartbeat regression check`
    );
    expect(countMatching(callLog, "CommentCreateInput") === 0, `a tracker-search failure posts ZERO comments (got ${countMatching(callLog, "CommentCreateInput")})`);
    expect(uploadLog.length === 0, `a tracker-search failure never even attempts the report-attachment upload (got ${uploadLog.length})`);
  }

  // ── Assertion 5: LIVE, alert-worthy report, the UPLOADER ITSELF throws -> fail-soft, still one issueCreate, body has the fallback note ──
  console.log("\n[selftest] (5) live, alert-worthy report, upload throws -> fail-soft: still exactly one issueCreate, body has the upload-failed note, no crash...");
  {
    const { requestFn, callLog } = makeStub({});
    const { uploadFn, uploadLog } = makeUploadStub({ throwError: true });
    const result = await runSync(FAKE_API_KEY, makeAlertReport(), filename, { requestFn, live: true, uploadFn });
    expect(result.action === "issue-created", `runSync still returns action "issue-created" despite the upload failure — fail-soft (got "${result.action}")`);
    expect(countMatching(callLog, "IssueCreateInput") === 1, `exactly one issueCreate call still fires (got ${countMatching(callLog, "IssueCreateInput")})`);
    expect(uploadLog.length === 1, `the upload was attempted exactly once (got ${uploadLog.length})`);
    const issueBody = findCallVariables(callLog, "IssueCreateInput")?.input?.description || "";
    expect(
      issueBody.includes("report attachment upload failed"),
      `issue body carries the "(report attachment upload failed — see CI logs)" fallback note instead of a broken link (body: ${JSON.stringify(issueBody.slice(-120))})`
    );
    expect(!issueBody.includes(FAKE_ASSET_URL), `issue body does NOT contain a (nonexistent) assetUrl link when the upload failed`);
  }

  // ── Assertion 6: LIVE, DEGRADED report (test key unfunded, product-green)
  //    -> heartbeat path, but the comment MUST say DEGRADED, never "all
  //    healthy". 2026-08-27 ratchet: locks the linear-sync half of the
  //    configFault fix — a dead/unfunded shared test key must never post a
  //    clean green heartbeat while the monitor is blind on those tools. ──
  console.log("\n[selftest] (6) live, DEGRADED report (test key unfunded, product-green) -> heartbeat says DEGRADED, never 'all healthy'...");
  {
    const { requestFn, callLog } = makeStub({ trackerExists: true });
    const { uploadFn } = makeUploadStub();
    const result = await runSync(FAKE_API_KEY, makeDegradedReport(), filename, { requestFn, live: true, uploadFn });
    expect(result.action === "heartbeat", `degraded-but-product-green routes to heartbeat, not an alert issue (got "${result.action}")`);
    const commentBody = findCallVariables(callLog, "CommentCreateInput")?.input?.body || "";
    expect(
      /DEGRADED/i.test(commentBody) && commentBody.includes("2"),
      `heartbeat comment flags DEGRADED with the degraded count (body: ${JSON.stringify(commentBody)})`
    );
    expect(
      !commentBody.includes("all healthy"),
      `a degraded run must NOT post the "✅ all healthy" heartbeat — the silent-green this fix prevents (body: ${JSON.stringify(commentBody)})`
    );
  }

  console.log("");
  if (failureCount > 0) {
    console.error(`[selftest] FAILED: ${failureCount} assertion(s) did not hold.`);
    process.exitCode = 1;
    return;
  }
  console.log("[selftest] OK — all dry-run/live/search-error/upload-failure/degraded delivery assertions passed, 0 crashes.");
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(`[selftest] FATAL (the pipeline crashed — this is exactly what this self-test exists to catch): ${err?.stack || err}`);
  process.exitCode = 1;
});
