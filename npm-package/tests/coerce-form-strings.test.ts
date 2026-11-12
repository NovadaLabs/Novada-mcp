/**
 * coerce-form-strings — form-playground stringified number/boolean coercion.
 *
 * Covers:
 *  1. Direct unit tests of the shared helper (src/utils/coerce-form-strings.ts)
 *     against hand-built schema fragments — every rule in its doc comment,
 *     including two cases (a REQUIRED numeric/boolean leaf, and a nullable
 *     union) that no CURRENT tool schema happens to exercise.
 *  2. A GENERATED matrix: every numeric/boolean leaf discovered by walking
 *     the real stdio `TOOLS` catalog (including nested objects and
 *     discriminated-union array items), each driven through `coerceToolArgs`
 *     and — where the tool exports a standalone validator — the REAL Zod
 *     validator, so "accepted"/"rejected" is proven against the actual
 *     contract, not a re-implementation of it.
 *  3. The mirror test: string-typed params are never touched.
 *
 * The mutation probe (temporarily disabling `coerceToolArgs` inside
 * `dispatch()`/the transport call sites and confirming this matrix fails) is
 * a manual, one-time verification step recorded in the fix's own report —
 * not a permanent part of this suite (there's no safe way to "disable the
 * fix" from inside a test without reintroducing exactly the bug this file
 * guards against on every future run).
 */
import { describe, it, expect } from "vitest";
import { coerceFormStrings } from "../src/utils/coerce-form-strings.js";
import { TOOLS, coerceToolArgs } from "../src/core.js";
import {
  validateSearchParams,
  validateExtractParams,
  validateCrawlParams,
  validateMapParams,
  validateSiteCopyParams,
  validateScrapeParams,
  validateProxyParams,
  validateBrowserParams,
  validateBrowserFlowParams,
  validateAccountParams,
  validateProxyAccountCreateParams,
  validateProxyAccountListParams,
  validateIpWhitelistParams,
  validateCaptureApikeyParams,
  validateStaticIpMgmtParams,
  validateSessionStatsParams,
} from "../src/tools/index.js";
/**
 * Captures the message of a thrown error, regardless of whether the
 * validator throws the raw ZodError (most tools) or — like
 * novada_session_stats/novada_search_feedback/novada_setup — catches its
 * OWN ZodError and rethrows a plain Error with a pre-formatted
 * agent_instruction message (see those tools' own validate*Params). Either
 * way the underlying Zod issue text ("received string", "too big", …) is
 * embedded in `.message`, which is all these tests need to assert against.
 */
function captureErrorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected function to throw, but it did not");
}

// ─── 1. Direct unit tests of the helper ────────────────────────────────────

