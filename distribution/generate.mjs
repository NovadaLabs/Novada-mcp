#!/usr/bin/env node
// distribution/generate.mjs — regenerate every distribution-channel manifest's OWNED fields
// from distribution/listing.json (shared facts) + npm-package/package.json (version).
//
// Table-driven by design (brief-A invariant: "channels are rows in a table, never branches
// in code"): the ONLY per-manifest-format logic lives in the WRITERS lookup table below.
// Everything else — which row owns which field, what value to write — is read out of
// distribution/channels.json's rows[]. Adding a channel means adding a row + (if its format
// isn't json/yaml already) one WRITERS entry; it never means adding an `if (row.id === ...)`.
//
// Ownership model (see distribution/channels.json's $comment for the full field semantics):
//   - row.owned_fields lists the EXACT pointer/key strings (from version_field/name_field/
//     description_field) this script is allowed to WRITE. A field can appear in *_field for
//     VERIFICATION (distribution/check.mjs) without being in owned_fields — this script never
//     writes it, check.mjs still asserts it stays equal to listing.json.
//   - row.generated_by must be exactly "distribution/generate.mjs" for this script to touch
//     the row's file at all. npm-package/server.json's row (generated_by =
//     "npm-package/scripts/gen-server-json.mjs") is deliberately SKIPPED — regenerating it
//     here would duplicate (and could diverge from) that script's own semantics, which this
//     round's invariant forbids touching.
//
// --check: compute every write, report which files WOULD change (name + before/after for the
// owned fields only), write nothing, exit 1 if any row owned by this script has drifted.
// (no flag): compute every write, apply the ones that actually changed, exit 0.
//
// Also regenerates distribution/INSTALL.md — one install snippet per row, from
// row.install_snippet — using the exact same compute/--check/write path so a hand-edit to
// INSTALL.md is caught by the same "generated_clean" guard as any manifest.
//
// No dependencies. Node >= 20 builtins only.

import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve, basename } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");

const GENERATE_MJS_OWNER = "distribution/generate.mjs";

// ---------------------------------------------------------------------------------------
// RFC-6901-ish JSON Pointer get/set. Supports array indices ("/plugins/0/description").
// ---------------------------------------------------------------------------------------
function pointerSegments(pointer) {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`invalid JSON pointer (must start with "/"): ${JSON.stringify(pointer)}`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function getJsonPointer(obj, pointer) {
  let cur = obj;
  for (const seg of pointerSegments(pointer)) {
    if (cur == null) return undefined;
    cur = Array.isArray(cur) ? cur[Number(seg)] : cur[seg];
  }
  return cur;
}

function setJsonPointer(obj, pointer, value) {
  const segs = pointerSegments(pointer);
  if (segs.length === 0) throw new Error("cannot set the root (\"\") via JSON pointer");
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const next = Array.isArray(cur) ? cur[Number(seg)] : cur[seg];
    if (next == null) {
      throw new Error(`JSON pointer segment ${JSON.stringify(seg)} does not exist in target file (pointer ${pointer})`);
    }
    cur = next;
  }
  const last = segs[segs.length - 1];
  if (Array.isArray(cur)) cur[Number(last)] = value;
  else cur[last] = value;
}

// ---------------------------------------------------------------------------------------
// Minimal YAML top-level (column-0, unindented) key read/set — line-level, no dependency.
// Deliberately does NOT touch indented/nested keys (e.g. a tool's own `description:` line
// inside smithery.yaml's `tools:` array stays untouched because it has leading whitespace).
// ---------------------------------------------------------------------------------------
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getYamlTopLevelValue(src, key) {
  const re = new RegExp(`^${escapeRegExp(key)}:[ \\t]*(.*)$`, "m");
  const m = src.match(re);
  if (!m) return undefined;
  let v = m[1].trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return v;
}

function setYamlTopLevelString(src, key, value) {
  const re = new RegExp(`^(${escapeRegExp(key)}:)([ \\t]*)(.*)$`, "m");
  if (!re.test(src)) {
    throw new Error(`top-level YAML key ${JSON.stringify(key)} not found (column 0, unindented)`);
  }
  const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return src.replace(re, (_m, keyPart) => `${keyPart} "${escaped}"`);
}

