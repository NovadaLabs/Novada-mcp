import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "build/index.js");

const env = {
  ...process.env,
  NOVADA_API_KEY: "1f35b477c9e1802778ec64aee2a6adfa",
  NOVADA_PROXY_USER: "tongwu_TRDI7X",
  NOVADA_PROXY_PASS: "_Asd1644asd_",
  NOVADA_BROWSER_WS: "wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com",
};

async function makeClient() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env,
  });
  const client = new Client({ name: "qa-probe", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

async function callTool(client, name, args) {
  try {
    const result = await client.callTool({ name, arguments: args });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function run() {
  const { client, transport } = await makeClient();

  // ── G. Confirm XSS claim produces false "supported" verdict ─────────────────
  // The claim "<script>alert(1)</script> 日本語" got verdict: supported.
  // The key issue: the search finds XSS articles because "<script>" and "alert(1)"
  // are in the queries, and those articles are about XSS (a real topic),
  // so "isRelevant" returns true for terms like "script", "alert" — even though
  // those are JavaScript keywords, not factual claims.
  // Let's check what keyTerms would be extracted:

  console.log("\n=== G. Simulate extractKeyTerms for XSS claim ===");
  // Manually test the claim text
  const claimXSS = "<script>alert(1)</script> 日本語  ";
  // The regex in extractKeyTerms is /[a-z0-9]+/g
  // From this claim, the only tokens matching [a-z0-9]+ are: "script", "alert", "1", "script"
  // "script" length=6 ≥4, not in STOP_WORDS → key term
  // "alert" length=5 ≥4, not in STOP_WORDS → key term
  // "1" length=1 < 4 and not ≥4 digits → dropped
  // So keyTerms = ["script", "alert"]
  // Then the query sends: '"<script>alert(1)</script> 日本語  " evidence study research'
  // Google sees "script" and "alert" in the query and finds XSS articles
  // Those articles mention "script" and "alert" → isRelevant = true
  // So this is a confirmed false positive: the tool says "supported" for a nonsense claim
  console.log("Expected keyTerms for XSS claim: ['script', 'alert']");
  console.log("This is a logic flaw: keywords from the claim are JavaScript syntax, not factual terms");
  console.log("The tool will find XSS security articles as 'evidence' for a nonsense claim");

  // Let's also run the actual XSS claim one more time to confirm verdict is stable
  const tg = await callTool(client, "novada_verify", {
    claim: "<script>alert(1)</script> this is not a real claim",
  });
  console.log("\nXSS claim verdict:", tg.result?.content?.[0]?.text?.match(/verdict: (\w+)/)?.[1]);
  console.log("XSS claim isError:", tg.result?.isError);
  console.log("output (400 chars):", tg.result?.content?.[0]?.text?.substring(0, 400));

  // ── H. Null bytes / control chars in claim ──────────────────────────────────
  console.log("\n=== H. Control chars in claim ===");
  const th = await callTool(client, "novada_verify", {
    claim: "The Earth orbits\x00the Sun\x01actually",
  });
  console.log("ok:", th.ok, "isError:", th.result?.isError);
  console.log("output (first 300 chars):", th.result?.content?.[0]?.text?.substring(0, 300));

  // ── I. Confirm: does the 10KB claim output leak the full 10KB in the output? ─
  console.log("\n=== I. 10KB claim — check if claim is echoed in output ===");
  const hugeClaim = "x".repeat(10000);
  const ti = await callTool(client, "novada_verify", { claim: hugeClaim });
  const tiOutput = ti.result?.content?.[0]?.text || "";
  console.log("output length:", tiOutput.length);
  // Does the output echo the claim?
  const claimInOutput = tiOutput.includes(hugeClaim.substring(0, 100));
  console.log("10KB claim echoed in output:", claimInOutput);
  console.log("output (first 600 chars):", tiOutput.substring(0, 600));

  // ── J. Verify: claimed false service unavailable for 10KB ───────────────────
  // The 10KB of "x".repeat(10000) returns "Verify Unavailable" saying
  // "Search returned 0 results for all 3 queries. Scraper API (search) is not activated"
  // But this is misleading! The real reason is that searching for 10KB of "x"
  // just returns no results (unsurprisingly), not that the scraper is unavailable.
  // Let's check: the condition is "all 3 queries failed AND results.length === 0"
  // The query would be: '"xxxx...xxxx" evidence study research'
  // This doesn't fail — it probably returns 0 results (no pages have 10KB of x's)
  // But the code checks: queryResults.every(r => r.failed && r.results.length === 0)
  // r.failed is false if the search succeeded with 0 results
  // So this path shouldn't trigger... unless the search actually throws an error
  // for 10KB queries. Let's test with a 500-char repeated claim to disambiguate.
  console.log("\n=== J. 500 char claim (repeated) ===");
  const mediumClaim = "x".repeat(500);
  const tj = await callTool(client, "novada_verify", { claim: mediumClaim });
  const tjOutput = tj.result?.content?.[0]?.text || "";
  console.log("verdict:", tjOutput.match(/verdict: (\w+)/)?.[1]);
  console.log("output (first 400 chars):", tjOutput.substring(0, 400));

  await transport.close();
}

run().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
