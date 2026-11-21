# Architecture — Novada Hosted MCP

> Audience: engineers maintaining or extending `mcp.novada.com`.

---

## 1. High-level diagram

```
AI client (Claude Desktop / Cursor / Cline / Windsurf / VS Code)
     │
     │  Streamable HTTP  (POST + GET on /mcp)
     │  Auth: Authorization: Bearer …  OR  OAuth 2.1 access token (same header)
     ▼
EC2 host  (mcp.novada.com — nginx → 2 Node instances novada-mcp@3000/@3001, Frankfurt)
     │
     ├─ Token validation   (stubbed → sub2api in v0.2)
     ├─ Per-IP rate limit  (KV = local Redis via REDIS_URL, Upstash REST fallback: 60 req/min — no call cap)
     ├─ Tool dispatch      (re-uses novada-mcp tool handlers, vendored from npm-package)
     └─ Telemetry          → Sentry (errors) + custom behavior-telemetry event log
     │
     ▼
Novada upstream APIs  (api.novada.com — proxy network, scraper, SERP)
```

---

## 2. Transport

We implement **Streamable HTTP** per the MCP spec (revision March 2025).

- Single endpoint `/mcp` accepts:
  - `POST` for client → server JSON-RPC messages.
  - `GET` (with `Accept: text/event-stream`) for server → client streaming notifications.
- We do **not** implement legacy **HTTP+SSE** transport — it was deprecated in the March 2025 spec and most modern clients (Claude Desktop, Cursor, Claude Code CLI) ship Streamable HTTP support.
- We do **not** ship a **stdio** transport in this codebase — stdio is local-only and is covered by the separate `novada-mcp` npm package.

---

## 3. Authentication

Two credential sources, enforced by Anthropic's Claude Directory connector review
rules (a URL query parameter or path segment must never carry a credential —
it ends up in server logs, proxies, and browser history):

1. **Bearer header** — `Authorization: Bearer sk-eu-novada-…`
   The primary credential source for header-capable clients.
2. **OAuth 2.1 access token** — same `Authorization: Bearer` header, minted by
   this server's own OAuth AS (`/authorize`, `/token`) after the caller signs
   in; resolved to the underlying Novada key before validation.

A request carrying a credential in the URL (any query parameter or path
segment) is rejected with `401` — the server never reads one from there, by
design. Both header forms resolve to the same internal `validateToken(token)` call.

### Token format

```
sk-eu-novada-{32 random base62 chars}
```

- Prefix `sk-eu-novada-` distinguishes from `sk-eu-prismma-*` (Prismma EU Gateway uses the same prefix family but is a different product).
- Region tag `eu` reflects the primary issuance region; routing is global.

---

## 4. Billing model

> 2026-10-29: the monthly free-call cap described in earlier revisions of this
> doc was removed (owner decision) — there is no per-token monthly quota
> counter or free-call allowance anymore. See `npm-package/CHANGELOG.md` under
> `[Unreleased]`.

- **No monthly call cap.** Every successful tool call is billed to the
  caller's own Novada account balance — same billing as calling the REST API
  directly.
- New accounts start with **$10 free credits** (a one-time signup credit, not
  a recurring monthly allowance).
- `novada_setup`, `novada_discover`, `novada_account` (and its aliases) never
  cost anything and are never counted.
- Per-IP rate limiting (60 req/min, independent of billing) is unchanged —
  see §6 for the 429 behavior that remains.

---

## 5. Deployment

> Production moved from Vercel to **AWS EC2 on 2026-10-29**; the Vercel project is
> **paused** (not a standby). KV moved to a local Redis on 2026-11-20.

- **Runtime:** a Node 24 process per instance (`vercel/server.mts` is the entrypoint;
  `vercel/api/mcp.ts` keeps the `maxDuration: 300` tool budget). Two systemd template
  instances `novada-mcp@3000` / `@3001` sit behind nginx on one EC2 host (`hosted-server/ec2/`).
  The Node-only tool dependencies (`axios`, `cheerio`, `playwright-core`, `exceljs`, `pdf-parse`)
  and the MCP SDK's `EventEmitter` still rule out an Edge runtime.
