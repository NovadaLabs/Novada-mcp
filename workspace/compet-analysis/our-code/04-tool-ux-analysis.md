# novada-mcp Tool UX Analysis

**Scope:** `src/index.ts` tool definitions + `src/tools/setup.ts` + `src/tools/health.ts` + `src/_core/errors.ts`
**Date:** 2026-06-24
**Benchmark:** Anthropic's official ACI guidelines (Appendix 2, "Building effective agents"), MCP spec 2025-06-18

---

## 1. Summary Verdict

The error system (`_core/errors.ts`) is **best-in-class** — structured `agent_instruction` on every classified error, retry timing, failure class. The tool descriptions themselves are **mixed**: core tools (search, extract, research) are good; edge tools (scraper trio, account management) are thin and inconsistent. Proxy family has redundant boilerplate repeated 7 times. No tool uses `outputSchema`, which is a missed opportunity per MCP spec.

---

## 2. Against Anthropic's ACI Best Practices

Anthropic Appendix 2 guidance (verbatim): *"A good tool definition often includes example usage, edge cases, input format requirements, and clear boundaries from other tools."* *"Think of this as writing a great docstring for a junior developer."*

| ACI criterion | Our status | Gap |
|---|---|---|
| Unambiguous when to use | Good on primary tools; weak on scraper trio | Medium |
| Clear boundaries from other tools | Good ("Not for:" sections) | Minor |
| Example usage in description | Only `novada_scrape` has a concrete example | Major |
| Edge cases documented | `novada_unblock`, `novada_crawl` have them; most don't | Medium |
| Input format requirements | In param schemas but rarely in description text | Medium |
| Poka-yoke (hard to misuse) | `render="auto"` default is good; many optional params lack defaults | Medium |
| `outputSchema` declaration | Missing on all 32 tools | Major (spec gap) |
| `agent_instruction` in errors | Excellent — every classified error has one | None |
| `title` field (human-readable) | Not set on any tool | Minor |

---

## 3. Length and Clarity Audit

### Too long / verbose

**`novada_unblock`** (longest, ~380 words): Has duplicate "Not for" sections — the rule about using `novada_extract` instead appears three times in different phrasings. Also documents unimplemented params (`wait_ms`, `block_resources`, `auto_runs`) inline, which teaches agents to pass params that silently do nothing.

**`novada_crawl`** (~260 words): "When to use / Not for" repeated twice. "Not for: Single-URL extraction — use novada_extract." appears both as a bullet in "Common mistakes" and again in the "Not for:" block at the end.

### Too short / thin

**`novada_capture_logs`** (~50 words): No description of what "capture" means in Novada's product vocabulary, what the returned rows look like, or what failure modes to expect.

**`novada_wallet_usage_record`** (~60 words): Documents a server-side API typo (`strat_time`) in the user-facing description — this is an implementation detail, not agent guidance.

**`novada_scraper_submit`** (~100 words): Does not explain what `scraper_type` values exist or what "universal" actually scrapes.

**`novada_proxy_account_list`** (~55 words): No example of what product codes are valid, no description of what a sub-account is used for.

### Appropriate length

`novada_search`, `novada_extract`, `novada_research`, `novada_map`, `novada_verify`: All concise with clear Best-for / Not-for / Key rule structure. These are the model to follow.

---

## 4. Redundancy and Contradictions

### Proxy boilerplate repeated 7 times verbatim

Every proxy variant (`residential`, `isp`, `datacenter`, `mobile`, `static`, `dedicated`) contains this identical block:

```
**Requires:** NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.
```

The parent `novada_proxy` tool also says this. An agent reading all 7 proxy tools has seen this line 8 times. Redundancy wastes tokens and dilutes the unique signal per tool.

### `novada_proxy` vs. specialized tools — unclear routing

`novada_proxy` says: *"Specialized tools: For specific proxy types, use novada_proxy_residential, novada_proxy_isp..."* — yet the tool itself is fully functional. An agent faces two choices with no decision rule: when exactly should it pick the generic tool over the specialized one? The description doesn't answer this.

### `novada_discover` contains a KEY FACT capsule out of place

```
**KEY FACT: ONE API KEY COVERS ALL PRODUCTS.**
```

This belongs in `novada_setup` and `novada_health`, not buried at the bottom of a tool-discovery description. It trains agents to call `novada_discover` to check auth status, bypassing `novada_setup`.

### `novada_health` vs. `novada_health_all` — the difference is unclear

