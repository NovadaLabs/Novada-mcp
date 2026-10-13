/**
 * Claude Directory connector review — URL credentials removed from auth
 * (claude-directory-exam S1-connector, SOP step 1).
 *
 * Anthropic's connector auth rules (https://claude.com/docs/connectors/building/authentication):
 * "Never accept it in the URL: don't read tokens from query parameters such as
 * `?token=` or `?apiKey=`. URLs end up in server logs, proxies, and browser
 * history, and the MCP authorization specification prohibits access tokens in
 * the query string."
 *
 * Before this change, extractToken() in api/mcp.ts accepted FIVE URL carriers for
 * the exact same credential class:
 *   1. the `/:key/mcp` path segment (matched directly, Node runtime)
 *   2. `?pathKey=` (the query param Vercel's rewrite injects for the path form)
 *   3. `?apikey=` (canonical query-param alias)
 *   4. `?api_key=` (query-param alias)
 *   5. `?token=` (legacy query-param alias)
 * This file is a CLASS table over those five carriers — one row each — so a
 * carrier can't be silently reintroduced by extending `extractToken` later
 * without this test enumerating it. Bearer header + OAuth access token (also
 * sent via the Bearer header) are the only remaining credential sources and are
 * asserted as the "still works" mirror rows.
 *
 * Runs on plain Node (`node --test`) — same "extract and EXECUTE the real
 * function body, don't reimplement it" convention as the rest of this test
 * dir (g3-g5-n4-preauth-ratelimit.test.mjs, tool-catalog-derivation.test.mjs):
 * mcp.ts itself is never imported (module-load side effects: Sentry.init,
 * @vercel/kv client construction, env-var stripping).
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
  return mcpSrc.slice(start, end);
}

/**
 * Extract and EXECUTE mcp.ts's real extractToken() body (not a reimplementation)
 * against a real Web API Request object. Node 22+ has global Request/Headers, so
 * the extracted body can run verbatim once its TS type annotations are stripped.
 */
function extractExtractToken() {
  const SIG = "function extractToken(req: Request): { token: string; authMethod: AuthMethod } | null {";
  const code = sliceBetween(SIG, "\n}\n", "extractToken")
    .replace(SIG, "return function extractToken(req) {");
  return new Function(`${code}\n};`)();
}

const extractToken = extractExtractToken();

/** Build a Request whose URL carries one credential class member, for the given path+query. */
function reqWithUrl(pathAndQuery) {
  return new Request(`https://mcp.novada.com${pathAndQuery}`, { method: "POST" });
}

function reqWithBearer(token) {
  return new Request("https://mcp.novada.com/mcp", { method: "POST", headers: { authorization: `Bearer ${token}` } });
}

const VALID_LOOKING_KEY = "abcdefghijklmnopqrstuvwx0123456789"; // 16+ alnum, format-valid shape

// ─── Class table: every removed URL carrier must now be IGNORED (not authenticated) ──

const REMOVED_URL_CARRIERS = [
  { name: "path segment (/:key/mcp)", req: () => reqWithUrl(`/${VALID_LOOKING_KEY}/mcp`) },
  { name: "?pathKey= (Vercel rewrite's injected query param for the path form)", req: () => reqWithUrl(`/mcp?pathKey=${VALID_LOOKING_KEY}`) },
  { name: "?apikey= (canonical query-param alias)", req: () => reqWithUrl(`/mcp?apikey=${VALID_LOOKING_KEY}`) },
  { name: "?api_key= (query-param alias)", req: () => reqWithUrl(`/mcp?api_key=${VALID_LOOKING_KEY}`) },
  { name: "?token= (legacy query-param alias)", req: () => reqWithUrl(`/mcp?token=${VALID_LOOKING_KEY}`) },
];

for (const { name, req } of REMOVED_URL_CARRIERS) {
  test(`extractToken: URL carrier REMOVED — ${name} — is never read as a credential (returns null, not authenticated)`, () => {
    const result = extractToken(req());
    assert.equal(result, null, `extractToken must return null for a request authenticated only via ${name} — URL credentials are rejected`);
  });
}

