import { writeFile } from "fs/promises";
import {
  fetchViaProxy,
  fetchWithRender,
  extractMainContent,
  extractTitle,
  extractLinks,
  normalizeUrl,
  isContentLink,
  discoverViaSitemap,
  resolveSiteCopyDir,
  safeSiteCopyFilePath,
  sanitizeSlug,
} from "../utils/index.js";
import { detectJsHeavyContent } from "./extract.js";
import { compilePatterns, shouldCrawlUrl, type PathMatcher } from "./crawl.js";
import type { SiteCopyParams } from "./types.js";
import { SITE_COPY_HARD_MAX } from "./types.js";
import { TIMEOUTS } from "../config.js";
import { makeNovadaError, NovadaErrorCode } from "../_core/errors.js";

const SITE_COPY_CONCURRENCY = 3;
/** Uncapped marker for extractMainContent — returns full clean markdown (no 3000-char crawl cap). */
const NO_CHAR_CAP = Number.MAX_SAFE_INTEGER;

type DiscoveryMethod = "llms.txt" | "llms-full.txt" | "sitemap" | "bfs";

interface PageRecord {
  url: string;
  file: string;
  title: string;
  word_count: number;
  depth: number;
  bytes: number;
  status: "ok" | "failed";
}

interface SiteCopyManifest {
  root: string;
  discovery: DiscoveryMethod;
  pages_total: number;
  pages_failed: number;
  generated_at: string;
  pages: PageRecord[];
}

/** Same-host test (optionally allowing subdomains of the base host). */
function isSameHost(url: string, baseHostname: string, includeSubdomains: boolean): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h === baseHostname || (includeSubdomains && h.endsWith(`.${baseHostname}`));
  } catch {
    return false;
  }
}

/**
 * Parse the markdown link list out of an llms.txt / llms-full.txt body.
 * llms.txt is a flat markdown index of `[title](url)` links; we take every
 * absolute (or root-relative, resolved against origin) link.
 */
function parseLlmsTxtLinks(body: string, origin: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // [text](url) — url may be absolute or relative
  const re = /\[[^\]]*\]\(\s*([^)\s]+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const raw = m[1];
    if (raw.startsWith("#") || raw.startsWith("mailto:")) continue;
    let abs: string;
    try {
      abs = raw.startsWith("http") ? new URL(raw).href : new URL(raw, origin).href;
    } catch {
      continue;
    }
    if (!abs.startsWith("http")) continue;
    const norm = normalizeUrl(abs);
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(abs);
    }
  }
  return out;
}

/**
 * Canonical detection FIRST: fetch <origin>/llms.txt then /llms-full.txt and parse
 * the markdown link list as the page set. Returns the discovered method + URLs, or
 * null if neither file exists / yields links.
 */
async function discoverViaLlmsTxt(
  origin: string,
  apiKey: string | undefined,
): Promise<{ method: DiscoveryMethod; urls: string[] } | null> {
  const candidates: Array<{ method: DiscoveryMethod; path: string }> = [
    { method: "llms.txt", path: "/llms.txt" },
    { method: "llms-full.txt", path: "/llms-full.txt" },
  ];
  for (const { method, path } of candidates) {
    try {
      const resp = await fetchViaProxy(`${origin}${path}`, apiKey, { tool: "site_copy", timeout: TIMEOUTS.SITEMAP });
      if (typeof resp.data !== "string") continue;
      const body = resp.data;
      // Guard: an HTML 404 page can be 200 + look like markdown — require it to not be an HTML doc.
      if (/^\s*<(?:!doctype|html)/i.test(body)) continue;
      const urls = parseLlmsTxtLinks(body, origin);
      if (urls.length > 0) return { method, urls };
    } catch { /* not available — try next */ }
  }
  return null;
}

/** Fetch one page, honouring render mode + JS-heavy auto-escalation. */
async function fetchSitePage(
  url: string,
  apiKey: string | undefined,
  renderMode: "auto" | "static" | "render",
): Promise<string | null> {
  const useRender = renderMode === "render";
  try {
    const resp = useRender
      ? await fetchWithRender(url, apiKey, { tool: "site_copy", timeout: TIMEOUTS.CRAWL_RENDER, maxRedirects: 3 })
      : await fetchViaProxy(url, apiKey, { tool: "site_copy", timeout: TIMEOUTS.CRAWL_STATIC, maxRedirects: 3 });
    let html = typeof resp.data === "string" ? resp.data : null;
    // auto: escalate to render once if the static HTML looks JS-heavy.
    if (html && renderMode === "auto" && detectJsHeavyContent(html)) {
      try {
        const r = await fetchWithRender(url, apiKey, { tool: "site_copy", timeout: TIMEOUTS.CRAWL_RENDER, maxRedirects: 3 });
        if (typeof r.data === "string") html = r.data;
      } catch { /* keep static html */ }
    }
    return html;
  } catch {
    return null;
  }
}

