# PROJECT_STATE.md — novada-mcpserver

**Single source of truth for any agent picking up this project.**
**Last updated:** 2026-06-02
**Owner:** tongwu
**Phase:** M-5.1 — Vercel deploy LIVE (in progress)

> If you are an agent and the user asks "where is this project?" → read this file end-to-end first. Don't ask the user questions you can answer from here.

---

## 1. What this project is

**Novada Hosted MCP server** — a remote Streamable HTTP MCP endpoint at `https://mcp.novada.com/mcp` that wraps the existing `novada-mcp` npm package's tools (search / scrape / extract / map / crawl / verify / discover / research / 6 proxy variants) so any MCP client (Claude Desktop / Cursor / Cline / Windsurf / VS Code) can use them via one URL — zero install for end users.

This is **KR-5 in tongwu's June 2026 personal OKRs** — Ethan-flagged P0, target LIVE this week or next.

**Not Prismma.** Different product, different brand, different backend account. Prismma is the AI API relay; this is the web-data MCP relay.

---

## 2. Where everything lives

| Thing | Location |
|---|---|
| GitHub repo (public) | https://github.com/NovadaLabs/novada-mcpserver |
| Local checkout | `~/Projects/novada-mcpserver/` |
| **Active deploy source** | `~/Projects/novada-mcpserver/vercel/` (Edge Function, `api/mcp.ts`) |
| CF Workers fallback (deprecated) | `~/Projects/novada-mcpserver/worker/` (kept for reference only; CF free tier blocks subdomain zones) |
| Install landing page | `~/Projects/novada-mcpserver/landing/index.html` (functional v1; Claude Design redo in flight) |
| User-facing docs (bilingual) | `~/Projects/novada-mcpserver/docs/` — README / ARCHITECTURE / INSTALL / DEPLOY / DIRECTORIES |
| **Pre-launch checklist** | `~/Projects/novada-mcpserver/vercel/PRE_LAUNCH_CHECKLIST.md` ← READ BEFORE FLIPPING `STUB_AUTH_WARNING_ACCEPTED` TO `true` |
| KR HTML report | `~/Projects/novada-june-kr-report-2026.html` (Section "KR-5 · Novada Hosted MCP") |
| Upstream npm package (separate repo) | `~/Projects/novada-mcp/` — UNTOUCHED, the actual MCP tool source |
| AgentRecall project slug | `novada-mcpserver` (separate from the npm package slug `novada-mcp`) |

---

## 3. Stack (2026-06-02 — pivot to Vercel)

```
[End user] Claude Desktop / Cursor / Cline / Windsurf / VS Code
    │  POST/GET https://mcp.novada.com/mcp?token=sk-eu-novada-{CUSTOMER_KEY}
    │           (or Authorization: Bearer sk-eu-novada-...)
    ▼
[Vercel Edge Function] mcp.novada.com (CNAME at AWS Route 53 → cname.vercel-dns.com)
    │  api/mcp.ts (~551 lines, Streamable HTTP transport)
    │  - validates customer token (CURRENTLY STUB — see §5)
    │  - per-IP rate limit (Vercel KV, 60/min default)
    │  - per-token monthly quota (Vercel KV, 5000/mo default)
    │  - dispatches to novada-mcp tool handlers (25 tools)
    ▼
[Novada backend] api.novada.com / webunlocker.novada.com
    │  Authenticated via NOVADA_API_KEY env var (upstream key)
```

**Decision history:**
- Initially planned Cloudflare Workers + Wrangler. **Pivoted to Vercel 2026-06-02** because CF free tier requires the root domain (`novada.com`) to be on Cloudflare, but Novada DNS is on AWS Route 53 (migrating the full zone needs domestic tech team + 24-48h propagation + main-site risk).
- Vercel works with any DNS provider via single CNAME, no migration needed.

---

## 4. Vercel project

| | |
|---|---|
| Vercel team | `novadateam-mvps` (Hobby plan) |
| Project name | `novada-mcpserver` |
| Root directory (must set!) | `vercel/` |
| GitHub branch (auto-deploy) | `main` |
| Production URL | _(set after first deploy — record here)_ |
| Custom domain | `mcp.novada.com` (binding pending Step 9) |

**Watch:** novadateam-mvps already hit Hobby build-minute limit historically (per AgentRecall — APQC dashboards). MCP runtime calls are separate quota and don't count against builds; only `git push` triggers builds. Pro upgrade is pending Ethan approval for APQC and would cover this project too.

