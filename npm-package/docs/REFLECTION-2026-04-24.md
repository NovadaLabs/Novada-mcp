# Orchestrator Reflection — novada-mcp Agent Experience Improvements
**Date:** 2026-04-24  
**Session type:** Autonomous orchestration (2 rounds, multi-loop)  
**Orchestrator model:** Opus 4.6  
**Sub-agent model:** Sonnet 4.6 (all)

---

## What Was Done

### Round 1 — Research (2 loops)

**Loop 1** dispatched 4 parallel agents:
- **R1** (prior session): MCP spec analysis — Prompts, SKILL.md, ARIA snapshots, Tool Groups, Tasks spec
- **R2** (prior session): Bright Data token optimization (61% reduction methodology), new MCP entrants (Exa 4300★, Tavily 1800★, Apify 1100★), Firecrawl Claude plugin structure
- **R3** (prior session): 9 documented agent workflow failure patterns from GitHub issues across MCP tools
- **A2** (prior session): Full audit of all 11 novada-mcp tools — scored 6-10/10, top 5 gaps identified

**Loop 2** was A1 synthesis — executed by orchestrator directly (no agent needed, data was already in context):
- Produced `docs/COMPETITIVE_INTELLIGENCE_v2.md` — agent-experience-focused competitive analysis

### Round 2 — Implementation + Testing (2 loops)

**Loop 1** dispatched 3 parallel implementation agents:
- **I1** (`src/resources/index.ts`): Added `novada://scraper-platforms` (full platform catalog + recovery/efficiency guide)
- **I2** (`src/index.ts`, `src/tools/browser.ts`, `src/tools/types.ts`): Fixed browser description, added `aria_snapshot` action, clarified `novada_unblock`
- **I3** (`src/prompts/index.ts`, `src/tools/types.ts`): Added `scrape_platform_data` + `browser_stateful_workflow` prompts, improved operation field

**Reviewer agent** (independent, code-reviewer subagent):
- Caught 1 HIGH issue: `page.accessibility.snapshot()` does not exist in playwright-core v1.59.1 (API removed in v1.46). Correct API is `page.ariaSnapshot()`.
- Caught 2 LOW issues: phantom `list_platforms` operation, duplicate `**Tip:**` key

**Loop 2** — applied reviewer fixes + added 2 tests:
- Fixed `aria_snapshot` to use `page.ariaSnapshot()` (returns YAML string directly, no helper needed)
- Deleted dead `formatAriaTree()` helper
- Fixed phantom operation in scraper-platforms resource
- Fixed duplicate `**Tip:**` in unblock description
- Added 2 new tests for `aria_snapshot` (YAML return + null handling)

**Final state:** 368 tests pass (was 366), build clean.

---

## Agent Quality Assessment

### I1 (Resources expansion) — 9/10
**What worked:** Clean execution. Took the spec and built the platform catalog correctly. Good structure, organized by category. Added the failure recovery and token efficiency sections without over-engineering.  
**What didn't:** Introduced the phantom `list_platforms` operation — a hallucination suggesting an API operation that doesn't exist. Root cause: agent extrapolated from "129 platforms" to "there must be a list API" without checking the code.  
**Lesson:** Platform-specific agents can hallucinate operations when they don't have access to the actual implementation.

### I2 (Browser + descriptions) — 7/10
**What worked:** The description updates were accurate. The `novada_unblock` vs `novada_extract` clarification is now clearly "raw HTML vs cleaned text." Browser description correctly documents session_id.  
**What didn't:** Critical API error in `aria_snapshot` — used `page.accessibility.snapshot()` which was removed from Playwright in v1.46. Agent knew the conceptual API but used the deprecated version. The reviewer caught this.  
**Lesson:** Agents making Playwright API calls need to verify the exact API against the installed version. `(page as any)` casts bypass TypeScript protection — more dangerous than expected.  
**Risk pattern:** The `formatAriaTree()` helper was completely unnecessary (YAML comes back as a string from the new API) but was added anyway — agents tend to add infrastructure when a simpler solution exists.

### I3 (Prompts + types) — 9/10
**What worked:** Both prompts are well-structured. The `scrape_platform_data` prompt correctly gates on reading the resource first (step 1). The `browser_stateful_workflow` prompt handles the session_id optional case correctly. The `operation` field description is now much more useful.  
**What didn't:** Minor issue — the `params` placeholder in `scrape_platform_data` (`keyword/query/url`) could be misread by a less-capable LLM as a literal key name. Low risk but imprecise.

### Reviewer — 10/10
**Caught:** The Playwright API bug that all 3 implementation agents missed. This is exactly what an independent reviewer is for — it has no prior context and reads the code fresh against the stated requirements.  
**Signal:** The reviewer checked `node_modules/playwright-core/lib/client/page.js` to verify the API exists. This is the right behavior — don't assume, verify.

---

## What's Good About the Improvements

1. **Scraper discoverability is now solved** — `novada://scraper-platforms` is a complete reference catalog. An agent doing an Amazon scrape no longer needs to guess `amazon_product_by-keywords`. It reads the resource, finds the exact operation, gets the required params. This eliminates the #1 agent failure mode for `novada_scrape`.

