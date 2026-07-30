#!/usr/bin/env node
/**
 * monitoring/smoke/full-tools-probe.selftest.mjs
 *
 * Dependency-free, OFFLINE self-test for full-tools-probe.mjs's pipeline.
 * Makes ZERO network calls and needs NO NOVADA_TEST_KEY — it injects a stub
 * callTool/listTools into full-tools-probe.mjs's exported `runAllProbes` and
 * asserts on the real classification pipeline (classifyFailure, the
 * processing→poll disambiguation, the write-guard, the network-retry
 * wrapper), not a re-implementation of it.
 *
 * This exists because the CRITICAL bug found in code review (2026-07-24) —
 * an args-unaware write-guard throwing OUTSIDE any try/catch at probe #14,
 * FATAL-exiting the run with zero results for the remaining 16 scrapers —
 * would have been caught immediately by assertion (1) below. Run this after
 * ANY change to full-tools-probe.mjs:
 *
 *   node monitoring/smoke/full-tools-probe.selftest.mjs
 *
 * Assertions:
 *   1. Every probe in PROBES was attempted (results.length === PROBES.length)
 *      and every row has a well-formed {name, status, domain} shape — i.e.
 *      the run never silently drops tools or crashes partway through.
 *   2. preflightAssertAllProbesExecutable() does not throw for the real,
 *      committed PROBES list (confirms the args-aware carve-out for
 *      novada_proxy_account_create's no-confirm dry-run actually works).
 *   3. Thirteen scripted canned scenarios (a plain pass; an isolated backend
 *      520; processing→poll-completes; processing→still-stuck on a
 *      non-flaky platform; processing→still-stuck on a KNOWN-FLAKY platform;
 *      processing-matched-but-no-task_id; a validation error we own; an
 *      INVALID_API_KEY auth error; httpStatus-0-then-retry-recovers;
 *      httpStatus-0-retry-exhausted; a scraper `50004: context deadline
 *      exceeded` backend timeout on a NON-flaky platform; a 2026-07-30
 *      free-gateway-cap error on a CORE tool; the SAME free-gateway-cap
 *      error on a KNOWN-FLAKY platform) each classify to the EXACT
 *      domain+severity this script's 2026-07-24/2026-07-28/2026-07-30
 *      review fixes specify. The `novada_scrape_google` scenario is the
 *      ratchet for the real-world mislabel found 2026-07-28:
 *      `scraper.novada.com/request` returning `{code:50004,
 *      msg:"context deadline exceeded"}` (a genuine BACKEND outage,
 *      reproduced with a raw curl, zero MCP involved) was, before the
 *      isBackendSignal fix, falling through every existing pattern (it is
 *      not a known-flaky platform, not a validation error, not an
 *      INVALID_API_KEY, not an HTTP 5xx/network failure, and did not match
 *      the old BACKEND_SIGNAL_RE's exact wording) all the way to step 8's
 *      ①-mcp-code fail-safe default — a false "our-code" P1 on every
 *      non-flaky platform during a pure backend outage. Confirmed by
 *      temporarily reverting the `isBackendSignal` check in classifyFailure
 *      and re-running this self-test: the scenario below classified
 *      `①-mcp-code`/P1 instead of `③-backend`/P2. The `novada_search` and
 *      `novada_scrape_yandex` scenarios are the ratchet for the 2026-07-30
 *      incident: before the FREE_CAP_RE fix, the CORE-tool case fell through
 *      to step 8's ①-mcp-code fail-safe (false "code bug" P0) and the
 *      known-flaky-platform case was swallowed by step 3's isFlaky branch
 *      (false ③-backend/P3) — both wrong, since a free-gateway-cap rejection
 *      is billing/test-infra, not a code bug or a backend outage.
 *   4. novada_proxy_account_create (no confirm) never crashes the run and
 *      classifies as a PASS/SLOW — the literal CRITICAL regression check.
 *   5. adviceFor() on the novada_search free-gateway-cap scenario returns
 *      advice text mentioning "free-gateway cap" (review round 1, 2026-07-30
 *      HIGH fix) — classifyFailure() alone is not enough; adviceFor()'s
 *      ②-gateway block must ALSO branch on the new note, or a cap-hit row's
 *      report advice silently falls through to the generic "check
 *      hosted-server Vercel function health..." fallthrough, which is the
 *      exact misdirection this whole fix targets.
 *
 * Exit code: non-zero on ANY assertion mismatch, or if the pipeline itself
 * throws uncaught (caught by the outer .catch() below and reported as FATAL
 * — that is ALSO a self-test failure, since the whole point is "the run
 * must never crash").
 */

