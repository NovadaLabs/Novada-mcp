/**
 * Nightly canary INVARIANT_3[scrape] regression fix (2026-10-26).
 *
 * Production failure: a 429 from novada_scrape's result-poll step reached the
 * agent as a raw, unclassified "Tool error: Failed to retrieve scraper results:
 * Request failed with status code 429" — is_error=True, no NovadaErrorCode, no
 * failure_class, no retry_after_ms, no agent_instruction.
 *
 * Root cause (found during this fix, NOT what the original bug report assumed):
 * the npm-package STDIO dispatch (index.ts's CallToolRequestSchema catch) calls
 * classifyError() on EVERY thrown error — proven correct by a 2026-10-13 test
 * (npm-package/tests/tools/scrape.test.ts, TOW2-307 Task 2). This HOSTED gateway
 * (api/mcp.ts) runs its OWN, separate catch-all that only special-cased
 * `instanceof NovadaError` and otherwise fell back to a raw, truncated
 * "Tool error: <message>" string — classifyError() was never called here. Fixed
 * in mcp.ts by routing the generic (non-hosted-special) fallback branch through
 * the SAME classifyError() the stdio dispatch already uses.
 *
 * This file extracts and EXECUTES the real fallback-branch source from mcp.ts
 * (not a reimplementation) — same "extract-and-execute the real source"
 * convention as the rest of this test dir (sentry-scrub.test.mjs,
 * g3-g5-n4-preauth-ratelimit.test.mjs, url-credential-removal.test.mjs): mcp.ts
 * itself is never imported (module-load side effects: Sentry.init, @vercel/kv,
 * env-var stripping). `classifyError`/`NovadaError` are imported FOR REAL from
 * the vendored build (not stubbed) so this test exercises the actual
 * classification the hosted gateway will run in production.
 *
 * `redactHostedSecrets` is stubbed as an identity function here on purpose —
 * its OWN behavior (credential/host redaction) is already covered by
 * sentry-scrub.test.mjs and url-credential-removal.test.mjs; this file tests
 * ONLY "does the fallback branch route through classifyError() instead of the
 * generic Tool-error template", so none of the synthetic inputs below carry a
 * secret for it to redact anyway.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");
const VENDOR_ERRORS = join(__dirname, "..", "vendor", "novada-mcp", "_core", "errors.js");

const mcpSrc = readFileSync(MCP_TS, "utf8");
const { classifyError, NovadaError, NovadaErrorCode } = await import(VENDOR_ERRORS);

function sliceBetween(startAnchor, endAnchor, label) {
  const start = mcpSrc.indexOf(startAnchor);
  assert.ok(start !== -1, `anchor not found for ${label}: ${JSON.stringify(startAnchor)}`);
  const end = mcpSrc.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end !== -1, `end anchor not found for ${label}: ${JSON.stringify(endAnchor)}`);
  return mcpSrc.slice(start, end + endAnchor.length);
}

/**
 * Extract and EXECUTE the real hosted-aware-error-wrapping block verbatim
 * (the `if (error instanceof NovadaError) {...}` fast path PLUS the full
 * rawMsg/userMsg branch chain below it, including the 2026-10-26 fallback
 * fix), stripping only the TS-only `as const` annotations present in THIS
 * exact slice (same "strip the TS-only bits, execute the rest verbatim"
 * technique tool-catalog-derivation.test.mjs / sentry-scrub.test.mjs use).
 * Wrapped in a function taking `error` so each test case can call it directly
 * instead of re-deriving the whole mcp.ts request-handler closure.
 */
function extractErrorFormatter() {
  const code = sliceBetween(
    "if (error instanceof NovadaError) {",
    "      return {\n        content: [{ type: \"text\" as const, text: userMsg }],\n        isError: true,\n      };",
    "instanceof NovadaError..final fallback return block",
  ).replace(/ as const/g, "");

  assert.ok(!/ as const/.test(code), `extracted block still has an un-stripped "as const":\n${code}`);

  const fn = new Function(
    "error",
    "NovadaError",
    "classifyError",
    `
    const redactHostedSecrets = (s) => s; // identity stub — see file header
    ${code}
    `
  );
  return fn;
}

