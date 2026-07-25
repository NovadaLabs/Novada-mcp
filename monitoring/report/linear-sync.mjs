#!/usr/bin/env node
/**
 * monitoring/report/linear-sync.mjs
 *
 * Delivers the Layer D (full-tools probe) daily report data PRIVATELY via
 * Linear. This repo (NovadaLabs/Novada-mcp) is PUBLIC — its Actions logs and
 * artifacts are world-readable — so the actual report DATA (which backends
 * are down, our fault-domain analysis) must never land there. Instead, THIS
 * script delivers EVERYTHING to Linear (a private workspace) directly:
 *   - an alert issue (on any P0/P1/P2 finding) or a dated heartbeat comment
 *     (on green days), with a compact inline markdown summary; AND
 *   - the full report's rendered `.xlsx` file, uploaded as a genuine Linear
 *     file attachment via Linear's GraphQL file-upload flow, linked from the
 *     issue/comment body.
 * There is no public artifact and no separate archive repo — Linear is the
 * only delivery destination. See monitoring/README.md's "Privacy model"
 * section for the full picture.
 *
 * Dependency-free: Node >=20 built-in `fetch`/`fs` + a hand-written GraphQL
 * query/mutation set against Linear's public API
 * (https://api.linear.app/graphql — see https://linear.app/developers/graphql).
 *
 * ── DRY-RUN BY DEFAULT (critical safety invariant) ──────────────────────────
 * Every mutation (issueCreate, commentCreate, fileUpload + the follow-up PUT)
 * is a NO-OP unless explicitly armed via `--send` on the CLI or
 * `LINEAR_SYNC_LIVE=1` in the environment. Read-only resolution
 * (team/project/label/tracker lookups) still runs in dry-run — it validates
 * config without writing anything. This exists because an earlier version of
 * this script fired a live mutation on ANY run with a valid key present (no
 * separate arm switch), which is exactly how a local sanity-check run
 * against a real `LINEAR_API_KEY` accidentally created a real Linear issue
 * during development (TOW2-336, since canceled/relabeled). The CI workflow
 * sets `LINEAR_SYNC_LIVE: "1"` on its "Sync report to Linear" step so
 * scheduled runs still deliver for real; every other invocation (local,
 * ad-hoc, an offline self-test importing this module) defaults to
 * preview-only.
 *
 * A companion OFFLINE self-test lives at
 * monitoring/report/linear-sync.selftest.mjs — it imports this module's
 * exported pipeline (runSync/createIssue/createComment/uploadFileToLinear/
 * etc.), injects a stub GraphQL transport AND a stub file uploader (no
 * network, no key needed), and asserts that dry-run mode never fires a
 * mutation or upload, and that live mode fires exactly the expected ones —
 * including the fail-soft path when the upload itself fails. Run it after
 * any change to this file:
 *   node monitoring/report/linear-sync.selftest.mjs
 *
 * Env vars:
 *   LINEAR_API_KEY        (required) Linear personal API key. NEVER
 *                          hardcode, NEVER printed — on error, only the
 *                          GraphQL/HTTP error message is logged, never the
 *                          key itself (it is sent solely as the
 *                          Authorization header value).
 *   LINEAR_SYNC_LIVE       (optional) "1" to arm real mutations (see the
 *                          DRY-RUN section above). Same effect as passing
 *                          `--send` on the CLI.
 *
 * Resolution (by NAME, fail-soft — a name that doesn't resolve is logged and
 * that field is skipped, this script never crashes on a missing name):
 *   - team:    "TongWu"
 *   - project: "Novada MCP — Daily Monitoring Loop"
 *   - label:   "Wutong"
 *
 * Behavior:
 *   - The worse of summary.maxOursSeverity / summary.maxSeverity is P0, P1,
 *     or P2 -> create a NEW issue titled
 *     "[MCP Daily] <date> · <worst-sev> · <passN>/<total> ok · backend down: <names>",
 *     body = a compact markdown table (worst -> best) + the ours/backend
 *     split + a link to the `.xlsx` file attached directly to this issue.
 *     Assigned to the API key's own viewer (`me`), labeled Wutong.
 *   - Otherwise (all green, or only P3 findings) -> find-or-create a SINGLE
 *     rolling tracker issue "MCP Daily Monitor — heartbeat" and post a dated
 *     comment on it (with the same attached-`.xlsx` link). Never opens a new
 *     issue on a green day. If the SEARCH for the tracker itself fails
 *     (network/GraphQL error), this is treated as "unknown", NOT "not
 *     found" — delivery is skipped for this run rather than risking a
 *     duplicate tracker issue on a transient blip.
 *
 * Failure mode: ANY error (missing key, missing report file, network
 * failure, GraphQL error, file-upload failure) is logged to stderr and this
 * script exits 0 — a Linear delivery failure must never fail the monitor run
 * itself; the probe's own exit code (set by full-tools-probe.mjs) is what
 * actually matters for CI. The file-upload step specifically is fail-soft in
 * isolation too: if it throws, the issue/comment is still created with the
 * inline summary plus a note that the attachment upload failed — see
 * `uploadFileToLinear` and its caller below.
 *
 * Usage:
 *   LINEAR_API_KEY=<key> node monitoring/report/linear-sync.mjs             # dry-run (preview only)
 *   LINEAR_API_KEY=<key> LINEAR_SYNC_LIVE=1 node monitoring/report/linear-sync.mjs   # live delivery
 *   LINEAR_API_KEY=<key> node monitoring/report/linear-sync.mjs --send      # live delivery (CLI form)
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONITORING_DIR = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(MONITORING_DIR, "reports");

const LINEAR_API_URL = "https://api.linear.app/graphql";
const TEAM_NAME = "TongWu";
const PROJECT_NAME = "Novada MCP — Daily Monitoring Loop";
const LABEL_NAME = "Wutong";
const TRACKER_TITLE = "MCP Daily Monitor — heartbeat";
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// See the "DRY-RUN BY DEFAULT" doc comment above. Read once at module load;
// createIssue/createComment default to this but accept an explicit `live`
// override so the offline self-test can exercise both modes in one process
// without needing to re-import the module with different env/argv.
const LIVE = process.argv.includes("--send") || process.env.LINEAR_SYNC_LIVE === "1";

const SEVERITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Find the newest monitoring/reports/full-*.json (ISO-timestamp-sortable filenames, same convention as render-report.py's find_latest_report()). */
function findLatestReport() {
  let files;
  try {
    files = readdirSync(REPORTS_DIR).filter((f) => /^full-.*\.json$/.test(f)).sort();
  } catch (err) {
    throw new Error(`could not read ${REPORTS_DIR}: ${err.message}`);
  }
  if (files.length === 0) {
    throw new Error(`no monitoring/reports/full-*.json found in ${REPORTS_DIR}`);
  }
  const filename = files[files.length - 1];
  return { filename, fullPath: path.join(REPORTS_DIR, filename) };
}