describe("coerceFormStrings — hand-written rules", () => {
  const INT_SCHEMA = { type: "object", properties: { n: { type: "integer", minimum: 1, maximum: 20 } }, required: [] };
  const INT_REQUIRED_SCHEMA = { type: "object", properties: { n: { type: "integer" } }, required: ["n"] };
  const BOOL_SCHEMA = { type: "object", properties: { b: { type: "boolean" } }, required: [] };

  it("coerces a plain integer string", () => {
    expect(coerceFormStrings({ n: "3" }, INT_SCHEMA)).toEqual({ n: 3 });
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(coerceFormStrings({ n: " 3 " }, INT_SCHEMA)).toEqual({ n: 3 });
  });

  it("leaves a decimal string on an integer field untouched (same rejection as today)", () => {
    expect(coerceFormStrings({ n: "2.5" }, INT_SCHEMA)).toEqual({ n: "2.5" });
  });

  it("leaves a non-numeric string untouched", () => {
    expect(coerceFormStrings({ n: "abc" }, INT_SCHEMA)).toEqual({ n: "abc" });
  });

  it("leaves an out-of-range numeric string coerced to a real number (Zod's own min/max rejects it)", () => {
    expect(coerceFormStrings({ n: "30" }, INT_SCHEMA)).toEqual({ n: 30 });
  });

  it("omits an empty string on an OPTIONAL numeric field (treated as not provided)", () => {
    expect(coerceFormStrings({ n: "" }, INT_SCHEMA)).toEqual({});
  });

  it("leaves an empty string on a REQUIRED numeric field untouched (same rejection as today) — no shipped tool has a required numeric/boolean field today, so this is exercised against a synthetic schema", () => {
    expect(coerceFormStrings({ n: "" }, INT_REQUIRED_SCHEMA)).toEqual({ n: "" });
  });

  it("never touches a real number", () => {
    expect(coerceFormStrings({ n: 7 }, INT_SCHEMA)).toEqual({ n: 7 });
  });

  it("coerces 'true'/'false' in any letter case, trimmed", () => {
    expect(coerceFormStrings({ b: "true" }, BOOL_SCHEMA)).toEqual({ b: true });
    expect(coerceFormStrings({ b: "FALSE" }, BOOL_SCHEMA)).toEqual({ b: false });
    expect(coerceFormStrings({ b: " True " }, BOOL_SCHEMA)).toEqual({ b: true });
  });

  it("leaves a non-true/false string untouched for a boolean field", () => {
    expect(coerceFormStrings({ b: "yes" }, BOOL_SCHEMA)).toEqual({ b: "yes" });
  });

  it("never touches a real boolean", () => {
    expect(coerceFormStrings({ b: false }, BOOL_SCHEMA)).toEqual({ b: false });
  });

  it("recurses into a nested object property", () => {
    const schema = {
      type: "object",
      properties: { opts: { type: "object", properties: { top_n: { type: "integer" } }, required: [] } },
      required: [],
    };
    expect(coerceFormStrings({ opts: { top_n: "5" } }, schema)).toEqual({ opts: { top_n: 5 } });
  });

  it("coerces a nullable-integer union (anyOf: [integer, null]) — no shipped tool has one today", () => {
    const schema = { type: "object", properties: { n: { anyOf: [{ type: "integer" }, { type: "null" }] } }, required: [] };
    expect(coerceFormStrings({ n: "5" }, schema)).toEqual({ n: 5 });
  });

  it("never coerces a mixed (non-numeric, non-boolean) union, e.g. novada_extract's url: string|string[]", () => {
    const schema = {
      type: "object",
      properties: { u: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] } },
      required: [],
    };
    expect(coerceFormStrings({ u: "5" }, schema)).toEqual({ u: "5" });
  });

  it("picks the matching discriminated-union branch by its own const field, generically (not hardcoded to 'action')", () => {
    const schema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            oneOf: [
              { type: "object", properties: { kind: { const: "a" }, x: { type: "string" } }, required: ["kind"] },
              { type: "object", properties: { kind: { const: "b" }, y: { type: "integer" } }, required: ["kind"] },
            ],
          },
        },
      },
      required: [],
    };
    expect(coerceFormStrings({ items: [{ kind: "b", y: "9" }] }, schema)).toEqual({ items: [{ kind: "b", y: 9 }] });
    // branch "a" has no numeric field — its own string field is untouched
    expect(coerceFormStrings({ items: [{ kind: "a", x: "9" }] }, schema)).toEqual({ items: [{ kind: "a", x: "9" }] });
  });

  it("leaves a value unchanged when no branch's const matches (lets Zod report its own union error)", () => {
    const schema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { oneOf: [{ type: "object", properties: { kind: { const: "a" } }, required: ["kind"] }] },
        },
      },
      required: [],
    };
    expect(coerceFormStrings({ items: [{ kind: "nope" }] }, schema)).toEqual({ items: [{ kind: "nope" }] });
  });

  it("does not mutate its input", () => {
    const input = { n: "3" };
    coerceFormStrings(input, INT_SCHEMA);
    expect(input).toEqual({ n: "3" });
  });

  it("skips __proto__/constructor/prototype keys while copying (no prototype pollution)", () => {
    const payload = JSON.parse('{"n":"3","__proto__":{"polluted":true}}');
    const result = coerceFormStrings(payload, INT_SCHEMA) as Record<string, unknown>;
    expect(result.n).toBe(3);
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false);
  });

  it("does not attempt to parse an absurdly long numeric-looking string (bounded work)", () => {
    const long = "1".repeat(64);
    expect(coerceFormStrings({ n: long }, INT_SCHEMA)).toEqual({ n: long });
  });

  it("passes through non-object/array values untouched", () => {
    expect(coerceFormStrings(undefined, INT_SCHEMA)).toBeUndefined();
    expect(coerceFormStrings(null, INT_SCHEMA)).toBeNull();
    expect(coerceFormStrings("x", INT_SCHEMA)).toBe("x");
  });

  it("passes through when schema has no usable shape", () => {
    expect(coerceFormStrings({ n: "3" }, undefined)).toEqual({ n: "3" });
    expect(coerceFormStrings({ n: "3" }, { type: "string" })).toEqual({ n: "3" });
  });
});

