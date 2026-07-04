import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";

const API_KEY = "1f35b477c9e1802778ec64aee2a6adfa";
const PROXY_USER = "tongwu_TRDI7X";
const PROXY_PASS = "_Asd1644asd_";
const BROWSER_WS = "wss://novada529MUW_2Q8WuZ-zone-browser:Dz0vkMW4Wkil@upg-scbr2.novada.com";

const env = {
  ...process.env,
  NOVADA_API_KEY: API_KEY,
  NOVADA_PROXY_USER: PROXY_USER,
  NOVADA_PROXY_PASS: PROXY_PASS,
  NOVADA_BROWSER_WS: BROWSER_WS,
};

async function createClient() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env,
  });

  const client = new Client({ name: "qa-probe", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function callTool(client, name, args) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    return { ok: true, result, elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, error: err, elapsed };
  }
}

function summarize(label, r) {
  if (!r.ok) {
    console.log(`\n[${label}] ERROR (${r.elapsed}ms):`);
    console.log("  code:", r.error?.code);
    console.log("  message:", r.error?.message?.slice(0, 300));
  } else {
    const content = r.result?.content;
    let text = "";
    if (Array.isArray(content)) {
      text = content.map(c => c.text || JSON.stringify(c)).join("\n");
    } else {
      text = JSON.stringify(r.result).slice(0, 500);
    }
    console.log(`\n[${label}] OK (${r.elapsed}ms):`);
    console.log("  isError:", r.result?.isError);
    console.log("  output (first 600):", text.slice(0, 600));
  }
}

