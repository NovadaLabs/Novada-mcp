/**
 * Layer 4 — Tool interaction / collision matrix (permanent regression net).
 *
 * Promotes reports/phase1-net-design/B/prototype/collision-matrix.mjs — already executed
 * once against the live build (0 schema-validity problems, 0 name collisions, 9 param-shape
 * collisions on the 23-tool registry, see DESIGN-B.md §4) — into a maintained vitest suite
 * that runs on every CI invocation of `npm test`.
 *
 * Loading strategy vs. the house pattern in this directory:
 *   discover.test.ts / tool-definitions.test.ts read src/core.ts as raw TEXT specifically to
 *   reach `_TOOL_DEFINITIONS`, which is NOT exported (only the registry-filtered `TOOLS` is).
 *   This suite needs something text-parsing cannot give: the actual RESOLVED JSON Schema per
 *   tool (concrete `type`/`enum` values), which only exists after `zodToMcpSchema(...)` runs
 *   at module-eval time. src/core.ts documents itself as side-effect-free and "safe to import
 *   from any transport (stdio index.ts, hosted mcp.ts, tests)" — unlike src/index.ts, which
 *   boots a stdio server at import time and must never be imported by a test. So this suite
 *   imports the real `TOOLS` export directly: the exact array every real MCP client sees over
 *   tools/list, computed by vitest's on-the-fly TS transpile of src/ (no build/ step needed,
 *   consistent with every other file in this directory).
 *
 * Three checks, ported from the prototype's logic and HARDENED after a red-team pass found
 * three real blind spots (see the header of each fixed function below for the specific gap):
 *
 *   HARD   — schema validity: every inputSchema has type:"object", .properties is an object,
 *            every required[] entry references a declared property, AND no dangling `$ref`
 *            reaches an MCP client anywhere in the schema (added post red-team — see GAP C
 *            on `scanSchemaValidity`). A single malformed schema here corrupts tools/list for
 *            every client (the NOV-662 failure class).
 *   HARD   — name collisions: no exact duplicate and no case/underscore-insensitive
 *            near-duplicate tool name (catches typo'd near-clones before they ship).
 *   REVIEW, gated by a committed baseline — param-name collisions across tool pairs with
 *            divergent shape for the SAME param name, where "shape" is now computed
 *            RECURSIVELY (see GAP A on `paramShape`) instead of top-level type+enum only,
 *            excluding param names whose divergent shapes have each been individually
 *            reviewed and recorded (see GAP B on `expectedSharedParams`/`baselineKey`).
 *            Every currently-known divergence is captured, with a reviewer's rationale, in
 *            collision-matrix.baseline.json — so this suite is green today. A divergent
 *            collision NOT present in the baseline is new and unreviewed: the suite FAILS
 *            until a human either fixes the schema or adds a reviewed entry to the baseline
 *            (mirroring a snapshot-test workflow).
 *
 * A final self-check section (synthetic fixtures only, never the real registry) proves these
 * three functions — and the two red-team-hardened mechanisms inside them — are not inert: it
 * feeds each one a fabricated bad input and asserts the detector actually flags it. This
 * reproduces, on every run, the same proof performed by hand once during the original
 * authoring (fake malformed-schema + name-collision + new-divergent-param tool), extended
 * with three more fixtures for the specific gaps a red-team demonstrated live against this
 * registry:
 *
 *   GAP A — paramShape() was top-level-only (`{type, enum}`), so it collapsed array items,
 *           union/oneOf members, nested object properties, and `const` down to a bare
 *           `{"type":"array"}` (or similar). Demonstrated LIVE: novada_browser.actions (a
 *           14-variant discriminated union) and novada_browser_flow.actions (a flat 5-value
 *           enum, different field names) BOTH hashed to `{"type":"array"}` — an exact shape
 *           "match" — so the pair was never even reported as a collision, let alone reviewed.
 *   GAP B — baselineKey(param, toolA, toolB) ignored shape entirely, so re-shaping an
 *           already-baselined divergence (e.g. capture_apikey.action gaining a "wipe_all_keys"
 *           enum member) kept the same key and was silently waved through with zero new
 *           review signal. Separately, expectedSharedParams was a flat name list with no
 *           shape data, so adding a name there blanket-exempted it from ALL shape comparison
 *           forever, regardless of what shape appeared on either side.
 *   GAP C — zodToMcpSchema() in core.ts unconditionally strips `$defs`. A tool authored with
 *           zod v4 `.meta({id})` emits `{"$ref":"#/$defs/Foo"}` with the corresponding
 *           `$defs` entry then deleted — a dangling ref reaches MCP clients — and the HARD
 *           schema-validity check did not look for `$ref` at all, so it passed silently.
 *
 * ── ROUND 2 (2026-07-19): a second red-team pass, run live against the real zod@4.3.6 output
 * and the real src/core.ts TOOLS export, proved the round-1 fixes above were themselves
 * incomplete — because both `normalizeSchemaForShape` and `findDanglingRefs` were still
 * HAND-LISTING which JSON-Schema keywords to walk into (`items`/`anyOf`/`oneOf`/`allOf`/
 * `properties`/`const` only). Enumerating keywords is inherently incomplete: there is always a
 * keyword #N+1 the list forgot. Round 2 replaces both functions' recursion with a
 * COMPLETE-BY-CONSTRUCTION walk grounded in the JSON-Schema 2020-12 spec's own CLOSED
 * "Applicator" vocabulary (every keyword whose job is to apply a nested schema somewhere) —
 * see the doc comment on `SCHEMA_DICT_KEYS`/`SCHEMA_SINGLE_KEYS`/`SCHEMA_ORDERED_ARRAY_KEYS`/
 * `SCHEMA_UNORDERED_ARRAY_KEYS` below for exactly which keywords and why the set is closed
 * rather than hand-picked. Four concrete live gaps this closes:
 *
 *   GAP D — `additionalProperties` (when schema-valued, e.g. a `z.record()`'s value schema),
 *           `propertyNames` (a record's key schema), and `patternProperties.*` were never
 *           walked by `normalizeSchemaForShape` at all. Demonstrated LIVE against
 *           novada_scrape's `params: z.record(z.string(), z.unknown())`: a hypothetical
 *           numeric-valued record (`additionalProperties:{type:"number"}`) and the real
 *           free-form record (`additionalProperties:{}`) both collapsed to the identical
 *           `{"type":"object"}` shape under the round-1 code — an invisible collision.
 *   GAP D (cont'd) — `prefixItems` (the 2020-12 tuple form) was likewise never walked, so
 *           `[string, number]` and `[number, string]` tuples were indistinguishable.
 *   GAP E — `findDanglingRefs` had the SAME hand-listed-keyword gap: a `$ref` nested inside
 *           `additionalProperties` or `prefixItems` escaped the HARD schema-validity check
 *           entirely (never even looked at those keys), even though GAP C already proved a
 *           dangling `$ref` reaching an MCP client is a real, live-reproducible failure mode.
 *   GAP F — round-1's `anyOf`/`oneOf`/`allOf` handling recursed but did NOT sort the member
 *           array, so a purely COSMETIC reorder of union members (which changes nothing about
 *           what the schema accepts) produced a different shape string — a FALSE POSITIVE that
 *           would force a human to re-review a divergence that isn't real.
 *
 * A DELIBERATE non-goal, verified empirically while building this fix (see the scope-boundary
 * comment above `SCHEMA_DICT_KEYS` below): "generic" here means complete recursion over
 * SCHEMA-COMPOSITION keywords (the Applicator vocabulary), not literally every JSON-Schema
 * keyword. Validation-refinement keywords (`format`, `pattern`, `minLength`, `maxLength`,
 * `minimum`, `maximum`, ...) and Meta-Data annotations (`description`, `title`, `default`, ...)
 * remain excluded, exactly as round 1 excluded them — including them would not close any real
 * gap (round 2 never found a live escape through a refinement/annotation keyword, because none
 * of them hold nested structure to escape through) and empirically explodes "shape" comparisons
 * across almost every shared param name (e.g. `country` is declared with a different
 * minLength/maxLength/pattern/default on nearly every tool that has it — cosmetic refinements
 * of the same conceptual shape, not the kind of structural divergence this suite exists to
 * catch).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TOOLS } from "../../src/core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Types ──────────────────────────────────────────────────────────────────

/** The minimal shape every scan function needs — a structural subset of the real `TOOLS` entries. */
interface MinimalTool {
  name: string;
  inputSchema?: unknown;
}

