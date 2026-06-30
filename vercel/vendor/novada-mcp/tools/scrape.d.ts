import { NovadaError } from "../_core/errors.js";
import type { ScrapeParams, ScrapeParamsFullType } from "./types.js";
/** Submit a scraper task and return the task_id */
export declare function submitScrapeTask(apiKey: string, scraper_name: string, scraper_id: string, params: Record<string, unknown>): Promise<string>;
export declare const OPERATION_ALIASES: Record<string, string>;
type OpMap = Record<string, readonly string[]>;
export declare const PLATFORM_OPERATIONS: Record<string, OpMap>;
/**
 * #6 pre-flight: reject an unknown platform, an unknown operation for a known
 * platform, or a missing required param BEFORE any backend round-trip. Returns a
 * structured NovadaError (INVALID_PARAMS) whose agent_instruction lists the valid
 * operations — so the agent self-corrects without a 60s hang → 504. Returns null
 * when the platform is not in the active map (unknown/inactive platforms fall
 * through to the existing 11006/11008 backend handling — the map only covers the
 * 13 platforms that have live operations).
 */
export declare function preflightScrape(platform: string, operation: string, params: Record<string, unknown>): NovadaError | null;
export declare function novadaScrape(params: ScrapeParams | ScrapeParamsFullType, apiKey: string): Promise<string>;
export {};
//# sourceMappingURL=scrape.d.ts.map