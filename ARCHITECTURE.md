# Architecture — novada-mcp monorepo

> **Read this first.** One screen, whole repo. For product install docs see root [`README.md`](./README.md); for hosted deploy/auth/quota internals see [`hosted-server/docs/ARCHITECTURE.md`](./hosted-server/docs/ARCHITECTURE.md) (a linked deep-dive, not a competing map); for the tool-logic module map see [`npm-package/ARCHITECTURE.md`](./npm-package/ARCHITECTURE.md).

## The pipeline — both entrances, one dispatch core

Two entrances exist. Both converge on the **same** dispatch core — the hosted server never forks tool behavior.

```
AI client
  │
  ├─ stdio ── npx novada-mcp ──────────────► npm-package/src/index.ts
  │                                            (stdio transport, tool/group filtering)
  │
  └─ HTTP ─── https://mcp.novada.com/mcp ──► hosted-server/vercel/api/mcp.ts
                                               (Vercel Function: auth, quota, rate-limit,
                                                telemetry — wraps the SAME tool catalog)
                                                              │
                        both dispatch through                │
                        ─────────────────────────────────────┘
                                                              ▼
                                          npm-package/src/core.ts
                                          (TOOLS catalog + dispatch() — side-effect-free,
                                           importable from either transport or tests)
                                                              │
                                                              ▼
                                    npm-package/src/tools/*.ts (43 files: 40 per-tool
                                    implementations + index.ts barrel + registry.ts +
                                    types.ts)
                                                              │
                                                              ▼
                                    Novada upstream APIs (proxy network, scraper, SERP)
```

`hosted-server/vercel/api/mcp.ts` does not re-implement tools. Its deploy step
(`hosted-server/scripts/deploy-hosted.sh`) builds `npm-package/`, then vendors the
compiled `build/` output into `hosted-server/vercel/vendor/` — never hand-edited,
regenerated every deploy.

## Where does X actually live?

The single biggest source of confusion in this repo has been "where do I edit a tool's
MCP-facing description?" — three different places could plausibly be it. This table is
the resolution, grep-verified against the live code:

| Concept | Authoritative file |
|---|---|
| Full MCP tool description + inputSchema + annotations (what the client sees) | `npm-package/src/core.ts` → `_TOOL_DEFINITIONS` (~line 171) |
| Curated visible-tool list + short catalog one-liner (used by `novada_discover`) | `npm-package/src/tools/registry.ts` → `TOOL_REGISTRY` |
| Drift guard (registry ⊆ dispatchable, no ghost tools) | `npm-package/tests/tools/discover.test.ts` |
| Tool implementation + Zod param validation | `npm-package/src/tools/<name>.ts` |
| stdio transport wiring, env-based tool/group filtering (`NOVADA_TOOLS`/`NOVADA_GROUPS`) | `npm-package/src/index.ts` |
| HTTP transport, auth, quota, rate-limit, telemetry | `hosted-server/vercel/api/mcp.ts` |
| MCP resources (read-only reference data) | `npm-package/src/resources/` |
| MCP prompts (workflow templates) | `npm-package/src/prompts/` |
| Deploy hosted (build → vendor → gate → deploy → verify) | `hosted-server/scripts/deploy-hosted.sh` |

**Concretely:** to change what an AI client reads for a tool (its description, required
params, examples), edit `_TOOL_DEFINITIONS` in `core.ts`, not `index.ts` and not the
`tools/<name>.ts` file (that file only holds the implementation + its own Zod schema).

## Distribution

| Surface | Package/URL | Transport | Deploy target |
|---|---|---|---|
| Local stdio server | npm `novada-mcp` (`npx novada-mcp`) | stdio | n/a — runs on the user's machine |
| Hosted HTTP server | `https://mcp.novada.com/mcp` | Streamable HTTP | Vercel (Node.js serverless Function, **not** Cloudflare Workers — see below) |

Both ship the identical tool catalog and behavior; the hosted surface adds auth, a
monthly quota, and rate-limiting on top (see `hosted-server/docs/ARCHITECTURE.md` for
that layer's detail). Browser-automation tools (`novada_browser`, `novada_browser_flow`)
require `NOVADA_BROWSER_WS` and work identically on both surfaces — this is a credential
requirement, not a hosted-vs-local capability gap (see `npm-package/README.md`).

**Live deploy target is Vercel, not Cloudflare Workers.** A dormant CF Workers port
exists at `hosted-server/worker/` for reference only (not deployed); `hosted-server/vercel/`
is the active, deployed path. Confirmed directly against `hosted-server/vercel/api/mcp.ts`'s
own runtime config (`export const config = { runtime: "nodejs", ... }`, explicitly chosen
over Edge because the tool implementations depend on Node-only modules) and
`hosted-server/README.md`.
