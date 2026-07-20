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
import { toDispatchableScraperTool, type DispatchableScraperTool } from "./platform_scraper.js";
import { AMAZON_SCRAPER_TOOL } from "./scrape_amazon.js";
import { GOOGLE_SCRAPER_TOOL } from "./scrape_google.js";
import { BING_SCRAPER_TOOL } from "./scrape_bing.js";
import { DUCKDUCKGO_SCRAPER_TOOL } from "./scrape_duckduckgo.js";
import { YANDEX_SCRAPER_TOOL } from "./scrape_yandex.js";
import { YOUTUBE_SCRAPER_TOOL } from "./scrape_youtube.js";
import { INSTAGRAM_SCRAPER_TOOL } from "./scrape_instagram.js";
import { FACEBOOK_SCRAPER_TOOL } from "./scrape_facebook.js";
import { TIKTOK_SCRAPER_TOOL } from "./scrape_tiktok.js";
import { X_SCRAPER_TOOL } from "./scrape_x.js";

/** One entry per platform-scraper tool. Order mirrors registration order elsewhere. */
export const PLATFORM_SCRAPER_TOOLS: DispatchableScraperTool[] = [
  toDispatchableScraperTool(AMAZON_SCRAPER_TOOL),
  toDispatchableScraperTool(GOOGLE_SCRAPER_TOOL),
  toDispatchableScraperTool(BING_SCRAPER_TOOL),
  toDispatchableScraperTool(DUCKDUCKGO_SCRAPER_TOOL),
  toDispatchableScraperTool(YANDEX_SCRAPER_TOOL),
  toDispatchableScraperTool(YOUTUBE_SCRAPER_TOOL),
  toDispatchableScraperTool(INSTAGRAM_SCRAPER_TOOL),
  toDispatchableScraperTool(FACEBOOK_SCRAPER_TOOL),
  toDispatchableScraperTool(TIKTOK_SCRAPER_TOOL),
  toDispatchableScraperTool(X_SCRAPER_TOOL),
];

/** Full MCP tool schemas — spread into src/core.ts's `_TOOL_DEFINITIONS`. */
export const PLATFORM_SCRAPER_DEFS = PLATFORM_SCRAPER_TOOLS.map((t) => t.toolDefinition);

/** Short catalog entries — spread into src/tools/registry.ts's `TOOL_REGISTRY`. */
export const PLATFORM_SCRAPER_REGISTRY_ENTRIES = PLATFORM_SCRAPER_TOOLS.map((t) => t.registryEntry);

/** name -> validated-and-dispatched handler, for src/core.ts's dispatch() to route through. */
export const PLATFORM_SCRAPER_HANDLERS: Record<string, (args: Record<string, unknown>, apiKey: string) => Promise<string>> =
  Object.fromEntries(PLATFORM_SCRAPER_TOOLS.map((t) => [t.toolDefinition.name, t.dispatch]));
