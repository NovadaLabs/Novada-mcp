/**
 * NOV-673 contract tests: schema/contract fixes from Group A red-team findings.
 *
 * Tests cover:
 *  1. zodToMcpSchema: defaulted params NOT in required[] (~25 tools)
 *  2. novada_monitor + novada_verify: idempotentHint === false
 *  3. novada_crawl: mode/limit aliases are dead — runtime uses strategy/max_pages directly
 *  4. Global ZodError handler: response text contains agent_instruction
 *
 * No network calls. All pure schema/AST/unit tests.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z, ZodError } from "zod";
import {
  CrawlParamsSchema,
  validateCrawlParams,
} from "../../src/tools/types.js";
// F-12 (2026-09-02 audit fix): index.ts's ZodError handling was rewritten to
// route through this ONE shared formatter (per-issue-class agent_instruction
// templates) instead of a single generic string repeated for every failure
// shape. Import the REAL production function so section 4 below exercises
// the actual contract, not a copy of it.
import { formatZodError } from "../../src/utils/validate.js";
// TOOLS is the real, built tool catalog (name/title/description/inputSchema/
// annotations) — importing it and reading .annotations directly is robust to
// any description/title-length change, unlike the previous fixed-char-window
// text scrape over core.ts source (which broke the moment a benign edit pushed
// the annotations block past the window). Already proven safe to import in a
// vitest unit test elsewhere (tests/tools/collision-matrix.test.ts).
import { TOOLS } from "../../src/core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Helper: read src/index.ts as text (importing it boots a stdio server) ───

function readIndexSrc(): string {
  return readFileSync(resolve(__dirname, "../../src/index.ts"), "utf8");
}

// ─── Helper: invoke zodToMcpSchema via the schema's .toJSONSchema() + the
//     same filtering logic as the real function (test by re-applying). ─────────

// We can't import zodToMcpSchema (it's not exported), but we CAN call the
// same Zod API ourselves and apply the same filtering logic. We test the
// CONTRACT guarantee by calling the schema's toJSONSchema() and filtering
// required[] the same way zodToMcpSchema does, then checking the output.
function applyZodToMcpSchema(schema: { toJSONSchema: () => Record<string, unknown> }): Record<string, unknown> {
  const jsonSchema = schema.toJSONSchema();
  const { $schema, $defs, additionalProperties: _ap, ...rest } = jsonSchema as Record<string, unknown>;
  const props = rest.properties as Record<string, Record<string, unknown>> | undefined;
  if (props && Array.isArray(rest.required)) {
    rest.required = (rest.required as string[]).filter(
      (key: string) => !(props[key] && "default" in props[key])
    );
  }
  return rest;
}

// ─── 1. required[] accuracy: no defaulted field appears in required[] ─────────

describe("zodToMcpSchema — required[] excludes defaulted params", () => {
  it("CrawlParamsSchema: max_pages, strategy, format, render have defaults → must NOT be in required[]", () => {
    const mcpSchema = applyZodToMcpSchema(CrawlParamsSchema);
    const required = (mcpSchema.required ?? []) as string[];

    // These all have .default() in CrawlParamsSchema
    expect(required).not.toContain("max_pages");
    expect(required).not.toContain("strategy");
    expect(required).not.toContain("format");
    expect(required).not.toContain("render");
  });

  it("CrawlParamsSchema: url (no default) must remain in required[]", () => {
    const mcpSchema = applyZodToMcpSchema(CrawlParamsSchema);
    const required = (mcpSchema.required ?? []) as string[];
    expect(required).toContain("url");
  });

  it("CrawlParamsSchema: additionalProperties key absent (no false contract)", () => {
    const mcpSchema = applyZodToMcpSchema(CrawlParamsSchema);
    expect(mcpSchema).not.toHaveProperty("additionalProperties");
  });

  it("CrawlParamsSchema: dead alias 'limit' no longer declared in schema properties", () => {
    const mcpSchema = applyZodToMcpSchema(CrawlParamsSchema);
    const props = mcpSchema.properties as Record<string, unknown> | undefined;
    expect(props).not.toHaveProperty("limit");
  });

  it("CrawlParamsSchema: dead alias 'mode' no longer declared in schema properties", () => {
    const mcpSchema = applyZodToMcpSchema(CrawlParamsSchema);
    const props = mcpSchema.properties as Record<string, unknown> | undefined;
    expect(props).not.toHaveProperty("mode");
  });

  it("CrawlParamsSchema: canonical 'max_pages' and 'strategy' still declared", () => {
    const mcpSchema = applyZodToMcpSchema(CrawlParamsSchema);
    const props = mcpSchema.properties as Record<string, unknown> | undefined;
    expect(props).toHaveProperty("max_pages");
    expect(props).toHaveProperty("strategy");
  });
});

// ─── 2. idempotentHint: novada_monitor and novada_verify must be false ────────

describe("annotations — idempotentHint truthfulness", () => {
  it("novada_monitor has idempotentHint:false (stateful store)", () => {
    const tool = TOOLS.find(t => t.name === "novada_monitor");
    expect(tool).toBeDefined();
    expect(tool!.annotations.idempotentHint).toBe(false);
  });

  it("novada_verify has idempotentHint:false (non-deterministic live searches)", () => {
    const tool = TOOLS.find(t => t.name === "novada_verify");
    expect(tool).toBeDefined();
    expect(tool!.annotations.idempotentHint).toBe(false);
  });
});

// ─── 3. crawl.ts: mode/limit dead aliases — runtime uses canonical fields ─────

describe("novadaCrawl — mode/limit aliases removed from runtime", () => {
  it("crawl.ts does NOT use params.limit as a fallback for max_pages in executable code", () => {
    const crawlSrc = readFileSync(
      resolve(__dirname, "../../src/tools/crawl.ts"),
      "utf8"
    );
    // Strip single-line comments before checking — the fix comment documents the old
    // pattern by name, so a raw text search would match the comment, not live code.
    const codeOnly = crawlSrc.replace(/\/\/.*/g, "");
    expect(codeOnly).not.toMatch(/params\.max_pages\s*\?\?\s*params\.limit/);
  });

  it("crawl.ts does NOT use params.mode as a fallback for strategy in executable code", () => {
    const crawlSrc = readFileSync(
      resolve(__dirname, "../../src/tools/crawl.ts"),
      "utf8"
    );
    const codeOnly = crawlSrc.replace(/\/\/.*/g, "");
    expect(codeOnly).not.toMatch(/params\.strategy\s*\?\?\s*params\.mode/);
  });

  it("validateCrawlParams: max_pages defaults to 5 when omitted", () => {
    const params = validateCrawlParams({ url: "https://example.com" });
    expect(params.max_pages).toBe(5);
  });

  it("validateCrawlParams: strategy defaults to 'bfs' when omitted", () => {
    const params = validateCrawlParams({ url: "https://example.com" });
    expect(params.strategy).toBe("bfs");
  });

  it("validateCrawlParams: explicit strategy:'dfs' is preserved", () => {
    const params = validateCrawlParams({ url: "https://example.com", strategy: "dfs" });
    expect(params.strategy).toBe("dfs");
  });

  it("validateCrawlParams: explicit max_pages:10 is preserved", () => {
    const params = validateCrawlParams({ url: "https://example.com", max_pages: 10 });
    expect(params.max_pages).toBe(10);
  });
});

