# Verification Report — novada-search v0.8.3

## Tool Status Matrix

| Tool | Status | Notes |
|---|---|---|
| novada_search | BACKEND_ERROR | Client correct; 402 from SERP endpoint (not activated). Graceful error output confirmed. |
| novada_extract | CLIENT_BUG | Single-URL path lacks try-catch — throws uncaught on non-HTML, DNS failure, invalid URL. Batch path is protected. |
| novada_crawl | CLIENT_BUG | Schema uses `max_pages`/`strategy`/`select_paths`; agents pass `limit`/`mode`/`path_filter` and get silently wrong behavior. |
| novada_map | WORKING | All 3 tests passed. Minor: empty-filter result returns bare string (no header/hints block). |
| novada_research | CLIENT_BUG | `resolveDepth()` and `generateSearchQueries()` call `params.question.length`/`.toLowerCase()` with no null guard — crashes on `query` param (the intuitive name every other tool uses). |
| novada_scrape | BACKEND_ERROR | Client flow (task submit → poll → result) is correct. `google_search` returns backend 500. 11006/11008 errors handled correctly. |
| novada_proxy | WORKING | Pure config output; all 4 format modes correct. Minor: port inconsistency in Node.js example vs proxy URL. |
| novada_verify | BACKEND_ERROR | Client correct; all 3 parallel SERP queries return 402. Graceful SERP_UNAVAILABLE message with alternatives. |
| novada_unblock | CLIENT_BUG | When `NOVADA_WEB_UNBLOCKER_KEY` is absent, `fetchWithRender` silently falls back to `fetchViaProxy` (static) but router returns `mode:"render"`, `cost:"medium"`, and Agent Hints says "Rendered via Web Unblocker (JS execution enabled)" — all false. Confirmed in `router.ts:87` and `http.ts:211-218`. |
| novada_browser | WORKING | Correct not-configured message with full setup command. `list_sessions` bypasses WS check correctly. |
| novada_health | WORKING | Parallel probes correct; correctly distinguishes "not activated" vs "invalid key". Minor grammatical bug: "Go to visit..." double-verb in Next Steps. |

---

## LobeHub Score Path

Current: 61/100 | Target: 80+

| Criterion | Current | Fix | Est. Points |
|---|---|---|---|
| Tools in manifest | 6/11 (55%) | Add all 11 tools to `server.json` tools array | +8 |
| Prompts in manifest | 3/5 (60%) | Add `scrape_platform_data` and `browser_stateful_workflow` to `server.json` prompts | +3 |
| Resources in manifest | 3/4 (75%) | Add `novada://scraper-platforms` to `server.json` resources | +2 |
| Manifest version sync | 0.6.9 vs 0.8.3 | Set `server.json` version and `packages[].version` to 0.8.3 | +2 |
| SKILL.md tool coverage | 5/11 tools (says "5 Novada MCP tools") | Update `skills/novada-agent/SKILL.md` to document all 11 tools | +3 |
| LICENSE file | EXISTS (verified) | No change needed | +0 |
| server.json skills description | Says "6 Novada MCP tools" in skills[0].description | Update to "11 Novada MCP tools" | +1 |
| EN README tool count badge | Says `tools-10` (wrong; should be 11) | Fix badge in `README.md` | +1 |
| ZH README tool count badge | Says `工具数-5` (very wrong; frozen at v0.6.x) | Fix badge in `README.zh.md` | +1 |
| EN/ZH README install command consistency | EN is 2-step; ZH is 1-step | Adopt ZH single-command form in EN README | +1 |

Estimated total after fixes: **83/100**

---

## Consolidated Issue List

### P0 — Ship Blockers (must fix before any publish)

1. **[research null-crash] `novada_research` crashes when agent passes `query` instead of `question`** — `src/tools/research.ts:9,13`
   Fix: Add null-coalesce in both `resolveDepth(params.depth || "auto", params.question ?? "")` and `generateSearchQueries(params.question ?? "", ...)`. Also add `query` as a Zod schema alias since every other tool uses `query`.

2. **[extract uncaught-exception] Single-URL path in `novadaExtract` throws uncaught exceptions** — `src/tools/extract.ts:48`
   Fix: Wrap `return extractSingle(...)` in a try-catch with the same structured-error-string pattern already used in the batch path — one change fixes all three crash variants (non-HTML content, DNS failure, invalid URL).

3. **[unblock false render label] `novada_unblock` falsely reports `method:render` / "Rendered via Web Unblocker" when `NOVADA_WEB_UNBLOCKER_KEY` is absent** — `src/utils/router.ts:87`, `src/utils/http.ts:211-218`, `src/tools/unblock.ts:31,45`
   Fix: In `router.ts`, detect key absence before hardcoding `mode:"render"` — return `mode:"render-failed"` (already a valid `UsedMode` enum value) and update Agent Hints to say "Web Unblocker not configured — JS rendering did not occur".