2. **`aria_snapshot` is the right addition** — Bright Data made ARIA snapshots their browser differentiator in v2.6.0 and they were right. Raw HTML snapshots are 30K chars of noise for an agent. ARIA trees are 3-8K chars of semantic structure. Agents can identify "Submit button" by role, not by `div.btn-primary > span:nth-child(2)`.

3. **Browser description fix is a quick win that actually matters** — When agents read "no state persists," they create new sessions for every call in multi-step workflows. With session_id now documented, agents can correctly chain calls. This affects every browser-heavy workflow.

4. **Failure Recovery Patterns in the guide are actionable** — "When novada_scrape returns Error 11006 → activate at dashboard.novada.com/overview/scraper/ → or use novada_extract as fallback." This is concrete, not vague. An agent hitting this error can self-recover without human intervention.

5. **The conflict matrix worked** — All 3 implementation agents ran in parallel. Zero merge conflicts. I1 owned resources.ts, I2 owned index.ts+browser.ts+types.ts, I3 owned prompts.ts (with types.ts changes that didn't conflict with I2's changes because they touched different lines).

---

## What Didn't Work

1. **Playwright API version gap** — I2 used a deprecated API. This is a systemic problem when agents write code touching external libraries: they know the *concept* but may use the *wrong version* of the API. Mitigation: include the installed package version in the agent prompt when the task involves library-specific APIs. "playwright-core v1.59.1 — use `page.ariaSnapshot()` not `page.accessibility.snapshot()`."

2. **Phantom API operation hallucination** — I1 invented a `list_platforms` operation that doesn't exist. Pattern: agent adds a "helpful" example of how to do something, extrapolates beyond the spec. The fix (which the reviewer caught) was simple, but it's a reminder that agents fill in gaps they think exist. Better prompt discipline: "Only add what is documented in the code. Do not add illustrative examples that aren't real."

3. **Round 1 Loop 2 synthesis was unnecessary** — I executed A1 synthesis myself since the data was in my context. The "2-loop" structure for Round 1 was over-specified. A synthesis agent makes sense when the research data is spread across multiple agent outputs that need reconciling. When the orchestrator already has the full synthesis, dispatching an agent just to write a document is waste. Next time: collapse synthesis into the orchestrator step unless the research data genuinely needs an independent synthesis pass.

---

## How Sub-Agent Quality Compares to Prior Sessions

This was the third session running the orchestrator pattern. Quality trending:

| Session | Bug rate | Reviewer catches | Build PASS rate |
|---------|----------|-----------------|----------------|
| Session 1 (AgentRecall) | 1 bug per 3 agents | trajectory key bug | 4/4 built |
| Session 2 (AgentRecall) | 0 bugs | no catches | 5/5 built |
| Session 3 (novada-mcp) | 1 bug per 3 agents | Playwright API bug | 3/3 built |

Observation: Implementation agents consistently build clean (TypeScript). Runtime bugs are the gap — things that only manifest when the code executes. TypeScript's `(page as any)` cast is a systematic bypass of protection; agents overuse it because it eliminates friction.

---

## What Remains (not done)

Based on the COMPETITIVE_INTELLIGENCE_v2.md P0/P1/P2 list:

**P1 remaining:**
- Claude plugin marketplace submission (distribution, not code)
- Token optimization benchmark table (marketing doc)

**Deferred (explicitly):
- MCP Tasks spec — no major client support; implement when Claude Code ships it
- 429 retry guidance in error messages — small impact, can be done in a future session

**Backlog from prior sessions still open:**
- SERP backend not yet activated (blocks novada_search for real users)
- novada_scrape Error 11006 (account-level, can't fix in code)

---

## Token Budget for This Session

Total across all agents:
- R1, R2, R3, A2 (prior session): ~150K tokens (estimated from session summary)
- A1 (orchestrator, no agent): minimal
- I1, I2, I3: ~108K tokens (from agent reports: 33K + 44K + 31K)
- Reviewer: ~55K tokens
- Orchestrator overhead: ~40K tokens
- **Total estimate: ~350-400K tokens**

Value delivered: 368 tests passing, 5 meaningful improvements to agent experience, reviewer-validated. At Opus 4.6 pricing, this session's autonomous work would cost approximately $8-12 for the full run. That's competitive with 1 hour of human developer time.

---

## Summary for User

**What shipped (locally, not pushed):**
1. `novada://scraper-platforms` — agents can now discover all 129 platforms without guessing
2. `aria_snapshot` browser action — semantic YAML tree, 70% smaller than raw HTML
3. Fixed browser description (stale "no state persists" removed)
4. Two new prompts: `scrape_platform_data`, `browser_stateful_workflow`
5. Failure recovery + token efficiency guide in `novada://guide`

**Build:** Clean. 368/368 tests pass.  
**Files changed:** `src/index.ts`, `src/tools/browser.ts`, `src/tools/types.ts`, `src/prompts/index.ts`, `src/resources/index.ts`, `tests/tools/browser.test.ts`  
**CHANGELOG:** Updated for v0.8.4 (pending your review).

**Your decision:** Push to GitHub as v0.8.4? Or more iteration first?

---

*This reflection is local-only. Do not push to public repository.*
