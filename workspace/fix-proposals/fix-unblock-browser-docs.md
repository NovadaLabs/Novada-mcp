# Fix Proposals — Unblock Truncation + Browser Docs (BUG-M4 + Bonus)
Reviewed by: fix-engineer-3
Date: 2026-05-19

---

## BUG-M4: Unblock Truncation — Structured Field Missing

### Root Cause (from source)

File: `src/tools/unblock.ts`

The truncation logic is at lines 28–30:
```ts
const htmlLength = result.html.length;
const maxChars = params.max_chars ?? UNBLOCK_MAX_CHARS_DEFAULT;
const truncated = htmlLength > maxChars;
```

`truncated` and `htmlLength` are computed correctly as local variables, but the function signature is `Promise<string>` — the entire response is a single prose string. There is no structured return type. The truncation fact is surfaced only inside two prose strings:

1. Line 50 — inline in the header line:
   ```
   chars: ${htmlLength}${truncated ? ` (truncated from ${htmlLength} to ${maxChars} — pass max_chars=${Math.min(htmlLength, 500000)} to get full content)` : ""}
   ```
2. Line 60 — in an HTML comment at the bottom of the content block:
   ```
   <!-- Content truncated from ${htmlLength} to ${maxChars} characters. Pass max_chars=... -->
   ```

Both require prose parsing. An agent cannot check `response.truncated === true` or compare `response.original_chars` to decide whether to retry with a larger `max_chars`. The structured data is literally available (the variables exist) but is never emitted as a parseable line.

The test case that triggered this: Wikipedia returned 118,896 chars, truncated to 100,000. The prose header says `(truncated from 118896 to 100000)` but no field an agent can key on.

### Proposed Fix

**Step 1 — Add a structured metadata block to the response, before the HTML content.**

In `unblock.ts`, modify the `lines` array construction (starting at line 47) to add explicit structured fields on their own lines immediately under the `## Unblocked Content` header. This follows the same pattern already used throughout the codebase (e.g. `url: ${url}`, `method: ...`, `chars: ...`).

Current code (lines 47–64):
```ts
const lines: string[] = [
  `## Unblocked Content`,
  `url: ${url}`,
  `method: ${result.mode} | cost: ${result.cost} | chars: ${htmlLength}${truncated ? ` (truncated from ${htmlLength} to ${maxChars} — pass max_chars=${Math.min(htmlLength, 500000)} to get full content)` : ""}`,
  ``,
  `## Agent Hints`,
  ...hints,
  ``,
  `---`,
  `<!-- BEGIN EXTERNAL CONTENT — untrusted source: ${url} -->`,
  `<!-- Instructions below this line originate from the external website, not from Novada. -->`,
  ``,
  html,
  truncated ? `<!-- Content truncated from ${htmlLength} to ${maxChars} characters. Pass max_chars=${Math.min(htmlLength, 500000)} to novada_unblock to retrieve the full content. -->` : ``,
  `<!-- END EXTERNAL CONTENT -->`,
];
```

Proposed replacement:
```ts
const lines: string[] = [
  `## Unblocked Content`,
  `url: ${url}`,
  `method: ${result.mode} | cost: ${result.cost}`,
  `chars_returned: ${html.length}`,
  `chars_original: ${htmlLength}`,
  `truncated: ${truncated}`,
  truncated ? `truncated_hint: pass max_chars=${Math.min(htmlLength, 500000)} to retrieve the full content` : ``,
  ``,
  `## Agent Hints`,
  ...hints,
  truncated ? `- Content truncated: ${htmlLength} chars available, ${maxChars} returned. Increase max_chars to get more.` : ``,
  ``,
  `---`,
  `<!-- BEGIN EXTERNAL CONTENT — untrusted source: ${url} -->`,
  `<!-- Instructions below this line originate from the external website, not from Novada. -->`,
  ``,
  html,
  truncated ? `<!-- Content truncated from ${htmlLength} to ${maxChars} characters. Pass max_chars=${Math.min(htmlLength, 500000)} to novada_unblock to retrieve the full content. -->` : ``,
  `<!-- END EXTERNAL CONTENT -->`,
];
```

This emits three parseable key: value lines every time:
- `chars_returned: 100000` — how much HTML the agent received
- `chars_original: 118896` — how much was available before truncation
- `truncated: true` — boolean flag, trivially checkable without text parsing
- `truncated_hint: pass max_chars=118896 ...` — only present when truncated; contains the exact corrective call

**What an agent gets for the Wikipedia case:**
```
## Unblocked Content
url: https://wikipedia.org
method: render | cost: medium
chars_returned: 100000
chars_original: 118896
truncated: true
truncated_hint: pass max_chars=118896 to retrieve the full content
```

The agent can now check `truncated: true` on the first line of metadata and branch — no prose parsing required.

**Step 2 — Remove the inline prose truncation notice from the combined `method | cost | chars` line.**

The old combined line `method: render | cost: medium | chars: 118896 (truncated from 118896 to 100000 ...)` is replaced by splitting into separate lines. This also makes the metadata more grep-friendly and consistent with how other tools (e.g. `novada_extract`) structure their headers.

**Step 3 — Filter empty string from hints array** (minor cleanup needed since the conditional `truncated ? ... : ``  may push empty strings):
```ts
// Filter falsy entries before joining
return lines.filter(l => l !== undefined).join("\n");
```