/**
 * Build the in-scope page set.
 *   1. llms.txt / llms-full.txt (canonical, flat).
 *   2. sitemap.xml (shared discoverViaSitemap).
 *   3. scoped BFS (reuses extractLinks link discovery), drained to completion.
 * Same-host + select/exclude path filters are applied to every candidate.
 */
async function discoverPages(
  params: SiteCopyParams,
  apiKey: string | undefined,
  origin: string,
  baseHostname: string,
  maxPages: number,
  selectPatterns: PathMatcher[],
  excludePatterns: PathMatcher[],
): Promise<{ method: DiscoveryMethod; urls: string[]; seedDepths: Map<string, number> }> {
  const includeSub = params.include_subdomains;
  const inScope = (u: string): boolean =>
    isSameHost(u, baseHostname, includeSub) && shouldCrawlUrl(u, selectPatterns, excludePatterns);

  const seedDepths = new Map<string, number>();

  // --- 1. llms.txt canonical detection FIRST ---
  const llms = await discoverViaLlmsTxt(origin, apiKey);
  if (llms) {
    const filtered = llms.urls.filter(inScope).slice(0, maxPages);
    for (const u of filtered) seedDepths.set(normalizeUrl(u), 0);
    if (filtered.length > 0) return { method: llms.method, urls: filtered, seedDepths };
  }

  // --- 2. sitemap fallback (shared util) ---
  const sitemapUrls = await discoverViaSitemap(origin, apiKey, maxPages);
  if (sitemapUrls.length > 0) {
    const filtered = sitemapUrls.filter(inScope).slice(0, maxPages);
    for (const u of filtered) seedDepths.set(normalizeUrl(u), 0);
    if (filtered.length > 0) return { method: "sitemap", urls: filtered, seedDepths };
  }

  // --- 3. scoped BFS, drained to completion (or maxPages ceiling) ---
  const discovered: string[] = [];
  const discoveredSet = new Set<string>();
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: params.url, depth: 0 }];
  const maxDepth = params.max_depth;

  // Seed the root if it is in scope.
  if (inScope(params.url)) {
    const rootNorm = normalizeUrl(params.url);
    discovered.push(params.url);
    discoveredSet.add(rootNorm);
    seedDepths.set(rootNorm, 0);
  }

  while (queue.length > 0 && discovered.length < maxPages) {
    const batch: { url: string; depth: number }[] = [];
    while (batch.length < SITE_COPY_CONCURRENCY && queue.length > 0) {
      const item = queue.shift()!;
      const norm = normalizeUrl(item.url);
      if (visited.has(norm)) continue;
      visited.add(norm);
      batch.push(item);
    }
    if (batch.length === 0) break;

    const htmls = await Promise.all(
      batch.map(({ url, depth }) =>
        depth >= maxDepth
          ? Promise.resolve<string | null>(null)
          : fetchViaProxy(url, apiKey, { tool: "site_copy", timeout: TIMEOUTS.CRAWL_STATIC, maxRedirects: 3 })
              .then(r => (typeof r.data === "string" ? r.data : null))
              .catch(() => null),
      ),
    );

    for (let i = 0; i < htmls.length; i++) {
      const html = htmls[i];
      if (!html) continue;
      const { depth } = batch[i];
      for (const link of extractLinks(html, batch[i].url)) {
        if (discovered.length >= maxPages) break;
        const norm = normalizeUrl(link);
        if (discoveredSet.has(norm) || visited.has(norm)) continue;
        if (!isContentLink(link) || !inScope(link)) continue;
        discoveredSet.add(norm);
        discovered.push(link);
        seedDepths.set(norm, depth + 1);
        if (depth + 1 < maxDepth) queue.push({ url: link, depth: depth + 1 });
      }
    }
  }

  return { method: "bfs", urls: discovered.slice(0, maxPages), seedDepths };
}

