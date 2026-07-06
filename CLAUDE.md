# CLAUDE.md — Novada MCP Monorepo

This repo is a **monorepo** with two artifacts. Read the routing table before editing.

## The two artifacts (one-liners)

- **`npm-package/` IS the `novada-mcp` npm package** users run locally via `npx novada-mcp` (a local **stdio** MCP server). Tool logic lives here.
- **`hosted-server/` IS what runs at `https://mcp.novada.com`** — an **HTTP wrapper** (auth + rate-limit) around `npm-package`, deployed on **Vercel**.

## Which folder do I edit?

| Task                                       | Path                                         |
|--------------------------------------------|----------------------------------------------|
| Tool logic (behavior, add/remove a tool)   | `npm-package/src/tools/`                      |
| Auth / rate-limit / token validation       | `hosted-server/vercel/api/mcp.ts`            |
| Ship hosted (mcp.novada.com)               | `hosted-server/scripts/deploy-hosted.sh`     |
| npm release                                | `npm-package/` — **REDLINE: owner approval** |

## Rules

- **Never edit `hosted-server/vercel/vendor/` by hand.** It is *generated* by `deploy-hosted.sh` (which builds `npm-package/` and rsyncs its `build/` output into the vendor dir). Hand edits will be overwritten on the next deploy.
- **REDLINE:** no npm publish, no `vercel deploy`, no version bump, no push without explicit owner approval.
- Tool logic has ONE home: `npm-package/src/`. The hosted server consumes the built artifact — it never forks tool behavior.
- `hosted-server/scripts/deploy-hosted.sh` deploys from `hosted-server/` (the Vercel project root) and vendors from `../npm-package`.

## Layout

```
npm-package/     → npm `novada-mcp` (stdio)      [tool logic]
hosted-server/   → mcp.novada.com (Vercel HTTP)  [auth + rate-limit + deploy]
.github/         → CI for npm-package/
```
