import { z } from "zod";
import { novadaScrape } from "./scrape.js";
import { TASK_ID_REGEX, TASK_ID_REGEX_MSG } from "./types.js";
import type { ToolCategory, ToolMeta } from "./registry.js";
import { zodToMcpSchema } from "../utils/mcp-schema.js";

// ─── Platform-scraper factory ────────────────────────────────────────────────
// Tools-v2: turns `novada_scrape_amazon` from a hand-written per-platform tool
// into a CONFIG-DRIVEN FACTORY, so each of the remaining 15 per-platform tools
// (novada_scrape_<platform>) is "add one declarative PlatformScraperConfig",
// not a hand-edited clone of scrape_amazon.ts. Behavior-preserving: Amazon is
// re-expressed as the FIRST config (see scrape_amazon.ts) and its wire-format,
// description text, and every existing test stay identical (verified against a
// pre-refactor snapshot of the generated TOOLS/TOOL_REGISTRY entries).
//
// What the factory does NOT reimplement (reused as-is, single source of truth):
//   - The HTTP submit/poll/format engine — delegates to `novadaScrape` (scrape.ts).
//   - AND-required / OR-alternate param enforcement — scrape.ts's `preflightScrape`
//     + `AND_REQUIRED_OPS` already key off the resolved catalog `scraper_id`
//     (`operation` after friendly-name resolution), regardless of which
//     per-platform tool called in. A config's operations simply point at the
//     right catalog slug; scrape.ts's existing preflight enforces AND/OR
//     requirements automatically — no per-tool wiring needed here.

/** One operation exposed on a per-platform scraper tool's `operation` enum. */
export interface PlatformOperationConfig {
  /** The exact catalog `scraper_id` (slug) in src/data/scraper_catalog.ts for this platform. */
  scraperId: string;
  /** One-line doc describing the `params` keys this operation needs, rendered as
   *  `- <friendlyName>: <paramsDoc>` inside the `operation` enum's .describe() text. */
  paramsDoc: string;
}

/** Structured MCP tool description — rendered into the Core/Use-when/Not-for→X/Returns/
 *  Operations shape every per-platform scraper tool description follows. */
export interface PlatformScraperDescription {
  /** Opening paragraph: what the tool extracts + which engine backs it. */
  core: string;
  /** Example asks that route to this tool, rendered as a quoted, comma-joined list. */
  useWhen: string[];
  /** Each entry renders as "`${when} — use ${useInstead}`", joined with ". ". */
  notFor: Array<{ when: string; useInstead: string }>;
  /** What the tool returns, in what formats. */
  returns: string;
  /** Operation-count / enum-safety note (e.g. "10 verified-working ops... 3 excluded..."). */
  operationsNote: string;
}

/** One platform's declarative scraper-tool config — the factory's sole input. */
export interface PlatformScraperConfig<TOpName extends string = string> {
  /** Catalog domain used by novadaScrape's engine, e.g. "amazon.com". */
  platform: string;
  /** Human label used in the generated `operation` enum description, e.g. "Amazon". */
  platformLabel: string;
  /** MCP tool name, e.g. "novada_scrape_amazon". */
  toolName: string;
  /** TOOL_REGISTRY category. */
  category: ToolCategory;
  /** Short one-liner for TOOL_REGISTRY / novada_discover's catalog. */
  registryDescription: string;
  /** Friendly operation name -> { scraperId, paramsDoc }. Iteration order is preserved
   *  into both the generated Zod enum and its rendered description lines. */
  operations: Record<TOpName, PlatformOperationConfig>;
  /** Description text for the `params` schema field (bespoke per-platform examples). */
  paramsFieldDoc: string;
  /** Structured full-tool MCP description (see PlatformScraperDescription). */
  description: PlatformScraperDescription;
}

/** Render a PlatformScraperDescription into the tool's full MCP description string. */
function renderDescription(d: PlatformScraperDescription): string {
  return [
    d.core,
    "",
    `**Use when:** ${d.useWhen.map((s) => `"${s}"`).join(", ")}.`,
    `**Not for:** ${d.notFor.map((x) => `${x.when} — use ${x.useInstead}`).join(". ")}.`,
    `**Returns:** ${d.returns}`,
    `**Operations:** ${d.operationsNote}`,
  ].join("\n");
}

/** Full MCP tool schema shape shared by every generated platform-scraper tool. */
export interface PlatformScraperToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
}

/**
 * Build a per-platform scraper tool from a declarative config. Every generated tool
 * shares the same shape: a closed `operation` enum resolving to a catalog `scraper_id`,
 * the common limit/format/task_id/project fields, and delegation to `novadaScrape` with
 * `displayName` set to the friendly operation name (so the "## Scrape Results" header
 * echoes what the caller typed, not the raw catalog slug — FIX 3 from the Amazon scaffold).
 *
 * Deliberately NOT given an explicit return-type annotation: letting TypeScript infer
 * the literal return type keeps `ParamsSchema`/`validateParams`/`handler` precisely typed
 * to THIS platform's params (e.g. scrape_amazon.ts's exported `ScrapeAmazonParams` type
 * derives from this). The aggregator (platform_scrapers.ts) needs to hold many platforms'
 * differently-typed tools in one array — see `toDispatchableScraperTool` below, which
 * widens a single precisely-typed tool into a uniform shape via a generic closure,
 * rather than forcing every tool down to one imprecise shared interface here.
 */
