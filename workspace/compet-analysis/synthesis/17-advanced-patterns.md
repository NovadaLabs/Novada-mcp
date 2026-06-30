# Advanced MCP Server Patterns — Research Synthesis

**Date:** 2026-06-24
**Sources:** MCP spec 2025-06-18 / 2025-11-25, Bright Data, Auth0, kapa.ai, GitHub issues
**Scope:** Streaming, progress, cancellation, Streamable HTTP, hosted MCP, pagination, parallelism

---

## 1. Does MCP Support Streaming Responses?

**Yes — via Streamable HTTP transport with on-demand SSE upgrade.**

The current MCP spec (2025-06-18, latest) replaced the old HTTP+SSE dual-endpoint model with **Streamable HTTP**:

- Single endpoint (conventionally `/mcp`)
- Client sends `POST` with `Accept: application/json, text/event-stream`
- Server can respond in two ways:
  - `Content-Type: application/json` → single JSON-RPC response (fast, stateless)
  - `Content-Type: text/event-stream` → upgrades to SSE stream for long-running ops
- Server MAY send intermediate `notifications/progress` or other JSON-RPC requests on the stream before sending the final response
- After the final response, the server SHOULD close the SSE stream

**Key difference from old HTTP+SSE:**
- Old: required two persistent endpoints (`/sse` for listening + `/messages` for posting). Long-lived connection, hard to put behind load balancers.
- New: stateless by default, streams only when the specific request needs it. Works with standard AWS ALB, Cloudflare, nginx — no sticky session required.

**For novada_extract specifically:** A long-running extraction could stream progress notifications back to the client while the final content arrives at end. This is protocol-native — no custom hacking needed.

**Stream resumability:** The spec supports `Last-Event-ID` header on reconnect. Server MAY attach `id` fields to SSE events and replay missed events on reconnect. Recommended for extractions that can take 10–30s.

---

## 2. Progress Notifications

**Fully specified in MCP spec (utilities/progress). Opt-in per request.**

Protocol flow:
```
// Client request includes progressToken in _meta
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "novada_extract",
    "arguments": { "url": "..." },
    "_meta": { "progressToken": "extract-job-42" }
  }
}

// Server emits zero or more progress notifications (no id, not a response)
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "extract-job-42",
    "progress": 30,
    "total": 100,
    "message": "Rendered page, extracting content..."
  }
}

// Then eventually the final tools/call response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "content": [...], "isError": false }
}
```

**Rules:**
- `progressToken` MUST be unique across all active requests
- `progress` value MUST increase monotonically (even if total unknown)
- `total` is optional (can be omitted when duration is unknown)
- `message` SHOULD be human-readable
- Both parties SHOULD implement rate limiting to prevent flooding
- Progress MUST stop after terminal status (completed / failed / cancelled)
- Clients that don't include `progressToken` in `_meta` receive no notifications — backward compatible

**What this means for novada-mcp:**
- `novada_extract` with `render="render"` or `render="browser"` can emit: "Fetching page" → "Rendering JS" → "Extracting content" → done
- `novada_research` (multi-source) can emit per-source progress: "Searching" → "Extracting source 1/5" → etc.
- `novada_crawl` can emit per-page progress
- Client support is patchy — Claude Desktop does not yet surface progress UI; Cursor does partially. Design as enhancement, not dependency.

---

## 3. Cancellation of Long-Running Operations

**Fully specified. Uses `notifications/cancelled` message.**

```
// Client sends cancellation notification (not a request, no id)
{
  "jsonrpc": "2.0",
  "method": "notifications/cancelled",
  "params": {
    "requestId": "123",          // the id of the original tools/call
    "reason": "User cancelled"   // optional, for logging
  }
}
```

**Rules:**
- Server SHOULD stop processing and free resources upon receiving this
- Server SHOULD NOT send a response for the cancelled request
- If processing already completed, server MAY ignore the notification
- `initialize` request MUST NOT be cancelled
- Network disconnection alone SHOULD NOT be treated as cancellation — client must send explicit `CancelledNotification`
- Sender SHOULD ignore any response that arrives after sending cancellation

