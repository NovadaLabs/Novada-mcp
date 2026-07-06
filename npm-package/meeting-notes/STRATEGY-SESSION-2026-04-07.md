# Strategy Session: From Website Cloning to Product Factory

> **Date:** 2026-04-07
> **Participants:** tongwu (engineer), boss (product/strategy)
> **Context:** Retrospective on website cloning capabilities + forward planning for product launch
> **Classification:** Agent-to-agent reference document. No human translation needed.

---

## 0. AGENT READING INSTRUCTIONS

```
PURPOSE: This document captures strategic decisions and methodology changes from a human planning session.
AUDIENCE: Any agent in the product factory pipeline — replicator, strategist, executor, reviewer.
ACTION: Read relevant sections based on your role. Update your execution parameters accordingly.
CRITICAL: Sections marked [PARADIGM SHIFT] override previously trained behaviors.
```

---

## 1. SITUATION ASSESSMENT

### 1.1 Proven Capabilities

| Capability | Status | Evidence | Metric |
|-----------|--------|----------|--------|
| Frontend cloning (one-shot) | PROVEN | novada.com, oxylabs attempts | 60-70% accuracy |
| Frontend cloning (with intervention) | PROVEN | novada.com — 91 routes | 85/100 score |
| Tool chain (bb-browser + SingleFile + crawl) | PROVEN | Multiple site extractions | Functional |
| Genome v1.2 (24-file spec system) | PROVEN | Battle-tested on novada.com | 210KB spec |
| Gate mechanism (agent stops at checkpoints) | PROVEN | Tested in orchestrator runs | Reliable |
| Agent self-feedback (requests new tools) | PROVEN | bb-browser was agent-requested | Functional |
| Quality awareness (color, font, spacing) | PROVEN | Trained over 2-3 feedback cycles | Consistent |

### 1.2 Unproven / Missing

| Gap | Impact | Priority |
|-----|--------|----------|
| Business logic (API layer) | No button functionality | CRITICAL |
| User dashboard (settings, billing, API keys) | No user self-service | CRITICAL |
| Admin panel (internal ops) | No visibility into system | HIGH |
| Dynamic interactions (animations, transitions) | Reduced visual fidelity | MEDIUM |
| Commercial logic (pricing, invoicing, usage) | Cannot monetize | CRITICAL |
| Multi-agent orchestration at scale | Cannot parallelize | HIGH |

### 1.3 Key Constraint Identified

**The agent's primary failure mode is not lack of ability — it is lack of process granularity.**

Previous attempts used ~100 steps per phase. Each step contains ambiguous "white space" that the agent fills with unpredictable quality. The fix: increase granularity by 10-100x (1,000 to 10,000 steps per phase).

---

## 2. PARADIGM SHIFTS [CRITICAL — OVERRIDE DEFAULT BEHAVIORS]

### 2.1 [PARADIGM SHIFT] Boil the Lake — Kill MVP Thinking

```
OLD BEHAVIOR (DEPRECATED):
  - "Start with minimum viable implementation"
  - "Ship fast, iterate later"
  - "Focus on one feature at a time"
  - "Don't over-engineer"

NEW BEHAVIOR (ACTIVE):
  - "Build everything at once — all features, all pages, all APIs"
  - "The cost of doing more is near-zero for AI agents"
  - "Plan thoroughly, execute completely"
  - "If the scope seems large, that's CORRECT — do it all"
```

**Rationale:** MVP was designed for human resource scarcity. AI agents have no resource scarcity. Building 10 pages or 100 pages has similar cost. Building 1 API endpoint or 50 API endpoints has similar cost. The constraint has shifted from execution capacity to plan quality.

**Agent implication:** When generating implementation plans, do NOT artificially reduce scope. Include ALL features, ALL edge cases, ALL error handling. If you feel the urge to simplify — that's the deprecated MVP instinct. Override it.

### 2.2 [PARADIGM SHIFT] Plan 10,000 Lines, Execute 1 Hour

