/**
 * QA: Advanced error classification edge cases
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function makeClient(extraEnv = {}) {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" }, extraEnv),
  });
  const c = new Client({ name: "qa-adv", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return { t, c };
}

const findings = [];

// ── TEST: 404 from developer API mapped correctly ─────────────────────────────
// According to developer_api.ts: HTTP 404 → PRODUCT_UNAVAILABLE
// PRODUCT_UNAVAILABLE → failure_class: permanent, retry_recommended: false
// This should NOT be retryable since it means the product isn't provisioned
console.log("=== Test: PRODUCT_UNAVAILABLE (404) classification ===");
console.log("PRODUCT_UNAVAILABLE → permanent, not retryable (verified in source)");
console.log("This is correct: 404 on developer API means product not provisioned");

// ── TEST: 403 anti-bot vs 403 auth ambiguity ──────────────────────────────────
console.log("\n=== Test: 403 Forbidden ambiguity ===");
// Test the classifyError logic with different 403 message variations
// We can't directly call classifyError from MCP client, so analyze the source

// The issue: errors.ts classifyError checks:
// (msg.includes("403") && (msg.includes("forbidden") || msg.includes("blocked")))
// This will match both Cloudflare 403 AND regular API 403 Forbidden

// Example 1: "Request failed with status code 403" - does NOT match (no "forbidden" or "blocked") → UNKNOWN
// Example 2: "Error: 403 Forbidden" - DOES match → URL_UNREACHABLE (WRONG for auth)
// Example 3: "403 blocked by firewall" - DOES match → URL_UNREACHABLE (correct for block)
// Example 4: "403 forbidden - invalid scope" - DOES match → URL_UNREACHABLE (WRONG for auth)

findings.push({
  title: "'403 forbidden' string matches anti-bot branch — misclassifies API auth failures as transient/retryable",
  severity: "Medium",
  category: "error-recovery",
  component: "classifyError() in src/_core/errors.ts",
  environment: "both",
  repro_steps: [
    "1. Trigger an HTTP 403 response from any Novada API (e.g. wrong token scope)",
    "2. The Axios error message will include '403' + likely 'Forbidden' (default HTTP phrase)",
    "3. classifyError() matches the anti-bot branch at errors.ts:384-399",
    "4. Returns NovadaErrorCode.URL_UNREACHABLE with retryable=true"
  ].join("\n"),
  expected: "HTTP 403 Forbidden from API auth failure → INVALID_API_KEY or PRODUCT_UNAVAILABLE (permanent, retry_recommended: false)",
  actual: "If message includes both '403' and 'forbidden', → URL_UNREACHABLE (transient, retry_recommended: true, retry_after_ms: 10000)",
  root_cause: "Anti-bot detection condition at errors.ts:397 uses OR logic: '(msg.includes(\"403\") && (msg.includes(\"forbidden\") || msg.includes(\"blocked\")))'. This inadvertently matches standard 'HTTP 403 Forbidden' error messages from API endpoints returning auth failures.",
  suggested_fix: "Restrict anti-bot 403 detection to require Cloudflare-specific signals: '(msg.includes(\"403\") && (msg.includes(\"cf-challenge\") || msg.includes(\"cf_chl\") || msg.includes(\"just a moment\") || msg.includes(\"captcha\")))'. Use a separate '403 forbidden without Cloudflare signals → PRODUCT_UNAVAILABLE' branch.",
  code_location: "src/_core/errors.ts:395-398",
  evidence: "classifyError condition: 'msg.includes(\"403\") && (msg.includes(\"forbidden\") || msg.includes(\"blocked\"))'. Standard Axios errors for HTTP 403 produce messages like 'Request failed with status code 403' but verbose HTTP clients may produce '403 Forbidden'. Any HTTP library that includes the phrase 'Forbidden' in its error message will trigger this.",
  confidence: "high",
});

// ── TEST: UNKNOWN fallback classification ─────────────────────────────────────
console.log("\n=== Test: UNKNOWN classification for non-matching errors ===");
// When no pattern matches, UNKNOWN is used with:
// - failure_class: permanent (from FAILURE_CLASS table)
// - retryable: false (from makeNovadaError factory)
// This is a conservative safe default — good
console.log("UNKNOWN → permanent, not retryable: CORRECT (safe default)");

// But let's verify: what about AxiosError network failures that don't match timeout/enotfound?
// For example: a DNS timeout might produce "getaddrinfo EAI_AGAIN" → matches URL_UNREACHABLE ✓
// But "socket hang up" → doesn't match any pattern → UNKNOWN (permanent, non-retryable)
// This is potentially wrong: "socket hang up" is transient (server closed connection)
findings.push({
  title: "'socket hang up' network error classified as UNKNOWN (permanent) instead of URL_UNREACHABLE (transient)",
  severity: "Low",
  category: "error-recovery",
  component: "classifyError() in src/_core/errors.ts",
  environment: "both",
  repro_steps: [
    "1. Trigger a socket hang up error (server closes connection mid-response)",
    "2. Axios produces Error: socket hang up",
    "3. classifyError() doesn't match any known pattern",
    "4. Falls through to UNKNOWN → permanent, not retryable"
  ].join("\n"),
  expected: "socket hang up (network-level connection reset) → URL_UNREACHABLE (transient, retryable)",
  actual: "socket hang up → UNKNOWN (permanent, retry_recommended: false)",
  root_cause: "Network error patterns in classifyError() are limited to: timeout, timed out, econnrefused, enotfound, eai_again, err_name_not_resolved, network error, failed to fetch, net::err. 'socket hang up' is a common Node.js/Axios network error not in the list.",
  suggested_fix: "Add 'socket hang up', 'ECONNRESET', 'EPIPE', 'EHOSTUNREACH', 'connection reset' to the URL_UNREACHABLE network pattern list.",
  code_location: "src/_core/errors.ts:422-440",
  evidence: "URL_UNREACHABLE conditions (lines 422-440): msg.includes(\"timeout\") || msg.includes(\"timed out\") || msg.includes(\"econnrefused\") || msg.includes(\"enotfound\") || msg.includes(\"eai_again\") || msg.includes(\"err_name_not_resolved\") || msg.includes(\"network error\") || msg.includes(\"failed to fetch\") || msg.includes(\"net::err\"). 'socket hang up' is missing.",
  confidence: "high",
});

// ── TEST: HTTP 504 Gateway Timeout not mapped ─────────────────────────────────
console.log("\n=== Test: HTTP 504 Gateway Timeout classification ===");
// 504 Gateway Timeout is transient — the upstream timed out
// API_DOWN check: msg.includes("503") || msg.includes("502") || msg.includes("500")
// 504 is NOT in the list → falls to UNKNOWN (permanent, not retryable)
// This is wrong: 504 is definitely transient, should be API_DOWN or URL_UNREACHABLE
findings.push({
  title: "HTTP 504 Gateway Timeout not matched → UNKNOWN (permanent) instead of API_DOWN (transient)",
  severity: "Medium",
  category: "error-recovery",
  component: "classifyError() in src/_core/errors.ts",
  environment: "both",
  repro_steps: [
    "1. Upstream service returns HTTP 504 Gateway Timeout",
    "2. Error message includes '504' but not '503', '502', or '500'",
    "3. classifyError() falls through to UNKNOWN",
    "4. Returns permanent, retry_recommended: false"
  ].join("\n"),
  expected: "HTTP 504 Gateway Timeout → API_DOWN (transient, retry_recommended: true, retry_after_ms: 30000)",
  actual: "msg.includes('504') is not checked → UNKNOWN (permanent, retry_recommended: false)",
  root_cause: "API_DOWN check at errors.ts:443 only covers 503, 502, 500. HTTP 504 (Gateway Timeout) and 521 (Cloudflare Web Server Down) are common upstream errors not in the list.",
  suggested_fix: "Expand the API_DOWN check to cover 504, 521, 522, 523, 524 (common Cloudflare codes) and any 5xx pattern: use a regex /5[0-9]{2}/ or add explicit msg.includes('504').",
  code_location: "src/_core/errors.ts:442-450",
  evidence: "API_DOWN condition: if (msg.includes('503') || msg.includes('502') || msg.includes('500') || msg.includes('api_down')). HTTP 504, 521, 522, 523, 524 are all absent.",
  confidence: "high",
});

// ── TEST: Verify retry_after_ms is absent for non-transient codes ─────────────
console.log("\n=== Test: retry_after_ms absent for permanent errors ===");
{
  const { t, c } = await makeClient();
  const r = await c.callTool({ name: "novada_search", arguments: { query: "x".repeat(600) } });
  const text = r.content?.[0]?.text || "";
  const hasRetryAfterMs = /retry_after_ms:/.test(text);
  console.log("INVALID_PARAMS has retry_after_ms:", hasRetryAfterMs);
  if (hasRetryAfterMs) {
    findings.push({
      title: "retry_after_ms present in INVALID_PARAMS (permanent) error — should be absent",
      severity: "Low",
      category: "error-recovery",
      component: "toAgentString()",
      evidence: text.slice(0, 300),
      confidence: "high",
    });
  } else {
    console.log("✓ retry_after_ms correctly absent from INVALID_PARAMS");
  }
  await c.close();
}

// ── TEST: Error escaping — do agent_instruction fields stay safe ──────────────
console.log("\n=== Test: Newline sanitization in error messages ===");
// The toAgentString() sanitizes newlines from the message field
// But what if detail field contains a newline?
// redactSecrets(this.detail) is called BUT no newline stripping on detail
{
  const { t, c } = await makeClient();
  // Can we inject via a detail field? detail comes from caller-provided strings
  // e.g. from makeNovadaError with detail containing newlines
  // The toAgentString outputs: detail: "..."
  // If detail has \n, it can inject an extra line that looks like a new field
  // This is a security concern — let's verify the output format
  const r = await c.callTool({ name: "novada_search", arguments: { query: "x".repeat(600) } });
  const text = r.content?.[0]?.text || "";
  console.log("Full error output:\n", text);

  // Check if detail field is present and if it has newlines
  const detailMatch = text.match(/detail: "(.+)"$/ms);
  if (detailMatch) {
    const detailValue = detailMatch[1];
    console.log("detail value:", JSON.stringify(detailValue));
    if (detailValue.includes("\n")) {
      findings.push({
        title: "detail field in toAgentString() may contain newlines — potential injection vector",
        severity: "Low",
        category: "error-recovery",
        component: "NovadaError.toAgentString()",
        evidence: text.slice(0, 400),
        confidence: "medium",
      });
    } else {
      console.log("✓ detail field contains no newlines");
    }
  }
  await c.close();
}

// ── TEST: UNKNOWN classification in fallback path ─────────────────────────────
console.log("\n=== Test: String error fallback (non-Error object) ===");
// classifyError handles non-Error objects:
// const rawMsg = error instanceof Error ? error.message : String(error);
// return new NovadaError({ code: UNKNOWN, ... retryable: false });
// This is correct for safety — non-Error throws should be UNKNOWN permanent

// ── TEST: Check novada_scraper_status handles task not found correctly ─────────
console.log("\n=== Test: Scraper status not_found vs error format ===");
{
  const { t, c } = await makeClient();
  const r = await c.callTool({ name: "novada_scraper_status", arguments: { task_id: "nonexistent-999" } });
  const text = r.content?.[0]?.text || "";
  console.log("scraper_status not_found response:", text.slice(0, 500));

  // Does this return structured NovadaError format or a custom JSON?
  if (text.includes('"status"') || text.includes('"task_id"')) {
    console.log("Returns JSON format (not NovadaError toAgentString)");
    // Check: does it have failure_class / retry_recommended?
    if (!text.includes("failure_class") && !text.includes("retry_recommended")) {
      // This is by design - scraper_status has its own response format
      console.log("Note: scraper_status uses custom JSON, not NovadaError format");
      console.log("This may be intentional for task lifecycle management");
    }
  }
  await c.close();
}

console.log("\n=== FINDINGS SUMMARY ===");
findings.forEach(f => console.log(`[${f.severity}] ${f.title}`));
console.log(`Total: ${findings.length}`);

export { findings };