**Implementation pattern for novada-mcp:**
```
// In tools/call handler
const abortController = new AbortController()
activeRequests.set(requestId, abortController)

try {
  const result = await novadaExtract(url, { signal: abortController.signal })
  return result
} catch (err) {
  if (err.name === 'AbortError') return  // silently drop, already cancelled
  throw err
} finally {
  activeRequests.delete(requestId)
}

// In notifications/cancelled handler
const ctrl = activeRequests.get(params.requestId)
if (ctrl) ctrl.abort()
```

This is high value for `novada_crawl` (multi-page) and `novada_research` (multi-source searches).

---

## 4. Streamable HTTP Transport — Full Picture

### How it works (spec 2025-06-18)

**Single endpoint** (e.g., `https://mcp.novada.com/mcp`):

| HTTP Method | Use |
|-------------|-----|
| `POST` | Client sends JSON-RPC request/notification/response |
| `GET` | Client opens server-push SSE stream (server-initiated messages) |

**Session management:**
- Server assigns `Mcp-Session-Id` header in `InitializeResult` response
- Client MUST include this header on all subsequent requests
- If session expired: server returns `404` → client must reinitialize
- Session ID SHOULD be a JWT (not a plain UUID) — embeds user identity for validation
- Format: visible ASCII only (0x21–0x7E)

**Security requirements:**
- Server MUST validate `Origin` header (prevent DNS rebinding)
- Server SHOULD bind to localhost only for local servers
- All endpoints MUST be HTTPS for remote servers
- Access tokens MUST be in `Authorization: Bearer` header (NEVER in query string)

**Why better than old SSE:**
- No long-lived persistent connection — plays well with stateless infra
- Standard `Authorization: Bearer` on every POST — security middleware works normally
- Load-balancer friendly: any ALB/nginx/Cloudflare works without sticky sessions
- CORS with standard policies (no custom hacks)

---

## 5. Can We Run a Hosted MCP Server at mcp.novada.com?

**Yes. This is the standard remote MCP deployment pattern.**

### What's needed

**Transport:** Streamable HTTP (POST + optional GET SSE at single `/mcp` endpoint)

**Auth (OAuth 2.1 — required by spec for remote servers):**
- Server acts as OAuth 2.1 Resource Server
- Expose `/.well-known/oauth-protected-resource` (RFC9728) — lists scopes and trusted auth servers
- Expose `/.well-known/oauth-authorization-server` (RFC8414) — auth server metadata
- Issue `Mcp-Session-Id` as JWT embedding user identity
- Validate `Authorization: Bearer <token>` on every request
- Validate token audience — token MUST be specifically issued for `mcp.novada.com`

**Discovery (for zero-config client onboarding):**
```
GET https://mcp.novada.com/.well-known/oauth-protected-resource
→ { resource: "https://mcp.novada.com/mcp", scopes_supported: [...], authorization_servers: [...] }
```

**Rate limiting:**
- Per-user rate limiting via session JWT claims
- Tool-level limits (e.g., `novada_extract` = 100/hour free tier)

**Infrastructure:**
- Node.js/Express or similar — persistent process (NOT serverless/Vercel — cold starts break MCP streaming)
- Render.com or Railway for persistent HTTP server (confirmed better than Vercel for MCP — see feedback_render_vs_vercel_mcp.md)
- Redis for active session state + progress token tracking
- Single `/mcp` endpoint, no split routing

---

## 6. Security Implications of Hosted MCP

### Critical threats

| Threat | Mitigation |
|--------|------------|
| DNS Rebinding | Validate `Origin` header on every request |
| Token theft | JWT session IDs; short-lived tokens; HTTPS only |
| Confused deputy | Validate token audience claim == `mcp.novada.com` |
| Token passthrough | NEVER forward user access tokens to downstream APIs |
| Prompt injection via tool output | Sanitize all tool outputs before returning to LLM |
| Over-privileged tools | Scope tokens per tool; zero-trust scope model |
| Credential leakage | NEVER put tokens in URLs/query strings; only `Authorization: Bearer` |

### Auth0 security checklist (from auth0.com/blog/mcp-streamable-http/)
1. Check `Origin` header on all connections
2. Use JWT (not random UUID) as `Mcp-Session-Id`
3. Bind user ID in access token to user ID in session JWT — mismatch = reject
4. Enforce `Authorization: Bearer` header on every POST (not just initial handshake)
5. Set short token TTLs; revoke sessions with `404` response
6. Return `400 Bad Request` if client omits `Mcp-Session-Id` after initialization

