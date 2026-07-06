# Fix: Proxy Description Contradictions

## Fix 1 — setup.ts: Add unified key note after env var table

**File:** `src/tools/setup.ts` (after line 50)

Added two lines after the env var status table and before the Summary section:

```
**Unified API Key:** NOVADA_API_KEY covers search, extract, research, crawl, scrape, unblock, and proxy auto-provisioning.
**Proxy auto-provision:** If NOVADA_PROXY_ENDPOINT is set, user/pass are auto-fetched from your account — no separate NOVADA_PROXY_USER/PASS needed.
```

## Fix 2 — index.ts: Update Requires line across all 7 proxy tools

**File:** `src/index.ts`

Tools updated (7 total): `novada_proxy`, `novada_proxy_residential`, `novada_proxy_isp`, `novada_proxy_datacenter`, `novada_proxy_mobile`, `novada_proxy_static`, `novada_proxy_dedicated`

Old line (identical across all 7):
```
**Requires:** NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT env vars.
```

New line (applied to all 7):
```
**Requires:** NOVADA_PROXY_ENDPOINT env var. NOVADA_PROXY_USER/PASS are auto-fetched from your account using NOVADA_API_KEY if not explicitly set.
```

Verified with grep: 0 occurrences of the old pattern remain in `src/`.

## Fix 3 — health.ts: Update proxy unconfigured message

**File:** `src/tools/health.ts` (line 209)

Old:
```
- Proxy: Export NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT
```

New:
```
- Proxy: Set NOVADA_PROXY_ENDPOINT (user/pass auto-provisioned from NOVADA_API_KEY). Or set NOVADA_PROXY_USER, NOVADA_PROXY_PASS, NOVADA_PROXY_ENDPOINT for explicit credentials.
```

## tsc result

```
npx tsc --noEmit
(no output — clean)
```

Exit code 0. No type errors.