// ─── coerceToolArgs — the dispatch()-facing wrapper ─────────────────────────

describe("coerceToolArgs", () => {
  it("coerces against the named tool's real advertised schema", () => {
    expect(coerceToolArgs("novada_search", { query: "x", num: "5" })).toEqual({ query: "x", num: 5 });
  });

  it("passes args through unchanged for a name with no schema entry (legacy remap-only alias)", () => {
    const args = { max_chars: "5000" };
    expect(coerceToolArgs("novada_unblock", args)).toEqual(args);
  });

  it("passes undefined through unchanged", () => {
    expect(coerceToolArgs("novada_search", undefined)).toBeUndefined();
  });
});

// ─── 2 + 3. Generated matrix + mirror test, driven from the real TOOLS catalog ──

/** Minimal valid args satisfying each tool's OWN required fields (verified by
 *  actually running every validator against its row, see sanity block below) —
 *  NOT used by the 15 novada_scrape_<platform> tools below (no standalone
 *  validator exists for those; coercion is checked directly, independent of
 *  whether the rest of the args object is valid). */
const BASELINES: Record<string, Record<string, unknown>> = {
  novada_search: { query: "test query" },
  novada_extract: { url: "https://example.com" },
  novada_crawl: { url: "https://example.com" },
  novada_map: { url: "https://example.com" },
  novada_site_copy: { url: "https://example.com" },
  novada_scrape: { platform: "amazon.com", operation: "product_by_asin" },
  novada_proxy: {},
  novada_browser: { actions: [{ action: "wait", ms: 1000 }] },
  novada_browser_flow: { url: "https://example.com", actions: [{ type: "wait", delay: 1000 }] },
  novada_account: {},
  novada_proxy_account_create: { product: "1", account: "test_account", password: "password123" },
  novada_proxy_account_list: { product: "1" },
  novada_ip_whitelist: { action: "list", product: "1" },
  novada_capture_apikey: { action: "get" },
  novada_static_ip_mgmt: { action: "list" },
  novada_session_stats: {},
};

/** Every tool with a hand-curated baseline above is sanity-checked (once, at
 *  module load) to actually be valid against its own real validator — a typo
 *  in BASELINES fails LOUDLY here instead of silently weakening every test
 *  that builds on it. */
const BASELINE_VALIDATORS: Record<string, (args: unknown) => unknown> = {
  novada_search: validateSearchParams,
  novada_extract: validateExtractParams,
  novada_crawl: validateCrawlParams,
  novada_map: validateMapParams,
  novada_site_copy: validateSiteCopyParams,
  novada_scrape: validateScrapeParams,
  novada_proxy: validateProxyParams,
  novada_browser: validateBrowserParams,
  novada_browser_flow: validateBrowserFlowParams,
  novada_account: validateAccountParams,
  novada_proxy_account_create: validateProxyAccountCreateParams,
  novada_proxy_account_list: validateProxyAccountListParams,
  novada_ip_whitelist: validateIpWhitelistParams,
  novada_capture_apikey: validateCaptureApikeyParams,
  novada_static_ip_mgmt: validateStaticIpMgmtParams,
  novada_session_stats: validateSessionStatsParams,
};

describe("BASELINES sanity (every baseline is independently valid)", () => {
  for (const [tool, validator] of Object.entries(BASELINE_VALIDATORS)) {
    it(`${tool}'s baseline validates cleanly`, () => {
      expect(() => validator(BASELINES[tool])).not.toThrow();
    });
  }
});

type JsonSchemaNode = Record<string, unknown>;

function toolSchema(tool: string): JsonSchemaNode {
  const t = TOOLS.find((x) => x.name === tool);
  if (!t) throw new Error(`tool not in TOOLS (stdio catalog): ${tool}`);
  return t.inputSchema;
}

function propAt(tool: string, path: string[]): JsonSchemaNode {
  let node = toolSchema(tool);
  for (const seg of path) node = (node.properties as Record<string, JsonSchemaNode>)[seg];
  return node;
}

/** A valid numeric string strictly inside [minimum ?? exclusiveMinimum+1 ?? 0,
 *  maximum ?? +∞) — derived from the REAL schema node, never a hardcoded
 *  magic number, so it stays correct if a field's bounds change. */
