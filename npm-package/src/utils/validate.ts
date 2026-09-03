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

// ─── F-12: per-issue-class instruction templates ─────────────────────────────

type ZodIssue = ZodError["issues"][number];

/** field label for an issue's path — "(root)" for top-level / whole-object issues (e.g. unrecognized_keys). */
function issueField(issue: ZodIssue): string {
  return issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
}

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
export function formatZodIssue(issue: ZodIssue): string {
  const field = issueField(issue);

  switch (issue.code) {
    case "invalid_type": {
      // A missing required param arrives as invalid_type with no distinct
      // "missing" issue code — Zod's own message already says which one it
      // was ("... received undefined" vs "... received <actual type>"), so
      // parse THAT instead of issue.input: at runtime (verified against this
      // project's zod 4.3.6) plain schema.parse() does NOT populate the
      // issue's `input` field even though the type declares it optional —
      // relying on it silently mis-templated every wrong-type issue as
      // "missing" until this was caught by a test asserting on real output.
      const received = issue.message.match(/received (\w+)/)?.[1];
      if (received === "undefined") {
        return `Add the required parameter ${field} (type: ${issue.expected}).`;
      }
      return received
        ? `Change ${field} to type ${issue.expected} — got ${received}.`
        : `Change ${field} to type ${issue.expected}.`;
    }

    case "invalid_value": {
      const values = Array.isArray(issue.values) ? issue.values : [];
      return values.length > 0
        ? `Set ${field} to one of: ${values.map((v) => JSON.stringify(v)).join(" | ")}.`
        : `Fix ${field}: ${issue.message}.`;
    }

    case "too_small": {
      const unit = issue.origin === "string" ? "characters" : issue.origin === "array" ? "items" : "";
      const bound = issue.inclusive === false ? "more than" : "at least";
      return `Increase ${field} — needs ${bound} ${issue.minimum}${unit ? ` ${unit}` : ""}.`;
    }

    case "too_big": {
      const unit = issue.origin === "string" ? "characters" : issue.origin === "array" ? "items" : "";
      const bound = issue.inclusive === false ? "fewer than" : "at most";
      return `Decrease ${field} — needs ${bound} ${issue.maximum}${unit ? ` ${unit}` : ""}.`;
    }

    case "unrecognized_keys": {
      const keys = Array.isArray(issue.keys) ? issue.keys : [];
      return `Remove or rename unknown key(s): ${keys.map((k) => `'${k}'`).join(", ")} — not part of this tool's schema.`;
    }

    case "invalid_union": {
      // The union's OWN message is a generic "Invalid input" with no type
      // info (F-3/P3) — recover the real expected types from the branch
      // issues nested in `errors[]` instead.
      const expectedTypes = new Set<string>();
      for (const branch of issue.errors) {
        for (const sub of branch) {
          if (sub.code === "invalid_type") expectedTypes.add(sub.expected);
        }
      }
      return expectedTypes.size > 0
        ? `Change ${field} to one of these types: ${[...expectedTypes].join(" or ")}.`
        : `Fix ${field} — it does not match any of the accepted shapes for this parameter.`;
    }

    case "invalid_format": {
      const pattern = "pattern" in issue && issue.pattern ? ` matching ${issue.pattern}` : "";
      return `Fix ${field} — must be a valid ${issue.format}${pattern}.`;
    }

    case "not_multiple_of":
      return `Set ${field} to a multiple of ${issue.divisor}.`;

    default:
      // custom (.refine()/.superRefine() messages are already specific —
      // e.g. safeUrl's "URLs pointing to localhost..." — echo verbatim),
      // invalid_key, invalid_element: no dedicated template needed yet.
      return `Fix ${field}: ${issue.message}.`;
  }
}

/** One detail line per issue, matching the pre-existing "  field: message (valid values: ...)" shape. */
function issueDetailLine(issue: ZodIssue): string {
  let line = `  ${issueField(issue)}: ${issue.message}`;
  if (issue.code === "invalid_value" && Array.isArray(issue.values)) {
    line += ` (valid values: ${issue.values.map((v) => `'${String(v)}'`).join(", ")})`;
  }
  return line;
}