/**
 * Copy an entire docs/site to disk as clean markdown, one .md file per page.
 *
 * Discovery: llms.txt → sitemap → scoped BFS. Pages are streamed to disk as they
 * complete (each writeFile happens per page, not once at the end). A manifest.json
 * records per-page metadata + run meta. Returns a COMPACT summary + manifest path +
 * agent_instruction — never the full page bodies.
 */
export async function novadaSiteCopy(params: SiteCopyParams, apiKey?: string): Promise<string> {
  // NOV-578 #9: site_copy streams each page to the local ~/Downloads filesystem. On a
  // read-only serverless FS (Vercel / AWS Lambda) writeFile throws EROFS partway through the
  // run, and the tool is intentionally not wired into the hosted endpoint. Fail fast with a
  // clear, actionable message instead of an uncaught crash if it is ever invoked there.
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw makeNovadaError(
      NovadaErrorCode.PRODUCT_UNAVAILABLE,
      "novada_site_copy writes pages to your local ~/Downloads folder and cannot run on the hosted/serverless endpoint (read-only filesystem). Run the local MCP server (npx novada-mcp) to use site_copy, or use novada_crawl for hosted multi-page extraction.",
      "serverless_fs_readonly",
    );
  }
  let baseHostname: string;
  let origin: string;
  try {
    const parsed = new URL(params.url);
    baseHostname = parsed.hostname.replace(/^www\./, "");
    origin = parsed.origin;
  } catch {
    throw makeNovadaError(
      NovadaErrorCode.INVALID_PARAMS,
      `Invalid URL: "${params.url}". URL must start with http:// or https://.`,
      `url:${params.url} failed URL parsing`,
    );
  }

  // Safety ceiling: never exceed the hard max regardless of requested max_pages.
  const maxPages = Math.min(params.max_pages, SITE_COPY_HARD_MAX);
  const selectPatterns = compilePatterns(params.select_paths);
  const excludePatterns = compilePatterns(params.exclude_paths);

  const { method, urls, seedDepths } = await discoverPages(
    params, apiKey, origin, baseHostname, maxPages, selectPatterns, excludePatterns,
  );

  if (urls.length === 0) {
    return [
      `## Site Copy`,
      `root: ${params.url}`,
      `discovery: ${method}`,
      `pages: 0`,
      ``,
      `⚠ No in-scope pages discovered for ${params.url}.`,
      `Possible causes: (1) JavaScript SPA with no static links, (2) select_paths excluded everything, (3) no llms.txt/sitemap and root has no same-host links.`,
      ``,
      `## Agent Action`,
      `agent_instruction: site_copy_empty | next: try render="render", relax select_paths, or use novada_map to inspect site structure`,
    ].join("\n");
  }

  // Resolve the output dir up-front — hard-constrained to the Downloads root.
  const dir = await resolveSiteCopyDir(baseHostname, params.project);

  const pages: PageRecord[] = [];
  let failedCount = 0;
  const usedSlugs = new Set<string>();

  /**
   * Derive a unique, already-sanitized slug for a URL from its path (fallback to host).
   *
   * CRITICAL: uniqueness MUST be tracked on the SANITIZED filename, not the raw path
   * slug. safeSiteCopyFilePath → sanitizeSlug folds characters ('.', '%20', case,
   * unicode → '-') and truncates at 80 chars, so two distinct raw slugs
   * (e.g. "api-v1.0-users" vs "api-v1-0-users", or two long common-prefix paths) can
   * collapse to the SAME file. De-duping on the raw slug would let the second writeFile
   * silently overwrite the first → data loss + a manifest listing two pages at one file.
   * Returning the sanitized slug (idempotent for safe chars) keeps writeFile unique too.
   */
  function slugFor(url: string): string {
    let base: string;
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/^\/+|\/+$/g, "");
      base = path || u.hostname.replace(/^www\./, "");
    } catch {
      base = url;
    }
    // Replace path separators so nested paths flatten into one segment.
    base = base.replace(/\//g, "-");
    // Dedupe on the SANITIZED form — that is what becomes the on-disk filename.
    let slug = sanitizeSlug(base || "index");
    let n = 2;
    while (usedSlugs.has(slug)) {
      // Reserve room for the "-N" suffix so a long base whose first 80 chars are
      // identical can't truncate every candidate back to the same colliding slug
      // (which would loop forever). Trim the base, THEN append, THEN sanitize.
      const suffix = `-${n++}`;
      const trimmedBase = sanitizeSlug(base, Math.max(1, 80 - suffix.length));
      slug = sanitizeSlug(`${trimmedBase}${suffix}`);
    }
    usedSlugs.add(slug);
    return slug;
  }

  // Fetch + stream pages in bounded-concurrency batches; write each page as it completes.
  for (let i = 0; i < urls.length; i += SITE_COPY_CONCURRENCY) {
    const batch = urls.slice(i, i + SITE_COPY_CONCURRENCY);
    await Promise.all(
      batch.map(async (url) => {
        const depth = seedDepths.get(normalizeUrl(url)) ?? 0;
        // Reserve the slug synchronously (single-threaded JS) so concurrent pages
        // in the same batch never collide on a filename.
        const slug = slugFor(url);
        try {
          const html = await fetchSitePage(url, apiKey, params.render);
          if (!html) {
            failedCount++;
            pages.push({ url, file: "", title: "", word_count: 0, depth, bytes: 0, status: "failed" });
            return;
          }
          const title = extractTitle(html);
          // Clean markdown per page WITHOUT the 3000-char crawl cap.
          const md = extractMainContent(html, url, NO_CHAR_CAP);
          const wordCount = md.split(/\s+/).filter(Boolean).length;

          const header = [
            `<!-- source: ${url} -->`,
            `# ${title}`,
            ``,
            md,
            ``,
          ].join("\n");

          // SSRF/path-traversal guard: filename sanitized + re-checked against Downloads root.
          const filePath = safeSiteCopyFilePath(dir, slug);
          // STREAM: write this page now, not batched at the end.
          await writeFile(filePath, header, "utf-8");

          pages.push({
            url,
            file: filePath,
            title,
            word_count: wordCount,
            depth,
            bytes: Buffer.byteLength(header),
            status: "ok",
          });
        } catch {
          // One bad page (write error, malformed content) must not abort the whole
          // run — record it as failed and keep draining the rest.
          failedCount++;
          pages.push({ url, file: "", title: "", word_count: 0, depth, bytes: 0, status: "failed" });
        }
      }),
    );
  }

  // ── manifest.json ──────────────────────────────────────────────────────────
  const manifest: SiteCopyManifest = {
    root: params.url,
    discovery: method,
    pages_total: pages.length,
    pages_failed: failedCount,
    generated_at: new Date().toISOString(),
    pages,
  };
  const manifestPath = safeSiteCopyFilePath(dir, "manifest", "json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

  const okPages = pages.filter(p => p.status === "ok");
  const totalWords = okPages.reduce((sum, p) => sum + p.word_count, 0);
  const totalBytes = okPages.reduce((sum, p) => sum + p.bytes, 0);

  // ── COMPACT summary — never the page bodies ─────────────────────────────────
  const lines: string[] = [
    `## Site Copy Complete`,
    `root: ${params.url}`,
    `discovery: ${method}`,
    `pages_written: ${okPages.length} | pages_failed: ${failedCount} | total_words: ${totalWords} | total_bytes: ${totalBytes}`,
    `output_dir: ${dir}`,
    `manifest: ${manifestPath}`,
    ``,
    `### Pages (first ${Math.min(okPages.length, 10)} of ${okPages.length})`,
    ...okPages.slice(0, 10).map((p, idx) => `${idx + 1}. ${p.title || "(untitled)"} — ${p.word_count}w — ${p.url}`),
  ];

  if (okPages.length > 10) {
    lines.push(`… ${okPages.length - 10} more — see manifest.json for the full list.`);
  }
  if (okPages.length >= maxPages) {
    lines.push(``, `note: reached max_pages=${maxPages} ceiling — more in-scope pages may exist. Raise max_pages (hard max ${SITE_COPY_HARD_MAX}) to copy more.`);
  }

  lines.push(``);
  lines.push(`## Agent Action`);
  lines.push(
    `agent_instruction: site_copy_complete pages:${okPages.length} discovery:${method} | ` +
    `read manifest.json (${manifestPath}) for {url,file,title,word_count,depth,bytes,status} per page | ` +
    `each page is a clean .md under ${dir} | Read individual .md files instead of re-fetching.`,
  );

  return lines.join("\n");
}