function pickValid(node: JsonSchemaNode): string {
  const lo =
    typeof node.minimum === "number"
      ? node.minimum
      : typeof node.exclusiveMinimum === "number"
        ? node.exclusiveMinimum + 1
        : 0;
  const hi = typeof node.maximum === "number" ? node.maximum : lo + 1000;
  return String(Math.max(lo, Math.min(hi, lo + 1)));
}

/** One past the real declared `maximum`, if any — undefined when the field
 *  has no upper bound (nothing to test out-of-range against). */
function pickOutOfRange(node: JsonSchemaNode): string | undefined {
  return typeof node.maximum === "number" ? String(node.maximum + 1) : undefined;
}

interface LeafCase {
  label: string;
  tool: string;
  kind: "integer" | "boolean";
  buildArgs: (value: unknown) => Record<string, unknown>;
  readLeaf: (args: Record<string, unknown>) => unknown;
  validator?: (args: unknown) => unknown;
  validInt?: string;
  outOfRange?: string;
  /** This boolean field is a deprecated `z.literal(true)` ("const": true in
   *  its advertised schema) — "false" coerces structurally (boolean) but is
   *  then correctly rejected by Zod's const check, same as a REAL `false`
   *  gets today. */
  constTrueOnly?: boolean;
}

function flatLeaf(
  tool: string,
  key: string,
  kind: "integer" | "boolean",
  validator?: (args: unknown) => unknown,
  opts: { constTrueOnly?: boolean } = {},
): LeafCase {
  const node = propAt(tool, [key]);
  const baseline = BASELINES[tool] ?? {};
  return {
    label: `${tool}.${key}`,
    tool,
    kind,
    validator,
    constTrueOnly: opts.constTrueOnly,
    buildArgs: (v) => ({ ...baseline, [key]: v }),
    readLeaf: (args) => args[key],
    validInt: kind === "integer" ? pickValid(node) : undefined,
    outOfRange: kind === "integer" ? pickOutOfRange(node) : undefined,
  };
}

function nestedLeaf(
  tool: string,
  parentKey: string,
  key: string,
  kind: "integer" | "boolean",
  validator?: (args: unknown) => unknown,
): LeafCase {
  const node = propAt(tool, [parentKey, key]);
  const baseline = BASELINES[tool] ?? {};
  return {
    label: `${tool}.${parentKey}.${key}`,
    tool,
    kind,
    validator,
    buildArgs: (v) => ({
      ...baseline,
      [parentKey]: { ...((baseline[parentKey] as Record<string, unknown>) ?? {}), [key]: v },
    }),
    readLeaf: (args) => (args[parentKey] as Record<string, unknown> | undefined)?.[key],
    validInt: kind === "integer" ? pickValid(node) : undefined,
    outOfRange: kind === "integer" ? pickOutOfRange(node) : undefined,
  };
}

/** novada_browser's actions[] is a Zod discriminatedUnion (JSON Schema
 *  oneOf) — only its "wait" branch (ms/timeout, both [100,30000]) declares
 *  a numeric field. */
function browserWaitLeaf(key: "ms" | "timeout"): LeafCase {
  return {
    label: `novada_browser.actions[].(wait).${key}`,
    tool: "novada_browser",
    kind: "integer",
    validator: validateBrowserParams,
    buildArgs: (v) => ({ actions: [{ action: "wait", [key]: v }] }),
    readLeaf: (args) => (args.actions as Array<Record<string, unknown>>)[0][key],
    validInt: "500",
    outOfRange: "99999",
  };
}

/** novada_browser_flow's actions[] items are a plain (non-union) object;
 *  "delay" ([0,30000]) is its only numeric field. */
function browserFlowDelayLeaf(): LeafCase {
  return {
    label: "novada_browser_flow.actions[].delay",
    tool: "novada_browser_flow",
    kind: "integer",
    validator: validateBrowserFlowParams,
    buildArgs: (v) => ({ url: "https://example.com", actions: [{ type: "wait", delay: v }] }),
    readLeaf: (args) => (args.actions as Array<Record<string, unknown>>)[0].delay,
    validInt: "500",
    outOfRange: "99999",
  };
}

/** The 15 novada_scrape_<platform> tools (plus the generic novada_scrape)
 *  share one shape at the top: `limit` is their only numeric/boolean field. */
