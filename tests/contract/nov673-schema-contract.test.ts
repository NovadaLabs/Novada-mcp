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
import {
  CrawlParamsSchema,
  validateCrawlParams,
} from "../../src/tools/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Helper: read src/index.ts as text (importing it boots a stdio server) ───

function readIndexSrc(): string {
  return readFileSync(resolve(__dirname, "../../src/index.ts"), "utf8");
}

// ─── Helper: extract TOOLS array text from core.ts ───────────────────────────

function readToolsBlock(): string {
  const src = readFileSync(resolve(__dirname, "../../src/core.ts"), "utf8");
  const start = src.indexOf("const TOOLS = [");
  if (start === -1) throw new Error("could not locate `const TOOLS = [` in src/core.ts");
  const after = src.slice(start);
  let depth = 0;
  let i = after.indexOf("[");
  for (; i < after.length; i++) {
    if (after[i] === "[") depth++;
    else if (after[i] === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  return after.slice(0, i + 1);
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
    const block = readToolsBlock();
    // Find the novada_monitor entry and its annotations block
    const monitorStart = block.indexOf('"novada_monitor"');
    expect(monitorStart).toBeGreaterThan(-1);
    const monitorSlice = block.slice(monitorStart, monitorStart + 1500);
    const annotationsMatch = monitorSlice.match(/annotations:\s*\{([^}]+)\}/);
    expect(annotationsMatch).not.toBeNull();
    const annotationsText = annotationsMatch![1];
    expect(annotationsText).toMatch(/idempotentHint\s*:\s*false/);
  });

  it("novada_verify has idempotentHint:false (non-deterministic live searches)", () => {
    const block = readToolsBlock();
    const verifyStart = block.indexOf('"novada_verify"');
    expect(verifyStart).toBeGreaterThan(-1);
    const verifySlice = block.slice(verifyStart, verifyStart + 1500);
    const annotationsMatch = verifySlice.match(/annotations:\s*\{([^}]+)\}/);
    expect(annotationsMatch).not.toBeNull();
    const annotationsText = annotationsMatch![1];
    expect(annotationsText).toMatch(/idempotentHint\s*:\s*false/);
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

describe("Global ZodError handler — agent_instruction in error response", () => {
  it("index.ts ZodError handler emits agent_instruction line", () => {
    const src = readIndexSrc();
    // The handler must include the agent_instruction literal so the error response
    // is parseable by agents without free-text parsing.
    expect(src).toMatch(/agent_instruction:\s*Fix the parameter/);
  });

  it("index.ts ZodError handler still sets isError: true", () => {
    const src = readIndexSrc();
    // Find the ZodError handler block and verify it sets isError:true.
    const zodBlockStart = src.indexOf("error instanceof ZodError");
    expect(zodBlockStart).toBeGreaterThan(-1);
    // Extend the slice far enough to capture the full handler (including the isError line
    // which appears after the multi-line content array construction).
    const zodBlock = src.slice(zodBlockStart, zodBlockStart + 2000);
    expect(zodBlock).toMatch(/isError\s*:\s*true/);
  });
});
