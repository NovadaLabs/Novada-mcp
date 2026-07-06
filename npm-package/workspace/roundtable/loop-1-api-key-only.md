# Loop 1: NOVADA_API_KEY Only — Graceful Degradation Audit

**Date:** 2026-06-23
**Env:** NOVADA_API_KEY set. NOVADA_PROXY_USER/PASS/ENDPOINT unset. NOVADA_WEB_UNBLOCKER_KEY unset. NOVADA_BROWSER_WS unset.

---

## Test Results

### Test 1: Search
**Result: PASS**
`novadaSearch` returned 1498 chars with no errors. No proxy or unblocker key required.

### Test 2: Extract static page (Wikipedia)
**Result: PASS**
`novadaExtract` on Wikipedia returned `mode: static | quality:85/100 (excellent) | content_ok:true`. Works purely on NOVADA_API_KEY.

### Test 3: Extract anti-bot page (Airbnb)
**Result: PARTIAL — degraded gracefully, but agent guidance is incomplete**

What the response contained:
- `mode: render | quality:5/100 (low) | content_ok:false`
- `anti_bot:perimeterx | resolved:false`
- `chars:0` — no usable content
- Agent hints: `novada_map` and `novada_scrape for platform data`
- `agent_instruction: status:low_quality quality:5/100 | alt: novada_scrape for platform data`

**Problem — missing escalation guidance:**
The `mode: render` header tells an agent that JS rendering was already attempted (auto-escalation from static happened internally). However the `agent_instruction` line only emits `alt: novada_scrape`. The `fix: retry with render="render"` branch in the code requires `usedMode === "static"` at the time guidance is assembled, but by then `usedMode` has been mutated to `"render"` by auto-escalation. So the agent is left with no actionable path toward browser-level bypass.

The hints block also does not fire the `stillJsHeavy` branch (because `stillJsHeavy` was set to `false` after auto-escalation), so the lines that would say:
```
To enable browser-level rendering: set NOVADA_BROWSER_WS env var ...
Also verify NOVADA_WEB_UNBLOCKER_KEY is set correctly.
```
...are silently skipped.

An agent hitting this output knows content is bad and anti-bot is active, but receives zero guidance on what credentials to add to break through.

### Test 4: Proxy tool (novada_proxy_residential)
**Result: PASS — clear, actionable error**

Full error:
```
Error [PROXY_AUTH_FAILURE]: Proxy credentials not configured.
  Missing: NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT
failure_class: auth
retry_recommended: false
agent_instruction: "Proxy authentication failed. Verify your proxy credentials.
  Action:
    1. Check NOVADA_PROXY_USER and NOVADA_PROXY_PASS are correctly set.
    2. Run novada_health to confirm proxy credentials are loaded.
    3. Regenerate credentials at https://dashboard.novada.com/overview/proxy/ if expired."
detail: "Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT environment variables.
         Get credentials from: https://dashboard.novada.com → Residential Proxies → Endpoint Generator"
```

Excellent. Error code, missing vars named explicitly, URL to get them. Agent can act on this immediately.

---

## Summary

| Tool | Works with API key only? | Agent guidance on failure |
|---|---|---|
| novada_search | Yes | N/A (success) |
| novada_extract (static page) | Yes | N/A (success) |
| novada_extract (anti-bot, airbnb) | No (0 chars) | Incomplete — no unblocker/browser credential hint |
| novada_proxy_residential | No (hard fail) | Excellent — explicit vars + dashboard URL |

---

## Persistent Problems

**Yes — one confirmed problem:**

**P1: Anti-bot extract guidance gap (Test 3)**

When `novadaExtract` auto-escalates from static to render internally and still fails (resolved:false, quality:5), the `agent_instruction` block does not tell the agent what credential is needed to proceed. The `NOVADA_WEB_UNBLOCKER_KEY` and `NOVADA_BROWSER_WS` env vars are mentioned nowhere in the output.

Root cause: The hints block that emits unblocker/browser guidance is gated on `stillJsHeavy=true`, but `stillJsHeavy` is set to `false` after any render attempt that improves score — even if the improvement is from 0 to 5 (i.e., still useless). Separately, the `agent_instruction` `fix: retry with render="render"` branch fires only when `usedMode === "static"`, but auto-escalation already mutated `usedMode` to `"render"`.

**Impact:** An agent with only NOVADA_API_KEY that hits a bot-protected page gets `quality:5/100, resolved:false` and no next step beyond "try novada_scrape". If the target is not a known scraper platform, the agent is stuck.

**Fix candidate (source `/Users/tongwu/Projects/novada-mcp/src/tools/extract.ts`):**
After the `agent_instruction` assembly, add a condition:

```
IF anti_bot detected AND resolved:false AND usedMode === "render":
  emit: "Anti-bot page not bypassed by render. To resolve: set NOVADA_WEB_UNBLOCKER_KEY (Web Unblocker) or NOVADA_BROWSER_WS (Browser API). Get at https://dashboard.novada.com/"
```

This is independent of `stillJsHeavy`, which is the wrong gate for this case.
