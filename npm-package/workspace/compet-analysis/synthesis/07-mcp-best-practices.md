# MCP Server Best Practices — Synthesis for novada-mcp

**Date:** 2026-06-24
**Sources:** modelcontextprotocol.io/specification/2025-06-18, MCP Tools/Resources/Sampling/Prompts/Architecture docs, MCPcat production guide (Kashish Hora), Chrome DevTools MCP design principles, GitHub MCP Server README, Geoffrey Huntley context-window analysis (Aug 2025), MCP spec 2025-06-18 changelog

---

## 1. What the Official MCP Docs Say About Tool Description Quality

From the spec and architecture overview (2025-06-18):

- `name`: unique identifier within server namespace — treated as a **primary key for execution**, not a label. Must be stable; renaming is a breaking change.
- `title`: optional human-readable display name. Separate from `name` — clients show `title`, agents match on `name`.
- `description`: "Human-readable description of functionality." The spec uses it explicitly for LLM routing — it is the text the model reads when deciding which tool to call. **Quality here directly determines call accuracy.**
- `inputSchema`: JSON Schema. Per-property `description` fields are **part of the tool contract**, not documentation. Agents read them to understand how to fill parameters.
- `outputSchema` (new in 2025-06-18): optional JSON Schema for structured output. Servers **MUST** conform; clients **SHOULD** validate.
- `annotations`: `dangerous: true`, `requiresConfirmation: true` — signal to hosts to prompt the user.

Key quote from architecture docs:
> `description`: Detailed explanation of what the tool does **and when to use it**

"When to use it" is explicit in the spec. A description that explains only what a tool does, but not when vs. alternative tools, is incomplete.

---

## 2. What Makes a Tool Description Agent-Friendly vs. Confusing

### Agent-friendly

- **Starts with the action verb**, not the noun: "Search the web and get clean results" not "Web Search Tool"
- **States the primary use case in sentence 1**: agent makes selection in the first ~50 chars
- **Explicit "Best for" / "Not for" guidance**: tells agent when to pick this tool over siblings
- **Names competing tools explicitly when relevant**: "For structured platform data use novada_scrape; use this for general URLs"
- **States format/shape of output**: agent needs to know what to expect ("Returns markdown", "Returns structured JSON object")
- **Includes escalation path for failures**: "If this returns empty, retry with render='render'"
- **Per-parameter descriptions with examples**: `"e.g. '/docs/api/.*'"`, `"ISO 2-letter code e.g. 'us', 'gb'"`

### Confusing (anti-patterns)

- Generic name that doesn't disambiguate from siblings: `proxy`, `proxy_residential`, `proxy_isp` all look the same without descriptions
- Long capability list with no decision guidance — agent picks arbitrarily
- Missing "not for" cases — agent wastes a call discovering this
- Technical error codes in descriptions — agents can't act on `-32602`
- Parameter descriptions that just restate the name: `url: "The URL"` — useless

### Chrome DevTools MCP design principles (ground truth from production):

> "Token-Optimized: Return semantic summaries. 'LCP was 3.2s' is better than 50k lines of JSON."
> "Self-Healing Errors: Return actionable errors that include context and potential fixes."
> "Human-Agent Collaboration: Output must be readable by machines (structured) AND humans (summaries)."
> "Progressive Complexity: Tools should be simple by default but offer advanced optional arguments for power users."

---

## 3. Best Practices for Error Responses

### Two error channels (spec-mandated)

1. **Protocol errors** (`JSON-RPC error`): `code` + `message`. For unknown tool, invalid args, server crash. These are caught by the MCP client layer, not the LLM.
2. **Tool execution errors** (`isError: true` in result): The tool returns normally but signals failure in content. **This is what the LLM sees.** Use for: API failures, invalid input data, business logic errors.

### Format checklist for `isError: true` responses

```
Failed to [action]: [reason in plain English]

agent_instruction: [what to do next — specific, actionable]
suggested_fix: [concrete fix e.g. "retry with render='render'", "check API key"]
```

