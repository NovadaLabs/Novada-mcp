# Verifier-4: Description Clarity Audit
**Date:** 2026-06-22
**Role:** Verifier — fresh eyes, no author bias

---

## Source Evidence

### Server description (line 648)
```
"Novada MCP — unified web data API. ONE API KEY (NOVADA_API_KEY) covers all products: search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning. Optional: NOVADA_BROWSER_WS for browser automation, NOVADA_PROXY_ENDPOINT for proxy routing. Call novada_health_all() to verify which products are active."
```

### novada_discover description (lines 387–394)
```
"List all available Novada tools with name, description, category, and status (active/todo).

**agent_instruction:** Call this first to see all available Novada tools...
**KEY FACT: ONE API KEY COVERS ALL PRODUCTS.** NOVADA_API_KEY authenticates search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning. No separate keys needed for most features. If a tool fails, call novada_health_all() to diagnose."
```

### Runtime behavior (lines 898–916)
Auto-provisioning triggers when `NOVADA_PROXY_ENDPOINT` is set but `NOVADA_PROXY_USER`/`NOVADA_PROXY_PASS` are missing — it fetches credentials via `NOVADA_API_KEY` Bearer token.

### Proxy tool descriptions (lines 231, 245, 258, 271, 284, 297)
All 6 proxy sub-tools uniformly say:
```
"**Requires:** NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars."
```

### MCP protocol exposure
`_oninitialize` in the SDK returns `serverInfo: this._serverInfo`, and `ImplementationSchema` includes `description: z.string().optional()` (types.js line 367). The description IS exposed to clients on handshake.

### End-to-end key test
```
Search OK: 1487 chars
```
`novadaSearch()` works with `NOVADA_API_KEY` alone. Confirmed.

---

## Simulation: New Agent Reads Only Server Description + novada_discover

### Q1: Would they know NOVADA_API_KEY is the only required key?

**PASS.** Both surfaces are explicit: server description says "ONE API KEY (NOVADA_API_KEY)" in caps, and novada_discover repeats "**KEY FACT: ONE API KEY COVERS ALL PRODUCTS.**" An agent reading either surface gets this immediately. Coverage: 10/10.

### Q2: Would they know proxy auto-provisioning works with just NOVADA_API_KEY + NOVADA_PROXY_ENDPOINT?

**PARTIAL FAIL.**

The server description says "proxy auto-provisioning" as a capability of NOVADA_API_KEY and lists NOVADA_PROXY_ENDPOINT as optional. That part is correct. But the phrase "proxy auto-provisioning" is vague — it doesn't explain that setting NOVADA_PROXY_ENDPOINT alone (without USER/PASS) triggers auto-fetch.

Worse: every individual proxy tool description (novada_proxy, novada_proxy_residential, novada_proxy_isp, etc.) says "Requires: NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars." This directly contradicts the server-level claim. An agent that reads the server description first, then reads the proxy tool description when attempting to use it, will believe they need to manually set USER and PASS. The auto-provisioning behavior is invisible at the tool level.

Gap: The 6 proxy tool descriptions do not mention auto-provisioning. A new agent would attempt to configure USER/PASS manually or call novada_setup instead of simply setting PROXY_ENDPOINT.

### Q3: Would they know when to use NOVADA_BROWSER_WS?

**PASS (barely).** The server description says "Optional: NOVADA_BROWSER_WS for browser automation." The novada_browser tool description says "**Requires:** NOVADA_BROWSER_WS environment variable." Combined, an agent learns: (a) it's optional at the account level, (b) it's required to unlock browser tools specifically. The signal is sufficient but the server description doesn't name which tools need it. An agent might not know novada_extract can also escalate to browser CDP (it says "Handles Cloudflare, DataDome, Kasada automatically via auto-escalation (static → JS render → Browser CDP)"). Whether that escalation also needs BROWSER_WS or uses a different code path is unclear from the descriptions alone.

### Q4: Would they know to call novada_health_all() if something fails?

**PASS.** Both surfaces say so explicitly. Server description: "Call novada_health_all() to verify which products are active." novada_discover: "If a tool fails, call novada_health_all() to diagnose." The novada_health_all tool description has `**agent_instruction:**` reinforcing this. An agent following standard MCP tool-reading behavior will find this on three separate surfaces.

---

## Is the description actually exposed via MCP protocol?

**YES.** Confirmed via SDK source:
- `ImplementationSchema` in `@modelcontextprotocol/sdk` includes `description: z.string().optional()`
- `_oninitialize` returns `serverInfo: this._serverInfo` which carries the description field
- The description field is part of the MCP 2025 spec (standard, not a no-op field)

Whether a specific MCP *client* renders it is client-dependent, but it IS transmitted.

---

## Rating

**6/10**

### What works
- "ONE API KEY" message is loud, clear, repeated on multiple surfaces
- novada_health_all fallback is well-signposted
- NOVADA_BROWSER_WS scope is adequate (optional at server level, required at tool level)

### Critical gap (score -3)
The 6 proxy tool descriptions say "Requires: NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT" — this directly contradicts the auto-provisioning claim in the server description. An agent that reads the server description first is primed to expect auto-provisioning, then reads the tool description and sees "Requires USER and PASS" — and concludes they need to set them manually. The auto-provisioning behavior is invisible at the point of use (the tool description), which is where an agent will read when they're actually trying to do the task.

### Minor gap (score -1)
NOVADA_BROWSER_WS: the server description doesn't specify which tools require it beyond "browser automation." An agent might not know novada_unblock's "browser" method also needs it, or whether novada_extract's CDP fallback path uses it. The tool descriptions do clarify per-tool, but the server-level description is imprecise.

---

## Recommended Fix

In the 6 proxy tool `**Requires:**` lines, replace:

```
**Requires:** NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.
```

With:

```
**Requires:** NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY — no manual credential setup needed.
```

This aligns the tool-level description with the actual runtime behavior and eliminates the contradiction.

---

*Verifier: agent-4 (fresh read, no authorship bias)*