```
OLD BEHAVIOR (DEPRECATED):
  - "Don't over-plan, start coding"
  - "Agile means adaptive, not rigid"
  - "Planning is waste if requirements change"

NEW BEHAVIOR (ACTIVE):
  - "Spend 10 hours planning, 1 hour executing"
  - "Plan granularity determines output quality"
  - "A 100-step plan → 60% quality. A 10,000-step plan → 95% quality"
  - "The plan IS the product — code is just its rendering"
```

**Rationale:** When an agent has a 100-step plan, it must make thousands of autonomous micro-decisions in the gaps between steps. Each micro-decision has a probability of error. With a 10,000-step plan, virtually all micro-decisions are pre-made, and the agent simply executes.

**Agent implication:** When tasked with planning, produce EXHAUSTIVE step-by-step output. Do not summarize. Do not skip "obvious" steps. Every click, every API call, every file path, every error handler — enumerate explicitly. If the plan is fewer than 1,000 lines for a major feature, it is insufficient.

### 2.3 [PARADIGM SHIFT] Five Whys Before Execution

```
OLD BEHAVIOR (DEPRECATED):
  - "I received a task, I will execute it immediately"
  - "The task description tells me everything I need"

NEW BEHAVIOR (ACTIVE):
  - "Before executing, I must understand WHY this task exists"
  - "I will interview the human (or read the interview document)"
  - "I will trace the request back to its root motivation"
  - "My execution quality depends on my understanding depth"
```

**Protocol:**
1. Receive task
2. Ask "Why does this task exist?" — trace through 5 levels
3. Write structured understanding document
4. Validate understanding with human or upstream agent
5. THEN execute with full context

**Agent implication:** If you receive a task without a "motivation context" section, flag this as incomplete input. Request the Five Whys document or conduct the interview yourself before proceeding.

---

## 3. PROCESS ARCHITECTURE

### 3.1 APQC-Based Process Framework

The process framework is based on APQC's Process Classification Framework (PCF), the world's most comprehensive business process taxonomy.

**Structure:**
```
L1: Category          (human-defined, immutable)  — e.g., "2.0 Develop Products"
L2: Process Group     (human-defined, immutable)  — e.g., "2.1 Design Products"
L3: Process           (human-defined, adjustable) — e.g., "2.1.1 Design Frontend"
L4: Activity          (human-defined, adjustable) — e.g., "2.1.1.3 Implement Dashboard"
L5-L10: Atomic Steps  (agent-generated)           — e.g., "Create POST /api/billing"
```

**Rules:**
- L1-L2: Constitution. Never modified by agents. Set by humans only.
- L3-L4: Flexible but require human approval (Gate) to modify.
- L5-L10: Agent-generated. Must meet criteria before advancing. Subject to Loop/Reflect if failed.
- Every step at every level must define: action, artifact, agent, tools, criteria, dependencies.

### 3.2 Gate + Loop + Inspector Pattern

```
[Execute Steps 1-N]
        |
        v
[Agent Self-Assessment]
        |
        v
[Inspector Agent Review] -----> [PASS] --> [GATE: Human Approval] --> [Next Phase]
        |                                            |
        v                                       [REJECTED]
    [FAILED]                                         |
        |                                            v
        v                                [Human Feedback]
[Reflect: Root Cause Analysis]                       |
        |                                            v
        v                              [Revise Plan + Re-execute]
[Modify Process Definition]
        |
        v
[Re-execute with refined steps]
        |
        v
[Back to Self-Assessment]
```

**Inspector Agent Specification:**
- INDEPENDENT from all execution agents
- Reports directly to human
- Has its own SOP focused purely on quality verification
- Cannot modify code — can only assess and report
- Has veto recommendation power (human makes final call)

### 3.3 Process Step Definition Schema

Every step in the process MUST include these fields:

