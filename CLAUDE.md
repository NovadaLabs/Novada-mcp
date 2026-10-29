# CLAUDE.md — Novada MCP Monorepo

This repo is a **monorepo** with two shipped artifacts (plus supporting dirs, see Layout). Read the routing table before editing.

## The two shipped artifacts (one-liners)

- **`npm-package/` IS the `novada-mcp` npm package** users run locally via `npx novada-mcp` (a local **stdio** MCP server). Tool logic lives here.
- **`hosted-server/` IS what runs at `https://mcp.novada.com`** — an **HTTP wrapper** (auth + rate-limit) around `npm-package`. Since **2026-10-29 production runs on AWS EC2** (Frankfurt; `hosted-server/ec2/`: nginx → two Node instances `novada-mcp@3000/@3001`). The Vercel project is a hot standby until it is paused (~2026-11-05).

## Which folder do I edit?

| Task                                       | Path                                         |
|--------------------------------------------|----------------------------------------------|
| Tool logic (behavior, add/remove a tool)   | `npm-package/src/tools/`                      |
| Auth / rate-limit / token validation       | `hosted-server/vercel/api/mcp.ts`            |
| Ship hosted (mcp.novada.com, EC2)          | re-vendor + commit, then `hosted-server/ec2/deploy-ec2.sh` (see note below) |
| Restart hosted after an env change         | `hosted-server/ec2/restart-rolling.sh` — never `systemctl restart` |
| npm release                                | `npm-package/` — **REDLINE: owner approval** |

## Rules

- **`mcp.novada.com` is a bare API endpoint** (since 2026-07-10, matching Bright Data/Firecrawl/Tavily) — `vercel.json` routes everything except `/mcp` and `/:key/mcp` through a catch-all `/(.*)` → `api/mcp.ts`, which returns a bare JSON pointer at `/` and a clean 404 for anything unmatched. No marketing HTML lives here anymore — that content is `hosted-server/landing/` (separate deploy target for novada.com, out of scope for this project). **If Vercel Analytics or Speed Insights is ever enabled on this project, add an explicit `/_vercel/(.*)` passthrough rule ABOVE the catch-all in `vercel.json` first** — otherwise the catch-all will swallow `/_vercel/insights/*` and `/_vercel/speed-insights/*` before Vercel's own routes get a chance.
- **Never edit `hosted-server/vercel/vendor/` by hand.** It is *generated* by `deploy-hosted.sh` (which builds `npm-package/` and rsyncs its `build/` output into the vendor dir). Hand edits will be overwritten on the next deploy.
- **REDLINE:** no npm publish, no `vercel deploy`, no version bump, no push without explicit owner approval.
- Tool logic has ONE home: `npm-package/src/`. The hosted server consumes the built artifact — it never forks tool behavior.
- `hosted-server/scripts/deploy-hosted.sh` deploys from `hosted-server/` (the Vercel project root) and vendors from `../npm-package`. **⚠️ Since the EC2 cutover it still deploys to Vercel (standby), while its VERIFY phase curls `mcp.novada.com`, which is now EC2** — use it only for its BUILD/VENDOR/GATES phases until it is re-pointed; production deploys go through `hosted-server/ec2/deploy-ec2.sh` (one instance at a time, health-gated, auto-rollback).
- EC2 hosted ops: zero-downtime restarts only (`restart-rolling.sh` / `deploy-ec2.sh`). A plain `systemctl restart` caused a 75 s outage on 2026-10-29 — see `hosted-server/ec2/MIGRATE-TO-TEMPLATE-UNIT.md`.

## Layout

```
npm-package/     → npm `novada-mcp` (stdio)      [tool logic]
hosted-server/   → mcp.novada.com (EC2; Vercel standby) [auth + rate-limit + deploy]
  vercel/        →   the HTTP server (Vercel functions + EC2 entrypoint server.mts)
  ec2/           →   EC2 provisioning, systemd, nginx, deploy/restart/drill scripts
distribution/    → Dify/Codex/Antigravity plugins + channel registry + claims gate (check.mjs)
monitoring/      → DingTalk health alerts, canary, k6 load tests
config/          → surfaces.json (shared surface/tool config)
scripts/         → repo-level scripts (check-hosted-drift.mjs)
docs/            → TOOLS.md + assets
.github/         → CI
```
