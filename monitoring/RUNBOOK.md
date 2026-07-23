# Novada MCP Monitoring — Runbook (check-anytime notebook)

How the 3 monitoring layers work together, how failures are reported, and the fault-domain playbook (what to do when something breaks). Companion to `README.md` (setup) — this is the *operate + triage* notebook. Linear: **Novada MCP — Daily Monitoring Loop** (TOW2-311…316).

---

## 1. The 3 layers (depth × frequency — a funnel)

| Layer | Freq | Answers | Catches |
|---|---|---|---|
| **A** UptimeRobot (root `https://mcp.novada.com`, no token) | ~5 min | *Is the box up?* | total outage · deploy fail · DNS · cert expiry |
| **B** all-tools smoke (`monitoring/smoke`, CI) | 6h | *Do the tools work? Is the tool set intact?* | a tool broke · a tool disappeared/renamed (baseline drift) · auth/quota regression |
| **C** k6 stress (`monitoring/stress`, CI) | daily | *Does it hold under load?* | rate-limit/429 thresholds · latency p95/p99 regression · degradation under concurrency |

**Read them together:**
- A green + **B red** = server up but a tool broke *(the case A alone misses)*.
- A/B green + **C red** = functionally fine, but slow/erroring under load.
- **B baseline drift** = a tool was removed/renamed → CI fails (contract regression).

## 2. How it's reported
- **Real-time:** A → UptimeRobot email + status page the moment root goes down. B/C → GitHub Actions failure notification (+ optional `ALERT_WEBHOOK` → Telegram/Slack).
- **Daily digest (TOW2-314):** A uptime% + B per-tool pass/fail + C latency/error, with **every failure classified by fault domain** + isolation evidence. Delivered to owner; later auto-generated from CI artifacts + UptimeRobot API.
- **On any red:** run the isolation checks → classify → route → report the domain + fix path.

## 3. Fault-domain playbook (route EVERY failure)

| Domain | Tell-tale signal | What we do | Owner |
|---|---|---|---|
| **① MCP code** (`npm-package`) | deterministic; reproducible in tool logic; not endpoint/backend-dependent; B probe fails consistently OR a tool went missing | fix in `npm-package/src` → TDD + **independent review (never self-review)** + test-engineering net → patch bump → **owner-approved** npm publish + hosted deploy → add regression golden (ratchet) | **us** |
| **② Server / gateway** (`hosted-server`, mcp.novada.com) | HTTP-layer: 401/429/5xx from gateway · no-progress/timeout on long calls · version desync · telemetry gaps; A red or B auth/quota patterns | fix in `hosted-server/` → **owner-approved** `deploy-hosted.sh` → VERIFY golden gate. *(e.g. TOW2-310 research no-streaming)* | **us** |
| **③ Backend / upstream** (scraper/SERP/proxy/extractors) | error text `upstream…failed` / `维护中` · 520 / API_DOWN · **also broken on dashboard.novada.com** · empty/slow SERP | **escalate to 灵匠 backend (TOW2-305)**; surface honestly + retry/fallback where possible; can't fix in the wrapper | **灵匠** |
| **④ Client** (Claude/Cursor MCP integration) | "No approval received" · "tool not found" *yet present in our `tools/list`* · client idle timeout; **NOT reproducible via direct API** | document; not our code fix | **client** |

**Isolation method (how to classify):** direct-endpoint JSON-RPC test → isolates **client**; generic vs typed same error → isolates **backend** vs **wrapper**; component isolation (research vs its search/extract standalone) → orchestration vs backend; error text (`upstream`/`维护中` = backend) + HTTP status (gateway vs tool-level `isError`).

---

## 4. Run log

### 2026-07-23 — first live full-chain run (temp key)
- **A (root liveness):** HTTP 200, 0.2s — **UP**.
- **B (all-tools smoke):** exit 0 — Tier-1 (setup/discover/account/search/extract) all **PASS**; Tier-2 **30/30 tools present, no drift**. **GREEN.**
- **C (concurrency, portable proxy):** 12 concurrent searches → all 200, 5.6s — **GREEN**, no rate-limit at this level. (Real k6 ramp runs in CI.)
- **Findings (classified):**
  - ⚠️ **Server domain — TOW2-310:** `novada_research` deep returned 200 but took **52.7s** with zero interim bytes. Works server-side; a real client's idle timeout fires first → "connector not responding". Fix = **our** hosted-server (MCP progress / SSE keep-alive).
  - ⚠️ **Backend domain — TOW2-305:** extractor platforms (github/x/youtube/yandex/bing) 520 at runtime though the static catalog lists them "available" (also broken on dashboard.novada.com). **Not our code → 灵匠.** Sub-note: the catalog-vs-live-reality gap is itself a server-side truthfulness item to close.
  - ✅ **MCP code domain: clean** — every tool we own passed; tool set intact.
  - ✅ **Client domain:** the approval-gate / "tool not found" from TOW2-310 are client-side (annotations correct, tool present + executes on direct call).
- **Verdict:** MCP code healthy. One server-side fix (TOW2-310 streaming). Backend outages tracked (TOW2-305). No regressions in our surface.
