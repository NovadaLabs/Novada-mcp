# Novada MCP — Product Roadmap & Orchestration Plan
**Version:** post-v0.8.1
**Owner:** Novada Engineering
**Orchestrator:** Claude (main context) — delegates each phase to sub-agents
**Purpose:** Step-by-step build plan from current state to competitive parity and beyond

---

## How This Document Works

This is the orchestrator's master plan. Every phase produces a discrete, testable artifact.
Sub-agents are spawned per phase with a self-contained prompt referencing this document.
The orchestrator verifies each checkpoint before unlocking the next phase.

**Three success levels measured at every checkpoint:**

| Level | Question | Signal |
|-------|----------|--------|
| **Test success** | Does `npm test` pass with new tests for the feature? | 0 failures, coverage ≥ 80% for changed files |
| **Product success** | Does the feature do what it claims in the tool description? | Live test with real API key returns expected output |
| **MCP success** | Does an LLM agent make correct decisions using this tool? | Agent hint quality + tool selection accuracy |

---

## Module Registry — What File Does What

Every sub-agent must read this section before touching code.
**Never add a feature to the wrong module.**

```
src/
├── tools/           ← One file per MCP tool (agent-facing interface)
│   ├── search.ts        novada_search  — SERP via 5 engines
│   ├── extract.ts       novada_extract — URL content extraction
│   ├── crawl.ts         novada_crawl   — multi-page site crawl
│   ├── map.ts           novada_map     — URL discovery / sitemap
│   ├── research.ts      novada_research — multi-step synthesis
│   ├── scrape.ts        novada_scrape  — 129-platform structured data
│   ├── proxy.ts         novada_proxy   — residential proxy config
│   ├── browser.ts       novada_browser — browser automation actions
│   ├── unblock.ts       novada_unblock — force JS render
│   ├── verify.ts        novada_verify  — claim verification
│   └── types.ts         shared param types + BLOCKED_HOSTS (SSRF guard)
│
├── utils/           ← Infrastructure (not agent-facing, used by tools)
│   ├── http.ts          fetchWithRetry, fetchViaProxy, fetchWithRender
│   │                    detectJsHeavyContent, detectBotChallenge
│   ├── router.ts        routeFetch — smart 3-tier escalation chain
│   ├── browser.ts       fetchViaBrowser, isBrowserConfigured (CDP)
│   ├── credentials.ts   AsyncLocalStorage — SDK credential isolation
│   ├── html.ts          extractTitle, extractLinks, extractMetadata,
│   │                    extractStructuredData, extractMainContent
│   ├── format.ts        formatRecords — JSON/CSV/Excel/HTML/Markdown output
│   ├── rerank.ts        rerankResults — relevance scoring for search
│   ├── params.ts        cleanParams — query parameter cleaning
│   └── index.ts         re-exports all utils
│
├── sdk/
│   ├── index.ts         NovadaClient — TypeScript SDK (npm consumers)
│   └── types.ts         SDK type definitions
│
├── resources/
│   └── index.ts         Agent-facing tool guide (what LLMs see on connect)
│
├── index.ts             MCP server entrypoint — registers all 10 tools
├── cli.ts               CLI entrypoint
└── config.ts            TIMEOUTS, API base URLs, detection thresholds

tests/
├── tools/               One test file per tool (mirrors src/tools/)
├── utils/               One test file per utility
├── sdk/                 SDK integration tests
├── audit/               Security + agent UX audit tests
└── live/                Real API integration tests (requires credentials)
```

**Rules for sub-agents:**
- Adding a new tool → create `src/tools/<name>.ts` + `tests/tools/<name>.test.ts` + register in `src/index.ts` + add to `src/resources/index.ts`
- Adding fetch infrastructure → modify `src/utils/http.ts` or `src/utils/router.ts` only
- Modifying extraction logic → `src/utils/html.ts` only
- Credential handling → `src/utils/credentials.ts` only — never touch process.env directly

---

## Phase 0 — Structure & Baseline (Pre-requisite)

**Goal:** Ensure the codebase is fully navigable before adding features.
**Assigned to:** Orchestrator (no sub-agent needed)
**Status:** ✅ Complete as of v0.8.1

