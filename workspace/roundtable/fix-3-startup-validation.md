# Fix 3 — Startup Proxy Configuration Validation

## Problem

`DOMAIN_REGISTRY` in `src/utils/domains.ts` contains 24 domains with `proxyTier: "residential"`. When `NOVADA_RESIDENTIAL_PROXY_USER/PASS/ENDPOINT` are absent, `getResidentialProxyCredentials()` silently falls back to datacenter credentials (line 58-59 of `credentials.ts`). The operator has no indication that MT-1's residential-tier configuration is a no-op.

## Domains with `proxyTier: "residential"` (24 total)

amazon.com, amazon.de, amazon.co.uk, amazon.co.jp, amazon.fr, amazon.es, amazon.it, amazon.ca, steampowered.com, store.steampowered.com, walmart.com, target.com, bestbuy.com, airbnb.com, tripadvisor.com, shein.com, wayfair.com, homedepot.com, lowes.com, nike.com, booking.com, g2.com, ticketmaster.com, stubhub.com

## Approach Selected

**Approach A — startup check** (as specified). Fires once when the MCP server connects, before any tool call. Visible immediately in MCP server logs. Does not add latency to per-request paths.

## Changes Made

### `src/utils/domains.ts` — new export `checkProxyConfiguration()`

Added after `lookupDomain()`:

```typescript
export function checkProxyConfiguration(): void {
  const residentialDomains = Object.keys(DOMAIN_REGISTRY).filter(
    (domain) => DOMAIN_REGISTRY[domain].proxyTier === "residential"
  );

  if (residentialDomains.length === 0) return;

  const hasResidentialCreds =
    !!process.env.NOVADA_RESIDENTIAL_PROXY_USER &&
    !!process.env.NOVADA_RESIDENTIAL_PROXY_PASS &&
    !!process.env.NOVADA_RESIDENTIAL_PROXY_ENDPOINT;

  if (!hasResidentialCreds) {
    process.stderr.write(
      `[novada] WARNING: ${residentialDomains.length} domains in DOMAIN_REGISTRY have proxyTier="residential" ` +
      `(e.g. ${residentialDomains.slice(0, 3).join(", ")}...) but residential proxy env vars are not set.\n` +
      `[novada] Fetches to these domains will silently fall back to datacenter credentials.\n` +
      `[novada] To enable residential proxies, set:\n` +
      `[novada]   NOVADA_RESIDENTIAL_PROXY_USER\n` +
      `[novada]   NOVADA_RESIDENTIAL_PROXY_PASS\n` +
      `[novada]   NOVADA_RESIDENTIAL_PROXY_ENDPOINT\n`
    );
  }
}
```

### `src/index.ts` — import + call in `run()`

Added import:
```typescript
import { checkProxyConfiguration } from "./utils/domains.js";
```

Added call inside `run()` immediately after `this.server.connect(transport)`:
```typescript
checkProxyConfiguration();
```

## Sample Warning Output (when residential vars absent)

```
[novada] WARNING: 24 domains in DOMAIN_REGISTRY have proxyTier="residential" (e.g. amazon.com, amazon.de, amazon.co.uk...) but residential proxy env vars are not set.
[novada] Fetches to these domains will silently fall back to datacenter credentials.
[novada] To enable residential proxies, set:
[novada]   NOVADA_RESIDENTIAL_PROXY_USER
[novada]   NOVADA_RESIDENTIAL_PROXY_PASS
[novada]   NOVADA_RESIDENTIAL_PROXY_ENDPOINT
```

## tsc Result

```
(no output — zero errors, zero warnings)
```

## Error Path Trace

- `checkProxyConfiguration()` reads only `process.env.*` and `DOMAIN_REGISTRY` — no async, no throws. Cannot fail silently.
- Uses `process.stderr.write` (not `console.log`, not `console.warn`) — safe on stdio MCP transport where stdout carries JSON-RPC.
- No global binaries required.