4. **[manifest stale] `server.json` declares only 6/11 tools, 3/5 prompts, 3/4 resources, version 0.6.9** — `server.json` (entire file)
   Fix: Regenerate `server.json` to include all 11 tools with full descriptions, all 5 prompts, all 4 resources, and version 0.8.3 in both `version` and `packages[].version` fields.

5. **[fields missing title/description] `extractFields` returns `—` for "title" and "description" — the two most common field requests** — `src/utils/fields.ts:40-53`
   Fix: Add `"title"` and `"description"` (and `"meta description"`) as special cases in `extractFields` that delegate to `extractTitle()` / `extractDescription()` — both already imported and used elsewhere in the extract pipeline.

---

### P1 — Important (fix before next release)

1. **[crawl silent param mismatch] `novada_crawl` silently ignores `limit`, `mode`, `path_filter`** — `src/tools/crawl.ts` (schema definition)
   Fix: Add `limit` as a Zod alias for `max_pages`, `mode` as alias for `strategy`, and emit a warning when deprecated param names are detected. Alternatively, update all documentation and `SKILL.md` examples to use the canonical names prominently.

2. **[enum params lack .describe()] Search engine, crawl strategy, unblock method, proxy type enums have no `.describe()` text** — `src/tools/search.ts`, `src/tools/crawl.ts`, `src/tools/unblock.ts`, `src/tools/proxy.ts`
   Fix: Add `.describe()` to all enum parameters explaining trade-offs and when to choose each value.

3. **[error messages no next-step] Error messages say what went wrong but not what to do** — `src/index.ts:315-324`
   Fix: For `RATE_LIMITED`: add "Wait 30s before retrying". For `INVALID_PARAMS`: append valid enum values from the Zod schema. For `URL_UNREACHABLE`: suggest "Try with `render='render'`".

4. **[SKILL.md stale] SKILL.md says "5 Novada MCP tools", covers only original 5** — `skills/novada-agent/SKILL.md:12`
   Fix: Update to document all 11 tools with the same level of detail (key parameters, when to use/not use, examples) as the existing 5 entries.

5. **[README badge drift] EN badge says `tools-10`, ZH badge says `工具数-5`; actual is 11. EN and ZH test counts also differ** — `README.md`, `README.zh.md`
   Fix: Sync both READMEs to `tools-11` and current test count. Adopt the ZH single-command install format in EN.

6. **[README org inconsistency] EN README GitHub badge links to `Goldentrii/novada-search`, ZH links to `NovadaLabs/novada-search`** — `README.md`, `README.zh.md`
   Fix: Pick the canonical org and make both READMEs consistent.

7. **[scraper operation ID guidance] No error message tells agent to re-read `novada://scraper-platforms` on invalid operation** — `src/tools/scrape.ts` error paths
   Fix: Add "Unknown operation. Read `novada://scraper-platforms` resource for correct operation IDs." to 11008/unknown-operation error responses.

8. **[health double-verb] "Go to visit dashboard.novada.com/..." grammatical bug** — `src/tools/health.ts:222`
   Fix: Change note strings to start with the URL (not "visit") or remove "Go to" from the template.

9. **[proxy port inconsistency] Port absent from `proxy_url` but hardcoded in Node.js axios example** — `src/tools/proxy.ts:119`
   Fix: Use `port || 7777` consistently in both the URL and the example object.

10. **[ZodError not classified] `classifyError()` falls to UNKNOWN for ZodError** — `src/tools/types.ts:160-166`
    Fix: Add `instanceof ZodError` branch returning `INVALID_PARAMS` with formatted issue list. (Confirmed P1 not P0 — MCP boundary in `index.ts` handles ZodError separately before `classifyError` is called.)

---

### P2 — Polish

1. **[quality:0 misleads on short content]** Successful extraction of a short page returns `quality:0` — agents may retry unnecessarily. Separate "extraction succeeded" from content richness signal.

2. **[map empty result bare string]** `novada_map` with an empty result returns a bare string with no `## Site Map` header or Agent Hints block — inconsistent with successful output.

3. **[health platform count stale]** Error fallback path in `health.ts:177` says "65+ platforms" while success path says "129 platforms".

4. **[any casts without narrowing]** `browser.ts:203`, `index.ts:224-229,233-237` suppress type safety. Downgraded from P0 — no runtime defect demonstrated, but should be addressed.

5. **[unblock method="static" silently treated as "render"]** `unblock.ts:13` maps any value that is not `"browser"` to `"render"`, including `"static"`. Schema allows `"static"` but logic ignores it.

6. **[health "Go to visit..." text bug]** Already covered in P1.8 — moving here if team considers grammatical issues cosmetic.

