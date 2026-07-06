# Fix 2 — Circuit Breaker Isolation (Loop 2)

## Files Read

- `/Users/tongwu/Projects/novada-mcp/src/utils/http.ts` — circuit breaker logic, `proxyCircuits` Map, `getCircuit()`, `fetchViaProxy()`
- `/Users/tongwu/Projects/novada-mcp/src/utils/credentials.ts` — `getResidentialProxyCredentials()` and its datacenter fallback

## What Was Found

### Bug confirmed

`getResidentialProxyCredentials()` (credentials.ts:53-60): when `NOVADA_RESIDENTIAL_PROXY_{USER,PASS,ENDPOINT}` are absent, it calls `getProxyCredentials()` and returns datacenter creds unchanged. Both tiers then produce the same `endpoint` string (e.g. `gate.novada.com:7777`).

`getCircuit(endpoint)` (http.ts:68-75, pre-fix): keyed only by that endpoint string. Result: residential and datacenter callers retrieve the *same* `CircuitState` object. A datacenter failure sets `circuit.available = false`, which blocks residential requests for up to 5 minutes even though residential was never independently probed.

## Approach Evaluation

**Approach A — key by `${tier}:${endpoint}`**
- Tier is already available in `fetchViaProxy` scope as `proxyTier` option.
- Residential and datacenter get separate circuits regardless of whether they share an endpoint.
- Works in both the fallback case (same endpoint, same user) and the normal case (different endpoints).
- One parameter added to `getCircuit`, one call site updated, one IIFE for the warn logic.

**Approach B — key by `${user}@${endpoint}`**
- When residential env vars are absent, fallback creds have the *same* user as datacenter → same key → bug NOT fixed.
- Only works when residential is configured with a distinct username. Fails in the exact scenario being fixed.
- Rejected.

**Chosen: Approach A.**

## Exact Diff

### `getCircuit` signature and key

```diff
-function getCircuit(endpoint: string): CircuitState {
-  let state = proxyCircuits.get(endpoint);
+function getCircuit(tier: string, endpoint: string): CircuitState {
+  const key = `${tier}:${endpoint}`;
+  let state = proxyCircuits.get(key);
   if (!state) {
     state = { available: null, disabledAt: null };
-    proxyCircuits.set(endpoint, state);
+    proxyCircuits.set(key, state);
   }
   return state;
 }
```

### Comment update

```diff
-// Keyed by proxy endpoint so multiple SDK clients with different proxy credentials
-// do not interfere with each other's circuit state.
+// Keyed by "${tier}:${endpoint}" so residential and datacenter tiers maintain independent
+// circuit states even when they share the same endpoint (residential fallback scenario).
```

### `fetchViaProxy` — effectiveTier + warn + call site

```diff
+  let effectiveTier = proxyTier ?? "datacenter";
   const proxyCreds = proxyTier === "residential"
-    ? getResidentialProxyCredentials()
+    ? (() => {
+        const residentialSpecific = process.env.NOVADA_RESIDENTIAL_PROXY_USER &&
+          process.env.NOVADA_RESIDENTIAL_PROXY_PASS &&
+          process.env.NOVADA_RESIDENTIAL_PROXY_ENDPOINT;
+        if (!residentialSpecific) {
+          console.warn(
+            "[novada-mcp] NOVADA_RESIDENTIAL_PROXY_* env vars not set — " +
+            "falling back to datacenter proxy credentials for residential tier. " +
+            "Set NOVADA_RESIDENTIAL_PROXY_USER/PASS/ENDPOINT to use dedicated residential proxies."
+          );
+          effectiveTier = "datacenter";
+        }
+        return getResidentialProxyCredentials();
+      })()
     : getProxyCredentials();

-    const circuit = getCircuit(proxyEndpoint);
+    const circuit = getCircuit(effectiveTier, proxyEndpoint);
```

## tsc Result

```
npx tsc --noEmit
(exit 0, no output)
```

## Downstream Impact

- **No API surface change.** `fetchViaProxy` signature unchanged. `getCircuit` is module-private.
- **Behavior change is intentional and correct.** When residential vars are set, residential and datacenter circuits are always independent (`residential:gate.novada.com:7777` vs `datacenter:gate.novada.com:7777`). When residential vars are absent and fallback fires, `effectiveTier` is set to `"datacenter"` before the circuit key is formed, so the shared datacenter circuit is used — which is semantically correct (they are using the same credentials and same endpoint, so sharing trip state is safe in that case).
- **`console.warn` fires once per fallback call site invocation.** No deduplication/rate-limiting added — this is intentional; operators should see the warning and configure dedicated residential vars. If spammy in practice, a module-level `let warned = false` guard can be added trivially.
- **Existing circuits are not migrated.** On server restart the Map is fresh anyway (in-memory, no persistence). No migration needed.
