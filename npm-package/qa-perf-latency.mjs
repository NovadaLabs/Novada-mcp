/**
 * QA: Performance / Latency tests for novada_extract
 * Tests: static vs render, timeout behavior, cache hit, batch timing, wait_ms, ceiling
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "dummy";

async function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: KEY }),
  });
  const c = new Client({ name: "qa-perf", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { c, t };
}

async function callTool(c, name, args, label) {
  const start = Date.now();
  try {
    const r = await c.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    const content = r?.content?.[0]?.text ?? JSON.stringify(r);
    return { ok: true, elapsed, content, label };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { ok: false, elapsed, error: err.message, label };
  }
}

async function runTests() {
  const results = [];
  const { c } = await makeClient();

  // =============================================
  // SCENARIO 1: Static render mode — validate schema returns quickly (offline)
  // =============================================
  {
    const r = await callTool(c, "novada_extract", {
      url: "https://example.com",
      render: "static",
      format: "markdown",
    }, "S1: static mode, public URL");
    results.push(r);
    console.log(`[S1] elapsed:${r.elapsed}ms ok:${r.ok}`);
    if (!r.ok) console.log("  ERROR:", r.error);
  }

  // =============================================
  // SCENARIO 2: Render mode vs static — validate render is attempted (offline, dummy key)
  // =============================================
  {
    const r = await callTool(c, "novada_extract", {
      url: "https://example.com",
      render: "render",
      format: "markdown",
    }, "S2: render mode, public URL");
    results.push(r);
    console.log(`[S2] elapsed:${r.elapsed}ms ok:${r.ok}`);
  }

  // =============================================
  // SCENARIO 3: Cache hit — same URL twice, second call should be near-instant
  // =============================================
  {
    const r1 = await callTool(c, "novada_extract", {
      url: "https://example.com",
      render: "static",
      format: "markdown",
    }, "S3a: cache miss");
    const r2 = await callTool(c, "novada_extract", {
      url: "https://example.com",
      render: "static",
      format: "markdown",
    }, "S3b: cache hit");
    results.push(r1, r2);
    console.log(`[S3a] elapsed:${r1.elapsed}ms (cache miss)`);
    console.log(`[S3b] elapsed:${r2.elapsed}ms (should be fast if cached)`);
    // If r2 is significantly faster, cache is working
    if (r1.ok && r2.ok) {
      const cacheBoost = r1.elapsed - r2.elapsed;
      console.log(`  Cache boost: ${cacheBoost}ms`);
      const s3check = {
        label: "S3: cache hit check",
        ok: r2.ok,
        elapsed: r2.elapsed,
        cacheBoost,
        content: r2.content?.slice(0, 200),
        hasCacheMarker: r2.content?.includes("source: cache"),
      };
      results.push(s3check);
      console.log(`  cache marker present: ${s3check.hasCacheMarker}`);
    }
  }

  // =============================================
  // SCENARIO 4: wait_ms=30000 passed to static mode (no browser) — what happens?
  // The wait_ms param is only used in fetchViaBrowser path, not in static/proxy paths.
  // A user passing wait_ms=30000 with render="static" should NOT add 30s of delay,
  // but is the parameter silently ignored without any warning?
  // =============================================
  {
    const r = await callTool(c, "novada_extract", {
      url: "https://example.com",
      render: "static",
      wait_ms: 30000,
      format: "markdown",
    }, "S4: wait_ms=30000 on static mode - expect fast (no browser)");
    results.push(r);
    console.log(`[S4] elapsed:${r.elapsed}ms wait_ms=30000 on static (should be fast if cache hit)`);
    // After S3, example.com is cached — this should be instant regardless of wait_ms
    if (r.ok) {
      console.log(`  content snippet: ${r.content?.slice(0, 100)}`);
    }
  }

  // =============================================
  // SCENARIO 5: max_chars=0 — what happens with edge-case max_chars
  // =============================================
  {
    const r = await callTool(c, "novada_extract", {
      url: "https://example.com",
      render: "static",
      max_chars: 1,
      format: "markdown",
    }, "S5: max_chars=1");
    results.push(r);
    console.log(`[S5] elapsed:${r.elapsed}ms max_chars=1 ok:${r.ok}`);
    if (r.ok) {
      console.log(`  content snippet: ${r.content?.slice(0, 200)}`);
    }
  }

  // =============================================
  // SCENARIO 6: max_chars=100000 (ceiling) vs default
  // =============================================
  {
    const r = await callTool(c, "novada_extract", {
      url: "https://example.com",
      render: "static",
      max_chars: 100000,
      format: "markdown",
    }, "S6: max_chars=100000");
    results.push(r);
    console.log(`[S6] elapsed:${r.elapsed}ms max_chars=100000 ok:${r.ok}`);
  }

  // =============================================
  // SCENARIO 7: unblock timeout=0 — what is the effective timeout?
  // =============================================
  {
    const r = await callTool(c, "novada_unblock", {
      url: "https://example.com",
      method: "render",
      timeout: 0,
    }, "S7: unblock timeout=0");
    results.push(r);
    console.log(`[S7] elapsed:${r.elapsed}ms timeout=0 on unblock`);
    if (!r.ok) console.log("  error:", r.error?.slice(0, 300));
  }

  // =============================================
  // SCENARIO 8: unblock timeout=999999 (exceeds ceiling) — should be capped at 120s
  // =============================================
  {
    // Note: this should use the ceiling cap and NOT wait 999s
    const r = await callTool(c, "novada_unblock", {
      url: "https://example.com",
      method: "render",
      timeout: 999999,
    }, "S8: unblock timeout=999999 (should cap at 120s ceiling)");
    results.push(r);
    console.log(`[S8] elapsed:${r.elapsed}ms timeout=999999 → capped at 120000`);
  }

  // =============================================
  // SCENARIO 9: Batch with 10 URLs — check that Promise.all fires them in parallel
  // (timing should be ~max(individual) not ~sum(individual))
  // We use dummy key so all will fail, but timing reveals if parallel
  // =============================================
  {
    const urls = Array.from({ length: 5 }, (_, i) => `https://example${i}.com`);
    const r = await callTool(c, "novada_extract", {
      urls,
      render: "static",
      format: "markdown",
    }, "S9: batch 5 URLs, dummy key (parallelism check)");
    results.push(r);
    console.log(`[S9] elapsed:${r.elapsed}ms batch 5 URLs ok:${r.ok}`);
    if (r.ok) {
      console.log(`  snippet: ${r.content?.slice(0, 200)}`);
    }
  }

  // =============================================
  // SCENARIO 10: Check if cache deduplicates within a batch
  // Pass same URL twice in a batch (should hit cache on second)
  // =============================================
  {
    const r = await callTool(c, "novada_extract", {
      urls: ["https://example.com", "https://example.com"],
      render: "static",
      format: "markdown",
    }, "S10: batch with duplicate URL (cache dedup?)");
    results.push(r);
    console.log(`[S10] elapsed:${r.elapsed}ms duplicate URL in batch ok:${r.ok}`);
    if (r.ok) {
      console.log(`  content snippet: ${r.content?.slice(0, 300)}`);
    }
  }

  // =============================================
  // SCENARIO 11: render="auto" vs render="static" — latency difference
  // =============================================
  {
    const r1 = await callTool(c, "novada_extract", {
      url: "https://news.ycombinator.com",
      render: "auto",
      format: "markdown",
    }, "S11a: render=auto on HN");
    const r2 = await callTool(c, "novada_extract", {
      url: "https://news.ycombinator.com",
      render: "static",
      format: "markdown",
    }, "S11b: render=static on HN");
    results.push(r1, r2);
    console.log(`[S11a] elapsed:${r1.elapsed}ms render=auto`);
    console.log(`[S11b] elapsed:${r2.elapsed}ms render=static`);
  }

  // =============================================
  // SCENARIO 12: Domain registry lookup — known JS-heavy domain should be flagged
  // without making a real fetch (offline behavior)
  // Check that DOMAIN_REGISTRY entries bypass slow auto-detection
  // =============================================
  {
    // linkedin.com is a known JS-heavy domain that should be flagged in DOMAIN_REGISTRY
    const r = await callTool(c, "novada_extract", {
      url: "https://www.linkedin.com/in/test",
      render: "auto",
      format: "json",
    }, "S12: linkedin.com (DOMAIN_REGISTRY hit should skip heuristic detection)");
    results.push(r);
    console.log(`[S12] elapsed:${r.elapsed}ms linkedin.com domain registry check`);
    if (r.ok) {
      const parsed = (() => { try { return JSON.parse(r.content); } catch { return null; } })();
      if (parsed) console.log(`  mode: ${parsed.mode}`);
      else console.log(`  snippet: ${r.content?.slice(0, 200)}`);
    }
  }

  // =============================================
  // SCENARIO 13: route memory — first call records mode, second reuses it
  // =============================================
  {
    // First call (real network needed, so using dummy key it will fail, but timing differs)
    const r1 = await callTool(c, "novada_extract", {
      url: "https://httpbin.org/html",
      render: "auto",
      format: "markdown",
    }, "S13a: first call to domain (route memory miss)");
    const r2 = await callTool(c, "novada_extract", {
      url: "https://httpbin.org/get",
      render: "auto",
      format: "markdown",
    }, "S13b: second call to same domain (route memory hit)");
    results.push(r1, r2);
    console.log(`[S13a] elapsed:${r1.elapsed}ms route memory first call`);
    console.log(`[S13b] elapsed:${r2.elapsed}ms route memory second call`);
  }

  await c.close();
  return results;
}

runTests()
  .then(results => {
    console.log("\n=== SUMMARY ===");
    results.forEach(r => {
      console.log(`${r.label}: elapsed=${r.elapsed}ms ok=${r.ok}`);
    });
    process.exit(0);
  })
  .catch(err => {
    console.error("FATAL:", err);
    process.exit(1);
  });
