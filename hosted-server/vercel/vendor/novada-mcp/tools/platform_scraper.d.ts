import { z } from "zod";
import type { ToolCategory, ToolMeta } from "./registry.js";
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
    /**
     * Each entry is ONE of two shapes, joined with ". ":
     *   - `{ when, useInstead }` renders as "`${when} — use ${useInstead}`" — the normal
     *     case: `when` doesn't fit this tool, `useInstead` names what DOES (always phrased
     *     as a thing to use, e.g. a tool name or param).
     *   - `{ when, note }` renders as "`${when} — ${note}`" (no forced "use" prefix) — for
     *     a STATEMENT rather than an action, e.g. documenting a removed/backend_broken
     *     operation where there is no "use X instead" to offer. Round 4 (S1-connector, F5):
     *     added because forcing a statement through the `useInstead` shape produced a
     *     garbled "— use this operation is currently backend_broken…" sentence
     *     (scrape_youtube.ts's transcript_by_video entry, judge-flagged 2026-10-13) — fixed
     *     at THIS shared template, not per-tool, so the same mistake can't recur silently
     *     for a future removed operation on any other platform tool.
     */
    notFor: Array<{
        when: string;
        useInstead: string;
    } | {
        when: string;
        note: string;
    }>;
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
export declare function createPlatformScraperTool<TOpName extends string>(config: PlatformScraperConfig<TOpName>): {
    toolDefinition: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        annotations: {
            readOnlyHint: boolean;
            idempotentHint: boolean;
            destructiveHint: boolean;
            openWorldHint: boolean;
        };
    };
    registryEntry: ToolMeta;
    ParamsSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
        operation: z.ZodEnum<{ [k_1 in TOpName]: k_1; } extends infer T ? { [k in keyof T]: T[k]; } : never>;
        params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        limit: z.ZodDefault<z.ZodNumber>;
        format: z.ZodDefault<z.ZodEnum<{
            json: "json";
            html: "html";
            markdown: "markdown";
            csv: "csv";
            excel: "excel";
            toon: "toon";
        }>>;
        task_id: z.ZodOptional<z.ZodString>;
        project: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    validateParams: (args: Record<string, unknown> | undefined) => {
        operation: ({ [k_1 in TOpName]: k_1; } extends infer T_1 ? { [k in keyof T_1]: T_1[k]; } : never)[TOpName];
        params: Record<string, unknown>;
        limit: number;
        format: "json" | "html" | "markdown" | "csv" | "excel" | "toon";
        task_id?: string | undefined;
        project?: string | undefined;
    };
    handler: (params: {
        operation: ({ [k_1 in TOpName]: k_1; } extends infer T_1 ? { [k in keyof T_1]: T_1[k]; } : never)[TOpName];
        params: Record<string, unknown>;
        limit: number;
        format: "json" | "html" | "markdown" | "csv" | "excel" | "toon";
        task_id?: string | undefined;
        project?: string | undefined;
    }, apiKey: string) => Promise<string>;
    config: PlatformScraperConfig<TOpName>;
};
/**
 * Class rule (Round 3, item 2 — not a SHEIN special case): a platform-scraper tool
 * must NOT be registered/listed when every one of its configured operations resolves
 * to a catalog entry whose status is "backend_broken" (or is missing from the
 * catalog entirely). Directory review requires every LISTED tool to be able to
 * succeed for valid input; a tool whose entire working-op set is empty can never
 * succeed for ANY input, regardless of what the caller passes.
 *
 * Deliberately keyed off the catalog's `status` field (the single source of truth
 * already used by scrape.ts's broken-op warning and extract.ts's hint suppression)
 * rather than a hardcoded platform list — adding a 16th fully-broken platform (or a
 * backend fix that revives SHEIN) changes this function's answer with zero edits
 * here.
 */
export declare function hasAnyWorkingOp(config: PlatformScraperConfig): boolean;
/** A platform-scraper tool widened to one uniform, dispatch-ready shape. */
export interface DispatchableScraperTool {
    toolDefinition: PlatformScraperToolDefinition;
    registryEntry: ToolMeta;
    dispatch: (args: Record<string, unknown>, apiKey: string) => Promise<string>;
    /** Schema-only validation (no network call, no handler invocation) — exposed
     *  separately from `dispatch` so callers (tests, class-sweep guards) can assert
     *  parsing/aliasing behavior (e.g. taskId→task_id, DE-1) on a platform's real
     *  ParamsSchema without paying for a live scrape. Widened to
     *  `Record<string, unknown>` for the same reason `dispatch` is widened below —
     *  only the OUTER shape is uniform across differently-typed per-platform params. */
    validateParams: (args: Record<string, unknown> | undefined) => Record<string, unknown>;
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
export declare function toDispatchableScraperTool<TParams>(tool: {
    toolDefinition: PlatformScraperToolDefinition;
    registryEntry: ToolMeta;
    validateParams: (args: Record<string, unknown> | undefined) => TParams;
    handler: (params: TParams, apiKey: string) => Promise<string>;
    config: PlatformScraperConfig;
}): DispatchableScraperTool;
//# sourceMappingURL=platform_scraper.d.ts.map