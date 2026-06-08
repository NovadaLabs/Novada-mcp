// Smoke test for /v1/{residential,isp,mobile,datacenter,static}_flow/balance + /v1/capture/get_balance.
// Run: NOVADA_DEVELOPER_API_KEY=xxx npx tsx workspace/kr6-smoke/smoke-plan-balance-all.ts
//
// Expected: status: "ok" | "partial". Mobile + static may show "unavailable" (404 = product not
//           provisioned on this account, NOT a real bug). Residential/isp/datacenter/capture should
//           all return real balances on a normal dev account.

import {
  novadaPlanBalanceAll,
  validatePlanBalanceAllParams,
} from "../../src/tools/plan_balance_all.js";

async function main() {
  if (!process.env.NOVADA_DEVELOPER_API_KEY && !process.env.NOVADA_API_KEY) {
    console.error("Set NOVADA_DEVELOPER_API_KEY (or NOVADA_API_KEY) before running.");
    process.exit(1);
  }
  const params = validatePlanBalanceAllParams({});
  try {
    console.log(await novadaPlanBalanceAll(params));
  } catch (err) {
    console.error("THREW:", err);
    process.exit(2);
  }
}
main();
