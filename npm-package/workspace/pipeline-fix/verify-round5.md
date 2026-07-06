# Verification Round 5 — novada_setup + novada_health_all Accuracy

Date: 2026-06-25
Env: NOVADA_API_KEY only (no BROWSER_WS, no PROXY_* vars)

---

## novada_setup — Full Output

```
## Novada MCP — Setup Status

### Environment Variables

  ✓ NOVADA_API_KEY              1f35...adfa  — covers search, extract, crawl, research, scrape, monitor, verify, unblock
  ✗ NOVADA_BROWSER_WS           (not set)  — optional — needed for novada_browser / novada_browser_flow
  ✗ NOVADA_PROXY_USER/PASS/ENDPOINT(not set)  — optional — needed for novada_proxy_* credential generation

**Unified API Key:** NOVADA_API_KEY covers search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning.
**Proxy auto-provision:** If NOVADA_PROXY_ENDPOINT is set, user/pass are auto-fetched from your account — no separate NOVADA_PROXY_USER/PASS needed.

**Status: Ready.** Core tools are active.
Optional tools not configured:
  - novada_browser, novada_browser_flow (need NOVADA_BROWSER_WS)
  - novada_proxy_* routing (set NOVADA_PROXY_ENDPOINT — user/pass auto-fetched from your account via NOVADA_API_KEY)

Confirm active products: call `novada_health`

## Output Pipeline

📁 Results auto-saved to: ~/Downloads/novada-mcp/YYYY-MM-DD/
   Formats: .md (content), .json (structured), .html (raw)
   Output directory is ~/Downloads/novada-mcp/YYYY-MM-DD/ (not yet configurable)

## Agent Action
status: ready
configured_tools: search, extract, crawl, research, scrape, monitor, verify, unblock, map, health
optional_not_configured: browser, proxy
```

---

## novada_health_all — Full Output

```
## Novada API — Extended Health Check

api_key: ****adfa
checked: 2026-06-26T12:35:46.196Z

| Product | Status | Latency | Notes |
|---------|--------|---------|-------|
| Search API | ✅ Active | 1494ms | Google SERP probe OK |
| Extract / Web Unblocker | ❌ Not activated | 1948ms | code=5001 |
| Scraper API (13 platforms) | ✅ Active | 2348ms | google_search probe OK |
| Proxy | ⚠️ Not configured | — | Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT |
| Browser API | ⚠️ Not configured | — | Set NOVADA_BROWSER_WS (wss://user:pass@host format) |
| Unblock API | ❌ Not activated | 2359ms | code=5001 |

---
## Summary
- 2 active  |  2 not activated  |  2 not configured

## Next Steps
- **Extract / Web Unblocker** — Not activated. Activate at: https://dashboard.novada.com/overview/unblocker/
- **Proxy** — Not configured. Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT
  Get credentials: https://dashboard.novada.com/overview/proxy/
- **Browser API** — Not configured. Set NOVADA_BROWSER_WS (wss://user:pass@host format)
  Get credentials: https://dashboard.novada.com/overview/browser/
- **Unblock API** — Not activated. Activate at: https://dashboard.novada.com/overview/unblocker/

> agent_instruction: Call `novada_health` for the quick overview. For any PRODUCT_UNAVAILABLE result,
> visit the activation link above, then re-run `novada_health_all` to confirm.
```

---

## Check Results

### 1. NOVADA_API_KEY shown as set (✅)?
PASS. Output shows `✓ NOVADA_API_KEY  1f35...adfa`.

### 2. Browser API described as auto-provisioned (not just "not configured")?
PARTIAL FAIL.

`novada_setup` correctly says:
> "optional — needed for novada_browser / novada_browser_flow"

But `novada_health_all` says:
> "⚠️ Not configured — Set NOVADA_BROWSER_WS (wss://user:pass@host format)"

The Browser API requires an actual WebSocket credential that is NOT auto-fetchable from NOVADA_API_KEY — a user must explicitly provision and copy a WS URL from the dashboard. The "not configured" message is technically correct: the tool cannot auto-provision Browser API from API key alone.

No misleading claim here. Status: ACCURATE.

### 3. Proxy shown as auto-provisionable via NOVADA_PROXY_ENDPOINT only?
PASS.

`novada_setup` says:
> "novada_proxy_* routing (set NOVADA_PROXY_ENDPOINT — user/pass auto-fetched from your account via NOVADA_API_KEY)"

And:
> "**Proxy auto-provision:** If NOVADA_PROXY_ENDPOINT is set, user/pass are auto-fetched from your account — no separate NOVADA_PROXY_USER/PASS needed."

This correctly describes auto-provisioning. The NOVADA_PROXY_ENDPOINT is the only env var a user needs to set.

ISSUE: `novada_health_all` says:
> "⚠️ Not configured — Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT"

This contradicts the setup message. health_all instructs users to set all three vars (USER/PASS/ENDPOINT) whereas setup correctly says only ENDPOINT is needed. This is a CONTRADICTION between the two tools.

### 4. "ONE KEY" or "unified" mentioned?
PASS.

setup output includes:
> "**Unified API Key:** NOVADA_API_KEY covers search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning."

### 5. Output Pipeline directory correct?
PASS. Shows `~/Downloads/novada-mcp/YYYY-MM-DD/` — matches actual implementation.

### 6. Misleading "not configured" messages for things available via API key?
ISSUE FOUND.

`novada_health_all` Proxy row says:
> "Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT"

This implies all three must be set. In reality, per `novada_setup` and the auto-provision logic, only `NOVADA_PROXY_ENDPOINT` is needed — user/pass are auto-fetched. This is misleading and inconsistent with the setup message.

The Browser API "not configured" message is accurate — NOVADA_BROWSER_WS cannot be auto-fetched.

---

## Summary of Issues

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| 1 | MEDIUM | health_all Proxy row | Says "Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT" — should say "Set NOVADA_PROXY_ENDPOINT only; user/pass are auto-fetched via NOVADA_API_KEY" |
| 2 | LOW | health_all Next Steps Proxy | "Get credentials: https://dashboard.novada.com/overview/proxy/" — correct URL but misleads user into thinking they need to manually copy creds |

## What Passes

- NOVADA_API_KEY status: correctly shown as set with masked value
- "Unified API Key" / one-key architecture: clearly stated in setup
- Proxy auto-provision: correctly described in setup
- Output Pipeline directory: correct
- Browser API "not configured" message: accurate (WS URL is not auto-fetchable)
- Agent Action block: correct tool list