`novada_health_all` says it tests "6 products (vs 5)" and "includes the Unblock API probe." But `novada_health`'s description mentions "Search, Extract, Scraper API, Proxy, and Browser API" — that's 5, and the extra one in `_all` is Unblock. An agent deciding between them won't understand why 5 vs 6 matters. The correct routing signal would be: *"Use health for quick pass/fail; use health_all when health shows a failure and you need diagnostic detail."*

---

## 5. Error Message Quality

**`_core/errors.ts` is excellent.** Every error code has:
- `failure_class` (auth / transient / permanent / quota)
- `retry_recommended` boolean
- `retry_after_ms` for retryable codes
- Multi-step `agent_instruction` with alternatives

The structured error format (`Error [CODE]:\nfailure_class:\nretry_recommended:\nagent_instruction:`) is parseable by any agent without special handling.

**One gap:** The Zod validation error at `index.ts:875` appends:
```
Next step: Check parameter names and values — see tool description for valid options.
```
This is correct but generic. When a specific param fails (e.g. `render` must be `'auto'|'static'|'render'|'browser'`), the agent needs the valid values inline — and the error does extract them (`valid values: 'auto', 'static', ...`) for `invalid_value` codes. That's good. But the final message doesn't include the full valid-values list for all issue types. Medium gap.

---

## 6. Parameter Description Quality

### Good examples (from `ExtractParamsSchema`)

- `render`: Clear enum with default + consequence ("Auto mode is 15-100x faster on static sites")
- `fields`: Concrete example: `['price', 'author', 'availability', 'rating']`
- `max_chars`: Gives default + max + a "Common mistake: do not set max_chars=100000 by default" warning

### Weak examples

- `novada_scraper_submit.scraper_type`: Not in the description at all. The schema has no enum — an agent doesn't know valid values.
- `novada_scrape.operation`: Description says "Examples: 'amazon_product_keywords'..." but the instruction to read `novada://scraper-platforms` resource is only in the tool description, not in the param `.describe()`. An agent constructing a call will miss this.
- `novada_browser.actions`: The discriminated union structure is in the JSON schema but the description only lists action types as a comma-separated string. A first-time user will not know the required fields per action type.
- `novada_proxy_account_create.product`: Enum mapping is in the description ("1"=Residential, "2"=Rotating ISP...) but NOT in the Zod schema `.describe()`. The schema only has the string enum values; an agent reading the schema alone won't know what "1" means.

---

## 7. Per-Tool Ratings

| Tool | Score | Reasoning |
|---|---|---|
| `novada_search` | 8/10 | Clear routing, good use cases, appropriate length. Missing: concrete query example, no `outputSchema`. |
| `novada_extract` | 9/10 | Best in class. Clear render strategy guidance, batch mode documented, good field examples. Missing: `outputSchema`. |
| `novada_research` | 8/10 | Marketing-heavy ("No other MCP server can do this") but functionally accurate. Depth values well explained. Missing: example question. |
| `novada_crawl` | 6/10 | Repeated content inflates length by ~40%. Good performance warnings. Missing: `select_paths` regex example. |
| `novada_map` | 8/10 | Concise, clear. "Limited results on SPAs" note is useful. Missing: example showing `search` param. |
| `novada_scrape` | 7/10 | Only tool with a concrete usage example. But `operation` param discovery depends on a resource URI that many agents won't read proactively. |
| `novada_proxy` (generic) | 5/10 | Unclear when to use this vs. specialized tools. "Specialized tools" section at bottom is an afterthought, not a routing rule. |
| `novada_proxy_residential` | 7/10 | Has `agent_instruction` label, escalation guidance. Redundant `Requires` block is wasted tokens. |
| `novada_proxy_isp/datacenter/mobile` | 6/10 each | Same boilerplate, useful `agent_instruction`, but thin on when to escalate between them. |
| `novada_proxy_static/dedicated` | 7/10 | REQUIRED params called out in description. Static/dedicated distinction clear. |
| `novada_verify` | 8/10 | Crisp. "Verdict is signal-based" caveat is important and present. |
| `novada_unblock` | 5/10 | Over-documented with triplication. Unimplemented params advertised. |
| `novada_browser` | 7/10 | Sessions, actions, and constraints all documented. Missing: one concrete action sequence example. |
| `novada_browser_flow` | 7/10 | Good fallback guidance to `novada_browser`. Relationship between the two is clear. |
| `novada_health` | 7/10 | Clear. Missing: proactive suggestion to call this on first use. |
| `novada_health_all` | 7/10 | Useful diff from `novada_health` but "5 vs 6 products" framing is confusing. |
| `novada_discover` | 6/10 | Misplaced KEY FACT. `agent_instruction` label used for "call this first" which is correct, but the tool then also acts as an auth explainer. |
| `novada_setup` | 9/10 | Best setup experience in any MCP server. Output is structured with `status:`, `next_step:`, `get_key:` machine-readable fields. |
| `novada_scraper_submit` | 5/10 | No `scraper_type` values documented. Workflow is correct but opaque on what the tool actually does. |
| `novada_scraper_status` | 8/10 | Exponential backoff guidance is valuable. `agent_instruction` label present. |
| `novada_scraper_result` | 7/10 | Correct dependency on status check. `agent_instruction` present. |
| `novada_ai_monitor` | 7/10 | Clear models list, sentiment output documented. Missing: latency/cost expectation. |
| `novada_monitor` | 6/10 | "Session-scoped" persistence warning is critical but buried in the last line. |
| `novada_wallet_balance/usage_record` | 5/10 | Thin. `strat_time` typo note belongs in a changelog, not the description. |
| `novada_proxy_account_create` | 6/10 | Two-step confirm gate is well documented. Product codes explained in description but not in schema `.describe()`. |
| `novada_proxy_account_list` | 5/10 | Shortest meaningful description. No example, no output format doc. |
| `novada_traffic_daily` | 6/10 | "strat_time" typo note same problem as wallet. |
| `novada_plan_balance_all` | 7/10 | Clear wallet vs. plan distinction. |
| `novada_capture_logs` | 4/10 | "Capture" undefined. No output format. Thinnest description in the entire server. |
| `novada_account_summary` | 8/10 | `agent_instruction` embedded in output (`sections.agent_instruction`). "Why not 3 calls" rationale is excellent. |

