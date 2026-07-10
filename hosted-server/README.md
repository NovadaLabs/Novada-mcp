> **This folder IS the hosted deployment at mcp.novada.com** — an HTTP wrapper (auth, rate-limit) around [`../npm-package/`](../npm-package/README.md), deployed on Vercel. It lives inside the [novada-mcp monorepo](../README.md).

# hosted-server (mcp.novada.com)

**Novada Hosted MCP server** — deployed at `https://mcp.novada.com/mcp`. (History: merged from the former standalone `novada-mcpserver` repo on 2026-07-06.)

This is the **deployment surface** for Novada's MCP tools (whose source lives in the sibling [`../npm-package/`](../npm-package/README.md) — the `novada-mcp` package). It wraps those tools in a remote Streamable HTTP MCP transport so AI clients (Claude Desktop / Cursor / Cline / Windsurf / VS Code) can use them via one URL — zero install.

## Layout (inside the monorepo)

```
novada-mcp/                ← monorepo root
├── npm-package/           ← the novada-mcp package (tool source) — SIBLING of this folder
└── hosted-server/         ← THIS folder — the mcp.novada.com deployment
    ├── vercel/            ← ACTIVE — Vercel Node.js function (deployed)
    │   ├── api/mcp.ts     ← auth + rate-limit + token validation
    │   ├── vendor/        ← GENERATED — vendored build of ../npm-package (do NOT hand-edit)
    │   ├── vercel.json
    │   └── README.md      ← deploy walkthrough
    ├── worker/            ← DORMANT — CF Workers port (reference only, not deployed)
    ├── landing/           ← novada.com/mcp landing page — DEPLOYED SEPARATELY, NOT by this Vercel project (mcp.novada.com is a bare API/MCP endpoint, no marketing pages)
    ├── docs/              ← user/ops docs (ARCHITECTURE, INSTALL, DEPLOY, DIRECTORIES)
    └── scripts/           ← deploy-hosted.sh, sync-to-hosted.mjs, golden/ baseline
```

The vendored build in `vercel/vendor/novada-mcp/` is regenerated from `../npm-package` — never edit it by hand.
Two ways to regenerate, same result: `scripts/deploy-hosted.sh` vendors inline as part of a full release
(build → vendor → gates → deploy → golden verify), while `scripts/sync-to-hosted.mjs` (`cd vercel && npm run sync:hosted`)
is the standalone re-vendor for local iteration WITHOUT deploying.

## Deploy quickstart

See `vercel/README.md` for the full walkthrough, or run the gated one-shot
`scripts/deploy-hosted.sh` (build → vendor → gates → deploy → verify). TL;DR for a
fresh Vercel project:

1. Point Vercel at this monorepo → set Root Directory to `hosted-server/vercel/`.
2. Add env vars + Vercel KV.
3. CNAME `mcp.novada.com` → `cname.vercel-dns.com` at AWS Route 53.

## Related

- npm package: [`novada-mcp`](https://npmjs.com/package/novada-mcp) (the local MCP server — runs via `npx novada-mcp`)
- Source: [`../npm-package/`](../npm-package/README.md) (same monorepo — this folder wraps its built tools behind an HTTP endpoint at the edge)
