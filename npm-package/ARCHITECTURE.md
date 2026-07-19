# Architecture — npm-package (`novada-mcp`)

> Audience: anyone editing tool logic. This is the **ONE home for tool logic** in the
> monorepo (see root [`CLAUDE.md`](../CLAUDE.md)) — the hosted server never forks
> behavior, it vendors this package's built output. For the cross-artifact / two-entrance
> map, see root [`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Module map

| Path | Role |
|---|---|
| `src/index.ts` | **stdio entry point** (npm bin: `novada-mcp`). Wires the MCP `Server`, request handlers, and env-based tool/group filtering (`NOVADA_TOOLS`/`NOVADA_GROUPS`). Imports `TOOLS`/`dispatch` from `core.ts` — does not define tool descriptions itself. |
| `src/core.ts` | **Dispatch core.** Side-effect-free — no server construction, no `process.exit`, no stdio boot — so it can be imported by `index.ts`, the hosted `mcp.ts`, or tests. Holds `_TOOL_DEFINITIONS` (full MCP schema: description + inputSchema + annotations, per tool) and exports `TOOLS` (derived from `registry.ts`, so it can never drift) and `dispatch()`. |
| `src/cli.ts` | **Separate direct CLI** (npm bin: `novada`, e.g. `novadasearch "..."`) — not an MCP server, a standalone command surface over the same tool functions. |
| `src/config.ts` | Shared config/constants (e.g. `VERSION`). |
| `src/tools/` | 43 files: 40 per-tool implementation files (one per tool, e.g. `search.ts`, `extract.ts`, `proxy.ts`) each holding the handler function + its Zod param schema, plus `index.ts` (barrel export), `registry.ts` (curated visible-tool catalog + drift guard — see below), and `types.ts` (shared param schemas). |
| `src/tools/registry.ts` | `TOOL_REGISTRY` — the single source of truth for which tools are visible + their short catalog one-liner (used by `novada_discover`). `tests/tools/discover.test.ts` asserts this stays in sync with `core.ts`'s dispatchable set. Do not maintain a second copy anywhere. |
| `src/resources/` | MCP resources — read-only reference data (e.g. scraper platform catalog) an agent can query before calling a tool. |
| `src/prompts/` | MCP prompts — pre-defined workflow templates surfaced in MCP client UIs. |
| `src/_core/` | Shared internal infra (underscore prefix = internal, not a tool): `auth.ts`, `developer_api.ts`, `errors.ts`, `request-log.ts`, `route-memory.ts`, `session-cache.ts`, `types.ts`. |
| `src/sdk/` | Programmatic (non-MCP) import surface for embedding tool functions directly in other code. |
| `src/data/` | Static reference data (e.g. `scraper_catalog.ts`, backing `src/resources/`). |
| `src/utils/` | Shared utilities (credential resolution, domain/proxy config checks, first-run notice, etc). |

## Request flow inside this package

```
index.ts (stdio)  ──┐
                     ├─► core.ts: dispatch(name, args, apiKey, opts)
hosted mcp.ts     ──┘         │
 (vendored copy               ├─ validates params against the tool's Zod schema
  of this build/)             ├─ looks up the implementation in tools/<name>.ts
                               └─ returns a plain string result (throws on error —
                                  callers wrap it in their own MCP content/error shape)
```

`core.ts` throws on unknown tool names and on tool errors — it does not build an MCP
response envelope itself. Each transport (`index.ts` for stdio, the hosted
`vercel/api/mcp.ts` for HTTP) wraps `dispatch()`'s result/throw into its own
`content`/`isError` shape, since the two transports have different error-reporting needs
(hosted adds telemetry + quota deduction on top).

## Adding or changing a tool

1. Implementation + Zod schema → `src/tools/<name>.ts`.
2. Wire the export through `src/tools/index.ts`.
3. Full MCP-facing description + inputSchema + annotations → `src/core.ts`'s
   `_TOOL_DEFINITIONS`.
4. Visibility + short catalog description → `src/tools/registry.ts`'s `TOOL_REGISTRY`.
5. `tests/tools/discover.test.ts` will fail if 3 and 4 drift apart — that's intentional.