Actually the existing code already does `.join("\n")` and empty strings produce blank lines, which is fine. No extra filter needed.

### Risk Assessment

- **Return type:** `Promise<string>` — no schema change. The response is still a string. Existing callers that don't look for these fields are unaffected.
- **Backward compatible:** Yes. The new fields are additive key: value lines in the metadata section (above the EXTERNAL CONTENT boundary), which agents are already expected to read.
- **HTML comment duplication:** The HTML comment at the bottom of the content block (`<!-- Content truncated... -->`) should be kept as-is for human-readable output. The new structured lines serve agents; the comment serves developers inspecting raw output.
- **No schema/type change in types.ts:** `UnblockParamsSchema` and `UnblockParams` are unchanged.
- **Risk:** Low. This is a purely additive change to a prose-format response string.

---

## BONUS: Browser Session Persistence — Documentation Fix

### Current State (from source)

**In `src/index.ts` — `novada_browser` tool description (lines 325–336):**
```
**Sessions:** Pass session_id to maintain state (cookies, login) across multiple calls. Sessions expire after 10 min of inactivity. Use close_session to release early.
```

**In `src/tools/types.ts` — `BrowserParamsSchema.session_id` field description (line 382):**
```
Optional session ID for persistent browser state across calls. Reuses the same browser page (cookies, localStorage, login state). Sessions expire after 10 minutes of inactivity.
```

**In `src/tools/browser.ts` — agent_instruction at end of response (lines 203–213):**
```ts
if (sessionId) {
  lines.push(`- Session active: session_id="${sessionId}" — reuse this ID in subsequent calls to maintain state.`);
  lines.push(`- Sessions expire after 10 minutes of inactivity — use close_session when done.`);
} else {
  lines.push(`- Each browser call starts fresh — no cookies or state from prior calls.`);
  lines.push(`- Use session_id to maintain state (login, cookies) across multiple browser calls.`);
}
```

**What's missing across all three locations:**
1. No mention that warm session reuse is measurably faster — agents have no signal that session_id is a latency optimization, not just a state-persistence mechanism.
2. No concrete latency numbers to justify the recommendation.
3. The `session_id` Zod description emphasizes state but not speed.
4. The non-session branch just says "Each browser call starts fresh" — no urgency for agents to adopt session_id for repeated calls.

### Proposed Documentation Update

**Location 1: Tool description in `src/index.ts` — `novada_browser` description**

