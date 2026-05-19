# Agent-5: Proxy Fetching Agent Feedback
role: proxy-based web fetching agent
task: fetch content through different proxy types (auto, residential, datacenter)
tools_used: [novada_proxy, novada_proxy_residential, novada_proxy_datacenter]

## First Impression

The proxy tools are credential-dispensing tools, not fetch tools — they return a proxy URL, not the fetched content. That distinction is stated in descriptions but easy to miss if you're expecting a "give me a proxy IP" UX similar to how `novada_extract` just works. As an agent, I had to take the URL output and make a separate HTTP request with it. That's fine if I have `curl`/HTTP capabilities, but it means the proxy tools are essentially configuration generators, not action tools.

The MCP tool call returned credentials immediately and clearly. Connection to the proxy server worked. The `agent_instruction` block in the response was the most useful part — it told me the escalation path (datacenter → isp → residential).

## Proxy Type Selection

Reasonably distinguishable. The tool descriptions use concrete language:

- `novada_proxy_residential`: "100M+ IP pool", "anti-bot protected pages", "geo-restricted content" — clear
- `novada_proxy_datacenter`: "fastest", "high-volume scraping", "non-anti-bot targets" — clear
- `novada_proxy` (auto): described as "when you need to route your own HTTP requests", with a `type` param — functional but slightly redundant with the specialized tools

The escalation chain `datacenter → isp → residential → mobile` was stated in `agent_instruction` but not in the tool description. An agent that reads descriptions before tool calls would not see the escalation chain until after the first call. It should be in the description.

One missing dimension: **cost**. Datacenter is cheapest, residential is most expensive. Agents making cost-aware decisions (e.g., in a budget-limited pipeline) have no signal for this.

## Credential Handling

Partially transparent, but with a critical gap. The tools return:

```
proxy_url: http://tongwu_TRDI7X-zone-residential:***@1b9b0a2b9011e022.vtv.na.novada.pro:7777
```

The `***` masking is well-intentioned (security), but the agent instruction to "read `NOVADA_PROXY_PASS` from your environment" only works if the agent has shell access. In an MCP context, `NOVADA_PROXY_PASS` is passed to the server at startup — the agent itself does not have access to environment variables. This creates an awkward gap: the tool knows the password (it uses it to authenticate), but refuses to return it to the agent. The agent is left with an incomplete URL it cannot use directly.

A better design would be to return the fully constructed URL (since the server already holds the secret), or provide a `test` endpoint where the proxy can be tested directly.

## What Worked Well

1. **Tool discovery via ToolSearch** was smooth — all three proxy tools appeared in one search.
2. **Connection to the proxy** worked — the endpoint resolved, TCP connected.
3. **Credential format was correct** — `{user}-zone-{type}:pass@host:port` is standard, and the Node.js/Python usage examples in the response were genuinely helpful.
4. **The `agent_instruction` field** was the best part of the response — it contained decision logic an agent needs: when to escalate, what pool is used, sticky session notes.
5. **Residential proxies worked** once I discovered the correct zone name (`resi`, `res`) through trial and error.

## What Was Confusing or Missing

**Critical bug: wrong zone name in generated credentials.**

The tools generated `tongwu_TRDI7X-zone-residential` and `tongwu_TRDI7X-zone-datacenter` as usernames, but the actual proxy server accepts `tongwu_TRDI7X-zone-resi` and `tongwu_TRDI7X-zone-res`. Both `zone-residential` and `zone-datacenter` returned `403 Forbidden` with body `"residential denied access"` / `"datacenter denied access"`. I had to iterate through ~20 zone name variants to find the working ones.

This is a critical agent-experience failure. An agent following the tool's own output would be blocked 100% of the time on first try.

**No datacenter access on this account.** Even after finding correct zone names (tried `dc`, `isp`, `static`, `datacenter`, `rotating`, `sdc`, etc.), no datacenter zone worked — all returned "denied access". This may be a subscription limitation, but the tool gives no indication of what proxy types are actually available on this account. The tool should either validate available zones at call time or return an `available_zones` field.

**The tool returns config, not a result.** Fetching through a proxy requires the agent to:
1. Call the tool to get the proxy URL
2. Make a separate HTTP request using that URL

This is more work than `novada_extract` which handles proxying transparently. When an agent just wants "get me this URL through a residential IP," the two-step flow is friction.

**Password in output is `***`** — unusable in downstream HTTP calls without shell env access. The tool knows the password; it should either complete the URL or offer a `test_fetch` param.

## Agent Hints Quality

The `agent_instruction` blocks were the standout feature:
- Residential: "Best for geo-restricted content. Use country param for targeting. Strongest anti-bot bypass — escalate here from isp/datacenter when blocked."
- Datacenter: "Fastest proxies. Best for high-volume, non-anti-bot targets. Escalation path: if blocked → try novada_proxy_isp → try novada_proxy_residential."

These are genuinely useful and actionable. The fallback chain instruction is exactly what an agent needs for self-healing retry logic.

The `novada_proxy` (auto) tool's hints were shorter and less detailed than the specialized tools.

## Output Format

The output mixes markdown headers, code blocks, and plain text. For agent parsing:

- The `proxy_url:` line is easy to parse (regex: `proxy_url: (.+)`)
- The Node.js/Python code snippets are human-useful but add token overhead with no agent value
- The `agent_instruction` section should be a top-level JSON field, not buried in markdown — agents that parse JSON miss it entirely

No machine-readable format option (e.g., `format=json`). All three formats (`url`, `env`, `curl`) are still markdown text blocks.

## Top 3 Improvements for Agent Experience

1. **Fix the zone name mismatch.** The tool generates `zone-residential` and `zone-datacenter` but the proxy server expects `zone-resi` and `zone-res` (or similar short forms). This is a 100% failure rate bug on first agent use. Either fix the generated username or document the actual zone names in the `agent_instruction`.

2. **Return fully usable credentials or a direct fetch option.** Either: (a) return the proxy URL with the actual password filled in (the server holds it, the security argument for masking is weak in an MCP context), or (b) add a `fetch_url` param so the tool can perform the request and return the response directly — one tool call instead of two.

3. **Add account-level capability discovery.** Include an `available_zones: ["resi", "res"]` field in the response so agents know upfront what proxy types are provisioned. An agent trying to use `novada_proxy_datacenter` when only residential is enabled should get a clear error like `"zone datacenter not provisioned on this account — available: [resi, res]"` rather than a generic `403 Forbidden`.

## Overall Score (agent-friendliness): 4/10

**Rationale:** The tools are conceptually sound and the `agent_instruction` fields are excellent. But a critical zone name bug makes the generated credentials non-functional out of the box, password masking makes the URL incomplete, and no datacenter zone works on this account without any diagnostic messaging. An agent following these tools' own instructions would fail all three fetches without debugging capability. The 4/10 reflects strong design intent undermined by execution gaps that block basic usage.