// ─── 4. Global ZodError handler: response contains agent_instruction ──────────
//
// 2026-09-02 audit (F-12): the old assertions here pinned the DEAD generic
// literal `agent_instruction: Fix the parameter(s) listed above and retry...`
// — the exact one-size-fits-all template F-12 was scoped to replace with
// per-issue-class instructions (missing param / wrong type / bad enum /
// too-short / unknown key / union mismatch each get their own wording now,
// see utils/validate.ts formatZodIssue). Pinning that literal string made
// this "contract" test assert the OLD, explicitly-defective behavior instead
// of the underlying guarantee (NOV-673: schema/validation errors must be
// agent-actionable). Rewritten to assert the STRUCTURAL contract instead:
//   (a) the real, production formatZodError() function — the one index.ts's
//       ZodError handlers actually call — always emits a line-anchored
//       `agent_instruction:` line with per-issue-class (not generic) content;
//   (b) index.ts's global dispatch ZodError handler is WIRED to that shared
//       formatter (not a private/inline/bare-string variant), and still
//       returns isError:true.
// A future regression that drops agent_instruction from formatZodError(), or
// that reverts index.ts to formatting ZodErrors inline instead of through
// the shared formatter, fails this test.

describe("Global ZodError handler — agent_instruction in error response", () => {
  it("formatZodError() (the function index.ts's ZodError handlers call) emits a line-anchored agent_instruction with per-issue-class content, not the old generic template", () => {
    // A missing-required-field ZodError — the P1-style case.
    let err: ZodError;
    try {
      z.object({ query: z.string() }).parse({});
      throw new Error("expected schema.parse to throw");
    } catch (e) {
      if (!(e instanceof ZodError)) throw e;
      err = e;
    }

    const text = formatZodError("novada_test_tool", err);

    // (a) The agent_instruction line exists and is machine-parseable —
    // this is the actual NOV-673 guarantee, independent of wording.
    expect(text).toMatch(/^agent_instruction:/m);

    // (b) It is per-issue-class specific (F-12), not the retired generic
    // paragraph — a regression back to the one-size-fits-all template
    // must fail this test.
    expect(text).not.toContain("Fix the parameter(s) listed above and retry");
    expect(text).toMatch(/agent_instruction:.*Add the required parameter query/);
  });

  it("index.ts's global dispatch ZodError handler calls the shared formatZodError() and still returns isError: true", () => {
    const src = readIndexSrc();

    // Structural wiring check: the global handler's `error instanceof
    // ZodError` branch must invoke the shared formatter (not format the
    // error inline/bare) — anchors on the actual call site, not on any
    // particular instruction wording.
    const handlerMatch = src.match(/if \(error instanceof ZodError\) \{[\s\S]{0,400}?formatZodError\(name, error\)[\s\S]{0,400}?\}/);
    expect(handlerMatch, "expected the global ZodError branch to call formatZodError(name, error)").not.toBeNull();

    // isError:true check anchored on the unique formatZodError(name, error)
    // call site (the global handler; the two per-tool pre-gate ZodError
    // branches call formatZodError(name, e) with a different error binding
    // name) instead of the bare "ZodError" string, which now also matches
    // the toAgentErrorText() helper and other ZodError branches earlier in
    // the file.
    const callSite = src.indexOf("formatZodError(name, error)");
    expect(callSite).toBeGreaterThan(-1);
    const window = src.slice(callSite, callSite + 600);
    expect(window).toMatch(/isError\s*:\s*true/);
  });
});
