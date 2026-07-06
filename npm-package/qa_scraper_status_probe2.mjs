/**
 * QA Red-Team probe PART 2 — targeted follow-up probes
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CREDS = {
  NOVADA_API_KEY: "1f35b477c9e1802778ec64aee2a6adfa",
  NOVADA_PROXY_USER: "tongwu_TRDI7X",
  NOVADA_PROXY_PASS: "_Asd1644asd_",
  NOVADA_BROWSER_WS: "wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com",
};

function makeTransport() {
  return new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: { ...process.env, ...CREDS },
  });
}

async function withClient(fn) {
  const transport = makeTransport();
  const client = new Client({ name: "qa-probe", version: "1.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function callTool(client, name, args) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    return { ok: true, result, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err, ms: Date.now() - start };
  }
}

function summarize(label, r) {
  console.log(`\n=== ${label} (${r.ms}ms) ===`);
  if (r.ok) {
    const content = r.result?.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (c.type === "text") {
          console.log("text:", c.text.slice(0, 800));
          if (c.text.length > 800) console.log(`...(total ${c.text.length})`);
        } else {
          console.log("content item:", JSON.stringify(c).slice(0, 300));
        }
      }
    } else {
      console.log("raw result:", JSON.stringify(r.result).slice(0, 800));
    }
    console.log("isError:", r.result?.isError);
    console.log("structuredContent:", r.result?.structuredContent !== undefined ? JSON.stringify(r.result.structuredContent).slice(0,200) : "NOT PRESENT");
  } else {
    const e = r.error;
    console.log("ERROR code:", e?.code, "msg:", e?.message?.slice(0, 500));
  }
}

(async () => {
  // PROBE A: 128-char exact boundary (valid per schema maxLength)
  const exactly128 = "A".repeat(128);
  const rA = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: exactly128 })
  );
  summarize("PROBE A — 128-char task_id (exact boundary, all A's)", rA);

  // PROBE B: 129-char (just over boundary)
  const over129 = "A".repeat(129);
  const rB = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: over129 })
  );
  summarize("PROBE B — 129-char task_id (1 over boundary)", rB);

  // PROBE C: not_found vs isError — confirm behavior
  // The description says "Returns: pending, running, complete, or failed" — NOT "not_found"
  // Check if "not_found" is a documented status or undocumented extra
  const rC = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: "nonexistent-task-999" })
  );
  summarize("PROBE C — not_found status: isError flag check", rC);
  if (rC.ok) {
    let parsed = null;
    try { parsed = JSON.parse(rC.result?.content?.[0]?.text || ""); } catch {}
    console.log("Parsed JSON status:", parsed?.status);
    console.log("isError on result:", rC.result?.isError);
    console.log("ISSUE: tool description says statuses are pending/running/complete/failed. Got:", parsed?.status);
    console.log("ISSUE: not_found treated as success (isError=undefined/false) — agent must inspect JSON to detect error state");
  }

  // PROBE D: additionalProperties=false — try array type
  const rD = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: ["array-value"] })
  );
  summarize("PROBE D — array as task_id", rD);

  // PROBE E: oversized but exact error message check
  // 200 A's = over 128; schema pattern ^[a-zA-Z0-9_\-\.]{1,128}$ covers both length AND chars
  // The error message says "alphanumeric with underscores/hyphens/dots only" — omits the length violation
  const rE = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: "A".repeat(200) })
  );
  summarize("PROBE E — 200 A's (oversized): error message specificity", rE);
  if (rE.ok && rE.result?.isError) {
    const txt = rE.result?.content?.[0]?.text || "";
    const mentionsLength = txt.toLowerCase().includes("length") || txt.includes("128") || txt.includes("too long");
    console.log("Error mentions length constraint:", mentionsLength);
    console.log("Full error text:", txt);
  }

  // PROBE F: whitespace-only task_id (would bypass minLength=1 if not trimmed, but is not alphanumeric)
  const rF = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: "   " })
  );
  summarize("PROBE F — whitespace-only task_id", rF);

  // PROBE G: check what happens with valid-format but very short task_id (1 char — minLength=1)
  const rG = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: "x" })
  );
  summarize("PROBE G — single char task_id (min boundary)", rG);

  // PROBE H: check for secrets in error response (make a call with wrong API key)
  const transportBadKey = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: { ...process.env, NOVADA_API_KEY: "invalid-key-12345" },
  });
  const clientBadKey = new Client({ name: "qa-probe", version: "1.0.0" });
  await clientBadKey.connect(transportBadKey);
  const start = Date.now();
  let rH;
  try {
    const result = await clientBadKey.callTool({ name: "novada_scraper_status", arguments: { task_id: "test-task-123" } });
    rH = { ok: true, result, ms: Date.now() - start };
  } catch (err) {
    rH = { ok: false, error: err, ms: Date.now() - start };
  } finally {
    await clientBadKey.close();
  }
  summarize("PROBE H — invalid API key: check for secret leakage", rH);
  if (rH.ok) {
    const txt = rH.result?.content?.[0]?.text || "";
    const leaksKey = txt.includes("invalid-key-12345") || txt.includes("1f35b477");
    console.log("API key leaked in response:", leaksKey);
    console.log("Has agent_instruction:", txt.includes("agent_instruction"));
  }

  console.log("\n=== PART 2 PROBING COMPLETE ===");
})();