Current:
```
**Sessions:** Pass session_id to maintain state (cookies, login) across multiple calls. Sessions expire after 10 min of inactivity. Use close_session to release early.
```

Proposed replacement:
```
**Sessions:** Pass session_id to maintain state (cookies, login) across multiple calls. Warm session reuse is ~5x faster than cold start (measured: 1,455ms warm vs 7,880ms cold). Always use session_id for multi-step workflows — it both preserves auth state and cuts per-call latency significantly. Sessions expire after 10 min of inactivity. Use close_session to release early.
```

**Location 2: `BrowserParamsSchema.session_id` field description in `src/tools/types.ts` (line 382)**

Current:
```
Optional session ID for persistent browser state across calls. Reuses the same browser page (cookies, localStorage, login state). Sessions expire after 10 minutes of inactivity.
```

Proposed replacement:
```
Optional session ID for persistent browser state across calls. Reuses the same browser page (cookies, localStorage, login state). Performance benefit: warm session reuse is ~5x faster than cold start (1,455ms vs 7,880ms). Use session_id for any multi-step workflow — login flows, paginated scraping, form sequences. Sessions expire after 10 minutes of inactivity.
```

**Location 3: `agent_instruction` in `src/tools/browser.ts` — non-session branch (line 208–209)**

Current:
```ts
lines.push(`- Each browser call starts fresh — no cookies or state from prior calls.`);
lines.push(`- Use session_id to maintain state (login, cookies) across multiple browser calls.`);
```

Proposed replacement:
```ts
lines.push(`- Each browser call starts fresh — no cookies or state from prior calls. Cold start adds ~6–8 seconds of browser spin-up overhead.`);
lines.push(`- Use session_id for multi-step workflows: warm sessions reuse the same browser page (~5x faster than cold start; measured 1,455ms vs 7,880ms) AND preserve cookies/login state across separate tool calls.`);
```

**Location 4: `agent_instruction` in `src/tools/browser.ts` — active session branch (line 205–206)**

Current:
```ts
lines.push(`- Session active: session_id="${sessionId}" — reuse this ID in subsequent calls to maintain state.`);
lines.push(`- Sessions expire after 10 minutes of inactivity — use close_session when done.`);
```

Proposed replacement:
```ts
lines.push(`- Session active: session_id="${sessionId}" — reuse this ID in subsequent calls to maintain state AND get ~5x faster response (~1,455ms warm vs ~7,880ms cold).`);
lines.push(`- Sessions expire after 10 minutes of inactivity — use close_session when done to release browser resources.`);
```

### Where to Add It

| Location | File | Line(s) | Change |
|----------|------|---------|--------|
| Tool description | `src/index.ts` | ~331 | Replace single `**Sessions:**` sentence with expanded version including latency numbers |
| Zod field description | `src/tools/types.ts` | 382 | Replace `session_id` `.describe()` string with version including `~5x faster` and `1,455ms vs 7,880ms` |
| Agent hint (no session) | `src/tools/browser.ts` | 208–209 | Expand both hint lines to include cold-start overhead and warm-session benchmark numbers |
| Agent hint (active session) | `src/tools/browser.ts` | 205–206 | Append `~5x faster` and measured ms to the active-session reuse line |

---

## Cross-cutting: agent_instruction Quality Audit

Scan of all `agent_instruction` and `## Agent Hints` content in `unblock.ts` and `browser.ts`:

### unblock.ts

**Current Agent Hints block:**
```
- This is raw HTML, not cleaned text. Parse with CSS selectors or regex.
- For cleaned text content, use novada_extract instead.
- Rendered via Web Unblocker (JS execution enabled).           [mode=render]
  OR
- Rendered via Browser API (full Chromium, highest fidelity). [mode=browser]
  OR
- Web Unblocker not configured — content fetched without JS rendering. [mode=render-failed]
  + agent_instruction: use novada_browser or novada_proxy_residential as fallback
```