interface ParamCollision {
  param: string;
  toolA: string;
  shapeA: string | null;
  toolB: string;
  shapeB: string | null;
}

interface SchemaProblem {
  tool: string;
  issue: string;
}

interface NameProblem {
  issue: string;
  names: string[];
  normalized?: string;
}

/** One reviewed, individually-named shape variant for a param name in `expectedSharedParams`. */
interface ReviewedShapeVariant {
  /** The raw JSON-schema-like fragment for this variant (fed through `paramShape()` at load time). */
  shape: unknown;
  /** Informational only — which tools use this variant today. Not enforced; staleness here is cosmetic. */
  tools: string[];
}

/**
 * A param name that's conceptually meant to be shared vocabulary across tools (url, format,
 * country, ...). GAP B FIX: this is no longer a bare name that blanket-exempts any shape —
 * each entry pins the exact, individually-reviewed shape variant(s) seen for that name. A
 * pair is only skipped when BOTH sides' live shapes match one of the recorded variants; an
 * undocumented third shape is NOT exempted and surfaces as a new, unreviewed collision.
 */
interface ExpectedSharedParamEntry {
  name: string;
  reviewedShapes: ReviewedShapeVariant[];
  note: string;
}

interface BaselineEntry {
  param: string;
  tools: [string, string];
  /** The raw JSON-schema-like fragments for tools[0] and tools[1] respectively (same order). */
  shapes: [unknown, unknown];
  note: string;
}

interface Baseline {
  expectedSharedParams: ExpectedSharedParamEntry[];
  acceptedDivergentCollisions: BaselineEntry[];
}

// ─── Baseline load ──────────────────────────────────────────────────────────

function loadBaseline(): Baseline {
  const path = resolve(__dirname, "./collision-matrix.baseline.json");
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Baseline;
  expect(Array.isArray(parsed.expectedSharedParams), "baseline.expectedSharedParams must be an array").toBe(true);
  expect(Array.isArray(parsed.acceptedDivergentCollisions), "baseline.acceptedDivergentCollisions must be an array").toBe(true);
  for (const entry of parsed.expectedSharedParams) {
    expect(Array.isArray(entry.reviewedShapes), `expectedSharedParams entry '${entry.name}' must have a reviewedShapes array`).toBe(true);
  }
  for (const entry of parsed.acceptedDivergentCollisions) {
    expect(Array.isArray(entry.shapes) && entry.shapes.length === 2, `acceptedDivergentCollisions entry for '${entry.param}' (${entry.tools.join(",")}) must have a 2-element shapes tuple`).toBe(true);
  }
  return parsed;
}

/** Builds paramName -> Set<canonical shape string> from the baseline's reviewed shared-param variants. */
function buildExpectedSharedMap(entries: readonly ExpectedSharedParamEntry[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const entry of entries) {
    const shapes = new Set<string>();
    for (const variant of entry.reviewedShapes) {
      const s = paramShape(variant.shape);
      if (s !== null) shapes.add(s);
    }
    map.set(entry.name, shapes);
  }
  return map;
}

/**
 * GAP B FIX: baselineKey now incorporates a digest of BOTH sides' actual shapes, not just the
 * param name + tool names. If either tool's schema for this param changes shape in ANY way
 * (enum grows, nesting changes, a field is added/removed), the key changes and the entry no
 * longer matches — forcing the collision to be treated as new/unreviewed until a human
 * re-confirms it. Tool-name order is sorted so the key doesn't depend on scan iteration order,
 * and each shape stays paired with the tool name it actually came from (sorting the pair as a
 * unit, not sorting names and shapes independently) so a divergent shape can never get
 * silently cross-wired onto the wrong tool name.
 */
function baselineKey(param: string, toolA: string, shapeA: string | null, toolB: string, shapeB: string | null): string {
  const pair: [string, string | null][] = [
    [toolA, shapeA],
    [toolB, shapeB],
  ];
  pair.sort((x, y) => x[0].localeCompare(y[0]));
  const [[nameX, shapeX], [nameY, shapeY]] = pair as [[string, string | null], [string, string | null]];
  return [param, nameX, shapeDigest(shapeX), nameY, shapeDigest(shapeY)].join("::");
}

/** Short, stable digest of a canonical paramShape() string, for compact/comparable baseline keys. */
function shapeDigest(shape: string | null): string {
  if (shape === null) return "∅"; // explicit sentinel for "no schema" — never collides with a real hash
  return createHash("sha256").update(shape).digest("hex").slice(0, 16);
}

// ─── Scan functions (ported from prototype/collision-matrix.mjs, hardened per red-team) ────

/**
 * Safety bound against pathological/cyclic schema nesting. Real schemas produced by
 * zodToMcpSchema() never nest deeper than ~4-5 levels (array -> oneOf -> object ->
 * properties -> scalar), so this is purely defensive and generous on purpose — genuinely
 * cyclic input (e.g. a hand-built `$ref`-free but self-referential test fixture, or a future
 * schema source that isn't zod) should hit the depth guard and truncate gracefully rather than
 * stack-overflow, while staying far above anything a real tool's schema could ever need. It
 * must never trigger on a real tool; if it ever does, that's itself a signal worth
 * investigating, not a crash.
 */
const MAX_SHAPE_DEPTH = 60;