### Deliverables
- [x] Module registry documented (above)
- [x] 326 tests passing
- [x] AsyncLocalStorage credential isolation
- [x] Per-endpoint circuit breaker
- [x] SSRF protection extended (IPv6-mapped, link-local)
- [x] `BACKEND_ISSUES.md` — 6 documented backend blockers
- [x] `MCP_TESTING_MANDATE.md` — 8-angle professional audit framework
- [x] `COMPETITIVE_INTELLIGENCE.md` — competitor feature matrix

### Checkpoint 0 Verification
```bash
npm run build && npm test
# Expected: 25 test files, 326 tests, 0 failures
```

---

## Phase 1 — Distribution: Claude Plugin Marketplace

**Goal:** Get novada-mcp listed as an official Claude Code plugin.
**Priority:** P0 — Firecrawl already has this. Distribution before features.
**Effort:** Low — configuration and submission, no new code.
**Sub-agent prompt file:** `docs/agent-prompts/phase1-marketplace.md`

### Why First
Firecrawl's `claude plugin install firecrawl@claude-plugins-official` gives them a distribution channel we don't have. A marketplace listing means zero-friction install for every Claude user. This is pure reach with minimal engineering.

### Tasks
1. **Read** `@anthropic-ai/claude-code` plugin docs — understand submission requirements
2. **Create** `claude-plugin.json` manifest (tool descriptions, install command, setup flow)
3. **Add** `/novada:setup` slash command — walks user through `NOVADA_API_KEY` configuration
4. **Add** `/novada:status` slash command — shows configured keys + tests connectivity
5. **Update** `smithery.yaml` — verify MCP Registry listing is current
6. **Submit** to Claude plugin marketplace via Anthropic's submission process

### Files to Create/Modify
```
claude-plugin.json          ← NEW: plugin manifest
src/cli-commands/setup.ts   ← NEW: /novada:setup implementation
src/cli-commands/status.ts  ← NEW: /novada:status implementation
smithery.yaml               ← UPDATE: verify current
README.md                   ← UPDATE: add Claude plugin install instructions
```

### Success Criteria
| Level | Criterion |
|-------|-----------|
| Test | `npm test` still passes with new CLI command tests |
| Product | `claude plugin install novada` works in Claude Code |
| MCP | User can go from zero to first extraction in < 2 minutes |

---

## Phase 2 — Publish Token Benchmark

**Goal:** Document novada-mcp's token efficiency vs Bright Data's published 61% reduction.
**Priority:** P1 — Low effort, high business impact.
**Effort:** Very low — benchmarking + docs.
**Sub-agent:** Not required, orchestrator handles.

### Why
Bright Data published exact numbers (37,500 → 14,500 tokens with all optimizations). We have a structural advantage: 10 smart tools vs 65. But we haven't quantified or published it. Enterprise buyers care about token costs.

### Tasks
1. Measure: count tokens in tool definitions for novada (10 tools) vs Bright Data (65 tools, default)
2. Measure: average response token count for equivalent tasks (`extract`, `search`, `scrape`)
3. Create `docs/TOKEN_EFFICIENCY.md` with benchmark table
4. Add token efficiency section to `README.md`
5. Add token count to `## Agent Hints` in key tool outputs

### Success Criteria
| Level | Criterion |
|-------|-----------|
| Test | No new tests required |
| Product | `docs/TOKEN_EFFICIENCY.md` has real measured numbers, not estimates |
| MCP | README token efficiency section is accurate and shareable |

---

## Phase 3 — PDF Extraction

**Goal:** Add PDF support to `novada_extract` — extract text, tables, and structure from PDF URLs.
**Priority:** P1 — Both Bright Data and Firecrawl have this. Clear gap.
**Effort:** Medium.
**Sub-agent type:** `general-purpose`

### Approach
Use `pdf-parse` or `pdfjs-dist` to extract text from PDF URLs. Integrate into `novada_extract` as a detected content type — when a URL returns `content-type: application/pdf`, route to PDF extraction instead of HTML extraction.

### Architecture
The PDF path belongs in `src/utils/html.ts` as a new `extractPdf(buffer: Buffer)` function. The router in `src/utils/router.ts` detects PDF content type and calls it. No new tool — `novada_extract` handles it transparently.