---

## 7. Best Architecture for mcp.novada.com at Scale

### Deployment pattern

```
[Client: Claude Desktop / Cursor / custom]
        |
        | HTTPS POST/GET with Mcp-Session-Id + Bearer token
        v
[Cloudflare / CDN — TLS termination, DDoS protection]
        |
        v
[Load Balancer — standard HTTP, no sticky sessions needed]
        |
        v
[MCP Server Pool — Node.js, stateless per-request]
        |         \
        |          [Redis — session state, progress tokens, rate limits]
        |
        v
[Novada API — extract, search, crawl, etc.]
```

**Key design decisions:**
- Stateless server instances: session state in Redis (not in-process)
- Stream responses: SSE upgrade only when `progressToken` present in request (opt-in streaming)
- Horizontal scaling: no sticky sessions, any instance handles any request
- Session JWT: signed with server secret, carries `userId`, `tier`, `scopes`, `exp`
- Graceful cancellation: AbortController map in Redis (or per-instance if single-node)

### Tool annotations (spec 2025-06-18)

MCP now supports `annotations` on tools to declare behavior:
```json
{
  "name": "novada_extract",
  "annotations": {
    "readOnlyHint": true,
    "idempotentHint": false,
    "openWorldHint": true
  }
}
```
- `readOnlyHint: true` — tells clients this tool doesn't modify external state
- `idempotentHint` — whether repeated calls have same effect
- `openWorldHint` — whether tool accesses external internet (yes for all novada tools)

### outputSchema (spec 2025-06-18)

Tools can now declare `outputSchema` (JSON Schema for the result `structuredContent`). Enables:
- Type-safe client consumption
- LLM understands structured fields vs. raw markdown text
- Better developer experience

High priority for `novada_scrape` (already returns structured JSON) and `novada_search`.

---

## 8. Pagination for Large Results

**MCP uses opaque cursor-based pagination — built into the protocol for list operations.**

```
// First page (no cursor)
{ "method": "resources/list", "params": {} }
→ { "resources": [...], "nextCursor": "eyJwYWdlIjoyf..." }

// Next page
{ "method": "resources/list", "params": { "cursor": "eyJwYWdlIjoyf..." } }
→ { "resources": [...], "nextCursor": null }  // null = last page
```

**Applies to:** `tools/list`, `resources/list`, `prompts/list`, `resources/templates/list`

**Watch out:** OpenAI Codex (as of June 2026) does NOT follow `tools/list` pagination — only reads first page. This means if novada-mcp exposes 50+ tools, Codex users miss tools on page 2+. Current tool count in novada-mcp is ~20, not an immediate issue but worth tracking.

**For novada_crawl results:** Pagination is NOT built into `tools/call` results — only list operations. For large crawl results, options are:
1. Return paginated results as a Resource (URI-based) and let client `resources/read` pages
2. Use a cursor param in the tool itself (custom, not protocol-native)
3. Break results into `resource_link` content items pointing to individual pages

---

## 9. Parallel Tool Execution

**MCP protocol does NOT prevent parallel tool calls — it's a client decision.**

- Claude, Cursor, and Google ADK all support parallel tool call dispatch
- Multiple `tools/call` requests can be in-flight simultaneously (different `id` values)
- Server MUST handle concurrent requests safely (connection pool, no shared mutable state)
- Streamable HTTP makes this clean: each POST is independent

**For novada-mcp at scale:**
- `novada_research` already fans out internally — but this is in-tool, not protocol-level
- Agents calling multiple novada tools in parallel (e.g., `novada_extract` × 5 URLs) hits Novada API concurrently — ensure API rate limits account for this
- Consider surfacing a `novada_batch_extract` tool that explicitly parallelizes N URLs server-side to reduce round trips

---

## 10. Synthesis — What Should novada-mcp Adopt?

### Priority matrix

