import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const NOVADA_API_KEY = "1f35b477c9e1802778ec64aee2a6adfa";

const t = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: { ...process.env, NOVADA_API_KEY },
});

const c = new Client({ name: "p0-tester", version: "1" }, { capabilities: {} });

async function callTool(name, args) {
  try {
    const r = await c.callTool({ name, arguments: args });
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e };
  }
}

async function main() {
  await c.connect(t);
  console.log("Connected to MCP server\n");

  // Step 1: listTools — check for outputSchema
  const tools = await c.listTools();
  const withOutputSchema = tools.tools.filter((t) => t.outputSchema != null);
  console.log(`=== listTools ===`);
  console.log(`Total tools: ${tools.tools.length}`);
  console.log(`Tools with outputSchema: ${withOutputSchema.length}`);
  if (withOutputSchema.length > 0) {
    console.log(`  Names: ${withOutputSchema.map((t) => t.name).join(", ")}`);
  }
  console.log("");

  // Print all tool names
  console.log("Tool names:", tools.tools.map((t) => t.name).join(", "));
  console.log("");

  // Step 2: Test P0 tools
  const results = [];

  // --- novada_search ---
  console.log("=== novada_search ===");
  const searchTool = tools.tools.find((t) => t.name === "novada_search");
  console.log("Required params:", JSON.stringify(searchTool?.inputSchema?.required));
  const sr = await callTool("novada_search", {
    query: "firecrawl vs brightdata pricing",
    engine: "google",
    num: 5,
    country: "",
    language: "",
  });
  if (sr.ok) {
    const text = JSON.stringify(sr.result);
    const has32600 = text.includes("-32600");
    const snippet = text.slice(0, 300);
    console.log(`-32600 present: ${has32600}`);
    console.log(`Content snippet: ${snippet}`);
    const isError = sr.result.isError === true;
    results.push({ tool: "novada_search", pass: !has32600 && !isError && text.length > 100, note: isError ? "isError=true" : snippet.slice(0, 100) });
  } else {
    console.log("callTool threw:", sr.error?.message);
    results.push({ tool: "novada_search", pass: false, note: sr.error?.message });
  }
  console.log("");

  // --- novada_extract ---
  console.log("=== novada_extract ===");
  const extractTool = tools.tools.find((t) => t.name === "novada_extract");
  console.log("Required params:", JSON.stringify(extractTool?.inputSchema?.required));
  const er = await callTool("novada_extract", {
    url: "https://www.firecrawl.dev",
    format: "markdown",
    render: "auto",
  });
  if (er.ok) {
    const text = JSON.stringify(er.result);
    const has32600 = text.includes("-32600");
    const snippet = text.slice(0, 300);
    console.log(`-32600 present: ${has32600}`);
    console.log(`Content snippet: ${snippet}`);
    const isError = er.result.isError === true;
    results.push({ tool: "novada_extract", pass: !has32600 && !isError && text.length > 100, note: isError ? "isError=true" : snippet.slice(0, 100) });
  } else {
    console.log("callTool threw:", er.error?.message);
    results.push({ tool: "novada_extract", pass: false, note: er.error?.message });
  }
  console.log("");

  // --- novada_map ---
  console.log("=== novada_map ===");
  const mapTool = tools.tools.find((t) => t.name === "novada_map");
  console.log("Required params:", JSON.stringify(mapTool?.inputSchema?.required));
  const mr = await callTool("novada_map", {
    url: "https://www.firecrawl.dev",
    limit: 20,
    include_subdomains: false,
    max_depth: 2,
  });
  if (mr.ok) {
    const text = JSON.stringify(mr.result);
    const has32600 = text.includes("-32600");
    const snippet = text.slice(0, 300);
    console.log(`-32600 present: ${has32600}`);
    console.log(`Content snippet: ${snippet}`);
    const isError = mr.result.isError === true;
    results.push({ tool: "novada_map", pass: !has32600 && !isError && text.length > 100, note: isError ? "isError=true" : snippet.slice(0, 100) });
  } else {
    console.log("callTool threw:", mr.error?.message);
    results.push({ tool: "novada_map", pass: false, note: mr.error?.message });
  }
  console.log("");

  // --- novada_verify ---
  console.log("=== novada_verify ===");
  const verifyTool = tools.tools.find((t) => t.name === "novada_verify");
  console.log("Required params:", JSON.stringify(verifyTool?.inputSchema?.required));
  const vr = await callTool("novada_verify", {
    claim: "Firecrawl is a web scraping API",
  });
  if (vr.ok) {
    const text = JSON.stringify(vr.result);
    const has32600 = text.includes("-32600");
    const snippet = text.slice(0, 300);
    console.log(`-32600 present: ${has32600}`);
    console.log(`Content snippet: ${snippet}`);
    const isError = vr.result.isError === true;
    results.push({ tool: "novada_verify", pass: !has32600 && !isError && text.length > 100, note: isError ? "isError=true" : snippet.slice(0, 100) });
  } else {
    console.log("callTool threw:", vr.error?.message);
    results.push({ tool: "novada_verify", pass: false, note: vr.error?.message });
  }
  console.log("");

  // Final summary
  console.log("=== PASS/FAIL SUMMARY ===");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.tool} | ${r.note}`);
  }

  await t.close();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