```
novada_extract(url: "https://example.com/report.pdf")
→ router.ts: detects Content-Type: application/pdf
→ html.ts: extractPdf(buffer) → { title, content (markdown), pages, tables }
→ returns same format as HTML extraction + pdf_pages: N metadata
```

### Files to Create/Modify
```
src/utils/pdf.ts            ← NEW: extractPdf(buffer) → ExtractedContent
src/utils/router.ts         ← UPDATE: detect PDF content type, route to extractPdf
src/utils/html.ts           ← UPDATE: export ExtractedContent interface
src/tools/extract.ts        ← UPDATE: add pdf_pages to output metadata
tests/utils/pdf.test.ts     ← NEW: unit tests for PDF extraction
```

### Dependencies to Add
```bash
npm install pdf-parse
npm install --save-dev @types/pdf-parse
```

### Success Criteria
| Level | Criterion |
|-------|-----------|
| Test | `tests/utils/pdf.test.ts` — min 8 tests: text PDF, scanned (graceful fail), table detection, large PDF (>10MB cap), URL detection, markdown output format |
| Product | `novada_extract("https://arxiv.org/pdf/2304.03442")` returns clean markdown with paper content |
| MCP | Agent hint in output mentions `pdf_pages: N` so agent knows it read a PDF |

### Checkpoint 3 Verification
```bash
npm run build && npm test
# Expected: new test file, all 326 + N new tests passing
# Manual: test with a real arxiv PDF URL
```

---

## Phase 4 — Persistent Browser Sessions (`novada_browser` Enhancement)

**Goal:** Add session persistence to `novada_browser` — maintain cookies, localStorage, and page state across multiple tool calls.
**Priority:** P1 — Both Bright Data and Firecrawl have this. Enables authenticated multi-step workflows.
**Effort:** High.
**Sub-agent type:** `general-purpose`

### Why This Matters
Current `novada_browser` is stateless — every call opens a new browser, does one thing, closes. This means:
- Cannot stay logged in between calls
- Cannot paginate through results
- Cannot do multi-step form flows

Firecrawl's `/interact` model: scrape → persist scrapeId → take actions → stop.
Our model: `session_id` parameter on all browser calls — same session reused if provided.

### Architecture

```
novada_browser(action: "navigate", url: "...", session_id: "my-session")
→ browser.ts: if session_id provided, reuse existing browser page
→ returns: { result, session_id, session_active: true }

novada_browser(action: "click", selector: "...", session_id: "my-session")
→ browser.ts: reuse same page from session "my-session"

novada_browser(action: "close", session_id: "my-session")
→ browser.ts: close page + remove from session map
```

### Session Storage
```typescript
// src/utils/browser.ts — new session map
const activeSessions = new Map<string, Page>();  // session_id → Playwright Page
const SESSION_TTL_MS = 10 * 60 * 1000;  // 10 min idle timeout (matches Firecrawl)
```

### Files to Create/Modify
```
src/utils/browser.ts        ← UPDATE: activeSessions Map, getOrCreatePage(session_id)
src/tools/browser.ts        ← UPDATE: add session_id param to all actions
src/tools/types.ts          ← UPDATE: BrowserParams.session_id optional string
tests/utils/browser.test.ts ← UPDATE: session reuse, TTL cleanup, isolation tests
```

### New Browser Actions to Add
```
close_session   — explicitly close a named session
list_sessions   — list active session IDs (for debugging)
screenshot      — capture page as base64 PNG (already partially exists)
```

### Success Criteria
| Level | Criterion |
|-------|-----------|
| Test | `tests/utils/browser.test.ts` — session create, reuse, TTL cleanup, isolation between session IDs, close action |
| Product | Can call navigate → fill_form → click → extract in 4 separate tool calls with same `session_id` and stay logged in |
| MCP | Agent hint explains: "Use session_id to persist state across multiple browser calls" |

### Checkpoint 4 Verification
```bash
npm run build && npm test
# Expected: all previous + new browser session tests passing
# Manual: authenticate on a test site, read protected content in next call
```

---

## Phase 5 — SERP Quota Unblock (Backend Dependency)