const SCRAPE_PLATFORM_TOOLS = [
  "novada_scrape_amazon",
  "novada_scrape_google",
  "novada_scrape_bing",
  "novada_scrape_duckduckgo",
  "novada_scrape_yandex",
  "novada_scrape_youtube",
  "novada_scrape_instagram",
  "novada_scrape_facebook",
  "novada_scrape_tiktok",
  "novada_scrape_x",
  "novada_scrape_walmart",
  "novada_scrape_linkedin",
  "novada_scrape_github",
  "novada_scrape_perplexity",
];

const LEAF_CASES: LeafCase[] = [
  flatLeaf("novada_search", "num", "integer", validateSearchParams),
  flatLeaf("novada_search", "exclude_social", "boolean", validateSearchParams),
  flatLeaf("novada_search", "enrich_top", "boolean", validateSearchParams),
  nestedLeaf("novada_search", "extract_options", "max_chars", "integer", validateSearchParams),
  nestedLeaf("novada_search", "extract_options", "top_n", "integer", validateSearchParams),
  flatLeaf("novada_extract", "max_chars", "integer", validateExtractParams),
  flatLeaf("novada_extract", "wait_ms", "integer", validateExtractParams),
  flatLeaf("novada_extract", "clean", "boolean", validateExtractParams),
  flatLeaf("novada_crawl", "max_pages", "integer", validateCrawlParams),
  flatLeaf("novada_map", "limit", "integer", validateMapParams),
  flatLeaf("novada_map", "include_subdomains", "boolean", validateMapParams),
  flatLeaf("novada_map", "max_depth", "integer", validateMapParams),
  flatLeaf("novada_site_copy", "max_pages", "integer", validateSiteCopyParams),
  flatLeaf("novada_site_copy", "max_depth", "integer", validateSiteCopyParams),
  flatLeaf("novada_site_copy", "include_subdomains", "boolean", validateSiteCopyParams),
  flatLeaf("novada_scrape", "limit", "integer", validateScrapeParams),
  ...SCRAPE_PLATFORM_TOOLS.map((tool) => flatLeaf(tool, "limit", "integer")), // no standalone validator — coercion-only
  flatLeaf("novada_proxy", "verify", "boolean", validateProxyParams),
  browserWaitLeaf("ms"),
  browserWaitLeaf("timeout"),
  flatLeaf("novada_browser", "timeout", "integer", validateBrowserParams),
  browserFlowDelayLeaf(),
  flatLeaf("novada_account", "page", "integer", validateAccountParams),
  flatLeaf("novada_account", "page_size", "integer", validateAccountParams),
  flatLeaf("novada_proxy_account_create", "confirm", "boolean", validateProxyAccountCreateParams, { constTrueOnly: true }),
  flatLeaf("novada_proxy_account_list", "page", "integer", validateProxyAccountListParams),
  flatLeaf("novada_proxy_account_list", "limit", "integer", validateProxyAccountListParams),
  flatLeaf("novada_ip_whitelist", "lock", "integer", validateIpWhitelistParams),
  flatLeaf("novada_ip_whitelist", "confirm", "boolean", validateIpWhitelistParams, { constTrueOnly: true }),
  flatLeaf("novada_capture_apikey", "confirm", "boolean", validateCaptureApikeyParams, { constTrueOnly: true }),
  flatLeaf("novada_static_ip_mgmt", "num", "integer", validateStaticIpMgmtParams),
  flatLeaf("novada_static_ip_mgmt", "page", "integer", validateStaticIpMgmtParams),
  flatLeaf("novada_static_ip_mgmt", "limit", "integer", validateStaticIpMgmtParams),
  flatLeaf("novada_static_ip_mgmt", "is_auto_renew", "integer", validateStaticIpMgmtParams),
  flatLeaf("novada_static_ip_mgmt", "confirm", "boolean", validateStaticIpMgmtParams, { constTrueOnly: true }),
  flatLeaf("novada_session_stats", "recent_limit", "integer", validateSessionStatsParams),
];

/**
 * Independently re-derives "how many numeric/boolean leaves does the real
 * stdio TOOLS catalog declare" by walking the schema, the SAME shapes
 * LEAF_CASES above was built from (flat, nested object, array of
 * discriminated-union object branches, array of a plain object). This is
 * NOT a copy of coerce-form-strings.ts's internals — it is a test-only
 * discovery pass — but it lets the "non-trivial matrix" assertion below
 * catch the real failure mode: an empty/near-empty LEAF_CASES list, OR
 * LEAF_CASES silently drifting out of sync with the real schema (a new
 * numeric field added to a tool with no matching LEAF_CASES entry).
 */