/**
 * POST one GraphQL query/mutation to Linear. Throws a plain Error on any
 * failure — never logs the API key. This is the ONLY function that touches
 * the network; every other function below takes an injectable `requestFn`
 * (defaulting to this one) so the offline self-test
 * (linear-sync.selftest.mjs) can substitute a stub transport instead of the
 * live network — the same dependency-injection pattern
 * full-tools-probe.mjs uses for callTool/listTools.
 */
async function linearRequest(apiKey, query, variables) {
  let res;
  try {
    res = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new Error(`Linear API request failed (network): ${err.message}`);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Linear API response was not valid JSON (HTTP ${res.status})`);
  }

  if (!res.ok || json.errors) {
    const msg = Array.isArray(json?.errors) ? json.errors.map((e) => e.message).join("; ") : `HTTP ${res.status}`;
    throw new Error(`Linear API error: ${msg}`);
  }
  return json.data;
}

/**
 * Upload a local file to Linear as a genuine file attachment and return its
 * public-within-Linear `assetUrl`. Two-step flow per Linear's documented
 * GraphQL file-upload API (https://linear.app/developers/how-to-upload-a-file-to-linear
 * — verified against that page, 2026-07-24 — the `fileUpload` mutation, then
 * a direct PUT of the raw bytes to the returned signed `uploadUrl`, using
 * EVERY header Linear returns plus `Content-Type` and `Cache-Control`, both
 * required by Linear's own documented example — omitting `uploadFile.headers`
 * causes a 403 from the underlying signed-URL storage):
 *
 *   1. `fileUpload(contentType, filename, size)` — asks Linear for a signed
 *      upload URL. Assumed field names (`success`, `uploadFile.uploadUrl`,
 *      `uploadFile.assetUrl`, `uploadFile.headers[].{key,value}`) match
 *      Linear's documented shape; verify against Linear's live schema
 *      (`https://api.linear.app/graphql` introspection) if this ever starts
 *      failing in CI.
 *   2. `fetch(uploadUrl, { method: "PUT", headers, body })` — a raw PUT of
 *      the file bytes straight to Linear's file storage, NOT through the
 *      GraphQL endpoint and NOT through `requestFn` (only the `fileUpload`
 *      mutation itself goes through `requestFn`, so the offline self-test
 *      can stub the GraphQL call; the PUT only ever happens for a real
 *      `--send`/`LINEAR_SYNC_LIVE=1` run, since callers gate this whole
 *      function behind the same `live` check used for issueCreate/
 *      commentCreate).
 *
 * This function itself does NOT catch errors — any failure (network,
 * non-2xx PUT, malformed `fileUpload` response) propagates to the caller,
 * which is expected to treat it as fail-soft (see `runSync`'s
 * `attachReportSuffix` helper below).
 *
 * @param {string} apiKey
 * @param {string} filePath  absolute path to the local file to upload
 * @param {{requestFn?: typeof linearRequest}} [deps]
 * @returns {Promise<string>} the uploaded file's assetUrl
 */
async function uploadFileToLinear(apiKey, filePath, { requestFn = linearRequest } = {}) {
  const buffer = readFileSync(filePath);
  const filename = path.basename(filePath);
  const size = buffer.length;

  const data = await requestFn(
    apiKey,
    `mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
      fileUpload(contentType: $contentType, filename: $filename, size: $size) {
        success
        uploadFile { uploadUrl assetUrl headers { key value } }
      }
    }`,
    { contentType: XLSX_CONTENT_TYPE, filename, size }
  );

  if (!data?.fileUpload?.success || !data.fileUpload.uploadFile) {
    throw new Error("fileUpload did not report success");
  }
  const { uploadUrl, assetUrl, headers } = data.fileUpload.uploadFile;
  if (!uploadUrl || !assetUrl) {
    throw new Error("fileUpload response missing uploadUrl/assetUrl");
  }

  const putHeaders = { "Content-Type": XLSX_CONTENT_TYPE, "Cache-Control": "public, max-age=31536000" };
  for (const h of headers || []) {
    if (h?.key) putHeaders[h.key] = h.value;
  }

  let putRes;
  try {
    putRes = await fetch(uploadUrl, { method: "PUT", headers: putHeaders, body: buffer });
  } catch (err) {
    throw new Error(`Linear file upload PUT failed (network): ${err.message}`);
  }
  if (!putRes.ok) {
    throw new Error(`Linear file upload PUT failed: HTTP ${putRes.status}`);
  }

  return assetUrl;
}

async function resolveTeamId(apiKey, { requestFn = linearRequest } = {}) {
  try {
    const data = await requestFn(
      apiKey,
      `query($filter: TeamFilter) { teams(filter: $filter, first: 5) { nodes { id name } } }`,
      { filter: { name: { eq: TEAM_NAME } } }
    );
    const team = data?.teams?.nodes?.[0];
    if (!team) {
      console.error(`[linear-sync] WARN: team "${TEAM_NAME}" not found — issue creation will be skipped`);
      return null;
    }
    return team.id;
  } catch (err) {
    console.error(`[linear-sync] WARN: failed to resolve team "${TEAM_NAME}": ${err.message}`);
    return null;
  }
}

async function resolveProjectId(apiKey, { requestFn = linearRequest } = {}) {
  try {
    const data = await requestFn(
      apiKey,
      `query($filter: ProjectFilter) { projects(filter: $filter, first: 5) { nodes { id name } } }`,
      { filter: { name: { eq: PROJECT_NAME } } }
    );
    const project = data?.projects?.nodes?.[0];
    if (!project) {
      console.error(`[linear-sync] WARN: project "${PROJECT_NAME}" not found — skipping project assignment`);
      return null;
    }
    return project.id;
  } catch (err) {
    console.error(`[linear-sync] WARN: failed to resolve project "${PROJECT_NAME}": ${err.message}`);
    return null;
  }
}

async function resolveLabelId(apiKey, teamId, { requestFn = linearRequest } = {}) {
  try {
    const filter = teamId
      ? { name: { eq: LABEL_NAME }, team: { id: { eq: teamId } } }
      : { name: { eq: LABEL_NAME } };
    const data = await requestFn(
      apiKey,
      `query($filter: IssueLabelFilter) { issueLabels(filter: $filter, first: 5) { nodes { id name } } }`,
      { filter }
    );
    const label = data?.issueLabels?.nodes?.[0];
    if (!label) {
      console.error(`[linear-sync] WARN: label "${LABEL_NAME}" not found — skipping label`);
      return null;
    }
    return label.id;
  } catch (err) {
    console.error(`[linear-sync] WARN: failed to resolve label "${LABEL_NAME}": ${err.message}`);
    return null;
  }
}

async function resolveViewerId(apiKey, { requestFn = linearRequest } = {}) {
  try {
    const data = await requestFn(apiKey, `query { viewer { id name } }`, {});
    if (!data?.viewer?.id) {
      console.error(`[linear-sync] WARN: could not resolve viewer — skipping assignee`);
      return null;
    }
    return data.viewer.id;
  } catch (err) {
    console.error(`[linear-sync] WARN: failed to resolve viewer (assignee): ${err.message}`);
    return null;
  }
}

/**
 * Find the rolling heartbeat tracker issue by title. UNLIKE the resolve*
 * functions above, this DOES NOT swallow errors — it throws on a genuine
 * search failure (network/GraphQL error) so the caller can distinguish
 * "search failed" from "search succeeded, found nothing". Conflating the two
 * (the original bug) meant a transient search error was treated as "no
 * tracker exists yet", filing a DUPLICATE heartbeat issue on every blip.
 * Returns `null` ONLY on a genuine, successful "not found".
 */
async function findTrackerIssue(apiKey, teamId, { requestFn = linearRequest } = {}) {
  const filter = {
    title: { eq: TRACKER_TITLE },
    ...(teamId ? { team: { id: { eq: teamId } } } : {}),
  };
  const data = await requestFn(
    apiKey,
    `query($filter: IssueFilter) { issues(filter: $filter, first: 1) { nodes { id identifier title } } }`,
    { filter }
  );
  return data?.issues?.nodes?.[0] || null;
}

/**
 * Create a Linear issue — a NO-OP dry-run preview unless `live` is true (see
 * the DRY-RUN BY DEFAULT doc comment at the top of this file). This is the
 * exact function whose unconditional live-fire caused the TOW2-336 incident;
 * it now NEVER calls `requestFn` (the only thing that can touch the network)
 * when `live` is false.
 */
async function createIssue(apiKey, input, { requestFn = linearRequest, live = LIVE } = {}) {
  if (!live) {
    console.log(`[linear-sync] DRY-RUN — would create issue "${input.title}"`);
    return { id: "dry-run", identifier: "DRY-RUN", title: input.title };
  }
  const data = await requestFn(
    apiKey,
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id identifier title } }
    }`,
    { input }
  );
  if (!data?.issueCreate?.success || !data.issueCreate.issue) {
    throw new Error("issueCreate did not report success");
  }
  return data.issueCreate.issue;
}

/** Post a comment — same dry-run gate as createIssue above. */
async function createComment(apiKey, issueId, body, { requestFn = linearRequest, live = LIVE } = {}) {
  if (!live) {
    console.log(`[linear-sync] DRY-RUN — would post heartbeat comment on issue ${issueId}`);
    return { id: "dry-run" };
  }
  const data = await requestFn(
    apiKey,
    `mutation($input: CommentCreateInput!) {
      commentCreate(input: $input) { success comment { id } }
    }`,
    { input: { issueId, body } }
  );
  if (!data?.commentCreate?.success) {
    throw new Error("commentCreate did not report success");
  }
  return data.commentCreate.comment;
}

function dateStamp(iso) {
  return (iso || new Date().toISOString()).slice(0, 10);
}

/** The `.xlsx` render-report.py produces next to the source JSON report, same basename (see render-report.py's `xlsx_path`). */
function xlsxPathForReport(filename) {
  const stem = filename.replace(/\.json$/, "");
  return path.join(REPORTS_DIR, `${stem}.xlsx`);
}

function rank(sev) {
  return sev ? SEVERITY_RANK[sev] ?? 9 : 9;
}

function buildMarkdownTable(results) {
  const sorted = [...results].sort((a, b) => rank(a.severity) - rank(b.severity));
  const header = "| status | tool | domain | severity | note |\n| --- | --- | --- | --- | --- |";
  const rows = sorted.map((r) => {
    const note = (r.advice || r.error || "-").toString().replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 140);
    return `| ${r.status} | ${r.name} | ${r.domain} | ${r.severity || "-"} | ${note} |`;
  });
  return [header, ...rows].join("\n");
}

/**
 * Core delivery logic — given a parsed report + its filename, resolve
 * config and deliver to Linear (or preview it in dry-run). No file I/O
 * besides the report's own `.xlsx` attachment upload, no env reads (besides
 * the `live` default, which is itself overridable), no process.exit —
 * main() owns all of that. Dependency-injected (`requestFn`, `live`,
 * `uploadFn`) so the offline self-test (linear-sync.selftest.mjs) can
 * exercise this exact pipeline against a stub GraphQL transport AND a stub
 * file uploader instead of the live network/filesystem, and can force both
 * dry-run and live behavior in one process.
 *
 * @param {string} apiKey
 * @param {object} report  parsed full-*.json content
 * @param {string} filename  the report's own JSON filename (used to locate
 *   the sibling `.xlsx` render-report.py produced next to it)
 * @param {{requestFn?: typeof linearRequest, live?: boolean, uploadFn?: (filePath: string) => Promise<string>}} [deps]
 * @returns {Promise<{action: string, [key: string]: unknown}>}
 */
async function runSync(apiKey, report, filename, { requestFn = linearRequest, live = LIVE, uploadFn } = {}) {
  const summary = report.summary || {};
  const results = report.results || [];
  const total = results.length;
  const passCount = results.filter((r) => r.status === "PASS" || r.status === "SLOW").length;
  const slowCount = results.filter((r) => r.status === "SLOW").length;
  const date = dateStamp(report.finishedAt);
  const xlsxPath = xlsxPathForReport(filename);
  const upload = uploadFn || ((filePath) => uploadFileToLinear(apiKey, filePath, { requestFn }));

  /**
   * Upload the report's `.xlsx` and return a markdown suffix to append to
   * the issue/comment body (never throws — this is the fail-soft boundary
   * described in this file's module doc comment). Dry-run never uploads
   * (matches the DRY-RUN BY DEFAULT invariant for every other mutation in
   * this file) and instead just previews the intent.
   */
  async function attachReportSuffix() {
    if (!live) {
      console.log(`[linear-sync] DRY-RUN — would attach ${path.basename(xlsxPath)}`);
      return "";
    }
    try {
      const assetUrl = await upload(xlsxPath);
      return `\n\n📎 [Full report (xlsx)](${assetUrl})`;
    } catch (err) {
      console.error(`[linear-sync] WARN: report attachment upload failed: ${err.message}`);
      return `\n\n_(report attachment upload failed — see CI logs)_`;
    }
  }

  // Worse-of-both by rank -> {P0,P1,P2} on EITHER field triggers the alert
  // path (an OR condition; taking the worse rank is equivalent since P3/null
  // never outrank a real P0-P2 on the other field).
  const worst = rank(summary.maxOursSeverity) <= rank(summary.maxSeverity) ? summary.maxOursSeverity : summary.maxSeverity;
  const isAlertWorthy = worst === "P0" || worst === "P1" || worst === "P2";

  const teamId = await resolveTeamId(apiKey, { requestFn });
  const projectId = await resolveProjectId(apiKey, { requestFn });
  const labelId = await resolveLabelId(apiKey, teamId, { requestFn });
  const assigneeId = await resolveViewerId(apiKey, { requestFn });

  if (!teamId) {
    console.error("[linear-sync] no team resolved — issueCreate requires a teamId, aborting delivery for this run");
    return { action: "skipped-no-team" };
  }

  if (isAlertWorthy) {
    const backendDown = [
      ...new Set(
        results
          .filter((r) => r.domain === "③-backend" && r.status === "FAIL" && r.platform && r.platform !== "-")
          .map((r) => r.platform)
      ),
    ];
    const title = `[MCP Daily] ${date} · ${worst} · ${passCount}/${total} ok · backend down: ${
      backendDown.length > 0 ? backendDown.join(", ") : "none"
    }`;
    const attachmentSuffix = await attachReportSuffix();
    const body =
      [
        `**Severity:** ${worst}  (ours: ${summary.maxOursSeverity || "-"}, overall incl. backend: ${summary.maxSeverity || "-"})`,
        `**Pass rate:** ${passCount}/${total}${slowCount > 0 ? ` (${slowCount} slow)` : ""}`,
        `**Ours (①/②) issues:** ${summary.oursCount ?? 0}  ·  **Backend (③) issues:** ${summary.backendCount ?? 0}`,
        "",
        buildMarkdownTable(results),
      ].join("\n") + attachmentSuffix;

    const input = { title, description: body, teamId };
    if (projectId) input.projectId = projectId;
    if (labelId) input.labelIds = [labelId];
    if (assigneeId) input.assigneeId = assigneeId;

    try {
      const issue = await createIssue(apiKey, input, { requestFn, live });
      console.log(`[linear-sync] ${live ? "created issue" : "dry-run previewed issue"} ${issue.identifier}`);
      return { action: "issue-created", issue };
    } catch (err) {
      console.error(`[linear-sync] delivery failed: ${err.message}`);
      return { action: "error", error: err.message };
    }
  }

  // Green / P3-only path: find-or-create the single rolling heartbeat
  // tracker, then post a dated comment. The search step is handled
  // separately from the create/comment step below so a SEARCH ERROR can
  // `return` immediately without ever reaching createIssue/createComment —
  // see findTrackerIssue's doc comment for why this distinction matters.
  let tracker;
  try {
    tracker = await findTrackerIssue(apiKey, teamId, { requestFn });
  } catch (err) {
    console.error(
      `[linear-sync] WARN: tracker search failed (${err.message}) — skipping delivery this run to avoid risking a duplicate heartbeat issue`
    );
    return { action: "skipped-search-error" };
  }

  try {
    if (!tracker) {
      const input = {
        title: TRACKER_TITLE,
        teamId,
        description:
          "Rolling heartbeat for the MCP daily full-tools probe (Layer D). Dated comments are appended below on every green run; a separate alert issue is filed on any P0/P1/P2 finding instead of a comment here.",
      };
      if (projectId) input.projectId = projectId;
      if (labelId) input.labelIds = [labelId];
      if (assigneeId) input.assigneeId = assigneeId;
      tracker = await createIssue(apiKey, input, { requestFn, live });
      console.log(`[linear-sync] ${live ? "created tracker issue" : "dry-run previewed tracker issue"} ${tracker.identifier}`);
    }

    const healthNote = slowCount > 0 ? `${passCount}/${total}, ${slowCount} slow` : `${total}/${total}`;
    const attachmentSuffix = await attachReportSuffix();
    const commentBody = `✅ ${date} all healthy (${healthNote})${attachmentSuffix}`;
    const comment = await createComment(apiKey, tracker.id, commentBody, { requestFn, live });
    console.log(`[linear-sync] ${live ? "posted heartbeat comment on" : "dry-run previewed comment on"} ${tracker.identifier}`);
    return { action: "heartbeat", tracker, comment };
  } catch (err) {
    console.error(`[linear-sync] delivery failed: ${err.message}`);
    return { action: "error", error: err.message };
  }
}

async function main() {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error("[linear-sync] LINEAR_API_KEY not set — skipping Linear delivery");
    return;
  }

  let filename, fullPath;
  try {
    ({ filename, fullPath } = findLatestReport());
  } catch (err) {
    console.error(`[linear-sync] ${err.message} — skipping Linear delivery`);
    return;
  }

  let report;
  try {
    report = JSON.parse(readFileSync(fullPath, "utf8"));
  } catch (err) {
    console.error(`[linear-sync] failed to read/parse ${filename}: ${err.message} — skipping Linear delivery`);
    return;
  }

  console.log(
    LIVE
      ? "[linear-sync] LIVE mode (--send / LINEAR_SYNC_LIVE=1) — mutations WILL be sent to Linear."
      : "[linear-sync] DRY-RUN mode (no --send / LINEAR_SYNC_LIVE unset) — resolving config and previewing delivery only, no mutations will be sent."
  );

  await runSync(apiKey, report, filename);
}

// Only auto-run main() when this file is executed directly (`node
// linear-sync.mjs`), never when imported — the offline self-test
// (linear-sync.selftest.mjs) imports this module's exported pipeline pieces
// without triggering a live run (which would otherwise read LINEAR_API_KEY
// from the ambient environment and could reach the network).
const isDirectRun = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      // Defensive last resort — runSync already try/catches its own
      // delivery errors; this should be unreachable, but a Linear delivery
      // failure must NEVER fail the monitor run (see the module doc
      // comment's Failure mode).
      console.error(`[linear-sync] FATAL (unexpected, exiting 0 anyway): ${err?.message || err}`);
      process.exit(0);
    });
}

export {
  LIVE,
  TEAM_NAME,
  PROJECT_NAME,
  LABEL_NAME,
  TRACKER_TITLE,
  XLSX_CONTENT_TYPE,
  findLatestReport,
  linearRequest,
  uploadFileToLinear,
  resolveTeamId,
  resolveProjectId,
  resolveLabelId,
  resolveViewerId,
  findTrackerIssue,
  createIssue,
  createComment,
  xlsxPathForReport,
  buildMarkdownTable,
  runSync,
};