Key decisions:
- **Never expose raw HTTP status codes or stack traces** in the content field. The LLM cannot act on them.
- **Always include `agent_instruction`** on errors the agent can recover from. Absence = agent halts.
- **Distinguish recoverable vs. terminal**: recoverable → include retry suggestion; terminal (auth failure, quota) → include human-action note.
- **Rate limit errors must carry wait guidance** or the agent will immediately retry and worsen the situation.
- **Validation errors must name the invalid field and show the accepted format**.

### Error field naming convention (from novada-mcp current practice — keep consistent):
```
agent_instruction: status:failed | suggested_fix: <action> | ...
```

---

## 4. Recommended Parameter Naming Conventions

From spec examples and top MCP servers:

| Convention | Rule |
|---|---|
| `snake_case` | All parameter names — matches JSON Schema community standard, readable in prompts |
| Avoid abbreviations | `max_chars` not `mc`, `num_results` not `nr` |
| Boolean params | Positive form: `include_archived`, not `exclude_active` |
| Enum params | Document all values in description, include default: `"'bfs' (default): breadth-first"` |
| Optional params | Never ask about optional params if the description gives enough context to proceed |
| Mutually exclusive params | State explicitly: `"Cannot combine with addTeams/removeTeams"` |
| URL params | Accept both `url` (single) and `urls` (array) when batching makes sense — document array cap |
| Country codes | Always say "ISO 2-letter" and give examples: `'us', 'gb'` |

---

## 5. Many+Small vs. Few+Large Tools

This is the most debated question. Evidence from multiple sources:

### The context window argument (Geoffrey Huntley, Aug 2025):
> "Every MCP server and tool consumes precious tokens from your LLM's limited context window — adding more tools means less space for actual code and reasoning."
> "Multiple similar tools create non-deterministic behavior where the LLM struggles to choose between overlapping capabilities."

### The workflow argument (MCPcat, Kashish Hora, 2025):
> "Design each tool to map directly to what users actually want to do. Instead of exposing individual API operations, create tools that handle entire workflows."
> Bad: `github_create_issue` + `github_add_labels` + `github_assign_user` (3 calls, 3 permission prompts)
> Good: `create_github_issue` with `labels` and `assignees` params (1 call, workflow-complete)

### Synthesis — the right model:

**Use case-scoped tools, not API-endpoint tools.** A tool should correspond to a user intention, not a backend endpoint.

Concrete rules:
- If two operations are **always called together**, merge them into one tool with optional params
- If two operations are **sometimes called together**, keep them separate but make each idempotent
- Split tools only when they have **genuinely different audiences** (e.g. read vs. write), **different risk profiles** (dangerous=true), or **very different performance characteristics**
- **20+ tools**: add namespacing (`files/read`, `database/query`) or dynamic tool management (register only tools relevant to current context)
- **30+ tools**: split into multiple MCP servers by domain or permission boundary

For novada-mcp specifically (currently ~35 tools): the proxy variants (`proxy_residential`, `proxy_isp`, `proxy_datacenter`, `proxy_mobile`, `proxy_static`, `proxy_dedicated`) are justified because they have genuinely different routing semantics. However, the decision guidance in their descriptions must be crisp enough that the agent never has to try multiple to find the right one.

---

## 6. Streaming: Does MCP Support It? Should novada-mcp Use It?

### What MCP spec says (2025-06-18):

- **Streamable HTTP transport** is the current standard (SSE is officially deprecated)
- Streamable HTTP handles both streaming and request/response patterns in one transport
- Stdio transport: no streaming, local only
- `tasks` primitive (experimental in 2025-06-18): durable execution wrappers for long-running ops with deferred result retrieval

### Should novada-mcp use streaming?

**For the core tool responses: no.** The MCP content model (`text`, `image`, `resource_link`) is return-on-completion. Streaming partial tool results is not in the current spec at the tool invocation level.

**For transport: Streamable HTTP for the remote server.** Already the right choice for a hosted MCP server. Stdio is local-only; SSE is deprecated.

**For long operations (research, crawl)**: The async scraper pattern novada-mcp already uses (submit → status poll → result) is the correct MCP-compatible pattern. The experimental `tasks` primitive formalizes exactly this. Worth watching for v1 when it stabilizes.

