# Novada MCP — Monorepo

This repository holds **two artifacts** for the same product (Novada's web-data MCP tools).
They share tool logic but ship on different rails.

```
novada-mcp/                    ← monorepo root (you are here)
├── npm-package/               ← the `novada-mcp` npm package (local stdio server)
│   ├── src/                   ←   tool logic lives here  ← EDIT TOOLS HERE
│   ├── tests/ · test/
│   ├── package.json           ←   published to npm as `novada-mcp`
│   └── README.md
│
├── hosted-server/             ← the mcp.novada.com deployment (HTTP wrapper on Vercel)
│   ├── vercel/api/mcp.ts      ←   auth + rate-limit + token validation  ← EDIT HOSTED LOGIC HERE
│   ├── vercel/vendor/         ←   GENERATED — do NOT edit by hand (see below)
│   ├── scripts/deploy-hosted.sh
│   └── README.md
│
├── .github/workflows/ci.yml   ← CI for npm-package/
└── README.md · CLAUDE.md
```

## Which folder do I edit?

| I want to…                                   | Go to                                        |
|----------------------------------------------|----------------------------------------------|
| Change a tool's behavior / add a tool        | `npm-package/src/tools/`                     |
| Change auth, rate-limit, or token handling   | `hosted-server/vercel/api/mcp.ts`            |
| Ship the hosted endpoint (mcp.novada.com)    | `hosted-server/scripts/deploy-hosted.sh`     |
| Cut an npm release                           | `npm-package/` — **REDLINE: owner approval** |

## The two artifacts

- **`npm-package/` IS the `novada-mcp` npm package** users run locally via `npx novada-mcp` (stdio transport). This is the source of truth for tool logic.
- **`hosted-server/` IS what runs at `https://mcp.novada.com`** — an HTTP wrapper (auth + rate-limit) around the npm package's built output, deployed on Vercel.

The hosted server does **not** re-implement tools. Its deploy script builds `npm-package/`, then vendors the compiled `build/` into `hosted-server/vercel/vendor/novada-mcp/`. **Never edit `hosted-server/vercel/vendor/` by hand** — it is regenerated on every deploy by `deploy-hosted.sh`.

## History

`hosted-server/` was merged in via `git subtree` from the former `novada-mcpserver` repo — its full commit history is preserved.
