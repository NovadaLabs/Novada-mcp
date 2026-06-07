// Smoke test for /v1/capture/logs.
// Run: NOVADA_DEVELOPER_API_KEY=xxx npx tsx workspace/kr6-smoke/smoke-capture-logs.ts
//
// ⚠️  This endpoint path is UNDOCUMENTED in our captured API specs (see FUDONG-CLARIFY.md #1).
// Expected outcomes:
//   - 200 + envelope code=0: endpoint exists with current field names → ok
//   - 404 or 405: endpoint path wrong → ask fudong for correct path
//   - code=10001: field names wrong → diagnostic against the multipart contract
//
// All three outcomes are useful diagnostics — DO NOT consider failure here a blocker for the
// other tools (which are confirmed working).

import {
  novadaCaptureLogs,
  validateCaptureLogsParams,
} from "../../src/tools/capture_logs.js";

async function main() {
  if (!process.env.NOVADA_DEVELOPER_API_KEY && !process.env.NOVADA_API_KEY) {
    console.error("Set NOVADA_DEVELOPER_API_KEY (or NOVADA_API_KEY) before running.");
    process.exit(1);
  }
  const params = validateCaptureLogsParams({ page: 1, page_size: 5 });
  try {
    console.log(await novadaCaptureLogs(params));
  } catch (err) {
    console.error("THREW:", err);
    process.exit(2);
  }
}
main();
