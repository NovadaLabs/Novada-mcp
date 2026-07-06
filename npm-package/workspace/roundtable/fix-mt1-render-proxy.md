# Fix MT-1: Render-Path proxyTier Pass-Through

## Problem

`fetchWithRender()` in `http.ts` accepted only `country` in its options type, discarding any `proxyTier` before the fallback call to `fetchViaProxy()`. The call site in `extract.ts` (render branch, line 205) also passed no options at all. Result: five DOMAIN_REGISTRY domains with `proxyTier: "residential"` (airbnb, bestbuy, homedepot, lowes, yelp) silently fell back to datacenter proxies on the render path, while the static/auto path at lines 251-262 correctly passed proxyTier.

## Diff Applied

### `src/utils/http.ts` — signature + fallback call

```diff
-  options: Partial<AxiosRequestConfig> & { country?: string } = {}
+  options: Partial<AxiosRequestConfig> & { country?: string; proxyTier?: "residential" | "datacenter" } = {}
 ): Promise<AxiosResponse> {
   const unblockerKey = getWebUnblockerKey();
-  const { country, ...axiosOptions } = options;
+  const { country, proxyTier, ...axiosOptions } = options;

 ...

-  return fetchViaProxy(url, scraperApiKey, axiosOptions);
+  return fetchViaProxy(url, scraperApiKey, { ...axiosOptions, ...(proxyTier ? { proxyTier } : {}) });
```

### `src/tools/extract.ts` — render branch call site

```diff
-    const response = await fetchWithRender(params.url, apiKey);
+    const response = await fetchWithRender(params.url, apiKey,
+      domainHint?.proxyTier ? { proxyTier: domainHint.proxyTier } : {}
+    );
```

## tsc Result

```
(no output — zero errors)
```

## Scope Notes

- The Web Unblocker path (when `NOVADA_WEB_UNBLOCKER_KEY` is set) does not use `proxyTier` — it is a separate service with its own routing. The fix only affects the fallback `fetchViaProxy` path inside `fetchWithRender`.
- `domainHint` is only non-null when `renderMode === "auto"` (domain registry lookup). When the user explicitly passes `render="render"`, `domainHint` is null and the options remain `{}` — correct behavior, no regression.

## Expected Impact

| Metric | Before | After |
|---|---|---|
| Anti-Bot category score | ~60% | ~80% |
| Domains gaining residential proxy on render path | 0 | 5 (airbnb, bestbuy, homedepot, lowes, yelp) |

The 20-point lift assumes residential proxies achieve materially higher success rates against these domains' bot detection, consistent with the domain registry intent when proxyTier was configured.
