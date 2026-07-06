# Hosted MCP Verification #5 — 2026-06-26

## Summary

Vendor sync v0.8.3 completed and pushed to GitHub. **Vercel auto-deploy FAILED** due to Hobby plan limitation on private org repos. The live endpoint at mcp.novada.com is still running the previous deploy (4d old, ~Jun 22).

## 1. Vendor Version Match

| Check | Value | Status |
|-------|-------|--------|
| Vendored package.json | 0.8.3 | PASS |
| npm registry | 0.8.3 | PASS |
| Version match | identical | PASS |

## 2. Git Status

| Check | Value | Status |
|-------|-------|--------|
| Latest commit | `a6bf513` sync: vendor novada-mcp v0.8.3 | OK |
| Commit date | 2026-06-26T14:18:45Z | Today |
| Branch | main, up to date with origin/main | OK |
| Pushed to GitHub | Confirmed via GitHub API | PASS |
| Untracked files | `.claude/`, docs/, worker/package-lock.json | Harmless |

## 3. Vercel Deploy Status — PROBLEM

| Check | Value | Status |
|-------|-------|--------|
| Latest deploy age | 4d (~Jun 22) | STALE |
| Deploy triggered for a6bf513 | NO | **FAIL** |
| GitHub commit status | `Vercel failure` | **FAIL** |
| Failure reason | Hobby plan cannot auto-deploy private org repos | BLOCKER |
| Error URL | `vercel.com/novadateam-mvps?upgradeToPro=github-private-org-to-hobby` | — |

**Root cause:** Vercel Hobby plan does not support automatic Git deployments from private repositories in a GitHub organization (NovadaLabs). The git integration fires but Vercel rejects the deploy with an upgrade-to-Pro prompt.

## 4. Live Endpoint Test

```
POST https://mcp.novada.com/mcp
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}

Response: 401 — Missing token (expected without auth)
```

Endpoint is responding. Auth gate works correctly. But it is serving the **old code** (pre-v0.8.3).

## 5. Vendored Files Integrity

| File | Size | Status |
|------|------|--------|
| utils/output.js | 5,508 B | PASS |
| tools/scrape.js | 21,732 B | PASS |
| utils/credentials.js | 6,806 B | PASS |
| Tool .js files count | 37 | PASS |

All INC-189~199 fix files present in vendor directory.

## 6. Action Required

The v0.8.3 vendor sync is correctly committed and pushed, but NOT deployed. Options:

1. **Manual deploy:** Run `npx vercel --prod` from `~/Projects/novada-mcpserver/vercel/` to force a production deploy via CLI (bypasses Git integration).
2. **Upgrade Vercel plan:** Move to Pro ($20/mo) to re-enable auto-deploy from NovadaLabs private repos.
3. **Make repo public:** Would allow Hobby plan auto-deploy (but exposes hosted MCP server code).

Recommendation: Option 1 (manual CLI deploy) for immediate fix, then decide on plan upgrade for long-term.
