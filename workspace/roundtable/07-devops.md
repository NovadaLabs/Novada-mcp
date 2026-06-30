# DevOps Engineer — Deployment Reliability

## 1. #1 Infrastructure Risk: Manual Vendor Sync

The hosted server runs a **vendored copy** of the npm package, not the package itself. Every release requires `sync-to-hosted.sh` to be run manually — build, copy to vendor dir, commit, push, then `npx vercel deploy --prod`. Any step forgotten means mcp.novada.com silently serves stale code. The 4-day drift we hit today is the proof. This is not a process problem — it's an architecture problem. The vendor copy pattern itself is the risk.

## 2. Automate Next Week: Post-Push Deploy Hook

Create a GitHub Actions workflow on `novada-mcpserver` that triggers `vercel deploy --prod` on every push to `main`. This eliminates the manual deploy step immediately. For the sync step, add a `repository_dispatch` trigger from `novada-mcp` CI that fires after successful npm build, runs the vendor copy, commits, and pushes — which then triggers the deploy workflow. Two workflows, zero manual steps.

## 3. Vercel Hobby vs Upgrade

**Stay on Hobby for now.** The auto-deploy limitation only affects private org repos — solvable with the GitHub Actions workflow above at zero cost. Upgrade to Pro only when we need: preview deployments for PRs, team access, or edge function compute limits. Current traffic doesn't justify $20/mo. The real investment should go into eliminating the vendor copy pattern entirely — serve directly from the npm package at runtime.