async function main() {
  let client;
  try {
    client = await createClient();
    console.log("Connected to MCP server");

    // 1. List tools to get schema
    const toolsResult = await client.listTools();
    const searchTool = toolsResult.tools.find(t => t.name === "novada_search");
    if (!searchTool) {
      console.log("novada_search not found! Available tools:", toolsResult.tools.map(t => t.name));
      return;
    }
    console.log("\n=== novada_search schema ===");
    console.log(JSON.stringify(searchTool.inputSchema, null, 2));

    // 2. Happy path: valid minimal call
    console.log("\n=== PROBE 1: Happy path (minimal valid) ===");
    const p1 = await callTool(client, "novada_search", {
      query: "OpenAI GPT-4o latest news",
      engine: "google",
      num: 5,
      country: "",
      language: "",
      format: "markdown",
    });
    summarize("HAPPY_PATH_GOOGLE", p1);

    // 3. Happy path json format
    console.log("\n=== PROBE 2: JSON format output ===");
    const p2 = await callTool(client, "novada_search", {
      query: "anthropic claude 3.5",
      engine: "google",
      num: 3,
      country: "",
      language: "",
      format: "json",
    });
    summarize("JSON_FORMAT", p2);
    // Check JSON shape
    if (p2.ok && !p2.result?.isError) {
      const content = p2.result?.content?.[0]?.text;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          console.log("  JSON keys:", Object.keys(parsed));
          console.log("  has results:", Array.isArray(parsed.results));
          console.log("  has agent_instruction:", !!parsed.agent_instruction);
          console.log("  has id field:", !!parsed.id, "(check for searchId)");
        } catch(e) {
          // may be wrapped in markdown block
          const match = content.match(/```json\n([\s\S]+?)\n```/);
          if (match) {
            try {
              const parsed = JSON.parse(match[1]);
              console.log("  JSON (from code block) keys:", Object.keys(parsed));
            } catch(e2) {
              console.log("  Could not parse JSON from output");
            }
          } else {
            console.log("  Output is not parseable JSON. First 200 chars:", content.slice(0, 200));
          }
        }
      }
    }

    // 4. DuckDuckGo engine
    console.log("\n=== PROBE 3: DuckDuckGo engine ===");
    const p3 = await callTool(client, "novada_search", {
      query: "Rust programming language tutorials",
      engine: "duckduckgo",
      num: 5,
      country: "",
      language: "",
    });
    summarize("DDG_ENGINE", p3);

    // 5. Yahoo engine (should return YAHOO_UNAVAILABLE message, not error)
    console.log("\n=== PROBE 4: Yahoo engine (expect graceful YAHOO_UNAVAILABLE) ===");
    const p4 = await callTool(client, "novada_search", {
      query: "test query",
      engine: "yahoo",
      num: 5,
      country: "",
      language: "",
    });
    summarize("YAHOO_ENGINE", p4);

    // 6. MISSING required param: query
    console.log("\n=== PROBE 5: Missing required param (query omitted) ===");
    const p5 = await callTool(client, "novada_search", {
      engine: "google",
      num: 5,
      country: "",
      language: "",
    });
    summarize("MISSING_QUERY", p5);

    // 7. Empty string query
    console.log("\n=== PROBE 6: Empty string query ===");
    const p6 = await callTool(client, "novada_search", {
      query: "",
      engine: "google",
      num: 5,
      country: "",
      language: "",
    });
    summarize("EMPTY_QUERY", p6);

    // 8. Whitespace-only query
    console.log("\n=== PROBE 7: Whitespace-only query ===");
    const p7 = await callTool(client, "novada_search", {
      query: "   \t  ",
      engine: "google",
      num: 5,
      country: "",
      language: "",
    });
    summarize("WHITESPACE_QUERY", p7);

    // 9. Wrong type for num (string instead of integer)
    console.log("\n=== PROBE 8: Wrong type for num (string) ===");
    const p8 = await callTool(client, "novada_search", {
      query: "test query",
      engine: "google",
      num: "five",
      country: "",
      language: "",
    });
    summarize("WRONG_TYPE_NUM", p8);

    // 10. Num = 0 (boundary)
    console.log("\n=== PROBE 9: Num = 0 (boundary) ===");
    const p9 = await callTool(client, "novada_search", {
      query: "test",
      engine: "google",
      num: 0,
      country: "",
      language: "",
    });
    summarize("NUM_ZERO", p9);

    // 11. Num = 21 (exceeds max of 20)
    console.log("\n=== PROBE 10: Num = 21 (over max) ===");
    const p10 = await callTool(client, "novada_search", {
      query: "test",
      engine: "google",
      num: 21,
      country: "",
      language: "",
    });
    summarize("NUM_OVER_MAX", p10);

    // 12. Unknown/unsupported engine (not in schema)
    console.log("\n=== PROBE 11: Invalid engine value ===");
    const p11 = await callTool(client, "novada_search", {
      query: "test query",
      engine: "altavista",
      num: 5,
      country: "",
      language: "",
    });
    summarize("INVALID_ENGINE", p11);

    // 13. Huge query (10k chars) — potential timeout/injection
    console.log("\n=== PROBE 12: Huge query (10k chars) ===");
    const p12 = await callTool(client, "novada_search", {
      query: "a".repeat(10000),
      engine: "google",
      num: 5,
      country: "",
      language: "",
    });
    summarize("HUGE_QUERY", p12);

    // 14. Unicode/emoji query
    console.log("\n=== PROBE 13: Unicode/emoji query ===");
    const p13 = await callTool(client, "novada_search", {
      query: "Claude AI 🤖 最新版本 новости искусственного интеллекта",
      engine: "google",
      num: 3,
      country: "",
      language: "",
    });
    summarize("UNICODE_QUERY", p13);

    // 15. SQL injection attempt in query
    console.log("\n=== PROBE 14: SQL injection in query ===");
    const p14 = await callTool(client, "novada_search", {
      query: "test'; DROP TABLE users; --",
      engine: "google",
      num: 3,
      country: "",
      language: "",
    });
    summarize("SQL_INJECTION_QUERY", p14);

    // 16. Unknown extra params
    console.log("\n=== PROBE 15: Unknown extra params ===");
    const p15 = await callTool(client, "novada_search", {
      query: "test",
      engine: "google",
      num: 5,
      country: "",
      language: "",
      unknown_param: "injected_value",
      another_extra: 12345,
    });
    summarize("EXTRA_PARAMS", p15);

    // 17. include_domains with 11 items (over the 10 limit)
    console.log("\n=== PROBE 16: include_domains with 11 items (over 10 limit) ===");
    const p16 = await callTool(client, "novada_search", {
      query: "test",
      engine: "google",
      num: 5,
      country: "",
      language: "",
      include_domains: ["a.com","b.com","c.com","d.com","e.com","f.com","g.com","h.com","i.com","j.com","k.com"],
    });
    summarize("INCLUDE_DOMAINS_OVER_10", p16);

    // 18. Check if searchId is returned in markdown format (needed for search_feedback)
    console.log("\n=== PROBE 17: Check for searchId in markdown output ===");
    const p17 = await callTool(client, "novada_search", {
      query: "React hooks tutorial",
      engine: "google",
      num: 3,
      country: "",
      language: "",
      format: "markdown",
    });
    if (p17.ok) {
      const content = p17.result?.content?.[0]?.text || "";
      const hasSearchId = content.includes("searchId") || content.includes("search_id") || content.includes("id:");
      console.log(`  Output mentions searchId/search_id: ${hasSearchId}`);
      console.log("  (search_feedback needs this for feedback loop)");
    }
    summarize("SEARCH_ID_CHECK", p17);

    // 19. enrich_top shorthand
    console.log("\n=== PROBE 18: enrich_top shorthand ===");
    const p18 = await callTool(client, "novada_search", {
      query: "TypeScript tutorial 2024",
      engine: "google",
      num: 2,
      country: "",
      language: "",
      enrich_top: true,
    });
    summarize("ENRICH_TOP", p18);

    // 20. time_range filter
    console.log("\n=== PROBE 19: time_range=week ===");
    const p19 = await callTool(client, "novada_search", {
      query: "AI news",
      engine: "google",
      num: 3,
      country: "",
      language: "",
      time_range: "week",
    });
    summarize("TIME_RANGE_WEEK", p19);

    // 21. num=1 boundary (minimum useful)
    console.log("\n=== PROBE 20: num=1 boundary ===");
    const p20 = await callTool(client, "novada_search", {
      query: "test",
      engine: "google",
      num: 1,
      country: "",
      language: "",
    });
    summarize("NUM_ONE", p20);

  } catch (err) {
    console.error("Fatal error:", err);
  } finally {
    if (client) {
      try { await client.close(); } catch {}
    }
    process.exit(0);
  }
}

main();
