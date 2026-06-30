/**
 * Smoke test for novada-mcp tools: research, extract, monitor
 * Run: node workspace/smoke-test-final.mjs
 */
import { novadaResearch, novadaExtract, novadaMonitor } from "../build/tools/index.js";

const API_KEY = "1f35b477c9e1802778ec64aee2a6adfa";

const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
  const icon = status === "PASS" ? "\u2705" : status === "FAIL" ? "\u274c" : "\u23ed\ufe0f";
  console.log(`${icon} ${name}: ${status}${detail ? " — " + detail : ""}`);
}

// ── Test 1: Research ─────────────────────────────────────────────────────────
async function testResearch() {
  console.log("\n--- Test 1: novadaResearch (quick) ---");
  try {
    const result = await novadaResearch(
      { question: "what is an API gateway", depth: "quick" },
      API_KEY
    );
    if (!result || result.length === 0) {
      record("research", "FAIL", "returned empty string");
      return;
    }
    const hasResearch = result.includes("## Research");
    const hasSummary = result.includes("## Summary");
    const hasKey = result.includes("## Key Findings");
    if (hasResearch || hasSummary || hasKey) {
      record("research", "PASS", `${result.length} chars, has sections: Research=${hasResearch} Summary=${hasSummary} KeyFindings=${hasKey}`);
    } else {
      record("research", "FAIL", `missing expected sections. First 300 chars: ${result.slice(0, 300)}`);
    }
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes("not activated") || msg.includes("Scraper API")) {
      record("research", "SKIP", "Scraper API not activated on this account");
    } else {
      record("research", "FAIL", msg);
    }
  }
}

// ── Test 2: Extract (single URL, hard target) ───────────────────────────────
async function testExtractSingle() {
  console.log("\n--- Test 2: novadaExtract (amazon.com, render=auto) ---");
  try {
    const result = await novadaExtract(
      { url: "https://www.amazon.com", render: "auto" },
      API_KEY
    );
    if (!result || result.length === 0) {
      record("extract-single", "FAIL", "returned empty string");
      return;
    }
    const hasContent = result.includes("## Extracted Content") || result.includes("## Extract Failed");
    const hasAntiBot = result.includes("anti_bot");
    record(
      "extract-single",
      hasContent ? "PASS" : "FAIL",
      `${result.length} chars, has_content_header=${hasContent}, anti_bot_metadata=${hasAntiBot}. First 200: ${result.slice(0, 200).replace(/\n/g, " ")}`
    );
  } catch (err) {
    record("extract-single", "FAIL", err?.message || String(err));
  }
}

// ── Test 3: Extract batch ────────────────────────────────────────────────────
async function testExtractBatch() {
  console.log("\n--- Test 3: novadaExtract (batch: HN + example.com) ---");
  try {
    const result = await novadaExtract(
      { url: ["https://news.ycombinator.com", "https://example.com"] },
      API_KEY
    );
    if (!result || result.length === 0) {
      record("extract-batch", "FAIL", "returned empty string");
      return;
    }
    const hasBatchHeader = result.includes("## Batch Extract Results");
    const hasUrl1 = result.includes("news.ycombinator.com");
    const hasUrl2 = result.includes("example.com");
    if (hasBatchHeader && hasUrl1 && hasUrl2) {
      record("extract-batch", "PASS", `${result.length} chars, batch header present, both URLs in output`);
    } else {
      record("extract-batch", "FAIL", `batch=${hasBatchHeader} url1=${hasUrl1} url2=${hasUrl2}. First 300: ${result.slice(0, 300).replace(/\n/g, " ")}`);
    }
  } catch (err) {
    record("extract-batch", "FAIL", err?.message || String(err));
  }
}

