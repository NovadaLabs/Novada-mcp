/**
 * Sentry egress credential scrubbing (claude-directory-exam S1-connector,
 * mid-task orchestrator finding: production has SENTRY_DSN set; @sentry/node's
 * default http instrumentation can attach the raw incoming request URL/headers
 * to a captured exception or breadcrumb. A pre-connector-review client can still
 * send a URL-carried credential (`?apikey=`, `?api_key=`, `?token=`, `?pathKey=`,
 * or the `/:key/mcp` path form) even though the server no longer authenticates
 * with it — the value still arrives in req.url, so without scrubbing it could
 * leave this process via Sentry (a third party), which is exactly the class of
 * leak the URL-credential removal (url-credential-removal.test.mjs) and the
 * "no log/telemetry line records req.url" guard already close for console.log.
 *
 * This file extracts and EXECUTES the real redactHostedSecrets() /
 * sentryBeforeSend() / sentryBeforeBreadcrumb() functions from api/mcp.ts (not a
 * reimplementation) — same "extract-and-execute the real source" convention as
 * the rest of this test dir (g3-g5-n4-preauth-ratelimit.test.mjs,
 * url-credential-removal.test.mjs): mcp.ts itself is never imported (module-load
 * side effects: Sentry.init, @vercel/kv, env-var stripping).
 *
 * Table-driven over every URL-credential carrier (class, not instance) plus an
 * Authorization header and a key embedded in an exception message. Mirror row:
 * a benign event must keep its diagnostic value (tool tag, error code) — the
 * scrubber must redact secrets, not neuter the event into useless noise.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");
const mcpSrc = readFileSync(MCP_TS, "utf8");

function sliceBetween(startAnchor, endAnchor, label) {
  const start = mcpSrc.indexOf(startAnchor);
  assert.ok(start !== -1, `anchor not found for ${label}: ${JSON.stringify(startAnchor)}`);
  const end = mcpSrc.indexOf(endAnchor, start + startAnchor.length);
  assert.ok(end !== -1, `end anchor not found for ${label}: ${JSON.stringify(endAnchor)}`);
  return mcpSrc.slice(start, end + endAnchor.length);
}

/**
 * Extract and EXECUTE the real PUBLIC_NOVADA_HOSTS / redactHostedSecrets /
 * SENTRY_HEADER_ALLOWLIST / redactDeep / sentryBeforeSend / sentryBeforeBreadcrumb
 * block verbatim, stripping only the TS-only type annotations present in THIS
 * exact slice (same "strip the TS-only bits, execute the rest verbatim" technique
 * tool-catalog-derivation.test.mjs uses). A stand-in SERVER_BROWSER_WS_SNAPSHOT="" is
 * declared first since redactHostedSecrets closes over that module-level const from
 * earlier in mcp.ts — irrelevant to the credential-carrier assertions this file
 * makes, so an empty string (its "unset" value) is a faithful stand-in.
 */