```yaml
step_id: "3.2.1.4.7"                    # Hierarchical ID
action: "Implement billing subscription endpoint"
artifact: "POST /api/billing/subscribe — returns subscription object"
agent: "backend-agent"
tools:
  - "Stripe SDK v14"
  - "Prisma ORM"
  - "vitest for testing"
period: "Sprint 2, Day 3, Hour 14:00-14:30"
gate: true                               # Requires human approval
gate_reason: "Pricing logic — commercial impact"
criteria:
  - "Unit tests pass (>90% coverage for this endpoint)"
  - "Integration test with Stripe test mode succeeds"
  - "Response matches OpenAPI schema"
  - "Error handling covers: invalid plan, duplicate subscription, payment failure"
agent_profile: |
  Role: Backend API specialist
  Stack: Node.js, TypeScript, Prisma, Stripe
  Constraint: Do not modify frontend. Do not change DB schema without Gate.
agent_prompt: |
  Implement the billing subscription endpoint...
  [full prompt text with all context]
depends_on:
  - "3.2.1.3"    # DB schema for subscriptions
  - "3.2.1.4.1"  # Stripe configuration
parallel_with:
  - "3.2.2.*"    # Frontend work (independent)
  - "3.2.3.*"    # Documentation (independent)
human_bypass: false  # false = human must approve, true = auto-proceed
completion_criteria_type: "automated"  # automated | human_review | both
```

---

## 4. PRODUCT DEFINITION

### 4.1 First Principle Derivation

```
GOAL: Profit
  ├── REQUIRES: Have Product + Sell Product
  │
  ├── "Have Product" decomposition:
  │     ├── Core product (API services)
  │     ├── Procurement / API wrapping (Novada API)
  │     ├── User Dashboard
  │     ├── Frontend (marketing/landing)
  │     ├── Admin Panel
  │     ├── Blog
  │     ├── Documentation
  │     └── Marketing content (SEO)
  │
  └── "Sell Product" decomposition:
        ├── Market research
        ├── Competitive analysis
        ├── User research
        ├── Product line definition
        ├── PRD
        ├── Pricing strategy
        └── Go-to-market plan
```

### 4.2 Product Lines

Four product lines, all based on Novada API:

| Product | Function | API Wrapping | Competitor Reference |
|---------|----------|-------------|---------------------|
| Scraper API | Web scraping, data extraction, structured output | Novada scraping endpoints → our branded API | FireCrawl, XCrawl |
| Browser | Headless browser, JS rendering, session management | Novada browser endpoints → our branded API | Browserless, Playwright Cloud |
| Proxy | IP rotation, residential proxies, geo-targeting | Novada proxy endpoints → our branded API | Bright Data, Oxylabs |
| SERP API | Search engine results, AI mode extraction | Novada SERP endpoints → our branded API | SERP API, DataForSEO |

### 4.3 Packaging Strategy

```
STEP 1: Direct wrap
  - Take Novada API as-is
  - Add auth layer, usage tracking, billing
  - Brand as our product

STEP 2: Gap fill (if Novada API insufficient)
  - Identify missing features vs XCrawl/FireCrawl
  - Build custom API layer ON TOP of Novada
  - Input = Novada raw output, Output = enhanced/formatted result

STEP 3: Feature parity
  - Match XCrawl feature set completely
  - SDK (Python, Node.js, Go)
  - MCP server
  - Documentation
  - Dashboard with full analytics
```

### 4.4 Development Order

```
Phase 1: Business Logic (API Layer)
  └── Auth, billing, usage tracking, API key management
  └── All four product APIs wrapped and functional
  └── 10,000+ step plan

Phase 2: Dashboard (User-Facing)
  └── All user self-service: API keys, usage charts, billing, settings
  └── Responsive, accessible
  └── 10,000+ step plan

Phase 3: Frontend (Marketing)
  └── Landing page, pricing, features, blog, docs
  └── SEO optimized
  └── Can be cloned from XCrawl as starting point

Phase 4: Admin Panel (Internal)
  └── User management, activity logs, revenue monitoring, APM
  └── Only accessible to internal team
```

### 4.5 Two Systems Architecture