/**
 * The JSON-Schema 2020-12 "Applicator" vocabulary — https://json-schema.org/draft/2020-12/json-schema-core#name-a-vocabulary-for-applying-s
 * — every keyword whose entire job is to apply ANOTHER schema (or a named/indexed collection
 * of them) somewhere in the instance. This is the CLOSED set the spec itself defines, not a
 * hand-picked subset: nothing outside it can hold nested schema structure. GAP D/E FIX: the
 * round-1 code walked only 5 of these keywords (items/anyOf/oneOf/allOf/properties) and
 * silently ignored the rest — including additionalProperties/propertyNames/patternProperties/
 * prefixItems, all four of which the round-2 red-team demonstrated a live escape through.
 * Recursing the FULL spec vocabulary — instead of an arbitrary subset — is what makes the fix
 * complete BY CONSTRUCTION: a future zod upgrade can only ever emit keywords from within this
 * same standard (or a newer draft this whole pipeline isn't declared to target), so there is no
 * "keyword #N+1" left for a future round to find. `unevaluatedItems`/`unevaluatedProperties`
 * (a closely related, separate 2020-12 vocabulary) are included for the same reason even though
 * nothing in this registry emits them today — same failure mode, same fix, no reason to wait
 * for a round 3 to add them.
 *
 * Three buckets, split only by HOW each keyword's value must be walked (not WHETHER to walk
 * it — every one of these is always recursed into, unconditionally):
 *   - dict keys: value maps arbitrary NAMES to their own subschema (sort by name for stability).
 *   - single keys: value IS one subschema directly (or a JSON-Schema boolean `true`/`false`).
 *   - ordered-array keys: value is an array of subschemas where POSITION is semantically
 *     meaningful (a tuple) — must never be sorted (round-2 GAP D: `[string,number]` vs
 *     `[number,string]` are genuinely different schemas).
 *   - unordered-array keys: value is an array of subschemas where order carries NO meaning
 *     (a set of alternatives) — MUST be sorted after normalizing each member, or a purely
 *     cosmetic reorder produces a different shape string (round-2 GAP F false positive).
 */
const SCHEMA_DICT_KEYS = new Set(["properties", "patternProperties", "dependentSchemas"]);
const SCHEMA_SINGLE_KEYS = new Set([
  "additionalProperties",
  "propertyNames",
  "items",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "unevaluatedItems",
  "unevaluatedProperties",
]);
const SCHEMA_ORDERED_ARRAY_KEYS = new Set(["prefixItems"]);
const SCHEMA_UNORDERED_ARRAY_KEYS = new Set(["allOf", "anyOf", "oneOf"]);

/**
 * Deliberately NOT walked or retained: every keyword from JSON-Schema's Validation vocabulary
 * (`format`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`,
 * `exclusiveMaximum`, `multipleOf`, `minItems`, `maxItems`, `uniqueItems`, `minProperties`,
 * `maxProperties`) and Meta-Data annotation vocabulary (`description`, `title`, `default`,
 * `examples`, `deprecated`, `readOnly`, `writeOnly`, `$comment`). This is a DELIBERATE scope
 * boundary, verified empirically against the live registry while building this fix: widening
 * recursion to include these would NOT close a real gap — round 2 never found a live escape
 * through a refinement/annotation keyword, because none of them hold nested structure to
 * escape through — and WOULD explode "shape" comparisons across virtually every shared param
 * name. Concretely: `country` is declared with a different minLength/maxLength/pattern/default
 * on nearly every tool that has it (novada_search: `{default:""}`, novada_extract:
 * `{minLength:2,maxLength:2}`, novada_proxy: `{pattern:"^[a-zA-Z]{2}$"}`, novada_browser_flow:
 * `{default:"",pattern:"^[a-zA-Z]{0,2}$"}`) — these are cosmetic refinements of the SAME
 * conceptual shape ("a string"), not the record-value-type / tuple-member-order /
 * union-member-shape divergence this suite exists to catch. Every tool param also carries a
 * `.describe()`-generated `description` string that is, by construction, almost never
 * byte-identical across tools — including it would make virtually every shared param name
 * "collide", defeating the entire point of comparing shape. This matches round 1's existing,
 * tested design (which never captured these fields either); round 2 widens completeness only
 * on the schema-COMPOSITION axis (the Applicator vocabulary above), not on this axis.
 */
function normalizeSchemaForShape(schema: unknown, depth: number): unknown {
  // Depth guard FIRST, before any property access — order matters here: checking depth before
  // touching `schema` means a pathological/cyclic structure can never cause unbounded recursion
  // regardless of what shape it takes at the point the guard trips.
  if (depth > MAX_SHAPE_DEPTH) return "…depth-truncated…";
  // Explicit null check BEFORE the typeof check: `typeof null === "object"` in JS, so relying
  // on `typeof schema !== "object"` alone would let `null` fall through and crash on the very
  // next bracket-property access below. Order here is load-bearing, not stylistic.
  if (schema === null || schema === undefined) return null;
  // JSON-Schema boolean nodes (`true`/`false`, e.g. `additionalProperties: false`) are valid,
  // meaningful schemas ("always valid" / "never valid") in their own right — pass through
  // as-is rather than falling into the object branch below (which would crash on a primitive).
  if (typeof schema === "boolean") return schema;
  if (typeof schema !== "object") return null;
  if (Array.isArray(schema)) {
    // A bare array should never reach here as a top-level schema node (JSON-Schema nodes are
    // always objects or booleans) — but stay defensive rather than crash if one ever does, by
    // normalizing element-wise with no sort (unknown context = preserve order).
    return schema.map((el) => normalizeSchemaForShape(el, depth + 1));
  }

  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // The four Validation-vocabulary keywords that DO carry shape information (unlike the
  // refinement/annotation keywords excluded per the scope-boundary comment above). Always
  // assigned (possibly `undefined`, dropped by JSON.stringify) so every normalized node has a
  // stable, predictable base regardless of which of the four the source schema declares.
  out["type"] = s["type"];
  out["const"] = "const" in s ? JSON.stringify(s["const"]) : undefined;
  out["enum"] = Array.isArray(s["enum"]) ? [...s["enum"]].map((v) => JSON.stringify(v)).sort() : undefined;
  out["required"] = Array.isArray(s["required"]) ? [...s["required"]].map(String).sort() : undefined;

  // GAP D/E FIX — generic recursion over the FULL Applicator vocabulary (see constants above),
  // not the round-1 5-keyword hand-pick. Iterating ALL of the schema's own keys (sorted, for
  // stable output regardless of source declaration order) and dispatching purely on WHICH
  // bucket a key falls into — never on "did we remember to list this one" — is what makes this
  // complete by construction: any key not in one of the four Sets above is silently skipped
  // (annotation/validation-refinement noise, or a not-yet-invented keyword outside the closed
  // Applicator vocabulary), and every key that IS in one of the four Sets is unconditionally
  // recursed into.
  for (const key of Object.keys(s).sort()) {
    if (SCHEMA_DICT_KEYS.has(key)) {
      const raw = s[key];
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const dict: Record<string, unknown> = {};
        for (const name of Object.keys(raw as Record<string, unknown>).sort()) {
          dict[name] = normalizeSchemaForShape((raw as Record<string, unknown>)[name], depth + 1);
        }
        out[key] = dict;
      }
      continue;
    }
    if (SCHEMA_SINGLE_KEYS.has(key)) {
      out[key] = normalizeSchemaForShape(s[key], depth + 1);
      continue;
    }
    if (SCHEMA_ORDERED_ARRAY_KEYS.has(key)) {
      const raw = s[key];
      if (Array.isArray(raw)) {
        out[key] = raw.map((member) => normalizeSchemaForShape(member, depth + 1)); // order preserved — tuple positions are meaningful
      }
      continue;
    }
    if (SCHEMA_UNORDERED_ARRAY_KEYS.has(key)) {
      const raw = s[key];
      if (Array.isArray(raw)) {
        const normalized = raw.map((member) => normalizeSchemaForShape(member, depth + 1));
        // GAP F FIX: sort so a cosmetic member reorder never changes the resulting shape
        // string — order carries no meaning for anyOf/oneOf/allOf per the JSON-Schema spec.
        out[key] = [...normalized].sort((a, b) => {
          const ja = JSON.stringify(a) ?? "";
          const jb = JSON.stringify(b) ?? "";
          return ja < jb ? -1 : ja > jb ? 1 : 0;
        });
      }
      continue;
    }
    // Anything else — format/pattern/minLength/description/default/... — is intentionally
    // dropped; see the scope-boundary comment above.
  }

  return out;
}

