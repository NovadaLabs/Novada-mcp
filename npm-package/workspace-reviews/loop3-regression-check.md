# Loop 3 — Regression Check

---

## FIX REGRESSIONS FOUND

### 1. [scraper_submit.ts:95–99, 125–129] `makeNovadaError` 3rd arg is silently ignored — custom instructions never reach agent

**The fix:** Added 3-arg calls like `makeNovadaError(NovadaErrorCode.PRODUCT_UNAVAILABLE, "...", "Activate the Scraper API at ...")` and `makeNovadaError(NovadaErrorCode.API_DOWN, "...", "Do not poll — ...")`.

**The regression:** `makeNovadaError`'s 3rd parameter is named `detail?` (see `_core/errors.ts:312`). It is stored on the error as `this.detail` but is **never included in `toAgentString()` output** (lines 44–52). The custom action instructions embedded in those 3rd-arg strings ("Activate the Scraper API at …", "Do not poll — there is no task_id to poll with…") are silently discarded. The agent receives only the generic `INSTRUCTIONS[code]` template, not the specific per-call guidance.

**Impact:** The PRODUCT_UNAVAILABLE and API_DOWN errors in scraper_submit.ts lose their specific recovery instructions. The agent sees "This Novada product is not active" but not "Activate the Scraper API at https://dashboard.novada.com/overview/scraper/". The no-task_id case loses "Do not poll" entirely.

---

### 2. [proxy_isp.ts:92–94, proxy_datacenter.ts:92–94, proxy_mobile.ts:101–103, proxy_dedicated.ts:85–87] `env` format missing "To get the actual proxy URL" instruction — inconsistent with residential/static

**The fix:** Proxy masking was applied across all tools. residential and static correctly include `"To get the actual proxy URL with credentials: substitute *** with the runtime value of the NOVADA_PROXY_PASS environment variable."` in their env-format `agent_instruction` blocks.

**The regression:** isp (line 93), datacenter (line 93), mobile (line 102–103), and dedicated (line 86–87) `env` format blocks do **not** include this instruction. Their `agent_instruction` stops after the general advice. The agent reading these tools in env format has no explicit instruction that *** must be substituted with NOVADA_PROXY_PASS.

The `curl` format has the same gap: isp (line 108), datacenter (line 108), mobile (line 117), dedicated (line 102) all omit the explicit substitution instruction that residential/static include.

**Affected lines:**
- `proxy_isp.ts:92–94` (env), `proxy_isp.ts:108` (curl)
- `proxy_datacenter.ts:92–94` (env), `proxy_datacenter.ts:108` (curl)
- `proxy_mobile.ts:101–103` (env), `proxy_mobile.ts:117` (curl)
- `proxy_dedicated.ts:85–87` (env), `proxy_dedicated.ts:101–103` (curl)

---

## FIXES CONFIRMED CORRECT

- **sanitizeServerMsg export:** Properly exported from `_core/errors.ts` (line 152 `export function sanitizeServerMsg`). Correctly imported and used in `scraper_submit.ts:4` and `scraper_status.ts:3`.

- **sanitizeServerMsg coverage (scraper_result.ts):** `scraper_result.ts` does NOT call server message strings from the API into agent-visible output in an unsafe way. The error code paths (10002, 10003) embed `bObj.msg` directly into the `error` field of a JSON object — this is output to the agent as data content (not as trusted agent_instruction), which is acceptable. The file does not import sanitizeServerMsg but also does not need to because it doesn't surface raw server messages as instructions.

- **sanitizeServerMsg coverage (browser_flow.ts):** `browser_flow.ts:167` reads `(err.response?.data as BrowserFlowApiResponse)?.msg` and passes it directly to `makeNovadaError`. This is not sanitized. However the message ends up in the error's `message` field which goes through `toAgentString()` → `safeMsg` (collapses newlines). Full sanitization is not applied but injection risk is low because the message does not appear in `agent_instruction` position — it appears as `Error [API_DOWN]: <msg>`. This is a pre-existing gap, not a regression from the recent fixes.

