/**
 * Annotation contract check: verify MCP annotation semantics for all tools
 *
 * Per MCP spec:
 * - destructiveHint: true = tool can permanently change state (write/delete)
 * - readOnlyHint: true = tool only reads, no side effects
 * - idempotentHint: true = identical calls have same effect
 * - openWorldHint: true = tool may interact with external systems
 *
 * Key invariant: destructiveHint:true tools should NOT have readOnlyHint:true
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

async function runAnnotationTests() {
  const findings = [];

  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: { ...process.env, NOVADA_API_KEY: KEY },
  });
  const c = new Client({ name: "qa-annotations", version: "0" }, { capabilities: {} });
  await c.connect(t);

  const listResult = await c.listTools();
  const tools = listResult.tools;

  for (const tool of tools) {
    const a = tool.annotations || {};

    // Invariant 1: no tool can be both readOnly AND destructive
    if (a.readOnlyHint === true && a.destructiveHint === true) {
      findings.push({
        tool: tool.name,
        issue: "readOnlyHint:true AND destructiveHint:true — contradictory",
        severity: "High",
      });
      console.error(`[FINDING] ${tool.name}: readOnlyHint AND destructiveHint both true`);
    }

    // Invariant 2: idempotentHint:true but destructiveHint:true is unusual
    if (a.idempotentHint === true && a.destructiveHint === true) {
      findings.push({
        tool: tool.name,
        issue: "idempotentHint:true AND destructiveHint:true — unusual (destructive + idempotent)",
        severity: "Low",
      });
      console.warn(`[WARN] ${tool.name}: idempotentHint AND destructiveHint both true`);
    }

    // Print all annotations
    console.log(`${tool.name}: readOnly=${a.readOnlyHint} idempotent=${a.idempotentHint} destructive=${a.destructiveHint} openWorld=${a.openWorldHint}`);
  }

  // Check specific tools with known expected annotations
  const expectedAnnotations = {
    novada_ip_whitelist: { destructiveHint: true, readOnlyHint: false },
    novada_proxy_account_create: { destructiveHint: false, readOnlyHint: false }, // WRITE but not destructive
    novada_search: { readOnlyHint: true, destructiveHint: false },
    novada_setup: { readOnlyHint: true, destructiveHint: false },
    novada_session_stats: { readOnlyHint: true, destructiveHint: false },
  };

  for (const [name, expected] of Object.entries(expectedAnnotations)) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      findings.push({ tool: name, issue: "tool not found in list", severity: "High" });
      continue;
    }
    const a = tool.annotations || {};
    for (const [key, expectedVal] of Object.entries(expected)) {
      if (a[key] !== expectedVal) {
        findings.push({
          tool: name,
          issue: `${key} should be ${expectedVal} but got ${a[key]}`,
          severity: "Medium",
        });
        console.error(`[FINDING] ${name}: ${key} expected ${expectedVal}, got ${a[key]}`);
      } else {
        console.log(`[OK] ${name}: ${key}=${a[key]}`);
      }
    }
  }

  console.log(`\n=== Annotation Test Complete: ${findings.length} findings ===`);

  await c.close();
  return findings;
}

runAnnotationTests().then((findings) => {
  import("fs").then((fs) => {
    fs.writeFileSync("/tmp/novada-qa-0.9.0/qa-annotations-findings.json", JSON.stringify(findings, null, 2));
    console.log("Written to /tmp/novada-qa-0.9.0/qa-annotations-findings.json");
  });
}).catch(console.error);
