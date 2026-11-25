> **This folder IS the hosted deployment at mcp.novada.com** — an HTTP wrapper (auth, rate-limit) around [`../npm-package/`](../npm-package/README.md), running on AWS EC2 (since 2026-10-29; the Vercel project is paused). It lives inside the [novada-mcp monorepo](../README.md).

# hosted-server (mcp.novada.com)

**Novada Hosted MCP server** — deployed at `https://mcp.novada.com/mcp`. (History: merged from the former standalone `novada-mcpserver` repo on 2026-07-06.)

This is the **deployment surface** for Novada's MCP tools (whose source lives in the sibling [`../npm-package/`](../npm-package/README.md) — the `novada-mcp` package). It wraps those tools in a remote Streamable HTTP MCP transport so AI clients (Claude Desktop / Cursor / Cline / Windsurf / VS Code) can use them via one URL — zero install.

## Layout (inside the monorepo)

```
novada-mcp/                ← monorepo root
├── npm-package/           ← the novada-mcp package (tool source) — SIBLING of this folder
└── hosted-server/         ← THIS folder — the mcp.novada.com deployment
    ├── vercel/            ← ACTIVE — the server source; runs on EC2 via server.mts (dir name is historical; Vercel project PAUSED)
    │   ├── api/mcp.ts     ← auth + rate-limit + token validation
    │   ├── vendor/        ← GENERATED — vendored build of ../npm-package (do NOT hand-edit)
    │   ├── vercel.json
    │   └── README.md      ← deploy walkthrough
    ├── ec2/               ← PRODUCTION deploy — provisioning, systemd, nginx, deploy-ec2.sh / restart-rolling.sh
    ├── worker/            ← DORMANT — CF Workers port (reference only, not deployed)
    ├── landing/           ← novada.com/mcp landing page — DEPLOYED SEPARATELY, NOT by this Vercel project (mcp.novada.com is a bare API/MCP endpoint, no marketing pages)
    ├── docs/              ← user/ops docs (ARCHITECTURE, INSTALL, DEPLOY, DIRECTORIES)
    └── scripts/           ← deploy-hosted.sh (build/vendor/gates; Vercel deploy refused unless --vercel-standby), sync-to-hosted.mjs, golden/ baseline
```

The vendored build in `vercel/vendor/novada-mcp/` is regenerated from `../npm-package` — never edit it by hand.
Two ways to regenerate, same result: `scripts/deploy-hosted.sh --vendor-only` vendors inline with the build and gates
(build → vendor → gates, no deploy), while `scripts/sync-to-hosted.mjs` (`cd vercel && npm run sync:hosted`)
is the standalone re-vendor for local iteration WITHOUT deploying.

## Deploy quickstart

Production is **AWS EC2** (Frankfurt): nginx → two Node instances `novada-mcp@3000/@3001`.

1. Re-vendor and gate: `scripts/deploy-hosted.sh --vendor-only`, then commit.
2. Ship: `hosted-server/ec2/deploy-ec2.sh` (one instance at a time, health-gated on `/health/ready`, auto-rollback). Env change only: `hosted-server/ec2/restart-rolling.sh` (never a plain `systemctl restart`).
3. KV = local Redis via `REDIS_URL` in `/etc/novada-mcp/env` (Upstash REST `KV_REST_API_*` is the fallback when `REDIS_URL` is unset). No secrets live in the repo.
4. DNS: `mcp.novada.com` is an A record in AWS Route 53 pointing at the EC2 public IP (TTL 60; Elastic-IP status is an open audit item). It is no longer a CNAME to Vercel.

The Vercel project is **paused** (not a standby). `deploy-hosted.sh` refuses its legacy Vercel deploy phase unless `--vercel-standby` is passed.

## Related

- npm package: [`novada-mcp`](https://npmjs.com/package/novada-mcp) (the local MCP server — runs via `npx novada-mcp`)
- Source: [`../npm-package/`](../npm-package/README.md) (same monorepo — this folder wraps its built tools behind an HTTP endpoint at the edge)