function paramShape(schema: unknown): string | null {
  if (!schema || typeof schema !== "object") return null;
  return JSON.stringify(normalizeSchemaForShape(schema, 0));
}

function scanParamCollisions(
  tools: readonly MinimalTool[],
  expectedSharedByName: ReadonlyMap<string, ReadonlySet<string>>,
): ParamCollision[] {
  const collisions: ParamCollision[] = [];
  for (let i = 0; i < tools.length; i++) {
    for (let j = i + 1; j < tools.length; j++) {
      const a = tools[i]!;
      const b = tools[j]!;
      const aSchema = a.inputSchema as Record<string, unknown> | undefined;
      const bSchema = b.inputSchema as Record<string, unknown> | undefined;
      const aProps = (aSchema?.["properties"] as Record<string, unknown>) ?? {};
      const bProps = (bSchema?.["properties"] as Record<string, unknown>) ?? {};
      for (const paramName of Object.keys(aProps)) {
        if (!(paramName in bProps)) continue;
        const shapeA = paramShape(aProps[paramName]);
        const shapeB = paramShape(bProps[paramName]);
        if (shapeA === shapeB) continue;
        // GAP B FIX: a param name being "expected shared" no longer blanket-exempts it. It only
        // skips when EACH side's shape individually matches one of the specific, reviewed
        // variants recorded for that name. An undocumented shape on either side falls through
        // to the normal collision path below, exactly like any other divergence.
        const reviewed = expectedSharedByName.get(paramName);
        if (reviewed && shapeA !== null && shapeB !== null && reviewed.has(shapeA) && reviewed.has(shapeB)) {
          continue;
        }
        collisions.push({ param: paramName, toolA: a.name, shapeA, toolB: b.name, shapeB });
      }
    }
  }
  return collisions;
}

/**
 * GAP E FIX (generic $ref scan — replaces the round-1 items/properties/anyOf/oneOf/allOf
 * hand-list): looks for a `$ref` key ANYWHERE in the schema by walking every own key and every
 * array element UNCONDITIONALLY, rather than enumerating which keywords to look inside. This
 * mirrors `normalizeSchemaForShape`'s completeness fix exactly, and closes the same class of
 * live escape a round-2 red-team demonstrated: a `$ref` nested inside `additionalProperties`
 * or `prefixItems` (neither of which the round-1 hand-list ever inspected) reached an MCP
 * client's tools/list completely undetected. core.ts's zodToMcpSchema() strips `$defs`
 * unconditionally but does NOT resolve `$ref` pointers first, so any `$ref` surviving into the
 * final inputSchema is by construction dangling/unresolvable by an MCP client — and because
 * this function now visits every object value and every array element with no keyword
 * allowlist at all, a `$ref` can never again hide under a keyword this function forgot to
 * check.
 */
function findDanglingRefs(schema: unknown, depth = 0, path = "$"): string[] {
  if (depth > MAX_SHAPE_DEPTH) return [];
  if (schema === null || schema === undefined) return [];
  // Booleans (`true`/`false`) and other scalars can never carry a `$ref` — nothing to recurse.
  if (typeof schema !== "object") return [];

  if (Array.isArray(schema)) {
    return schema.flatMap((el, idx) => findDanglingRefs(el, depth + 1, `${path}[${idx}]`));
  }

  const s = schema as Record<string, unknown>;
  const found: string[] = [];
  if ("$ref" in s) {
    found.push(`${path}.$ref = ${JSON.stringify(s["$ref"])}`);
  }
  for (const key of Object.keys(s)) {
    if (key === "$ref") continue; // its value is the ref target string, not a nested schema
    found.push(...findDanglingRefs(s[key], depth + 1, `${path}.${key}`));
  }
  return found;
}

function scanSchemaValidity(tools: readonly MinimalTool[]): SchemaProblem[] {
  const problems: SchemaProblem[] = [];
  for (const tool of tools) {
    const s = tool.inputSchema as Record<string, unknown> | undefined;
    if (!s || typeof s !== "object") {
      problems.push({ tool: tool.name, issue: "inputSchema missing or not an object" });
      continue;
    }
    if (s["type"] !== "object") {
      problems.push({ tool: tool.name, issue: `inputSchema.type is '${String(s["type"])}', expected 'object'` });
    }
    const props = s["properties"];
    if (props !== undefined && (typeof props !== "object" || props === null || Array.isArray(props))) {
      problems.push({ tool: tool.name, issue: "inputSchema.properties is not an object" });
    }
    if (Array.isArray(s["required"])) {
      const propNames = new Set(
        props && typeof props === "object" && !Array.isArray(props) ? Object.keys(props as Record<string, unknown>) : [],
      );
      for (const req of s["required"] as unknown[]) {
        if (typeof req !== "string" || !propNames.has(req)) {
          problems.push({
            tool: tool.name,
            issue: `required[] references '${String(req)}' which is not in properties{} — MCP clients will reject or misvalidate this tool's calls`,
          });
        }
      }
    }
    // GAP C: dangling $ref check — see findDanglingRefs() doc comment.
    const danglingRefs = findDanglingRefs(s);
    if (danglingRefs.length > 0) {
      problems.push({
        tool: tool.name,
        issue: `inputSchema contains dangling $ref (unresolvable by MCP clients once $defs is stripped): ${danglingRefs.join(", ")}`,
      });
    }
  }
  return problems;
}

function scanNameCollisions(tools: readonly MinimalTool[]): NameProblem[] {
  const problems: NameProblem[] = [];
  const seen = new Map<string, string[]>();
  for (const tool of tools) {
    const normalized = tool.name.toLowerCase().replace(/_/g, "");
    const list = seen.get(normalized) ?? [];
    list.push(tool.name);
    seen.set(normalized, list);
  }
  for (const [normalized, names] of seen) {
    if (names.length > 1) {
      problems.push({ normalized, names, issue: "near-duplicate tool names (namespace collision risk)" });
    }
  }
  const rawNames = tools.map((t) => t.name);
  const dupeRaw = rawNames.filter((n, i) => rawNames.indexOf(n) !== i);
  if (dupeRaw.length) {
    problems.push({ issue: "exact duplicate tool name(s) in TOOLS export", names: [...new Set(dupeRaw)] });
  }
  return problems;
}

// ─── Real registry checks ───────────────────────────────────────────────────

