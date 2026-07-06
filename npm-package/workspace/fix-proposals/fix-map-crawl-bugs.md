# Fix Proposals — Map + Crawl Tools (BUG-M1, BUG-M2, BUG-M3)
Reviewed by: fix-engineer-2
Date: 2026-05-19

---

## BUG-M1: SPA Error Code

### Root Cause (from source)

In `src/tools/map.ts`, there are two separate code paths that both fail on a JS SPA, but only one of them correctly identifies it as an SPA:

**Path A — SPA detection (lines 54–74):** When the BFS crawl (phase 2) finds ≤1 URL with no `search` filter active, and that URL is only the root, the code detects it as an SPA and returns a plain-text advisory with `## Agent Hints`. This path is only reached when `params.search` is falsy.

**Path B — The bug (lines 76–81):** When `params.search` is present (e.g., `search="models"`) and `filtered.length === 0`, the code falls straight through to `throw makeNovadaError(NovadaErrorCode.URL_UNREACHABLE, ...)`. The error text says "may be unreachable, a JavaScript SPA, or there are no pages matching your search term" — but uses code `URL_UNREACHABLE`, which has an `agent_instruction` that says "verify the URL is publicly accessible" and "retry after 10 seconds." Neither action helps with a SPA. The agent has no machine-readable signal to branch on.

The test case that triggered this bug (`url=docs.anthropic.com, search="models"`) hit Path B exactly: the site produced 0 static URLs after both sitemap and BFS phases, then `filtered.length === 0` after the search filter, triggering the `URL_UNREACHABLE` throw.

Additionally, Path A is also incomplete: it returns a plain text block rather than a structured error with an `agent_instruction` field that agents can programmatically detect. The hints there point to `novada_extract` and `novada_search` but not `novada_unblock method=render` or `novada_crawl render=render`, which are the most effective alternatives for SPAs.

### Proposed Fix

**Step 1 — Add `SPA_NO_URLS_FOUND` to the error enum** in `src/_core/errors.ts`:

```diff
 export enum NovadaErrorCode {
   INVALID_API_KEY        = "INVALID_API_KEY",
   RATE_LIMITED           = "RATE_LIMITED",
   URL_UNREACHABLE        = "URL_UNREACHABLE",
+  SPA_NO_URLS_FOUND      = "SPA_NO_URLS_FOUND",
   API_DOWN               = "API_DOWN",
   INVALID_PARAMS         = "INVALID_PARAMS",
   ...
 }
```

**Step 2 — Add the `agent_instruction` template** in the `INSTRUCTIONS` record in `src/_core/errors.ts`:

```diff
+  [NovadaErrorCode.SPA_NO_URLS_FOUND]: `\
+This site is a JavaScript Single-Page Application (SPA). Static crawling cannot
+discover JS-rendered links. Do not retry novada_map on this URL.
+
+Recommended next steps (in order):
+1. Use novada_unblock with method=render to fetch the rendered HTML of the page directly.
+   Example: { url: "${url}", method: "render" }
+2. Use novada_crawl with render="render" to crawl JS-rendered pages.
+   Example: { url: "${url}", render: "render", max_pages: 5 }
+3. Use novada_search with site:${hostname} to find indexed subpages via search engine.
+   Example: { query: "site:${hostname} ${search_term}" }`,
```

Note: Since the template is a static string (not a function), replace the interpolated variables with generic placeholders:

```typescript
  [NovadaErrorCode.SPA_NO_URLS_FOUND]: `\
This site is a JavaScript Single-Page Application (SPA). Static crawling cannot \
discover JS-rendered links. Do not retry novada_map on this URL.

Recommended next steps (in order):
1. Use novada_unblock with method=render to fetch the rendered page HTML directly.
2. Use novada_crawl with render="render" to crawl JS-rendered pages.
3. Use novada_search with "site:<hostname>" to find indexed subpages via a search engine.`,
```

Also add `SPA_NO_URLS_FOUND` to the retryable list check in `makeNovadaError` — it should NOT be retryable:

```diff
   retryable: [
     NovadaErrorCode.RATE_LIMITED,
     NovadaErrorCode.URL_UNREACHABLE,
     NovadaErrorCode.API_DOWN,
     NovadaErrorCode.TASK_PENDING,
   ].includes(code),
```

No change needed — `SPA_NO_URLS_FOUND` is not in the list, so it defaults to `false`. Correct.

**Step 3 — Unify the two SPA detection paths in `src/tools/map.ts`**

Replace the current split logic (Path A at lines 54–81) with a single helper that fires for both the `search` and no-`search` cases. The refactored block:

