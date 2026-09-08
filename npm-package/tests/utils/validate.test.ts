import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import {
  formatZodIssue,
  formatZodError,
  computeUnknownKeyWarning,
  computeMissingRequiredParams,
  hasUnrecognizedKeysIssue,
  type ToolLike,
} from "../../src/utils/validate.js";
import { SearchParamsSchema, ExtractParamsSchema, VerifyParamsSchema, CrawlParamsSchema } from "../../src/tools/types.js";
import { TOOLS } from "../../src/core.js";

function zodErrorFrom(schema: z.ZodTypeAny, input: unknown): ZodError {
  try {
    schema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) return e;
    throw e;
  }
  throw new Error("expected schema.parse to throw");
}

describe("formatZodIssue — per-issue-class templates (F-12)", () => {
  it("invalid_type (missing required) -> 'Add the required parameter'", () => {
    const err = zodErrorFrom(z.object({ query: z.string() }), {});
    const text = formatZodIssue(err.issues[0]);
    expect(text).toContain("Add the required parameter query");
    expect(text).toContain("string");
  });

  it("invalid_type (wrong type present) -> 'Change ... to type ... got ...'", () => {
    const err = zodErrorFrom(z.object({ n: z.number() }), { n: "x" });
    const text = formatZodIssue(err.issues[0]);
    expect(text).toContain("Change n to type number");
    expect(text).toContain("got string");
  });

  it("invalid_value (enum) -> 'Set X to one of: ...'", () => {
    const err = zodErrorFrom(z.object({ e: z.enum(["a", "b", "c"]) }), { e: "z" });
    const text = formatZodIssue(err.issues[0]);
    expect(text).toContain("Set e to one of:");
    expect(text).toContain('"a"');
    expect(text).toContain('"b"');
    expect(text).toContain('"c"');
  });

  it("too_small (string) -> mentions minimum + characters", () => {
    const err = zodErrorFrom(z.object({ s: z.string().min(5) }), { s: "ab" });
    const text = formatZodIssue(err.issues[0]);
    expect(text).toContain("Increase s");
    expect(text).toContain("5");
    expect(text).toContain("characters");
  });

  it("too_small (array) -> mentions items", () => {
    const err = zodErrorFrom(z.object({ a: z.array(z.string()).min(2) }), { a: ["x"] });
    const text = formatZodIssue(err.issues[0]);
    expect(text).toContain("Increase a");
    expect(text).toContain("items");
  });

  it("too_big -> 'Decrease X ... at most N'", () => {
    const err = zodErrorFrom(z.object({ n: z.number().max(5) }), { n: 100 });
    const text = formatZodIssue(err.issues[0]);
    expect(text).toContain("Decrease n");
    expect(text).toContain("5");
  });

  it("unrecognized_keys -> 'Remove or rename unknown key(s)'", () => {
    const err = zodErrorFrom(z.strictObject({ a: z.string() }), { a: "x", bogus: "y" });
    const text = formatZodIssue(err.issues[0]);
    expect(text).toContain("Remove or rename unknown key(s)");
    expect(text).toContain("'bogus'");
  });

  it("invalid_union -> recovers expected types from branch issues (F-3/P3 fix)", () => {
    const err = zodErrorFrom(z.object({ u: z.union([z.string(), z.number()]) }), { u: true });
    const text = formatZodIssue(err.issues[0]);
    expect(text).toContain("Change u to one of these types:");
    expect(text).toMatch(/string/);
    expect(text).toMatch(/number/);
  });

  it("invalid_format -> mentions the format", () => {
    const err = zodErrorFrom(z.object({ url: z.string().url() }), { url: "not a url" });
    const text = formatZodIssue(err.issues[0]);
    expect(text).toContain("Fix url");
    expect(text).toContain("url");
  });

  it("custom (.refine) -> echoes the refine message", () => {
    const schema = z.object({ c: z.string() }).refine((d) => d.c.length > 5, { message: "too short", path: ["c"] });
    const err = zodErrorFrom(schema, { c: "x" });
    const text = formatZodIssue(err.issues[0]);
    expect(text).toContain("Fix c: too short");
  });

  it("root-level issue (no path) uses '(root)' as the field label", () => {
    const schema = z.object({ a: z.string() }).refine(() => false, { message: "whole object is wrong" });
    const err = zodErrorFrom(schema, { a: "x" });
    const text = formatZodIssue(err.issues[0]);
    expect(text).toContain("(root)");
  });
});

