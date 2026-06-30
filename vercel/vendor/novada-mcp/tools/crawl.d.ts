import type { CrawlParams } from "./types.js";
/** A compiled path-glob matcher: returns true iff the URL pathname matches the glob.
 *  Exported so site_copy can type its discovery helper with the same shape. */
export type PathMatcher = (path: string) => boolean;
/** Compile path filters into linear-time glob matchers — never compiles raw user input as a
 * backtracking regex, so crafted ReDoS patterns cannot freeze the event loop (NOV-570).
 * Patterns are treated as GLOBS (`**`, `*`, `?`); all other characters are literals.
 * Over-long (>1000 chars) patterns are skipped; at most 50 patterns are honored.
 * Exported so site_copy reuses the exact same ReDoS-hardened compilation. */
export declare function compilePatterns(patterns: string[] | undefined): PathMatcher[];
/** Check if a URL path matches select/exclude path filters.
 *  Exported so site_copy applies identical path-scope semantics. */
export declare function shouldCrawlUrl(url: string, selectPatterns: PathMatcher[], excludePatterns: PathMatcher[]): boolean;
export declare function novadaCrawl(params: CrawlParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=crawl.d.ts.map