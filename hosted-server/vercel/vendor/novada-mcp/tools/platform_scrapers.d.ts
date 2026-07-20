/**
 * Aggregator for every factory-generated platform-scraper tool (novada_scrape_<platform>).
 *
 * Add a new platform to this family by: (1) writing its PlatformScraperConfig + calling
 * createPlatformScraperTool() in its own file (mirroring scrape_amazon.ts), (2) wrapping the
 * result with toDispatchableScraperTool() and pushing it into PLATFORM_SCRAPER_TOOLS below.
 * core.ts spreads PLATFORM_SCRAPER_DEFS into `_TOOL_DEFINITIONS` and routes dispatch()
 * through PLATFORM_SCRAPER_HANDLERS; registry.ts spreads PLATFORM_SCRAPER_REGISTRY_ENTRIES
 * into `TOOL_REGISTRY`. Neither file needs to change again when a new platform config is
 * added here.
 */
import { type DispatchableScraperTool } from "./platform_scraper.js";
/** One entry per platform-scraper tool. Order mirrors registration order elsewhere. */
export declare const PLATFORM_SCRAPER_TOOLS: DispatchableScraperTool[];
/** Full MCP tool schemas — spread into src/core.ts's `_TOOL_DEFINITIONS`. */
export declare const PLATFORM_SCRAPER_DEFS: import("./platform_scraper.js").PlatformScraperToolDefinition[];
/** Short catalog entries — spread into src/tools/registry.ts's `TOOL_REGISTRY`. */
export declare const PLATFORM_SCRAPER_REGISTRY_ENTRIES: import("./registry.js").ToolMeta[];
/** name -> validated-and-dispatched handler, for src/core.ts's dispatch() to route through. */
export declare const PLATFORM_SCRAPER_HANDLERS: Record<string, (args: Record<string, unknown>, apiKey: string) => Promise<string>>;
//# sourceMappingURL=platform_scrapers.d.ts.map