function countCoercibleLeaves(): number {
  function asObj(v: unknown): JsonSchemaNode | undefined {
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonSchemaNode) : undefined;
  }
  function isNumericOrBoolean(node: JsonSchemaNode): boolean {
    return node.type === "integer" || node.type === "number" || node.type === "boolean";
  }
  let count = 0;
  function walk(schema: JsonSchemaNode) {
    const props = asObj(schema.properties);
    if (!props) return;
    for (const raw of Object.values(props)) {
      const node = asObj(raw);
      if (!node) continue;
      if (isNumericOrBoolean(node)) {
        count++;
        continue;
      }
      if (node.type === "object" && node.properties) {
        walk(node);
        continue;
      }
      if (node.type === "array") {
        const items = asObj(node.items);
        if (!items) continue;
        const branches = (items.oneOf ?? items.anyOf) as unknown[] | undefined;
        if (Array.isArray(branches)) {
          for (const b of branches) {
            const branch = asObj(b);
            const branchProps = branch && asObj(branch.properties);
            if (!branchProps) continue;
            for (const bv of Object.values(branchProps)) {
              const bn = asObj(bv);
              if (bn && isNumericOrBoolean(bn)) count++;
            }
          }
        } else if (items.properties) {
          walk(items);
        } else if (isNumericOrBoolean(items)) {
          count++;
        }
      }
    }
  }
  for (const tool of TOOLS) walk(tool.inputSchema);
  return count;
}

describe("generated coercion matrix (stdio TOOLS catalog)", () => {
  it("discovers a non-trivial number of numeric/boolean leaves (an empty generator can't pass)", () => {
    const discovered = countCoercibleLeaves();
    expect(discovered).toBeGreaterThanOrEqual(30);
    // LEAF_CASES is hand-built from the SAME real schema shapes; if a tool
    // gains a new numeric/boolean field, this catches the drift (discovered
    // count rises) rather than silently leaving it untested.
    expect(LEAF_CASES.length).toBe(discovered);
  });

  for (const leaf of LEAF_CASES) {
    describe(leaf.label, () => {
      if (leaf.kind === "integer") {
        const valid = leaf.validInt!;

        it(`"${valid}" is accepted as the number ${valid}`, () => {
          const coerced = coerceToolArgs(leaf.tool, leaf.buildArgs(valid));
          expect(leaf.readLeaf(coerced!)).toBe(Number(valid));
          if (leaf.validator) expect(() => leaf.validator!(coerced)).not.toThrow();
        });

        it(`" ${valid} " (padded) is accepted as the number ${valid}`, () => {
          const coerced = coerceToolArgs(leaf.tool, leaf.buildArgs(` ${valid} `));
          expect(leaf.readLeaf(coerced!)).toBe(Number(valid));
        });

        it('"2.5" is rejected — same error as a real string, never silently coerced', () => {
          const coerced = coerceToolArgs(leaf.tool, leaf.buildArgs("2.5"));
          expect(leaf.readLeaf(coerced!)).toBe("2.5");
          if (leaf.validator) {
            expect(captureErrorMessage(() => leaf.validator!(coerced))).toMatch(/received string/i);
          }
        });

        it('"abc" is rejected unchanged', () => {
          const coerced = coerceToolArgs(leaf.tool, leaf.buildArgs("abc"));
          expect(leaf.readLeaf(coerced!)).toBe("abc");
          if (leaf.validator) expect(() => leaf.validator!(coerced)).toThrow();
        });

        it('"" on this optional field is treated as omitted', () => {
          const coerced = coerceToolArgs(leaf.tool, leaf.buildArgs(""));
          expect(leaf.readLeaf(coerced!)).toBeUndefined();
          if (leaf.validator) expect(() => leaf.validator!(coerced)).not.toThrow();
        });

        it("a real number is never touched", () => {
          const coerced = coerceToolArgs(leaf.tool, leaf.buildArgs(Number(valid)));
          expect(leaf.readLeaf(coerced!)).toBe(Number(valid));
        });

        if (leaf.outOfRange) {
          it(`an out-of-range string ("${leaf.outOfRange}") is rejected with the SAME error a real out-of-range number gets`, () => {
            const stringArgs = leaf.buildArgs(leaf.outOfRange);
            const realArgs = leaf.buildArgs(Number(leaf.outOfRange));
            const coercedFromString = coerceToolArgs(leaf.tool, stringArgs);
            expect(leaf.readLeaf(coercedFromString!)).toBe(Number(leaf.outOfRange));
            if (leaf.validator) {
              const stringMsg = captureErrorMessage(() => leaf.validator!(coercedFromString));
              const realMsg = captureErrorMessage(() => leaf.validator!(realArgs));
              expect(stringMsg).toBe(realMsg);
            }
          });
        }
      } else {
        it('"TRUE" (any case) is accepted as boolean true', () => {
          const coerced = coerceToolArgs(leaf.tool, leaf.buildArgs("TRUE"));
          expect(leaf.readLeaf(coerced!)).toBe(true);
          if (leaf.validator) expect(() => leaf.validator!(coerced)).not.toThrow();
        });

        it('" false " (padded, lowercase) is accepted as boolean false', () => {
          const coerced = coerceToolArgs(leaf.tool, leaf.buildArgs(" false "));
          expect(leaf.readLeaf(coerced!)).toBe(false);
          if (leaf.validator) {
            if (leaf.constTrueOnly) {
              // structurally coerced to a real boolean, then correctly
              // rejected by Zod's own `z.literal(true)` check — the SAME
              // rejection a real `false` gets today.
              expect(() => leaf.validator!(coerced)).toThrow();
              expect(() => leaf.validator!(leaf.buildArgs(false))).toThrow();
            } else {
              expect(() => leaf.validator!(coerced)).not.toThrow();
            }
          }
        });

        it('"yes" is rejected unchanged', () => {
          const coerced = coerceToolArgs(leaf.tool, leaf.buildArgs("yes"));
          expect(leaf.readLeaf(coerced!)).toBe("yes");
          if (leaf.validator) expect(() => leaf.validator!(coerced)).toThrow();
        });

        it('"" on this optional field is treated as omitted', () => {
          const coerced = coerceToolArgs(leaf.tool, leaf.buildArgs(""));
          expect(leaf.readLeaf(coerced!)).toBeUndefined();
          if (leaf.validator) expect(() => leaf.validator!(coerced)).not.toThrow();
        });

        it("a real boolean is never touched", () => {
          const coerced = coerceToolArgs(leaf.tool, leaf.buildArgs(true));
          expect(leaf.readLeaf(coerced!)).toBe(true);
        });
      }
    });
  }
});

