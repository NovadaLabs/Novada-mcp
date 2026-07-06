# Fix: SSL Auto-Retry + Chinese Domain Registry

Date: 2026-06-22

## Fix 1 — SSL error auto-retry (`src/utils/http.ts`)

### What changed

Added `import https from "https"` and a top-level `SSL_ERROR_CODES` Set. In the `fetchWithRetry` catch block, inserted a one-time retry with `rejectUnauthorized: false` placed after the 10MB check and before the `attempt === retries` gate.

### Diff (relevant section)

```diff
+import https from "https";
 import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";

+const SSL_ERROR_CODES = new Set([
+  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
+  "CERT_HAS_EXPIRED",
+  "DEPTH_ZERO_SELF_SIGNED_CERT",
+  "SELF_SIGNED_CERT_IN_CHAIN",
+  "ERR_TLS_CERT_ALTNAME_INVALID",
+]);

 // inside fetchWithRetry catch block:
+      // SSL error: retry once ignoring certificate validation — common for small Chinese sites with expired/self-signed certs
+      if (error instanceof AxiosError && SSL_ERROR_CODES.has((error.cause as NodeJS.ErrnoException)?.code ?? error.code ?? "")) {
+        return await axios.get(url, {
+          ...options,
+          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
+        });
+      }
       if (attempt === retries) throw error;
```

### Behaviour

- SSL code detected on any attempt → one-shot retry with cert validation disabled, propagates result or throws immediately.
- Not inside the retry loop, so it cannot compound with exponential backoff retries.
- Uses `NodeJS.ErrnoException` cast (no `any`) to satisfy the no-`any` coding style rule.

---

## Fix 2 — Chinese domains added to DOMAIN_REGISTRY (`src/utils/domains.ts`)

New section inserted before `// === BROWSER`:

| Domain | method | proxyTier | Note |
|--------|--------|-----------|------|
| zhihu.com | render | residential | Major CN Q&A, CF + JS-heavy |
| weibo.com | render | residential | CN social, JS SPA |
| bilibili.com | render | — | CN video platform, JS-heavy |
| douban.com | render | — | CN reviews/social |
| juejin.cn | render | — | CN dev community |
| csdn.net | render | — | CN dev blog platform |
| cnblogs.com | static | — | CN blog, mostly static |
| 51cto.com | render | — | CN tech platform |
| sspai.com | render | — | CN productivity media |
| 36kr.com | render | — | CN startup news |
| baidu.com | render | — | Baidu search |
| baike.baidu.com | render | — | Baidu encyclopedia |

Note: `baike.baidu.com` is an exact-match entry; the subdomain fallback logic in `lookupDomain` would otherwise collapse it to the `baidu.com` entry, but an explicit entry ensures the more specific note is preserved and avoids relying on traversal order.

---

## tsc result

```
(no output — zero errors, zero warnings)
```