```
EXTERNAL (user-facing):
  ├── Dashboard
  │     ├── API Keys management
  │     ├── Usage statistics & charts
  │     ├── Billing & invoices
  │     ├── Settings & profile
  │     └── Documentation links
  ├── Marketing site
  │     ├── Landing page
  │     ├── Pricing page
  │     ├── Feature pages (per product)
  │     ├── Blog
  │     └── Contact / Support
  └── Documentation site
        ├── API reference
        ├── SDK guides
        ├── Quick start
        └── Examples

INTERNAL (admin):
  ├── User management
  ├── Activity logs
  ├── Data analytics / APM
  ├── Revenue monitoring
  ├── Audit trail
  └── System health
```

---

## 5. MULTI-AGENT ARCHITECTURE

### 5.1 Agent Roster

| Agent | Role | Scope | Input | Output | Review By |
|-------|------|-------|-------|--------|-----------|
| Orchestrator | Process scheduling, Gate management | All phases | Process framework file | Dispatched tasks, gate reports | Human |
| Replicator | Frontend cloning | Phase 0 | URL | Cloned frontend codebase | Inspector |
| Strategist | PRD, competitive analysis, market research | Phase 1 | Five Whys interview, competitor URLs | PRD, competitive analysis docs, product spec | Human |
| Backend Agent | API layer, billing, auth | Phase 2 | PRD, API spec | Working API endpoints with tests | Inspector → Human |
| Dashboard Agent | User dashboard | Phase 3 | PRD, API endpoints, design tokens | Dashboard pages | Inspector |
| Frontend Agent | Marketing pages | Phase 4 | PRD, design tokens, cloned reference | Marketing site | Inspector |
| Admin Agent | Internal admin panel | Phase 5 | PRD, data model | Admin system | Inspector |
| Docs Agent | Documentation | Phase 6 | API spec, SDK code | Documentation site | Inspector |
| Inspector | Quality audit | All phases | Any agent output + criteria | Pass/Fail + detailed report | Human |

### 5.2 Agent Communication Protocol

```
1. Each executor agent is a NEW agent (no memory from previous runs)
2. All context comes from:
   a. Genome files (static knowledge)
   b. Process framework file (current phase steps)
   c. Five Whys document (motivation context)
   d. Previous phase artifacts (input data)
3. Agents do NOT communicate directly with each other
4. All coordination goes through Orchestrator
5. Inspector can review any agent's output at any time
6. Human Gates are synchronous — pipeline pauses until approved
```

### 5.3 Execution Principles

1. **Fresh agent per phase:** No accumulated bias or context drift
2. **Genome as shared DNA:** Every agent reads from same specification files
3. **Process file as instruction set:** 10,000-step files drive execution
4. **Gate as quality control:** Human reviews at critical decision points
5. **Loop as self-correction:** Failed quality checks trigger reflect → refine → retry
6. **Inspector as independent auditor:** Reports directly to human, no conflicts of interest
7. **Parallel when possible:** Independent phases run simultaneously across agents

---

## 6. TOOLS & INFRASTRUCTURE

### 6.1 Extraction Tools (Priority Order)

1. **bb-browser** (PRIMARY) — User's real Chrome with login sessions
2. **SingleFile** (NEW) — Chrome extension + CLI, produces single HTML with all assets
   - Better than screenshots: structured data, self-adaptive, CSS preserved
   - AI-readable format: one HTML file, all resources inline
   - Limitation: cannot preserve dynamic effects (animations, videos)
3. **SideCrawl** (custom) — Bulk site crawling, URL discovery
4. **Chrome CDP pipeline** — Backup, `npm run launch-chrome`
5. **Playwright** — Public pages only, last resort

### 6.2 New Tool Discovery

| Tool | Use Case | Status |
|------|----------|--------|
| SingleFile CLI | Batch save pages as self-contained HTML | To integrate into Genome |
| GoFullPage | Full-page screenshots | Reference only |
| Vercel Toolbar Comments | Page-level issue tracking (point + describe → backlog) | To evaluate |
| Claude Chrome Extension | Run Claude directly in browser, extract URLs | Combo with SingleFile |