describe("collision matrix — real npm-package tool registry (src/core.ts TOOLS)", () => {
  it("sanity: TOOLS loaded a non-trivial real catalog", () => {
    // Not re-pinning the exact count here — discover.test.ts already owns that
    // canonical assertion (registry count is 23 and the README headline matches it).
    // Duplicating a hardcoded number in two files is exactly the drift this design
    // exists to prevent; this is a loose sanity floor only.
    expect(TOOLS.length).toBeGreaterThan(20);
    expect(TOOLS.map((t) => t.name)).toContain("novada_search");
  });

  it("HARD: every tool's inputSchema is structurally valid JSON Schema (incl. no dangling $ref)", () => {
    const problems = scanSchemaValidity(TOOLS);
    expect(
      problems,
      `schema-validity problems found (each corrupts tools/list for every MCP client):\n${JSON.stringify(problems, null, 2)}`,
    ).toEqual([]);
  });

  it("HARD: no exact or case/underscore-insensitive near-duplicate tool names", () => {
    const problems = scanNameCollisions(TOOLS);
    expect(
      problems,
      `name-collision problems found:\n${JSON.stringify(problems, null, 2)}`,
    ).toEqual([]);
  });

  describe("REVIEW (baseline-gated): param-name collisions with divergent shape (recursive)", () => {
    const baseline = loadBaseline();
    const expectedSharedByName = buildExpectedSharedMap(baseline.expectedSharedParams);
    const liveCollisions = scanParamCollisions(TOOLS, expectedSharedByName);
    const baselineSet = new Set(
      baseline.acceptedDivergentCollisions.map((e) =>
        baselineKey(e.param, e.tools[0], paramShape(e.shapes[0]), e.tools[1], paramShape(e.shapes[1])),
      ),
    );

    it("every divergent param collision found today is in the reviewed baseline", () => {
      const unbaselined = liveCollisions.filter(
        (c) => !baselineSet.has(baselineKey(c.param, c.toolA, c.shapeA, c.toolB, c.shapeB)),
      );
      expect(
        unbaselined,
        `NEW, unreviewed param-shape collision(s) — either fix the schema divergence or add a ` +
          `reviewed entry to collision-matrix.baseline.json with a rationale:\n${JSON.stringify(unbaselined, null, 2)}`,
      ).toEqual([]);
    });

    it("the baseline is not stale: every accepted entry still reproduces on the live registry", () => {
      // Guards the baseline itself — if a schema change makes a previously-divergent pair
      // agree (or one tool loses the param, or either side's shape drifts even slightly —
      // GAP B's whole point), the "accepted" entry no longer describes reality and should be
      // removed or updated, not left as silent dead weight.
      const liveKeys = new Set(liveCollisions.map((c) => baselineKey(c.param, c.toolA, c.shapeA, c.toolB, c.shapeB)));
      const stale = baseline.acceptedDivergentCollisions.filter(
        (e) => !liveKeys.has(baselineKey(e.param, e.tools[0], paramShape(e.shapes[0]), e.tools[1], paramShape(e.shapes[1]))),
      );
      expect(
        stale,
        `baseline entries that no longer reproduce against the live registry (remove or update them):\n${JSON.stringify(stale, null, 2)}`,
      ).toEqual([]);
    });

    it("documents today's 129 accepted collisions (pinned so a silent baseline edit is visible)", () => {
      // Not a behavior assertion — a drift guard on the baseline file's own size, matching
      // the house style of pinning headline counts (see discover.test.ts's registry-count test).
      // Was 9 before the red-team GAP A fix, 10 after it, 11 after the novada_scrape vs
      // novada_scrape_amazon "operation" divergence (Tools-v2 Option B scaffold); 24 added the 13
      // new "operation" divergences from the Tools-v2 search-engine platform-scraper pass
      // (novada_scrape_google/bing/duckduckgo/yandex). 64 added 40 more from the Tools-v2
      // SOCIAL/VIDEO platform-scraper pass (novada_scrape_youtube/instagram/facebook/tiktok/x,
      // 2026-07-20) — every pair, among the then-eleven tools that declare an "operation" param,
      // whose closed enums actually differ: 6 (existing family) x 5 (new family) + C(5,2) (new
      // family pairwise) = 30 + 10 = 40. 129 adds 65 more from the Tools-v2 FINAL
      // platform-scraper pass (novada_scrape_walmart/shein/linkedin/github/perplexity,
      // 2026-07-20) — every pair, among the now-sixteen "operation"-bearing tools, whose closed
      // enums differ: 11 (existing family) x 5 (new family) + C(5,2) (new family pairwise) =
      // 55 + 10 = 65. NOTE: novada_scrape_duckduckgo vs novada_scrape_yandex is NOT among these:
      // both tools have a single-value enum of exactly ["web_search"] — an IDENTICAL shape, so
      // the live scan never even flags it as a collision (scanParamCollisions skips
      // shapeA === shapeB before the baseline check runs) — see each new entry's note for the
      // reviewed rationale.
      expect(
        baseline.acceptedDivergentCollisions.length,
        "collision-matrix.baseline.json's accepted-collision count changed — update this pinned count " +
          "and confirm each new/removed entry went through reviewer sign-off",
      ).toBe(129);
    });

    it("documents today's 18 reviewed shared-param shape variants (pinned so silent growth is visible)", () => {
      // Same drift-visibility guarantee as the count above, applied to expectedSharedParams —
      // this is the GAP B mechanism a "bare name" list used to bypass entirely. 13 names, 18
      // total reviewed variants (url:2, format:5, the other 11 names:1 each).
      const totalVariants = baseline.expectedSharedParams.reduce((sum, e) => sum + e.reviewedShapes.length, 0);
      expect(
        totalVariants,
        "collision-matrix.baseline.json's total reviewed shared-param shape-variant count changed — " +
          "confirm the new/removed variant went through reviewer sign-off",
      ).toBe(18);
    });
  });
});

// ─── Self-check: proves the three detectors — and the two red-team hardening fixes — are ──
// ─── not inert ──────────────────────────────────────────────────────────────────────────────
//
// Synthetic fixtures ONLY — never touches the real TOOLS export or any source file.

