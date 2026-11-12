/**
 * coerce-form-strings.ts — schema-driven stringified-number/boolean coercion
 * for MCP tool-call arguments.
 *
 * Form-based MCP clients (e.g. Arcade.dev playgrounds) send EVERY field value
 * as a string, because an HTML form has no native number/boolean input type
 * on the wire. `num: "3"` for a tool whose advertised inputSchema declares
 * `num` as `{"type":"integer"}` then fails Zod validation with "Invalid
 * input: expected number, received string" even though "3" unambiguously
 * means 3.
 *
 * This fixes that ONE class of mismatch, driven entirely by the tool's OWN
 * advertised JSON Schema — the exact thing `zodToMcpSchema()` already
 * produces and the client already saw via tools/list — never by the tool
 * name or a per-tool/per-field list. Walking the schema instead of guessing
 * from the value means:
 *   - a string-typed target (query, url, enum, …) is NEVER touched, even if
 *     it happens to look numeric ("3" stays the string "3" for a `query`
 *     param);
 *   - int/min/max/enum validation is left entirely to Zod, so a value Zod
 *     would reject anyway (an out-of-range number, "2.5" on an integer, a
 *     non-boolean string) gets the SAME error text a real out-of-range
 *     number/boolean/wrong-type value gets today;
 *   - a brand-new tool or a brand-new numeric/boolean field needs ZERO edits
 *     here — it is covered the moment its Zod schema declares the type.
 *
 * Coercion rules (per schema leaf):
 *   - "integer": a string matching `^-?\d+$` (after trim) is parsed with
 *     Number(). A decimal string ("2.5") is deliberately left untouched so
 *     Zod's own type check rejects it with the SAME "expected number,
 *     received string" message a string has always gotten (not a new
 *     "not an integer" message) — this is unmodified pre-existing behaviour.
 *   - "number": like "integer" but `^-?\d+(?:\.\d+)?$` — decimals allowed.
 *     (No tool in this codebase currently declares a plain, non-int
 *     `z.number()`, but the rule is schema-driven, not enumerated.)
 *   - "boolean": "true"/"false" in any letter case (after trim) becomes the
 *     boolean. Any other string ("yes", "1", …) is left untouched — Zod
 *     rejects it with the normal "expected boolean, received string"
 *     message, unchanged from today.
 *   - "" (after trim) on a NUMERIC or BOOLEAN property that is NOT required
 *     — "required" here means in the schema's declared `required[]` AND
 *     without its own "default" (a defaulted key is optional at runtime
 *     even though Zod v4's `.toJSONSchema()` lists it in `required[]`; see
 *     the identical correction already applied at the ROOT level by
 *     `zodToMcpSchema`'s Fix 1 in utils/mcp-schema.ts — this module applies
 *     the SAME correction at every nesting depth, since a nested object's
 *     own `required[]` is not touched by that root-only fix) — is treated
 *     as "the caller omitted this": the key is dropped so Zod's own
 *     optional/default handling applies, matching how a real MCP client
 *     omits an unset optional field. "" on a field that IS effectively
 *     required is left as "" — Zod rejects it with the normal type-mismatch
 *     message, identical to today.
 *   - anyOf/oneOf unions of PRIMITIVE branches: treated as a numeric
 *     coercion target only if EVERY non-null branch is "integer"/"number",
 *     or as boolean only if EVERY non-null branch is "boolean" — otherwise
 *     left untouched (e.g. novada_extract's `url: string | string[]` is
 *     never coerced; no branch there is numeric or boolean).
 *   - anyOf/oneOf unions of OBJECT branches (Zod `discriminatedUnion`, e.g.
 *     novada_browser's `actions[]` items) are not a coercion leaf at all —
 *     the walker finds the branch whose discriminator `const` matches the
 *     value's own field (the key is DISCOVERED from the branch schemas, not
 *     hardcoded to "action" or any other name) and recurses into THAT
 *     branch's `properties`, so e.g. a `{action:"wait", ms:"2000"}` element
 *     gets `ms` coerced using the matching "wait" branch's own schema.
 *   - "object"/"array" nodes recurse into `properties`/`items`.
 *   - every other leaf (string, enum, const, an untyped `z.record` bag such
 *     as novada_scrape's `params`) is returned unchanged — there is no
 *     declared type to coerce against, so nothing is guessed.
 *
 * Untrusted-input posture (MCP args are untrusted JSON): the walker never
 * mutates its input — it builds new objects/arrays on the way out; the
 * three prototype-pollution key names (`__proto__`, `constructor`,
 * `prototype`) are skipped entirely while copying an object's own keys; the
 * only regexes used are two small, fully-anchored, fixed-pattern numeric
 * matches (no attacker-controlled pattern, no catastrophic backtracking);
 * and a candidate string longer than MAX_COERCIBLE_STRING_LENGTH is left
 * untouched (Zod's own type check rejects it exactly as before — never
 * worse than pre-fix behaviour, simply not coerced).
 */
/**
 * Coerce every string in `value` that a numeric/boolean leaf of `schema`
 * (the tool's own advertised JSON Schema, e.g. from `_TOOL_DEFINITIONS`)
 * would accept. Returns a NEW value; never mutates `value`. When `value` is
 * not a plain object (or `schema` has no usable shape), the input is
 * returned unchanged and Zod reports its own error as before.
 */
export declare function coerceFormStrings(value: unknown, schema: unknown): unknown;
//# sourceMappingURL=coerce-form-strings.d.ts.map