**Goal:** Enable `novada_search` for all API keys — currently blocked by separate SERP quota (B1).
**Priority:** P0 — All 3 competitors have working SERP. This is a product-level gap.
**Effort:** Backend work (not frontend MCP code).
**Owner:** Backend team (not a sub-agent coding task)

### Current State
`novada_search` returns `SERP_UNAVAILABLE` for most API keys because SERP requires a separate quota. Code is correct — the tool degrades gracefully with a Grade A error message.

### MCP-Side Tasks (while awaiting backend)
1. **Update `SERP_UNAVAILABLE` message** — add ETA or link to enable SERP in dashboard
2. **Add `novada_research` fallback mention** — when search is unavailable, research mode uses extract-based discovery
3. **Add SERP test to `tests/live/integration.mjs`** — so we know immediately when backend enables it

### Backend Requirements to Communicate
- SERP quota bundled with standard Scraper API key (not separate activation)
- Support `engine: "google" | "bing" | "duckduckgo"` minimum
- Response format: `{ organic_results: [{ title, url, description, published? }] }`

### Success Criteria (when backend ships)
| Level | Criterion |
|-------|-----------|
| Test | `novada_search("Claude MCP tools 2026")` returns ≥ 5 results in live test |
| Product | All 5 engines return results for the same query |
| MCP | Results are reranked by relevance, agent hints guide to `novada_extract` follow-up |

---

## Phase 6 — Async Webhook Callbacks

**Goal:** Add async job mode to `novada_crawl` and `novada_scrape` — fire-and-forget with webhook delivery.
**Priority:** P2 — Both Bright Data and Firecrawl have this. Required for large crawl jobs.
**Effort:** Medium.
**Sub-agent type:** `general-purpose`

### Why
Currently all tools are synchronous. A 50-page crawl with JS rendering takes minutes and blocks the agent. Async mode: start a job, get a `job_id`, receive results via webhook when done.

### Architecture
```
novada_crawl(url, max_pages: 50, webhook_url: "https://...", async: true)
→ returns { job_id: "job_abc123", status: "queued", webhook_url }

# When done, backend POSTs to webhook_url:
{ job_id, status: "complete", results: [...] }
```

### Files to Create/Modify
```
src/tools/crawl.ts          ← UPDATE: async + webhook_url params
src/tools/scrape.ts         ← UPDATE: async + webhook_url params
src/tools/types.ts          ← UPDATE: AsyncJobResult type
src/tools/job.ts            ← NEW: novada_job_status(job_id) — poll job status
tests/tools/job.test.ts     ← NEW: job status polling tests
```

### Success Criteria
| Level | Criterion |
|-------|-----------|
| Test | `novada_job_status("job_abc123")` with mocked backend returns `{ status, progress, results? }` |
| Product | Large crawl starts immediately, webhook fires with complete results |
| MCP | Agent hint: "For >10 pages, use async: true + webhook_url to avoid timeout" |

---

## Phase 7 — Open Source Agent Scaffold (`novada-agent`)

**Goal:** Provide a 2-command scaffold for a full web agent using novada-mcp.
**Priority:** P2 — Developer acquisition. Firecrawl's `firecrawl create agent` is a reference.
**Effort:** Medium.

### Architecture
```bash
npx novada-mcp create agent --template next
# Scaffolds: Next.js chat UI + novada-mcp tools wired + streaming output
```

### Templates
- `next` — Next.js chat interface with streaming (like Firecrawl)
- `express` — API server for pipeline integration
- `script` — bare Node.js script for quick automation

### Files to Create
```
packages/create-novada-agent/   ← NEW npm package
  templates/
    next/                       ← Next.js template
    express/                    ← Express template
    script/                     ← Node.js script template
  index.ts                      ← scaffolding CLI
```

### Success Criteria
| Level | Criterion |
|-------|-----------|
| Test | `npx novada-mcp create agent --template next` scaffolds and `npm run dev` works |
| Product | Scaffolded agent can do a web research task in < 5 minutes from zero |
| MCP | README links to scaffold; reduces time-to-first-agent to 2 commands |

---

## Phase 8 — MCP Eval Framework (Public)

