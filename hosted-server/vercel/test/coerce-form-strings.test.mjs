/**
 * Form-playground stringified number/boolean coercion — HOSTED path.
 *
 * The production fix (npm-package/src/core.ts's `coerceToolArgs`, called
 * from BOTH stdio index.ts and this file's api/mcp.ts) is exhaustively
 * matrix-tested against the real stdio TOOLS catalog in npm-package's own
 * `tests/coerce-form-strings.test.ts` (49 numeric/boolean leaves across
 * every visible tool, generated from the schema, not hand-enumerated
 * guesses).
 *
 * This file proves the SAME vendored function, reached through the SAME two
 * hosted surfaces mcp.ts actually serves (default, openai — see
 * api/_surface.ts), behaves identically:
 *   1. the per-surface tool lists (built with the REAL `buildToolsForSurface`
 *      + the REAL per-surface name sets, same inputs mcp.ts's own
 *      `buildSurfaceTools` uses) still contain a non-trivial number of
 *      numeric/boolean leaves — an empty/broken surface can't pass;
 *   2. a representative cross-section of those leaves — including tools
 *      HOSTED_HIDDEN removes from "default" (novada_map, novada_proxy,
 *      novada_static_ip_mgmt) are absent from "openai" too (narrower list) —
 *      actually coerces through the vendored `coerceToolArgs` + the
 *      vendored real Zod validators, no network.
 *
 * Runs on plain Node ≥22.18 (`node --test`) — same runtime/style as
 * openai-surface.test.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { OPENAI_SURFACE_TOOLS } from "../api/_surface.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(__dirname, "..", "vendor", "novada-mcp");
const { TOOLS: CORE_TOOLS, buildToolsForSurface, coerceToolArgs } = await import(join(VENDOR, "core.js"));
const {
  validateSearchParams,
  validateExtractParams,
  validateMapParams,
  validateScrapeParams,
  validateProxyParams,
  validateAccountParams,
  validateProxyAccountListParams,
  validateStaticIpMgmtParams,
} = await import(join(VENDOR, "tools", "index.js"));

// Mirrors api/mcp.ts's own HOSTED_HIDDEN (8 names) — see that file's doc
// comment. Not exported there, so duplicated here the same way
// openai-surface.test.mjs already duplicates OPENAI_15.
const HOSTED_HIDDEN = new Set([
  "novada_browser_flow",
  "novada_browser",
  "novada_site_copy",
  "novada_ip_whitelist",
  "novada_capture_apikey",
  "novada_session_stats",
  "novada_search_feedback",
  "novada_verify",
]);

function buildHostedSurfaceTools(names) {
  return buildToolsForSurface(names, "hosted").filter((t) => names.has(t.name));
}

const HOSTED_DEFAULT_NAMES = new Set(CORE_TOOLS.map((t) => t.name).filter((n) => !HOSTED_HIDDEN.has(n)));
const HOSTED_DEFAULT_TOOLS = buildHostedSurfaceTools(HOSTED_DEFAULT_NAMES);
const OPENAI_TOOLS = buildHostedSurfaceTools(OPENAI_SURFACE_TOOLS);

// ─── 1. Non-trivial leaf count per surface (same walker shape as the
//        npm-package matrix generator — object / array-of-object / array-of-
//        discriminated-union-branch) ──────────────────────────────────────

function isNumericOrBoolean(node) {
  return node.type === "integer" || node.type === "number" || node.type === "boolean";
}

function countCoercibleLeaves(tools) {
  let count = 0;
  function walk(schema) {
    const props = schema?.properties;
    if (!props || typeof props !== "object") return;
    for (const raw of Object.values(props)) {
      if (!raw || typeof raw !== "object") continue;
      if (isNumericOrBoolean(raw)) {
        count++;
        continue;
      }
      if (raw.type === "object" && raw.properties) {
        walk(raw);
        continue;
      }
      if (raw.type === "array" && raw.items) {
        const items = raw.items;
        const branches = items.oneOf ?? items.anyOf;
        if (Array.isArray(branches)) {
          for (const b of branches) {
            const branchProps = b?.properties;
            if (!branchProps) continue;
            for (const bv of Object.values(branchProps)) {
              if (bv && typeof bv === "object" && isNumericOrBoolean(bv)) count++;
            }
          }
        } else if (items.properties) {
          walk(items);
        } else if (items && typeof items === "object" && isNumericOrBoolean(items)) {
          count++;
        }
      }
    }
  }
  for (const t of tools) walk(t.inputSchema);
  return count;
}

test("hosted default surface lists a non-trivial number of numeric/boolean leaves", () => {
  assert.ok(HOSTED_DEFAULT_TOOLS.length > 0, "hosted default surface listed zero tools");
  const n = countCoercibleLeaves(HOSTED_DEFAULT_TOOLS);
  assert.ok(n >= 20, `expected >=20 numeric/boolean leaves on hosted default, got ${n}`);
});

test("openai surface lists a non-trivial number of numeric/boolean leaves", () => {
  assert.equal(OPENAI_TOOLS.length, OPENAI_SURFACE_TOOLS.size);
  const n = countCoercibleLeaves(OPENAI_TOOLS);
  assert.ok(n >= 5, `expected >=5 numeric/boolean leaves on the openai surface, got ${n}`);
});

test("novada_map and novada_static_ip_mgmt (HOSTED_HIDDEN-adjacent but openai-excluded) are on default, absent from openai", () => {
  assert.ok(HOSTED_DEFAULT_NAMES.has("novada_map"));
  assert.ok(HOSTED_DEFAULT_NAMES.has("novada_static_ip_mgmt"));
  assert.ok(!OPENAI_SURFACE_TOOLS.has("novada_map"));
  assert.ok(!OPENAI_SURFACE_TOOLS.has("novada_static_ip_mgmt"));
});

// ─── 2. Representative coercion, through the vendored real path ───────────

for (const surfaceName of ["default", "openai"]) {
  const names = surfaceName === "default" ? HOSTED_DEFAULT_NAMES : OPENAI_SURFACE_TOOLS;

  test(`[${surfaceName}] novada_search: num "7" coerces to 7, query "7" stays the string "7"`, () => {
    if (!names.has("novada_search")) return; // not on this surface
    const coerced = coerceToolArgs("novada_search", { query: "7", num: "7" });
    assert.equal(coerced.num, 7);
    assert.equal(coerced.query, "7");
    assert.doesNotThrow(() => validateSearchParams(coerced));
  });

  test(`[${surfaceName}] novada_search: num "2.5" is left as the string "2.5" and rejected`, () => {
    if (!names.has("novada_search")) return;
    const coerced = coerceToolArgs("novada_search", { query: "q", num: "2.5" });
    assert.equal(coerced.num, "2.5");
    assert.throws(() => validateSearchParams(coerced));
  });

  test(`[${surfaceName}] novada_search: num "" (optional) is treated as omitted (default applies)`, () => {
    if (!names.has("novada_search")) return;
    const coerced = coerceToolArgs("novada_search", { query: "q", num: "" });
    assert.equal(coerced.num, undefined);
    assert.equal(validateSearchParams(coerced).num, 10);
  });

  test(`[${surfaceName}] novada_extract: max_chars "2000" coerces, "30" is clamped-reject (below min 1000)`, () => {
    if (!names.has("novada_extract")) return;
    const ok = coerceToolArgs("novada_extract", { url: "https://example.com", max_chars: "2000" });
    assert.equal(ok.max_chars, 2000);
    assert.doesNotThrow(() => validateExtractParams(ok));
    const tooSmall = coerceToolArgs("novada_extract", { url: "https://example.com", max_chars: "30" });
    assert.equal(tooSmall.max_chars, 30);
    assert.throws(() => validateExtractParams(tooSmall)); // below schema minimum — same as a real 30 would get
  });

  test(`[${surfaceName}] novada_scrape: limit "10" (string) and boolean-looking string on a string field are both handled correctly`, () => {
    if (!names.has("novada_scrape")) return;
    const coerced = coerceToolArgs("novada_scrape", { platform: "amazon.com", operation: "product_by_asin", limit: "10" });
    assert.equal(coerced.limit, 10);
    assert.equal(coerced.platform, "amazon.com"); // string field untouched
    assert.doesNotThrow(() => validateScrapeParams(coerced));
  });

  test(`[${surfaceName}] novada_account: page/page_size strings coerce; "TRUE"-shaped strings never leak onto a numeric field by accident`, () => {
    if (!names.has("novada_account")) return;
    const coerced = coerceToolArgs("novada_account", { page: "3", page_size: "25" });
    assert.equal(coerced.page, 3);
    assert.equal(coerced.page_size, 25);
    assert.doesNotThrow(() => validateAccountParams(coerced));
  });

  test(`[${surfaceName}] novada_proxy_account_list: page/limit strings coerce`, () => {
    if (!names.has("novada_proxy_account_list")) return;
    const coerced = coerceToolArgs("novada_proxy_account_list", { product: "1", page: "2", limit: "20" });
    assert.equal(coerced.page, 2);
    assert.equal(coerced.limit, 20);
    assert.doesNotThrow(() => validateProxyAccountListParams(coerced));
  });
}

// novada_proxy, novada_map, novada_static_ip_mgmt are HOSTED_HIDDEN-exempt
// but openai-excluded — only run on default.

test("[default] novada_proxy: verify \"false\"/\"TRUE\" (any case) coerce to real booleans", () => {
  const f = coerceToolArgs("novada_proxy", { verify: "false" });
  assert.equal(f.verify, false);
  assert.doesNotThrow(() => validateProxyParams(f));
  const t = coerceToolArgs("novada_proxy", { verify: "TRUE" });
  assert.equal(t.verify, true);
});

test("[default] novada_proxy: verify \"yes\" is left as the string \"yes\" and rejected", () => {
  const coerced = coerceToolArgs("novada_proxy", { verify: "yes" });
  assert.equal(coerced.verify, "yes");
  assert.throws(() => validateProxyParams(coerced));
});

test("[default] novada_map: limit/max_depth strings coerce, include_subdomains boolean string coerces", () => {
  const coerced = coerceToolArgs("novada_map", { url: "https://example.com", limit: "10", max_depth: "2", include_subdomains: "true" });
  assert.equal(coerced.limit, 10);
  assert.equal(coerced.max_depth, 2);
  assert.equal(coerced.include_subdomains, true);
  assert.doesNotThrow(() => validateMapParams(coerced));
});

test("[default] novada_static_ip_mgmt: num/page/limit/is_auto_renew strings coerce", () => {
  const coerced = coerceToolArgs("novada_static_ip_mgmt", {
    action: "list",
    page: "2",
    limit: "20",
    is_auto_renew: "1",
  });
  assert.equal(coerced.page, 2);
  assert.equal(coerced.limit, 20);
  assert.equal(coerced.is_auto_renew, 1);
  assert.doesNotThrow(() => validateStaticIpMgmtParams(coerced));
});
