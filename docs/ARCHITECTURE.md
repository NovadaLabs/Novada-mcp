# Architecture — Novada Hosted MCP

> Audience: engineers maintaining or extending `mcp.novada.com`.

---

## 1. High-level diagram

```
AI client (Claude Desktop / Cursor / Cline / Windsurf / VS Code)
     │
     │  Streamable HTTP  (POST + GET on /mcp)
     │  Auth: ?token=…  OR  Authorization: Bearer …
     ▼
Cloudflare Workers Edge  (mcp.novada.com)
     │
     ├─ Token validation   (stubbed → sub2api in v0.2)
     ├─ Quota check        (CF KV: 5000 calls/mo/key)
     ├─ Tool dispatch      (re-uses novada-mcp tool handlers)
     └─ Telemetry          → CF Analytics Engine
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

Dual-mode for parity with Tavily / BrightData hosted servers:

1. **URL query** — `https://mcp.novada.com/mcp?token=sk-eu-novada-…`
   Easiest copy-paste install for clients that don't expose a custom-header field.
2. **Bearer header** — `Authorization: Bearer sk-eu-novada-…`
   Preferred when the client supports it (no token in logs).

Both modes resolve to the same internal `validateToken(token)` call.

### Token format

```
sk-eu-novada-{32 random base62 chars}
```

- Prefix `sk-eu-novada-` distinguishes from `sk-eu-prismma-*` (Prismma EU Gateway uses the same prefix family but is a different product).
- Region tag `eu` reflects the primary issuance region; routing is global.

---

## 4. Free quota model

- **5,000 calls / month / key.**
- Counter stored in Cloudflare KV, keyed by `<token>:<YYYY-MM>`.
- Increment on every successful tool call (not on auth/list operations).
- TTL on each KV entry: 32 days (auto-purge previous month).
- Reset: implicit — the next month uses a new key.

**Pseudocode**

```text
key   = `${token}:${utcYearMonth()}`
count = (await KV.get(key)) ?? 0
IF count >= 5000:
  RETURN 429 with Retry-After = secondsUntilNextMonth()
await KV.put(key, count + 1, { expirationTtl: 60*60*24*32 })
```

---

## 5. Deployment

- **Runtime:** Cloudflare Workers (global edge, V8 isolates).
- **Domain:** `mcp.novada.com` via Cloudflare DNS + Workers Route.
- **Storage:** Cloudflare KV namespace `NOVADA_MCP_QUOTA`.
- **Telemetry:** Cloudflare Analytics Engine (request count, latency, error rate per tool).
- **CI:** GitHub Actions → `wrangler deploy` on push to `main`. (planned)

---

## 6. Failure modes

| Condition                       | Status | Response                                        |
|---------------------------------|--------|-------------------------------------------------|
| Missing / malformed token       | 401    | `{ "error": "invalid_token" }`                  |
| Quota exceeded                  | 429    | `Retry-After: <epoch seconds of next month>`    |
| Tool error (upstream 5xx etc.)  | 200    | JSON-RPC error wrapped in MCP response          |
| CF Worker CPU limit (50 ms)     | 5xx    | Logged + alert; client must retry               |
| Unknown tool name               | 200    | JSON-RPC `MethodNotFound` (-32601)              |
| Malformed JSON-RPC              | 400    | `{ "error": "invalid_request" }`                |

---

## 7. Roadmap — v0.2 and beyond

- **sub2api billing integration** — replace stub token validator with real subscription lookup; paid tiers unlock higher quotas + premium proxy pools.
- **OAuth 2.1 + Dynamic Client Registration (DCR)** — required by Claude Desktop "Custom Connectors" UI. Issue access tokens scoped per workspace; refresh tokens; PKCE.
- **Per-tool quotas** — heavy tools (`browser`, `research`) cost more "units" than `search`.
- **Regional pinning** — `mcp.us.novada.com`, `mcp.eu.novada.com`, `mcp.cn.novada.com` for compliance.
- **Tool gating** — workspace admins disable specific tools (e.g. block `browser` in enterprise plan).

---

## 8. Why this design

- **Stateless Worker** keeps cold start < 10 ms; horizontally scales for free.
- **KV for quota** — eventually consistent is fine for monthly counters; replaces a heavier D1/SQL choice.
- **Single endpoint** matches MCP spec and avoids per-tool route explosion.
- **Reuse tool handlers** from `novada-mcp` npm package — single source of truth for tool schemas + business logic; the Worker is a thin transport adapter.