test("REMOVED_URL_CARRIERS table covers all 5 carriers the brief enumerated (class completeness)", () => {
  assert.equal(REMOVED_URL_CARRIERS.length, 5);
});

// ─── Mirror rows: the two REMAINING credential sources still work ────────────

test("extractToken: Authorization: Bearer header still authenticates (authMethod: 'bearer')", () => {
  const result = extractToken(reqWithBearer(VALID_LOOKING_KEY));
  assert.deepEqual(result, { token: VALID_LOOKING_KEY, authMethod: "bearer" });
});

test("extractToken: a Bearer header carrying an OAuth access token (nvo_at_*) is read the same way — resolution to the real key happens later in fetchHandler, not here", () => {
  const oauthToken = "nvo_at_abcdefghijklmnopqrstuvwxyz0123456789";
  const result = extractToken(reqWithBearer(oauthToken));
  assert.deepEqual(result, { token: oauthToken, authMethod: "bearer" });
});

test("extractToken: a request with BOTH a URL credential AND no header is still unauthenticated (URL cannot smuggle a credential alongside a missing header)", () => {
  const result = extractToken(reqWithUrl(`/mcp?apikey=${VALID_LOOKING_KEY}&token=${VALID_LOOKING_KEY}&pathKey=${VALID_LOOKING_KEY}`));
  assert.equal(result, null);
});

test("extractToken: no Authorization header and no URL credential at all -> null", () => {
  const result = extractToken(reqWithUrl("/mcp"));
  assert.equal(result, null);
});

// ─── Static source guards: the removed reads are GONE from the source, not just behaviorally inert ──

test("STATIC: extractToken's source no longer reads any URL-carrier search param or path-based credential", () => {
  const body = sliceBetween(
    "function extractToken(req: Request): { token: string; authMethod: AuthMethod } | null {",
    "\n}\n",
    "extractToken body",
  );
  for (const banned of [
    'searchParams.get("pathKey")',
    'searchParams.get("apikey")',
    'searchParams.get("api_key")',
    'searchParams.get("token")',
  ]) {
    assert.ok(!body.includes(banned), `extractToken must no longer contain ${banned}`);
  }
  // The path-segment regex match for CREDENTIAL purposes must also be gone from
  // this function body (routing in fetchHandler may still use an equivalent
  // regex to decide whether to answer at all — that's checked separately below —
  // but extractToken itself must not derive a token from it).
  assert.ok(!/authMethod:\s*"path"/.test(body), 'extractToken must not produce authMethod:"path" anymore');
  assert.ok(!/authMethod:\s*"query"/.test(body), 'extractToken must not produce authMethod:"query" anymore');
  assert.match(body, /authMethod:\s*"bearer"/, "extractToken must still produce authMethod:\"bearer\" for the header form");
});

test("STATIC: a request to /:key/mcp still ROUTES to the mcp handler (so it gets a clear 401, not a bare 404) — the path-match used for ROUTING is distinct from credential extraction", () => {
  // This is the SAME regex fetchHandler uses to decide isMcpPath, proving routing
  // was deliberately preserved (CHALLENGE-checked: removing it would silently
  // 404 a pre-existing bookmarked URL instead of answering with a diagnostic 401).
  assert.match(mcpSrc, /const pathMatch = pathname\.match\(\/\^\\\/\(\[a-zA-Z0-9_\\-\]\{16,\}\)\\\/mcp\$\/\);/);
  assert.match(mcpSrc, /const isMcpPath = pathname === "\/mcp" \|\| pathname === "\/api\/mcp" \|\| !!pathMatch;/);
});

// ─── User-facing 401 messages no longer instruct a URL-credential form ───────