- **Domain / DNS:** `mcp.novada.com` (and `mcp-staging.novada.com`, an alias of production)
  are **A records in AWS Route 53 (TTL 60) pointing at the EC2 public IP**. TLS terminates on nginx
  (Let's Encrypt certificate; renewal is currently manual DNS-01, tracked in the 2026-11-20 audit,
  and the health monitor alerts when expiry is under 21 days).
- **Storage (KV):** a **local Redis** (`redis-server`, bound to 127.0.0.1) selected by
  `REDIS_URL` in `/etc/novada-mcp/env`, used for the per-IP rate limit, the token-verification
  cache, first-run-notice flag, and OAuth state. When `REDIS_URL` is unset the adapter falls back
  to Upstash REST (`KV_REST_API_URL`/`KV_REST_API_TOKEN`, via `@vercel/kv`); rollback is "unset
  `REDIS_URL` and restart". See `vercel/api/_kv.ts`. There is no per-token quota counter — see §4.
- **Telemetry:** Sentry (`@sentry/node`, errors only, `tracesSampleRate: 0`; environment from
  `SENTRY_ENVIRONMENT`, falling back to `VERCEL_ENV`) plus a custom metadata-only behavior-telemetry
  event log (see `vercel/api/_telemetry.ts`; region from `NOVADA_REGION`, falling back to `VERCEL_REGION`).
- **Deploy:** manual, gated — re-vendor with `hosted-server/scripts/deploy-hosted.sh --vendor-only`
  (build → vendor → gates), commit, then `hosted-server/ec2/deploy-ec2.sh` (one instance at a time,
  health-gated, automatic rollback). `deploy-hosted.sh` REFUSES its legacy Vercel deploy phase unless
  `--vercel-standby` is passed. Not automatic CI-on-push.
- A dormant Cloudflare Workers port of this same logic exists at `hosted-server/worker/`
  for reference only — it is **not** deployed. See `hosted-server/README.md` for the
  ACTIVE-vs-DORMANT layout.

---

## 6. Failure modes

| Condition                       | Status | Response                                        |
|---------------------------------|--------|-------------------------------------------------|
| Missing / malformed token       | 401    | `{ "error": "invalid_token" }`                  |
| Per-IP rate limit exceeded      | 429    | `Retry-After: 60`                               |
| Tool error (upstream 5xx etc.)  | 200    | JSON-RPC error wrapped in MCP response          |
| Tool budget / request timeout (300s tool budget, 310s nginx + Node) | 5xx | Logged + alert; client must retry     |
| Unknown tool name               | 200    | JSON-RPC `MethodNotFound` (-32601)              |
| Malformed JSON-RPC              | 400    | `{ "error": "invalid_request" }`                |

---

## 7. Roadmap — v0.2 and beyond

- **sub2api billing integration** — replace stub token validator with real subscription lookup.
- **OAuth 2.1 + Dynamic Client Registration (DCR)** — required by Claude Desktop "Custom Connectors" UI. Issue access tokens scoped per workspace; refresh tokens; PKCE.
- **Regional pinning** — `mcp.us.novada.com`, `mcp.eu.novada.com`, `mcp.cn.novada.com` for compliance.
- **Tool gating** — workspace admins disable specific tools (e.g. block `browser` in enterprise plan).

---

## 8. Why this design

- **Stateless serverless Function** — each request gets a fresh isolate; no session affinity needed; horizontally scales for free (traded against ~200ms cold start vs Edge's ~50ms — see §5).
- **KV for rate limiting** — eventually consistent is fine for a per-minute counter; replaces a heavier SQL/D1-style choice.
- **Single endpoint** matches MCP spec and avoids per-tool route explosion.
- **Reuse tool handlers** from `novada-mcp` npm package (vendored build) — single source of truth for tool schemas + business logic; the Vercel Function is a thin transport adapter.
