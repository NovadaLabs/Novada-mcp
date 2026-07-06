/**
 * QA Red-Team probe for novada_scraper_status
 * Runs against build/index.js over stdio MCP transport
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

// ── helpers ──────────────────────────────────────────────────────────────────

function summarize(label, r) {
  console.log(`\n=== ${label} (${r.ms}ms) ===`);
  if (r.ok) {
    const content = r.result?.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (c.type === "text") {
          const txt = c.text.slice(0, 600);
          console.log("text:", txt);
          if (c.text.length > 600) console.log(`...(truncated, total ${c.text.length})`);
        } else {
          console.log("content item:", JSON.stringify(c).slice(0, 300));
        }
      }
    } else {
      console.log("raw result:", JSON.stringify(r.result).slice(0, 600));
    }
    if (r.result?.isError) console.log("isError=true");
  } else {
    const e = r.error;
    console.log("ERROR code:", e?.code, "msg:", e?.message?.slice(0, 500));
    if (e?.data) console.log("data:", JSON.stringify(e.data).slice(0, 300));
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

(async () => {
  // Step 0: list tools to get real inputSchema for novada_scraper_status
  console.log("=== STEP 0: listTools ===");
  const schema = await withClient(async (client) => {
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === "novada_scraper_status");
    if (!t) {
      console.log("TOOL NOT FOUND! Available:", tools.map((x) => x.name).filter(n => n.includes("scraper")));
      return null;
    }
    console.log("Found:", t.name);
    console.log("description:", t.description?.slice(0, 300));
    console.log("inputSchema:", JSON.stringify(t.inputSchema, null, 2));
    return t.inputSchema;
  });

  if (!schema) {
    console.log("Cannot proceed — tool not found");
    process.exit(1);
  }

  // ── PROBE 1: happy-path — well-formed but non-existent task_id ─────────────
  // We expect a "not found" or "pending/failed" style response, NOT a crash
  const r1 = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: "test-task-id-does-not-exist-12345" })
  );
  summarize("PROBE 1 — valid format, non-existent task_id", r1);

  // ── PROBE 2: get a real task_id by submitting first ────────────────────────
  // Submit an amazon product scrape to get a real task_id
  let realTaskId = null;
  const submitResult = await withClient((c) =>
    callTool(c, "novada_scraper_submit", {
      platform: "amazon.com",
      operation: "amazon_product_keywords",
      params: { keyword: "laptop", num: 1 },
    })
  );
  summarize("PROBE 2a — submit to get real task_id", submitResult);
  if (submitResult.ok && !submitResult.result?.isError) {
    const txt = submitResult.result?.content?.[0]?.text || "";
    const m = txt.match(/task[_\-]?id["\s:]+([a-zA-Z0-9._\-]{3,128})/i);
    if (m) realTaskId = m[1];
    // Also try JSON parse
    if (!realTaskId) {
      try {
        const parsed = JSON.parse(txt);
        realTaskId = parsed?.task_id || parsed?.taskId || parsed?.id;
      } catch {}
    }
    console.log("Extracted task_id:", realTaskId);
  }

  if (realTaskId) {
    const r2b = await withClient((c) =>
      callTool(c, "novada_scraper_status", { task_id: realTaskId })
    );
    summarize("PROBE 2b — status check on real task_id", r2b);
  }

  // ── PROBE 3: missing required param (task_id omitted) ─────────────────────
  const r3 = await withClient((c) =>
    callTool(c, "novada_scraper_status", {})
  );
  summarize("PROBE 3 — missing task_id (required)", r3);

  // ── PROBE 4: wrong type — integer instead of string ───────────────────────
  const r4 = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: 99999 })
  );
  summarize("PROBE 4 — wrong type (integer task_id)", r4);

  // ── PROBE 5: empty string ──────────────────────────────────────────────────
  const r5 = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: "" })
  );
  summarize("PROBE 5 — empty string task_id", r5);

  // ── PROBE 6: very long string (>128 chars) ────────────────────────────────
  const r6 = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: "A".repeat(200) })
  );
  summarize("PROBE 6 — oversized task_id (200 chars)", r6);

  // ── PROBE 7: unicode + special chars ─────────────────────────────────────
  const r7 = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: "task-unicode-中文-éà" })
  );
  summarize("PROBE 7 — unicode task_id", r7);

  // ── PROBE 8: injection-style value ───────────────────────────────────────
  const r8 = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: "../../etc/passwd" })
  );
  summarize("PROBE 8 — path traversal task_id", r8);

  // ── PROBE 9: extra/unknown param ─────────────────────────────────────────
  const r9 = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: "test-123", unknownParam: "evil" })
  );
  summarize("PROBE 9 — extra unknown param", r9);

  // ── PROBE 10: null value ──────────────────────────────────────────────────
  const r10 = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: null })
  );
  summarize("PROBE 10 — null task_id", r10);

  // ── PROBE 11: SQL injection in task_id ───────────────────────────────────
  const r11 = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: "'; DROP TABLE tasks; --" })
  );
  summarize("PROBE 11 — SQL injection task_id", r11);

  // ── PROBE 12: check agent_instruction presence on error ───────────────────
  // (checking if error response includes agent_instruction field)
  console.log("\n=== PROBE 12 — inspect agent_instruction on error response ===");
  const r12 = await withClient((c) =>
    callTool(c, "novada_scraper_status", { task_id: "definitely-not-real-xxxyyy" })
  );
  summarize("PROBE 12 — check agent_instruction", r12);
  if (r12.ok) {
    const txt = r12.result?.content?.[0]?.text || "";
    const hasAgentInstruction = txt.includes("agent_instruction") || txt.toLowerCase().includes("next action") || txt.toLowerCase().includes("next step");
    console.log("Has agent_instruction guidance:", hasAgentInstruction);
    console.log("isError flag:", r12.result?.isError);
  }

  console.log("\n=== PROBING COMPLETE ===");
})();
