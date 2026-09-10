/**
 * validate.ts — the ONE shared parameter-validation formatter for the whole
 * tool surface (F-12, F-2, P-4).
 *
 * Before this file existed, "turn a ZodError into agent-facing text" was
 * hand-rolled independently at (at least) four sites — index.ts's main
 * dispatch catch, index.ts's novada_search_feedback catch (which used a
 * DIFFERENT off-contract token (the literal text "Next step" + a colon)
 * instead of the documented `agent_instruction:`
 * convention), and tools/setup.ts + tools/session_stats.ts's own pre-wrap-into-
 * Error variants — each with a slightly different level of enum enrichment
 * and none of them templating on the issue's *class* (missing vs wrong-type
 * vs bad-enum vs too-short vs unknown-key vs union-mismatch all produced the
 * same generic "Fix the parameter(s) listed above" paragraph).
 *
 * This module exports:
 *   - formatZodIssue()  — one issue -> one instruction fragment, templated on
 *                         the Zod v4 issue `code` (F-12).
 *   - formatZodError()  — the full "Invalid parameters for X: ... agent_instruction: ..."
 *                         block, reused everywhere in index.ts that formats a
 *                         ZodError (collapses the near-duplicate copies within
 *                         this worker's file ownership — see the note at the
 *                         bottom about the two sites this pass could NOT reach).
 *   - computeUnknownKeyWarning() — F-2's warn-don't-reject mechanism, DERIVED
 *                         from the live tool registry's declared inputSchema
 *                         (not a hand-written per-tool key list), so a new
 *                         38th/39th/Nth tool needs zero new branches here.
 */
import type { ZodError } from "zod";
type ZodIssue = ZodError["issues"][number];
/**
 * One Zod v4 validation issue -> one instruction fragment that names the
 * ACTUAL fix (not a generic "check the schema" paragraph). Switches on
 * `issue.code` so every issue class gets its own template:
 *   invalid_type        -> "Add the required parameter X" | "Change X to type Y"
 *   invalid_value        -> "Set X to one of: ..." (enum/literal mismatch)
 *   too_small / too_big   -> "Increase/decrease X — minimum/maximum N ..."
 *   unrecognized_keys    -> "Remove or rename unknown key(s): ..."
 *   invalid_union        -> "Change X to one of these types: ..." (derived from
 *                            the union's own branch issues — see the P3/F-3 fix
 *                            this closes: novada_extract's `url` field is
 *                            `z.union([safeUrl, z.array(safeUrl)])`, and Zod's
 *                            top-level union message is the unhelpful bare
 *                            "Invalid input" with no expected type — the real
 *                            type info lives one level down, in `errors[]`)
 *   invalid_format        -> "Fix X — must be a valid <format>"
 *   not_multiple_of       -> "Set X to a multiple of N"
 *   custom / anything else -> falls back to the issue's own message verbatim
 */
export declare function formatZodIssue(issue: ZodIssue): string;
/**
 * Full agent-facing text for a ZodError on a given tool call (F-12, P-4 — the
 * ONE formatter). Callers that also have a computeUnknownKeyWarning() result
 * to surface should push it as a SEPARATE content block (see index.ts) rather
 * than concatenating it here, so it stays independently machine-parseable
 * (its own line-anchored `agent_instruction:` token) instead of trailing
 * inside this function's single instruction line.
 */
export declare function formatZodError(toolName: string, error: ZodError): string;
/** Minimal shape this module needs from a registered tool — matches core.ts's `TOOLS` entries structurally. */
export interface ToolLike {
    readonly name: string;
    readonly inputSchema?: Record<string, unknown>;
}
/**
 * Diffs an incoming tool call's argument keys against the tool's OWN
 * declared JSON-Schema `inputSchema.properties` — already the single source
 * of truth for that tool's real Zod schema (see utils/mcp-schema.ts's
 * zodToMcpSchema, which every tool definition in core.ts is built from) —
 * and returns a non-fatal warning line naming any key that isn't part of it.
 *
 * Deliberately generic over the live `tools` list (pass `TOOLS` from
 * core.ts) instead of a hand-written per-tool key table, so adding a 39th
 * tool needs ZERO new branches here (F-2 / F-5 class-not-instance
 * requirement): its schema is picked up automatically the moment it's
 * registered.
 *
 * Returns undefined when there is nothing to warn about: no args, the tool
 * isn't in `tools` (e.g. a hidden alias absent from the visible TOOLS list —
 * nothing declared to diff against), or every key is known — either the
 * declared key itself, its mechanical camelCase alias IF the tool is in
 * CAMELCASE_ALIASED_TOOLS (its schema actually accepts that alias), or an
 * entry in EXTRA_KNOWN_ALIASES.
 */
export declare function computeUnknownKeyWarning(toolName: string, args: Record<string, unknown> | undefined, tools: readonly ToolLike[]): string | undefined;
/**
 * True if a ZodError already contains an `unrecognized_keys` issue — i.e. a
 * `.strict()` schema HARD-REJECTED the call because of the unknown key(s),
 * rather than silently dropping them. Callers should skip appending
 * computeUnknownKeyWarning()'s "ignored ... had NO effect" note in that case
 * — the two messages would contradict each other (rejected vs. ignored).
 */
export declare function hasUnrecognizedKeysIssue(error: ZodError): boolean;
/**
 * A schema-derived (not hand-maintained) check for whether every REQUIRED
 * top-level param is present in `args`, using the same live `inputSchema`
 * JSON Schema `computeUnknownKeyWarning` reads (its `required[]` array is
 * already accurate — see utils/mcp-schema.ts's Fix 1: keys with a Zod
 * `.default()` are stripped from `required[]`, so it matches what Zod
 * actually enforces at runtime).
 *
 * This is intentionally NOT full Zod validation — it only checks presence,
 * not type/enum/refine correctness — but it is derivable for EVERY
 * registered tool (including the 15 novada_scrape_<platform> tools, whose
 * full Zod schema lives in a private closure in tools/platform_scraper.ts
 * with no separately-exported validator to call). Callers that DO have a
 * tool's real validator function available should prefer calling it
 * directly and formatting the resulting ZodError with formatZodError() —
 * see index.ts's PRE_KEY_VALIDATORS map — and use this only as the fallback
 * for tools without one.
 *
 * Returns undefined when the tool isn't found, has no required fields, or
 * every required field is present.
 */
export declare function computeMissingRequiredParams(toolName: string, args: Record<string, unknown> | undefined, tools: readonly ToolLike[]): string[] | undefined;
export {};
//# sourceMappingURL=validate.d.ts.map