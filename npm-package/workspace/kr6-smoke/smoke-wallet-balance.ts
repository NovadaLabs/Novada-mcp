// Smoke test for /v1/wallet/balance.
// Run: NOVADA_DEVELOPER_API_KEY=xxx npx tsx workspace/kr6-smoke/smoke-wallet-balance.ts
//
// Expected: { status: "ok", data: { balance: <float>, ... }, agent_instruction: "..." }
// Failure mode to watch for: code=10001 → multipart helper still misconfigured.

import {
  novadaWalletBalance,
  validateWalletBalanceParams,
} from "../../src/tools/wallet_balance.js";

async function main() {
  if (!process.env.NOVADA_DEVELOPER_API_KEY && !process.env.NOVADA_API_KEY) {
    console.error("Set NOVADA_DEVELOPER_API_KEY (or NOVADA_API_KEY) before running.");
    process.exit(1);
  }
  const params = validateWalletBalanceParams({});
  try {
    console.log(await novadaWalletBalance(params));
  } catch (err) {
    console.error("THREW:", err);
    process.exit(2);
  }
}
main();