test("STATIC: no user-facing 401 message instructs ?apikey=/?api_key=/?token= or 'in your MCP URL' anymore", () => {
  const authSection = sliceBetween(
    "// Auth — validate the token and reject with 401 before any per-key work",
    "// Per-IP rate limit — slow down abusive loops",
    "auth guard chain",
  );
  assert.doesNotMatch(authSection, /\?apikey=|\?api_key=|\?token=/, "no 401 message may still show a URL query-param credential form");
  assert.doesNotMatch(authSection, /in your MCP URL/i, "no 401 message may still direct the caller to put a credential in the URL");
  assert.match(authSection, /Authorization: Bearer/, "401 messages must still point callers to the Bearer header");
});

test("STATIC: the MISSING_TOKEN message mentions OAuth sign-in as an alternative to the Bearer header", () => {
  const authSection = sliceBetween(
    "// Auth — validate the token and reject with 401 before any per-key work",
    "// Per-IP rate limit — slow down abusive loops",
    "auth guard chain",
  );
  assert.match(authSection, /sign in via OAuth|OAuth sign-in/i);
});

// ─── No log/telemetry line records the request URL or its query string ──────
// (SOP step 1: "GREP for any log/telemetry line that records req.url or the
// query string -> ensure a URL credential can never be written to logs.")
// This is a structural guard: every console.log/console.error call site in
// mcp.ts is enumerated and none may reference req.url, request.url, or a raw
// query-string read. Fails loudly (listing the offending call) if a future
// edit logs the request URL directly — the class this guards is "any call
// site", not one hand-picked line.

test("STATIC: no console.log/console.error call site in mcp.ts logs req.url, request.url, or url.search", () => {
  const calls = [...mcpSrc.matchAll(/console\.(?:log|error|warn)\(([\s\S]*?)\);/g)];
  assert.ok(calls.length > 0, "sanity: mcp.ts must have at least one console call site to scan");
  const offenders = calls
    .map((m) => m[1])
    .filter((body) => /\breq\.url\b|\brequest\.url\b|\burl\.search\b|\burl\.toString\(\)/.test(body));
  assert.deepEqual(offenders, [], `console call(s) that reference the raw request URL/query string: ${JSON.stringify(offenders)}`);
});

// ─── C2 (S1-connector round 2, independent review): vercel.json's own rewrite ──
// must not synthesize a URL credential either. extractToken() ignoring `pathKey`
// (above) only closes what the APPLICATION reads — Vercel's rewrite previously
// still appended `?pathKey=<KEY>` onto the URL that reaches the function, so the
// raw key was carried in cleartext through Vercel's own routing/edge layer and
// whatever platform-level request logging it performs, outside this codebase's
// control — exactly what the connector review's "URLs end up in server logs,
// proxies, and browser history" rule targets. Fixed: the rewrite destination no
// longer appends the key.

test("STATIC: vercel.json's /:key/mcp rewrite destination no longer appends ?pathKey= (or any query string)", () => {
  const vercelJsonPath = join(__dirname, "..", "vercel.json");
  const vercelConfig = JSON.parse(readFileSync(vercelJsonPath, "utf8"));
  const rewrite = vercelConfig.rewrites.find((r) => r.source === "/:key/mcp");
  assert.ok(rewrite, "vercel.json must still have a /:key/mcp rewrite (routing — so a bookmarked URL gets a 401, not a 404)");
  assert.equal(rewrite.destination, "/api/mcp", "the rewrite destination must not carry the key forward as a query string");
  assert.doesNotMatch(rewrite.destination, /\?|pathKey/i, "rewrite destination must contain no query string and no pathKey reference");
});

test("STATIC: vercel.json has no OTHER rewrite that appends a credential-shaped query param", () => {
  const vercelJsonPath = join(__dirname, "..", "vercel.json");
  const vercelConfig = JSON.parse(readFileSync(vercelJsonPath, "utf8"));
  const offenders = vercelConfig.rewrites.filter((r) => /\?.*(apikey|api_key|token|pathkey)=/i.test(r.destination));
  assert.deepEqual(offenders, [], `rewrite(s) still synthesize a credential-shaped query param: ${JSON.stringify(offenders)}`);
});
