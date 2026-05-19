# Agent-4: Browser Automation Agent Feedback
role: browser automation agent
task: interactive web navigation and extraction
tools_used: [novada_browser (list_sessions, navigate, aria_snapshot, screenshot, click, close_session)]

## First Impression

The tool description is well-structured and immediately usable. The discriminated union format for actions (`{action: "navigate", url: "..."}`) is unambiguous — I had zero confusion about how to construct a call. The "Best for / Not for" guidance in the description helps route correctly without trial and error. The constraint about `list_sessions` and `close_session` needing to be solo calls is clearly called out, which prevented me from making an invalid multi-action call.

One friction point: ToolSearch was required before I could invoke anything, since these are deferred tools. For a cold-start agent with no prior session context, that is an extra round-trip step with no agent_instruction pointing me toward it. A hint in the MCP manifest or a discoverable entry tool (like `novada_discover`) that loads lazily would reduce that friction.

## Session Management Clarity

Session ID concept is crystal clear. The description gives concrete numbers: ~8s cold vs ~1.5s warm, 10 min inactivity expiry. That is exactly the level of detail an agent needs to decide whether to reuse or discard a session. The `list_sessions` output confirmed zero active sessions and the agent hints explained the cost tradeoff again inline — good reinforcement.

The confirmation in every response (`session_active: true`, `session_id: "agent-4-hn-test"`) is excellent — I always knew the session was alive without needing to call `list_sessions` again.

One gap: when `list_sessions` returns `count: 0`, there is no guidance on what session_id format to use when creating a new session (e.g., is a UUID expected? Any string? Length limits?). The schema shows `pattern: ^[a-zA-Z0-9_\-]+$` and `maxLength: 64`, but that is schema-level, not surfaced as prose in the agent hints for new-session creation.

## Action Chaining

Excellent. The 20-action-per-call limit is stated upfront, and chaining navigate → aria_snapshot → screenshot in one call worked cleanly. The per-action result format (`### Action N: <type> [ok]`) makes it trivially easy to parse which step succeeded or failed in a multi-step sequence.

One weakness: when a mid-chain action fails, the response doesn't explicitly state which subsequent actions were skipped vs. attempted. In my test the entire call had 1 action so this wasn't an issue, but for a 10-step chain where action 4 fails, it would be unclear whether actions 5-10 were attempted or aborted. An explicit `skipped: [5,6,7...]` field in the summary line would resolve this.

## Error Recovery

The click-on-nonexistent-element test timed out at 30s (the full timeout budget) before returning an error. That is the most significant agent-experience pain point: a 30-second wall-clock wait to discover the element doesn't exist. A fast-fail "element not found" check before entering the polling loop would be far more agent-friendly — most agents would rather get an immediate "no such selector" error and retry than burn 30s.

The recovery hints themselves were specific and actionable:
1. Use `aria_snapshot` to see the accessibility tree and find correct selectors.
2. Use `snapshot` to inspect HTML structure.
3. Use `evaluate` with `document.querySelector('<selector>')` to test existence.

All three are immediately executable without further lookup. Good quality. However, hint #3 still doesn't suggest what to do after the querySelector call confirms null — a follow-up instruction ("then use aria_snapshot to discover available selectors") would complete the loop.

## Agent Hints Quality

Consistently excellent across all three calls. The hints section at the bottom of every response is predictable and structured — agents can reliably extract information from it. The session reuse reminder after every call is slightly redundant once a session is established, but harmless. The geo-restriction TikTok note appears in all responses even when the platform is irrelevant (HN has no geo-restriction) — this wastes context tokens. A hint that is conditionally rendered based on the platform being used would be more efficient.

The `close_session` confirmation hints ("next call with this session_id will start fresh cold") is a nice touch — prevents agents from accidentally expecting warm reuse after a close.

## Output Format

The `aria_snapshot` output is verbose but structured — the nested table/row/cell hierarchy reflects HN's table-based layout faithfully. An agent extracting link text or hrefs can do so deterministically. The screenshot is returned as a base64 data URI; since I'm a text-based agent I cannot render it, but the action still returned `[ok]` with no error, which is correct behavior. Ideally the screenshot action would also return image dimensions and a short text description (e.g., "1280x800 screenshot captured") as a machine-readable field so text agents can confirm success without needing vision.

The truncation on long aria_snapshots (`<!-- truncated -->`) is necessary for token limits but gives no indication of how much was cut or how to paginate/retrieve the rest. Agents working with long pages may act on incomplete accessibility trees.

## Top 3 Improvements for Agent Experience

1. **Fast-fail on missing selectors.** The click timeout (30s) is the single biggest UX degradation. Before entering Playwright's polling loop, a synchronous `document.querySelector(selector)` check should short-circuit with an immediate `element_not_found` error. This turns a 30s block into a <100ms failure, giving agents fast retry cycles.

2. **Aria_snapshot pagination or depth control.** Long pages produce truncated snapshots with no pagination mechanism. Add a `max_depth` or `selector` scope parameter to `aria_snapshot` (e.g., `{action: "aria_snapshot", selector: "#hnmain"}`) so agents can retrieve the relevant subtree without truncation or token waste.

3. **Conditional agent hints.** The hints block repeats platform-specific warnings (TikTok geo-restriction) and session reminders on every response regardless of context. After the first session-reuse reminder is acknowledged, suppress it. Only show TikTok warnings when the navigated URL is tiktok.com. This would reduce per-call token overhead by ~30% and keep hints signal-dense rather than boilerplate.

## Overall Score (agent-friendliness): 7/10

Strong baseline: clear discriminated union schema, consistent response structure, actionable recovery hints, and good session semantics. The 30s click timeout and truncated aria_snapshots are the two concrete blockers that drop this below 8. Fix those two and the score reaches 9.
