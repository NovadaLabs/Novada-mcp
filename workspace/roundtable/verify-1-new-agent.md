# New Agent Assessment — Novada MCP First Impressions

**Role:** Fresh agent, zero prior knowledge. Assessor reads only the four specified tool descriptions.

---

## 1. Unified API Key Understanding

**CLEAR.**

The message lands in three independent places I read:

- Server description (line 648): "ONE API KEY (NOVADA_API_KEY) covers all products"
- `novada_discover` (line 394): "KEY FACT: ONE API KEY COVERS ALL PRODUCTS."
- `novada_setup` (line 476): "UNIFIED KEY: NOVADA_API_KEY is the only required key."

Three independent signal points make this impossible to miss. No ambiguity.

## 2. Proxy Auto-Provisioning Without Website

**PARTIALLY CLEAR.**

I can see the phrase "proxy auto-provisioning" appears in both the server description and the unified key notes. But what "auto-provisioning" actually means is never explained in these four descriptions. A fresh agent reading only these excerpts would know provisioning happens automatically through the API key — but would not know *how* it works, what credentials get returned, or whether any step is needed to trigger it. The word exists; the mechanism is invisible.

## 3. What I Would Do First

Call `novada_discover`. Its description explicitly says "Call this first" and promises a full tool catalog grouped by category. That is the correct orientation step for any new agent.

## 4. Still Confusing or Unclear

- "Proxy auto-provisioning" is repeated but never defined. What does the agent receive? A URL? Credentials? Automatically or on first call?
- `novada_health` (line 368) says "First-time setup" but `novada_setup` (line 472) also says "First-time setup." Two tools claim the same entry point. A new agent would not know which to call first without reading both descriptions carefully.
- The optional env vars (`NOVADA_BROWSER_WS`, `NOVADA_PROXY_ENDPOINT`) are mentioned as "unlocking additional capabilities" but the descriptions read here do not explain the relationship between NOVADA_PROXY_ENDPOINT and auto-provisioning — creating apparent tension between "no website needed" and "you need an endpoint env var."

---

**Unified Key Verdict: CLEAR**
