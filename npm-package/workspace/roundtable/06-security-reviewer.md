# Security Reviewer -- Roundtable Response

## 1. Most Critical Action RIGHT NOW

**Rotate the leaked credentials immediately.** The WSS pair (`novada529MUW_2Q8WuZ` / `Dz0vkMW4Wkil`) was exposed in error messages before `sanitizeBrowserError` was added. If those credentials were logged by any consuming agent, they exist in conversation history, log files, or memory stores that we do not control. Sanitizing output prevents future leaks but does not revoke already-leaked secrets. This is a 10-minute dashboard task with infinite downside if skipped.

## 2. Security Debt for Next Week

- **Input validation audit.** Proxy tools have solid `.regex()` on Zod params, but no audit has been done since v0.7.x. Every `z.string()` that flows into `path.join()`, `RegExp()`, `fetch()`, or shell commands needs verification. One unsanitized param = SSRF or path traversal via agent-as-attacker.
- **Rate limiting.** Zero rate limiting on MCP tool calls means a rogue agent can burn API quota or trigger upstream bans. Add per-tool call throttling (e.g., 60 calls/min for proxy tools, 30/min for browser).
- **Credential surface audit.** `proxy_account_create` accepts and transmits passwords. Verify the confirm-gate cannot be bypassed by a crafted tool call. Test that `proxy_account_list` truly strips passwords in all response paths, not just the happy path.

## 3. Acceptable vs Unacceptable Risk

**Acceptable:** API key visible as `****XXXX` in setup output (user needs partial confirmation). Static rate limits that may be too generous initially. Trusting Novada upstream API with credentials over HTTPS.

**Unacceptable:** Any credential appearing in plaintext in tool output (agent conversations are logged, shared, cached). Any `z.string()` reaching filesystem or network calls without `.regex()` validation. No rotation after a confirmed leak. Browser sessions sharing a module-level `Map` without tenant isolation in multi-user deployments.
