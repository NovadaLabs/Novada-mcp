import { z } from "zod";
import { novadaScrape } from "./scrape.js";
import { TASK_ID_REGEX, TASK_ID_REGEX_MSG, withCamelCaseAliases } from "./types.js";
import { zodToMcpSchema } from "../utils/mcp-schema.js";
import { CATALOG_BY_DOMAIN } from "../data/scraper_catalog.js";
// ─── Title derivation (F-7, W-B1) ────────────────────────────────────────────
// Brand names whose correct capitalization isn't plain Titlecase — mirrors
// hosted-server/vercel/api/mcp.ts's own TITLE_BRAND_MAP so both surfaces render
// the identical "Scrape <Brand>" title for every platform-scraper tool (that
// file independently derives the SAME title from the tool name for hosted
// display; this is the npm-package-side equivalent, keyed by the human-readable
// platformLabel already declared on each platform's config, so a 16th platform
// config only needs a ROW here if its brand needs non-Titlecase — no other
// per-tool wiring). Keep in sync if either brand list changes.
const PLATFORM_TITLE_BRAND_MAP = {
    "X (Twitter)": "X",
    "DuckDuckGo": "DuckDuckGo",
    "YouTube": "YouTube",
    "GitHub": "GitHub",
    "LinkedIn": "LinkedIn",
    "TikTok": "TikTok",
    "SHEIN": "SHEIN",
};
/** e.g. "Amazon" -> "Scrape Amazon", "X (Twitter)" -> "Scrape X". */
function derivePlatformTitle(platformLabel) {
    return `Scrape ${PLATFORM_TITLE_BRAND_MAP[platformLabel] ?? platformLabel}`;
}
/** Render a PlatformScraperDescription into the tool's full MCP description string. */
function renderDescription(d) {
    return [
        d.core,
        "",
        `**Use when:** ${d.useWhen.map((s) => `"${s}"`).join(", ")}.`,
        `**Not for:** ${d.notFor.map((x) => `${x.when} — ${"useInstead" in x ? `use ${x.useInstead}` : x.note}`).join(". ")}.`,
        `**Returns:** ${d.returns}`,
        `**Ops:** ${d.operationsNote}`,
    ].join("\n");
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
export function createPlatformScraperTool(config) {
    const opEntries = Object.entries(config.operations);
    const opNames = opEntries.map(([name]) => name);
    const operationEnumDescription = `${config.platformLabel} operation to run (params keys per entry):\n` +
        opEntries.map(([name, opCfg]) => `- ${name}: ${opCfg.paramsDoc}`).join("\n");
    // DE-1 / C-1 (P1, ledger-verified −0.18 duplicate charge): this is the ONE shared
    // factory site for all 15 pinned platform-scraper tools (novada_scrape_<platform>) —
    // wrapping it here with withCamelCaseAliases closes the taskId→task_id money-path hole
    // across every one of them at once, mirroring the matching fix applied to
    // ScrapeParamsSchema/ScrapeParamsFullSchema (types.ts) for the generic novada_scrape
    // tool. Never hand-apply this per platform config — it belongs HERE.
    const ParamsSchema = withCamelCaseAliases(z.object({
        operation: z.enum(opNames).describe(operationEnumDescription),
        params: z.record(z.string(), z.unknown()).default({}).describe(config.paramsFieldDoc),
        limit: z.number().int().min(1).max(100).default(20)
            .describe("Max records (default 20, max 100)."),
        format: z.enum(["json", "csv", "excel", "html", "markdown", "toon"]).default("markdown")
            .describe("markdown (default table), json (records array), csv/excel/html (spreadsheet), toon (compact pipe-separated)."),
        task_id: z.string().regex(TASK_ID_REGEX, TASK_ID_REGEX_MSG).optional()
            .describe("Resume a previous slow task instead of submitting a new billable one."),
        project: z.string().max(30).optional()
            .describe("Group outputs in a subfolder, e.g. 'competitor-pricing'."),
    }), { taskId: "task_id" });
    function validateParams(args) {
        return ParamsSchema.parse(args ?? {});
    }
    async function handler(params, apiKey) {
        const opConfig = config.operations[params.operation];
        return novadaScrape({
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
        }, apiKey);
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
    const registryEntry = {
        name: config.toolName,
        description: config.registryDescription,
        category: config.category,
        status: "active",
        title: derivePlatformTitle(config.platformLabel),
        // Every factory-generated platform-scraper tool belongs to the "scrapers"
        // filtering group (F-1/F-7 audit) — a new platform config gets this for free,
        // no per-tool edit needed (class-not-instance).
        group: "scrapers",
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
export function hasAnyWorkingOp(config) {
    const domainOps = CATALOG_BY_DOMAIN.get(config.platform);
    return Object.values(config.operations).some((opCfg) => domainOps?.get(opCfg.scraperId)?.status === "ok");
}
/**
 * Widen one `createPlatformScraperTool()` result into a `DispatchableScraperTool`.
 * `TParams` is inferred fresh at each call site, so the returned closure calls
 * `validateParams`/`handler` with their exact per-platform Params type internally —
 * only the OUTER shape (`dispatch`) is uniform. This is what lets the aggregator
 * (platform_scrapers.ts) hold every platform's differently-typed tool in one array
 * without collapsing any of them down to an imprecise shared params type.
 */
export function toDispatchableScraperTool(tool) {
    return {
        toolDefinition: tool.toolDefinition,
        registryEntry: tool.registryEntry,
        dispatch: (args, apiKey) => tool.handler(tool.validateParams(args), apiKey),
        validateParams: (args) => tool.validateParams(args),
        config: tool.config,
    };
}
//# sourceMappingURL=platform_scraper.js.map