# round3-all — Round 3 Fix & Verify integration branch (INTERNAL TEST ONLY)

**Purpose:** all 11 Round-3 `fix/*` branches combined into one branch so the team can test the whole revamp as it would ship. **Test repo only** (`NovadaLabs/test-novada-mcp-test`). NOT merged to `main`, NOT on public origin, NOT published to npm.

Base: local `main` `7356964` (0.9.1, ahead of public origin's 0.9.0).

## Status
- `npm run build` — clean (tsc + chmod).
- `npx vitest run` — **1219 passed / 37 failed / 1256 total**.
- The **37 failures are pre-existing on `main`** (verified: `research.test.ts` fails the identical 5 on main; the rest are known mock/env failures in `scrape`/`types(classifyError export)`/`health`/`schemas`/`resources`/`sdk-client`/`router`/`http`/`html`). **Zero regressions from combining the 11 branches.**
- One merge-resolution fix was needed and made: `extract.test.ts` brace balance after unioning the F2 + F12 test blocks (`fix(test): repair extract.test.ts brace balance`).

## What's combined (36 defects, F1–F16 + C1–C14 + closure-round-2 structural/security)
crawl (glob+dedup) · discover (category gating) · extract (redaction + urls alias + blockpage/5001) · fields (description quality) · map (sitemap honesty) · research (synthesis) · search (sentinel + time_range + json) · verify (stance mitigation) · cred-leak (test-file secrets removed).

## ⚠️ Read before testing
1. **monitor is PREVIEW / heuristic — do NOT treat as ship-ready.** It carries F5+C7+C8 (real, approved improvements to the false-"changed" bug) PLUS the Round-3e anchor-from-structure heuristic that a fresh Opus reviewer **VETO'd** and that is **escalated to an architecture decision** (the stable-hash body-isolation must move to hashing extract's structured `content` field, not string-parsing a markdown blob). Test monitor's behavior, but the deepest layer is known-incomplete by design.
2. **🔴 Credential rotation is still a human action.** The cred-leak code fix removes secrets from the working tree, but git history retains all four permanently — rotate `NOVADA_API_KEY`, proxy pass, browser WS password, unblocker key on the Novada dashboard regardless of this branch.
3. **This combination has NOT been through the worker→verifier→reviewer loop as a unit.** Each of the 11 branches was individually verified+reviewed; the *merge* of them is a mechanical combine + build + full-suite pass. Merge-conflict resolutions made by hand: `monitor.ts` error path (kept redaction + format-awareness), `monitor.ts` stripVolatile (took the latest anchor version, re-applied redaction), `extract.test.ts` (union of F2+F12 test blocks).

## Promotion path (to public, when approved)
Human merge-review of the individual `fix/*` branches → decide monitor + bot-detection architecture → rotate creds → then a disciplined promote (exact tested commits, not a re-derivation) to public origin + npm. **None of that is done here.**