// ─── Mirror test: STRING params are never coerced ──────────────────────────

describe("mirror test — string-typed params are never coerced", () => {
  it("novada_search's query stays the string \"3\" even though num:\"3\" is coerced", () => {
    const coerced = coerceToolArgs("novada_search", { query: "3", num: "3" }) as Record<string, unknown>;
    expect(coerced.query).toBe("3");
    expect(coerced.num).toBe(3);
  });

  it("an enum-typed param ('engine') is never touched", () => {
    const coerced = coerceToolArgs("novada_search", { query: "x", engine: "google" }) as Record<string, unknown>;
    expect(coerced.engine).toBe("google");
  });

  it("a format:'uri' param ('url') is never touched, even for novada_extract's string|string[] union", () => {
    const coerced = coerceToolArgs("novada_extract", { url: "3" }) as Record<string, unknown>;
    expect(coerced.url).toBe("3");
  });

  it("platform/operation (plain strings with a regex pattern, not numeric/boolean) are never touched", () => {
    const coerced = coerceToolArgs("novada_scrape", { platform: "3", operation: "3" }) as Record<string, unknown>;
    expect(coerced.platform).toBe("3");
    expect(coerced.operation).toBe("3");
  });

  it("every discovered numeric/boolean leaf's sibling string fields in its own baseline are untouched", () => {
    // Generic sweep: every tool in LEAF_CASES, run through coercion with its
    // baseline unmodified — any string field in the baseline must come back
    // byte-identical.
    for (const tool of new Set(LEAF_CASES.map((l) => l.tool))) {
      const baseline = BASELINES[tool];
      if (!baseline) continue; // the 15 scrape_<platform> tools have no baseline — nothing string-typed to assert here
      const coerced = coerceToolArgs(tool, baseline) as Record<string, unknown>;
      for (const [k, v] of Object.entries(baseline)) {
        if (typeof v === "string") expect(coerced[k]).toBe(v);
      }
    }
  });
});