---

## 8. Specific Improvement Suggestions

### 8.1 `novada_unblock` — deduplicate and remove unimplemented params

**Before (current — three repetitions of the same rule):**
```
**Tip:** For most anti-bot pages, try novada_extract with render="render" first...
...
Common mistakes:
- This tool returns RAW HTML...
- For extracted content from bot-protected pages, use novada_extract...
- Do not use novada_unblock for simple static pages...
When to use:
- ...
Not for:
- Getting readable content from protected pages — use novada_extract with render='render'.
**Note:** wait_ms, block_resources, auto_runs are accepted but not yet implemented...
```

**After:**
```
Returns raw JS-rendered HTML. Use when you need the full DOM for custom parsing.

**Use when:** novada_extract returned empty/wrong content AND you need raw HTML, not clean text.
**Not for:** Extracting readable content (use novada_extract with render="render").
**Methods:** "render" (Web Unblocker, faster), "browser" (full Chromium CDP, for complex SPAs).
**Wait hint:** wait_for accepts a CSS selector; capture delays until element appears.
**Warning:** Output is dense HTML — do not pass directly to an LLM expecting prose.
```
Removes ~200 words, eliminates unimplemented param docs, preserves all actionable guidance.

---

### 8.2 Proxy family — extract shared boilerplate into first tool description only

**Before (repeated in all 7 proxy tools):**
```
**Requires:** NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.
```

**After — in `novada_proxy` only:**
```
**Auth:** Set NOVADA_PROXY_ENDPOINT. User/pass auto-fetched from NOVADA_API_KEY — no separate credentials needed.
**Routing:** Pick the specialized tool for your use case (see below). Use this generic tool only when you need runtime type selection.
```
In the 6 specialized tools, replace `Requires` block with a single line:
```
See novada_proxy for auth setup.
```

---

### 8.3 `novada_scraper_submit` — document scraper_type values

**Before:**
```
**Required:** url (the page to scrape). Optional: scraper_type (default 'universal'), country (2-letter ISO code).
```

**After:**
```
**Required:** url. Optional: scraper_type ('universal' for any URL, or a platform name from novada_scrape's 129 platforms), country (ISO 2-letter).
**When to use async vs. sync:** Use novada_scrape for 129 supported platforms (sync, faster). Use this tool for URLs outside those platforms or for batch jobs where result latency is acceptable.
```

---

### 8.4 `novada_monitor` — surface the session-scope limitation at the top

**Before:**
```
...
**Session-scoped:** State lives in memory for the MCP session duration. Not persisted across restarts.
```