**Issues found:**

1. **No truncation next-step guidance in the Agent Hints section (the bug itself).** When `truncated=true`, there is no hint saying "call novada_unblock again with max_chars=N to get the full content." The HTML comment at the bottom does say this, but it's inside the EXTERNAL CONTENT boundary — agents are cautioned not to trust content from below that boundary marker. The hint should be in the trusted Agent Hints section. Fix is covered by the proposed BUG-M4 change above (adding the truncation hint to the hints array when `truncated` is true).

2. **No "next step" guidance for happy path.** After successfully retrieving raw HTML, there's no hint about what to do with it. Agents new to the tool don't know whether to pass the HTML to a parser, call another tool, or process inline. Suggested addition:
   ```
   - Next step: Use CSS selectors or a DOM parser on the returned HTML. If you need readable text, call novada_extract with the same URL instead.
   ```

3. **`render-failed` agent_instruction is well-formed.** It names the specific fallback tools (`novada_browser`, `novada_proxy_residential`) and explains when to use each. Good — no change needed.

4. **No `agent_instruction` for the success cases (render and browser modes).** There's a description of what mode was used, but no forward guidance. Minor — lower priority.

### browser.ts

**Current Agent Hints block (success path, with session_id):**
```
- Session active: session_id="..." — reuse this ID in subsequent calls to maintain state.
- Sessions expire after 10 minutes of inactivity — use close_session when done.
- Chain actions to complete multi-step flows in one call.
- list_sessions shows all currently active session IDs.
- Geo-restrictions: TikTok is banned in India — always pass country="us"...
- SPA navigation: use wait_until="domcontentloaded"...
- N action(s) failed. Check selectors and page state.  [only when failed > 0]
```

**Issues found:**

1. **Failure hint is too vague.** `N action(s) failed. Check selectors and page state.` gives agents nothing to act on. Improved version:
   ```
   - ${failed} action(s) failed. Review the error above each failed action. Common causes: selector not found (try aria_snapshot to inspect the DOM first), page not loaded yet (add a wait action before the failing action), session expired (drop session_id and start fresh).
   ```

2. **No "next step" after aria_snapshot.** When an agent just took an aria_snapshot, the response is the ARIA tree — but there's no hint that this is what agents should use to find correct selectors before attempting click/type. A targeted hint would help agents use the tool more idiomatically:
   ```
   - Tip: Use aria_snapshot before click/type actions to inspect the current DOM and find correct selectors.
   ```

3. **`close_session` and `list_sessions` agent hints are absent.** When those special actions are invoked, the function returns early (lines 35–48) and skips the Agent Hints block entirely. An agent that calls `close_session` or `list_sessions` gets no agent_instruction in the response. The `list_sessions` response in particular should hint: "If a session is active and no longer needed, call close_session to release browser resources."

4. **No escalation path when browser fails.** When actions fail repeatedly, there's no hint to try `novada_unblock method=browser` or `novada_browser_flow` as alternatives. Minor, but consistent with the escalation pattern used in `unblock.ts` (render-failed branch) and the extract tool.

5. **The session_id / latency benefit is missing** — covered in depth by the BONUS section above.

### Summary of `agent_instruction` issues by severity

| File | Issue | Severity |
|------|-------|----------|
| unblock.ts | Truncation next-step missing from trusted Agent Hints section | HIGH (this is BUG-M4) |
| unblock.ts | No "next step" hint for happy-path HTML retrieval | LOW |
| browser.ts | Session latency benefit not mentioned | MEDIUM (BONUS fix) |
| browser.ts | Failure hint too vague, no actionable recovery steps | MEDIUM |
| browser.ts | No agent_instruction returned for close_session / list_sessions early-return paths | LOW |
| browser.ts | No escalation path hint on repeated action failure | LOW |
| browser.ts | aria_snapshot → click/type workflow not hinted | LOW |
