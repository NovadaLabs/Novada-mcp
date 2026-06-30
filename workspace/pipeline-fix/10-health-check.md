# novada_health_all — User Perspective Review

Date: 2026-06-25
Tested with: NOVADA_API_KEY set, no NOVADA_WEB_UNBLOCKER_KEY, no NOVADA_BROWSER_WS, no NOVADA_PROXY_ENDPOINT

## Actual Output

```
## Novada API — Extended Health Check

api_key: ****adfa
checked: 2026-06-26T08:43:00.545Z

| Product                   | Status            | Latency | Notes                                                             |
|---------------------------|-------------------|---------|-------------------------------------------------------------------|
| Search API                | ❌ Not activated  | 824ms   | code=50001                                                        |
| Extract / Web Unblocker   | ❌ Not activated  | 2985ms  | code=5001                                                         |
| Scraper API (13 platforms)| ❌ Not activated  | 813ms   | code=50001                                                        |
| Proxy                     | ⚠️ Not configured | —       | Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT   |
| Browser API               | ⚠️ Not configured | —       | Set NOVADA_BROWSER_WS (wss://user:pass@host format)               |
| Unblock API               | ❌ Not activated  | 2778ms  | code=5001                                                         |
```

## Findings per Question

### 1. Does it correctly show which products are ACTIVE vs not configured?

**PARTIALLY CORRECT — with one critical false negative.**

Search, Scraper, Extract, and Unblock correctly show "Not activated" when the Scraper API / Web Unblocker products are not enabled on the account. Browser and Proxy correctly show "Not configured" when their respective env vars are absent.

**However:** The "not_activated" status for Search and Scraper is correct, but code=50001 is an undocumented error code that falls into the catch-all `not_activated` branch — the code only handles 11006 and 11000 explicitly. This means any unknown API error maps to "not_activated" with no explanation, which could be misleading (e.g., a network error or auth failure would also show "not_activated").

### 2. Does it test actual API connectivity (not just env var presence)?

**YES for Search, Scraper, Extract, Unblock.** These make real HTTP probes.

**NO for Proxy and Browser.** Proxy is a sync env-var-only check. Browser is also env-var-only. Neither makes a live connectivity test. The tool description says "tests ALL Novada product endpoints in parallel" — Proxy and Browser do not actually test endpoints.

**Hidden behavior in Extract:** `getWebUnblockerKey()` falls back to `NOVADA_API_KEY` when `NOVADA_WEB_UNBLOCKER_KEY` is not set. So even without `NOVADA_WEB_UNBLOCKER_KEY`, the probe fires using the main API key. The output showed `code=5001` (not_activated). This is correct behavior (it tests real connectivity) but it's not obvious to a user why Extract shows "Not activated" instead of "Not configured" despite having no web unblocker key set. The expected user mental model: "I didn't set NOVADA_WEB_UNBLOCKER_KEY, so it should say not configured." Actual: "It fires a live probe using NOVADA_API_KEY and shows not_activated." This mismatch creates confusion.

### 3. Is the output actionable?

**MOSTLY YES.** The "Next Steps" section tells users what to do:
- For "not_activated": provides dashboard activation link
- For "not_configured": lists the required env var names and dashboard links

**Gaps:**
- The `agent_instruction` block at the bottom is useful but too generic. It says "For any PRODUCT_UNAVAILABLE result" but the actual status labels in the output are "Not activated" / "Not configured" — the agent_instruction uses a different vocabulary than the table, which could confuse an LLM reading the output.
- The raw error codes (code=50001, code=5001) are exposed in the Notes column. A user doesn't know what these mean. Should map to human text: "API product not enabled on this account" instead of just "code=50001".

### 4. Does Browser show correctly when NOVADA_BROWSER_WS is not set?

**YES.** Shows `⚠️ Not configured` with note "Set NOVADA_BROWSER_WS (wss://user:pass@host format)". This is correct behavior. The tool correctly avoids calling it an "error" — it's simply not configured, and the note tells the user exactly what to set.

### 5. Does Proxy show correctly when only NOVADA_API_KEY is set?

**PARTIALLY — with a discoverability miss.**

The output shows `⚠️ Not configured` with "Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT". This is correct for the case where nothing proxy-related is configured.

**However:** `credentials.ts` has `resolveProxyCredentials()` which auto-fetches proxy sub-account credentials via the management API when only `NOVADA_PROXY_ENDPOINT` is set. The health check's `probeProxyAll()` does NOT mention this auto-fetch capability at all. A user who only sets `NOVADA_PROXY_ENDPOINT` (knowing the auto-fetch feature exists) will see "Misconfigured" with no hint that the system can auto-fetch their credentials. The next step message should say:

> "Set NOVADA_PROXY_ENDPOINT (host:port). Credentials are auto-fetched using NOVADA_API_KEY — NOVADA_PROXY_USER/PASS are optional."

Instead of implying all three vars are required.

## Summary of Issues

| # | Severity | Issue |
|---|----------|-------|
| 1 | MEDIUM | Extract shows "Not activated" instead of "Not configured" when NOVADA_WEB_UNBLOCKER_KEY is absent — confusing because NOVADA_API_KEY silently acts as fallback |
| 2 | MEDIUM | Raw error codes (code=50001, code=5001) appear in Notes — should map to human-readable strings |
| 3 | MEDIUM | Proxy "not_configured" notes don't mention auto-fetch capability — users who know about it are misled |
| 4 | LOW | Catch-all `not_activated` branch covers ALL unknown codes — a transient 500 would show same as "product not purchased" |
| 5 | LOW | `agent_instruction` uses "PRODUCT_UNAVAILABLE" but table shows "Not activated" — vocabulary mismatch for LLM consumers |
| 6 | LOW | Tool description says "tests ALL endpoints in parallel" but Proxy and Browser are env-var checks only — misleading |

## Recommended Fixes

**Fix 1 — Extract probe: respect unified key correctly**

When `NOVADA_WEB_UNBLOCKER_KEY` is absent and `NOVADA_API_KEY` is present, probeExtractAll should note that it's probing via the unified key fallback. If the probe returns not_activated, the note should say: "Web Unblocker not activated on this account. Activate at dashboard, or set NOVADA_WEB_UNBLOCKER_KEY if you have a separate key." Status should remain "not_activated" (correct), but the notes need context.

**Fix 2 — Map error codes to human strings**

```
code=50001 -> "API product not enabled on this account"
code=5001  -> "API product not enabled on this account"
code=11006 -> "Bearer token access not enabled — contact support"
code=11000 -> "Invalid API key"
```

**Fix 3 — Proxy notes: mention auto-fetch**

Change the not_configured notes from:
> "Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT"

To:
> "Set NOVADA_PROXY_ENDPOINT (host:port). Credentials are auto-fetched via NOVADA_API_KEY. NOVADA_PROXY_USER/PASS are optional overrides."

**Fix 4 — Catch-all guard: distinguish 5xx from product-not-activated**

Before returning `not_activated` in the catch-all, check HTTP status code. 5xx responses should return `status: "error"` with note "Server error (HTTP {status}) — may be transient". Only 4xx product-not-found codes should return `not_activated`.

**Fix 5 — agent_instruction vocabulary alignment**

Replace "PRODUCT_UNAVAILABLE" in the agent_instruction with "Not activated" to match the table output.
