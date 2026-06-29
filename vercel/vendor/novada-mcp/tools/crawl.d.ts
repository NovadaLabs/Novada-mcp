import type { CrawlParams } from "./types.js";
/** Compile path filter regexes, ignore invalid or dangerous patterns.
 * Rejects patterns with nested quantifiers that cause catastrophic backtracking (ReDoS).
 * Exported so site_copy reuses the exact same ReDoS-hardened compilation. */
export declare function compilePatterns(patterns: string[] | undefined): RegExp[];
/** Check if a URL path matches select/exclude path filters.
 *  Exported so site_copy applies identical path-scope semantics. */
export declare function shouldCrawlUrl(url: string, selectPatterns: RegExp[], excludePatterns: RegExp[]): boolean;
export declare function novadaCrawl(params: CrawlParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=crawl.d.ts.map