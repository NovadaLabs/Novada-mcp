// Smoke test for /v1/wallet/usage_record.
// Run: NOVADA_DEVELOPER_API_KEY=xxx npx tsx workspace/kr6-smoke/smoke-wallet-usage-record.ts
//
// Expected: { status: "ok", data: { count: N, list: [...] }, ... }
// Note: this endpoint genuinely uses `page_size`, not `limit` (per 2026-06-03 live smoke).
//       If you see code=10001, the multipart helper is broken — diagnostic mismatch.

import {
  novadaWalletUsageRecord,
  validateWalletUsageRecordParams,
} from "../../src/tools/wallet_usage_record.js";

async function main() {
  if (!process.env.NOVADA_DEVELOPER_API_KEY && !process.env.NOVADA_API_KEY) {
    console.error("Set NOVADA_DEVELOPER_API_KEY (or NOVADA_API_KEY) before running.");
    process.exit(1);
  }
  const params = validateWalletUsageRecordParams({ page: 1, page_size: 5 });
  try {
    console.log(await novadaWalletUsageRecord(params));
  } catch (err) {
    console.error("THREW:", err);
    process.exit(2);
  }
}
main();
