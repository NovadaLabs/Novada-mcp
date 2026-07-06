# 09 — novada_setup UX Review

**Date:** 2026-06-25
**Tested with:** `novadaSetup({})` — both unset key and key-set states

---

## Test Results

### State 1: NOVADA_API_KEY unset (new user)

```
## Novada MCP — Setup Status

### Environment Variables

  ✗ NOVADA_API_KEY              (not set)  — REQUIRED — get at https://www.novada.com
  ✗ NOVADA_BROWSER_WS           (not set)  — optional — needed for novada_browser / novada_browser_flow
  ✗ NOVADA_PROXY_USER/PASS/ENDPOINT(not set)  — optional — needed for novada_proxy_* credential generation

**Unified API Key:** NOVADA_API_KEY covers search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning.
**Proxy auto-provision:** If NOVADA_PROXY_ENDPOINT is set, user/pass are auto-fetched from your account...

**Status: Setup required.** NOVADA_API_KEY is missing.

─── Step 1: Get your API key ─────────────────────────────────
  https://www.novada.com  → sign up → copy your API key

─── Step 2: Add the key to your MCP client ───────────────────
  [Claude Code / Claude Desktop / Cursor+VSCode+Windsurf snippets]

─── Step 3: Restart your MCP client ──────────────────────────
─── Optional: Browser automation ─────────────────────────────
─── Optional: Proxy credential tools ──────────────────────────
```

### State 2: NOVADA_API_KEY set

```
  ✓ NOVADA_API_KEY              1f35...adfa  — covers search, extract, crawl, ...
  ✗ NOVADA_BROWSER_WS           (not set)  — optional
  ✗ NOVADA_PROXY_USER/PASS/ENDPOINT(not set)  — optional

**Status: Ready.** Core tools are active.
Optional tools not configured: [list]
Confirm active products: call `novada_health`
```

---

## Checklist Evaluation

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Clear for a first-time user? | **PASS** | Numbered steps, client-specific code snippets, restart reminder |
| 2 | Correctly shows NOVADA_API_KEY is set? | **PASS** | Shows `✓ NOVADA_API_KEY  1f35...adfa` with masked value |
| 3 | Optional vars shown as optional (not required)? | **PASS** | Both BROWSER_WS and PROXY vars show `— optional —` label |
| 4 | Says "ONE KEY covers everything"? | **PARTIAL** | Says "Unified API Key" and lists products — but the phrase "ONE KEY" is absent. The message is semantically correct but could be stronger as a headline |
| 5 | Next-steps section for new user? | **PASS** | 3 numbered steps + `## Agent Action` block with `next_step` and `get_key` |

---

## Issues Found

### Issue 1 — Minor: "ONE KEY" headline is buried

The unified-key message is in body text ("**Unified API Key:** NOVADA_API_KEY covers..."), not a top-level headline. A new user who skims may miss it and feel anxious about whether they need multiple keys.

**Suggested fix:** Add a single-line callout at the top of the env-var section:

```
> ONE KEY covers everything. NOVADA_API_KEY is the only required credential.
```

### Issue 2 — Minor: PROXY_USER/PASS/ENDPOINT label alignment

The label `NOVADA_PROXY_USER/PASS/ENDPOINT` overflows the 28-char `padEnd`, causing the `(not set)` column to mis-align:

```
  ✗ NOVADA_PROXY_USER/PASS/ENDPOINT(not set)  — optional ...
                                   ^-- no space before (not set)
```

The label is 33 chars; `padEnd(28)` doesn't pad it. The visual table breaks.

**Suggested fix:** Either shorten the label to `NOVADA_PROXY_*` (11 chars) or increase `padEnd` to 36.

### Issue 3 — Low: "Proxy auto-provision" note appears even when key is unset

The line "**Proxy auto-provision:** If NOVADA_PROXY_ENDPOINT is set, user/pass are auto-fetched..." appears in the unset-key state, before the user even has a key. It's confusing at that stage — feels like a prerequisite to read.

**Suggested fix:** Move this note to the "ready" state only, below the optional-tools list. In the unset state, keep the optional section minimal.

### Issue 4 — Low: No "what can I do first?" prompt in the ready state

When the key is set and `status: ready`, the output ends with `call novada_health`. There's no "try this first" example to orient a new user. An agent that reads this gets the tool list but no recommended starting point.

**Suggested fix:** Add one line at the bottom of the ready state:

```
Suggested first call: `novada_search` — search the web. Or `novada_health` to verify active products.
```

---

## Overall Assessment

**PASS with minor polish needed.** The output is functional and actionable for a new user. The three biggest value signals (key is set/not set, optional vs required, step-by-step config) all work correctly. The issues above are cosmetic/UX polish, not blockers.

Priority order for fixes: Issue 2 (alignment bug) > Issue 1 (ONE KEY headline) > Issue 4 (first-call suggestion) > Issue 3 (proxy note placement).
