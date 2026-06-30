# worker-proxy fix status

Date: 2026-06-23

## Fix 1 — Password masking in output (INC-170)

**Files changed:** proxy_static.ts, proxy_dedicated.ts

Both files had `proxyPass` embedded raw in two output branches:
- `curl` format: `curl -x IP:PORT -U "USER:PASS"` — replaced `${proxyPass}` with `***` and added `# Replace *** with your proxy password` comment
- `env` format: `export HTTP_PROXY="http://USER:PASS@..."` — replaced hardcoded password with shell variable pattern (`${STATIC_PROXY_PASS}` / `${DEDICATED_PROXY_PASS}`) consistent with zone-based tools

The `url` (default) format already used `maskedCmd` which had `***` — no change needed there.
The parsed `proxyPass` variable is retained in scope for potential future use; only output strings were changed.

## Fix 2 — Dead encodedPass variable removal (INC-170)

**Files changed:** proxy_residential.ts, proxy_isp.ts, proxy_datacenter.ts, proxy_mobile.ts

Each file had:
```ts
const encodedPass = encodeURIComponent(pass);
```
declared immediately after `encodedUser` but never referenced anywhere in the function. All output strings use `maskedUrl` (which has `***`) or the shell variable `${NOVADA_PROXY_PASS}`.

Removed the single declaration line from all four files. No other variables touched.

## Verify

`npx tsc --noEmit` — 0 errors, 0 warnings.