describe("formatZodError — full response text (P-4: one shared formatter)", () => {
  it("produces the 'Invalid parameters for X:' header + detail lines + one agent_instruction line", () => {
    const err = zodErrorFrom(SearchParamsSchema, {});
    const text = formatZodError("novada_search", err);
    expect(text).toContain("Invalid parameters for novada_search:");
    expect(text).toMatch(/^\s*query: /m);
    expect(text).toMatch(/^agent_instruction: /m);
    expect(text).toContain("Do NOT retry with identical params");
  });

  it("enum issues still carry the '(valid values: ...)' enrichment on the detail line", () => {
    const err = zodErrorFrom(VerifyParamsSchema, { claim: "short" }); // too_small, not enum — sanity only
    const text = formatZodError("novada_verify", err);
    expect(text).toContain("Invalid parameters for novada_verify:");
  });

  it("real F-3/P3 regression case: novada_extract {url: 12345} — agent_instruction now carries expected-type info Zod's own bare 'Invalid input' union message omits", () => {
    const err = zodErrorFrom(ExtractParamsSchema, { url: 12345 });
    const text = formatZodError("novada_extract", err);
    // Zod's own per-field detail line for a union mismatch IS the bare
    // "Invalid input" (unchanged, verbatim from Zod) — the fix is that the
    // agent_instruction line (what F-agent-first's probe P3 actually grades)
    // now recovers the real expected types from the union's branch issues.
    expect(text).toMatch(/^\s*url: Invalid input\s*$/m);
    expect(text).toMatch(/^agent_instruction: .*Change url to one of these types:/m);
  });
});

describe("F-3: safeUrl base-type message (non-union direct usage, e.g. novada_crawl's url field)", () => {
  it("a wrong-type url gets a self-contained, non-bare message even without the union-recovery path", () => {
    const err = zodErrorFrom(CrawlParamsSchema, { url: 12345 });
    const urlIssue = err.issues.find((i) => i.path.join(".") === "url");
    expect(urlIssue).toBeDefined();
    expect(urlIssue!.message).not.toBe("Invalid input");
    expect(urlIssue!.message).toContain("URL string");
  });
});

describe("hasUnrecognizedKeysIssue", () => {
  it("true when the ZodError contains an unrecognized_keys issue", () => {
    const err = zodErrorFrom(z.strictObject({ a: z.string() }), { a: "x", bogus: "y" });
    expect(hasUnrecognizedKeysIssue(err)).toBe(true);
  });

  it("false for a plain missing-required-field error", () => {
    const err = zodErrorFrom(z.object({ a: z.string() }), {});
    expect(hasUnrecognizedKeysIssue(err)).toBe(false);
  });
});

// ─── computeUnknownKeyWarning (F-2) ──────────────────────────────────────────

const FAKE_TOOLS: ToolLike[] = [
  {
    name: "novada_search",
    inputSchema: {
      properties: {
        query: {},
        engine: {},
        num: {},
        time_range: {},
        start_date: {},
        end_date: {},
      },
    },
  },
  {
    name: "novada_setup",
    inputSchema: { properties: {} },
  },
  {
    name: "novada_crawl",
    inputSchema: {
      properties: { url: {}, max_pages: {}, select_paths: {}, exclude_paths: {} },
    },
  },
  {
    // ResearchParamsSchema (tools/types.ts) is a BARE z.object — no
    // withCamelCaseAliases wrapper — so a camelCase spelling of any of these
    // multi-word keys is NOT a real accepted parameter.
    name: "novada_research",
    inputSchema: {
      properties: { question: {}, query: {}, depth: {}, focus: {}, start_date: {}, end_date: {}, time_range: {} },
    },
  },
  {
    // ScrapeParamsSchema (tools/types.ts) IS wrapped in
    // withCamelCaseAliases({ taskId: "task_id" }) — taskId is a real alias.
    name: "novada_scrape",
    inputSchema: {
      properties: { platform: {}, operation: {}, params: {}, limit: {}, task_id: {}, format: {} },
    },
  },
];

