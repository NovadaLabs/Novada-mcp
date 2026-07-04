#!/usr/bin/env node
/**
 * Red-team probe round 2: deeper inspection of novada_discover issues
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const API_KEY = "1f35b477c9e1802778ec64aee2a6adfa";

const transport = new StdioClientTransport({
  command: "node",
  args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
  env: {
    ...process.env,
    NOVADA_API_KEY: API_KEY,
  },
});

const client = new Client({ name: "qa-probe-2", version: "1.0.0" });

async function callTool(name, args, label) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[PROBE] ${label}`);
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text ?? "";
    return { ok: true, text };
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
    return { ok: false, error: err };
  }
}

async function main() {
  await client.connect(transport);
  console.log("Connected to MCP server");

  // 1. Get full catalog
  const full = await callTool("novada_discover", {}, "Full catalog");

  if (full.ok) {
    const text = full.text;

    // Extract all proxy-related tool names (with `novada_proxy` prefix in table)
    const proxyMatches = text.match(/\| `(novada_proxy[^`]*)`/g) || [];
    console.log(`\n[PROXY TOOLS IN FULL CATALOG] (${proxyMatches.length} total):`);
    proxyMatches.forEach(m => console.log(`  ${m}`));

    // Check if novada_proxy_account_create and novada_proxy_account_list are in proxy section
    const proxySection = text.match(/### Proxy\n\n.*?(?=###)/s)?.[0] || "";
    console.log("\n[PROXY SECTION]:");
    console.log(proxySection.slice(0, 1000));

    // Account & Billing section
    const billingSection = text.match(/### Account & Billing\n\n.*?(?=###)/s)?.[0] || "";
    console.log("\n[ACCOUNT & BILLING SECTION] (first 500):");
    console.log(billingSection.slice(0, 500));
  }

  // 2. Filter specifically for Proxy
  const proxyCat = await callTool("novada_discover", { category: "Proxy" }, "Proxy category only");
  if (proxyCat.ok) {
    const proxyText = proxyCat.text;
    const proxyMatches = proxyText.match(/\| `(novada_proxy[^`]*)`/g) || [];
    console.log(`\n[PROXY TOOLS IN PROXY-FILTERED] (${proxyMatches.length} total):`);
    proxyMatches.forEach(m => console.log(`  ${m}`));
  }

  // 3. Count tools that contain "proxy" in name in full catalog
  if (full.ok) {
    const allProxyInFull = (full.text.match(/`novada_proxy[^`]*/g) || []);
    console.log(`\n[ALL 'novada_proxy' OCCURRENCES IN FULL CATALOG] (${allProxyInFull.length} total):`);
    // deduplicate
    const unique = [...new Set(allProxyInFull)];
    console.log(`  Unique: ${unique.length}`);
    unique.forEach(m => console.log(`  ${m}`));
  }

  // 4. Check: "13 active platforms" in footer vs actual registered count
  if (full.ok) {
    console.log("\n[NEXT STEPS FOOTER CHECK]:");
    const footerStart = full.text.indexOf("## Next Steps");
    if (footerStart !== -1) {
      console.log(full.text.slice(footerStart, footerStart + 800));
    }

    // Check the novada_scrape registry description
    const scrapeMatch = full.text.match(/`novada_scrape`.*?\|/g);
    console.log("\n[novada_scrape DESCRIPTION IN TABLE]:");
    scrapeMatch?.forEach(m => console.log(`  ${m}`));
  }

  // 5. Verify tool count: server says 38 loaded but what does discover say?
  if (full.ok) {
    const headerMatch = full.text.match(/\*\*(\d+) active\*\* \| (\d+) planned \| (\d+) total/);
    if (headerMatch) {
      console.log(`\n[TOTAL COUNT]: active=${headerMatch[1]}, planned=${headerMatch[2]}, total=${headerMatch[3]}`);
      // Count actual table rows
      const tableRows = full.text.match(/^\| `novada_/gm) || [];
      console.log(`[ACTUAL TABLE ROWS]: ${tableRows.length}`);
    }
  }

  // 6. Test: category filter with Account & Billing (contains proxy sub-accounts)
  const billing = await callTool("novada_discover", { category: "Account & Billing" }, "Account & Billing category");
  if (billing.ok) {
    const billingText = billing.text;
    const proxyInBilling = (billingText.match(/`novada_proxy[^`]*/g) || []);
    console.log(`\n[PROXY TOOLS IN ACCOUNT & BILLING] (${proxyInBilling.length}):`);
    proxyInBilling.forEach(m => console.log(`  ${m}`));
  }

  // 7. Test: does "Auth" category that returns "No tools found" carry agent_instruction?
  const auth = await callTool("novada_discover", { category: "Auth" }, "Auth category - error quality");
  if (auth.ok) {
    console.log(`\n[AUTH RESULT]: "${auth.text}"`);
    console.log(`  Has agent_instruction: ${auth.text.toLowerCase().includes("agent_instruction") || auth.text.toLowerCase().includes("next step")}`);
    console.log(`  Is this an error condition without guidance? ${!auth.text.includes("Next step")}`);
  }

  await client.close();
  console.log("\nDone.");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