---

## 5. Environment variables (set in Vercel dashboard, NEVER in code)

| Name | Value | Where it comes from |
|---|---|---|
| `NOVADA_API_KEY` | `<sensitive>` | tongwu's **personal Novada test key** (Web Unblocker product, balance $39.46 at start). **TODO**: swap to a dedicated `hosted-mcp-prod` key once fudong / Novada backend team issues one. The personal key works for v0 launch testing but mixes personal + product traffic. |
| `STUB_AUTH_WARNING_ACCEPTED` | `false` → flip to `true` after reading PRE_LAUNCH_CHECKLIST | Gate. While `false`, every request returns `503 STUB_AUTH_UNACKED`. Intentional — forces operator to read checklist before exposing stub auth. |
| `RATE_LIMIT_PER_MIN` | `60` | Per-IP rate limit. Counter lives in Vercel KV. |
| `FREE_PLAN_MONTHLY_QUOTA` | `5000` | Per-token monthly quota. Counter in Vercel KV, 32-day TTL. |
| `KV_REST_API_URL` | _(auto-injected)_ | Vercel auto-injects when KV store `novada-mcp-quota` is connected to project. |
| `KV_REST_API_TOKEN` | _(auto-injected)_ | Same as above. |

**Hard rule:** NO actual key value goes into this file or any committed file. The PUBLIC GitHub repo would leak. Reference by env var name only.

---

## 6. Five critical patches (preserved in both worker/ and vercel/)

After code review on 2026-06-02 these were applied. Any future port (next runtime / fork) MUST preserve them:

