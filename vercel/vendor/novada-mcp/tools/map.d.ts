import type { MapParams } from "./types.js";
/**
 * Map a website to discover all URLs on the site.
 * Strategy:
 * 1. Try sitemap.xml / sitemap_index.xml / robots.txt → fast, complete coverage
 * 2. Fall back to parallel BFS crawl if no sitemap found
 */
export declare function novadaMap(params: MapParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=map.d.ts.map