**Practical recommendation**: Keep current async pattern. Do not attempt tool-level streaming output — no MCP client handles it reliably today.

---

## 7. Resource Templates vs. Tools: When to Use Each

| Primitive | Use when | Signals to LLM |
|---|---|---|
| **Tool** | Action with side effects, API call, state change, computation | "Will execute something, may cost money/have consequences" |
| **Resource** | Read-only data access, no side effects, cacheable | "Safe to read freely, no permission prompt needed" |
| **Resource template** | Same as resource but parameterized by URI | "Discover data via URL pattern without separate tool call" |
| **Prompt** | Reusable multi-turn interaction pattern, workflow template | "Prepared sequence of messages for a specific task" |

### Decision rule for novada-mcp:

- `novada_extract(url)` → **Tool** (makes HTTP request, costs API credits)
- `novada_health` → **Tool** (tests live endpoints) BUT could also be a **Resource** for cached status
- Documentation pages, static config → **Resource** (read-only, cacheable)
- "Debug error in scrape result" workflow → **Prompt** (underused currently)

The official MCP docs note resources are underused. Adding a few static resources (e.g., the scraper platforms list as a `novada://scraper-platforms` resource) reduces tool call overhead for discovery.

---

## 8. How Should Tool X Call Tool Y Within an MCP Server?

The spec's answer via `sampling` primitive: a server can call `sampling/createMessage` to request an LLM completion from the client. This is how a server "thinks" without bundling an LLM SDK.

For tool-to-tool calls within the same server process:
- **Direct function call** (TypeScript/Python): call the underlying function directly, not via MCP protocol. The MCP layer is for client-server communication, not internal composition.
- The `novadaResearch` tool calling `novadaExtract` directly is correct — already done in novada-mcp.
- Do NOT re-invoke via JSON-RPC internally — creates unnecessary overhead and loses type safety.
- **Exception**: if a tool needs to call a tool on a *different* MCP server, that requires the `sampling` primitive or a separate HTTP client.

### Surfacing internal composition to the LLM:

When a tool internally orchestrates multiple operations, document this in the description:
> "One call → 3-10 parallel searches → dedup → extract full content from top 5 sources → synthesized cited report. Replaces 5-10 manual search+extract calls."

This prevents the agent from manually calling the sub-tools when the orchestrating tool exists.

---

## 9. Security Checklist (Spec MUST requirements)

From MCP spec 2025-06-18:

- [ ] **Validate all tool inputs** — every string param entering a URL, regex, file path, or system call must be sanitized
- [ ] **Implement proper access controls** — per the global CLAUDE.md rule: `z.string()` → `path.join()`/`RegExp()`/`fs.*` MUST have `.regex()` or allowlist-sanitize first
- [ ] **Rate limit tool invocations** — prevent abuse; return descriptive error with retry-after hint
- [ ] **Sanitize tool outputs** — don't leak internal error messages, stack traces, or credential fragments
- [ ] **Annotations are untrusted** — spec explicitly: "descriptions of tool behavior such as annotations should be considered untrusted, unless obtained from a trusted server"
- [ ] **Tool Safety**: hosts must get user consent before invoking — make destructive tools obvious via `dangerous: true` annotation
- [ ] **Sensitive params as password type**: PAT, API keys in config use `"password": true` in elicitation

---

## 10. Transport & Deployment Patterns

| Pattern | Use case | Notes |
|---|---|---|
| **Stdio** | Local CLI, dev tools, no network | Cannot be hosted remotely |
| **Streamable HTTP** | Hosted/remote servers (production) | Standard as of 2025-06-18. Supports OAuth, API key headers, load balancers |
| **SSE** | Deprecated | Official MCP SDK handles SSE clients via fallback in Streamable HTTP — no need to maintain two |

For hosted Streamable HTTP:
- Render.com persistent Node.js > Vercel serverless (per project memory: cold starts break MCP streaming)
- OAuth 2.1 for multi-tenant; API key header for B2B/developer use

---

## 11. novada-mcp Specific Checklist

Derived from all the above, applied to the current codebase (~35 tools, Streamable HTTP, npm package):

