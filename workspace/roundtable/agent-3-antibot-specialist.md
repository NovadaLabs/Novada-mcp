# Agent 3 — Anti-Bot Specialist

**Date:** 2026-06-22
**Scope:** http.ts + domains.ts blocking/unblocking layer architecture

---

## 1. Detection/Routing Co-location vs. Separation

The current architecture co-locates detection and routing in the same call sites. `detectBotChallenge()` fires in extract.ts, and the routing decision (escalate to render or browser) happens immediately at that same call site. This is a reasonable first-pass design but has a structural flaw: detection logic accumulates context (which provider, what signals) that the routing layer never receives.

The correct architecture separates them into three stages:

```
detect(html) → { blocked: bool, provider: string | null, signals: string[] }
  ↓
route(provider, signals, currentMethod) → { nextMethod, proxyTier, reason }
  ↓
execute(url, method, proxyTier)
```

Detection should return a typed result object, not a boolean. `identifyAntiBot()` already does this for provider identification but is never composed with `detectBotChallenge()` into a single pipeline result. The two functions being independent means every call site runs both checks separately — or worse, only runs one of them. Separation is justified here because detection is a pure function on HTML content, routing is a policy decision on detection output plus domain context. Mixing them at call sites means routing policy is scattered rather than centralized.

---

## 2. The `detectBotChallenge()` Scatter Problem

`detectBotChallenge()` is called at 4+ independent locations in extract.ts. Each call site re-runs the full signal-counting loop on the same HTML. But the deeper problem is not performance — it is that each call site makes its own escalation decision independently. There is no single place where the system knows "we detected Cloudflare and escalated to render and it still returned a challenge." That state is invisible.

The pattern also creates divergence risk. If someone adds a new signal to `detectBotChallenge()` but one call site is wrapped in an early-return guard, that site now behaves differently from the others. This has already happened: `identifyAntiBot()` exists as a separate function rather than being a return field from `detectBotChallenge()`, which means a caller must call both functions or miss provider identity.

The alternative is a single pipeline entry point:

```ts
interface BlockResult {
  blocked: boolean;
  provider: AntiBotProvider;
  signals: string[];
  confidence: "definitive" | "heuristic";
}

function analyzeResponse(html: string): BlockResult
```

All escalation decisions key off one `BlockResult` per response. The 4+ call sites in extract.ts collapse to one pipeline invocation per fetch attempt. Escalation logic becomes a `switch (result.provider)` in a single routing function, not duplicated imperative branches spread across extract.ts.

---

## 3. DOMAIN_REGISTRY Dual Purpose

`DOMAIN_REGISTRY` currently encodes two orthogonal concerns in one flat structure: (a) render method hint (`static` / `render` / `browser`) and (b) proxy tier (`residential` / `datacenter`). These should be separate data structures.

The render method is a **capability hint** — it answers "what rendering engine does this domain require?" It changes infrequently and is based on page technology (SPA vs SSR). The proxy tier is a **threat response** — it answers "what IP reputation is needed to not get blocked?" It is tied to the anti-bot provider, not the rendering method.

Conflating them in `DomainEntry` means: to add a new domain that needs residential proxy but is static HTML (a valid combination — some sites check IP reputation on even static responses), you are forced to also set a method even though method is orthogonal. More critically, proxy tier is a property of the anti-bot provider, not the individual domain. All DataDome-protected sites should default to residential; that rule currently has to be re-encoded per domain entry. A `PROVIDER_PROXY_REQUIREMENTS: Record<AntiBotProvider, ProxyTier>` lookup table would centralize that logic and make the per-domain `proxyTier` field a rare override rather than a repeated default.

---

## 4. Ideal Blocker Pattern for Cloudflare / DataDome / Kasada / Amazon WAF

Each provider has a distinct bypass surface:

