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
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/** Bound on the string length we even attempt to regex-match/parse as a
 *  number — defends against being asked to run a numeric parse on an
 *  attacker-supplied megabyte-long "number-ish" string. No legitimate
 *  numeric or boolean form field is anywhere near this long. */
const MAX_COERCIBLE_STRING_LENGTH = 32;
const INTEGER_STRING_RE = /^-?\d+$/;
const NUMBER_STRING_RE = /^-?\d+(?:\.\d+)?$/;
function asNode(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : undefined;
}
function schemaType(node) {
    const t = node.type;
    return typeof t === "string" ? t : undefined;
}
/**
 * True if every branch of `branches` — excluding any literal `{"type":
 * "null"}` branch (a nullable union) — declares the given JSON Schema type.
 * An empty or absent branch list is never treated as a match (no silent
 * "no branches present therefore numeric").
 */
function unionAllBranchesAre(branches, kind) {
    if (!Array.isArray(branches) || branches.length === 0)
        return false;
    const real = branches.filter((b) => {
        const n = asNode(b);
        return !(n && schemaType(n) === "null");
    });
    if (real.length === 0)
        return false;
    return real.every((b) => {
        const n = asNode(b);
        if (!n)
            return false;
        const t = schemaType(n);
        return kind === "boolean" ? t === "boolean" : t === "integer" || t === "number";
    });
}
/**
 * Resolve whether `node` (a property schema, possibly a primitive union)
 * should be treated as a numeric/boolean coercion leaf. Returns undefined
 * for anything else — including a union of OBJECT branches (discriminated
 * unions are handled separately by `findUnionBranch`, not here).
 */
function coercionKind(node) {
    const t = schemaType(node);
    if (t === "integer")
        return "integer";
    if (t === "number")
        return "number";
    if (t === "boolean")
        return "boolean";
    if (t !== undefined)
        return undefined; // declared as something else (string/object/array/null)
    const branches = node.oneOf ?? node.anyOf;
    if (unionAllBranchesAre(branches, "integer"))
        return "integer";
    if (unionAllBranchesAre(branches, "number"))
        return "number";
    if (unionAllBranchesAre(branches, "boolean"))
        return "boolean";
    return undefined;
}
function coerceLeafString(value, kind) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_COERCIBLE_STRING_LENGTH)
        return value;
    if (kind === "boolean") {
        const lower = trimmed.toLowerCase();
        if (lower === "true")
            return true;
        if (lower === "false")
            return false;
        return value;
    }
    const re = kind === "integer" ? INTEGER_STRING_RE : NUMBER_STRING_RE;
    if (!re.test(trimmed))
        return value;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : value;
}
/**
 * Find the discriminated-union branch (if any) whose schema pins a property
 * to a literal `const` equal to `value`'s own field of the same name — the
 * JSON-Schema shape Zod's `z.discriminatedUnion` renders to (`oneOf` of
 * object branches, each fixing its discriminator key to one `const`).
 * Generic over the discriminator's key name — DISCOVERED from the branch
 * schemas themselves, never hardcoded (e.g. never literally "action").
 * Returns undefined when no branch matches — the value is then left
 * untouched for Zod's own discriminated-union rejection.
 */
function findUnionBranch(value, branches) {
    for (const b of branches) {
        const branch = asNode(b);
        const props = branch && asNode(branch.properties);
        if (!branch || !props)
            continue;
        for (const key of Object.keys(props)) {
            if (DANGEROUS_KEYS.has(key))
                continue;
            const p = asNode(props[key]);
            if (p && "const" in p && p.const === value[key]) {
                return branch;
            }
        }
    }
    return undefined;
}
/** Declared `required[]` minus any key that also carries a "default" —
 *  defaulted keys are optional at Zod-parse time even though Zod v4's
 *  `.toJSONSchema()` lists them in `required[]` (see module header). */
function effectiveRequired(schema, props) {
    const declared = Array.isArray(schema.required) ? schema.required : [];
    const out = new Set();
    for (const k of declared) {
        if (typeof k !== "string")
            continue;
        const p = asNode(props[k]);
        if (p && "default" in p)
            continue;
        out.add(k);
    }
    return out;
}
function coerceObject(value, schema) {
    const props = asNode(schema.properties) ?? {};
    const required = effectiveRequired(schema, props);
    const out = {};
    for (const key of Object.keys(value)) {
        if (DANGEROUS_KEYS.has(key))
            continue;
        const raw = value[key];
        const propSchema = asNode(props[key]);
        if (!propSchema) {
            out[key] = raw; // not a declared property — not ours to judge; Zod strips/accepts as before
            continue;
        }
        const kind = coercionKind(propSchema);
        if (kind && typeof raw === "string" && raw.trim().length === 0 && !required.has(key)) {
            continue; // "" on an optional numeric/boolean field — treat as omitted
        }
        out[key] = coerceValue(raw, propSchema, kind);
    }
    return out;
}
function coerceValue(value, schema, precomputedKind) {
    const kind = precomputedKind !== undefined ? precomputedKind : coercionKind(schema);
    if (kind && typeof value === "string") {
        return coerceLeafString(value, kind);
    }
    if (value === null || typeof value !== "object")
        return value;
    if (Array.isArray(value)) {
        const items = asNode(schema.items);
        return items ? value.map((el) => coerceValue(el, items)) : value;
    }
    const objVal = value;
    if (kind === undefined) {
        const branches = (schema.oneOf ?? schema.anyOf);
        if (Array.isArray(branches)) {
            const matched = findUnionBranch(objVal, branches);
            return matched ? coerceObject(objVal, matched) : value;
        }
    }
    if (schemaType(schema) === "object" || schema.properties) {
        return coerceObject(objVal, schema);
    }
    return value;
}
/**
 * Coerce every string in `value` that a numeric/boolean leaf of `schema`
 * (the tool's own advertised JSON Schema, e.g. from `_TOOL_DEFINITIONS`)
 * would accept. Returns a NEW value; never mutates `value`. When `value` is
 * not a plain object (or `schema` has no usable shape), the input is
 * returned unchanged and Zod reports its own error as before.
 */
export function coerceFormStrings(value, schema) {
    const schemaNode = asNode(schema);
    if (!schemaNode || value === null || typeof value !== "object" || Array.isArray(value)) {
        return value;
    }
    return coerceObject(value, schemaNode);
}
//# sourceMappingURL=coerce-form-strings.js.map