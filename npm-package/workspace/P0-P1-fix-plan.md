# P0 + P1 Fix Plan — novada-mcp
Orchestrator brief for worker agent. Fix in order. tsc after every group.

```
PRECONDITIONS:
  ASSERT cd ~/Projects/novada-mcp
  ASSERT RUN("npm run build").exitCode == 0   // must start clean

// ─────────────────────────────────────────────
// GROUP A — P0 Fixes (do ALL before tsc check)
// ─────────────────────────────────────────────

// A1: search filter params silently dropped (INC-167)
file = READ("src/tools/search.ts")
location = FIND("cleaned", file)   // find where cleaned object is built
INSPECT: are time_range, start_date, end_date, country, language present in the
         object sent to submitSearchScrapeTask or equivalent API call?
IF missing:
  INSERT these fields into the scraper API request body alongside query + engine
  Also: add them to the novada_search tool description in src/index.ts

// A2: Remove ghost params from novada_unblock (INC-168)
file = READ("src/index.ts")
location = FIND('novada_unblock', file)  // find tool registration block
REMOVE from Zod schema: wait_ms, block_resources, auto_runs
REMOVE from description: all lines referencing these 3 params
DO NOT implement them — delete only

// A3: Fix "129 platforms" → "13 platforms" (INC-169)
FOR path IN ["src/index.ts", "src/tools/discover.ts", "src/tools/health.ts", "src/resources/index.ts"]:
  content = READ(path)
  actual_count = GREP("129", content)
  IF found:
    REPLACE "129" with "13" in platform count contexts only
    // be careful: don't replace unrelated "129" numbers
VERIFY: RUN("grep -r '129 platform' src/").stdout == ""

// A4: Mask password in proxy_static + proxy_dedicated (INC-170)
FOR path IN ["src/tools/proxy_static.ts", "src/tools/proxy_dedicated.ts"]:
  content = READ(path)
  // Find curl/env format output strings that embed ${creds.pass} raw
  REPLACE all ${creds.pass} in OUTPUT strings → "***"
  // Keep creds.pass for actual proxy auth (non-output usage), only mask in return strings

// Also clean dead encodedPass variable (unused) from 4 files:
FOR path IN ["src/tools/proxy_residential.ts", "src/tools/proxy_isp.ts",
             "src/tools/proxy_datacenter.ts", "src/tools/proxy_mobile.ts"]:
  REMOVE line that declares encodedPass if it is never used below it

// A5: routeFetch must check DOMAIN_REGISTRY (INC-171)
file = READ("src/utils/router.ts")
// Find routeFetch function definition
// Find extractSingleInner or equivalent that already does DOMAIN_REGISTRY lookup
// Copy that lookup pattern to the TOP of routeFetch, before any fetch attempt:
INSERT at start of routeFetch body:
  const domainHint = getDomainHint(url);
  if (domainHint?.method === 'browser' && isBrowserConfigured()) {
    return fetchWithBrowser(url, options);
  }
  if (domainHint?.method === 'render') {
    return fetchWithRender(url, options);
  }
  // ... existing logic continues below

// ─── VERIFY GROUP A ───
result = RUN("cd ~/Projects/novada-mcp && npx tsc --noEmit 2>&1")
IF result.exitCode != 0:
  FIX each error in result.stderr
  RETRY tsc once
  IF still failing: ESCALATE with full tsc output


// ─────────────────────────────────────────────
// GROUP B — P1 Fixes
// ─────────────────────────────────────────────

// B1: HTML extraction quality — 7 fixes (INC-172)
file = READ("src/utils/html.ts")

// B1a: BOILERPLATE_SELECTORS inside semantic selectors (highest impact)
// Find where main/article/section are matched (semantic selector path)
// After selecting $container from main/article, BEFORE scoring:
INSERT: $container.find('nav, header.site-header, [class*="sidebar"], [class*="footer"], [id*="menu"]').remove()
// This ensures nav/header inside <main> are stripped, not just in body fallback

// B1b: Conditional <form> removal
// Find REMOVE_TAGS array or equivalent
// Remove "form" from it
// Instead, in the processing loop:
IF el.is('form'):
  const linkDensity = el.find('a').length / Math.max(el.text().length, 1)
  IF linkDensity > 0.5 OR el.text().trim().length < 100:
    el.remove()
  // else keep the form (it likely contains real content)

// B1c: <ol> ordered list numbering
// Find the markdown walker for <li> elements
// Add counter tracking:
IF parent.is('ol'):
  const idx = el.index() + 1
  output += `${idx}. ${liContent}\n`
ELSE:
  output += `- ${liContent}\n`

// B1d: Code block language hints
// Find where <pre><code> is converted to markdown
// Extract language from class attribute:
const lang = codeEl.attr('class')?.match(/language-(\w+)/)?.[1] ?? ''
output += `\`\`\`${lang}\n${code}\n\`\`\`\n`

// B1e: <header> conditional removal
// Find where <header> is removed (currently hard-removed)
// Change to conditional:
IF el.is('header'):
  const hasNav = el.find('nav, [class*="logo"], [class*="brand"]').length > 0
  IF hasNav: el.remove()
  // else keep it — it's likely an article header with the title