/**
 * Full agent-facing text for a ZodError on a given tool call (F-12, P-4 — the
 * ONE formatter). Callers that also have a computeUnknownKeyWarning() result
 * to surface should push it as a SEPARATE content block (see index.ts) rather
 * than concatenating it here, so it stays independently machine-parseable
 * (its own line-anchored `agent_instruction:` token) instead of trailing
 * inside this function's single instruction line.
 */
export function formatZodError(toolName: string, error: ZodError): string {
  const detailLines = error.issues.map(issueDetailLine);
  const instruction = error.issues.map(formatZodIssue).join(" ");
  return [
    `Invalid parameters for ${toolName}:`,
    ...detailLines,
    `agent_instruction: ${instruction} Do NOT retry with identical params — at least one field must change.`,
  ].join("\n");
}

// ─── F-2: warn-don't-reject on unknown/typo'd parameter keys ────────────────

/** Minimal shape this module needs from a registered tool — matches core.ts's `TOOLS` entries structurally. */
export interface ToolLike {
  readonly name: string;
  readonly inputSchema?: Record<string, unknown>;
}

/** snake_case -> camelCase, e.g. "max_pages" -> "maxPages". */
function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

/**
 * A handful of tools accept a documented alias whose name is NOT a pure
 * camelCase spelling of its snake_case canonical key (every other alias in
 * this codebase IS — see withCamelCaseAliases call sites in tools/types.ts
 * and tools/platform_scraper.ts, which this module derives from
 * automatically via toCamelCase() below). Enumerated here so those don't
 * false-positive as "unknown" — this is the SMALL, explicitly-labeled
 * exception list, not a per-tool key list (the full known-key set below is
 * still derived from the live registry, not hand-maintained).
 */
const EXTRA_KNOWN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // novada_search: start_time/end_time alias start_date/end_date "for
  // consistency with the developer-api tools" (tools/types.ts:134-136) —
  // different wording, not just casing, so toCamelCase() can't derive it.
  novada_search: ["start_time", "end_time"],
};

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
 * nothing declared to diff against), or every key is known (including its
 * mechanical camelCase alias, or an entry in EXTRA_KNOWN_ALIASES).
 */
export function computeUnknownKeyWarning(
  toolName: string,
  args: Record<string, unknown> | undefined,
  tools: readonly ToolLike[],
): string | undefined {
  if (!args) return undefined;
  const argKeys = Object.keys(args);
  if (argKeys.length === 0) return undefined;

  const tool = tools.find((t) => t.name === toolName);
  const props = tool?.inputSchema?.["properties"];
  if (!props || typeof props !== "object") return undefined;

  const declared = Object.keys(props as Record<string, unknown>);
  const known = new Set<string>(declared);
  for (const key of declared) known.add(toCamelCase(key));
  for (const extra of EXTRA_KNOWN_ALIASES[toolName] ?? []) known.add(extra);

  const unknown = argKeys.filter((k) => !known.has(k));
  if (unknown.length === 0) return undefined;

  return (
    `agent_instruction: Unknown parameter(s) ignored on ${toolName}: ${unknown.map((k) => `'${k}'`).join(", ")}. ` +
    `They had NO effect on this call. If one was a typo of a real parameter, re-call with the corrected name — ` +
    `valid parameters (including camelCase aliases) are listed in the tool's inputSchema.`
  );
}

/**
 * True if a ZodError already contains an `unrecognized_keys` issue — i.e. a
 * `.strict()` schema HARD-REJECTED the call because of the unknown key(s),
 * rather than silently dropping them. Callers should skip appending
 * computeUnknownKeyWarning()'s "ignored ... had NO effect" note in that case
 * — the two messages would contradict each other (rejected vs. ignored).
 */
export function hasUnrecognizedKeysIssue(error: ZodError): boolean {
  return error.issues.some((i) => i.code === "unrecognized_keys");
}

// ─── F2-3: lightweight pre-key-gate "required params present" check ─────────

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
export function computeMissingRequiredParams(
  toolName: string,
  args: Record<string, unknown> | undefined,
  tools: readonly ToolLike[],
): string[] | undefined {
  const tool = tools.find((t) => t.name === toolName);
  const required = tool?.inputSchema?.["required"];
  if (!Array.isArray(required) || required.length === 0) return undefined;

  const present = new Set(Object.keys(args ?? {}));
  const missing = required.filter((f): f is string => typeof f === "string" && !present.has(f));
  return missing.length > 0 ? missing : undefined;
}