- **unblock.ts Agent Hints before external content:** Confirmed correct. Lines 45–60: `## Unblocked Content` metadata and `## Agent Hints` section appear before the `<!-- BEGIN EXTERNAL CONTENT -->` boundary. All 3 render mode branches (render/browser/render-failed) are present in the `hints` array (lines 33–41). URL and method metadata are present in the header lines (lines 47–49). Truncation is correctly handled: `htmlLength > maxChars` check at lines 27–28, truncation comment injected at line 58, and `(truncated to ${maxChars})` shown in the metadata line.

- **scraper_status.ts unknown code → "failed":** The unknown code branch (lines 103–106) sets `normalStatus = "failed"` and `errorDetail = \`Unexpected API response code ${body.code}: ${body.msg ?? "no message"}\``. In the switch statement at line 176, `case "failed"` correctly uses `errorDetail ?? "Task failed on the server side."`. The `errorDetail` is populated for the unknown-code branch, so it surfaces correctly.

- **scraper_result.ts axios params fix:** Line 133 uses `params: { task_id, file_type: "json", apikey: apiKey }` — all three query parameters are present. `task_id` is passed directly from `params.task_id` without re-encoding (axios handles URL encoding), so no double-encoding issue.

- **makeNovadaError signature accepts 3 args:** `_core/errors.ts:309–326` signature is `makeNovadaError(code, message, detail?)` — 3 args accepted. No TypeScript error at call sites.

- **Proxy credential masking — "url" format:** All 6 proxy tools use `maskedUrl` (not `proxyUrl`) in every `proxy_url:` output line. The "url" format Node.js/Python usage examples correctly use `maskedUrl` for the Python proxies dict and `"<NOVADA_PROXY_PASS>"` for the Node.js auth object (not the real password). The `agent_instruction` in url format for all 6 tools includes the instruction to read NOVADA_PROXY_PASS from environment.

- **proxyUrl variable — dead variable:** All 6 proxy tools define `proxyUrl = \`http://${encodedUser}:${encodedPass}@${endpoint}\`` containing the real password (residential:75, static:69, isp:70, datacenter:70, mobile:76, dedicated:65) but never reference it in any output path. This is a pre-existing dead variable that creates no runtime security risk (it's never output) but is dead code. Not a regression from recent fixes.

---

## SECONDARY ISSUES (new issues found while checking)

- **[discover.ts:TOOL_CATALOG] 5 tools in TOOL_CATALOG not in TOOLS array (index.ts):** `novada_auth_token`, `novada_browser_area_select`, `novada_proxy_discover`, `novada_scraper_task_list`, `novada_unblock_direct` are listed as `"todo"` in the catalog. These are planned tools and intentionally absent from TOOLS. No regression — just confirming the catalog intentionally includes future tools.

- **[discover.ts:TOOL_CATALOG] `novada_scrape` description mismatch:** The catalog description says "submit-poll task_id lifecycle" but `novada_scrape` is actually synchronous (not async). The async pattern belongs to `novada_scraper_submit/status/result`. Low severity but misleads agents about novada_scrape's behavior.

- **[scraper_submit.ts:113] Generic `makeNovadaError(NovadaErrorCode.API_DOWN, ...)` used for unknown error codes:** Unknown API response codes (not 11006, 11008, 10001, 11000) are mapped to `API_DOWN`. This may misclassify parameter errors or quota errors as infrastructure failures and give the agent wrong retry guidance ("Wait 30–60 seconds"). Not introduced by recent fixes, but worth noting.

- **[proxy_isp.ts:70, proxy_datacenter.ts:70, proxy_mobile.ts:76, proxy_dedicated.ts:65, proxy_residential.ts:75, proxy_static.ts:69] Dead variable `proxyUrl`:** All 6 proxy tools compute `proxyUrl` with the real plaintext password but never use it. If a future developer adds output using `proxyUrl` instead of `maskedUrl`, credentials will leak. Should be removed.