describe("computeUnknownKeyWarning (F-2)", () => {
  it("returns undefined when args is empty/undefined", () => {
    expect(computeUnknownKeyWarning("novada_search", undefined, FAKE_TOOLS)).toBeUndefined();
    expect(computeUnknownKeyWarning("novada_search", {}, FAKE_TOOLS)).toBeUndefined();
  });

  it("returns undefined when every key is declared", () => {
    expect(computeUnknownKeyWarning("novada_search", { query: "x", num: 5 }, FAKE_TOOLS)).toBeUndefined();
  });

  it("flags a genuinely unknown/typo'd key (P4c regression: 'querry' on novada_search)", () => {
    const warning = computeUnknownKeyWarning("novada_search", { querry: "typo of query" }, FAKE_TOOLS);
    expect(warning).toBeDefined();
    expect(warning).toContain("agent_instruction:");
    expect(warning).toContain("'querry'");
    expect(warning).toContain("novada_search");
  });

  it("does NOT false-positive on a mechanical camelCase alias of a declared snake_case key", () => {
    // maxPages is a real accepted alias of max_pages (withCamelCaseAliases) —
    // must NOT be reported as "unknown, had no effect".
    const warning = computeUnknownKeyWarning("novada_crawl", { url: "https://x.com", maxPages: 5 }, FAKE_TOOLS);
    expect(warning).toBeUndefined();
  });

  it("does NOT false-positive on the documented start_time/end_time -> start_date/end_date exception", () => {
    const warning = computeUnknownKeyWarning("novada_search", { query: "x", start_time: "2024-01-01" }, FAKE_TOOLS);
    expect(warning).toBeUndefined();
  });

  it("returns undefined for a tool absent from the tools list (e.g. a hidden alias)", () => {
    expect(computeUnknownKeyWarning("novada_health", { anything: 1 }, FAKE_TOOLS)).toBeUndefined();
  });

  it("names ALL unknown keys, not just the first", () => {
    const warning = computeUnknownKeyWarning("novada_search", { query: "x", foo: 1, bar: 2 }, FAKE_TOOLS);
    expect(warning).toContain("'foo'");
    expect(warning).toContain("'bar'");
  });

  // ─── F-2 false-negative fix (2026-09-03 ledger-closure, finding #5) ────────
  //
  // withCamelCaseAliases wraps a schema in z.preprocess, invisible to
  // inputSchema.properties — so the OLD "toCamelCase every declared key,
  // unconditionally" guess was accurate only for tools that actually wire
  // aliasing. novada_research({startDate}) is the ledger's concrete example:
  // ResearchParamsSchema has NO withCamelCaseAliases wrapper, so startDate is
  // not a real parameter and Zod's non-strict default silently drops it —
  // this warning is the ONLY signal the caller gets that the param had zero
  // effect.
  it("WARNS on an unaliased camelCase key (novada_research startDate — ResearchParamsSchema has no camelCase aliasing, Zod silently drops it)", () => {
    const warning = computeUnknownKeyWarning(
      "novada_research",
      { question: "What year did this happen?", startDate: "2024-01-01" },
      FAKE_TOOLS,
    );
    expect(warning).toBeDefined();
    expect(warning).toContain("'startDate'");
    expect(warning).toContain("novada_research");
  });

  it("WARNS on every unaliased camelCase key at once (endDate, timeRange — same tool, same root cause)", () => {
    const warning = computeUnknownKeyWarning(
      "novada_research",
      { question: "What year did this happen?", endDate: "2024-12-31", timeRange: "year" },
      FAKE_TOOLS,
    );
    expect(warning).toBeDefined();
    expect(warning).toContain("'endDate'");
    expect(warning).toContain("'timeRange'");
  });

  it("does NOT false-positive on a real camelCase alias (novada_scrape taskId — ScrapeParamsSchema IS wrapped in withCamelCaseAliases)", () => {
    const warning = computeUnknownKeyWarning(
      "novada_scrape",
      { platform: "amazon.com", operation: "product_by_asin", taskId: "sdk-task-123" },
      FAKE_TOOLS,
    );
    expect(warning).toBeUndefined();
  });

  it("still WARNS on a genuinely unknown key on an aliased tool (taskId known, bogus is not)", () => {
    const warning = computeUnknownKeyWarning(
      "novada_scrape",
      { platform: "amazon.com", operation: "product_by_asin", taskId: "sdk-task-123", bogus: 1 },
      FAKE_TOOLS,
    );
    expect(warning).toBeDefined();
    expect(warning).toContain("'bogus'");
    expect(warning).not.toContain("'taskId'");
  });

  it("regression guard: aliased tools (novada_search, novada_crawl) are unaffected by the alias-aware gate — still no false positive", () => {
    // Same assertions as the pre-existing "does NOT false-positive" tests
    // above, re-run here to pin that gating camelCase-guessing behind
    // CAMELCASE_ALIASED_TOOLS didn't regress the tools that DO alias.
    expect(computeUnknownKeyWarning("novada_search", { query: "x", startDate: "2024-01-01" }, FAKE_TOOLS)).toBeUndefined();
    expect(computeUnknownKeyWarning("novada_crawl", { url: "https://x.com", maxPages: 5, selectPaths: ["/docs/**"] }, FAKE_TOOLS)).toBeUndefined();
  });
});

