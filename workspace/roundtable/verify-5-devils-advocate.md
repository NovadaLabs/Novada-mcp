# Devil's Advocate Verification — Unified Key Agent Experience

**Date:** 2026-06-22
**Scope:** What a fresh agent actually sees when calling novada_setup and novada_health after the unified key changes.

---

## 1. Does setup output mention unified key prominently at the top?

**Verdict: NO — it does not appear at the top of the actual output.**

The setup tool description (`src/index.ts:476`) has the unified key mention:
```
**UNIFIED KEY:** NOVADA_API_KEY is the only required key...
```

But the description is metadata shown in the tool list, NOT in the output the agent receives when it calls the tool. The actual function `novadaSetup()` in `src/tools/setup.ts` emits its lines starting at line 24:

```
"## Novada MCP — Setup Status"
""
"### Environment Variables"
```

There is no unified-key banner in the emitted output. The first substantive content the agent sees is a raw status table of env vars. An agent that calls `novada_setup` and reads the response gets NO mention of "one key covers all" in the first screenful.

The unified key message exists in:
- Tool description (seen at tool-list time, not call-time): `src/index.ts:476`
- `novada_discover` description: `src/index.ts:394`
- `--help` CLI output: `src/index.ts:946-948`

It does NOT exist in the `novadaSetup()` function return value. **The call-time output is what matters for agent behavior.**

---

## 2. Tool descriptions saying "requires NOVADA_PROXY_USER/PASS" without mentioning auto-provisioning

**Verdict: CONFIRMED — 7 proxy tool descriptions carry this misleading line.**

Every `novada_proxy_*` tool description ends with:
```
**Requires:** NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.
```

Affected lines in `src/index.ts`:
- `novada_proxy`: line 231
- `novada_proxy_residential`: line 245
- `novada_proxy_isp`: line 258
- `novada_proxy_datacenter`: line 271
- `novada_proxy_mobile`: line 284
- `novada_proxy_static`: line 297
- `novada_proxy_dedicated`: line 310

The auto-provisioning logic (`src/index.ts:898-916`) only fires on server startup when `NOVADA_PROXY_ENDPOINT` is set but `NOVADA_PROXY_USER/PASS` are missing. The tool descriptions never mention this. An agent reading "Requires: NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT" will conclude it needs three separate credentials from the dashboard, not that one `NOVADA_API_KEY` + `NOVADA_PROXY_ENDPOINT` is sufficient.

Additionally, the auto-provisioning condition requires `NOVADA_PROXY_ENDPOINT` to be set independently — so even the "auto-provision" story is not "just set NOVADA_API_KEY." An agent following the unified key pitch will still fail unless they separately configure `NOVADA_PROXY_ENDPOINT`. This is a contradiction between the "one key" claim and the actual proxy setup requirement.

---

## 3. Does health_all output explain the unified key?

**Verdict: NO.**

The `novadaHealth()` function in `src/tools/health.ts` (lines 171-221) produces a header, a product table, a summary, and next steps. None of these mention "unified key" or "NOVADA_API_KEY covers all products."

The Proxy probe at lines 107-112 returns:
```
note: "set NOVADA_PROXY_USER env var"
```

And at lines 208-211, the Next Steps section emits:
```
- Proxy: Export NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT
```

An agent that calls `novada_health` after a proxy tool fails will receive explicit instructions to set three separate vars — with no mention that `NOVADA_API_KEY` + `NOVADA_PROXY_ENDPOINT` would suffice via auto-provision.

The health_all probe at `src/tools/health_all.ts:247` has the same problem:
```
notes: "Set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT"
```

---

## 4. Contradictory information an agent would encounter

**Three distinct contradiction points:**

**A. Tool description vs. actual requirement (proxy)**
`novada_setup` description (`src/index.ts:476`) says:
> "NOVADA_API_KEY is the only required key... proxy auto-provisioning"

`novada_proxy_residential` description (`src/index.ts:245`) says:
> "**Requires:** NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars."

An agent that reads both tools will see conflicting requirements for the same proxy feature. The discover/setup descriptions say "one key," the proxy tool descriptions say "three separate vars required."

**B. setup.ts output lists proxy vars as optional-but-needed**
`src/tools/setup.ts:58` (emitted when NOVADA_API_KEY is present but proxy not configured):
```
missing.push("novada_proxy_* credential generation (need NOVADA_PROXY_USER/PASS/ENDPOINT)");
```

And `src/tools/setup.ts:115`:
```
"  NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT"
```

This output tells the agent all three are needed, with no mention that NOVADA_API_KEY can auto-provision USER/PASS if ENDPOINT is set.

**C. health.ts Next Steps contradicts auto-provisioning**
`src/tools/health.ts:209`:
```
lines.push(`- Proxy: Export NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT`);
```

An agent in a proxy-debugging loop will hit this output and go to the dashboard to get manual credentials — never knowing auto-provision would have worked with just ENDPOINT set.

---

## 5. Single highest-impact change

**Add a two-line unified-key note to `novadaSetup()` output, immediately after the env var status table, before any other content.**

Specifically, after `src/tools/setup.ts:50` (after the env var checks), insert:

```
"**ONE KEY:** NOVADA_API_KEY covers search, extract, crawl, research, scrape, and unblock."
"  Proxy credential tools need NOVADA_PROXY_ENDPOINT (user/pass auto-fetched from your account)."
```

Why this is the highest-impact location:
- `novada_setup` is the tool explicitly designated for first-time setup and diagnosis
- An agent calling it reads the full response — this is guaranteed eyeball time
- The current output provides three separate env var lines with no unifying context
- All other unified-key mentions are in tool *descriptions* (seen at list time, often skipped) not tool *output* (seen when the tool is actually called)
- This single location fix would break the assumption loop: agent sees proxy-not-configured → calls setup → gets unified key explanation → understands PROXY_ENDPOINT is the only extra var needed

The tool description at `src/index.ts:473` already says:
> "**Output:** Status of all env vars (NOVADA_API_KEY, NOVADA_BROWSER_WS, NOVADA_PROXY_*)"

An agent reading that line will expect the output to match — which means the output itself needs to explain that NOVADA_API_KEY covers proxy too. Currently it does not.

---

## Summary of Remaining Confusion Points

| # | Location | Problem | Severity |
|---|----------|---------|----------|
| 1 | `setup.ts` output (call-time) | No unified key mention in actual emitted text | HIGH |
| 2 | `index.ts:231,245,258,271,284,297,310` | 7 proxy descriptions say "Requires: NOVADA_PROXY_USER/PASS/ENDPOINT" with no mention of auto-provision | HIGH |
| 3 | `health.ts:209`, `health_all.ts:247` | Health output tells agent to manually export 3 vars instead of mentioning auto-provision | MEDIUM |
| 4 | `setup.ts:58,115` | Setup output lists NOVADA_PROXY_USER/PASS/ENDPOINT as missing without explaining auto-provision path | MEDIUM |
| 5 | Auto-provision gate | Requires NOVADA_PROXY_ENDPOINT to be set — "one key" claim is technically incomplete | LOW |