function extractScrubbers() {
  const code = sliceBetween(
    "const PUBLIC_NOVADA_HOSTS = new Set([",
    "function sentryBeforeBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {\n  if (breadcrumb.message) breadcrumb.message = redactHostedSecrets(breadcrumb.message);\n  if (breadcrumb.data) {\n    const data = { ...breadcrumb.data } as Record<string, unknown>;\n    delete data.headers;\n    delete data.cookies;\n    breadcrumb.data = redactDeep(data) as Record<string, unknown>;\n  }\n  return breadcrumb;\n}",
    "PUBLIC_NOVADA_HOSTS..sentryBeforeBreadcrumb block",
  )
    .replace(/function redactHostedSecrets\(msg: string\): string \{/, "function redactHostedSecrets(msg) {")
    .replace(/function redactDeep\(value: unknown, depth = 0\): unknown \{/, "function redactDeep(value, depth = 0) {")
    .replace(/function sentryBeforeSend\(event: Sentry\.ErrorEvent\): Sentry\.ErrorEvent \{/, "function sentryBeforeSend(event) {")
    .replace(/function sentryBeforeBreadcrumb\(breadcrumb: Sentry\.Breadcrumb\): Sentry\.Breadcrumb \{/, "function sentryBeforeBreadcrumb(breadcrumb) {")
    .replace(/const filtered: Record<string, string> = \{\};/, "const filtered = {};")
    .replace(/const out: Record<string, unknown> = \{\};/, "const out = {};")
    .replace(/ as Record<string, unknown>/g, "")
    .replace(/ as typeof event\.extra/g, "")
    .replace(/ as typeof event\.contexts/g, "");

  assert.ok(!/:\s*(string|unknown|Sentry\.)/.test(code), `extracted scrubber block still has an un-stripped TS type annotation:\n${code}`);

  const fn = new Function(`
    const SERVER_BROWSER_WS_SNAPSHOT = "";
    ${code}
    return { redactHostedSecrets, sentryBeforeSend, sentryBeforeBreadcrumb };
  `);
  return fn();
}

const { redactHostedSecrets, sentryBeforeSend, sentryBeforeBreadcrumb } = extractScrubbers();

const REAL_LOOKING_KEY = "sk-eu-novada-abcdefghijklmnopqrstuvwx0123456789";

// ─── Class table: every URL-credential carrier must be gone after scrubbing ──

const CREDENTIAL_CARRYING_URLS = [
  { name: "?apikey=", url: `https://mcp.novada.com/mcp?apikey=${REAL_LOOKING_KEY}` },
  { name: "?api_key=", url: `https://mcp.novada.com/mcp?api_key=${REAL_LOOKING_KEY}` },
  { name: "?token=", url: `https://mcp.novada.com/mcp?token=${REAL_LOOKING_KEY}` },
  { name: "?pathKey=", url: `https://mcp.novada.com/mcp?pathKey=${REAL_LOOKING_KEY}` },
  { name: "/:key/mcp path segment", url: `https://mcp.novada.com/${REAL_LOOKING_KEY}/mcp` },
];

for (const { name, url } of CREDENTIAL_CARRYING_URLS) {
  test(`redactHostedSecrets: URL carrier ${name} — the key is gone from the redacted string`, () => {
    const redacted = redactHostedSecrets(url);
    assert.ok(!redacted.includes(REAL_LOOKING_KEY), `redacted URL must not contain the key: ${redacted}`);
  });

  test(`sentryBeforeSend: a captured event whose request.url carries ${name} never contains the key afterward`, () => {
    const event = {
      message: "upstream fetch failed",
      request: { url, headers: { authorization: `Bearer ${REAL_LOOKING_KEY}`, "user-agent": "test-agent/1.0" } },
      exception: { values: [{ type: "Error", value: `request to ${url} failed` }] },
      tags: { tool: "novada_extract" },
    };
    const scrubbed = sentryBeforeSend(event);
    const serialized = JSON.stringify(scrubbed);
    assert.ok(!serialized.includes(REAL_LOOKING_KEY), `scrubbed event must not contain the key anywhere: ${serialized}`);
  });
}

// ─── Authorization header + exception-message key are scrubbed ──────────────

test("sentryBeforeSend: request.headers.authorization is dropped outright (not redacted-in-place, allowlist-not-denylist)", () => {
  const event = { request: { url: "https://mcp.novada.com/mcp", headers: { authorization: `Bearer ${REAL_LOOKING_KEY}`, "user-agent": "ua" } } };
  const scrubbed = sentryBeforeSend(event);
  assert.deepEqual(Object.keys(scrubbed.request.headers), ["user-agent"]);
});

test("sentryBeforeSend: request.cookies and request.data are dropped outright", () => {
  const event = { request: { url: "https://mcp.novada.com/mcp", cookies: { session: "abc" }, data: { apikey: REAL_LOOKING_KEY } } };
  const scrubbed = sentryBeforeSend(event);
  assert.equal(scrubbed.request.cookies, undefined);
  assert.equal(scrubbed.request.data, undefined);
});

test("sentryBeforeSend: request.query_string is dropped outright", () => {
  const event = { request: { url: "https://mcp.novada.com/mcp", query_string: `apikey=${REAL_LOOKING_KEY}` } };
  const scrubbed = sentryBeforeSend(event);
  assert.equal(scrubbed.request.query_string, undefined);
});

test("sentryBeforeSend: a key embedded in an exception message is redacted", () => {
  const event = { exception: { values: [{ type: "Error", value: `auth failed for key ${REAL_LOOKING_KEY}` }] } };
  const scrubbed = sentryBeforeSend(event);
  assert.ok(!scrubbed.exception.values[0].value.includes(REAL_LOOKING_KEY));
});

test("sentryBeforeSend: event.extra and event.contexts are deep-redacted (nested strings too)", () => {
  const event = { extra: { nested: { curl: `curl -H "Authorization: Bearer ${REAL_LOOKING_KEY}" https://mcp.novada.com/mcp` } } };
  const scrubbed = sentryBeforeSend(event);
  assert.ok(!JSON.stringify(scrubbed.extra).includes(REAL_LOOKING_KEY));
});

// ─── Breadcrumbs: same contract ──────────────────────────────────────────────

test("sentryBeforeBreadcrumb: a breadcrumb message carrying a credential URL is redacted", () => {
  const breadcrumb = { category: "http", message: `GET https://mcp.novada.com/mcp?apikey=${REAL_LOOKING_KEY}` };
  const scrubbed = sentryBeforeBreadcrumb(breadcrumb);
  assert.ok(!scrubbed.message.includes(REAL_LOOKING_KEY));
});

test("sentryBeforeBreadcrumb: breadcrumb.data.headers/cookies are dropped outright, other data strings are redacted", () => {
  const breadcrumb = {
    category: "http",
    data: { url: `https://mcp.novada.com/mcp?token=${REAL_LOOKING_KEY}`, headers: { authorization: `Bearer ${REAL_LOOKING_KEY}` }, cookies: "x=1" },
  };
  const scrubbed = sentryBeforeBreadcrumb(breadcrumb);
  assert.equal(scrubbed.data.headers, undefined);
  assert.equal(scrubbed.data.cookies, undefined);
  assert.ok(!scrubbed.data.url.includes(REAL_LOOKING_KEY));
});

// ─── Mirror row: a benign event keeps its diagnostic value — scrubbing isn't neutering ──

test("MIRROR: a benign event (no credential anywhere) keeps its tool tag, error code, and message intact", () => {
  const event = {
    message: "upstream timeout",
    tags: { tool: "novada_search" },
    exception: { values: [{ type: "NovadaError", value: "API_DOWN: upstream search backend unavailable" }] },
    request: { url: "https://mcp.novada.com/mcp", headers: { "user-agent": "claude-ai/1.0", "content-type": "application/json" } },
  };
  const scrubbed = sentryBeforeSend(structuredClone(event));
  assert.equal(scrubbed.message, "upstream timeout");
  assert.deepEqual(scrubbed.tags, { tool: "novada_search" });
  assert.equal(scrubbed.exception.values[0].value, "API_DOWN: upstream search backend unavailable");
  assert.equal(scrubbed.request.url, "https://mcp.novada.com/mcp");
  assert.deepEqual(scrubbed.request.headers, { "user-agent": "claude-ai/1.0", "content-type": "application/json" });
});

test("MIRROR: a benign breadcrumb with no credential keeps its message and category", () => {
  const breadcrumb = { category: "tool-handled", level: "info", message: "novada_extract: URL_UNREACHABLE", data: { tool: "novada_extract", retryable: true } };
  const scrubbed = sentryBeforeBreadcrumb(structuredClone(breadcrumb));
  assert.equal(scrubbed.message, "novada_extract: URL_UNREACHABLE");
  assert.deepEqual(scrubbed.data, { tool: "novada_extract", retryable: true });
});

// ─── Static guards: init wiring + explicit sendDefaultPii ────────────────────

test("STATIC: Sentry.init wires beforeSend/beforeBreadcrumb to the real scrubbers (not an identity passthrough)", () => {
  const initBlock = sliceBetween("Sentry.init({", "\n  });", "Sentry.init call");
  assert.match(initBlock, /beforeSend:\s*sentryBeforeSend/);
  assert.match(initBlock, /beforeBreadcrumb:\s*sentryBeforeBreadcrumb/);
  assert.doesNotMatch(initBlock, /beforeSend:\s*\(event\)\s*=>\s*event/, "beforeSend must not be a bare identity passthrough anymore");
});

test("STATIC: Sentry.init sets sendDefaultPii: false explicitly", () => {
  const initBlock = sliceBetween("Sentry.init({", "\n  });", "Sentry.init call");
  assert.match(initBlock, /sendDefaultPii:\s*false/);
});