```diff
-  // SPA detection
-  if (filtered.length <= 1 && !params.search) {
-    const isSpaLikely = filtered.length === 0 || (filtered.length === 1 && filtered[0] === normalizeUrl(params.url));
-    if (isSpaLikely) {
-      return [
-        `## Site Map`,
-        `root: ${params.url}`,
-        `urls:${filtered.length}`,
-        ``,
-        `---`,
-        ``,
-        `⚠ Only ${filtered.length === 0 ? "0 URLs" : "the root URL"} found. This site is likely a JavaScript SPA.`,
-        `Static crawling cannot discover JS-rendered links.`,
-        ``,
-        `## Agent Hints`,
-        `- Try \`novada_extract\` on ${params.url} to get the page content directly.`,
-        `- If content is dynamically loaded, the extract may also be limited.`,
-        `- Use \`novada_search\` with \`site:${new URL(params.url).hostname}\` to find indexed subpages.`,
-      ].join("\n");
-    }
-  }
-
-  if (filtered.length === 0) {
-    throw makeNovadaError(
-      NovadaErrorCode.URL_UNREACHABLE,
-      `No URLs found on ${params.url}${params.search ? ` matching "${params.search}"` : ""}. The site may be unreachable, a JavaScript SPA, or there are no pages matching your search term.`
-    );
-  }
+  // SPA / no-links detection — fires for both search and non-search cases
+  // Condition: discovered 0 or only-root URLs from sitemap+crawl phases, meaning
+  // no static links exist regardless of search filter.
+  const discoveredOnlyRoot =
+    discovered.length === 0 ||
+    (discovered.length === 1 && discovered[0] === normalizeUrl(params.url));
+
+  if (discoveredOnlyRoot) {
+    // Sitemap returned nothing AND BFS returned nothing (or only root) — SPA pattern
+    const searchSuffix = params.search
+      ? ` No pages matching "${params.search}" could be found because the site has no static links.`
+      : "";
+    throw makeNovadaError(
+      NovadaErrorCode.SPA_NO_URLS_FOUND,
+      `No static URLs found on ${params.url}. This site appears to be a JavaScript SPA — ` +
+      `static crawling cannot discover JS-rendered links.${searchSuffix}`,
+      `url:${params.url} — sitemap absent, BFS found 0 or root-only URLs`
+    );
+  }
+
+  // At this point discovered has links, but search filter may have eliminated all of them
+  if (filtered.length === 0) {
+    // There ARE crawlable URLs but none match the search term — this is a genuine no-match,
+    // not a SPA. Return a helpful no-results message rather than an error.
+    return [
+      `## Site Map`,
+      `root: ${params.url}`,
+      `urls:0 (filtered by "${params.search}" from ${discovered.length} total)`,
+      `discovery:${sitemapUrls.length > 0 ? "sitemap" : "crawl"}`,
+      ``,
+      `---`,
+      ``,
+      `No URLs matched the search term "${params.search}" out of ${discovered.length} discovered URLs.`,
+      ``,
+      `## Agent Hints`,
+      `- Remove the 'search' param to see all ${discovered.length} discovered URLs.`,
+      `- Use \`novada_search\` with \`site:${new URL(params.url).hostname} ${params.search}\` to find matching indexed pages.`,
+    ].join("\n");
+  }
```

Note: the variable `discovered` is in scope at this point (it is assigned on line 44 via `parallelBfsCrawl` or line 36 via `sitemapUrls`). The variable `sitemapUrls` is also in scope. No new variables needed.

**What changes for agents:**
- When a site is an SPA, agents now receive `Error [SPA_NO_URLS_FOUND]` — a distinct, machine-checkable code.
- `Retryable: no` — agents stop retrying immediately.
- `agent_instruction` names `novada_unblock method=render` and `novada_crawl render=render` as the correct pivots.
- No-match on search (but the site HAS crawlable pages) returns a non-error text response with actionable hints instead of a misleading `URL_UNREACHABLE`.

### Risk Assessment

**Low risk.** The change is additive: a new enum value and a new error code. The only behavioral change is that the existing `URL_UNREACHABLE` throw at line 78 is replaced with `SPA_NO_URLS_FOUND`, and the existing plain-text SPA path is replaced with the same error code. Sites that are genuinely unreachable (network down, 404, etc.) are handled by `fetchViaProxy` throwing exceptions, which are caught by `classifyError` in the index handler and emit `URL_UNREACHABLE` as before. The new code only fires when `fetchViaProxy` succeeds but returns no links — a clearly distinct case.

**One edge case to verify:** A site with exactly one page (root only, no links) that is NOT a SPA — e.g., a bare landing page with no nav links. Previously this triggered the SPA text advisory (Path A). After the fix it will throw `SPA_NO_URLS_FOUND`. This is acceptable: the agent_instruction for SPA_NO_URLS_FOUND still suggests `novada_extract` implicitly via `novada_unblock`, which is the right tool for a single-page site too. The message text says "appears to be a JavaScript SPA" which is a hedge, not a hard assertion.

---

## BUG-M2: Silent Under-delivery

### Root Cause (from source)

In `src/tools/map.ts`, the success response block starts at line 83 and returns `filtered.slice(0, maxUrls)` results. There is no comparison between the number of URLs returned and the number requested (`params.limit`).

The relevant lines:

```typescript
// line 13
const maxUrls = Math.min(params.limit || 50, 100);