**Goal:** Publish the eval suite so enterprise buyers can run their own benchmarks.
**Priority:** P2 — Bright Data published theirs; it's an enterprise trust signal.
**Effort:** Low (work already done in `tests/audit/playbook.test.ts`).

### Tasks
1. Expand `tests/audit/playbook.test.ts` to cover all 10 tools
2. Create `mcp-evals/` directory with structured eval configs (matches Bright Data's mcpjam format)
3. Add `npm run eval` script
4. Document in README

### Files to Create
```
mcp-evals/
  configs/
    extract.eval.json
    search.eval.json
    scrape.eval.json
    research.eval.json
    browser.eval.json
  README.md
```

### Success Criteria
| Level | Criterion |
|-------|-----------|
| Test | `npm run eval` runs all eval cases, prints pass/fail per tool |
| Product | Eval results match manual testing outcomes |
| MCP | Enterprise buyers can reproduce benchmarks independently |

---

## Phase Execution Order

```
Phase 0  ✅ Complete (v0.8.1)
   ↓
Phase 1  → Claude Plugin Marketplace (P0, low effort, max distribution impact)
   ↓
Phase 2  → Token Benchmark (P1, very low effort, sales enablement)
   ↓
Phase 3  → PDF Extraction (P1, medium, closes Bright Data + Firecrawl gap)
   ↓
Phase 4  → Persistent Browser Sessions (P1, high, closes Firecrawl /interact gap)
   ↓
Phase 5  → SERP Quota (P0 backend, unblocks novada_search — parallel track)
   ↓
Phase 6  → Async Webhooks (P2, enables large-scale jobs)
   ↓
Phase 7  → Agent Scaffold (P2, developer acquisition)
   ↓
Phase 8  → Public Eval Framework (P2, enterprise trust)
```

**Phase 5 is a parallel track** — it requires backend work. Engineering can proceed on Phases 1–4 simultaneously with backend enabling SERP. When backend ships, Phase 5 MCP-side work is minimal (< 1 day).

---

## Sub-Agent Delegation Template

When spawning a sub-agent for any phase, use this prompt structure:

```
You are implementing Phase N of the novada-mcp roadmap.

Read these files first (in order):
1. ROADMAP.md — section "Phase N" for your task spec
2. ROADMAP.md — section "Module Registry" to understand what file does what
3. BACKEND_ISSUES.md — known backend blockers (do not implement workarounds for these)

Your job:
- Implement only what is listed in Phase N "Tasks" and "Files to Create/Modify"
- Write tests first (TDD): create test file → watch it fail → implement → watch it pass
- Do NOT touch files outside Phase N's listed scope
- Run `npm run build && npm test` after every file you modify — fix immediately if broken
- When done: run the full suite, confirm all N tests pass, report test count delta

Do NOT:
- Publish to npm
- Modify package.json version
- Change existing tool descriptions without approval
- Add features beyond Phase N scope

Checkpoint report format:
- Test count before: N
- Test count after: N+M
- New tests written: list them
- Files changed: list them
- Manual verification: what you tested live
```

---

## Version Targets

| Version | Phases | Status |
|---------|--------|--------|
| v0.8.1 | Phase 0 — baseline | ✅ Current |
| v0.9.0 | Phase 1 (plugin) + Phase 2 (benchmarks) | Next |
| v0.9.5 | Phase 3 (PDF) | Planned |
| v1.0.0 | Phase 4 (sessions) + Phase 5 (SERP) | Target |
| v1.1.0 | Phase 6 (webhooks) + Phase 7 (scaffold) | Future |
| v1.2.0 | Phase 8 (evals) + competitive parity | Future |

---

## Definition of "Done" for Each Phase

A phase is done when **all three** of these are true:
1. `npm run build && npm test` passes with new tests included
2. The feature can be demonstrated live with a real API key
3. The tool description and `## Agent Hints` section in the output accurately describe the new capability

A phase is **not done** if:
- Tests pass but the feature doesn't work with real credentials
- The feature works but there are no tests
- The output format changed without updating the SDK parser in `src/sdk/index.ts`

---

*This document is the orchestrator's source of truth. Update it as phases complete.*
*Last updated: 2026-04-24*
