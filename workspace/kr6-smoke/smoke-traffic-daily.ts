// Smoke test for /v1/{residential,isp,mobile,datacenter,static}_flow/consume_log fan-out.
// Run: NOVADA_DEVELOPER_API_KEY=xxx npx tsx workspace/kr6-smoke/smoke-traffic-daily.ts
//
// Expected: status: "ok" | "partial". Each per_product[<key>] shows raw consume_log.
//
// Known unknowns (see FUDONG-CLARIFY.md):
//   - mobile_flow / static_flow endpoints undocumented; may 404
//   - response per-row schema unconfirmed → total_mb_across_products may be 0 even on success
//     until we know the right field name to sum

import {
  novadaTrafficDaily,
  validateTrafficDailyParams,
} from "../../src/tools/traffic_daily.js";

async function main() {
  if (!process.env.NOVADA_DEVELOPER_API_KEY && !process.env.NOVADA_API_KEY) {
    console.error("Set NOVADA_DEVELOPER_API_KEY (or NOVADA_API_KEY) before running.");
    process.exit(1);
  }
  // 7-day window — broadest realistic default for testing
  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const params = validateTrafficDailyParams({
    start_time: fmt(sevenDaysAgo),
    end_time: fmt(today),
  });
  try {
    console.log(await novadaTrafficDaily(params));
  } catch (err) {
    console.error("THREW:", err);
    process.exit(2);
  }
}
main();
