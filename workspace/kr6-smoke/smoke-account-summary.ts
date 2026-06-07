// Smoke test for the composite account_summary tool.
// Run: NOVADA_DEVELOPER_API_KEY=xxx npx tsx workspace/kr6-smoke/smoke-account-summary.ts
//
// Expected: { status: "ok" | "partial", headline: "Wallet: €X · Plans: N active / M expired ...", sections: {...} }
// This calls wallet_balance + plan_balance_all + capture_logs in parallel. Partial failures
// (e.g. capture_logs if /v1/capture/logs endpoint path is wrong) bubble up via section.ok = false.

import {
  novadaAccountSummary,
  validateAccountSummaryParams,
} from "../../src/tools/account_summary.js";

async function main() {
  if (!process.env.NOVADA_DEVELOPER_API_KEY && !process.env.NOVADA_API_KEY) {
    console.error("Set NOVADA_DEVELOPER_API_KEY (or NOVADA_API_KEY) before running.");
    process.exit(1);
  }
  const params = validateAccountSummaryParams({});
  try {
    console.log(await novadaAccountSummary(params));
  } catch (err) {
    console.error("THREW:", err);
    process.exit(2);
  }
}
main();