**After:**
```
**Critical:** Baseline state is in-memory only — lost on MCP restart. Not suitable for long-running monitoring across sessions.
...
```
Moving this from last line to first line prevents the silent "why is it not comparing?" failure mode.

---

### 8.5 `novada_capture_logs` — define "capture"

**Before:**
```
Paginated capture-task logs. Wraps developer-api POST /v1/capture/logs.

**Best for:** Auditing what was captured, debugging failed capture jobs.
```

**After:**
```
Retrieve logs for asynchronous capture tasks (long-running scraper jobs submitted via novada_scraper_submit). Each log row includes task_id, status, URL, created_at, and error details for failed jobs.

**Best for:** Auditing past jobs, debugging why a capture failed.
**Not for:** Real-time task status (use novada_scraper_status with the task_id).
```

---

### 8.6 Add `outputSchema` to high-value tools (MCP spec 2025-06-18)

The MCP spec now supports `outputSchema` on tools. Adding it to at least `novada_search`, `novada_extract`, and `novada_health` would let clients validate structured results and give agents type information without parsing markdown.

Example for `novada_health`:
```json
"outputSchema": {
  "type": "object",
  "properties": {
    "status": { "type": "string", "enum": ["ready", "setup_required", "degraded"] },
    "products": { "type": "array", "items": { "$ref": "#/defs/ProductStatus" } }
  }
}
```

---

### 8.7 `novada_health` vs. `novada_health_all` — add explicit routing rule

**Before** (`novada_health`): No mention of when to prefer health_all.

**After** (`novada_health`):
```
**Quick check only.** For full per-product diagnostics including latency and activation links, call novada_health_all — especially when a tool returns PRODUCT_UNAVAILABLE.
```

---

### 8.8 Remove internal API typo documentation from user-facing descriptions

`novada_wallet_usage_record` and `novada_traffic_daily` both document:
```
Tool emits both `start_time` AND server's typo'd `strat_time` for forward-compat.
```

This leaks implementation details (a server-side bug) into the agent-facing description. Agents never call the raw API — the tool handles the typo internally. Remove these lines from both descriptions.

---

## 9. What Is Working Well (Do Not Change)

1. **Structured error system** — `_core/errors.ts` with `failure_class`, `retry_recommended`, `retry_after_ms`, and multi-step `agent_instruction` templates is the strongest part of the entire codebase. Consistent with Anthropic's ACI guidance.

2. **`novada_setup` output format** — machine-readable status fields (`status:`, `next_step:`, `configured_tools:`) at the end of the output are exactly right. Agents can parse them without LLM reasoning.

3. **"Best for / Not for" structure** — consistent across all primary tools. This is the single most useful routing signal. Maintain it.

4. **`novada_extract` render strategy guidance** — "Leave render=auto (default). Only set render=render for known JS-heavy SPAs. Auto mode is 15-100x faster" — concrete, falsifiable, prevents the most common misuse.

5. **`novada_scraper_status` exponential backoff guidance** — "5s → 10s → 20s → 40s" is actionable and prevents polling storms.

6. **`novada_account_summary` rationale** — "Why not 3 calls: Halves round-trip cost" teaches agents the economic reasoning, not just the mechanic.

---

## 10. Priority Fix List

| Priority | Change | Effort | Impact |
|---|---|---|---|
| P0 | Remove unimplemented params from `novada_unblock` description | 5 min | High — agents currently learn to pass params that do nothing |
| P0 | Surface `novada_monitor` session-scope limitation as first line | 2 min | High — silent data loss for users expecting persistence |
| P1 | Deduplicate proxy `Requires` block (7 occurrences → 1) | 15 min | Medium — token waste, agent confusion |
| P1 | Document `scraper_type` valid values in `novada_scraper_submit` | 10 min | Medium — agents currently guess |
| P1 | Remove `strat_time` typo notes from wallet/traffic descriptions | 5 min | Medium — internal detail leakage |
| P2 | Add explicit routing rule in `novada_health` → `novada_health_all` | 5 min | Medium |
| P2 | Define "capture" in `novada_capture_logs` | 10 min | Medium |
| P2 | Add `novada_scrape` resource URI to `operation` param `.describe()` in schema | 10 min | Medium |
| P3 | Add `outputSchema` to top 3 tools | 60 min | Low (spec compliance, not agent behavior) |
| P3 | Add concrete query/URL examples to `novada_search` and `novada_research` | 15 min | Low |