1. **STUB_AUTH_WARNING_ACCEPTED gate** — refuses requests with 503 until operator acks the stub auth limitation
2. **Per-IP rate limit** — KV counter, 60/min default, slows token-prefix brute-force
3. **`novada_browser` + `novada_browser_flow` → 501** — return `NOT_AVAILABLE_ON_HOSTED` with `agent_instruction` field (Playwright doesn't run on Edge runtimes; agent gets told to install local MCP for these tools)
4. **KV/env config fails loud** — 500 `KV_NOT_CONFIGURED` if KV vars missing (no silent degrade)
5. **Token logged as SHA-256 12-char fingerprint** — never `slice(-8)` (that leaks the high-entropy tail of prefix-based tokens)

Recommended (post-launch) — see PRE_LAUNCH_CHECKLIST.md §RECOMMENDED:
- Switch to Upstash INCR for atomic quota counters (KV is read-then-write, can race)
- Restrict CORS (currently `*`)
- Pin Zod 4.x exact major

---

## 7. Status board (2026-06-02 end of session)

### M-5.1 · Remote endpoint LIVE (target 6/8)
- [x] OUTPUT 1: Vercel project code scaffold complete (~551 lines, tsc PASS)
- [x] OUTPUT 2: 5 critical security patches applied
- [x] Pushed to GitHub (public repo, no secrets)
- [ ] OUTPUT 3: Vercel deploy succeeds with all 4 env vars
- [ ] OUTPUT 4: Vercel KV `novada-mcp-quota` connected to project
- [ ] OUTPUT 5: STUB gate flipped to `true` after PRE_LAUNCH_CHECKLIST read
- [ ] OUTPUT 6: AWS Route 53 CNAME `mcp.novada.com → cname.vercel-dns.com`
- [ ] OUTPUT 7: SSL cert auto-issued by Vercel
- [ ] OUTCOME: I add `https://mcp.novada.com/mcp?token=...` to my Claude Desktop and `tools/list` returns 25 tools

### M-5.2 · Marketing + distribution (target 6/15)
- [~] Landing page (functional v1 done; Claude Design redo in flight in independent session)
- [ ] Submit to 5 directories: PulseMCP / Glama / mcpservers.org / mcp.directory / Claude Directory

### M-5.3 · Real traffic proof (target 6/30)
- [ ] Free tier quota meter LIVE
- [ ] Usage dashboard
- [ ] 14d post-launch: ≥10 unique tokens + ≥50 successful calls (non-self)

---

## 8. Blockers / coordination needed

| # | Blocker | Owner | Action |
|---|---|---|---|
| 1 | Linear KR-5 Project | tongwu | Re-auth Linear MCP (currently 403 across all calls). Once unblocked, batch-create KR-5 Project + 3 milestones + ~10 issues mirroring KR-2/3/4 pattern under Incubation team. |
| 2 | Dedicated hosted-mcp API key | tongwu → fudong | Ask Novada backend team for `hosted-mcp-prod` API key separate from personal. Format suggestion in §5. v0 can launch on personal key. |
| 3 | Vercel Pro upgrade | Ethan | Pending approval for APQC; covers this project too. Not blocking v0. |
| 4 | novada_proxy_* tools auth | tongwu | The personal test key is bound to Web Unblocker product — proxy_* tools may need separate auth. Validate during M-5.1 OUTCOME smoke test and document gaps. |

---

## 9. Reference materials for cross-session context

**AgentRecall** (project slug `novada-mcpserver`):
- `recall('2026 mcp target')` — KR-5 full threshold spec with M-5.1/5.2/5.3 OUTPUT/OUTCOME/KILL
- `recall('report user cyan')` — build sprint summary 2026-06-02
- `recall('cf-free-tier-rejects-subdomain')` — critical insight: why we pivoted to Vercel
- `recall('vercel-cname-anywhere')` — critical insight: Vercel works with any DNS

**Competitor reference** (we modeled after these):
- BrightData: `mcp.brightdata.com/mcp?token=` — 5000 calls/mo free, Streamable HTTP
- Tavily: `mcp.tavily.com/mcp/?tavilyApiKey=` — 3 auth modes (URL / Bearer / OAuth)
- Firecrawl: `mcp.firecrawl.dev/{KEY}/sse` — URL-path key

**Standards reference:**
- Anthropic Streamable HTTP transport spec (March 2025) — the convergence point
- WorkOS "Everything your team needs to know about MCP in 2026"

---

## 10. How to resume work on this project (for any agent)

1. **Read this file** end-to-end first.
2. Check §7 "Status board" → first unchecked OUTPUT item = where to resume.
3. If unsure of context, run `recall({ project: "novada-mcpserver", query: "<topic>" })`.
4. Before any code change in `~/Projects/novada-mcpserver/`, read `vercel/PRE_LAUNCH_CHECKLIST.md` to understand pre-deploy constraints.
5. After significant work, update this file (§7 status + §11 changelog) AND save via `remember({ project: "novada-mcpserver", content: "...", context: "decision" })`.

---

## 11. Changelog

| Date | Change | By |
|---|---|---|
| 2026-06-02 | Project scaffold (vercel + worker + landing + docs), pushed to GitHub, 5 critical patches applied, Vercel deploy in progress | tongwu (orchestrator) + 3 build subagents + 2 review subagents + 1 port subagent + 1 docs-fix subagent |
| 2026-06-02 | Repo restructured: `~/Projects/novada-mcp/hosted/` → `~/Projects/novada-mcpserver/` (separate repo) to prevent agent confusion between npm package and deployment | tongwu |
| 2026-06-02 | Pivot CF Workers → Vercel after CF free tier blocked subdomain zones | tongwu (per CF UI feedback) |
| 2026-06-02 | Vercel build #1 failed (TS2307 deep import), #2 vendored novada-mcp/build/, #3 pivot Edge→Node runtime, #4 stub playwright + drop deps. Build #4 (commit 36512bc) Ready ✅. mcp.novada.com binding deferred — user in China hitting GFW DNS poisoning on vercel.app; will test via custom domain. | tongwu + Goldentrii subagent |
| 2026-06-03 | **NEW KR direction** — Ethan / domestic team request: integrate Novada developer-api endpoints (account / usage / billing / key management) into the npm `novada-mcp` package as new MCP tools. **Will become KR-6** in HTML report (separate from KR-5 hosted-server). Research agent dispatched 2026-06-03 to crawl `developer-api.novada.com/zh` for endpoint inventory. **HARD RULE: novada-mcp account-tools work stays LOCAL ONLY in `~/Projects/novada-mcp/` until validated; do NOT push to GitHub or republish to npm without explicit user approval (CLAUDE.md REDLINE).** novada-mcpserver (this repo, hosted deployment) stays on public GitHub. When novada-mcp gets the new tools, vendor refresh into novada-mcpserver/vercel/vendor/ is the propagation path. | tongwu |
| 2026-06-04 | KR-5 landing-page review pass: 6 parallel client-config verification agents (Claude Desktop / Code / Cursor / Codex / Cline / Windsurf) + 1 reviewer; corrected 5 wrong configs against current vendor docs. Added OG + Twitter meta, 1200×630 OG image (Playwright-screenshotted), JSON-LD SoftwareApplication + FAQPage blocks, llms.txt companion file, Try-it-now curl block. Hero status pill changed from "Live on Vercel Edge..." → "Coming online · Vercel Edge build ready" until mcp.novada.com CNAME actually binds. Mobile hero-pill wrap fixed via `sm:hidden` on supplemental factoids. | tongwu (orchestrator) + 8 sonnet subagents |
| 2026-06-07 | **KR-6 multipart root-cause found.** Prior `code:10001 Invalid parameter` on `/v1/proxy_account/*` traced to THREE compounding bugs in `~/Projects/novada-mcp` (branch `kr6-account-tools`): (1) central `devApiPost` helper sent `Content-Type: application/json` but the API requires `multipart/form-data` per docs and fudong 2026-06-05 confirmation; (2) field names wrong (`username` should be `account`, `traffic_limit_mb` should be `limit_flow`, `page_size` should be `limit` for proxy_account/list only — wallet/usage_record genuinely uses `page_size`); (3) missing required fields (`product`, `status` on `proxy_account/create`; `product` on `proxy_account/list`). Fix landed locally on `kr6-account-tools` branch — central helper rewritten to multipart, two tools corrected, 6 audit agents confirmed the other tools through the helper auto-inherit the fix without further changes. 7-question fudong-clarify doc + per-tool smoke harness at `~/Projects/novada-mcp/workspace/kr6-smoke/`. **Still LOCAL ONLY — no push, no publish.** | tongwu (orchestrator) + 7 sonnet subagents |
| 2026-06-11 | **KR-5 LIVE 🚀** — `mcp.novada.com/mcp` serves 26 tools to MCP clients. Got there via 8 stacked module-init bugs: vendor/package.json missing, stale vendor exports, browser stubs clobbered by rsync, missing type:module, pdfjs DOMMatrix polyfills (separate-file ESM ordering), URL parsing on Node runtime, Node↔Fetch adapter at handler boundary, MCP SDK transport API mismatch (passes Node req+res+parsedBody now). Plus: discovered Vercel CLI's `--sensitive` flag silently saves empty values via stdin pipe — 5 env vars were broken since project setup, fixed by REST API DELETE+CREATE as type=encrypted. fudong added Route 53 CNAME `mcp` → `cname.vercel-dns.com`. Upstash free tier signed up directly (Vercel Marketplace removed free tier; direct signup at console.upstash.com still has it — wire-compatible with @vercel/kv). Free quota cut 5000 → 1000 per token. `novada-hosted` added to global `~/.claude/mcp.json` so any Claude Code session has it. Full debug log: `docs/2026-06-11-vercel-deploy-debug-log.html`. | tongwu (orchestrator) + Claude Code subagents |
| 2026-06-11 | **OPEN ITEMS for fudong / next session** — (1) Currently `STUB_AUTH_WARNING_ACCEPTED=true` means any `sk-eu-novada-*` formatted token is accepted with no DB validation. Before broad public share, wire real customer-token check (sub2api or equivalent). (2) Upstream `NOVADA_API_KEY` env var on Vercel is tongwu's personal test key ($229 balance). All hosted-MCP customer traffic currently funnels into this single key's Novada account. **Get dedicated `hosted-mcp-prod` upstream key from fudong before broad sharing.** (3) Vercel env `FREE_PLAN_MONTHLY_QUOTA` was removed (intermittent network couldn't update via REST API); code default now serves 1000. To re-set, use Vercel dashboard or `vercel env add` (NOT via stdin pipe — broken). | tongwu (debug session) |
| 2026-07-03 | **0.9.2 shipped end-to-end.** npm novada-mcp@0.9.2 published (Round 3 fixes + NOV-682 query truncation); public GitHub main+tag pushed; vendor refreshed here (form-data dep added to vercel/package.json — vendor _core/developer_api.js imports it). Discovered + fixed: Vercel `NOVADA_API_KEY` env was EMPTY since project setup (June 2 stdin-pipe bug; the June 11 REST-API fix covered 5 vars but missed this one) — recreated via REST API. NOTE: auth model is now PASS-THROUGH (customer token = their own Novada API key, billed to their account; env key is operator-testing fallback only). Live verify: mcp.novada.com serves 0.9.2-hosted, 12 core tools default / 32 via ?groups=all, live search + NOV-682 marker confirmed. ⚠️ The 4 leaked credentials (public repo git history) still need dashboard rotation. | tongwu + Claude |