// ─── F-2 fix — no new false-positive across the REAL, LIVE tool registry ────
//
// The fixtures above are hand-built (necessary to pin the exact bug shape),
// but CAMELCASE_ALIASED_TOOLS in src/utils/validate.ts is a hand-swept
// enumeration of tool names, not something derivable from inputSchema.
// This block cross-checks that enumeration against the REAL TOOLS registry
// (src/core.ts) so drift between the two is caught here, not in production.
describe("computeUnknownKeyWarning — no new false-positive across the REAL tool set (F-2 fix regression guard)", () => {
  it("every registered tool's own declared keys never warn against themselves", () => {
    for (const tool of TOOLS) {
      const props = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
      if (!props) continue;
      const declaredKeys = Object.keys(props);
      if (declaredKeys.length === 0) continue;
      const args = Object.fromEntries(declaredKeys.map((k) => [k, "x"]));
      const warning = computeUnknownKeyWarning(tool.name, args, TOOLS);
      expect(
        warning,
        `${tool.name}: its own declared keys ${JSON.stringify(declaredKeys)} produced a warning: ${warning}`,
      ).toBeUndefined();
    }
  });

  it("real camelCase aliases on live-registered aliased tools produce no warning", () => {
    // novada_crawl: maxPages/selectPaths/excludePaths (withCamelCaseAliases, tools/types.ts)
    expect(computeUnknownKeyWarning("novada_crawl", { url: "https://x.com", maxPages: 5 }, TOOLS)).toBeUndefined();
    // novada_map: includeSubdomains/maxDepth
    expect(computeUnknownKeyWarning("novada_map", { url: "https://x.com", includeSubdomains: true, maxDepth: 3 }, TOOLS)).toBeUndefined();
    // novada_scrape: taskId — the DE-1/C-1 money-path alias this exact class of fix protects
    expect(computeUnknownKeyWarning("novada_scrape", { platform: "amazon.com", operation: "product_by_asin", taskId: "abc" }, TOOLS)).toBeUndefined();
    // novada_scrape_amazon — one of the 15 platform_scraper.ts factory-generated tools
    expect(computeUnknownKeyWarning("novada_scrape_amazon", { operation: "product_by_asin", taskId: "abc" }, TOOLS)).toBeUndefined();
  });

  it("novada_research (a REAL, currently-unaliased tool) still WARNS on startDate against the live registry", () => {
    const warning = computeUnknownKeyWarning(
      "novada_research",
      { question: "Why did the market move in 2024?", startDate: "2024-01-01" },
      TOOLS,
    );
    expect(warning).toBeDefined();
    expect(warning).toContain("'startDate'");
  });
});

// ─── computeMissingRequiredParams (F2-3 fallback for schema-less tools) ─────

const FAKE_TOOLS_WITH_REQUIRED: ToolLike[] = [
  {
    name: "novada_scrape_amazon",
    inputSchema: { properties: { operation: {}, params: {} }, required: ["operation"] },
  },
  {
    name: "novada_research",
    inputSchema: { properties: { question: {}, query: {} }, required: [] },
  },
];

describe("computeMissingRequiredParams (F2-3)", () => {
  it("flags a missing required field", () => {
    const missing = computeMissingRequiredParams("novada_scrape_amazon", {}, FAKE_TOOLS_WITH_REQUIRED);
    expect(missing).toEqual(["operation"]);
  });

  it("returns undefined when the required field is present", () => {
    const missing = computeMissingRequiredParams(
      "novada_scrape_amazon",
      { operation: "product_by_asin" },
      FAKE_TOOLS_WITH_REQUIRED,
    );
    expect(missing).toBeUndefined();
  });

  it("returns undefined when the tool has an empty required[] (e.g. novada_research's question-OR-query)", () => {
    const missing = computeMissingRequiredParams("novada_research", {}, FAKE_TOOLS_WITH_REQUIRED);
    expect(missing).toBeUndefined();
  });

  it("returns undefined for an unknown tool", () => {
    expect(computeMissingRequiredParams("novada_nope", {}, FAKE_TOOLS_WITH_REQUIRED)).toBeUndefined();
  });
});
