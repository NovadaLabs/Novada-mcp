/**
 * Query-param auth naming: canonical ?apikey= with ?api_key= + legacy ?token= aliases.
 *
 * Owner decision (2026-07-31): the hosted MCP endpoint unifies its query-param key
 * name to `apikey` (matches the NOVADA_API_KEY brand). The server must ACCEPT the
 * whole class of names — apikey, api_key (novada-web parity), and the legacy token —
 * so no pre-existing `?token=` link breaks, while UI/docs only ever show `apikey`.
 *
 * Static source-assertion (same style as caller-key.test.mjs): guards api/mcp.ts
 * against a regression that drops an accepted alias or reintroduces `?token=` in a
 * user-facing message, without needing a TS loader in CI. `extractToken` is not
 * exported, so we assert on the shipped source text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_TS = join(__dirname, "..", "api", "mcp.ts");
const src = readFileSync(MCP_TS, "utf8");

// The whole class of accepted query-param names must be read — extending coverage
// is a new row here, never a new branch elsewhere.
const ACCEPTED_QUERY_NAMES = ["apikey", "api_key", "token"];

test("extractToken reads every accepted query-param name (apikey, api_key, legacy token)", () => {
  for (const name of ACCEPTED_QUERY_NAMES) {
    assert.match(
      src,
      new RegExp(`searchParams\\.get\\("${name}"\\)`),
      `extractToken must read ?${name}= (accepted auth query-param class member)`
    );
  }
});

test("query aliases resolve in documented order: apikey → api_key → token", () => {
  const idxApikey = src.indexOf('searchParams.get("apikey")');
  const idxApiKey = src.indexOf('searchParams.get("api_key")');
  const idxToken = src.indexOf('searchParams.get("token")');
  assert.ok(idxApikey >= 0 && idxApiKey >= 0 && idxToken >= 0, "all three alias reads must exist");
  // Order the whole chain, not just the endpoints — a reorder that keeps apikey
  // first but swaps api_key/token would silently break the documented precedence.
  assert.ok(idxApikey < idxApiKey, "canonical apikey must be resolved before api_key");
  assert.ok(idxApiKey < idxToken, "api_key must be resolved before the legacy token alias");
});

test("user-facing 401 messages tell the caller to pass ?apikey= (not ?token=)", () => {
  assert.match(src, /Pass your own Novada API key as \?apikey=YOUR_KEY/,
    "MISSING_TOKEN message must instruct ?apikey=");
  assert.match(src, /Pass your own key as \?apikey=YOUR_KEY/,
    "empty-key message must instruct ?apikey=");
  assert.match(src, /from your Novada account\) as the apikey\./,
    "invalid-format message must call the credential the apikey, not the token");
  assert.doesNotMatch(src, /Pass your own (Novada API key|key) as \?token=/,
    "no user-facing 401 message may still instruct the legacy ?token=");
  assert.doesNotMatch(src, /account\) as the token\./,
    "no user-facing 401 message may still call the credential 'the token'");
});