describe("collision-matrix self-check (synthetic fixtures — proves the detectors are not inert)", () => {
  it("HARD schema check flags a malformed inputSchema (wrong type + undeclared required[] entry)", () => {
    const scratch: MinimalTool[] = [
      {
        name: "zz_scratch_malformed_tool",
        inputSchema: {
          type: "strong", // WRONG: must be "object"
          properties: { foo: { type: "string" } },
          required: ["foo", "bar"], // "bar" is not declared in properties
        },
      },
    ];
    const problems = scanSchemaValidity(scratch);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.issue.includes("expected 'object'"))).toBe(true);
    expect(problems.some((p) => p.issue.includes("'bar'"))).toBe(true);
  });

  it("HARD schema check accepts a well-formed inputSchema (no false positive)", () => {
    const scratch: MinimalTool[] = [
      {
        name: "zz_scratch_ok_tool",
        inputSchema: { type: "object", properties: { foo: { type: "string" } }, required: ["foo"] },
      },
    ];
    expect(scanSchemaValidity(scratch)).toEqual([]);
  });

  it("HARD name check flags an exact duplicate and a case/underscore-insensitive near-duplicate", () => {
    const scratch: MinimalTool[] = [
      { name: "zz_scratch_dup", inputSchema: { type: "object", properties: {} } },
      { name: "zz_scratch_dup", inputSchema: { type: "object", properties: {} } }, // exact dup
      { name: "ZZ_Scratchdup", inputSchema: { type: "object", properties: {} } }, // near-dup (case + underscore)
    ];
    const problems = scanNameCollisions(scratch);
    expect(problems.some((p) => p.issue.includes("exact duplicate"))).toBe(true);
    expect(problems.some((p) => p.issue.includes("near-duplicate"))).toBe(true);
  });

  it("HARD name check accepts distinct, non-similar names (no false positive)", () => {
    const scratch: MinimalTool[] = [
      { name: "zz_scratch_alpha", inputSchema: { type: "object", properties: {} } },
      { name: "zz_scratch_beta", inputSchema: { type: "object", properties: {} } },
    ];
    expect(scanNameCollisions(scratch)).toEqual([]);
  });

  it("REVIEW advisory catches a brand-new divergent shared param (concrete example of what trips the gate)", () => {
    // Two fake tools share a param name never seen in the real registry ("scratch_mode"),
    // with genuinely divergent shapes (enum-of-strings vs boolean) — the same class of bug
    // as the real product/status/action collisions, but guaranteed absent from the baseline.
    const scratch: MinimalTool[] = [
      {
        name: "zz_scratch_tool_a",
        inputSchema: { type: "object", properties: { scratch_mode: { type: "string", enum: ["fast", "slow"] } } },
      },
      {
        name: "zz_scratch_tool_b",
        inputSchema: { type: "object", properties: { scratch_mode: { type: "boolean" } } },
      },
    ];
    const baseline = loadBaseline();
    const expectedSharedByName = buildExpectedSharedMap(baseline.expectedSharedParams);
    const collisions = scanParamCollisions(scratch, expectedSharedByName);

    expect(collisions.length).toBe(1);
    expect(collisions[0]!.param).toBe("scratch_mode");

    // The concrete proof: this synthetic collision is NOT in the reviewed baseline, so if it
    // appeared on the real registry the "every live collision is baselined" test above would
    // fail the suite until a human reviews and adds it (or fixes the schema).
    const baselineSet = new Set(
      baseline.acceptedDivergentCollisions.map((e) =>
        baselineKey(e.param, e.tools[0], paramShape(e.shapes[0]), e.tools[1], paramShape(e.shapes[1])),
      ),
    );
    const isBaselined = baselineSet.has(baselineKey(collisions[0]!.param, collisions[0]!.toolA, collisions[0]!.shapeA, collisions[0]!.toolB, collisions[0]!.shapeB));
    expect(isBaselined, "synthetic collision must NOT be pre-baselined — it is proving the un-baselined path").toBe(false);
  });

  // ── GAP A regression fixture ──────────────────────────────────────────────────────────
  it("GAP A FIX: recursive paramShape distinguishes shapes that differ ONLY inside array items / union members / nested props", () => {
    // Mirrors the real novada_browser vs novada_browser_flow "actions" collision structurally:
    // both params are top-level `array`, but the array ITEMS diverge — one is a union of
    // object variants keyed by a `const` discriminator, the other is a flat object with an
    // `enum` field. Under the OLD top-level-only paramShape (type+enum), both of these would
    // hash to the exact same `{"type":"array","enum":undefined}` and never be flagged.
    const scratch: MinimalTool[] = [
      {
        name: "zz_scratch_recursive_a",
        inputSchema: {
          type: "object",
          properties: {
            widget: {
              type: "array",
              items: {
                oneOf: [
                  { type: "object", properties: { kind: { type: "string", const: "alpha" }, count: { type: "number" } }, required: ["kind", "count"] },
                  { type: "object", properties: { kind: { type: "string", const: "beta" } }, required: ["kind"] },
                ],
              },
            },
          },
        },
      },
      {
        name: "zz_scratch_recursive_b",
        inputSchema: {
          type: "object",
          properties: {
            widget: {
              type: "array",
              items: {
                type: "object",
                properties: { mode: { type: "string", enum: ["fast", "slow"] } },
                required: ["mode"],
              },
            },
          },
        },
      },
    ];

    // Proves the OLD bug would have existed: a top-level-only {type, enum} view of "widget"
    // is identical on both sides (both are just a bare array with no top-level enum).
    const legacyTopLevelShape = (schema: unknown) => {
      const s = schema as Record<string, unknown>;
      return JSON.stringify({ type: s["type"], enum: undefined });
    };
    const widgetA = (scratch[0]!.inputSchema as { properties: { widget: unknown } }).properties.widget;
    const widgetB = (scratch[1]!.inputSchema as { properties: { widget: unknown } }).properties.widget;
    expect(legacyTopLevelShape(widgetA)).toBe(legacyTopLevelShape(widgetB));

    // The NEW recursive paramShape must tell them apart...
    expect(paramShape(widgetA)).not.toBe(paramShape(widgetB));

    // ...and scanParamCollisions must actually flag the pair as a result.
    const collisions = scanParamCollisions(scratch, new Map());
    expect(collisions.length).toBe(1);
    expect(collisions[0]!.param).toBe("widget");
  });

  it("recursive paramShape does NOT flag two params that are structurally identical, even nested", () => {
    // No-false-positive companion to the GAP A fixture above.
    const scratch: MinimalTool[] = [
      {
        name: "zz_scratch_identical_a",
        inputSchema: {
          type: "object",
          properties: { widget: { type: "array", items: { type: "object", properties: { mode: { type: "string", enum: ["fast", "slow"] } }, required: ["mode"] } } },
        },
      },
      {
        name: "zz_scratch_identical_b",
        inputSchema: {
          type: "object",
          properties: { widget: { type: "array", items: { type: "object", properties: { mode: { type: "string", enum: ["slow", "fast"] } }, required: ["mode"] } } },
        },
      },
    ];
    // Enum order deliberately reversed on the second tool — shape comparison must be
    // order-independent (both normalize via a sorted enum), so this must NOT collide.
    expect(scanParamCollisions(scratch, new Map())).toEqual([]);
  });

  // ── GAP B regression fixtures ──────────────────────────────────────────────────────────
  it("GAP B FIX: mutating a baselined collision's shape busts the baseline key (forces re-review)", () => {
    // Uses the exact red-team repro against the REAL baseline entry: capture_apikey's
    // "action" enum gains a "wipe_all_keys" member. The re-shaped side must no longer produce
    // the same baselineKey as the recorded (get/reset-only) entry.
    const baseline = loadBaseline();
    const original = baseline.acceptedDivergentCollisions.find(
      (e) => e.param === "action" && e.tools.includes("novada_capture_apikey") && e.tools.includes("novada_static_ip_mgmt"),
    );
    expect(original, "expected the capture_apikey vs static_ip_mgmt 'action' baseline entry to exist").toBeTruthy();
    const [toolA, toolB] = original!.tools;
    const [shapeSchemaA, shapeSchemaB] = original!.shapes;

    const originalKey = baselineKey(original!.param, toolA, paramShape(shapeSchemaA), toolB, paramShape(shapeSchemaB));

    // Simulate the mutation: capture_apikey.action grows a new enum member.
    const mutatedSchemaA = {
      ...(shapeSchemaA as Record<string, unknown>),
      enum: [...((shapeSchemaA as Record<string, unknown>)["enum"] as unknown[]), "wipe_all_keys"],
    };
    const mutatedKey = baselineKey(original!.param, toolA, paramShape(mutatedSchemaA), toolB, paramShape(shapeSchemaB));

    expect(mutatedKey).not.toBe(originalKey);

    // And the mutated shape's key is (as expected) absent from the current baseline set —
    // meaning the suite's "every live collision is baselined" assertion would fail until a
    // human reviews and re-baselines it, exactly the re-review signal GAP B was missing.
    const baselineSet = new Set(
      baseline.acceptedDivergentCollisions.map((e) =>
        baselineKey(e.param, e.tools[0], paramShape(e.shapes[0]), e.tools[1], paramShape(e.shapes[1])),
      ),
    );
    expect(baselineSet.has(mutatedKey)).toBe(false);
  });

  it("GAP B FIX (expectedSharedParams): a documented 'shared' param name does NOT blanket-exempt an undocumented shape", () => {
    // "format" IS a documented expectedSharedParams name in the real baseline, but only with
    // 5 specific reviewed variants. A 6th, never-reviewed shape for "format" must still be
    // flagged — the name alone must not act as a blanket pass, unlike the pre-fix behavior.
    const scratch: MinimalTool[] = [
      { name: "zz_scratch_shared_a", inputSchema: { type: "object", properties: { format: { type: "string", enum: ["json", "markdown"] } } } },
      { name: "zz_scratch_shared_b", inputSchema: { type: "object", properties: { format: { type: "string", enum: ["xml"] } } } }, // undocumented variant
    ];
    const reviewed = new Map<string, Set<string>>([
      ["format", new Set([paramShape({ type: "string", enum: ["json", "markdown"] })!])], // only ONE reviewed variant recorded
    ]);
    const collisions = scanParamCollisions(scratch, reviewed);
    expect(collisions.length).toBe(1);
    expect(collisions[0]!.param).toBe("format");
  });

  it("expectedSharedParams DOES skip a pair when EACH side matches a distinct, individually-reviewed shape variant", () => {
    // Mirrors the real 'url' entry: two reviewed variants (plain string vs string-or-array),
    // genuinely divergent from each other, but each one is individually a known/reviewed shape
    // — so the pair is correctly skipped without ever exempting an unreviewed third shape.
    const shapeString = { type: "string" };
    const shapeArrayOrString = { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] };
    const scratch: MinimalTool[] = [
      { name: "zz_scratch_shared_c", inputSchema: { type: "object", properties: { url: shapeString } } },
      { name: "zz_scratch_shared_d", inputSchema: { type: "object", properties: { url: shapeArrayOrString } } },
    ];
    const reviewed = new Map<string, Set<string>>([
      ["url", new Set([paramShape(shapeString)!, paramShape(shapeArrayOrString)!])],
    ]);
    expect(scanParamCollisions(scratch, reviewed)).toEqual([]);
  });

  // ── GAP C regression fixture ───────────────────────────────────────────────────────────
  it("GAP C FIX: HARD schema check fails a tool whose inputSchema contains a dangling $ref", () => {
    // Simulates the zod v4 .meta({id}) scenario: a $ref survives into the final inputSchema
    // after core.ts's zodToMcpSchema() strips $defs, leaving it unresolvable. Covers both a
    // direct property $ref and one nested inside array items + anyOf, since findDanglingRefs
    // must recurse the same way paramShape does.
    const scratch: MinimalTool[] = [
      {
        name: "zz_scratch_dangling_ref_tool",
        inputSchema: {
          type: "object",
          properties: {
            foo: { $ref: "#/$defs/Foo" },
            bar: { type: "array", items: { anyOf: [{ $ref: "#/$defs/Bar" }, { type: "string" }] } },
          },
        },
      },
    ];
    const problems = scanSchemaValidity(scratch);
    expect(problems.length).toBeGreaterThan(0);
    const refProblem = problems.find((p) => p.tool === "zz_scratch_dangling_ref_tool" && p.issue.includes("$ref"));
    expect(refProblem, `expected a dangling-$ref problem, got:\n${JSON.stringify(problems, null, 2)}`).toBeTruthy();
    expect(refProblem!.issue).toContain("properties.foo");
    expect(refProblem!.issue).toContain("items.anyOf[0]");
  });

  it("HARD schema check does not flag a $ref-free schema (no false positive introduced by GAP C fix)", () => {
    const scratch: MinimalTool[] = [
      { name: "zz_scratch_no_ref_tool", inputSchema: { type: "object", properties: { foo: { type: "string" } } } },
    ];
    expect(scanSchemaValidity(scratch)).toEqual([]);
  });

  // ── ROUND 2 regression fixtures (2026-07-19) — one per red-team-demonstrated live gap ────
  // GAP D — additionalProperties-divergent records were structurally invisible.
  it("GAP D FIX: additionalProperties-divergent records (numeric-valued vs free-form) are now flagged as a collision", () => {
    // Mirrors the real zod `z.record(z.string(), X)` shape used by novada_scrape.params:
    // {type:"object", propertyNames:{...}, additionalProperties:<value schema>}. The round-1
    // normalizer never looked at additionalProperties/propertyNames at all, so a numeric-valued
    // record (z.record(z.string(), z.number())) and a free-form record
    // (z.record(z.string(), z.unknown()) -> additionalProperties:{}) both collapsed to the
    // exact same {"type":"object"} shape — this is the round-2 red-team's live repro.
    const scratch: MinimalTool[] = [
      {
        name: "zz_scratch_record_numeric",
        inputSchema: {
          type: "object",
          properties: { data: { type: "object", propertyNames: { type: "string" }, additionalProperties: { type: "number" } } },
        },
      },
      {
        name: "zz_scratch_record_freeform",
        inputSchema: {
          type: "object",
          properties: { data: { type: "object", propertyNames: { type: "string" }, additionalProperties: {} } },
        },
      },
    ];
    const collisions = scanParamCollisions(scratch, new Map());
    expect(collisions.length).toBe(1);
    expect(collisions[0]!.param).toBe("data");
  });

  it("records with the SAME additionalProperties value-schema do NOT collide (no false positive from the GAP D fix)", () => {
    const scratch: MinimalTool[] = [
      {
        name: "zz_scratch_record_a",
        inputSchema: {
          type: "object",
          properties: { data: { type: "object", propertyNames: { type: "string" }, additionalProperties: { type: "number" } } },
        },
      },
      {
        name: "zz_scratch_record_b",
        inputSchema: {
          type: "object",
          properties: { data: { type: "object", propertyNames: { type: "string" }, additionalProperties: { type: "number" } } },
        },
      },
    ];
    expect(scanParamCollisions(scratch, new Map())).toEqual([]);
  });

  // GAP D (cont'd) — prefixItems (2020-12 tuple form) was likewise never walked.
  it("GAP D FIX: prefixItems-divergent tuples ([string,number] vs [number,string]) are distinguished", () => {
    const shapeA = { type: "array", prefixItems: [{ type: "string" }, { type: "number" }] };
    const shapeB = { type: "array", prefixItems: [{ type: "number" }, { type: "string" }] };
    // ORDER-SENSITIVE on purpose — this is the "ordered construct" half of the round-2 fix:
    // unlike enum/anyOf/oneOf/allOf (sorted, order-insensitive per GAP F), prefixItems POSITION
    // is meaningful (index 0 accepts a different concrete type than index 1), so these two
    // tuples must be told apart, never collapsed by an over-eager sort.
    expect(paramShape(shapeA)).not.toBe(paramShape(shapeB));

    const scratch: MinimalTool[] = [
      { name: "zz_scratch_tuple_a", inputSchema: { type: "object", properties: { pair: shapeA } } },
      { name: "zz_scratch_tuple_b", inputSchema: { type: "object", properties: { pair: shapeB } } },
    ];
    const collisions = scanParamCollisions(scratch, new Map());
    expect(collisions.length).toBe(1);
    expect(collisions[0]!.param).toBe("pair");
  });

  it("prefixItems tuples with the SAME member order do NOT collide (no false positive)", () => {
    const shapeA = { type: "array", prefixItems: [{ type: "string" }, { type: "number" }] };
    const shapeB = { type: "array", prefixItems: [{ type: "string" }, { type: "number" }] };
    expect(paramShape(shapeA)).toBe(paramShape(shapeB));
  });

  // GAP F — a cosmetic oneOf/anyOf/allOf member reorder was a false positive.
  it("GAP F FIX: reordering oneOf/anyOf/allOf members does NOT trip the collision detector (false-positive fix)", () => {
    const memberAlpha = { type: "object", properties: { kind: { type: "string", const: "alpha" } }, required: ["kind"] };
    const memberBeta = { type: "object", properties: { kind: { type: "string", const: "beta" } }, required: ["kind"] };
    const shapeOrderAB = { oneOf: [memberAlpha, memberBeta] };
    const shapeOrderBA = { oneOf: [memberBeta, memberAlpha] }; // cosmetic reorder only — same set of alternatives
    expect(paramShape(shapeOrderAB)).toBe(paramShape(shapeOrderBA));

    const scratch: MinimalTool[] = [
      { name: "zz_scratch_reorder_a", inputSchema: { type: "object", properties: { kind_union: shapeOrderAB } } },
      { name: "zz_scratch_reorder_b", inputSchema: { type: "object", properties: { kind_union: shapeOrderBA } } },
    ];
    expect(scanParamCollisions(scratch, new Map())).toEqual([]);
  });

  it("oneOf members that genuinely differ (not just reordered) still collide (no false negative introduced by the GAP F sort)", () => {
    const memberAlpha = { type: "object", properties: { kind: { type: "string", const: "alpha" } }, required: ["kind"] };
    const memberBeta = { type: "object", properties: { kind: { type: "string", const: "beta" } }, required: ["kind"] };
    const memberGamma = { type: "object", properties: { kind: { type: "string", const: "gamma" } }, required: ["kind"] };
    const scratch: MinimalTool[] = [
      { name: "zz_scratch_genuine_a", inputSchema: { type: "object", properties: { kind_union: { oneOf: [memberAlpha, memberBeta] } } } },
      { name: "zz_scratch_genuine_b", inputSchema: { type: "object", properties: { kind_union: { oneOf: [memberAlpha, memberGamma] } } } },
    ];
    const collisions = scanParamCollisions(scratch, new Map());
    expect(collisions.length).toBe(1);
    expect(collisions[0]!.param).toBe("kind_union");
  });

  // GAP E — a $ref nested inside additionalProperties or prefixItems escaped detection.
  it("GAP E FIX: HARD schema check fails when $ref is nested inside additionalProperties (round-2 live escape)", () => {
    const scratch: MinimalTool[] = [
      {
        name: "zz_scratch_ref_in_additional_props",
        inputSchema: {
          type: "object",
          properties: {
            data: { type: "object", additionalProperties: { $ref: "#/$defs/Foo" } },
          },
        },
      },
    ];
    const problems = scanSchemaValidity(scratch);
    const refProblem = problems.find((p) => p.tool === "zz_scratch_ref_in_additional_props" && p.issue.includes("$ref"));
    expect(refProblem, `expected a dangling-$ref problem, got:\n${JSON.stringify(problems, null, 2)}`).toBeTruthy();
    expect(refProblem!.issue).toContain("properties.data.additionalProperties");
  });

  it("GAP E FIX: HARD schema check fails when $ref is nested inside prefixItems (round-2 live escape)", () => {
    const scratch: MinimalTool[] = [
      {
        name: "zz_scratch_ref_in_prefixitems",
        inputSchema: {
          type: "object",
          properties: {
            pair: { type: "array", prefixItems: [{ $ref: "#/$defs/Foo" }, { type: "number" }] },
          },
        },
      },
    ];
    const problems = scanSchemaValidity(scratch);
    const refProblem = problems.find((p) => p.tool === "zz_scratch_ref_in_prefixitems" && p.issue.includes("$ref"));
    expect(refProblem, `expected a dangling-$ref problem, got:\n${JSON.stringify(problems, null, 2)}`).toBeTruthy();
    expect(refProblem!.issue).toContain("properties.pair.prefixItems[0]");
  });

  // ── Error-path safety ──────────────────────────────────────────────────────────────────
  it("paramShape does not crash on a schema with neither type, enum, nor anyOf/oneOf/allOf/items/properties", () => {
    expect(() => paramShape({})).not.toThrow();
    expect(paramShape({})).toBe(JSON.stringify({ type: undefined, enum: undefined, const: undefined, required: undefined, items: undefined, properties: undefined, anyOf: undefined, oneOf: undefined, allOf: undefined }));
  });

  it("paramShape does not crash on null, undefined, or non-object schema nodes (top-level or nested)", () => {
    expect(paramShape(null)).toBeNull();
    expect(paramShape(undefined)).toBeNull();
    expect(paramShape("not-a-schema")).toBeNull();
    // A schema whose `items` is explicitly null must not crash the recursive walk either.
    expect(() => paramShape({ type: "array", items: null })).not.toThrow();
  });

  it("normalizeSchemaForShape/findDanglingRefs do not crash on a JSON-Schema boolean node (additionalProperties: true/false)", () => {
    // `true`/`false` are valid, meaningful JSON-Schema nodes ("always valid"/"never valid") —
    // a nested boolean must not be treated as an object and crash the property-access walk.
    expect(() => paramShape({ type: "object", additionalProperties: false })).not.toThrow();
    expect(() => paramShape({ type: "object", additionalProperties: true })).not.toThrow();
    expect(paramShape({ type: "object", additionalProperties: false })).not.toBe(paramShape({ type: "object", additionalProperties: true }));
    expect(() => findDanglingRefs({ type: "object", additionalProperties: false })).not.toThrow();
    expect(findDanglingRefs({ type: "object", additionalProperties: false })).toEqual([]);
  });

  it("paramShape and findDanglingRefs do not crash on a $ref-only object (no other keywords)", () => {
    const refOnly = { $ref: "#/$defs/Foo" };
    expect(() => paramShape(refOnly)).not.toThrow();
    expect(() => findDanglingRefs(refOnly)).not.toThrow();
    expect(findDanglingRefs(refOnly)).toEqual([`$.$ref = "#/$defs/Foo"`]);
  });
});