// ---------------------------------------------------------------------------------------
// brief-I (2026-10-15, I1): minimal line-level YAML reader for ONE LEVEL of nesting under a
// top-level (column-0) key — e.g. smithery.yaml's `startCommand:` block. Shares the same
// "no dependency, line-level, deliberately narrow" style as getYamlTopLevelValue above;
// distribution/check.mjs's closed_shape check is this module's only caller.
// ---------------------------------------------------------------------------------------

/** Returns the direct child key names (in source order, duplicates preserved) found one
 *  indentation level below a top-level `topKey:` block, or null if `topKey:` itself isn't
 *  found. A line that isn't a `key:` mapping line at all (a YAML list item, or block-scalar
 *  BODY content belonging to an earlier sibling key) is never counted as a key; a `key:` line
 *  deeper than the block's own established indent (e.g. configSchema's own nested `type:`)
 *  is skipped, not treated as a second child. */
export function getYamlNestedKeys(src, topKey) {
  const lines = src.split("\n");
  const topRe = new RegExp(`^${escapeRegExp(topKey)}:[ \\t]*$`);
  const start = lines.findIndex((l) => topRe.test(l));
  if (start === -1) return null;
  const keys = [];
  let blockIndent = null;
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j];
    if (/^\s*$/.test(line)) continue; // blank lines never end or start a block
    const indentLen = line.match(/^(\s*)/)[1].length;
    if (indentLen === 0) break; // dedented back to column 0 -> topKey's block has ended
    const m = line.match(/^(\s*)([A-Za-z_][\w-]*):(.*)$/);
    if (!m) continue; // not a "key:" mapping line (list item, or a prior key's block-scalar body)
    const indent = m[1].length;
    if (blockIndent === null) blockIndent = indent; // first "key:" line sets this block's own indent
    if (indent !== blockIndent) continue; // nested deeper under some OTHER sibling's value
    keys.push(m[2]);
  }
  return keys;
}

/** Returns the SCALAR value of one direct child key one indentation level below a top-level
 *  `topKey:` block (see getYamlNestedKeys for the same traversal), or undefined if `topKey:`
 *  or `childKey:` isn't found there. Supports a single-line value ("type: stdio") and a block
 *  scalar ("commandFunction: |" or ">", optional "-"/"+" chomping indicator, followed by one or
 *  more deeper-indented lines) — joins the block-scalar body lines with "\n" after stripping
 *  their own common minimum leading indent, sufficient for this project's one real block-scalar
 *  field (smithery.yaml's single-line `commandFunction`). */
export function getYamlNestedScalar(src, topKey, childKey) {
  const lines = src.split("\n");
  const topRe = new RegExp(`^${escapeRegExp(topKey)}:[ \\t]*$`);
  const start = lines.findIndex((l) => topRe.test(l));
  if (start === -1) return undefined;
  let blockIndent = null;
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j];
    if (/^\s*$/.test(line)) continue;
    const indentLen = line.match(/^(\s*)/)[1].length;
    if (indentLen === 0) break;
    const m = line.match(/^(\s*)([A-Za-z_][\w-]*):(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    if (blockIndent === null) blockIndent = indent;
    if (indent !== blockIndent) continue;
    const key = m[2];
    if (key !== childKey) continue;
    const rest = m[3].trim();
    if (/^[|>][+-]?$/.test(rest)) {
      const bodyLines = [];
      let bodyIndent = null;
      for (let k = j + 1; k < lines.length; k++) {
        const bl = lines[k];
        if (/^\s*$/.test(bl)) {
          bodyLines.push("");
          continue;
        }
        const bIndent = bl.match(/^(\s*)/)[1].length;
        if (bIndent <= indent) break;
        if (bodyIndent === null) bodyIndent = bIndent;
        bodyLines.push(bl.slice(bodyIndent));
      }
      while (bodyLines.length && bodyLines[bodyLines.length - 1] === "") bodyLines.pop();
      return bodyLines.join("\n");
    }
    let v = rest;
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
      v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return v;
  }
  return undefined;
}

/** Returns every column-0 key name found in `src` (duplicates preserved, source order) —
 *  the same scan yamlLooksValid's duplicate-key check uses, factored out so check.mjs's
 *  closed_shape check can reuse it for a YAML row's top-level ("") object path. */
