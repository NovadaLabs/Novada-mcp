#!/usr/bin/env node
/**
 * Quick test for novada_search — google / bing / duckduckgo
 * novadaSearch returns a formatted markdown string, not a struct.
 */
import { novadaSearch, validateSearchParams } from "../build/tools/index.js";

const API_KEY = "1f35b477c9e1802778ec64aee2a6adfa";

const tests = [
  { engine: "google",     query: "iPhone 17 Pro Max price cheapest", num: 5 },
  { engine: "bing",       query: "iPhone 17 Pro Max price cheapest", num: 5 },
  { engine: "duckduckgo", query: "cheapest platform to buy phones",  num: 5 },
];

for (const t of tests) {
  const label = `[${t.engine.toUpperCase()}] "${t.query}"`;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`TEST: ${label}`);
  try {
    const params = validateSearchParams({
      query: t.query,
      engine: t.engine,
      num: t.num,
      country: "",
      language: "",
    });
    const result = await novadaSearch(params, API_KEY);

    if (typeof result !== "string") {
      console.log("FAIL — result is not a string:", typeof result);
      continue;
    }

    // Check for "results:0" or no URL lines
    const hasResults = /url: https?:\/\//.test(result);
    const countMatch = result.match(/results:(\d+)/);
    const count = countMatch ? parseInt(countMatch[1]) : 0;

    if (!hasResults || count === 0) {
      console.log(`FAIL — returned ${count} results (no URLs found)`);
      console.log("Output:\n" + result.slice(0, 600));
    } else {
      console.log(`PASS — ${count} results`);
      // Print first 3 titles+urls
      const lines = result.split("\n");
      let shown = 0;
      for (let i = 0; i < lines.length && shown < 3; i++) {
        if (lines[i].startsWith("### ")) {
          const title = lines[i].replace("### ", "").trim();
          const urlLine = lines[i+1]?.startsWith("url:") ? lines[i+1] : "";
          console.log(`  [${shown+1}] ${title}`);
          if (urlLine) console.log(`       ${urlLine.replace("url: ","")}`);
          shown++;
        }
      }
    }
  } catch (err) {
    console.log(`FAIL — error: ${err.message}`);
  }
}
console.log(`\n${"─".repeat(60)}`);
console.log("Done.");