// lines 83–106 — success path
const lines: string[] = [
  `## Site Map`,
  `root: ${params.url}`,
  `urls:${filtered.length}${...}`,
  ...filtered.slice(0, maxUrls).map((u, i) => `${i + 1}. ${u}`),
  `## Agent Hints`,
  `- Use \`novada_extract\` to read any of these pages.`,
  ...
];
```

`filtered.length` is printed in the header, and `params.limit` is the input. The agent can see both values if it parses the header, but:
1. The header line is prose — `urls:2` does not tell the agent the request was for 10.
2. There is no `agent_hint` explaining WHY fewer were returned.
3. There is no suggestion for what to do next.

### Proposed Fix

Add a structured under-delivery hint block after the URL list in the `lines` array, inside the success path in `src/tools/map.ts`. Insert after the existing `## Agent Hints` lines, conditioned on under-delivery:

```diff
   const lines: string[] = [
     `## Site Map`,
     `root: ${params.url}`,
     `urls:${filtered.length}${params.search ? ` (filtered by "${params.search}" from ${discovered.length} total)` : ""}`,
     `discovery:${discoveryMethod}`,
+    `requested:${params.limit || 50}`,
     ``,
     `---`,
     ``,
     ...filtered.slice(0, maxUrls).map((u, i) => `${i + 1}. ${u}`),
     ``,
     `---`,
     `## Agent Hints`,
     `- Use \`novada_extract\` to read any of these pages.`,
     `- Use \`novada_extract\` with url=[url1,url2,...] for batch extraction.`,
     `- Use \`novada_crawl\` to extract content from multiple pages at once.`,
   ];

   if (params.search) {
     lines.push(`- Remove 'search' param to see all ${discovered.length} discovered URLs.`);
   }

+  // Under-delivery hint — fires when fewer URLs returned than requested
+  const requestedCount = params.limit || 50;
+  if (filtered.length < requestedCount) {
+    const shortfall = requestedCount - filtered.length;
+    const depthNote = (params.max_depth ?? 2) < 5
+      ? `Increasing max_depth (currently ${params.max_depth ?? 2}, max 5) may find more links.`
+      : `max_depth is already at maximum (5).`;
+    const searchNote = params.search
+      ? ` Only ${filtered.length} of ${discovered.length} discovered URLs match "${params.search}".`
+      : "";
+    lines.push(
+      ``,
+      `## Agent Notice — Under-delivery`,
+      `requested:${requestedCount} | returned:${filtered.length} | shortfall:${shortfall}`,
+      `reason: This site has fewer crawlable static links than requested at depth ${params.max_depth ?? 2}.${searchNote}`,
+      `next_steps:`,
+      `- ${depthNote}`,
+      `- Use \`novada_crawl\` with render="render" if this is a JS SPA or dynamically linked site.`,
+      `- Use \`novada_search\` with \`site:${new URL(params.url).hostname}\` to find additional indexed pages.`,
+    );
+  }

   return lines.join("\n");
```

**What changes for agents:**
- The response header now includes `requested:N` — machine-parseable, no prose parsing required.
- When `filtered.length < requestedCount`, a clearly-labeled `## Agent Notice — Under-delivery` section appears with structured fields: `requested`, `returned`, `shortfall`, `reason`, `next_steps`.
- The `depthNote` distinguishes "you can go deeper" from "already at max depth."
- The search-scoped case gives the ratio of matching vs. total URLs, so the agent knows whether to widen the search or accept the result.

### Risk Assessment

**Very low risk.** This is a pure addition to the output string — no logic path changes, no error handling changes. The hint fires only on the success path when `filtered.length < requestedCount`. Existing callers that parse the `## Site Map` block or the numbered URL list are unaffected (the new block appears after both). The one minor risk: callers that scan for `## Agent Hints` as the final section will now see `## Agent Notice — Under-delivery` after it — if any downstream parser has a hard assumption that `## Agent Hints` is the last section, it may miss the new block. This is unlikely in practice since agents typically read the full response.

---

## BUG-M3: Crawl Early Exit

### Root Cause (from source)

In `src/tools/crawl.ts`, the stop-reason logic at lines 168–173 produces a one-line note:

```typescript
// lines 168–174
const stoppedEarly = results.length < maxPages;
const stopReason = stoppedEarly
  ? queue.length === 0
    ? "No more same-domain links to follow."
    : "Remaining links were filtered by path rules or already visited."
  : "";
```