7. **[proxy no endpoint reachability check]** `novada_health` does not ping the proxy endpoint for connectivity. Neither does `novada_proxy`. Acceptable by design, but a proxy-specific health probe would improve operator trust.

8. **[polling fixed-interval]** `scrape.ts` polls every 2s for 90s. Exponential backoff (500ms→5s) would reduce early-task latency by 1-2s on fast scrapes.

9. **[render mode resource missing]** No `novada://render-modes` resource explaining `auto`/`static`/`render`/`browser` trade-offs with a decision tree. First-time agents make wrong escalation choices.

10. **[competitive README framing]** README "Why Novada" section focuses on proxy infrastructure. The actual differentiator (end-to-end pipeline, agent-native `novada://guide` resource) is not communicated. No impact on score but directly affects conversion.

---

## Improvement Plan Coverage

- **LobeHub score gaps:** COVERED — manifest sync (P0.4), SKILL.md update (P1.4), README badge fixes (P1.5), LICENSE confirmed present
- **P0 client bugs:** COVERED — all 5 P0 items are client-fixable without backend changes; 3 are code fixes (research null-guard, extract try-catch, unblock false label), 1 is manifest (server.json sync), 1 is fields.ts
- **README EN/ZH consistency:** COVERED — P1.5 (badge sync + install command), P1.6 (GitHub org)
- **npm metadata:** COVERED — P0.4 (server.json version sync to 0.8.3 also fixes the `packages[].version` field that Smithery/LobeHub parse for npm install commands)

---

## Risk Assessment

**Safe changes (no regression risk):**
- `server.json` full sync — manifest only, no runtime code
- `SKILL.md` update — documentation only
- `README.md` / `README.zh.md` badge and install command fixes — documentation only
- `health.ts` "Go to visit..." double-verb fix — string template change in output only
- `health.ts` platform count in error fallback path — string change only
- `proxy.ts` port consistency fix — affects only the formatted output string for tools that pass no port
- Adding `.describe()` to Zod enum fields — metadata only, no schema validation change

**Changes requiring tests after:**
- `research.ts` null-guard fix — unit test confirming `query`-param call now returns a string instead of crashing; test confirming `question`-param still works correctly
- `extract.ts` single-URL try-catch wrap — regression tests for the three crash paths (non-HTML, DNS failure, invalid URL); ensure the batch path behavior is unchanged
- `router.ts` / `unblock.ts` false render label fix — test confirming `mode:"render-failed"` is returned when key is absent and content was actually fetched via proxy; test confirming `mode:"render"` is still returned when key is present and unblocker was actually used
- `fields.ts` title/description special cases — test confirming "title" and "description" fields now return values on pages with `<title>` and `<meta name="description">`; regression test confirming existing fields (price, author, date, rating) still work

---

## Source Claim Verification

The following specific claims from the 6 review reports were verified against source files:

| Claim | Verified? | Source |
|---|---|---|
| `research.ts:9` calls `params.question` with no null guard | CONFIRMED | Line 9: `resolveDepth(params.depth \|\| "auto", params.question)` — no `??`. Line 13: `generateSearchQueries(params.question, ...)` — no `??`. |
| `extract.ts:48` single-URL path has no try-catch | CONFIRMED | Line 48: `return extractSingle(params as ..., apiKey)` — bare call, no try-catch wrapper. |
| `router.ts:87` hardcodes `mode:"render"` after fetchWithRender call | CONFIRMED | Line 87: `return { html: normalizeToString(response.data), mode: "render", cost: "medium" }` — no key check before mode assignment. |
| `fields.ts` PATTERN_MAP has no "title" or "description" entries | CONFIRMED | Lines 40-53: PATTERN_MAP contains `price`, `cost`, `date`, `published`, `updated`, `author`, `written by`, `rating`, `score`, `availability`, `stock` — no `title` or `description`. |
| `server.json` declares 6 tools, version 0.6.9 | CONFIRMED | File lists exactly 6 tools; `"version": "0.6.9"` and `packages[].version: "0.6.9"`. |
| `SKILL.md` says "5 Novada MCP tools" | CONFIRMED | Line 12: "You have access to 5 Novada MCP tools." |
| LICENSE file exists | CONFIRMED | `/Users/tongwu/Projects/novada-mcp/LICENSE` present. |

---

## Ready for Human Approval: YES

Reason: All 5 P0 issues are confirmed real defects with verified source locations and clear minimal fixes. The 3 runtime crashes (research null-crash, extract uncaught exceptions, unblock false label) are each fixable in under 30 lines of code with no API surface change. The manifest sync (server.json) and fields.ts fix are the two remaining P0 items — both low-risk and self-contained. No P0 fix requires a backend change. The 10 P1 items are either documentation/string changes (safe) or code changes with clear test coverage paths. The combined plan will bring LobeHub score from 61 to approximately 83/100 and eliminate all confirmed agent-crash scenarios.