export function createPlatformScraperTool<TOpName extends string>(
  config: PlatformScraperConfig<TOpName>,
) {
  const opEntries = Object.entries(config.operations) as [TOpName, PlatformOperationConfig][];
  const opNames = opEntries.map(([name]) => name) as [TOpName, ...TOpName[]];

  const operationEnumDescription =
    `Which ${config.platformLabel} operation to run. Each requires specific keys in \`params\`:\n` +
    opEntries.map(([name, opCfg]) => `- ${name}: ${opCfg.paramsDoc}`).join("\n");

  const ParamsSchema = z.object({
    operation: z.enum(opNames).describe(operationEnumDescription),
    params: z.record(z.string(), z.unknown()).default({}).describe(config.paramsFieldDoc),
    limit: z.number().int().min(1).max(100).default(20)
      .describe("Max records to return. Default 20, max 100."),
    format: z.enum(["json", "csv", "excel", "html", "markdown", "toon"]).default("markdown")
      .describe("Output format. 'markdown' (default): structured table. 'json': structured records array. 'csv'/'excel'/'html': spreadsheet-ready. 'toon': token-optimized pipe-separated format."),
    task_id: z.string().regex(TASK_ID_REGEX, TASK_ID_REGEX_MSG).optional()
      .describe("Optional. Resume a previous slow task by its task_id instead of submitting a new billable one — same semantics as novada_scrape's task_id."),
    project: z.string().max(30).optional()
      .describe("Optional project name to group related outputs in a subfolder. E.g. 'competitor-pricing'."),
  });

  type Params = z.infer<typeof ParamsSchema>;

  function validateParams(args: Record<string, unknown> | undefined): Params {
    return ParamsSchema.parse(args ?? {});
  }

  async function handler(params: Params, apiKey: string): Promise<string> {
    const opConfig = config.operations[params.operation as TOpName];
    return novadaScrape(
      {
        platform: config.platform,
        operation: opConfig.scraperId,
        params: params.params,
        limit: params.limit,
        format: params.format,
        task_id: params.task_id,
        project: params.project,
        // FIX 3 (inherited from the Amazon scaffold): surface the friendly operation
        // name the caller actually typed in the "## Scrape Results" header, not the
        // raw catalog slug it resolves to.
        displayName: params.operation,
      },
      apiKey,
    );
  }

  const toolDefinition = {
    name: config.toolName,
    description: renderDescription(config.description),
    inputSchema: zodToMcpSchema(ParamsSchema),
    // Same posture for every platform-scraper tool: read-only, non-idempotent (each
    // call is a live third-party scrape — results can differ between calls), non-
    // destructive, open-world (reaches the public internet via the scraper backend).
    annotations: { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  };

  const registryEntry: ToolMeta = {
    name: config.toolName,
    description: config.registryDescription,
    category: config.category,
    status: "active",
  };

  return {
    toolDefinition,
    registryEntry,
    ParamsSchema,
    validateParams,
    handler,
    config,
  };
}

/** A platform-scraper tool widened to one uniform, dispatch-ready shape. */
export interface DispatchableScraperTool {
  toolDefinition: PlatformScraperToolDefinition;
  registryEntry: ToolMeta;
  dispatch: (args: Record<string, unknown>, apiKey: string) => Promise<string>;
  /** Read-only accessor to the platform's declarative config (platform domain +
   *  friendly-operation-name -> scraperId map), widened to `PlatformScraperConfig`'s
   *  default `string` operation-name type here — only the OUTER shape is uniform,
   *  same rationale as `dispatch` below. Exists so guards (e.g.
   *  tests/tools/platform-scraper-catalog.test.ts) can cross-check every config's
   *  operations against src/data/scraper_catalog.ts generically, across the whole
   *  family, without re-deriving the map from ParamsSchema internals. */
  config: PlatformScraperConfig;
}

/**
 * Widen one `createPlatformScraperTool()` result into a `DispatchableScraperTool`.
 * `TParams` is inferred fresh at each call site, so the returned closure calls
 * `validateParams`/`handler` with their exact per-platform Params type internally —
 * only the OUTER shape (`dispatch`) is uniform. This is what lets the aggregator
 * (platform_scrapers.ts) hold every platform's differently-typed tool in one array
 * without collapsing any of them down to an imprecise shared params type.
 */
export function toDispatchableScraperTool<TParams>(tool: {
  toolDefinition: PlatformScraperToolDefinition;
  registryEntry: ToolMeta;
  validateParams: (args: Record<string, unknown> | undefined) => TParams;
  handler: (params: TParams, apiKey: string) => Promise<string>;
  config: PlatformScraperConfig;
}): DispatchableScraperTool {
  return {
    toolDefinition: tool.toolDefinition,
    registryEntry: tool.registryEntry,
    dispatch: (args, apiKey) => tool.handler(tool.validateParams(args), apiKey),
    config: tool.config,
  };
}
