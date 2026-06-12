# HANDOFF — novada-mcpserver (Hosted MCP)

**Last updated:** 2026-06-04 by Tong Wu's previous session
**Purpose:** Read this first if you're a new Claude Code agent picking up novada-mcpserver work. Everything you need to know lives here.

---

## 0. TL;DR (60 seconds)

**What this repo is:** Hosted MCP server that will live at `mcp.novada.com`. Wraps the `novada-mcp` npm package and exposes it as a Streamable-HTTP MCP endpoint so AI agents (Claude Desktop, Cursor, etc.) can use Novada's data tools without installing anything locally.

**Where we are:**
- ✅ Vercel deploy is **Ready** (commit `36512bc`, Jun 3) — verified at the auto-generated `*.vercel.app` URL
- ✅ 5 critical patches done (Edge → Node runtime, vendored novada-mcp build, stubbed browser tools to fit 50MB bundle, KV wiring)
- 🚨 **Blocker for going LIVE:** `mcp.novada.com` custom domain NOT yet bound. The Vercel deploy is invisible to customers until this DNS step is done.

**The 5-minute path to LIVE:**
1. AWS Route 53 → `novada.com` hosted zone → add CNAME `mcp` → `cname.vercel-dns.com`
2. Vercel project `novada-mcpserver` → Settings → Domains → Add `mcp.novada.com`
3. Wait 1–60 min for DNS propagation
4. `curl https://mcp.novada.com/mcp` → expect HTTP 200 + MCP Streamable handshake

**This is KR-5 in Tong's June OKR.** Currently 30% in HTML, will jump to 60% once CNAME binds, and to 90% once first real traffic flows.

---

## 1. Hard rules (must respect)

These come from Tong's global CLAUDE.md + project-specific decisions:

| Rule | Why |
|---|---|
| **NO `git push` without explicit user approval** | The user has been burned before (proxy4agent v1.8.0 accidental publish). Always ask. |
| **NO `npm publish` without explicit user approval** | Same reason. This repo doesn't publish to npm anyway (it's a Vercel-deployed server), but the principle holds. |
| **NO Vercel production deploys without approval** | Auto-deploy on push to `main` is already wired. If you push you trigger deploy. Hence rule #1. |
| **Browser tools (playwright) are STUBBED in this hosted server** | Intentional — playwright-core busts the 50MB Vercel Hobby bundle. Hosted users wanting browser tools should install `npx novada-mcp` locally. Don't try to "fix" this. |
| **Don't migrate off Vercel until v2** | Decision made 2026-06-04: stay on Vercel for v1 (free tier covers, zero ops, CNAME bypasses GFW). Novada-own-server option deferred. See section 4. |

---

## 2. Files to read on startup (in this order)

1. **`PROJECT_STATE.md`** (this directory) — cross-agent single source of truth. Has the most current build state, env vars, deploy URL, known issues.
2. **`README.md`** (this directory) — quick orientation if you've never seen this repo.
3. **`vercel/api/mcp.ts`** — the actual Vercel function entry point. 551 lines, 5 critical patches preserved at top of file as comments.
4. **`docs/`** — design docs if you need deeper context.

If you only have 90 seconds: just read `PROJECT_STATE.md`.

---

## 3. The current state of play

### What's been built
- `vercel/api/mcp.ts` — Vercel Node.js function that handles MCP Streamable-HTTP transport
- `vercel/vendor/novada-mcp/` — vendored copy of `~/Projects/novada-mcp/build/` (1.5 MB) because the npm package's `exports` field blocks deep imports
- `vercel/package.json` — deps: `@modelcontextprotocol/sdk`, `@vercel/kv`, `axios`, `cheerio`, `exceljs`, `pdf-parse`, `zod` (no playwright-core — see hard rules)
- KV wiring for session state (Vercel KV auto-injects `KV_REST_API_URL` + `KV_REST_API_TOKEN`)
- 3 stubbed browser tools (`tools/browser.js`, `tools/browser_flow.js`, `utils/browser.js`) return `NOT_AVAILABLE_ON_HOSTED` with clear instructions for users to install locally

### What's NOT been built
- **mcp.novada.com domain binding** (the 5-minute step — see section 0)
- **Landing page** at `novada.com/mcp` with install snippet (KR-5 M-5.2)
- **MCP directory submissions** — Smithery, MCP Hub, Awesome MCP, LobeHub, etc. (KR-5 M-5.2)
- **Real traffic proof** — issue 10 tokens to real users + log 50+ tool calls in 7-day window (KR-5 M-5.3)

### What's known broken / intentionally stubbed
- `novada_browser` and `novada_browser_flow` tools → return error pointing user to `npx novada-mcp` local install (intentional, see hard rules)
- China access to the raw `*.vercel.app` URL: BLOCKED by GFW DNS poisoning (IP 150.107.3.176 sinkhole). Custom domain `mcp.novada.com` via CNAME bypasses this. This is one of the reasons the CNAME bind matters.

---

## 4. Important decision: Vercel vs Novada own server

**Decision (2026-06-04):** Stay on Vercel for v1. Re-evaluate at v2 if traffic exceeds free tier or product needs warrant.

