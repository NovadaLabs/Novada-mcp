# W4: Fix proxy username leak in ISP/Mobile/Datacenter tools

## Status: DONE

## Files changed
- `src/tools/proxy_isp.ts`
- `src/tools/proxy_mobile.ts`
- `src/tools/proxy_datacenter.ts`

## Problem
RT7 found these 3 proxy tools leaked the full proxy username (e.g. `tongwu_TRDI7X`) in response output strings: maskedUrl, env export lines, and Node.js axios usage examples. `proxy_residential.ts` was already fixed.

## Fix applied (per file)
1. Added `const maskedUser = user.slice(0, 4) + '***';` after credentials resolve
2. Built `maskedUsername` via the tool's `buildXxxUsername(maskedUser, params)` function
3. Built `encodedMaskedUser = encodeURIComponent(maskedUsername)`
4. Replaced all output-facing references:
   - `maskedUrl` now uses `encodedMaskedUser` (was `encodedUser`)
   - 4x env export lines now use `encodedMaskedUser` (was `encodedUser`)
   - Node.js axios example now uses `maskedUsername` (was `username`)

## What was NOT changed
- Actual proxy authentication (`username`/`encodedUser`) still used internally by `buildXxxUsername` -- only the displayed output is masked.

## Verification
- `npx tsc --noEmit` -- clean, zero errors
- Grep confirmed zero remaining `${encodedUser}` or `${username}` in output strings across all 3 files
- Pattern matches `proxy_residential.ts` reference implementation exactly