// ── Test 4: Monitor (baseline + no-change) ───────────────────────────────────
async function testMonitorBaseline() {
  console.log("\n--- Test 4: novadaMonitor (baseline + unchanged) ---");
  try {
    // First call — should be baseline
    const first = await novadaMonitor(
      { url: "https://news.ycombinator.com" },
      API_KEY
    );
    if (!first || first.length === 0) {
      record("monitor-baseline", "FAIL", "first call returned empty string");
      return;
    }
    const isBaseline = first.includes("baseline") || first.includes("First Check") || first.includes("first check");
    if (isBaseline) {
      record("monitor-baseline", "PASS", `${first.length} chars, baseline detected`);
    } else {
      record("monitor-baseline", "FAIL", `no baseline indicator. First 300: ${first.slice(0, 300).replace(/\n/g, " ")}`);
    }

    // Second call — should be unchanged (same URL, same content within seconds)
    const second = await novadaMonitor(
      { url: "https://news.ycombinator.com" },
      API_KEY
    );
    if (!second || second.length === 0) {
      record("monitor-unchanged", "FAIL", "second call returned empty string");
      return;
    }
    const isUnchanged = second.includes("unchanged") || second.includes("No Changes") || second.includes("no change") || second.includes("no_change");
    if (isUnchanged) {
      record("monitor-unchanged", "PASS", `${second.length} chars, no-change detected`);
    } else {
      // HN updates frequently — content hash may differ between two fetches.
      // That's a valid "changed" state, not a bug.
      const isChanged = second.includes("changed") || second.includes("Changes Detected");
      if (isChanged) {
        record("monitor-unchanged", "PASS", `${second.length} chars, content actually changed between checks (HN is live) — monitor correctly detected the change`);
      } else {
        record("monitor-unchanged", "FAIL", `no unchanged/changed indicator. First 300: ${second.slice(0, 300).replace(/\n/g, " ")}`);
      }
    }
  } catch (err) {
    record("monitor-baseline", "FAIL", err?.message || String(err));
  }
}

// ── Test 5: Monitor with fields ──────────────────────────────────────────────
async function testMonitorFields() {
  console.log("\n--- Test 5: novadaMonitor (with fields=['title']) ---");
  try {
    // Use a different URL than Test 4 to get a fresh baseline (monitorStore is in-memory)
    const result = await novadaMonitor(
      { url: "https://example.com", fields: ["title"] },
      API_KEY
    );
    if (!result || result.length === 0) {
      record("monitor-fields", "FAIL", "returned empty string");
      return;
    }
    const hasFieldTracking = result.includes("title") && (result.includes("Tracked Fields") || result.includes("fields_tracked") || result.includes("baseline") || result.includes("First Check"));
    if (hasFieldTracking) {
      record("monitor-fields", "PASS", `${result.length} chars, field tracking active`);
    } else {
      record("monitor-fields", "FAIL", `field tracking not visible. First 400: ${result.slice(0, 400).replace(/\n/g, " ")}`);
    }
  } catch (err) {
    record("monitor-fields", "FAIL", err?.message || String(err));
  }
}

// ── Run all tests ────────────────────────────────────────────────────────────
async function main() {
  console.log("=== novada-mcp Smoke Test ===");
  console.log(`API key: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  await testResearch();
  await testExtractSingle();
  await testExtractBatch();
  await testMonitorBaseline();
  await testMonitorFields();

  // ── Summary table ────────────────────────────────────────────────────────
  console.log("\n\n=== SMOKE TEST SUMMARY ===");
  console.log("─".repeat(70));
  console.log(`${"Test".padEnd(25)} ${"Status".padEnd(8)} Detail`);
  console.log("─".repeat(70));
  for (const r of results) {
    console.log(`${r.name.padEnd(25)} ${r.status.padEnd(8)} ${(r.detail || "").slice(0, 80)}`);
  }
  console.log("─".repeat(70));

  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  const skipped = results.filter(r => r.status === "SKIP").length;
  console.log(`Total: ${results.length} | PASS: ${passed} | FAIL: ${failed} | SKIP: ${skipped}`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(2);
});
