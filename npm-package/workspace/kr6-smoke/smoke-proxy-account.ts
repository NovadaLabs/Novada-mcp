// Smoke test for /v1/proxy_account/list after the multipart fix.
// Run: NOVADA_DEVELOPER_API_KEY=xxx npx tsx workspace/kr6-smoke/smoke-proxy-account.ts
//
// Expected outcome AFTER fix:
//   - HTTP 200, envelope { code: 0, msg: "success", data: { list: [...], total: N } }
//   - NO `code:10001 Invalid parameter` (that was the symptom of JSON + wrong field names)
//
// If it still returns 10001 → field names still wrong, surface raw response to fudong.

import {
  novadaProxyAccountList,
  validateProxyAccountListParams,
} from "../../src/tools/proxy_account_list.js";

async function main() {
  if (!process.env.NOVADA_DEVELOPER_API_KEY && !process.env.NOVADA_API_KEY) {
    console.error("Set NOVADA_DEVELOPER_API_KEY (or NOVADA_API_KEY) before running.");
    process.exit(1);
  }

  // Product "1" = Residential. Adjust if the test account doesn't have residential.
  const params = validateProxyAccountListParams({
    product: "1",
    page: 1,
    limit: 5,
  });

  try {
    const result = await novadaProxyAccountList(params);
    console.log("=== RAW TOOL OUTPUT ===");
    console.log(result);
  } catch (err) {
    console.error("=== TOOL THREW ===");
    console.error(err);
    process.exit(2);
  }
}

main();