import { PROBES, runAllProbes, preflightAssertAllProbesExecutable, adviceFor } from "./full-tools-probe.mjs";

// ─── Stub callTool: canned responses for 10 scripted scenarios, a default
// PASS for every other probe, and generic-dispatcher poll routing keyed by
// task_id for the three processing→poll scenarios. ────────────────────────
const callLog = [];

function stubListTools() {
  // Every PROBES name is "live" — this self-test is about classification
  // logic, not the MISSING-tool path (which all-tools-smoke.mjs-style logic
  // already covers structurally: see runAllProbes' own liveNames.has check).
  return Promise.resolve(PROBES.map((p) => ({ name: p.name, annotations: null, inputSchema: null })));
}

function stubCallTool(name, args) {
  callLog.push({ name, args });

  // Generic-dispatcher poll calls: novada_scrape({ platform, operation, task_id }).
  if (name === "novada_scrape" && args && typeof args.task_id === "string") {
    if (args.task_id === "walmart-task-1") {
      // Poll completes with real records -> SLOW, not a failure.
      return Promise.resolve({
        ok: true,
        httpStatus: 200,
        timeMs: 800,
        text: "## Scrape Results\nplatform: walmart.com | operation: product_by_keyword | records: 3 | source: live\n\nstatus: ok",
        error: null,
      });
    }
    if (args.task_id === "linkedin-task-1" || args.task_id === "github-task-1") {
      // Poll is STILL processing/stuck (records: 0) — same clean "pending"
      // shape scrape.ts itself would render on a second poll.
      return Promise.resolve({
        ok: true,
        httpStatus: 200,
        timeMs: 800,
        text: `## Scrape Results\nplatform: x | operation: y | records: 0 | source: live\n\nstatus: processing\n⏳ Task still running (task_id="${args.task_id}") after 45s.`,
        error: null,
      });
    }
  }

  switch (name) {
    case "novada_setup":
      // Scenario 1: a plain pass.
      return Promise.resolve({ ok: true, httpStatus: 200, timeMs: 50, text: "novada_setup ok", error: null });

    case "novada_scrape_amazon":
      // Scenario 2: an isolated backend 520 (amazon.com is NOT a
      // known-flaky platform — exercises BACKEND_SIGNAL_RE in isolation).
      return Promise.resolve({
        ok: false,
        httpStatus: 200,
        timeMs: 500,
        text: null,
        error: {
          toolError: true,
          message:
            "Error [API_DOWN]: Scraper task failed (520): upstream returned 520.\nfailure_class: backend\nretry_recommended: true",
        },
      });

    case "novada_scrape_walmart":
      // Scenario 3 (initial call): processing, resolves via poll above.
      return Promise.resolve({
        ok: true,
        httpStatus: 200,
        timeMs: 900,
        text: '## Scrape Results\nplatform: walmart.com | operation: product_by_keyword | records: 0 | source: live\n\nstatus: processing\n⏳ Task still running (task_id="walmart-task-1") after 45s.',
        error: null,
      });

    case "novada_scrape_linkedin":
      // Scenario 4 (initial call): processing, still stuck on a NON-flaky
      // platform after poll -> expect P2.
      return Promise.resolve({
        ok: true,
        httpStatus: 200,
        timeMs: 900,
        text: '## Scrape Results\nplatform: linkedin.com | operation: company_by_url | records: 0 | source: live\n\nstatus: processing\n⏳ Task still running (task_id="linkedin-task-1") after 45s.',
        error: null,
      });

    case "novada_scrape_github":
      // Scenario 5 (initial call): processing, still stuck on a
      // KNOWN-FLAKY platform (github is in BACKEND_KNOWN_FLAKY_PLATFORMS)
      // after poll -> expect P3, NOT P2 (the LOW fix).
      return Promise.resolve({
        ok: true,
        httpStatus: 200,
        timeMs: 900,
        text: '## Scrape Results\nplatform: github.com | operation: repository_by_url | records: 0 | source: live\n\nstatus: processing\n⏳ Task still running (task_id="github-task-1") after 45s.',
        error: null,
      });

    case "novada_scrape_shein":
      // Scenario 6: "processing" wording matched but NO task_id="..." is
      // present anywhere — simulates our extraction/format assumption
      // breaking. Must classify ①, must NOT attempt to poll.
      return Promise.resolve({
        ok: true,
        httpStatus: 200,
        timeMs: 900,
        text: "## Scrape Results\nplatform: shein.com | operation: product_by_id | records: 0 | source: live\n\nstatus: processing\n⏳ Task still running after 45s (no task id echoed).",
        error: null,
      });

    case "novada_map":
      // Scenario 7: a validation error we own (INVALID_PARAMS).
      return Promise.resolve({
        ok: false,
        httpStatus: 200,
        timeMs: 100,
        text: null,
        error: {
          toolError: true,
          message: "Error [INVALID_PARAMS]: Missing required parameters for novada_map.\nfailure_class: validation\nretry_recommended: false",
        },
      });

    case "novada_scrape_facebook":
      // Scenario 8: a genuine INVALID_API_KEY auth failure — must classify
      // ②-gateway/config, NOT ①-mcp-code (the MEDIUM fix).
      return Promise.resolve({
        ok: false,
        httpStatus: 200,
        timeMs: 300,
        text: null,
        error: {
          toolError: true,
          message:
            "Error [INVALID_API_KEY]: Invalid or missing NOVADA_API_KEY for platform scrapers.\n" +
            "failure_class: auth\nretry_recommended: false\n" +
            'agent_instruction: "Your API key is missing or invalid. Do not retry until the key is fixed."\n' +
            'detail: "HTTP 401"',
        },
      });

    case "novada_extract": {
      // Scenario 9: httpStatus 0 (non-timeout network blip) on the FIRST
      // attempt, RETRY recovers -> final result is a PASS.
      const attemptNumber = callLog.filter((c) => c.name === "novada_extract").length;
      if (attemptNumber <= 1) {
        return Promise.resolve({ ok: false, httpStatus: 0, timeMs: 3000, text: null, error: "connect ECONNRESET" });
      }
      return Promise.resolve({ ok: true, httpStatus: 200, timeMs: 200, text: "novada_extract ok (recovered on retry)", error: null });
    }

    case "novada_scrape_instagram":
      // Scenario 10: httpStatus 0 on BOTH attempts (retry does not recover)
      // -> must classify ②-gateway, NOT ①-mcp-code (the other MEDIUM fix).
      return Promise.resolve({ ok: false, httpStatus: 0, timeMs: 5000, text: null, error: "socket hang up" });

    case "novada_scrape_google":
      // Scenario 11: the scraper `50004: context deadline exceeded` backend
      // timeout (2026-07-28 real-world incident, reproduced with a raw curl
      // against scraper.novada.com/request — zero MCP involved) on a
      // NON-known-flaky platform (google is not in
      // BACKEND_KNOWN_FLAKY_PLATFORMS). Must classify ③-backend/P2 via the
      // shared isBackendSignal() helper, NOT ①-mcp-code — this is the exact
      // mislabel the isBackendSignal fix closes, and it must never
      // contribute to oursP0P1 (see the dedicated assertion below).
      return Promise.resolve({
        ok: false,
        httpStatus: 200,
        timeMs: 400,
        text: null,
        error: { toolError: true, message: "Scraper error (code 50004): context deadline exceeded" },
      });

    case "novada_search":
      // Scenario 12: the 2026-07-30 free-gateway-cap incident on a CORE tool
      // (novada_search is a CORE_TOOL_NAMES member) — must classify
      // ②-gateway/P0, NOT ①-mcp-code (which is what happened for real on
      // 2026-07-30 before this fix, misfiring TOW2-349). httpStatus 200
      // (a normal tool-result envelope carrying the cap error), see the
      // sibling httpStatus-0 case on novada_scrape_yandex below — both MUST
      // classify identically since FREE_CAP_RE only inspects the message.
      return Promise.resolve({
        ok: false,
        httpStatus: 200,
        timeMs: 300,
        text: null,
        error: {
          toolError: true,
          message:
            '## Free Gateway Cap Reached\n\nThis test key has used its free daily gateway quota.\n' +
            'agent_instruction: "free_gateway_cap_reached — top up the key or wait for the daily reset. Do not retry immediately."',
        },
      });

    case "novada_scrape_yandex":
      // Scenario 13: the SAME 2026-07-30 free-gateway-cap error, but on a
      // KNOWN-FLAKY platform (yandex is in BACKEND_KNOWN_FLAKY_PLATFORMS)
      // and delivered as httpStatus 0 (the network-level envelope some
      // hosted-gateway rejections arrive as). Must STILL classify
      // ②-gateway/P1 — the isFlaky branch must NOT swallow this into
      // ③-backend/P3 the way it did for real on 2026-07-30 for
      // youtube/github/perplexity. This is the ratchet for that exact bug:
      // FREE_CAP_RE is checked BEFORE isFlaky in classifyFailure.
      return Promise.resolve({ ok: false, httpStatus: 0, timeMs: 200, text: null, error: "free_gateway_cap_reached" });

    default:
      return Promise.resolve({ ok: true, httpStatus: 200, timeMs: 80, text: `${name} ok (default self-test stub)`, error: null });
  }
}