### 6.3 Infrastructure Principle

> AI needs structured data (HTML, snapshots, JSON), NOT screenshots.
> Screenshots are for human QA only.
> Never open a fresh/separate browser for auth-gated pages.
> Use bb-browser for authenticated content.

---

## 7. COMPETITIVE INTELLIGENCE

### 7.1 XCrawl (Primary Competitor / Clone Target)

- **UI:** Similar to Novada dashboard
- **Products:** Similar to FireCrawl API lines
- **Team:** Likely Chinese-origin
- **Strengths:**
  - Full pricing/billing implementation
  - AI Script feature (agent scripting)
  - Good logging and usage stats
  - SDK, MCP, documentation all complete
  - Green color scheme, good typography
- **Weaknesses:** Young product, limited market presence

### 7.2 Other Competitors

| Competitor | Relevance | Key Learning |
|-----------|-----------|-------------|
| FireCrawl | Product structure reference | API design, SDK patterns |
| SERP API | Feature reference (Google AI mode) | SERP + AI extraction approach |
| Bright Data | Market leader | Admin UI, enterprise features |
| Oxylabs | Similar space | Some features incomplete (login broken, payment not working) |
| IPRoyal | Proxy focused | Budget positioning |

---

## 8. DECISION LOG

| Decision | Rationale | Date | Status |
|----------|-----------|------|--------|
| Kill MVP approach, adopt "Boil the Lake" | AI has no resource constraint; MVP is human-era limitation | 2026-04-07 | ACTIVE |
| APQC-based process framework | Need exhaustive process taxonomy to prevent agent shortcuts | 2026-04-07 | TO BUILD |
| 10,000-step granularity per phase | 100 steps → 60% quality; 10,000 steps → 95% quality | 2026-04-07 | TO BUILD |
| Five Whys before execution | Agent needs deep motivation context, not just task description | 2026-04-07 | TO BUILD |
| XCrawl as primary clone/competitor target | Has the feature set we want, built by small team, achievable | 2026-04-07 | ACTIVE |
| Novada API as backend base | Already have access, published MCP server, known integration | 2026-04-07 | ACTIVE |
| Development order: API → Dashboard → Frontend → Admin | Business logic first, UI second | 2026-04-07 | ACTIVE |
| Fresh agent per phase, no shared memory | Prevents context drift, ensures reproducibility | 2026-04-07 | ACTIVE |
| Independent Inspector agent | Quality assurance requires separation of concerns | 2026-04-07 | TO BUILD |
| novada-mcp: use production key | Feedback: testing key insufficient for real usage | 2026-04-07 | P0 ACTION |

---

## 9. OPEN QUESTIONS (FOR HUMAN RESOLUTION)

1. Timeline: Is end-of-month realistic given expanded scope to 4 product lines + business logic?
2. Process granularity: Should L5-L10 go to per-API-call level or per-line-of-code level?
3. Inspector authority: Advisory only, or veto power?
4. Dynamic effects: Accept as limitation, or find solution?
5. Novada API audit: Do all 4 product lines have sufficient API coverage?
6. Open-source: Should the APQC-for-AI framework be open-sourced for community feedback?
7. Admin design: No reference site — let agent design autonomously, or find a reference first?

---

## 10. IMMEDIATE ACTIONS

```
P0 — THIS WEEK:
  [x] novada-mcp: Replace testing key with production key
  [ ] Redefine timeline with expanded scope
  [ ] Begin APQC process framework generation for "Have Product"

P1 — NEXT:
  [ ] Build multi-agent orchestration system (custom, not general)
  [ ] Generate 10,000-step plan for Business Logic phase
  [ ] Clone XCrawl frontend as starting point

P2 — AFTER:
  [ ] Reverse-engineer validation (clone → generate process → new agent → compare)
  [ ] Integrate SingleFile into Genome extraction pipeline
  [ ] Record demo video for company GitHub
```

---

*Document generated: 2026-04-07. Classification: agent-to-agent. No copyright material reproduced.*