### Tool Description Quality
- [ ] Every description opens with a **"Best for" / "Not for"** contrast against the most likely alternative
- [ ] Every description states **output shape** (markdown, JSON, structured table, etc.)
- [ ] Proxy tool descriptions include **when-to-escalate** guidance (datacenter → ISP → residential)
- [ ] `novada_research` description explicitly calls out it replaces 5-10 manual calls (already partially done)
- [ ] `novada_scraper_submit/status/result` descriptions form a clear 3-step workflow with next-step hints
- [ ] `novada_discover` description explains it is the tool discovery entry point

### Error Response Quality
- [ ] All `isError: true` results include `agent_instruction` with a specific next action
- [ ] Auth errors (401/403) include "Check NOVADA_API_KEY in environment" instruction
- [ ] Rate limit errors include retry guidance
- [ ] Validation errors name the invalid param and show accepted format/example
- [ ] No raw HTTP codes or stack traces in error content

### Parameter Design
- [ ] All enum params list accepted values with default marked
- [ ] Mutually exclusive params documented inline
- [ ] URL params support both single and array where batching is useful (already done for `extract`)
- [ ] Boolean params use positive form

### Tool Granularity
- [ ] Proxy sub-tools are justified by genuinely different routing — maintain but ensure descriptions make selection unambiguous
- [ ] Async 3-step pattern (submit→status→result) is correct for long-running scrapes — document workflow clearly
- [ ] `novada_account_summary` as a single-call dashboard is the right merge of wallet+plans+logs

### Streaming / Transport
- [ ] Streamable HTTP is current transport — correct
- [ ] No tool-level streaming attempted — correct
- [ ] Async task pattern for long ops is spec-aligned

### Security
- [ ] All string params entering regex/URL/path have validation (audit per CLAUDE.md rule)
- [ ] No telemetry/analytics exfiltration (audit per CLAUDE.md 3rd-party skill rule)

### Monitoring (production pattern from MCPcat)
- [ ] Track tool call frequency and error rates
- [ ] Track user intentions (what workflow pattern triggered the call) — more valuable than raw metrics
- [ ] Health check tools (`novada_health`, `novada_health_all`) are self-documenting — correct

---

## 12. Priority Improvements for novada-mcp

Ranked by agent-experience impact:

1. **"Best for / Not for" in all 35 tool descriptions** — highest leverage; directly reduces wrong tool selection (many descriptions already have this, audit for consistency)
2. **`agent_instruction` on all error paths** — prevents agent stalls; grep for `isError: true` without `agent_instruction`
3. **`novada_discover` tool** — already exists; ensure it's the recommended first call when starting a new task
4. **Escalation path documentation** for proxy tools: `datacenter → ISP → residential` ladder must be in each tool's description
5. **`outputSchema`** for structured tools (new in spec 2025-06-18) — add to `novada_scrape`, `novada_extract` with `format: 'json'` for better downstream validation
6. **Context window discipline**: 35 tools is above the "confusion threshold" identified by Huntley. The `novada_discover` tool + clear categorization is the mitigation. Consider `listChanged` capability to let hosts dynamically enable/disable tool subsets.

---

## Sources

1. https://modelcontextprotocol.io/docs/concepts/tools (spec 2025-06-18)
2. https://modelcontextprotocol.io/docs/concepts/sampling
3. https://modelcontextprotocol.io/docs/concepts/resources
4. https://modelcontextprotocol.io/docs/concepts/prompts
5. https://modelcontextprotocol.io/docs/concepts/architecture
6. https://modelcontextprotocol.io/specification/2025-06-18
7. https://mcpcat.io/blog/mcp-server-best-practices (Kashish Hora, MCPcat co-founder, 2025-07-10)
8. https://steipete.me/posts/2025/essential-reading-august-2025 (Geoffrey Huntley analysis on MCP server proliferation)
9. https://raw.githubusercontent.com/ChromeDevTools/chrome-devtools-mcp/main/docs/design-principles.md (Google Chrome DevTools MCP team)
10. https://raw.githubusercontent.com/github/github-mcp-server/main/README.md (GitHub official MCP server patterns)