// B1f: <img> → markdown
// Find markdown walker — add img handler:
IF el.is('img'):
  const alt = el.attr('alt') ?? ''
  const src = el.attr('src') ?? ''
  IF src: output += `![${alt}](${src})\n`

// B1g: Markdown escaping for text nodes
// In the text node handler, escape special chars:
textContent = textContent
  .replace(/\\/g, '\\\\')
  .replace(/\*/g, '\\*')
  .replace(/_/g, '\\_')
  .replace(/\[/g, '\\[')
  .replace(/\]/g, '\\]')

// B2: Browser stealth patching (INC-173)
file = READ("src/utils/browser.ts")

// B2a: navigator.webdriver override
// Find where browser context is created (context = await browser.newContext(...))
// Immediately after context creation, add:
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  (window as any).chrome = { runtime: {}, loadTimes: () => ({}) };
  Object.defineProperty(navigator, 'plugins', {
    get: () => [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }]
  });
});

// B2b: waitUntil timing fix
// Find await page.goto() or page.waitForLoadState('domcontentloaded')
// Replace with:
await page.waitForLoadState('networkidle', { timeout: 15000 })
  .catch(() => page.waitForLoadState('domcontentloaded'));
// Then after load:
const bodyHtml = await page.content();
IF bodyHtml.includes('cf-challenge') OR bodyHtml.includes('cf-turnstile'):
  await page.waitForTimeout(6000)  // wait for CF 5s JS challenge
  await page.waitForLoadState('domcontentloaded')

// B3: Search latency optimization (INC-174)
file = READ("src/tools/search.ts")

// B3a: 300ms pre-wait before first poll
// Find the polling loop (the while loop that calls pollSearchResult)
// BEFORE the loop starts:
await new Promise(r => setTimeout(r, 300))  // backend needs ~300ms to start task

// B3b: 60s in-memory dedup cache
// At module level (top of search.ts):
const _searchCache = new Map<string, { result: string; ts: number }>()
const SEARCH_CACHE_TTL = 60_000

// At START of novadaSearch (before API call):
const cacheKey = `${params.engine ?? 'google'}:${params.query}:${params.num ?? 10}`
const cached = _searchCache.get(cacheKey)
IF cached AND Date.now() - cached.ts < SEARCH_CACHE_TTL:
  return cached.result

// After successful result:
_searchCache.set(cacheKey, { result: finalOutput, ts: Date.now() })
IF _searchCache.size > 100:
  // evict oldest entry
  const oldest = [..._searchCache.entries()].sort((a,b) => a[1].ts - b[1].ts)[0]
  _searchCache.delete(oldest[0])

// B3c: Move hardcoded search timeouts to config.ts
// Find any literal 60000, 30000, 90000 in search.ts
// Move to TIMEOUTS object in src/config.ts, reference from search.ts

// B4: fetchWithRetry jitter + swallowed errors + HTTP pooling + tryParse (INC-175)

// B4a: Full jitter in fetchWithRetry (src/utils/http.ts)
// Find fetchWithRetry function and its sleep/delay calculation
// REPLACE pure exponential with full jitter:
const baseDelay = Math.pow(2, attempt) * 1000
const jitter = Math.random() * baseDelay
await new Promise(r => setTimeout(r, Math.min(jitter, 30_000)))
// Apply same pattern to fetchWithRender if it has its own backoff

// B4b: HTTP connection pooling (src/utils/http.ts)
// At module level:
import https from 'https'
const _httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 })
// Pass to ALL axios.get/post calls that hit Novada APIs:
{ httpsAgent: _httpsAgent, ... }

// B4c: Fix 3 swallowed errors in router.ts (src/utils/router.ts)
// Find the browser fallback catch{} blocks (there are 3)
// Change each from:
//   } catch { }
// To:
//   } catch (err) { lastError = err as Error }
// Declare let lastError: Error | undefined at top of function
// Include lastError?.message in the final error throw/return

// B4d: tryParse latent bug (src/tools/account_summary.ts)
file = READ("src/tools/account_summary.ts")
// Find line ~36 where tryParse<T>() result is used
// After the call, add guard:
IF '_parse_error' in parsed:
  throw new NovadaError('PARSE_ERROR', `Failed to parse API response`)

// ─── VERIFY GROUP B ───
result = RUN("cd ~/Projects/novada-mcp && npx tsc --noEmit 2>&1")
IF result.exitCode != 0:
  FIX each error in result.stderr
  RETRY tsc once
  IF still failing: ESCALATE with full tsc output

// ─── FINAL BUILD ───
buildResult = RUN("cd ~/Projects/novada-mcp && npm run build 2>&1")
IF buildResult.exitCode != 0: ESCALATE

// ─── SMOKE TEST ───
// Test the most critical P0 fix (search params):
RUN("node -e \"
  process.env.NOVADA_API_KEY='test';
  const s = require('./build/tools/search.js');
  // Verify time_range is in the request body (check source or mock)
  console.log('smoke test: search params check');
\"")

SUCCESS_WHEN:
  tsc --noEmit exits 0
  npm run build exits 0
  grep -r '129 platform' src/ returns empty
  grep -r 'proxyPass}' src/tools/proxy_static.ts returns empty (password not raw in output)
  grep -r 'encodedPass' src/tools/proxy_residential.ts returns empty
```
