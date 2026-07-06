# Agent 4 — Proxy Routing Specialist

## 1. Current Proxy Routing Architecture

```
URL
 │
 ▼
lookupDomain(url)           [domains.ts]
 │  strips www., exact match, then subdomain fallback
 │  returns DomainEntry { method, provider, proxyTier? }
 │
 ▼
proxyTier decision          [http.ts: fetchViaProxy caller]
 │  "residential" → getResidentialProxyCredentials()
 │  undefined/datacenter → getProxyCredentials()
 │
 ▼
getXxxCredentials()         [credentials.ts]
 │  AsyncLocalStorage (SDK-scoped) → process.env fallback
 │  returns { user, pass, endpoint } or null
 │
 ▼
circuit breaker check       [proxyCircuits Map, keyed by endpoint]
 │  available=false + within TTL → skip to direct fetch
 │  available=null → race proxy vs direct (probe mode)
 │  available=true → proxy directly
 │
 ▼
axios HTTP request
 │  proxy: { host, port, auth }
 │  TIMEOUTS.PROXY_FETCH
 │
 ▼
AxiosResponse
```

---

## 2. Why `proxyTier: "residential"` Breaks for Render Mode

The `proxyTier` field in DOMAIN_REGISTRY is read by `fetchViaProxy`. But the `render` method path in the codebase routes through `fetchWithRender`, which calls the **Web Unblocker API** — a completely separate code path that does not accept a proxy configuration at all. The Web Unblocker is an HTTP API endpoint (`webunlocker.novada.com/request`); Novada's backend handles IP selection internally. The caller has no way to inject a `proxyTier` directive into that path.

So for `airbnb.com` (method=render, proxyTier=residential): the `DomainEntry` annotation is read, but when the tool escalates to `fetchWithRender`, the tier hint is discarded. The Web Unblocker either uses its own IP pool (which may not be residential) or its residential rotation is insufficient for PerimeterX. The `proxyTier` field currently has zero effect on any domain whose `method` is `"render"` or `"browser"`.

This is structural: the field is set at the data layer (registry) but is only consumed by one code path (direct proxy fetch). The render and browser paths ignore it entirely.

---

## 3. Correct Architecture: When Should Tier Selection Happen?

The correct answer is **(c) escalation decision time**, not domain registry lookup time.

Rationale:

- At domain registry lookup time (a), you only know the domain's static preference. You do not know whether the current request is headed to direct fetch, proxy fetch, or render. Encoding tier at this layer forces a premature commitment.
- At HTTP fetch time (b), the individual fetch function (`fetchViaProxy`) has no visibility into whether it is a first attempt or a fallback, which makes escalation impossible from inside that function.
- At escalation decision time (c), the orchestrating tool knows: (1) which method just failed, (2) what the domain registry says about the domain, and (3) which proxy tier was tried. From here it can make a coherent decision: `datacenter failed → try residential → if still failing → try mobile or browser CDP`.

The three-tier escalation ladder should be:

```
for attempt in [datacenter, residential, mobile]:
  result = fetch(url, tier=attempt, method=appropriate_for_tier)
  if result.ok and not detectBotChallenge(result): return result
  if attempt == "mobile": ESCALATE("all tiers exhausted")
```

The domain registry should store `preferredTier` as a hint, not a hard binding. The escalation loop consults the hint to start at the right tier rather than always beginning at datacenter.

---

## 4. Circuit Breaker: Does It Correctly Isolate Datacenter vs Residential?

No — and this is a real correctness bug.

The circuit breaker in `fetchViaProxy` is keyed by **endpoint string** (the `host:port` value from credentials). If datacenter and residential proxies use different endpoints (different hostnames or ports), they get separate circuit states, which is correct. But if they share the same proxy gateway endpoint with only credential differences (same host:port, different username), the circuit breaker conflates them.

More concretely: when `proxyTier === "residential"`, `getResidentialProxyCredentials()` is called. If `NOVADA_RESIDENTIAL_PROXY_*` vars are set, this returns a distinct endpoint — and the circuit is properly isolated. But if the residential vars are not set, `getResidentialProxyCredentials()` **falls back to `getProxyCredentials()`**, returning the same endpoint as the datacenter path. In that case, a datacenter failure trips the circuit and the residential path is also bypassed for the next 5 minutes — even though residential was never tried.

The circuit breaker isolation is credential-dependent and silently degrades when the residential env vars are not configured.

---

## 5. Proxy Affinity: Should Novada Implement It?

Proxy affinity means routing repeated requests to the same target domain through the same proxy IP across multiple requests within a session. This is what Novada's ISP/static proxy products already offer via `session_id` on the user-facing side.

For the MCP layer, affinity matters for two specific scenarios:

1. **Session state**: sites that issue a cookie on first request and validate IP consistency on subsequent requests (many e-commerce checkout flows, DataDome challenge cookies).
2. **Challenge chain completion**: DataDome and PerimeterX issue a challenge, the client passes it, and subsequent requests must come from the same IP to reuse the solved challenge token.

The current MCP proxy layer has no affinity — each `fetchViaProxy` call picks an arbitrary IP from the rotation pool. This means a DataDome challenge solved on request 1 is useless on request 2 if the IP rotates.

Novada should implement affinity at the MCP layer by deriving a stable `session_id` from the target domain (e.g., `md5(domain + toolCallId)`) and appending it to the proxy username. This gives per-domain sticky routing within a tool invocation chain without requiring external state storage.

---

## 6. Single Most Impactful Structural Change

**Decouple proxy tier from domain registry and move it to a per-request escalation wrapper with sticky sessions.**

Concretely: introduce a `fetchWithEscalation(url, domainEntry)` function that:

1. Checks `domainEntry.preferredTier` as the starting tier (hint, not requirement).
2. Appends a domain-derived sticky session token to the proxy username (`user-session-{hash(domain)}`).
3. On `detectBotChallenge(response)` returning true, escalates tier and retries — within the same sticky session where possible.
4. Passes the sticky session token through `fetchWithRender` as the `country`/session hint when falling back to the Web Unblocker.

This single change addresses both Amazon and DataDome-protected sites. Amazon fails because each request gets a different IP, making the challenge-solve worthless. DataDome fails because residential proxy is hinted in the registry but never actually applied to the Web Unblocker path. The escalation wrapper closes both gaps: it forces IP consistency within a request chain and routes the tier hint to all fetch paths, not just `fetchViaProxy`.