export function getYamlTopLevelKeys(src) {
  const keys = [];
  for (const line of src.split("\n")) {
    const m = line.match(/^([A-Za-z_][\w-]*):/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

// ---------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------
export function loadInputs(root = ROOT) {
  const channels = JSON.parse(readFileSync(join(root, "distribution", "channels.json"), "utf8"));
  const listing = JSON.parse(readFileSync(join(root, "distribution", "listing.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(root, "npm-package", "package.json"), "utf8"));
  return { channels, listing, pkg };
}

/**
 * Loads npm-package/build/core.js's exported TOOLS, same module gen-server-json.mjs imports.
 * Only called if some row's owned_fields actually needs a derived tool list/count (none do
 * this round — see distribution/channels.json's per-row notes) — kept lazy so this script
 * does not impose a `npm run build` precondition on channels that don't need it.
 */
export async function loadCoreTools(root = ROOT) {
  const corePath = join(root, "npm-package", "build", "core.js");
  if (!existsSync(corePath)) {
    const err = new Error(
      `npm-package/build/core.js not found — a row needs the derived tool list/count, but the ` +
        `TypeScript build has not run.`
    );
    err.agent_instruction = "run `npm run build` in npm-package/, then re-run distribution/generate.mjs";
    throw err;
  }
  const mod = await import(pathToFileURL(corePath).href);
  return mod.TOOLS;
}

// ---------------------------------------------------------------------------------------
// Per-row owned-value resolution — the ONLY place that maps version/name/description onto a
// row's actual owned fields. No per-channel special-casing: any row that lists version_field
// in owned_fields gets the version written there, same for name_field/description_field.
// ---------------------------------------------------------------------------------------
function resolveName(row, listing) {
  return row.name_override?.value ?? listing.name;
}

export function ownedValuesFor(row, listing, version) {
  const owned = new Set(row.owned_fields ?? []);
  const values = {};
  if (row.version_field && owned.has(row.version_field)) values[row.version_field] = version;
  if (row.name_field && owned.has(row.name_field)) values[row.name_field] = resolveName(row, listing);
  if (row.description_field && owned.has(row.description_field)) values[row.description_field] = listing.description;
  // brief-F R1: a row's url_field (the channel's hosted MCP endpoint) is only WRITTEN here when
  // it is also declared owned — e.g. npm-package/server.json's row sets url_field but omits it
  // from owned_fields, so check.mjs's endpoint_equal still verifies it without this script ever
  // writing into a file gen-server-json.mjs alone owns.
  if (row.url_field && owned.has(row.url_field)) values[row.url_field] = listing.hosted_endpoint;
  return values;
}

// ---------------------------------------------------------------------------------------
// brief-I (2026-10-15, I1): "json-full" template resolution — the complete-object rebuild for
// a row whose file is FULLY determined by this generator (distribution/channels.json's
// $comment explains the two-tier closed-shape design this implements). Unlike WRITERS below
// (which parse-and-merge the EXISTING file, so an injected/extra key round-trips untouched),
// this NEVER reads the existing file's structure at all — it builds a brand-new object purely
// from `full_template` + listing.json + the package version, so any key the template doesn't
// name (injected or otherwise) simply isn't present in the rebuild, and generated_clean's
// exact-text diff against the committed file catches the discrepancy.
// ---------------------------------------------------------------------------------------
const FULL_TEMPLATE_PLACEHOLDER_RE = /^\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}$/;

function resolveFullTemplatePlaceholder(token, { row, listing, version }) {
  if (token === "version") return version;
  if (token === "name") return resolveName(row, listing);
  if (Object.prototype.hasOwnProperty.call(listing, token)) return listing[token];
  throw new Error(
    `row ${row.id}'s full_template placeholder {{${token}}} does not resolve — it is neither "version"/"name" nor a top-level distribution/listing.json field`
  );
}

/** Recursively resolves one full_template tree. A string matching exactly `{{token}}`
 *  resolves via resolveFullTemplatePlaceholder; every other string (and every number/boolean/
 *  null/array/object) is a LITERAL, copied through as-is (arrays/objects are walked so a
 *  placeholder can appear anywhere inside a nested structure, e.g. gemini-cli's
 *  `mcpServers.novada.httpUrl`). */
export function resolveFullTemplateValue(node, ctx) {
  if (typeof node === "string") {
    const m = node.match(FULL_TEMPLATE_PLACEHOLDER_RE);
    return m ? resolveFullTemplatePlaceholder(m[1], ctx) : node;
  }
  if (Array.isArray(node)) return node.map((el) => resolveFullTemplateValue(el, ctx));
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = resolveFullTemplateValue(v, ctx);
    return out;
  }
  return node;
}

// ---------------------------------------------------------------------------------------
// brief-K (2026-10-15, K1 CRITICAL): a partial-EMBEDDING sibling of resolveFullTemplateValue's
// exact-whole-string {{token}} match. full_template requires a leaf to be EXACTLY "{{token}}"
// (nothing else in the string) because it is producing a brand-new field value from scratch;
// a `pinned_fields_template` value (distribution/check.mjs's closed_shape check) is instead
// DERIVING the expected literal for an existing hand-authored field that legitimately embeds a
// placeholder inside a larger literal — e.g. marketplace.json's `plugins[0].source.url` is
// `listing.repository + ".git"` (the file's own existing suffix convention), not `repository`
// alone. Resolves every "{{token}}" occurrence in the string (global match, any position) against
// "version" or any top-level distribution/listing.json field; "name" is deliberately NOT a
// supported token here (unlike resolveFullTemplatePlaceholder) — this function derives a
// CANONICAL VALUE TO VERIFY AGAINST at check time, not a row-authored field to WRITE, so
// `row.name_override` has no meaning in this context. An unresolvable token throws loudly, same
// posture as resolveFullTemplatePlaceholder, so a typo'd placeholder fails this row's own config
// parsing instead of silently comparing against the literal string "{{token}}".
// ---------------------------------------------------------------------------------------
const TEMPLATE_STRING_PLACEHOLDER_RE = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

export function resolveTemplateString(template, { listing, version }) {
  return template.replace(TEMPLATE_STRING_PLACEHOLDER_RE, (_match, token) => {
    if (token === "version") return version;
    if (Object.prototype.hasOwnProperty.call(listing, token)) return String(listing[token]);
    throw new Error(
      `template placeholder {{${token}}} does not resolve — it is neither "version" nor a top-level distribution/listing.json field`
    );
  });
}

// ---------------------------------------------------------------------------------------
// WRITERS — the only per-manifest-FORMAT logic (not per-channel). Each writer takes the
// existing file's raw text + a {pointerOrKey: value} map and returns the new raw text.
// "json-full" rows do NOT go through this table (see computeWrites) because they do not
// take a {pointerOrKey: value} partial-update map at all — they rebuild the whole object.
// ---------------------------------------------------------------------------------------
export const WRITERS = {
  "json-owned-fields": (rawText, values) => {
    const obj = JSON.parse(rawText);
    for (const [ptr, val] of Object.entries(values)) setJsonPointer(obj, ptr, val);
    return JSON.stringify(obj, null, 2) + "\n";
  },
  "yaml-owned-fields": (rawText, values) => {
    let next = rawText;
    for (const [key, val] of Object.entries(values)) {
      if (key.startsWith("/")) {
        throw new Error(`yaml-owned-fields writer received a JSON-pointer-shaped key ${JSON.stringify(key)} — yaml fields must be bare top-level keys`);
      }
      next = setYamlTopLevelString(next, key, val);
    }
    return next;
  },
};

// ---------------------------------------------------------------------------------------
// brief-J (2026-10-15, J1 CRITICAL): whole-file tamper evidence for every closed_shape row —
// the class fix replacing "allowlist of individual keys/paths someone thought of" (which three
// red-team rounds kept finding new holes in: an injected ARRAY ELEMENT, not just an injected
// key; a change NESTED deeper than closed_shape's own declared path depth) with "hash of
// everything else in the file". closed_shape + pinned_fields stay in place as readable,
// defense-in-depth intent (a reviewer can see what's allowed without computing a hash by hand);
// distribution/check.mjs's new tamper_evident check is the generic backstop that does not
// require anyone to have enumerated the attack shape in advance — any structural or value change
// outside the four independently-verified fields below changes the hash and fails.
// ---------------------------------------------------------------------------------------

/** A "closed_shape row" is a row declaring the hand-authored-file half of shape_declared's two
 *  mutually-exclusive mechanisms (the other being writer_kind "json-full", whose byte-exact
 *  generated_clean diff already gives it the same whole-file guarantee this function exists to
 *  add to closed_shape rows). Exported so check.mjs's tamper_evident uses the identical
 *  definition this module's own --repin CLI uses — never two copies of "which rows need a pin". */
export function isClosedShapeRow(row) {
  return !!(row.closed_shape && typeof row.closed_shape === "object" && Object.keys(row.closed_shape).length > 0);
}

function isYamlRelPath(relPath) {
  return /\.ya?ml$/i.test(relPath);
}

// Pointers/keys that legitimately change release-over-release (a version bump) or whenever the
// owner edits listing.json's shared name/description/hosted_endpoint — and are ALREADY
// independently verified by their own dedicated check (version_equal, legibility's name/
// description rules, endpoint_equal respectively). Stripped from the canonical form so a
// tamper_evident mismatch always means "something besides these four moved", never "the version
// bumped". Included even when VERIFY-ONLY (not in owned_fields) — e.g. server.json's version/
// name/description are gen-server-json.mjs's fields, not this script's, but they still change
// every release and are still independently verified elsewhere, so they are excluded from the
// hash input the same way a generate.mjs-owned field would be.
function derivedFieldPointersFor(row) {
  return [row.version_field, row.name_field, row.description_field, row.url_field].filter((f) => typeof f === "string");
}

/** Deletes one JSON-pointer-addressed key in place if (and only if) it currently resolves —
 *  silently a no-op for a pointer absent from THIS particular file (e.g. a row whose url_field
 *  doesn't apply to every one of its multiple paths). Unlike setJsonPointer (which THROWS on a
 *  missing intermediate segment, correct for a generator that is supposed to write a known-good
 *  field), this is deliberately tolerant: canonicalization must never fail just because one of
 *  the four derived fields happens not to exist in a given file. */
function deleteJsonPointerIfPresent(obj, pointer) {
  const segs = pointerSegments(pointer);
  if (segs.length === 0) return;
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const next = Array.isArray(cur) ? cur[Number(seg)] : cur[seg];
    if (next == null) return; // pointer doesn't resolve in this file — nothing to strip
    cur = next;
  }
  const last = segs[segs.length - 1];
  if (Array.isArray(cur)) delete cur[Number(last)];
  else delete cur[last];
}

/** Deterministic, sorted-key, pretty-printed JSON text. Stable across a key-REORDER (which
 *  carries no semantic meaning for tamper detection) but sensitive to every other structural or
 *  value change — including an array LENGTH change, or a change nested deeper than closed_shape's
 *  own declared path depth, neither of which closed_shape's key-allowlist check alone can see. */
export function stableStringify(value, indent = 0) {
  const pad = "  ".repeat(indent);
  const padIn = "  ".repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "[\n" + value.map((v) => padIn + stableStringify(v, indent + 1)).join(",\n") + "\n" + pad + "]";
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return "{}";
    return "{\n" + keys.map((k) => padIn + JSON.stringify(k) + ": " + stableStringify(value[k], indent + 1)).join(",\n") + "\n" + pad + "}";
  }
  return JSON.stringify(value);
}

const OWNED_LINE_PLACEHOLDER = "<<brief-J: verified elsewhere (version_equal/legibility/endpoint_equal) — excluded from this hash>>";

/** Returns the exact multi-line text this row's current on-disk file(s) hash to, with every
 *  version/name/description/url field VALUE neutralized (JSON: the pointer deleted from the
 *  parsed object before stable-sorted re-serialization; YAML: that bare top-level key's value
 *  replaced with a fixed placeholder via the existing setYamlTopLevelString writer — every other
 *  line, including comments, indentation, key order, and nested content, is left byte-identical).
 *  Multi-path rows concatenate each path's canonical text in row.path order, so this generalizes
 *  to a future multi-file closed_shape row with no new mechanism. Throws (does not silently
 *  return a partial result) if a path is missing or fails to parse — the caller decides how to
 *  report that (check.mjs's tamper_evident; this module's own --repin CLI). */
export function canonicalFormForRow(root, row) {
  const paths = Array.isArray(row.path) ? row.path : [row.path];
  const derived = derivedFieldPointersFor(row);
  const sections = paths.map((relPath) => {
    const abs = join(root, relPath);
    const raw = readFileSync(abs, "utf8");
    if (isYamlRelPath(relPath)) {
      let text = raw;
      for (const key of derived) {
        if (key.startsWith("/")) continue; // defensive: YAML *_field values are bare top-level keys, never JSON pointers
        if (getYamlTopLevelValue(text, key) === undefined) continue; // not present in this file — nothing to neutralize
        text = setYamlTopLevelString(text, key, OWNED_LINE_PLACEHOLDER);
      }
      return `# ${relPath}\n${text}`;
    }
    const obj = JSON.parse(raw);
    for (const pointer of derived) deleteJsonPointerIfPresent(obj, pointer);
    return `// ${relPath}\n${stableStringify(obj)}`;
  });
  return sections.join("\n\n");
}

export function computeRowPinnedHash(root, row) {
  return createHash("sha256").update(canonicalFormForRow(root, row), "utf8").digest("hex");
}

const PINNED_HASHES_RELPATH = "distribution/pinned-hashes.json";

/** `{ "<rowId>": { sha256, canonical } }` — a fully machine-maintained ledger, never hand-edited
 *  (same spirit as a package-lock.json): `sha256` is what distribution/check.mjs's tamper_evident
 *  check compares against; `canonical` (the exact text that hash commits to) exists ONLY so a
 *  future `--repin` can print a real diff against the PREVIOUSLY accepted content, not just two
 *  opaque hex strings. Returns {} (not a throw) when the file doesn't exist yet — the first
 *  `--repin` run on a fresh checkout establishes it. */
export function readPinnedHashes(root = ROOT) {
  const abs = join(root, PINNED_HASHES_RELPATH);
  if (!existsSync(abs)) return {};
  return JSON.parse(readFileSync(abs, "utf8"));
}

function writePinnedHashes(root, data) {
  const abs = join(root, PINNED_HASHES_RELPATH);
  writeFileSync(abs, JSON.stringify(data, null, 2) + "\n");
}

/** Minimal LCS-based line diff (no dependency) — "- " removed / "+ " added / "  " unchanged.
 *  Files this operates on (a row's canonical form) are at most a few hundred lines, so the O(n*m)
 *  DP table is trivial in practice. */
function diffLines(oldText, newText) {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push("  " + a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push("- " + a[i]);
      i++;
    } else {
      out.push("+ " + b[j]);
      j++;
    }
  }
  while (i < n) {
    out.push("- " + a[i]);
    i++;
  }
  while (j < m) {
    out.push("+ " + b[j]);
    j++;
  }
  return out;
}

/** Repins one row: computes its current canonical hash, prints old/new hash plus the exact diff
 *  of the hand-authored content being accepted (an empty "old" side on a first-ever pin, so the
 *  whole canonical form prints as additions — still an accurate, if long, "diff"), and mutates
 *  `pinned` in place. The caller persists `pinned` to disk once, after every requested row has
 *  been repinned (so `--repin` with no row id writes the sidecar file exactly once, not N times). */
export function repinRow(root, row, pinned) {
  const canonical = canonicalFormForRow(root, row);
  const newHash = createHash("sha256").update(canonical, "utf8").digest("hex");
  const prev = pinned[row.id];
  console.log(`[distribution/generate.mjs] --repin row=${row.id}`);
  console.log(`  old sha256: ${prev && typeof prev.sha256 === "string" ? prev.sha256 : "(none — first pin)"}`);
  console.log(`  new sha256: ${newHash}`);
  if (prev && prev.sha256 === newHash) {
    console.log("  no change — content already matches the pinned hash.");
  } else {
    console.log("  diff of accepted canonical content:");
    const oldText = prev && typeof prev.canonical === "string" ? prev.canonical : "";
    for (const line of diffLines(oldText, canonical)) console.log("    " + line);
  }
  pinned[row.id] = { sha256: newHash, canonical };
  return newHash;
}

/**
 * Computes every write distribution/generate.mjs owns, without touching disk (beyond
 * reading the existing files to diff against). Returns one entry per owned row PLUS one
 * synthetic entry for distribution/INSTALL.md.
 */
export function computeWrites(root = ROOT) {
  const { channels, listing, pkg } = loadInputs(root);
  const version = pkg.version;
  const writes = [];

  for (const row of channels.rows) {
    if (row.generated_by !== GENERATE_MJS_OWNER) continue; // e.g. mcp-registry (gen-server-json.mjs) or glama (nothing owned)

    if (row.writer_kind === "json-full") {
      // brief-I (2026-10-15, I1): complete-object rebuild, not a parse-and-merge of the
      // existing file — see resolveFullTemplateValue's own comment for why. `values` is left
      // empty for this write (there is no partial pointer:value map; the whole file IS the
      // owned unit), which checkGeneratedClean's existing "(file content)" fallback already
      // renders sensibly for a drift report.
      if (!row.full_template) {
        throw new Error(`row ${row.id} declares writer_kind "json-full" but has no full_template`);
      }
      const resolved = resolveFullTemplateValue(row.full_template, { row, listing, version });
      const newContent = JSON.stringify(resolved, null, 2) + "\n";
      const paths = Array.isArray(row.path) ? row.path : [row.path];
      for (const relPath of paths) {
        const filePath = join(root, relPath);
        const oldContent = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
        writes.push({ rowId: row.id, relPath, filePath, oldContent, newContent, changed: newContent !== oldContent, values: {} });
      }
      continue;
    }

    const writer = WRITERS[row.writer_kind];
    if (!writer) continue; // defensive: a row declared generated_by=generate.mjs but no writer_kind
    const values = ownedValuesFor(row, listing, version);
    if (Object.keys(values).length === 0) continue; // nothing this row actually owns to write

    const paths = Array.isArray(row.path) ? row.path : [row.path];
    for (const relPath of paths) {
      const filePath = join(root, relPath);
      const oldContent = readFileSync(filePath, "utf8");
      const newContent = writer(oldContent, values);
      writes.push({
        rowId: row.id,
        relPath,
        filePath,
        oldContent,
        newContent,
        changed: newContent !== oldContent,
        values,
      });
    }
  }

  writes.push(computeInstallMdWrite(root, channels));
  return writes;
}

// Table-driven, not per-channel: renders whichever of these optional row fields are present,
// in the same order, for every row uniformly. A row that doesn't set a field (none do, as of
// round 1 — audience/auth_summary were added brief-A2) simply renders one line fewer; there is
// no per-row branch here, only "if this row happens to have this field, show it."
function installRowDetails(row) {
  const lines = [];
  if (row.audience) lines.push(`- **Audience:** ${row.audience}`);
  if (row.auth_summary) lines.push(`- **Auth:** ${row.auth_summary}`);
  if (row.publish_mechanism) lines.push(`- **Publish / what the owner must still do:** ${row.publish_mechanism}`);
  return lines;
}

function installSnippetBlock(row) {
  const lines = [`### ${row.id}`, "", "```", row.install_snippet, "```", "", ...installRowDetails(row), ""];
  return lines.join("\n");
}

function computeInstallMdWrite(root, channels) {
  const relPath = "distribution/INSTALL.md";
  const filePath = join(root, relPath);
  const oldContent = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const header = [
    "<!-- GENERATED by distribution/generate.mjs — do not hand-edit. One block per",
    "     distribution/channels.json row: install_snippet, then (when the row sets them)",
    "     audience, auth_summary, and publish_mechanism — see distribution/channels.json's",
    "     $comment for exact field semantics; see distribution/README.md for what OAuth-first",
    "     means across every row. -->",
    "",
    "# Install novada-mcp",
    "",
  ].join("\n");
  const body = channels.rows.map(installSnippetBlock).join("\n");
  const newContent = `${header}\n${body}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  return { rowId: "__install_md__", relPath, filePath, oldContent, newContent, changed: newContent !== oldContent, values: {} };
}

/**
 * Applies (or, with checkOnly, merely reports) every computed write. Returns the same array
 * computeWrites() returns, so callers (including distribution/check.mjs's generated_clean
 * check) can inspect `.changed` per row without re-reading disk.
 */
export function generateAll(root = ROOT, { checkOnly = false } = {}) {
  const writes = computeWrites(root);
  if (!checkOnly) {
    for (const w of writes) {
      if (w.changed) writeFileSync(w.filePath, w.newContent);
    }
  }
  return writes;
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------
// isMain(): see distribution/check.mjs's identical function for the full rationale — a raw
// string comparison between process.argv[1] (unresolved, as the caller literally typed it)
// and import.meta.url (symlink-resolved by Node's ESM loader) silently returns false whenever
// the invocation path crosses a symlink (macOS's /tmp -> private/tmp, /var -> private/var, a
// symlinked checkout, a symlinked worktree, etc.), which makes the CLI block below never run
// and the process exit 0 with zero output — indistinguishable from "nothing needed writing".
// Found by an independent reviewer during brief-A2 (2026-10-15); fixed identically in both
// distribution/check.mjs and this file since both carried the exact same bug.
function isMain() {
  if (!process.argv[1]) return false;
  let invokedPath;
  try {
    invokedPath = realpathSync(resolve(process.argv[1]));
  } catch {
    invokedPath = resolve(process.argv[1]);
  }
  let selfPath;
  try {
    selfPath = realpathSync(fileURLToPath(import.meta.url));
  } catch {
    selfPath = fileURLToPath(import.meta.url);
  }
  if (invokedPath === selfPath) return true;
  return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

// Defense-in-depth twin of distribution/check.mjs's same-named function — see that file's
// comment. Only matches when argv[1]'s basename is literally "generate.mjs".
function looksLikeDirectInvocationButIsNotMain() {
  if (!process.argv[1] || isMain()) return false;
  return basename(resolve(process.argv[1])) === basename(fileURLToPath(import.meta.url));
}

if (isMain()) {
  // brief-J (2026-10-15, J1): `--repin [row-id]` establishes/updates the whole-file tamper-
  // evidence baseline distribution/check.mjs's tamper_evident check compares against. With no
  // row-id, repins every closed_shape row (the SOP's one-time "establish baselines from the
  // CURRENT reviewed content" step); with a row-id, repins just that row (the exact command
  // tamper_evident's own FAIL message prints as its fix hint). Runs before --check/write below
  // and always exits on its own — it never falls through into the normal generate/write path.
  const repinIdx = process.argv.indexOf("--repin");
  if (repinIdx !== -1) {
    const maybeId = process.argv[repinIdx + 1];
    const rowIdArg = maybeId && !maybeId.startsWith("-") ? maybeId : null;
    let channels;
    try {
      ({ channels } = loadInputs(ROOT));
    } catch (err) {
      console.error(`[distribution/generate.mjs] --repin: ERROR loading distribution/channels.json — ${err.message}`);
      process.exit(1);
    }
    const targets = channels.rows.filter((r) => isClosedShapeRow(r) && (!rowIdArg || r.id === rowIdArg));
    if (rowIdArg && targets.length === 0) {
      console.error(`[distribution/generate.mjs] --repin: no closed_shape row with id ${JSON.stringify(rowIdArg)} found in distribution/channels.json`);
      process.exit(1);
    }
    const pinned = readPinnedHashes(ROOT);
    try {
      for (const row of targets) repinRow(ROOT, row, pinned);
    } catch (err) {
      console.error(`[distribution/generate.mjs] --repin: ERROR — ${err.message}`);
      if (err.agent_instruction) console.error(`  agent_instruction: ${err.agent_instruction}`);
      process.exit(1);
    }
    writePinnedHashes(ROOT, pinned);
    console.log(`[distribution/generate.mjs] --repin: wrote ${PINNED_HASHES_RELPATH} (${targets.length} row${targets.length === 1 ? "" : "s"} repinned).`);
    process.exit(0);
  }

  const checkOnly = process.argv.includes("--check");
  let writes;
  try {
    writes = generateAll(ROOT, { checkOnly });
  } catch (err) {
    console.error(`[distribution/generate.mjs] ERROR: ${err.message}`);
    if (err.agent_instruction) console.error(`  agent_instruction: ${err.agent_instruction}`);
    process.exit(1);
  }

  const changed = writes.filter((w) => w.changed);
  if (checkOnly) {
    if (changed.length === 0) {
      console.log("[distribution/generate.mjs] --check: no drift — every generated manifest matches its owned-field values.");
      process.exit(0);
    }
    for (const w of changed) {
      console.error(`[distribution/generate.mjs] --check: DRIFT in ${w.relPath} (row ${w.rowId})`);
      for (const [field, val] of Object.entries(w.values)) {
        console.error(`    ${field} -> expected ${JSON.stringify(val)}`);
      }
    }
    process.exit(1);
  }

  for (const w of writes) {
    if (w.changed) console.log(`[distribution/generate.mjs] wrote ${w.relPath} (row ${w.rowId})`);
  }
  if (changed.length === 0) console.log("[distribution/generate.mjs] nothing to write — already up to date.");
} else if (looksLikeDirectInvocationButIsNotMain()) {
  console.error(
    `[distribution/generate.mjs] ERROR: process.argv[1] (${process.argv[1]}) has this module's exact filename but failed entry-point identity verification — refusing to silently exit 0. Nothing was written. This may indicate a path-resolution edge case; investigate before trusting any other result from this invocation.`
  );
  process.exit(1);
}
