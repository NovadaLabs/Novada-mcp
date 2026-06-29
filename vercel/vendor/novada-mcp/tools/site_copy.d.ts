import type { SiteCopyParams } from "./types.js";
/**
 * Copy an entire docs/site to disk as clean markdown, one .md file per page.
 *
 * Discovery: llms.txt → sitemap → scoped BFS. Pages are streamed to disk as they
 * complete (each writeFile happens per page, not once at the end). A manifest.json
 * records per-page metadata + run meta. Returns a COMPACT summary + manifest path +
 * agent_instruction — never the full page bodies.
 */
export declare function novadaSiteCopy(params: SiteCopyParams, apiKey?: string): Promise<string>;
//# sourceMappingURL=site_copy.d.ts.map