# Agent 9 — MCP Tool Design Specialist

## Inputs Read
- `src/index.ts` (first 80 lines): imports, schema wiring, dispatch structure
- `src/tools/types.ts` (full): all Zod schemas, SafeUrl, validation functions
- `src/tools/extract.ts` (full): 811-line implementation of `novadaExtract`

---

## 1. Tool Function Size and "One Tool = One Function Call"

The MCP spec does not state a hard rule of one tool = one logical operation. The spec defines a tool as a named callable with a JSON schema for inputs and a text/content response. Size is left to the implementor.

Community consensus (from Anthropic's own guidance and published MCP servers) has converged on three practical constraints:

- **Decision cost.** An agent must parse the tool list before every action. Each tool name + description costs tokens. Beyond ~40 tools, the model's ability to select the right tool degrades measurably.
- **Parameter ambiguity.** A tool with 15+ parameters whose interactions are conditional (e.g., `wait_for` only applies in browser mode) creates a combinatorial space the model cannot reliably navigate from a description alone.
- **Single exit contract.** One tool should have one predictable output shape. When the same tool returns completely different structures depending on a mode switch, the model's downstream reasoning about the response is impaired.

"One tool = one function call" is not a hard rule, but it is a strong default. Exceptions are justified when the alternative (multiple tools) forces the model to make a routing decision it systematically gets wrong — exactly the `novada_extract` auto-escalation case.

---

## 2. Should `novada_extract` Split Into Three Tools?

**The case for splitting** (`novada_extract_static / _render / _browser`):

- The agent explicitly chooses the rendering tier. No implicit escalation, no hidden cost surprises.
- Each tool's parameter surface shrinks. `_static` has no `wait_for` or `wait_ms`; `_browser` keeps both.
- Failures are unambiguous: if `_static` fails, the agent calls `_render`. No guessing whether auto-escalation already tried render.
- Easier to reason about cost: the agent can surface "I'm about to call `_browser` which costs ~$3/GB" rather than silently paying it.

**The case against splitting:**

- The escalation logic in `extractSingle` is non-trivial (static → render → browser with quality scoring, bot detection, Wayback fallback). Exposing this as a three-step agent decision means the agent must re-implement that logic in its own reasoning, and it will do so inconsistently.
- Most callers have no opinion about render tier. Forcing a choice adds friction with no benefit for 80% of use cases.
- The current `render` enum (`auto | static | render | js | browser`) already gives explicit control to agents that need it. The tool is effectively already split at the parameter level.

**Verdict:** Do not split the tool. Instead, make the auto-escalation chain and its outcomes structurally visible in the response (which the current implementation already does via `auto_escalated`, `escalated_to`, `usedMode` fields). The split is better expressed as a parameter with a strong default, not as separate tools.

---

## 3. Long Descriptions with `agent_instruction` Blocks — Help or Hurt?

Reading `extract.ts`, the output can contain: `## Extracted Content`, `## Requested Fields`, `## Structured Data`, `## Same-Domain Links`, `## Extraction Diagnostics`, `## Agent Memory`, `## Agent Hints`, `## Agent Action`. That is eight sections in a single tool response.

The MCP spec says tool output is passed as context to the model. Every token in output competes with content the agent actually needs.

What helps agents:

- A single machine-parseable status line at the top: `status:success | quality:87/100 | mode:render`
- Specific next actions when quality is low: `agent_instruction: fix: retry with render="render"`
- Error classification that maps directly to a corrective call

What hurts agents:

- Prose paragraphs in hints blocks. The model reads them but cannot act on text like "For large PDFs (>10MB), try a more specific page URL" without an explicit action trigger.
- Repeating the same escalation hint across `## Agent Hints` and `## Agent Action` (currently both blocks appear in failure paths).
- The `## Agent Memory` `remember:` line in every successful response. This instructs the model to store something into its own context, which is not a standard MCP pattern and wastes tokens when the agent is not an AgentRecall-aware system.

Right format: structured key-value metadata header (10-15 lines), content body, one `agent_instruction` block at the end with exactly the next action(s) relevant to this specific outcome. Total response overhead should not exceed 15% of the content payload.

---

## 4. One Smart Tool with Auto-Escalation vs. Multiple Dumb Tools

For web extraction specifically, one smart tool with auto-escalation outperforms multiple dumb tools because:

1. **Escalation requires state.** The decision to escalate from static to render depends on quality scoring the raw HTML — a metric the agent cannot compute itself without receiving the raw HTML, which defeats the purpose.
2. **Agent escalation is noisy.** In practice, agents asked to retry with render after a low-quality static result often retry with the same parameters, or escalate to browser immediately, skipping render. The internal quality-score gate in `extractSingle` is more reliable.
3. **Cost asymmetry.** Static is fast and cheap. Render is 5-10x slower. Browser is 100x more expensive. An agent that must decide the tier before seeing the content will over-allocate to render/browser as a hedge against failure.

The current "smart tool" approach is architecturally correct. Its one failure mode is opacity: when auto-escalation happens, the agent needs to see it clearly in the response to update its model of the page's difficulty. The `auto_escalated: true` and `escalated_to` fields in JSON format handle this correctly.

---

## 5. Schema Design and Internal Architecture

The Zod schema in `types.ts` has a visible effect on `extract.ts`'s structure: every branch in `extractSingle` corresponds to a parameter path in `ExtractParamsSchema`. The `render` enum (`auto | static | render | js | browser`) directly maps to the five execution branches in the function. The `wait_for` and `wait_ms` fields are gated behind browser mode in the schema description but not at the Zod validation layer — they are accepted for all render modes but silently ignored, creating a silent failure mode.

A schema that encodes the conditional correctly — using Zod discriminated unions so `wait_for` only exists when `render` is `"browser"` — would force the internal implementation to handle the browser-mode path separately, making the architecture reflect the actual constraint. Currently `wait_for` is reachable in the static path at the type level, which means the implementation has a dead-code-equivalent branch rather than a type error.

**Rule:** The Zod schema is not just documentation — it is the contract enforced at the boundary. When a parameter is only valid for a specific mode, encode that as a discriminated union, not as a description-only constraint. Schema precision prevents implementation drift and eliminates agent confusion about which parameters to pass.

---

## 6. One Concrete Recommendation for `novada_extract`

**Replace the `render` string enum with a discriminated union at both the schema and output levels.**

Currently: `render: z.enum(["auto", "static", "render", "js", "browser"])` — a flat enum that hides the tree.

Recommended: keep the flat enum for backward compatibility, but add a `_strategy` field to the output JSON that names the exact path taken (`"direct"`, `"proxy"`, `"proxy+render"`, `"browser"`, `"wayback"`) with a `_strategy_reason` explaining *why* that path was taken (`"domain_registry"`, `"quality_score<40"`, `"bot_challenge"`, `"render_failed"`).

This single change makes the auto-escalation chain fully legible to downstream agents without splitting the tool or changing the call signature. An agent processing the output can now say "auto-escalation fired because quality was 28/100, escalated to render" and correctly route the next action — rather than reading a prose hint that says "Content above was fetched with JS rendering enabled."