- **Cloudflare** responds to TLS fingerprint + real browser JS execution (canvas, timing). The render tier (Web Unblocker) handles this for most challenges. True Turnstile requires CDP.
- **DataDome** (used on Amazon) responds to IP reputation + device fingerprint. Residential proxy + Web Unblocker is the minimum viable path. CDPbased browser is required for persistent sessions.
- **Kasada** (g2.com in DOMAIN_REGISTRY) uses behavioral fingerprinting — ips.js / cd.js inject challenge tokens that must be executed. No static or render solution works; CDP is required. `DOMAIN_REGISTRY` correctly puts g2.com at `browser`.
- **Amazon WAF** is a WAF + CAPTCHA layer, different from DataDome on Amazon product pages. The challenge string "to discuss automated access to amazon data" in `detectBotChallenge()` is the WAF block page, not the DataDome product page block. These are distinct failure modes that currently map to the same boolean.

The ideal pattern is a **provider → strategy** map applied at routing time:

```ts
const PROVIDER_STRATEGY: Record<AntiBotProvider, FetchMethod[]> = {
  cloudflare:  ["render", "browser"],
  datadome:    ["render", "browser"],
  kasada:      ["browser"],
  perimeterx:  ["render", "browser"],
  akamai:      ["render", "browser"],
  amazon:      ["render", "browser"],
  // ...
};
```

This replaces the current escalation logic where the method decision is implicit in each call site. The blocker identifies provider; the strategy map specifies the ordered escalation path; the executor tries each in sequence and stops on the first non-blocked result.

---

## 5. Error-Signal Escalation (Firecrawl) vs. Detection-Based (Novada)

Firecrawl's `AddFeatureError(["stealthProxy"])` is thrown when a response returns 401/403/429. The outer orchestration loop catches it and re-selects only stealth-capable engines. This is an **error-signal model**: the escalation trigger is an HTTP status code, not an analysis of the response body.

Novada's current model analyzes response HTML content with `detectBotChallenge()`. This is a **detection-based model**: escalation triggers on content signals in a 200-response body (because bot challenge pages are typically served with HTTP 200).

The two are not alternatives — they are complementary. HTTP status codes are necessary but insufficient: Cloudflare, DataDome, and Amazon WAF all return 200 with a challenge page body. Pure status-code escalation (Firecrawl's model) misses these. Pure body-detection (Novada's current model) misses genuine 403s that carry no challenge body and should also escalate.

Novada should implement both: status-code escalation for 4xx/429, body-detection escalation for 200s that are challenge pages. The Firecrawl model has a structural advantage in composability — feature flags are a clean abstraction for "this request needs capability X." Novada's escalation being imperative code in multiple extract.ts locations is the weaker design. Adopting a feature-flag-style escalation model (not necessarily Firecrawl's exact pattern) would allow the routing layer to be stateless and testable.

---

## 6. Highest-ROI Structural Change to http.ts + domains.ts

**Merge `detectBotChallenge()` and `identifyAntiBot()` into a single `analyzeBlock(html): BlockResult` function, and make `fetchWithRender` return that result alongside the HTTP response.**

Currently `fetchWithRender` returns `AxiosResponse`. The caller in extract.ts has to call `detectBotChallenge()` on the returned HTML after the fact. This means the render layer succeeded (no throw) but the content is still a challenge page — and the caller has to re-detect this after the fact, with no knowledge of which provider was responsible.

If `fetchWithRender` returned `{ response: AxiosResponse, block: BlockResult | null }`, then:

1. One detection pass, not 4+.
2. Provider is available at routing time for strategy selection.
3. Retry/escalation logic in extract.ts can key off `block.provider` to choose the next method, instead of re-running detection and making a generic "escalate to browser" decision blind to provider identity.
4. `DOMAIN_REGISTRY` provider field becomes a pre-detection hint that can skip the analysis pass when the domain is already known — reducing latency on the happy path for registered domains.

This single change resolves the scatter problem (Q2), provides the provider context needed for the ideal blocker pattern (Q4), and makes the detection/routing separation (Q1) structurally enforced rather than aspirational.