const formatHostedToolError = extractErrorFormatter();

test("2026-10-26 fix: a 429 AxiosError-shaped plain Error classifies via classifyError(), never the generic 'Tool error:' fallback", () => {
  const err = new Error("Failed to retrieve scraper results: Request failed with status code 429");
  const result = formatHostedToolError(err, NovadaError, classifyError);

  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.ok(!text.startsWith("Tool error:"), `must not be the generic fallback, got: ${text}`);
  assert.ok(text.includes("Error [RATE_LIMITED]"), `must carry the structured code, got: ${text}`);
  assert.ok(text.includes("agent_instruction:"), `must carry agent_instruction, got: ${text}`);
  assert.ok(text.includes("failure_class: quota"), `must carry failure_class, got: ${text}`);
  assert.ok(text.includes("retry_after_ms"), `must carry retry guidance, got: ${text}`);
});

test("2026-10-26 fix: a real NovadaError still takes the (unchanged) instanceof fast path, not the classifyError() fallback", () => {
  const err = new NovadaError({
    code: NovadaErrorCode.INSUFFICIENT_BALANCE,
    message: "Your balance is insufficient.",
    agent_instruction: "Top up at https://dashboard.novada.com",
    retryable: false,
  });
  const result = formatHostedToolError(err, NovadaError, classifyError);

  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.ok(text.includes("Error [INSUFFICIENT_BALANCE]"), `must preserve the ORIGINAL NovadaError's code, got: ${text}`);
  assert.ok(text.includes("Your balance is insufficient."), `must preserve the ORIGINAL message, got: ${text}`);
});

test("2026-10-26 fix: a 500 (generic server error) classifies as API_DOWN, not the generic 'Tool error:' fallback", () => {
  const err = new Error("Request failed with status code 500");
  const result = formatHostedToolError(err, NovadaError, classifyError);

  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.ok(!text.startsWith("Tool error:"), `must not be the generic fallback, got: ${text}`);
  assert.ok(text.includes("Error [API_DOWN]"), `must carry the structured code, got: ${text}`);
});

test("2026-10-26 fix (mirror, class-not-instance): the 3 pre-existing HOSTED-ONLY substring branches are untouched — they must NOT be swallowed by classifyError()", () => {
  const cases = [
    { msg: "NOVADA_WEB_UNBLOCKER_KEY is not set", expectSubstring: "Extract JS rendering is not configured on this hosted endpoint" },
    { msg: "proxy credentials not configured for this key", expectSubstring: "Proxy credentials are not available on this hosted endpoint" },
    { msg: "NOT_AVAILABLE_ON_HOSTED: novada_browser requires Playwright", expectSubstring: "This tool requires a local MCP server" },
  ];
  for (const { msg, expectSubstring } of cases) {
    const err = new Error(msg);
    const result = formatHostedToolError(err, NovadaError, classifyError);
    const text = result.content[0].text;
    assert.ok(text.includes(expectSubstring), `expected hosted-only override text for ${JSON.stringify(msg)}, got: ${text}`);
    assert.ok(!text.includes("Error ["), `hosted-only override must NOT be routed through classifyError(), got: ${text}`);
  }
});

test("2026-10-26 fix: an unrecognized error still classifies honestly as UNKNOWN (classifyError never throws, never silently empty)", () => {
  const err = new Error("some never-seen-before upstream string xyz123");
  const result = formatHostedToolError(err, NovadaError, classifyError);

  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.ok(!text.startsWith("Tool error:"), `must not be the generic fallback, got: ${text}`);
  assert.ok(text.includes("Error [UNKNOWN]"), `must carry the UNKNOWN code honestly, got: ${text}`);
});