**Reasoning (don't re-litigate unless you have new data):**

| | Vercel | Novada own server |
|---|---|---|
| Code status | ✅ Already deployed and Ready | ❌ Zero progress |
| Time to LIVE | **5 minutes** (just the CNAME) | 3–5 days (HTTPS, nginx, pm2, monitoring, logs) |
| Permission needed | None (Tong owns Route 53 + Vercel project) | Tong needs SSH + deploy permissions from Ethan/IT |
| GFW behavior | ✅ Custom domain via CNAME bypasses vercel.app sinkholing | ⚠️ Depends on server location |
| Bundle size limit | 50MB (we hit it once for playwright-core, already worked around) | Unlimited |
| Function execution | 60s max (set via `maxDuration`) | Unlimited |
| Cost (v1 expected scale) | Free (100GB bandwidth + 100GB-hours compute) | Server cost + ops time |
| Auto SSL | ✅ Free via Vercel | Need to handle (Let's Encrypt + renewal) |

If you find yourself thinking "we should move off Vercel," first answer: what changed that makes the above analysis wrong?

---

## 5. The immediate next 3 steps

In order. Don't skip.

### Step 1 — Bind `mcp.novada.com` (5 minutes, user action required)

**Tell the user:**

> "I'm ready to help you bind mcp.novada.com. You need to do these 2 clicks; I can verify after:
>
> 1. **AWS Route 53** → Hosted zones → `novada.com` → Create record:
>    - Name: `mcp`
>    - Type: `CNAME`
>    - Value: `cname.vercel-dns.com`
>    - TTL: `300`
>
> 2. **Vercel** → project `novada-mcpserver` → Settings → Domains → Add `mcp.novada.com` → Vercel will auto-verify when DNS propagates.
>
> Tell me when both are done. I'll verify with `curl` and `dig`."

### Step 2 — Verify the binding works

Once user confirms steps above, run:

```bash
# DNS resolution
dig mcp.novada.com CNAME +short
# Expected: cname.vercel-dns.com (or similar Vercel CNAME)

# HTTPS handshake (Vercel auto-provisions SSL cert)
curl -I https://mcp.novada.com/
# Expected: HTTP/2 200 (or 404 from MCP — but with valid SSL, NOT cert error)

# MCP endpoint
curl -X POST https://mcp.novada.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0.0"}}}'
# Expected: MCP initialize response with server capabilities
```

If any of these fail, debug DNS propagation first (`dig` from multiple resolvers), then Vercel domain config, then check Vercel deployment logs.

### Step 3 — Update KR-5 status

After verification:
- Update `~/Projects/novada-june-kr-report-2026.html` KR-5 from 30% → 60%
- Update Linear: close `INC-98` ("mcp.novada.com CNAME bound at AWS Route 53") to Done
- Update `PROJECT_STATE.md` "Domain status" field
- Tell the user: "✅ LIVE at https://mcp.novada.com/mcp"

---

## 6. Tools / credentials you have access to

| Capability | How |
|---|---|
| **Linear** (read + write KR-5 issues INC-97 through INC-103) | `~/.config/linear/api_key` chmod 600, auto-loaded via `~/.zshenv`. Use GraphQL at `https://api.linear.app/graphql` with `Authorization: $LINEAR_API_KEY` header. **Don't use Linear MCP connector — it's flaky (returns 403 intermittently). GraphQL via curl/python is reliable.** |
| **Vercel** | The user has the dashboard open. For programmatic check, can use Vercel API via `vercel` CLI if installed, or just curl `https://novada-mcpserver-*.vercel.app/api/mcp` directly. |
| **AWS Route 53** | User has console access. You can't directly modify but you can verify via `dig`. |
| **GitHub** | Repo is `NovadaLabs/novada-mcpserver`. **Don't push without approval** (hard rule #1). |
| **AgentRecall** | Use `mcp__agent-recall__recall("hosted MCP")` to find prior context if needed. |

---

## 7. What "done" looks like for this session

**Minimum viable success (the user's main goal right now):**
- mcp.novada.com responds to HTTPS + MCP handshake
- KR-5 OKR table updated from 30% to 60%
- Linear INC-98 closed

**Bonus (if there's time):**
- Landing page at novada.com/mcp (probably needs novada-web access — separate repo)
- Submit to first MCP directory (Smithery is easiest — they have a one-click form)

---

## 8. If you get stuck

1. **DNS not propagating:** Wait 15 min, try `dig @8.8.8.8 mcp.novada.com` and `dig @1.1.1.1 mcp.novada.com` from different resolvers. AWS Route 53 changes can take up to 1 hour worst-case.
2. **Vercel says "Domain not verified":** Check the TXT record Vercel may have asked for (separate from CNAME). Sometimes Vercel wants both a CNAME and a verification TXT.
3. **Custom domain works but `/mcp` returns 500:** Check Vercel deployment logs. Most likely a runtime env var (NOVADA_API_KEY) didn't propagate to the production deployment.
4. **`curl` works but Claude Desktop can't connect:** Verify the MCP handshake (initialize/tools/list flow). Use the Streamable-HTTP spec from `https://modelcontextprotocol.io/specification/2025-03-26/`.
5. **You're confused about scope:** Read `PROJECT_STATE.md`. If still confused, **ASK THE USER** — a 5-second question beats 30 minutes of wrong work. (Tong's CLAUDE.md rule.)

---

## 9. Related projects (don't confuse them)

- **`~/Projects/novada-mcp/`** — the *local* npm package (`npx novada-mcp`). KR-6 work happens here on branch `kr6-account-tools` (LOCAL ONLY, no push). The hosted server (this repo) vendors a build of this package.
- **`~/Projects/novada-mcp/docs/developer-api-requirements.html`** — doc sent to fudong about KR-6's blocked endpoint (proxy_account schema). Not relevant to KR-5 directly but good context for what's coming.
- **`~/Projects/novada-june-kr-report-2026.html`** — KR scorecard. KR-5 section is what you update after CNAME binds.

---

**Good luck.** This is a 5-minute task gated by 2 user clicks. Don't over-engineer it.