let failureCount = 0;
function expect(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failureCount += 1;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function main() {
  console.log("[selftest] preflightAssertAllProbesExecutable() against the real, committed PROBES list...");
  let preflightThrew = null;
  try {
    preflightAssertAllProbesExecutable();
  } catch (err) {
    preflightThrew = err;
  }
  expect(
    preflightThrew === null,
    `preflightAssertAllProbesExecutable() does not throw for the real PROBES list${preflightThrew ? ` (threw: ${preflightThrew.message})` : ""}`
  );

  console.log("\n[selftest] running the full pipeline (runAllProbes) against a stubbed, offline callTool/listTools...");
  const { results } = await runAllProbes(PROBES, {
    callToolFn: stubCallTool,
    listToolsFn: stubListTools,
    delayMs: 0,
    networkRetryBackoffMs: 5,
  });

  console.log("");
  expect(results.length === PROBES.length, `all ${PROBES.length} probes were attempted (got ${results.length} result rows)`);
  expect(
    results.every((r) => typeof r.name === "string" && typeof r.status === "string" && typeof r.domain === "string"),
    "every result row has a well-formed {name, status, domain} shape — none crashed/malformed"
  );
  expect(
    results.filter((r) => r.status === "MISSING").length === 0,
    "no probe reported MISSING (stub tools/list echoes every probe name back as live)"
  );

  const byName = Object.fromEntries(results.map((r) => [r.name, r]));

  const scenarios = [
    { name: "novada_setup", status: "PASS", domain: "-", severity: null, why: "a plain pass" },
    { name: "novada_scrape_amazon", status: "FAIL", domain: "③-backend", severity: "P2", why: "an isolated backend 520 (non-flaky platform)" },
    { name: "novada_scrape_walmart", status: "SLOW", domain: "-", severity: null, why: "processing → poll completes with real records" },
    { name: "novada_scrape_linkedin", status: "FAIL", domain: "③-backend", severity: "P2", why: "processing → poll still stuck (non-flaky platform)" },
    { name: "novada_scrape_github", status: "FAIL", domain: "③-backend", severity: "P3", why: "processing → poll still stuck on a KNOWN-FLAKY platform (LOW fix: must be P3, not P2)" },
    { name: "novada_scrape_shein", status: "FAIL", domain: "①-mcp-code", severity: "P1", why: 'processing matched but no task_id extracted (HIGH fix: must be ①, not ③)' },
    { name: "novada_map", status: "FAIL", domain: "①-mcp-code", severity: "P1", why: "our own validation error (INVALID_PARAMS)" },
    { name: "novada_scrape_facebook", status: "FAIL", domain: "②-gateway", severity: "P1", why: "an INVALID_API_KEY auth error (MEDIUM fix: must be ②/config, not ①)" },
    { name: "novada_extract", status: "PASS", domain: "-", severity: null, why: "httpStatus 0 non-timeout on attempt 1, retry recovers" },
    { name: "novada_scrape_instagram", status: "FAIL", domain: "②-gateway", severity: "P1", why: "httpStatus 0 non-timeout, retry exhausted (MEDIUM fix: must be ②, not ①)" },
    { name: "novada_scrape_google", status: "FAIL", domain: "③-backend", severity: "P2", why: 'scraper 50004 "context deadline exceeded" backend timeout on a NON-flaky platform (2026-07-28 fix: must be ③, not ①)' },
    { name: "novada_search", status: "FAIL", domain: "②-gateway", severity: "P0", why: "2026-07-30 free-gateway-cap error on a CORE tool (must be ②/P0, not ①-mcp-code)" },
    { name: "novada_scrape_yandex", status: "FAIL", domain: "②-gateway", severity: "P1", why: "the SAME free-gateway-cap error on a KNOWN-FLAKY platform, httpStatus 0 (must be ②/P1, NOT swallowed into ③-backend/P3)" },
  ];

  console.log("");
  for (const sc of scenarios) {
    const row = byName[sc.name];
    expect(Boolean(row), `${sc.name}: row present`);
    if (!row) continue;
    expect(row.status === sc.status, `${sc.name}: status === "${sc.status}" (got "${row.status}") — ${sc.why}`);
    expect(row.domain === sc.domain, `${sc.name}: domain === "${sc.domain}" (got "${row.domain}") — ${sc.why}`);
    expect(
      row.severity === sc.severity,
      `${sc.name}: severity === ${JSON.stringify(sc.severity)} (got ${JSON.stringify(row.severity)}) — ${sc.why}`
    );
  }

  // Review round 1 (2026-07-30, HIGH): adviceFor() was not extended alongside
  // classifyFailure()'s new FREE_CAP_RE branch, so a cap-hit row's `.advice`
  // (the report's "给后端的建议" column) fell through to the generic ②-gateway
  // fallthrough ("Ours — check hosted-server Vercel function health, timeout
  // budget, and streaming behavior") — exactly the misdirection this whole
  // fix targets. Assert directly on adviceFor()'s output for the
  // novada_search cap scenario so this can never silently regress again.
  console.log("");
  const capAdviceRow = byName.novada_search;
  expect(Boolean(capAdviceRow), "novada_search: row present for adviceFor() check");
  if (capAdviceRow) {
    const advice = adviceFor(capAdviceRow);
    expect(
      typeof advice === "string" && advice.includes("free-gateway cap"),
      `novada_search (free-gateway-cap scenario): adviceFor() mentions "free-gateway cap" (got: ${JSON.stringify(advice)}) — must NOT fall through to the generic ②-gateway advice`
    );
  }

  // The literal ratchet for the 2026-07-28 mislabel: the 50004 backend-
  // timeout scenario above must never count toward oursP0P1 the way
  // main() computes it (domain ①-mcp-code or ②-gateway at severity P0/P1).
  console.log("");
  const backendTimeoutRow = byName.novada_scrape_google;
  expect(Boolean(backendTimeoutRow), "novada_scrape_google: row present");
  if (backendTimeoutRow) {
    const countsAsOursP0P1 =
      (backendTimeoutRow.domain === "①-mcp-code" || backendTimeoutRow.domain === "②-gateway") &&
      (backendTimeoutRow.severity === "P0" || backendTimeoutRow.severity === "P1");
    expect(
      !countsAsOursP0P1,
      "novada_scrape_google (50004 backend timeout): does NOT contribute to oursP0P1 — a pure backend outage must not fail the run"
    );
  }

  // The literal CRITICAL regression check: novada_proxy_account_create (no
  // confirm) is ALSO in NEVER_EXECUTE_TOOL_NAMES by name. The old,
  // args-unaware guard threw for it unconditionally, outside any try/catch,
  // and FATAL-exited the whole run at this exact probe. If that ever comes
  // back, this assertion (or, failing that, the "all N probes attempted"
  // assertion above, or a FATAL exit from the outer .catch() below) will
  // catch it.
  console.log("");
  const proxyRow = byName.novada_proxy_account_create;
  expect(Boolean(proxyRow), "novada_proxy_account_create: row present (the run did not FATAL-exit at this probe)");
  if (proxyRow) {
    expect(
      proxyRow.status === "PASS" || proxyRow.status === "SLOW",
      `novada_proxy_account_create (no confirm): status is PASS/SLOW, not FAIL (got "${proxyRow.status}") — CRITICAL regression check`
    );
  }

  console.log("");
  if (failureCount > 0) {
    console.error(`[selftest] FAILED: ${failureCount} assertion(s) did not hold.`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `[selftest] OK — ${scenarios.length + 7} assertion group(s) passed, ${results.length} probe(s) attempted, 0 crashes.`
  );
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(`[selftest] FATAL (the pipeline crashed — this is exactly what this self-test exists to catch): ${err?.stack || err}`);
  process.exitCode = 1;
});