| Pattern | Effort | Value | Recommendation |
|---------|--------|-------|----------------|
| Streamable HTTP transport | Low | Critical | **Do now** — already needed for hosted MCP |
| Progress notifications for long ops | Medium | High | **Do now** — novada_extract/crawl/research |
| Cancellation support | Medium | High | **Do now** — novada_crawl especially |
| Hosted mcp.novada.com | High | Critical for KR-5 | **Plan for 0.9.0** |
| outputSchema on novada_scrape | Low | Medium | **Do in 0.8.0** |
| Tool annotations (readOnly, etc.) | Low | Medium | **Do in 0.8.0** |
| Resumable streams (Last-Event-ID) | High | Low (nice-to-have) | **Defer** |
| JWT session IDs | Medium | High (security) | **Required for hosted** |
| Pagination for tools/list | Low | Low (only >50 tools) | **Defer** |
| Batch extract tool | Low | Medium | **0.8.0 candidate** |

### What streaming would look like for novada_extract

```
// Client call with progressToken
tools/call novada_extract {
  url: "https://example.com",
  render: "render",
  _meta: { progressToken: "ext-001" }
}

// Server SSE stream:
event: message
data: {"method":"notifications/progress","params":{"progressToken":"ext-001","progress":10,"total":100,"message":"Fetching page..."}}

event: message
data: {"method":"notifications/progress","params":{"progressToken":"ext-001","progress":40,"total":100,"message":"Rendering JavaScript..."}}

event: message
data: {"method":"notifications/progress","params":{"progressToken":"ext-001","progress":80,"total":100,"message":"Extracting content..."}}

event: message
data: {"id":1,"result":{"content":[{"type":"text","text":"...extracted markdown..."}],"isError":false}}
```

This is additive and backward-compatible — clients without `progressToken` support get the same final result, just no intermediate notifications.

### Hosted server deployment checklist (mcp.novada.com)

**Infrastructure:**
- [ ] Persistent Node.js process (Render.com, Railway, or dedicated VM — NOT Vercel/serverless)
- [ ] Redis for session state and rate limits
- [ ] HTTPS with valid TLS cert on `mcp.novada.com`
- [ ] Cloudflare in front for DDoS + TLS termination

**Protocol:**
- [ ] Single `/mcp` endpoint accepting `POST` and `GET`
- [ ] `Accept: application/json, text/event-stream` handling
- [ ] SSE upgrade when `progressToken` present in request
- [ ] Session management with `Mcp-Session-Id` header
- [ ] Stream resumability via `Last-Event-ID` (optional but recommended)

**Auth (OAuth 2.1):**
- [ ] `/.well-known/oauth-protected-resource` endpoint
- [ ] `/.well-known/oauth-authorization-server` endpoint
- [ ] JWT-based session IDs (not random UUIDs)
- [ ] `Authorization: Bearer` validation on every request
- [ ] Token audience binding to `https://mcp.novada.com`
- [ ] Short token TTLs + `404` on expired session

**Security:**
- [ ] `Origin` header validation (DNS rebinding prevention)
- [ ] Input validation on all tool params (`.regex()` / allowlist per MCP security rule)
- [ ] Rate limiting per user tier
- [ ] Tool output sanitization before returning to LLM
- [ ] No token passthrough to downstream Novada API

**Ops:**
- [ ] Tool `annotations` declared (readOnly, idempotent, openWorld)
- [ ] `outputSchema` on structured-output tools (novada_scrape, novada_search)
- [ ] Cancellation support for crawl/research/extract
- [ ] Graceful AbortController cleanup on session termination

---

## Sources

1. MCP spec 2025-06-18 — tools: https://modelcontextprotocol.io/docs/concepts/tools
2. MCP spec 2025-06-18 — resources: https://modelcontextprotocol.io/docs/concepts/resources
3. MCP spec 2025-06-18 — transports: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
4. MCP spec 2025-06-18 — authorization: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
5. MCP spec 2025-11-25 — progress: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress
6. MCP spec 2025-03-26 — cancellation: https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/cancellation
7. Bright Data — SSE vs Streamable HTTP: https://brightdata.com/blog/ai/sse-vs-streamable-http
8. Auth0 — MCP Streamable HTTP security: https://auth0.com/blog/mcp-streamable-http/
9. kapa.ai — Remote MCP hosting: https://www.kapa.ai/blog/remote-mcp-servers-hosting-authentication-best-practices
10. GitHub — Codex pagination bug: https://github.com/openai/codex/issues/28858
11. MCP spec — pagination: https://modelcontextprotocol.io/specification/2025-03-26/server/utilities/pagination
12. Google ADK — parallel tool calls: https://github.com/google/adk-python/discussions/2490
