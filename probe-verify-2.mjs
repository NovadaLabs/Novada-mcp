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

  // ── A. Missing required claim: check isError flag and output structure ────
  console.log("\n=== A. Missing claim — check isError ===");
  const ta = await callTool(client, "novada_verify", {});
  console.log("ok:", ta.ok);
  if (ta.ok) {
    const raw = ta.result;
    console.log("isError:", raw.isError);
    console.log("content:", JSON.stringify(raw.content));
  }

  // ── B. XSS injection in claim — check verdict behavior ─────────────────────
  // The injection claim "<script>alert(1)</script> 日本語" returned verdict: supported.
  // Investigate what key terms were extracted and why it got "supported"
  console.log("\n=== B. Pure XSS no real words claim ===");
  const tb = await callTool(client, "novada_verify", {
    claim: "<script>alert(1)</script> lorem ipsum dolor sit amet",
  });
  console.log("ok:", tb.ok);
  if (tb.ok) {
    const content = tb.result?.content?.[0]?.text || "";
    // extract verdict line
    const verdictMatch = content.match(/verdict: (\w+)/);
    console.log("verdict:", verdictMatch?.[1]);
    console.log("output (first 600 chars):", content.substring(0, 600));
  }

  // ── C. Confirm: 10KB claim says "not activated" but claim was not an issue?
  // Is the "not activated" message misleading for 10KB claims? Let's try a shorter
  // claim that should work but uses gibberish so we can compare.
  console.log("\n=== C. Gibberish claim (but >= 10 chars) ===");
  const tc = await callTool(client, "novada_verify", {
    claim: "xkzqfjwbvmxkzqfjwbvm xkzqfjwbvm",
  });
  console.log("ok:", tc.ok);
  if (tc.ok) {
    const content = tc.result?.content?.[0]?.text || "";
    console.log("verdict:", content.match(/verdict: (\w+)/)?.[1]);
    console.log("output (first 400 chars):", content.substring(0, 400));
  }

  // ── D. Verify the 10KB claim: "Verify Unavailable" is misleading message ───
  // 10KB of x's has no meaningful key terms. Let's test with 10KB of actual English
  console.log("\n=== D. 10KB meaningful claim ===");
  const longClaim = "The Earth is round and orbits the Sun in an elliptical orbit ".repeat(170).substring(0, 10000);
  const td = await callTool(client, "novada_verify", { claim: longClaim });
  console.log("ok:", td.ok);
  if (td.ok) {
    const content = td.result?.content?.[0]?.text || "";
    console.log("verdict:", content.match(/verdict: (\w+)/)?.[1]);
    console.log("output (first 600 chars):", content.substring(0, 600));
  }

  // ── E. Confirm the "missing claim" returns an isError-free success ──────────
  // The MCP spec says validation failures should return isError:true
  // Let's check what happens with wrong type
  console.log("\n=== E. Wrong type isError check ===");
  const te = await callTool(client, "novada_verify", { claim: 12345 });
  console.log("ok:", te.ok);
  if (te.ok) {
    const raw = te.result;
    console.log("isError:", raw.isError);
    console.log("content text:", raw.content?.[0]?.text?.substring(0, 200));
  }

  // ── F. Super long context ────────────────────────────────────────────────────
  console.log("\n=== F. Super long context (5KB) ===");
  const tf = await callTool(client, "novada_verify", {
    claim: "The Earth orbits the Sun",
    context: "additional context ".repeat(300),
  });
  console.log("ok:", tf.ok);
  if (tf.ok) {
    const content = tf.result?.content?.[0]?.text || "";
    console.log("verdict:", content.match(/verdict: (\w+)/)?.[1]);
    console.log("output (first 400 chars):", content.substring(0, 400));
  }

  await transport.close();
}

run().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