This string is injected into the response at line 185:

```typescript
stoppedEarly && stopReason ? `note: Stopped early — ${stopReason}` : "",
```

And the `## Agent Hints` block at lines 202–209 only appends:

```typescript
lines.push(`- ${results.length} pages crawled. For targeted extraction, use novada_map first then novada_extract on chosen pages.`);
if (selectPatterns.length > 0 || excludePatterns.length > 0) {
  lines.push(`- Path filters were active. Remove them to crawl the full site.`);
}
```

For the httpbin case: the crawl fetched the root page (1 result), found 0 same-domain HTML links in the Swagger UI output, `queue` became empty, `stoppedEarly = true` (1 < 3), and the stop reason is `"No more same-domain links to follow."` There is no subsequent guidance about WHY this happened or what the agent should do differently.

The `## Agent Hints` line that mentions `novada_map` appears unconditionally but is phrased generically ("for targeted extraction") — it does not flag the specific problem of zero-link discovery.

### Proposed Fix

Extend the stop-reason message and the `## Agent Hints` block with actionable recovery guidance when `queue.length === 0` and `results.length < maxPages`. Two targeted changes in `src/tools/crawl.ts`:

**Change 1 — Enrich the inline `note:` for the zero-links case:**

```diff
 const stopReason = stoppedEarly
   ? queue.length === 0
-    ? "No more same-domain links to follow."
+    ? "No more same-domain links to follow. The crawled pages contained no outbound HTML links within this domain (common with Swagger UI, Single-Page Apps, or React/Vue frontends)."
     : "Remaining links were filtered by path rules or already visited."
   : "";
```

**Change 2 — Add a conditional recovery hint block in `## Agent Hints`:**

```diff
   lines.push(`## Agent Hints`);
   lines.push(`- ${results.length} pages crawled. For targeted extraction, use novada_map first then novada_extract on chosen pages.`);
   if (selectPatterns.length > 0 || excludePatterns.length > 0) {
     lines.push(`- Path filters were active. Remove them to crawl the full site.`);
   }
   if (params.instructions) {
     lines.push(`- Instructions were noted. Apply semantic filtering to the content above based on: "${params.instructions}"`);
   }
+
+  // Recovery guidance when crawl stopped early due to zero discovered links
+  if (stoppedEarly && queue.length === 0 && results.length < maxPages) {
+    lines.push(``);
+    lines.push(`## Recovery Guidance — Crawl Stopped Early`);
+    lines.push(`stop_reason: No outbound same-domain links were discovered in the crawled page(s).`);
+    lines.push(`This is common for: Swagger UI, React/Vue/Next.js SPAs, documentation sites with JS-only navigation.`);
+    lines.push(`next_steps:`);
+    lines.push(`- Run \`novada_map\` on ${params.url} first to verify whether this site has any static crawlable links.`);
+    lines.push(`  If novada_map returns SPA_NO_URLS_FOUND, switch to render mode.`);
+    lines.push(`- Re-run \`novada_crawl\` with render="render" to crawl JS-rendered pages: { url: "${params.url}", render: "render", max_pages: ${maxPages} }`);
+    lines.push(`- Use \`select_paths\` to target specific URL path patterns if you know the structure. E.g. select_paths=["/api/.*", "/docs/.*"]`);
+    lines.push(`- Use \`novada_extract\` directly on specific known URLs if you don't need link discovery.`);
+  }
```

Note: `queue` is declared in the function scope at line 76 and accessible at the point where `## Agent Hints` is written. `maxPages` is also in scope. Both are used here without needing new variables.

**What changes for agents:**
- The inline `note:` line now explains the structural cause, not just the symptom.
- A new `## Recovery Guidance — Crawl Stopped Early` section with labeled fields (`stop_reason`, `next_steps`) only appears when relevant (stoppedEarly + queue empty + fewer pages than requested).
- The recovery block gives four ordered actions: (1) verify with `novada_map`, (2) retry with `render=render`, (3) use `select_paths`, (4) use `novada_extract` directly. These are actionable without any external context.
- The concrete re-run command uses the actual parameter values from the current call (`params.url`, `maxPages`), so the agent can copy-execute it.

### Risk Assessment

**Very low risk.** Change 1 is a string extension to an existing message — no logic change. Change 2 is additive: a new conditional block appended to the response. It fires only on `stoppedEarly && queue.length === 0 && results.length < maxPages` — a narrow condition that does not affect normal full-crawl responses. No error handling, no branching, no new dependencies. The only risk is output verbosity for edge cases where a site legitimately has exactly `maxPages - 1` pages — in that case the recovery section fires even though the crawl technically succeeded at finding all available pages. This is a minor false-positive that errs on the side of information rather than silence, which is acceptable for agent UX.
