#!/usr/bin/env node
// distribution/check.mjs — the drift gate for every distribution-channel manifest.
//
// Five checks (brief-A PHASE 4), run against distribution/channels.json's rows[]. Never
// short-circuits: every check runs and every failure is collected, so one `npm run` shows
// the whole picture instead of one failure at a time.
//
//   version_equal    every row's version_field (where non-null) == npm-package/package.json's version.
//   generated_clean  distribution/generate.mjs --check reports zero diffs (no hand-edit of an owned field).
//   no_orphans       every repo file matching channels.json's manifest_patterns is claimed by
//                    exactly one row's path, or listed in channels.json's known_orphans with a reason.
//   location_rules   each row's file(s) exist at their required location.
//   legibility       name_field == listing.name (or row.name_override, with a reason); description_field
//                    length <= description_max_len; description_field/name_field hold no hand-typed
//                    /\d+\+?\s*(tools|platforms|engines)\b/i count unless the row marks it
//                    description_derived; every row's manifest file(s) parse (JSON.parse, or a
//                    line-level YAML sanity check — no dependency); (added brief-A2, 2026-10-15)
//                    no manifest file contains a literal Authorization-header value or a
//                    key/token-shaped literal string anywhere in the file — ${VAR}/$VAR
//                    templates are allowed (they resolve on the USER's machine, never ship a
//                    real secret in this repo). This is a WHOLE-FILE scan, unlike the
//                    hand-typed-count rule above, because a secret can hide in an untracked
//                    nested field (e.g. an mcp_config.json `headers.Authorization` value) that
//                    no row's version/name/description_field pointer ever reaches.
//
// SCOPE DECISION (flagged, not silent — see distribution/README.md "Known scope decisions"):
// the no-hand-typed-counts rule is checked against the EXTRACTED version_field/name_field/
// description_field VALUES, not a whole-file text scan. npm-package/smithery.yaml's hand-authored
// per-tool `tools[].description` entries legitimately carry accurate platform/operation counts
// (e.g. "Supports 16 platforms (~87 operations)") that describe that TOOL's own capability, not
// this round's channel-manifest-metadata drift (plugin.json's/smithery.yaml's TOP-LEVEL
// description, which is exactly where the brief's real-world bug lived). A whole-file scan would
// false-positive on those legitimate, currently-accurate per-tool strings.
//
// Usage:  node distribution/check.mjs
// Exit codes: 0 = clean, 1 = one or more checks failed (every failure printed, never just the first).
//
// No dependencies. Node >= 20 builtins only.

import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve, relative, basename } from "node:path";

import {
  getJsonPointer,
  getYamlTopLevelValue,
  getYamlNestedKeys,
  getYamlNestedScalar,
  getYamlTopLevelKeys,
  generateAll,
  isClosedShapeRow,
  computeRowPinnedHash,
  readPinnedHashes,
  resolveTemplateString,
} from "./generate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");

export const CHECK_NAMES = [
  "version_equal",
  "generated_clean",
  "no_orphans",
  "location_rules",
  "legibility",
  "endpoint_equal",
  "field_shape",
  "closed_shape",
  "shape_declared",
  "tamper_evident",
  "ci_paths_cover",
  "claims_consistent",
  "json_no_duplicate_keys",
];

const COUNT_PATTERN = /\b\d+\+?\s*(tools|platforms|engines)\b/i;

// Directories pruned entirely from the no_orphans repo walk (matched by basename, anywhere).
const EXCLUDE_DIR_BASENAMES = new Set(["node_modules", "build", "coverage", ".git", "dist"]);
// brief-L (2026-10-15, L2 MEDIUM): this file used to ALSO prune the exact repo-relative paths
// "distribution/research" and "distribution/test" wholesale from the walk below — a
// manifest-pattern-matching file planted anywhere inside either tree (e.g. a stray "mcp.json")
// was structurally invisible to no_orphans, independent of what it contained, because the walk
// never even descended into those directories. Removed: neither tree currently holds any file
// that actually matches manifest_patterns (verified directly against every file under both —
// distribution/test/*.test.mjs, distribution/test/fixtures.mjs, distribution/research/
// channel-facts.{json,md} — none of their basenames/suffixes match a manifest_patterns entry),
// so dropping the blanket prune introduces zero new orphans today. If a future test or research
// artifact genuinely needs a manifest-named file checked into either tree, it must be listed in
// channels.json's known_orphans with its own reason, exactly like every other legitimately
// unclaimed file — never a second blanket directory exemption re-introducing this same hole.

// ---------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------
export function loadConfig(root = ROOT) {
  const channels = JSON.parse(readFileSync(join(root, "distribution", "channels.json"), "utf8"));
  const listing = JSON.parse(readFileSync(join(root, "distribution", "listing.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(root, "npm-package", "package.json"), "utf8"));
  return { channels, listing, pkg, root };
}

function rowPaths(row) {
  return Array.isArray(row.path) ? row.path : [row.path];
}

function isYamlPath(p) {
  return /\.ya?ml$/i.test(p);
}

/** Reads a field (JSON pointer for .json paths, bare top-level key for .yaml paths). */
function readField(root, relPath, fieldRef) {
  const filePath = join(root, relPath);
  const raw = readFileSync(filePath, "utf8");
  if (isYamlPath(relPath)) return getYamlTopLevelValue(raw, fieldRef);
  const obj = JSON.parse(raw);
  return getJsonPointer(obj, fieldRef);
}

function fixHintFor(row) {
  if (row.generated_by === "distribution/generate.mjs") return "run `node distribution/generate.mjs`";
  if (row.generated_by === "npm-package/scripts/gen-server-json.mjs") return "run `npm run build` in npm-package/ (regenerates server.json)";
  return `manually fix ${Array.isArray(row.path) ? row.path.join(", ") : row.path} — no generator owns this field`;
}

// ---------------------------------------------------------------------------------------
// Check: version_equal
// ---------------------------------------------------------------------------------------
export function checkVersionEqual(ctx) {
  const { channels, pkg, root } = ctx;
  const expected = pkg.version;
  const failures = [];
  for (const row of channels.rows) {
    if (!row.version_field) continue; // not applicable to this channel
    for (const relPath of rowPaths(row)) {
      if (!existsSync(join(root, relPath))) continue; // location_rules reports missing files
      let actual;
      try {
        actual = readField(root, relPath, row.version_field);
      } catch (err) {
        failures.push(`${relPath}: rule=version_equal fix=${fixHintFor(row)} — could not read ${row.version_field}: ${err.message}`);
        continue;
      }
      if (actual !== expected) {
        failures.push(
          `${relPath}: rule=version_equal field=${row.version_field} got=${JSON.stringify(actual)} want=${JSON.stringify(expected)} fix=${fixHintFor(row)}`
        );
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// Check: endpoint_equal (brief-F R1, 2026-10-15)
// ---------------------------------------------------------------------------------------
// Mirrors checkVersionEqual exactly, generalized to row.url_field: every row that SETS a
// url_field (whether or not it is also owned_fields-writable) must have that pointer's value
// equal listing.json's hosted_endpoint. Before this round, the hosted MCP endpoint URL was
// hand-written in gemini-extension.json, the Antigravity mcp_config.json, the OpenAI .mcp.json,
// AND npm-package/server.json's remotes[0].url — listing.json's hosted_endpoint was never read
// by any check, so tampering with any of the four passed every one of them (5/5 PASS on a
// tampered endpoint). This closes it generically (one new *_field type, same shape as
// version_field), not with a `row.id === "..."` branch per channel.
export function checkEndpointEqual(ctx) {
  const { channels, listing, root } = ctx;
  const expected = listing.hosted_endpoint;
  const failures = [];
  for (const row of channels.rows) {
    if (!row.url_field) continue; // not applicable to this channel
    for (const relPath of rowPaths(row)) {
      if (!existsSync(join(root, relPath))) continue; // location_rules reports missing files
      let actual;
      try {
        actual = readField(root, relPath, row.url_field);
      } catch (err) {
        failures.push(`${relPath}: rule=endpoint_equal fix=${fixHintFor(row)} — could not read ${row.url_field}: ${err.message}`);
        continue;
      }
      if (actual !== expected) {
        failures.push(
          `${relPath}: rule=endpoint_equal field=${row.url_field} got=${JSON.stringify(actual)} want=${JSON.stringify(expected)} fix=${fixHintFor(row)}`
        );
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// Check: field_shape (brief-F R3, 2026-10-15)
// ---------------------------------------------------------------------------------------
// row.required_fields is an object mapping an exact JSON pointer to a shape expectation:
// {must:"exist"}, {must:"not_exist"}, or {must:"equal", value:<literal>}. Table-driven across
// EVERY row that sets required_fields — no per-channel branch. This is how a channel-specific
// field-NAME typo (Antigravity's `url` instead of `serverUrl`, OpenAI's `.mcp.json` carrying the
// wrong `type`) gets caught: version_equal/endpoint_equal/legibility all check a field's VALUE
// once they know its pointer, but none of them notice a WRONG pointer existing (or a REQUIRED
// one missing) — field_shape is the generic mechanism for that, scoped to JSON manifests only
// (every row that currently sets required_fields is a .json path; getJsonPointer already
// returns undefined for a missing segment, which is exactly what {must:"not_exist"} checks for).
export function checkFieldShape(ctx) {
  const { channels, root } = ctx;
  const failures = [];
  for (const row of channels.rows) {
    if (!row.required_fields) continue;
    for (const relPath of rowPaths(row)) {
      if (!existsSync(join(root, relPath))) continue; // location_rules reports missing files
      if (isYamlPath(relPath)) continue; // required_fields is JSON-pointer-shaped; no row needs this on YAML today
      let obj;
      try {
        obj = JSON.parse(readFileSync(join(root, relPath), "utf8"));
      } catch (err) {
        failures.push(`${relPath}: rule=field_shape row=${row.id} fix=${fixHintFor(row)} — could not parse JSON: ${err.message}`);
        continue;
      }
      for (const [pointer, expectation] of Object.entries(row.required_fields)) {
        const actual = getJsonPointer(obj, pointer);
        if (expectation.must === "exist" && actual === undefined) {
          failures.push(`${relPath}: rule=field_shape row=${row.id} pointer=${pointer} got=missing want=present fix=${fixHintFor(row)}`);
        } else if (expectation.must === "not_exist" && actual !== undefined) {
          failures.push(
            `${relPath}: rule=field_shape row=${row.id} pointer=${pointer} got=${JSON.stringify(actual)} want=absent fix="remove ${pointer} — ${fixHintFor(row)}"`
          );
        } else if (expectation.must === "equal" && actual !== expectation.value) {
          failures.push(
            `${relPath}: rule=field_shape row=${row.id} pointer=${pointer} got=${JSON.stringify(actual)} want=${JSON.stringify(expectation.value)} fix=${fixHintFor(row)}`
          );
        }
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// Check: closed_shape (brief-I, 2026-10-15, I1 CRITICAL — the row-data half of the fix;
// json-full's complete-object rebuild in generate.mjs/generated_clean is the other half)
// ---------------------------------------------------------------------------------------
// row.closed_shape maps an object path to its permitted key allowlist. Path syntax:
//   ""        - the file's own top-level object (JSON) or column-0 key set (YAML).
//   "/x/*"    - (JSON only) every element of the array found at "/x".
//   "topKey"  - (YAML only) topKey's direct children, one indentation level deep.
// A path that doesn't resolve in a given file (e.g. no "/packages" array at all) is silently
// skipped for THAT path only — closed_shape enforces "nothing extra where this structure
// exists", not "this structure must exist" (that is field_shape's/pinned_fields' job). This is
// how I1's concrete attacks are caught for the four HAND-AUTHORED-ENOUGH rows that keep an
// existing writer for one field but are not json-full: an injected top-level key (server.json,
// marketplace.json, glama.json) or an injected array-element key (server.json's
// packages[*]/remotes[*]) now fails here instead of round-tripping through the existing
// partial writer untouched.
function collectClosedShapeJsonNodes(root, path) {
  const segs = path === "" ? [] : path.split("/").filter((s) => s !== "");
  let frontier = [root];
  for (const seg of segs) {
    const next = [];
    for (const node of frontier) {
      if (seg === "*") {
        if (Array.isArray(node)) next.push(...node);
      } else if (Array.isArray(node)) {
        const idx = Number(seg);
        if (Number.isInteger(idx) && idx >= 0 && idx < node.length) next.push(node[idx]);
      } else if (node && typeof node === "object" && Object.prototype.hasOwnProperty.call(node, seg)) {
        next.push(node[seg]);
      }
    }
    frontier = next;
  }
  return frontier.filter((n) => n && typeof n === "object");
}

export function checkClosedShape(ctx) {
  const { channels, listing, pkg, root } = ctx;
  const version = pkg.version;
  const failures = [];
  for (const row of channels.rows) {
    if (!row.closed_shape) continue;
    for (const relPath of rowPaths(row)) {
      if (!existsSync(join(root, relPath))) continue; // location_rules already reports this

      if (isYamlPath(relPath)) {
        const raw = readFileSync(join(root, relPath), "utf8");
        for (const [path, allowedKeys] of Object.entries(row.closed_shape)) {
          const actualKeys = path === "" ? getYamlTopLevelKeys(raw) : getYamlNestedKeys(raw, path);
          if (actualKeys === null) continue; // the nested key itself is absent — nothing to enforce
          const allowedSet = new Set(allowedKeys);
          for (const k of actualKeys) {
            if (!allowedSet.has(k)) {
              failures.push(
                `${relPath}: rule=closed_shape row=${row.id} path=${JSON.stringify(path)} key=${k} fix="remove this key, or add it to channels.json's closed_shape allowlist for this row if it is legitimate"`
              );
            }
          }
        }
        for (const [yamlPath, expected] of Object.entries(row.pinned_fields ?? {})) {
          const dot = yamlPath.indexOf(".");
          const actual = dot === -1 ? getYamlTopLevelValue(raw, yamlPath) : getYamlNestedScalar(raw, yamlPath.slice(0, dot), yamlPath.slice(dot + 1));
          if (actual !== expected) {
            failures.push(
              `${relPath}: rule=closed_shape(pinned) row=${row.id} field=${yamlPath} got=${JSON.stringify(actual)} want=${JSON.stringify(expected)} fix=${fixHintFor(row)}`
            );
          }
        }
        continue;
      }

      let obj;
      try {
        obj = JSON.parse(readFileSync(join(root, relPath), "utf8"));
      } catch (err) {
        failures.push(`${relPath}: rule=closed_shape row=${row.id} fix=${fixHintFor(row)} — could not parse JSON: ${err.message}`);
        continue;
      }
      for (const [path, allowedKeys] of Object.entries(row.closed_shape)) {
        const nodes = collectClosedShapeJsonNodes(obj, path);
        const allowedSet = new Set(allowedKeys);
        for (const node of nodes) {
          for (const k of Object.keys(node)) {
            if (!allowedSet.has(k)) {
              failures.push(
                `${relPath}: rule=closed_shape row=${row.id} path=${JSON.stringify(path)} key=${k} fix="remove this key, or add it to channels.json's closed_shape allowlist for this row if it is legitimate"`
              );
            }
          }
        }
      }
      for (const [pointer, expected] of Object.entries(row.pinned_fields ?? {})) {
        const actual = getJsonPointer(obj, pointer);
        if (actual !== expected) {
          failures.push(
            `${relPath}: rule=closed_shape(pinned) row=${row.id} pointer=${pointer} got=${JSON.stringify(actual)} want=${JSON.stringify(expected)} fix=${fixHintFor(row)}`
          );
        }
      }
      // brief-K (2026-10-15, K1 CRITICAL): `pinned_fields` above requires a LITERAL value
      // hand-written in channels.json — no row used it for marketplace.json's
      // `plugins[0].source.url`/`.sha` because neither field is a static literal: `url` must
      // track `listing.json`'s `repository` (so a future repo rename doesn't need a second,
      // hand-duplicated literal here) and `sha` legitimately changes every release (pinning an
      // exact value would require knowing a future release's commit before it exists — see this
      // row's own `notes`). Two new, equally table-driven (not row.id-branched) pin mechanisms:
      // `pinned_fields_template` derives the expected value from listing.json/package.json's
      // version via generate.mjs's `resolveTemplateString` (a `{{token}}` placeholder embedded
      // anywhere in the literal, e.g. `"{{repository}}.git"`) — an EXACT-equality check against a
      // DYNAMIC expectation, not a hand-pinned constant that a legitimate `listing.json` edit
      // would then require a second, easy-to-forget channels.json edit to keep in sync.
      // `pinned_fields_format` asserts the pointer's value matches a regular expression — a
      // FORMAT pin for a field whose VALUE legitimately changes release-over-release (the git
      // commit sha) but whose SHAPE never should (40 lowercase hex characters). Before this
      // round: an attacker could swap `source.url` to a fork AND re-run `--repin` to make
      // tamper_evident accept the tampered content as the new reviewed baseline — this is the
      // CONCRETE hole K1 names, and it is why these two checks must be dynamic/structural rather
      // than another pinned-hashes.json-style baseline an attacker's own `--repin` run could
      // equally launder.
      for (const [pointer, template] of Object.entries(row.pinned_fields_template ?? {})) {
        const actual = getJsonPointer(obj, pointer);
        let expected;
        try {
          expected = resolveTemplateString(template, { listing, version });
        } catch (err) {
          failures.push(
            `${relPath}: rule=closed_shape(pinned_template) row=${row.id} pointer=${pointer} fix="fix the pinned_fields_template placeholder in distribution/channels.json" — ${err.message}`
          );
          continue;
        }
        if (actual !== expected) {
          failures.push(
            `${relPath}: rule=closed_shape(pinned_template) row=${row.id} pointer=${pointer} got=${JSON.stringify(actual)} want=${JSON.stringify(expected)} fix=${fixHintFor(row)}`
          );
        }
      }
      for (const [pointer, patternSrc] of Object.entries(row.pinned_fields_format ?? {})) {
        const actual = getJsonPointer(obj, pointer);
        let re;
        try {
          re = new RegExp(patternSrc);
        } catch (err) {
          failures.push(
            `${relPath}: rule=closed_shape(pinned_format) row=${row.id} pointer=${pointer} fix="fix the pinned_fields_format regex in distribution/channels.json" — invalid pattern ${JSON.stringify(patternSrc)}: ${err.message}`
          );
          continue;
        }
        if (typeof actual !== "string" || !re.test(actual)) {
          failures.push(
            `${relPath}: rule=closed_shape(pinned_format) row=${row.id} pointer=${pointer} got=${JSON.stringify(actual)} want="match /${patternSrc}/" fix=${fixHintFor(row)}`
          );
        }
      }
      // brief-J (2026-10-15, J1): closed_shape's "/x/*" path iterates every element ALREADY
      // present but has no notion of "no MORE elements may exist" — an attacker-injected array
      // ELEMENT built entirely from already-allowed keys (e.g. a second packages[1]/remotes[1]/
      // plugins[1] entry) previously passed closed_shape AND pinned_fields (which only pins
      // index 0) with zero detection. pinned_array_lengths maps an exact array pointer to its
      // required length — table-driven, not a row.id branch; tamper_evident (this round's
      // whole-file hash, see generate.mjs's canonicalFormForRow) is the generic backstop that
      // also catches this same class of attack on an array with no explicit length pin at all.
      for (const [pointer, expectedLen] of Object.entries(row.pinned_array_lengths ?? {})) {
        const actual = getJsonPointer(obj, pointer);
        const actualLen = Array.isArray(actual) ? actual.length : undefined;
        if (actualLen !== expectedLen) {
          const gotDescription = Array.isArray(actual) ? String(actualLen) : actual === undefined ? "missing" : "not-an-array";
          failures.push(
            `${relPath}: rule=closed_shape(pinned_array_length) row=${row.id} pointer=${pointer} got=${gotDescription} want=${expectedLen} fix=${fixHintFor(row)}`
          );
        }
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// Check: shape_declared (brief-I, 2026-10-15, I1 — meta-check closing the class, not just the
// 10 rows this round happened to classify)
// ---------------------------------------------------------------------------------------
// Every row must declare EXACTLY one of the two closed-shape mechanisms above: writer_kind
// "json-full" (the generator fully rebuilds the file — nothing hand-authored survives it) or a
// non-empty closed_shape allowlist (a hand-authored file, shape-checked explicitly). A row
// declaring NEITHER has no defense against I1's class of bug at all — this fails loudly so a
// FUTURE channel row can't silently ship with zero shape protection the way all 10 of today's
// rows did before this round.
export function checkShapeDeclared(ctx) {
  const { channels } = ctx;
  const failures = [];
  for (const row of channels.rows) {
    const hasJsonFull = row.writer_kind === "json-full";
    const hasClosedShape = row.closed_shape && typeof row.closed_shape === "object" && Object.keys(row.closed_shape).length > 0;
    if (!hasJsonFull && !hasClosedShape) {
      failures.push(
        `distribution/channels.json: rule=shape_declared row=${row.id} fix="declare either writer_kind:\\"json-full\\" (generator fully rebuilds this file) or a non-empty closed_shape allowlist (hand-authored file) — every channel row must pick one"`
      );
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// Check: tamper_evident (brief-J, 2026-10-15, J1 CRITICAL — the class fix replacing
// "allowlist whack-a-mole" with whole-file tamper evidence)
// ---------------------------------------------------------------------------------------
// Three red-team rounds in a row found a NEW hole in closed_shape's hand-written allowlist
// (server.json packages[1]/remotes[1]/tools[0] extra keys/registryType, marketplace.json
// plugins[1], smithery.yaml's configSchema nested properties) because an allowlist only covers
// paths someone thought of. This check does not enumerate attacks at all: for every closed_shape
// row it recomputes a SHA-256 over the row's canonical form (generate.mjs's
// canonicalFormForRow — the whole file, with only the four independently-verified version/name/
// description/url fields neutralized) and compares it against the pinned value in
// distribution/pinned-hashes.json. ANY other change — an injected array element, a key nested
// deeper than closed_shape's own declared path, a tampered value closed_shape's allowlist simply
// never restricted — moves the hash and fails here, with no allowlist to have missed it.
// closed_shape + pinned_fields stay in place (defence in depth, readable intent for a reviewer);
// this is the generic backstop underneath them.
export function checkTamperEvident(ctx) {
  const { channels, root } = ctx;
  const failures = [];
  const pinned = readPinnedHashes(root);
  for (const row of channels.rows) {
    if (!isClosedShapeRow(row)) continue;
    const paths = rowPaths(row);
    if (paths.some((p) => !existsSync(join(root, p)))) continue; // location_rules already reports a missing file
    const label = paths.join(", ");
    const entry = pinned[row.id];
    if (!entry || typeof entry.sha256 !== "string") {
      failures.push(
        `${label}: rule=tamper_evident row=${row.id} fix="no pinned hash on record in distribution/pinned-hashes.json — run \`node distribution/generate.mjs --repin ${row.id}\` once to establish the baseline from the current, reviewed content"`
      );
      continue;
    }
    let actualHash;
    try {
      actualHash = computeRowPinnedHash(root, row);
    } catch (err) {
      failures.push(`${label}: rule=tamper_evident row=${row.id} fix="fix the input error, then re-run \`node distribution/generate.mjs --repin ${row.id}\`" — could not compute canonical hash: ${err.message}`);
      continue;
    }
    if (actualHash !== entry.sha256) {
      failures.push(
        `${label}: rule=tamper_evident row=${row.id} got=${actualHash} want=${entry.sha256} fix="if this hand edit is intended, review it and run \`node distribution/generate.mjs --repin ${row.id}\`"`
      );
    }
  }
  return failures;
}

const PINNED_HASHES_RELPATH_FOR_SUMMARY = "distribution/pinned-hashes.json"; // same literal
// generate.mjs's own (private, unexported) PINNED_HASHES_RELPATH uses — duplicating one string
// constant here is simpler and more robust than threading an internal path across modules for
// this read-only, informational-only use.

function tryGitMergeBase(root) {
  try {
    const out = execFileSync("git", ["merge-base", "HEAD", "origin/main"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"], // not every caller is a git work tree with an origin/main ref — suppress git's expected stderr noise
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function tryGitShowFile(root, ref, relPath) {
  try {
    return execFileSync("git", ["show", `${ref}:${relPath}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"], // the file may not have existed at that ref yet (a brand-new pin) — that is not an error
    });
  } catch {
    return null;
  }
}

/** brief-K (2026-10-15, K1 CRITICAL): a diff that edits marketplace.json's `source.url`/`.sha`
 *  AND re-runs `--repin` updates `tamper_evident`'s own baseline to accept the tampered content as
 *  the new "reviewed" state — the pinned-hashes.json ledger alone cannot distinguish an honest,
 *  human-reviewed content change from an attacker who tampered a hand-authored manifest and then
 *  laundered the tamper through the same `--repin` command a legitimate maintainer would run.
 *  check.mjs's K1-closed `closed_shape(pinned_template)`/`closed_shape(pinned_format)` checks
 *  above close the CONCRETE hole (the url/sha fields themselves are now independently verified,
 *  not just hash-pinned); this function is the complementary, REVIEWER-VISIBLE half the finding
 *  also asks for — never a failing check (a hand-authored manifest changing is sometimes exactly
 *  the point of a PR), just a loud, always-printed summary of every pinned-hashes.json entry
 *  whose hash differs from the version at `git merge-base HEAD origin/main`, so a human reviewer
 *  sees "these hand-authored manifests changed in this branch" on every single run, pass or fail.
 *  Never fails on `origin/main` being unavailable (a shallow checkout, a fork with no such remote,
 *  a fixture that isn't a git repo at all) — reports that it was skipped instead, same "informed,
 *  never silent" posture as the markers/exclude summaries above. */
export function computePinnedHashesBranchSummary(root = ROOT) {
  const mergeBase = tryGitMergeBase(root);
  if (!mergeBase) {
    return {
      skipped: true,
      reason: "`git merge-base HEAD origin/main` is unavailable (no such ref, or this is not a git work tree) — skipping the branch-diff summary",
    };
  }
  const baseRaw = tryGitShowFile(root, mergeBase, PINNED_HASHES_RELPATH_FOR_SUMMARY);
  let baseEntries = {};
  if (baseRaw !== null) {
    try {
      baseEntries = JSON.parse(baseRaw);
    } catch {
      baseEntries = {}; // malformed at that historical ref — treat as "no baseline", never throw
    }
  }
  const current = readPinnedHashes(root);
  const changed = [];
  for (const [rowId, entry] of Object.entries(current)) {
    const baseEntry = baseEntries[rowId];
    const baseSha = baseEntry && typeof baseEntry.sha256 === "string" ? baseEntry.sha256 : null;
    if (baseSha !== entry.sha256) changed.push({ rowId, baseSha, headSha: entry.sha256 });
  }
  return { skipped: false, mergeBase, changed };
}

// ---------------------------------------------------------------------------------------
// Check: json_no_duplicate_keys (brief-K, 2026-10-15, K2 HIGH)
// ---------------------------------------------------------------------------------------
// JSON.parse silently keeps only the LAST-declared value of a key repeated within the same
// object — it never throws, never warns, and the earlier occurrence is simply gone from the
// parsed result. Every check above that reads a JSON manifest (closed_shape's top-level/array-
// element key allowlist, pinned_fields/pinned_fields_template/pinned_fields_format's pointer
// equality, generated_clean's rebuild diff, even this round's own tamper_evident hash — all of
// which call `JSON.parse(readFileSync(...))`) is structurally blind to a REPEATED key: an
// attacker (or an honest merge conflict) who injects a second `"description": "..."` ahead of the
// real one changes nothing any of those checks can see, because the object they inspect already
// collapsed to the LAST value before any check-specific logic ever runs.
//
// findDuplicateJsonKeys walks the RAW TEXT once with a small, hand-rolled recursive-descent
// scanner (no dependency, and deliberately not a full JSON validator — legibility(parse)'s own
// JSON.parse call already owns "is this valid JSON at all") that never builds a JS value at all;
// it only tracks, per object SCOPE (one Map per `{...}`, reset on each nested object), which
// string keys have already been seen at that exact nesting level. A key repeated across SIBLING
// objects (e.g. two different array elements each declaring `"name"`) is normal and not flagged —
// only a key appearing twice directly inside the SAME `{...}` is.
//
// brief-L (2026-10-15, L1 HIGH): parseString() below returns a key's RAW, UNDECODED source text
// (the literal characters between the quotes, escape sequences included verbatim) — comparing
// those raw strings directly meant `"name"` and its JSON-escaped twin `"name"` (or `"a\/b"`
// vs `"a/b"`) were treated as two DIFFERENT keys even though JSON.parse decodes both to the exact
// same string, so the real duplicate-key collapse this entire check exists to catch was invisible
// whenever an attacker (or a tool that re-serializes with different escaping) spelled the
// duplicate key with different escaping than the original. decodeJsonKeyLiteral below decodes
// each raw key through `JSON.parse('"'+raw+'"')` — the same escape rules the file's own content
// will be decoded with — before it is used as the per-scope dedup identity, so two keys that
// decode to the same string are now correctly flagged regardless of how either one is escaped.
function decodeJsonKeyLiteral(raw) {
  try {
    return JSON.parse('"' + raw + '"');
  } catch {
    // An illegal escape sequence inside a key makes the file invalid JSON overall — legibility's
    // own JSON.parse call already reports that failure; this scanner must never throw here, so it
    // falls back to the raw (undecoded) text as this key's dedup identity, same as its pre-fix
    // behavior for that key only.
    return raw;
  }
}

export function findDuplicateJsonKeys(text) {
  const n = text.length;
  let i = 0;
  let line = 1;
  const duplicates = [];

  function advance() {
    if (text[i] === "\n") line++;
    i++;
  }
  function isWs(c) {
    return c === " " || c === "\t" || c === "\r" || c === "\n";
  }
  function skipWs() {
    while (i < n && isWs(text[i])) advance();
  }
  function fail(msg) {
    throw new Error(`${msg} at line ${line}`);
  }
  function parseString() {
    if (text[i] !== '"') fail("expected a string");
    advance(); // opening quote
    let value = "";
    while (true) {
      if (i >= n) fail("unterminated string");
      const c = text[i];
      if (c === "\\") {
        value += c;
        advance();
        if (i < n) {
          value += text[i];
          advance();
        }
        continue;
      }
      if (c === '"') {
        advance();
        return value;
      }
      value += c;
      advance();
    }
  }
  function parseValue() {
    skipWs();
    if (i >= n) fail("unexpected end of input");
    const c = text[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "t" || c === "f" || c === "n") {
      // true / false / null — skip the literal's own characters without validating spelling;
      // this scanner only needs to advance PAST a scalar value, not type-check it (JSON.parse
      // already validated the file's syntax in full elsewhere).
      while (i < n && /[a-z]/.test(text[i])) advance();
      return;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      while (i < n && /[-+0-9.eE]/.test(text[i])) advance();
      return;
    }
    fail(`unexpected character ${JSON.stringify(c)}`);
  }
  function parseArray() {
    advance(); // [
    skipWs();
    if (text[i] === "]") {
      advance();
      return;
    }
    while (true) {
      parseValue();
      skipWs();
      if (text[i] === ",") {
        advance();
        continue;
      }
      if (text[i] === "]") {
        advance();
        break;
      }
      fail("expected ',' or ']' in array");
    }
  }
  function parseObject() {
    advance(); // {
    skipWs();
    const seenAtThisScope = new Map(); // key -> first-seen line, scoped to THIS object only
    if (text[i] === "}") {
      advance();
      return;
    }
    while (true) {
      skipWs();
      if (text[i] !== '"') fail("expected a string key in object");
      const keyLine = line;
      const rawKey = parseString();
      const key = decodeJsonKeyLiteral(rawKey); // brief-L L1: dedup on the DECODED key, not raw text
      if (seenAtThisScope.has(key)) {
        duplicates.push({ key, firstLine: seenAtThisScope.get(key), duplicateLine: keyLine });
      } else {
        seenAtThisScope.set(key, keyLine);
      }
      skipWs();
      if (text[i] !== ":") fail("expected ':' after object key");
      advance();
      parseValue();
      skipWs();
      if (text[i] === ",") {
        advance();
        continue;
      }
      if (text[i] === "}") {
        advance();
        break;
      }
      fail("expected ',' or '}' in object");
    }
  }

  skipWs();
  parseValue();
  return duplicates;
}

export function checkJsonNoDuplicateKeys(ctx) {
  const { channels, root } = ctx;
  const failures = [];
  for (const row of channels.rows) {
    const inScope = row.writer_kind === "json-full" || isClosedShapeRow(row);
    if (!inScope) continue;
    for (const relPath of rowPaths(row)) {
      if (!existsSync(join(root, relPath))) continue; // location_rules already reports this
      if (isYamlPath(relPath)) continue; // JSON-only — yamlLooksValid's own top-level-key check covers YAML
      let raw;
      try {
        raw = readFileSync(join(root, relPath), "utf8");
      } catch (err) {
        failures.push(`${relPath}: rule=json_no_duplicate_keys row=${row.id} fix=${fixHintFor(row)} — could not read file: ${err.message}`);
        continue;
      }
      let dups;
      try {
        dups = findDuplicateJsonKeys(raw);
      } catch (err) {
        // A malformed file is already reported by legibility(parse); this scanner simply can't
        // walk it — never silently skip, always say why.
        failures.push(
          `${relPath}: rule=json_no_duplicate_keys row=${row.id} fix="fix the malformed JSON (see legibility's parse failure for this file)" — could not scan for duplicate keys: ${err.message}`
        );
        continue;
      }
      for (const dup of dups) {
        failures.push(
          `${relPath}:${dup.duplicateLine}: rule=json_no_duplicate_keys row=${row.id} key=${JSON.stringify(dup.key)} first_seen_line=${dup.firstLine} ` +
            `fix="remove the duplicate key — JSON.parse silently keeps only the LAST occurrence, which every other check in this file reads, so an earlier (possibly injected or merge-conflicted) occurrence is otherwise invisible"`
        );
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// Check: generated_clean
// ---------------------------------------------------------------------------------------
export function checkGeneratedClean(ctx) {
  const { root } = ctx;
  let writes;
  try {
    writes = generateAll(root, { checkOnly: true });
  } catch (err) {
    return [`distribution/generate.mjs: rule=generated_clean fix="fix the input error, then re-run" — ${err.message}`];
  }
  const failures = [];
  for (const w of writes) {
    if (!w.changed) continue;
    const fieldList = Object.keys(w.values).join(", ") || "(file content)";
    failures.push(
      `${w.relPath}: rule=generated_clean row=${w.rowId} drifted-fields=[${fieldList}] fix=run \`node distribution/generate.mjs\``
    );
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// Check: no_orphans
// ---------------------------------------------------------------------------------------
function patternToMatcher(pattern) {
  if (pattern.includes("/")) {
    const re = new RegExp(
      "(^|/)" +
        pattern
          .split("/")
          .map((seg) => (seg === "**" ? ".*" : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")))
          .join("/") +
        "$"
    );
    return (relPath) => re.test(relPath);
  }
  return (relPath) => basename(relPath) === pattern;
}

function walkRepo(root) {
  const out = [];
  (function recurse(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const relPosix = relative(root, abs).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (EXCLUDE_DIR_BASENAMES.has(entry.name)) continue;
        recurse(abs);
      } else if (entry.isFile()) {
        out.push(relPosix);
      }
    }
  })(root);
  return out;
}

export function checkNoOrphans(ctx) {
  const { channels, root } = ctx;
  const matchers = (channels.manifest_patterns ?? []).map((p) => ({ pattern: p, test: patternToMatcher(p) }));
  const claimed = new Set();
  for (const row of channels.rows) for (const p of rowPaths(row)) claimed.add(p.replaceAll("\\", "/"));
  const knownOrphans = new Set((channels.known_orphans ?? []).map((o) => o.path.replaceAll("\\", "/")));

  const failures = [];
  for (const relPath of walkRepo(root)) {
    const match = matchers.find((m) => m.test(relPath));
    if (!match) continue;
    if (claimed.has(relPath)) continue;
    if (knownOrphans.has(relPath)) continue;
    failures.push(
      `${relPath}: rule=no_orphans matched-pattern=${JSON.stringify(match.pattern)} fix="add a row for it in distribution/channels.json, or list it in known_orphans with a reason"`
    );
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// Check: ci_paths_cover (brief-F R2, 2026-10-15)
// ---------------------------------------------------------------------------------------
// .github/workflows/ci.yml's push/pull_request triggers can carry a `paths:` filter that scopes
// WHEN the distribution drift gate even runs. Before this round, that filter covered
// npm-package/**, distribution/**, and .github/workflows/** only — gemini-extension.json lives
// at the repo ROOT, outside all three, so a PR touching ONLY that file never triggered CI at
// all: every other check in this file could be failing and nobody would ever see it. This check
// closes the CLASS (not just that one file): it parses ci.yml's own `paths:` list(s) with a
// small line-based YAML extractor (no dependency) and fails if ANY channel row's path is not
// matched by EVERY `paths:` block found — so a future channel added at a new, uncovered root
// path fails this check immediately instead of silently escaping CI the same way.
//
// If ci.yml carries NO `paths:` filter at all (dropped entirely, the other brief-sanctioned fix
// for this class of bug), every row trivially passes — an unfiltered trigger runs on any push,
// which by definition already covers every row's path.
function extractYamlListsAfterKey(raw, key) {
  const lines = raw.split("\n");
  const lists = [];
  const keyRe = new RegExp(`^(\\s*)${key}:\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(keyRe);
    if (!m) continue;
    const baseIndent = m[1].length;
    const items = [];
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      // Blank or comment-only lines (at any indent) are legal INSIDE a YAML list and must not
      // terminate collection early — e.g. this fix's own explanatory `# R2 (brief-F...)` comment
      // lines sitting between two `- "..."` entries in ci.yml's own paths: list.
      if (/^\s*$/.test(line) || /^\s*#/.test(line)) {
        j++;
        continue;
      }
      const itemMatch = line.match(/^(\s*)-\s*(.+?)\s*$/);
      if (!itemMatch || itemMatch[1].length <= baseIndent) break;
      let val = itemMatch[2].trim();
      if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) val = val.slice(1, -1);
      items.push(val);
      j++;
    }
    if (items.length > 0) lists.push(items);
  }
  return lists;
}

/** GitHub Actions `paths:` glob semantics for ONE pattern against ONE repo-relative path —
 *  distinct from manifest_patterns' patternToMatcher (which matches "anywhere/as a suffix"). A
 *  ci.yml paths: entry is always anchored at the repo root. */
function ciPathMatches(pattern, relPath) {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return relPath === prefix || relPath.startsWith(prefix + "/");
  }
  if (pattern.includes("*")) {
    const re = new RegExp(
      "^" +
        pattern
          .split("/")
          .map((seg) => (seg === "**" ? ".*" : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")))
          .join("/") +
        "$"
    );
    return re.test(relPath);
  }
  return pattern === relPath;
}

export function checkCiPathsCover(ctx) {
  const { channels, root } = ctx;
  const ciRelPath = ".github/workflows/ci.yml";
  const ciAbsPath = join(root, ciRelPath);
  if (!existsSync(ciAbsPath)) {
    return [`${ciRelPath}: rule=ci_paths_cover fix="restore the workflow file" — not found, cannot verify it triggers on every channel's path`];
  }
  const raw = readFileSync(ciAbsPath, "utf8");
  const pathsLists = extractYamlListsAfterKey(raw, "paths");
  if (pathsLists.length === 0) return []; // no paths: filter anywhere -> runs unconditionally -> trivially covers every row

  const failures = [];
  for (const row of channels.rows) {
    for (const relPath of rowPaths(row)) {
      const uncoveredIn = pathsLists.filter((patterns) => !patterns.some((p) => ciPathMatches(p, relPath)));
      if (uncoveredIn.length > 0) {
        failures.push(
          `${ciRelPath}: rule=ci_paths_cover row=${row.id} path=${relPath} fix="add this path (or a covering glob, e.g. the exact filename if it's a single root-level file) to every paths: filter in ${ciRelPath}, or drop the paths: filter entirely"`
        );
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// Check: location_rules
// ---------------------------------------------------------------------------------------
export function checkLocationRules(ctx) {
  const { channels, root } = ctx;
  const failures = [];
  for (const row of channels.rows) {
    for (const relPath of rowPaths(row)) {
      const abs = join(root, relPath);
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        failures.push(
          `${relPath}: rule=location_rules row=${row.id} fix="restore the file — ${row.location_rule ?? "required by its channel row"}"`
        );
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// Check: legibility
// ---------------------------------------------------------------------------------------
export function yamlLooksValid(src) {
  const issues = [];
  if (/\t/.test(src)) issues.push("contains a tab character (YAML requires spaces for indentation)");
  const lines = src.split("\n");
  const topLevelKeys = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const quoteCount = (line.match(/(?<!\\)"/g) ?? []).length;
    if (quoteCount % 2 !== 0) issues.push(`line ${i + 1}: unbalanced double quotes`);
    const m = line.match(/^([A-Za-z_][\w-]*):/);
    if (m) {
      const key = m[1];
      if (topLevelKeys.has(key)) issues.push(`duplicate top-level key "${key}" at lines ${topLevelKeys.get(key)} and ${i + 1}`);
      else topLevelKeys.set(key, i + 1);
    }
    const indentMatch = line.match(/^(\s*)\S/);
    if (indentMatch && indentMatch[1].includes(" ") && indentMatch[1].length % 2 !== 0) {
      issues.push(`line ${i + 1}: indentation is not a multiple of 2 spaces`);
    }
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------------------
// legibility sub-rule: no literal secrets anywhere in a manifest file (brief-A2, 2026-10-15).
// Scope: real key/token FORMATS only (stripe/github/slack/google/aws prefixes + a generic
// "Authorization: <literal>" header) — deliberately NOT a generic high-entropy/long-alnum-
// string scan, which would false-positive on this registry's own legitimate 40-hex-char git
// commit SHAs (marketplace.json's pinned `source.sha`) and other benign long identifiers.
// ${VAR} / $VAR templates are always allowed — they resolve on the USER's machine at
// install/connect time and are never a real secret inside this repo.
// ---------------------------------------------------------------------------------------
const SECRET_PREFIX_PATTERN =
  /(sk-[A-Za-z0-9]{10,}|sk_(?:live|test)_[A-Za-z0-9]{10,}|gh[opsu]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,}|ASIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z_-]{20,})/;
const TEMPLATE_ONLY_PATTERN = /^\s*(?:\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*)\s*$/;
const HAS_TEMPLATE_PATTERN = /\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*/;

// brief-F R4 (2026-10-15): the auth-key-shape rule originally only recognized a field literally
// named/ending-in "Authorization". A sibling HTTP header convention (x-api-key) or any
// *token*-shaped key (access_token, refresh_token, apiToken, bearer_token...) carrying a
// literal, non-templated value was invisible to this rule — same class of bug as the original
// secret_literal gap, one key-shape short. AUTH_SHAPED_KEY_PATTERN matches the LAST path segment
// only (so a dotted JSON path like "mcpServers.novada.headers.Authorization" still matches on
// its final component, same as the pre-existing /authorization$/i behavior it replaces).
//
// Deliberately scoped to the EXACT header names named in R4 ("x-api-key"), not a generic
// api[-_]?key pattern: a broader pattern also matches "apiKey" used as a JSON-SCHEMA PROPERTY
// NAME (e.g. hosted-server/smithery.yaml's `configSchema.properties.apiKey`, a known_orphans
// file this same check already scans) — that is a schema field declaration with a documentation
// placeholder value ("your-api-key-here"), not a live header/token being shipped, and flagging
// it would be a false positive discovered and reverted during this round's own test run. A real
// leaked key under any OTHER key name is still caught by SECRET_PREFIX_PATTERN below regardless
// of field name.
const AUTH_SHAPED_KEY_PATTERN = /^(authorization|x-api-key)$/i;
const TOKEN_SHAPED_KEY_PATTERN = /token/i; // "*token*" per R4 — contains, not just ends-with/equals
// brief-F R4: a literal API key/token can also hide in a URL's own query string (e.g.
// `https://host/mcp?apikey=sk-live-...`) regardless of which JSON/YAML key holds that URL
// string — checked independently of field-name shape, against every string value.
const URL_SECRET_QUERY_PATTERN = /[?&](?:api[-_]?key|access_token|token)=([^&\s"'<>]+)/gi;

function lastKeySegment(fieldLabel) {
  const idx = fieldLabel.lastIndexOf(".");
  return idx === -1 ? fieldLabel : fieldLabel.slice(idx + 1);
}

function isAuthShapedKey(fieldLabel) {
  const seg = lastKeySegment(fieldLabel);
  return AUTH_SHAPED_KEY_PATTERN.test(seg) || TOKEN_SHAPED_KEY_PATTERN.test(seg);
}

function checkUrlQuerySecrets(strValue, fieldLabel, relPath, lineSuffix, failures) {
  URL_SECRET_QUERY_PATTERN.lastIndex = 0;
  let match;
  while ((match = URL_SECRET_QUERY_PATTERN.exec(strValue))) {
    const value = match[1];
    if (value.trim() === "" || HAS_TEMPLATE_PATTERN.test(value)) continue; // ${VAR}/$VAR stays allowed
    failures.push(
      `${relPath}${lineSuffix}: rule=legibility(secret_literal) field=${fieldLabel} fix="remove the literal API key/token from the URL query string — use a \${VAR} template, or omit the parameter and authenticate out-of-band"`
    );
  }
}

function walkStrings(value, visit, pathSoFar = []) {
  if (typeof value === "string") {
    visit(value, pathSoFar);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, visit, [...pathSoFar, String(i)]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walkStrings(v, visit, [...pathSoFar, k]);
  }
}

function checkSecretValue(strValue, fieldLabel, relPath, lineSuffix, failures) {
  const isAuthKey = isAuthShapedKey(fieldLabel);
  if (isAuthKey && strValue.trim() !== "" && !HAS_TEMPLATE_PATTERN.test(strValue)) {
    failures.push(
      `${relPath}${lineSuffix}: rule=legibility(secret_literal) field=${fieldLabel} fix="use a \${VAR} template (e.g. \"Bearer \${NOVADA_API_KEY}\"), never a literal auth/token value, in a shipped manifest"`
    );
    return;
  }
  if (!TEMPLATE_ONLY_PATTERN.test(strValue) && SECRET_PREFIX_PATTERN.test(strValue)) {
    failures.push(
      `${relPath}${lineSuffix}: rule=legibility(secret_literal) field=${fieldLabel} fix="remove the key/token-shaped literal string — manifests must never ship a real-looking API key or bearer token"`
    );
    return;
  }
  checkUrlQuerySecrets(strValue, fieldLabel, relPath, lineSuffix, failures);
}

function checkNoLiteralSecretsInJson(obj, relPath, failures) {
  walkStrings(obj, (strValue, pathParts) => {
    checkSecretValue(strValue, pathParts.join(".") || "(root)", relPath, "", failures);
  });
}

function checkNoLiteralSecretsInYaml(raw, relPath, failures) {
  raw.split("\n").forEach((line, i) => {
    const m = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.+)$/);
    if (!m) return;
    const [, key, rawValue] = m;
    const value = rawValue.trim().replace(/^"(.*)"$/, "$1");
    if (value === "") return;
    checkSecretValue(value, key, relPath, `:${i + 1}`, failures);
  });
}

function checkNoLiteralSecrets(root, relPath, failures) {
  const abs = join(root, relPath);
  const raw = readFileSync(abs, "utf8");
  if (isYamlPath(relPath)) checkNoLiteralSecretsInYaml(raw, relPath, failures);
  else checkNoLiteralSecretsInJson(JSON.parse(raw), relPath, failures);
}

function checkFileParses(root, relPath) {
  const abs = join(root, relPath);
  const raw = readFileSync(abs, "utf8");
  if (isYamlPath(relPath)) {
    const { ok, issues } = yamlLooksValid(raw);
    return ok ? null : `invalid YAML: ${issues.join("; ")}`;
  }
  try {
    JSON.parse(raw);
    return null;
  } catch (err) {
    return `invalid JSON: ${err.message}`;
  }
}

export function checkLegibility(ctx) {
  const { channels, listing, root } = ctx;
  const failures = [];

  for (const row of channels.rows) {
    for (const relPath of rowPaths(row)) {
      if (!existsSync(join(root, relPath))) continue; // location_rules already reports this

      const parseError = checkFileParses(root, relPath);
      if (parseError) {
        failures.push(`${relPath}: rule=legibility(parse) row=${row.id} ${parseError} fix=${fixHintFor(row)}`);
        continue; // nothing else below is meaningful on an unparseable file
      }

      // no literal secrets anywhere in the file — independent of which fields this row owns
      // or verifies, since a secret can hide in an untracked nested field.
      checkNoLiteralSecrets(root, relPath, failures);

      // name equality (or a documented override)
      if (row.name_field) {
        const actualName = readField(root, relPath, row.name_field);
        const expectedName = row.name_override?.value ?? listing.name;
        if (actualName !== expectedName) {
          failures.push(
            `${relPath}: rule=legibility(name) row=${row.id} field=${row.name_field} got=${JSON.stringify(actualName)} ` +
              `want=${JSON.stringify(expectedName)} fix=${row.name_override ? "update name_override in distribution/channels.json or the file" : fixHintFor(row)}`
          );
        } else if (row.name_override && !row.name_override.reason) {
          failures.push(`${relPath}: rule=legibility(name_override) row=${row.id} name_override is set without a reason`);
        }
      }

      // description length + no hand-typed counts
      if (row.description_field) {
        const desc = readField(root, relPath, row.description_field);
        if (typeof desc !== "string") {
          failures.push(`${relPath}: rule=legibility(description) row=${row.id} field=${row.description_field} is missing or not a string`);
        } else {
          if (typeof row.description_max_len === "number" && desc.length > row.description_max_len) {
            failures.push(
              `${relPath}: rule=legibility(description_len) row=${row.id} len=${desc.length} max=${row.description_max_len} fix=${fixHintFor(row)}`
            );
          }
          if (!row.description_derived && COUNT_PATTERN.test(desc)) {
            failures.push(
              `${relPath}: rule=legibility(hand_typed_count) row=${row.id} field=${row.description_field} value=${JSON.stringify(desc)} ` +
                `fix="remove the hand-typed count, or set description_derived:true with description_derived_reason in distribution/channels.json if it must stay"`
            );
          }
        }
      }
      if (row.name_field && !row.description_field) {
        const name = readField(root, relPath, row.name_field);
        if (typeof name === "string" && !row.name_derived && COUNT_PATTERN.test(name)) {
          failures.push(`${relPath}: rule=legibility(hand_typed_count) row=${row.id} field=${row.name_field} value=${JSON.stringify(name)}`);
        }
      }
    }
  }

  // known_orphans must still parse and carry no literal secrets, even though no row owns them.
  for (const orphan of channels.known_orphans ?? []) {
    if (!existsSync(join(root, orphan.path))) continue;
    const parseError = checkFileParses(root, orphan.path);
    if (parseError) {
      failures.push(`${orphan.path}: rule=legibility(parse) known_orphan ${parseError}`);
    } else {
      checkNoLiteralSecrets(root, orphan.path, failures);
    }
    if (!orphan.reason) failures.push(`${orphan.path}: rule=legibility(known_orphan_reason) known_orphans entry has no reason`);
  }

  return failures;
}

// ---------------------------------------------------------------------------------------
// Check: claims_consistent (brief-F R10 — CLASS fix, 2026-10-15; brief-H per-surface fact
// scope added 2026-10-15)
// ---------------------------------------------------------------------------------------
// Every other check above inspects channels.json's OWN rows' manifest fields — none of them
// ever look at README.md/docs/landing prose, which is exactly where the original class of bug
// (a hand-typed platform/tool count going stale) keeps recurring even after R7's two concrete
// instances are fixed, because nothing stops the NEXT one. This check is the generic gate:
// compute the current facts from the BUILT registry (never hand-typed here either), scan every
// channels.json `claim_surfaces` glob for a bare "<N>(+)? <noun>" occurrence of one of the
// narrow `claims` nouns, and fail any that don't match that noun's fact — UNLESS the surface
// overrides that noun's fact for itself (see "per-surface fact scope" below).
//
// facts computed:
//   tools      - npm-package/build/core.js's TOOLS.length (every registered tool, local+hosted).
//   hosted_tools - tools minus hosted-server/vercel/api/mcp.ts's HOSTED_HIDDEN set size. Exposed
//                  as an overridable fact key for claim_surfaces entries whose prose legitimately
//                  describes the HOSTED subset, not the local-package total (see below).
//   platforms  - build/data/scraper_catalog.js's WORKING_PLATFORM_NAMES.length (platforms with
//                >=1 working scrape operation today).
//   scrapers   - count of TOOLS entries named "novada_scrape_<platform>" (the typed, per-platform
//                tools — a distinct source from `platforms`, even though both are 14 today; they
//                could diverge, e.g. a typed tool shipped for a platform with zero working ops).
//
// HOSTED_HIDDEN is parsed TEXTUALLY out of its .ts source (a static `new Set([...])` literal)
// rather than imported, so this check never needs a second (hosted-server) build pipeline wired
// in just to read one constant — see parseHostedHiddenNames's own comment for the exact contract
// this depends on. brief-L (2026-10-15, L3): every parsed name is also cross-checked against the
// built TOOLS registry — see computeFacts()'s own comment below for why.
//
// Per-surface fact scope (brief-H, class-not-instance): a `claim_surfaces` entry can be a bare
// glob string (checked against every claims noun's plain fact, as before) OR an object
// `{glob, fact_overrides?, reason?}` where `fact_overrides` maps one claims fact key (e.g.
// "tools") to a DIFFERENT fact key this surface must be checked against instead (e.g.
// "hosted_tools") — fact scope is a property of the SURFACE, not a single global constant, so
// it belongs in this table rather than a second hand-maintained number. An override naming a
// fact key computeFacts() doesn't produce is a loud, thrown config error (never a silent pass —
// see normalizeClaimSurface/checkClaimsConsistent below), so a typo here can't quietly disable
// this check for a whole surface.
async function computeFacts(root) {
  const corePath = join(root, "npm-package", "build", "core.js");
  const catalogPath = join(root, "npm-package", "build", "data", "scraper_catalog.js");
  if (!existsSync(corePath) || !existsSync(catalogPath)) {
    const err = new Error(
      "npm-package/build/core.js (and/or build/data/scraper_catalog.js) not found — claims_consistent needs the built tool registry to compute its facts."
    );
    err.agent_instruction = "run `npm run build` in npm-package/, then re-run distribution/check.mjs";
    throw err;
  }
  const core = await import(pathToFileURL(corePath).href);
  const catalog = await import(pathToFileURL(catalogPath).href);
  const tools = core.TOOLS.length;
  const platforms = catalog.WORKING_PLATFORM_NAMES.length;
  const scrapers = core.TOOLS.filter((t) => /^novada_scrape_[a-z0-9_]+$/.test(t.name)).length;
  const hostedHiddenNames = parseHostedHiddenNames(root);
  // brief-L (2026-10-15, L3 MEDIUM): computeFacts previously trusted every HOSTED_HIDDEN name at
  // face value and subtracted the Set's raw SIZE from `tools` — a stale/typo'd/removed tool name
  // left in HOSTED_HIDDEN (e.g. after a tool is renamed or deleted from npm-package's registry,
  // but the hosted-server .ts file's exclusion list isn't updated to match) silently counted
  // toward hosted_tools anyway, understating the true hosted-visible tool count with zero signal
  // that the name it was "hiding" doesn't exist at all. Every parsed name is now cross-checked
  // against the built TOOLS registry (the same `core` import already loaded above for the `tools`/
  // `scrapers` facts — no second build pipeline) and a ghost name is a loud, thrown FATAL (same
  // posture as every other computeFacts()/parseHostedHiddenNames() config error here), never a
  // silent undercount.
  const toolNameSet = new Set(core.TOOLS.map((t) => t.name));
  const ghostNames = hostedHiddenNames.filter((name) => !toolNameSet.has(name));
  if (ghostNames.length > 0) {
    const err = new Error(
      `hosted-server/vercel/api/mcp.ts's HOSTED_HIDDEN set names ${ghostNames.length} tool name(s) that do not exist in the built npm-package/build/core.js TOOLS registry: ${ghostNames.map((n) => JSON.stringify(n)).join(", ")} — claims_consistent's hosted_tools fact (tools - HOSTED_HIDDEN.length) would silently trust a stale/typo'd name and understate the real hosted-visible tool count.`
    );
    err.agent_instruction =
      "fix hosted-server/vercel/api/mcp.ts's HOSTED_HIDDEN set — remove the stale/typo'd tool name (or register/restore the missing tool in npm-package if it was meant to still exist), then re-run `npm run build` in npm-package/ and re-run distribution/check.mjs";
    throw err;
  }
  return { tools, hosted_tools: tools - hostedHiddenNames.length, platforms, scrapers };
}

/** Textually parses `const HOSTED_HIDDEN = new Set([...quoted strings...]);` out of
 *  hosted-server/vercel/api/mcp.ts and returns its DECODED element names (brief-L L3 — renamed
 *  from parseHostedHiddenCount, which returned only a count; the caller above needs the actual
 *  names to validate each one against the built TOOLS registry, not just how many there are).
 *  Throws loudly (with an agent_instruction) if that exact literal shape can't be found, rather
 *  than silently reporting zero hidden tools — a 0-length parse failure would make
 *  hosted_tools == tools and could mask a real future failure to read this fact. */
function parseHostedHiddenNames(root) {
  const relPath = "hosted-server/vercel/api/mcp.ts";
  const abs = join(root, relPath);
  if (!existsSync(abs)) {
    const err = new Error(`${relPath} not found — claims_consistent's hosted_tools fact depends on parsing its HOSTED_HIDDEN literal.`);
    err.agent_instruction = `restore ${relPath}, or update computeFacts() in distribution/check.mjs if hosted-server's layout changed`;
    throw err;
  }
  const src = readFileSync(abs, "utf8");
  const m = src.match(/const HOSTED_HIDDEN\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!m) {
    const err = new Error(`${relPath}: could not locate "const HOSTED_HIDDEN = new Set([...])" — the literal shape this fact depends on may have changed.`);
    err.agent_instruction = "update computeFacts()'s regex in distribution/check.mjs to match HOSTED_HIDDEN's current shape";
    throw err;
  }
  return (m[1].match(/"[^"]*"/g) ?? []).map((quoted) => quoted.slice(1, -1));
}

// Double-star-aware glob matcher for claim_surfaces, anchored to the repo root — distinct from
// both patternToMatcher (manifest_patterns: anywhere-as-suffix) and ciPathMatches (ci.yml paths:
// GitHub semantics without a mid-pattern double-star segment). A pattern like dir, double-star,
// star-dot-ext must match BOTH "dir/x.ext" (zero intervening directories) and "dir/sub/x.ext"
// (one or more) — a naive per-segment join of a double-star segment into a dot-star regex token
// would wrongly require at least one extra slash-delimited segment between it and the following
// literal, so the double-star is handled by splitting the pattern on its literal double-star
// path segment instead and joining the resulting literal chunks with an optional,
// zero-or-more-directories regex group.
function claimSurfaceMatcher(pattern) {
  const escapeLiteral = (s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const segmentToSource = (seg) => (seg === "**" ? ".*" : escapeLiteral(seg).replace(/\*/g, "[^/]*"));
  const chunkToSource = (chunk) => chunk.split("/").map(segmentToSource).join("/");
  const source = pattern.split("/**/").map(chunkToSource).join("/(?:.*/)?");
  const re = new RegExp("^" + source + "$");
  return (relPath) => re.test(relPath);
}

/** Normalizes one `claim_surfaces` entry to `{glob, fact_overrides, reason}`. A bare string is
 *  backward-compatible shorthand for `{glob: entry, fact_overrides: {}}` (no override — every
 *  claims noun checks against its plain fact key, exactly as before this entry type existed).
 *  Throws loudly on anything else so a malformed entry (e.g. a typo'd `{globb: ...}`) fails this
 *  check's own config parsing instead of silently matching nothing. */
function normalizeClaimSurface(entry) {
  if (typeof entry === "string") return { glob: entry, fact_overrides: {}, reason: undefined };
  if (entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.glob === "string") {
    const fact_overrides = entry.fact_overrides && typeof entry.fact_overrides === "object" && !Array.isArray(entry.fact_overrides) ? entry.fact_overrides : {};
    return { glob: entry.glob, fact_overrides, reason: entry.reason };
  }
  const err = new Error(`distribution/channels.json claim_surfaces entry must be a glob string or a {glob, fact_overrides?, reason?} object, got ${JSON.stringify(entry)}.`);
  err.agent_instruction = "fix the malformed claim_surfaces entry in distribution/channels.json";
  throw err;
}

// ---------------------------------------------------------------------------------------
// brief-J (2026-10-15, J3 HIGH): invert claim coverage from opt-in to opt-out.
// ---------------------------------------------------------------------------------------
// Before this round, claim_surfaces was the ONLY way a file got scanned at all — a hand-typed
// stale count anywhere NOT on that short list (npm-package/ARCHITECTURE.md:55's "15 platforms"
// vs the real 14; the whole of npm-package/skills/** and npm-package/docs/**) was structurally
// invisible, by omission, forever. The scan now covers every file `git ls-files` reports as
// TRACKED under *.md/*.html/*.txt (any depth), MINUS an explicit, per-entry-justified
// `claim_excludes` list (same shape as `known_orphans`: {glob, reason}) for the files that are
// legitimately NOT a current claim about this project's own registry — a historical changelog
// entry, a dated one-time review/evaluation report, a mirrored third-party API reference whose
// counts describe THAT API's own metric, a test fixture. `claim_surfaces` keeps its ORIGINAL
// per-glob `fact_overrides` role (a surface needing a DIFFERENT fact than the default plain one,
// e.g. hosted-server/landing's hosted-subset count) — it no longer gates which files are
// scanned at all, so a bare glob string with no override carries zero information under this
// model and has been removed from distribution/channels.json; every remaining entry there sets
// a real fact_overrides.
function listTrackedProseFiles(root) {
  try {
    // -z: NUL-terminated, UN-quoted raw-byte output. Without it, git's default core.quotepath
    // shell-quotes and octal-escapes any path containing a non-ASCII byte (e.g. this repo's own
    // "...兼容性问题报告.md") into a literal string like "a\\345\\205\\274...md" that is NOT a
    // usable relative path — reading it throws ENOENT. -z sides-steps quoting entirely.
    const out = execFileSync("git", ["ls-files", "-z", "--", "*.md", "*.html", "*.txt"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"], // suppress git's expected stderr noise when root isn't a work tree (test fixtures)
    });
    return out.split("\0").filter(Boolean);
  } catch {
    // Not inside a git work tree — the only real-world case is a synthetic test fixture built
    // in a bare temp directory (distribution/test/fixtures.mjs). Production runs (this repo,
    // CI) are always a git checkout, so this fallback never masks a real "which files exist"
    // gap in the shipped repo; it only lets the test suite enumerate its own fixture files the
    // same way `git ls-files` would if the fixture were a real repo.
    return walkRepo(root).filter((p) => /\.(?:md|html|txt)$/i.test(p));
  }
}

// brief-M (2026-10-15, M4 — "make this class impossible to miss again"): listTrackedProseFiles
// above (by design, documented in this file's own README "Claim consistency" section) only ever
// sees `git ls-files`-TRACKED files — this is exactly the gap that let 16 real claims_consistent
// failures in a brand-new, still-uncommitted distribution/README.md and distribution/research/
// channel-facts.md go completely unreported in a real local run of this gate, discovered only
// once a reviewer independently verified against a COMMITTED copy (rsync --exclude .git, git
// init, git add -A, commit). This function is the mirror image of listTrackedProseFiles: every
// file `git ls-files --others --exclude-standard` reports — tracked by NEITHER the index NOR
// .gitignore, i.e. exactly the files a local check.mjs run is currently blind to — matching the
// same *.md/*.html/*.txt filter and the same claim_excludes opt-out (a file that would be excluded
// from scanning anyway, once tracked, isn't worth warning about). Same "not a git work tree ->
// nothing to report" fallback as listTrackedProseFiles (a synthetic, non-git test fixture has no
// tracked/untracked distinction to speak of); this one returns [] rather than falling back to a
// directory walk, because there is no meaningful "untracked" status outside a git work tree.
function listUntrackedProseFiles(root) {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--others", "--exclude-standard", "--", "*.md", "*.html", "*.txt"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"], // suppress git's expected stderr noise when root isn't a work tree (test fixtures)
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return []; // not a git work tree at all — no tracked/untracked distinction exists to report
  }
}

/** Validates one `claim_excludes` entry — same "throw loudly on malformed config" posture as
 *  normalizeClaimSurface, and same "a reason is mandatory" posture as known_orphans' own
 *  legibility(known_orphan_reason) check — so a typo'd `{globb: ...}` or a reason-less exclude
 *  fails this check's OWN config parsing instead of either silently matching nothing or silently
 *  exempting a file with zero justification on record. */
function normalizeClaimExclude(entry) {
  if (entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.glob === "string") {
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      const err = new Error(`distribution/channels.json claim_excludes entry for glob ${JSON.stringify(entry.glob)} has no reason.`);
      err.agent_instruction = "add a non-empty reason to this claim_excludes entry in distribution/channels.json";
      throw err;
    }
    return entry;
  }
  const err = new Error(`distribution/channels.json claim_excludes entry must be a {glob, reason} object, got ${JSON.stringify(entry)}.`);
  err.agent_instruction = "fix the malformed claim_excludes entry in distribution/channels.json";
  throw err;
}

/** brief-M (2026-10-15, M4): every file `listUntrackedProseFiles` finds, MINUS whatever
 *  `claim_excludes` would also exempt once the file were tracked — warning about a file that
 *  wouldn't be scanned anyway (once committed) is noise, not signal. This is the exact set of
 *  files a local `node distribution/check.mjs` run is CURRENTLY blind to and that matter: `git
 *  add` (or commit) them before trusting this run to have scanned their claims. Reuses the same
 *  exclude-matcher construction as claimScanSurfaceFiles (not that function itself, which sources
 *  from listTrackedProseFiles — the TRACKED list — not the untracked one this needs). */
export function collectUntrackedProseFileWarning(root = ROOT) {
  const { channels } = loadConfig(root);
  const excludeDefs = (channels.claim_excludes ?? []).map(normalizeClaimExclude);
  const excludeMatchers = excludeDefs.map((d) => claimSurfaceMatcher(d.glob));
  return listUntrackedProseFiles(root).filter((relPath) => !excludeMatchers.some((test) => test(relPath)));
}

/** The final, opt-out-applied file list every claims_consistent scan and
 *  collectClaimsIgnoreMarkers walk shares — one definition of "which files are in scope". */
function claimScanSurfaceFiles(root, channels) {
  const excludeDefs = (channels.claim_excludes ?? []).map(normalizeClaimExclude);
  const excludeMatchers = excludeDefs.map((d) => claimSurfaceMatcher(d.glob));
  return listTrackedProseFiles(root).filter((relPath) => !excludeMatchers.some((test) => test(relPath)));
}

// brief-J (2026-10-15, J4 MEDIUM): a hand-typed count wrapped in inline emphasis/code markup
// (`**40** tools`, `<b>40</b> tools`) previously evaded both the ASCII and CJK claim regexes —
// the markup characters sit BETWEEN the digits and the noun (or around either), breaking the
// `\b(\d+)...\s*(noun)\b` adjacency the regex requires. Stripped from a WORKING COPY of each
// line before matching (the original `line` is still what's used for the marker check and for
// every reported failure's `relPath:lineNo`, so a report always shows the real file content).
// Deliberately narrow — exactly the markup tokens named in this finding — not a generic
// "strip all HTML tags" pass, which would risk eating unrelated structural markup this project
// has no reason to touch.
const INLINE_MARKUP_RE = /\*\*|__|<\/?(?:b|strong|i|em|code)>|`/gi;
function stripInlineMarkup(line) {
  return line.replace(INLINE_MARKUP_RE, "");
}

// Observed during this round's own first run (not hypothetical): hosted-server/landing's
// configure.html ships literal "1 tool" / "0 tools" seed text for a per-CATEGORY, JS-updated
// counter (e.g. the "Search" category's sidebar subtitle), and docs/TOOLS.md's "9 tools" legitimately
// describes the HOSTED_HIDDEN delta (37 total minus 28 hosted = 9), not the whole-catalog count —
// a different, also-currently-accurate metric this check has no fact for. Every real whole-catalog
// fact here is >=14, so single-digit occurrences are structurally per-category/delta/UI counters,
// not catalog-wide claims; below this threshold they are silently skipped rather than forcing every
// such line to either match a fact it was never making a claim about or carry the opt-out marker.
const MIN_CLAIM_VALUE = 10;

// brief-I (2026-10-15, I3): the original pattern required the noun DIRECTLY adjacent to the
// number ("<N> <noun>", nothing between), which missed docs/TOOLS.md's real "16 supported
// platforms (~87 operations)" instance. Allow up to 2 intervening words from this list between
// the number and the noun. DELIBERATELY NARROWER than an earlier draft that also included
// typed/dedicated/per-platform/web-data: grepping every claim_surfaces file BEFORE implementing
// (not hypothetically) found those four would have ALSO newly matched README.md:76 and
// npm-package/README.md:204's "14 typed per-platform tools" (a CORRECT, pre-existing count of
// the per-platform SCRAPER tools, wrongly checked against the 37-tool whole-catalog `tools` fact
// because the literal noun used there is "tools", not "scrapers") and
// hosted-server/landing/og-image-spec.md's stale "25 web-data tools" — three NEW failures in
// files outside this round's edit scope (distribution/**, generated manifests, chat.html:723,
// docs/TOOLS.md, llms.txt markers only), which would have broken this round's own "only
// tools.html claim failures may remain" requirement. Kept to the four words verified safe
// against every real claim_surfaces file; a future round can widen this again alongside a
// fix/marker for whichever surface that widening newly catches.
const CLAIM_ADJACENT_WORDS = "supported|working|MCP|data";
const MAX_CLAIM_ADJACENT_WORDS = 2;

// brief-I (2026-10-15, I2): a `claims` entry may carry `unit` (e.g. "个") to describe a CJK
// "<digits><unit><noun>" claim instead of the ASCII "<digits> <noun>" shape above — matched as
// "<digits><unit><=CJK_ADJACENT_CHARS non-digit characters, LAZY><noun>". The lazy, bounded
// infix (rather than the brief's own literal, strictly-adjacent "(\d+)\s*个(工具|平台|爬虫)")
// is necessary, not cosmetic: the one real instance this finding exists for
// (hosted-server/landing/chat.html's zh span) reads "26 个网络数据工具" — a short
// compound-adjective infix ("网络数据", "web-data") between the measure word and the noun, the
// same shape as its English sibling line on the same page ("28 web-data tools"). A strictly
// adjacent match would silently miss the one real case this check exists to catch. Verified
// against every CJK occurrence in every claim_surfaces file before implementing (see this
// round's returned report): every real match outside hosted-server/landing/tools.html (which is
// explicitly allowed to stay red) is either below MIN_CLAIM_VALUE or already numerically
// correct, so this bounded infix introduces zero new false positives in-repo today.
const CJK_ADJACENT_CHARS = 6;

function escapeRegExpLiteral(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// brief-I (2026-10-15, I4): "claims-ignore" previously silenced ANY claim on its line with zero
// justification required (a bare marker, or one someone meant to annotate later and forgot to).
// The marker now MUST be the exact syntax "claims-ignore: <reason>" with a reason of at least
// MIN_MARKER_REASON_LEN characters (measured after stripping a trailing HTML-comment closer and
// surrounding whitespace, so "<!-- claims-ignore: x -->" can't pad a too-short reason past the
// threshold with comment-closer characters). present:false means the line has no "claims-ignore"
// DIRECTIVE at all; present:true,valid:false means a BARE/under-justified marker was found —
// callers must treat that as a failure in its own right AND must NOT let it suppress the
// underlying claim (an invalid marker provides none of the old marker's benefit).
//
// brief-M (2026-10-15, M1 — committed-copy-only false positive, verifier found 2 instances in
// distribution/README.md itself, lines 31/212/238): the ORIGINAL version here located "present"
// by a bare `line.search(/claims-ignore/i)` — ANY occurrence of that literal substring anywhere
// on the line, including PROSE that merely *mentions* the feature name (e.g. a backticked
// `` `claims-ignore` `` in this very file's own documentation of itself). Prose like that has no
// colon immediately after the word, so it fell straight into the old code's
// `present:true, valid:false` branch — reported as an `invalid_marker` FAILURE even though the
// author never attempted a marker at all. Fixed by requiring the token to appear as an actual
// DIRECTIVE — opening an HTML comment, `<!-- claims-ignore...` (the exact, only syntax every real
// marker in this repo already uses — see every `grep -rn claims-ignore` hit outside this file and
// its own tests) — before "present" is ever true. A bare mention with no `<!--` immediately
// before it (in any amount of whitespace) is neither a marker nor an error: `present:false`, the
// line's own underlying numeric claim (if any) is still checked normally, exactly as if the
// mention weren't there. A marker that DOES open a comment but is otherwise malformed (no colon,
// or a too-short reason) still fails exactly as before — this change narrows WHAT counts as an
// attempted marker, it does not loosen validation of an actual attempt.
const MIN_MARKER_REASON_LEN = 10;
const CLAIMS_IGNORE_DIRECTIVE_RE = /<!--\s*claims-ignore/i;
export function parseClaimsIgnoreMarker(line) {
  const m = line.match(CLAIMS_IGNORE_DIRECTIVE_RE);
  if (!m) return { present: false, valid: false, reason: "" };
  const after = line.slice(m.index + m[0].length);
  const colonMatch = after.match(/^\s*:\s*(.*)$/);
  if (!colonMatch) return { present: true, valid: false, reason: "" };
  // Strip from the comment's OWN closing "-->" onward (not just when it's at the literal end
  // of the line) — a marker embedded mid-line (e.g. inside one cell of a Markdown table row,
  // with more cells following) must not let unrelated trailing text count toward the reason.
  const reason = colonMatch[1].replace(/-->[\s\S]*$/, "").trim();
  return { present: true, valid: reason.length >= MIN_MARKER_REASON_LEN, reason };
}

/** Walks every claim_surfaces-matched file and returns every currently-VALID claims-ignore
 *  marker as {relPath, line, reason} (1-based line numbers) — the "listed" half of I4's "a
 *  reviewer can see every suppression in one place" requirement. Intentionally decoupled from
 *  checkClaimsConsistent's own per-line scan (rather than having that function also return this
 *  list) so this remains a plain, always-array-returning check function callable by every
 *  existing test exactly as before; the CLI entry point below is this function's only caller
 *  beyond this module's own tests. */
export async function collectClaimsIgnoreMarkers(root = ROOT) {
  const { channels } = loadConfig(root);
  const markers = [];
  for (const relPath of claimScanSurfaceFiles(root, channels)) {
    const lines = readFileSync(join(root, relPath), "utf8").split("\n");
    lines.forEach((line, i) => {
      const marker = parseClaimsIgnoreMarker(line);
      if (marker.present && marker.valid) markers.push({ relPath, line: i + 1, reason: marker.reason });
    });
  }
  return markers;
}

/** brief-K (2026-10-15, K4 MEDIUM): `claim_excludes` silently exempts an entire glob's worth of
 *  files from claims_consistent with zero reviewer-visible signal of WHICH files, or how MANY, a
 *  given exclude actually matched today — a glob that's grown to swallow far more than its
 *  original `reason` justified (or one that now matches ZERO files, meaning its justification may
 *  be stale/no-op) is otherwise invisible. Mirrors collectClaimsIgnoreMarkers's own "informational,
 *  not a check" posture exactly: same claimScanSurfaceFiles-derived file list, one entry per
 *  configured exclude, printed unconditionally by the CLI below regardless of pass/fail. Uses
 *  `listTrackedProseFiles` directly (not `claimScanSurfaceFiles`, which already has excludes
 *  APPLIED) because the whole point is counting how many tracked files EACH exclude glob matches
 *  BEFORE exclusion — `claimScanSurfaceFiles`'s own output would always show 0 matches per glob
 *  by construction. */
export async function collectClaimExcludeSummary(root = ROOT) {
  const { channels } = loadConfig(root);
  const excludeDefs = (channels.claim_excludes ?? []).map(normalizeClaimExclude);
  const allTracked = listTrackedProseFiles(root);
  return excludeDefs.map((def) => {
    const matcher = claimSurfaceMatcher(def.glob);
    const matchedCount = allTracked.filter((relPath) => matcher(relPath)).length;
    return { glob: def.glob, reason: def.reason, matchedCount };
  });
}

export async function checkClaimsConsistent(ctx) {
  const { channels, root } = ctx;
  const rawSurfaces = channels.claim_surfaces ?? [];
  const claims = channels.claims ?? [];
  // brief-J J3: claim_surfaces no longer gates WHICH files are scanned (claimScanSurfaceFiles
  // below scans every git-tracked *.md/*.html/*.txt file minus claim_excludes regardless of
  // whether claim_surfaces has any entries at all) — an empty claim_surfaces now means "no
  // fact_overrides anywhere", not "scan nothing". Only an empty `claims` table (nothing to ever
  // check a number against) makes this check a no-op.
  if (claims.length === 0) return [];

  const facts = await computeFacts(root);
  const surfaceDefs = rawSurfaces.map(normalizeClaimSurface);

  // A fact_overrides value that doesn't name a real computeFacts() key is a config error, not a
  // claims mismatch — fail loudly here, before scanning a single file, rather than silently
  // falling back to the un-overridden fact (which would hide a hosted-only surface being checked
  // against the whole-catalog total it was explicitly configured NOT to be checked against).
  for (const def of surfaceDefs) {
    for (const [noun, factKey] of Object.entries(def.fact_overrides)) {
      if (!(factKey in facts)) {
        const err = new Error(
          `distribution/channels.json claim_surfaces[glob=${JSON.stringify(def.glob)}].fact_overrides[${JSON.stringify(noun)}] = ${JSON.stringify(factKey)} is not a fact computeFacts() produces (known facts: ${Object.keys(facts).join(", ")}).`
        );
        err.agent_instruction = "fix the fact key in this claim_surfaces entry in distribution/channels.json, or add the missing fact to computeFacts() in distribution/check.mjs";
        throw err;
      }
    }
  }

  const matchers = surfaceDefs.map((def) => ({ def, test: claimSurfaceMatcher(def.glob) }));
  const nounToFact = claims.map(({ noun_pattern, fact }) => ({ re: new RegExp(`^${noun_pattern}$`, "i"), fact }));

  // brief-I I2: a CJK claim ("unit" set) uses a completely different shape from an ASCII one
  // (no word boundaries around CJK characters, a measure-word prefix instead of a trailing
  // plural "s") — scanned with its own regex, grouped by `unit` (today every CJK claim shares
  // "个", but a future claim with a different unit gets its own group automatically, not a new
  // code branch). asciiClaims/claimLineRe below is unchanged in spirit from before I3, just with
  // the bounded adjacent-word allowance inserted as a non-capturing group (group indices 1/2/3 —
  // number/plus/noun — stay exactly where every downstream reference to m[1]/m[2]/m[3] expects).
  const asciiClaims = claims.filter((c) => !c.unit);
  const claimLineRe =
    asciiClaims.length > 0
      ? new RegExp(
          `\\b(\\d+)(\\+)?\\s*(?:(?:${CLAIM_ADJACENT_WORDS})\\s+){0,${MAX_CLAIM_ADJACENT_WORDS}}(${asciiClaims.map((c) => c.noun_pattern).join("|")})\\b`,
          "gi"
        )
      : null;
  const cjkUnitGroups = new Map();
  for (const c of claims) {
    if (!c.unit) continue;
    if (!cjkUnitGroups.has(c.unit)) cjkUnitGroups.set(c.unit, []);
    cjkUnitGroups.get(c.unit).push(c);
  }
  const cjkClaimRes = [...cjkUnitGroups.entries()].map(
    ([unit, group]) => new RegExp(`(\\d+)(\\+)?\\s*${escapeRegExpLiteral(unit)}[^\\d]{0,${CJK_ADJACENT_CHARS}}?(${group.map((c) => c.noun_pattern).join("|")})`, "g")
  );

  function recordClaimMatch(relPath, lineNo, line, overrides, nounMatched, n, failures) {
    if (n < MIN_CLAIM_VALUE) return;
    const mapping = nounToFact.find((nf) => nf.re.test(nounMatched));
    if (!mapping) return; // defensive: shouldn't happen, both regexes are built from the same claims table
    const factKey = overrides[mapping.fact] ?? mapping.fact; // per-surface fact scope (brief-H), default = this noun's plain fact
    const expected = facts[factKey];
    if (expected === undefined) return; // defensive: a claims row (or a validated override above) references an unknown fact key
    if (n !== expected) {
      failures.push(
        `${relPath}:${lineNo}: rule=claims_consistent noun=${JSON.stringify(nounMatched)} fact=${factKey} got=${n} want=${expected} ` +
          `fix="update the stated count to match the built registry, or add the literal 'claims-ignore: <reason>' marker on this line if it legitimately describes a different/historical number"`
      );
    }
  }

  const failures = [];
  // brief-J J3: scan every git-tracked *.md/*.html/*.txt file (minus claim_excludes) — see
  // claimScanSurfaceFiles — not just the files claim_surfaces used to opt in. A path that
  // matches no claim_surfaces entry gets `overrides = {}` (every noun checks its plain fact,
  // the pre-existing default behavior), exactly as a bare-string claim_surfaces entry used to
  // mean before this round.
  for (const relPath of claimScanSurfaceFiles(root, channels)) {
    const matchedDefs = matchers.filter((m) => m.test(relPath)).map((m) => m.def);
    // Merge every matching surface entry's fact_overrides for this path (later entries win on a
    // key collision) — claim_surfaces globs don't overlap in practice today, but a path matching
    // more than one entry should never silently use only the first one's overrides.
    const overrides = Object.assign({}, ...matchedDefs.map((d) => d.fact_overrides));
    const abs = join(root, relPath);
    const lines = readFileSync(abs, "utf8").split("\n");
    lines.forEach((line, i) => {
      // brief-I I4: a marker present but INVALID (bare, or reason < MIN_MARKER_REASON_LEN) must
      // never silently suppress the claim it sits next to — it is itself reported as a failure,
      // and scanning for the underlying claim below proceeds exactly as if no marker were there.
      const marker = parseClaimsIgnoreMarker(line);
      if (marker.present && marker.valid) return; // justified, explicit per-line opt-out
      if (marker.present && !marker.valid) {
        failures.push(
          `${relPath}:${i + 1}: rule=claims_consistent(invalid_marker) fix="a bare 'claims-ignore' marker has no justification and does not suppress this line's claim — use the exact syntax 'claims-ignore: <reason>' with a reason of at least ${MIN_MARKER_REASON_LEN} characters"`
        );
      }

      // brief-J J4: strip inline emphasis/code markup (**bold**, __bold__, <b>/<strong>/<i>/<em>/
      // <code> tags, backticks) from a WORKING COPY before matching — "**40** tools" and
      // "<b>40</b> tools" previously evaded both regexes below because the markup characters sit
      // between the digits and the noun. The marker check above and every failure's reported
      // relPath:lineNo still use the ORIGINAL `line`, so a report always shows the real content.
      const scanLine = stripInlineMarkup(line);

      if (claimLineRe) {
        claimLineRe.lastIndex = 0;
        let m;
        while ((m = claimLineRe.exec(scanLine))) recordClaimMatch(relPath, i + 1, line, overrides, m[3], Number(m[1]), failures);
      }
      for (const cjkRe of cjkClaimRes) {
        cjkRe.lastIndex = 0;
        let m;
        while ((m = cjkRe.exec(scanLine))) recordClaimMatch(relPath, i + 1, line, overrides, m[3], Number(m[1]), failures);
      }
    });
  }
  return failures;
}

// ---------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------
const CHECK_FNS = {
  version_equal: checkVersionEqual,
  generated_clean: checkGeneratedClean,
  no_orphans: checkNoOrphans,
  location_rules: checkLocationRules,
  legibility: checkLegibility,
  endpoint_equal: checkEndpointEqual,
  field_shape: checkFieldShape,
  closed_shape: checkClosedShape,
  shape_declared: checkShapeDeclared,
  tamper_evident: checkTamperEvident,
  ci_paths_cover: checkCiPathsCover,
  claims_consistent: checkClaimsConsistent,
  json_no_duplicate_keys: checkJsonNoDuplicateKeys,
};

/**
 * Runs every check (unless listed in `skip`) and returns [{name, failures}]. `skip` exists
 * ONLY for distribution/test/*.test.mjs's mutation probe (brief-A PHASE 5's "temporarily
 * disable check c") — the CLI entrypoint below always calls this with skip empty, so there is
 * no runtime flag that can silently disable a check in a real run.
 *
 * async since brief-F's claims_consistent needs a dynamic `import()` of the built tool registry
 * (same reason generate.mjs's loadCoreTools() is async) — every synchronous CHECK_FNS entry's
 * plain array return still `await`s to itself with zero behavior change.
 */
export async function runChecks(root = ROOT, { skip = new Set() } = {}) {
  const ctx = loadConfig(root);
  const results = [];
  for (const name of CHECK_NAMES) {
    if (skip.has(name)) {
      results.push({ name, failures: [], skipped: true });
      continue;
    }
    results.push({ name, failures: await CHECK_FNS[name](ctx), skipped: false });
  }
  return results;
}

// isMain(): "is this exact file the process's CLI entry point" (as opposed to being imported
// as a library by check.test.mjs, or by generate.mjs's own isMain() check for a DIFFERENT
// file). MUST compare realpaths, not raw path strings: Node's ESM loader resolves the entry
// module's `import.meta.url` through any symlinks in its path, but `process.argv[1]` is the
// literal, unresolved argv string the shell/caller passed in. On macOS, `os.tmpdir()` itself
// is behind a symlink (/tmp -> private/tmp, /var -> private/var) and any CI/dev setup that
// checks out this repo under a symlinked path hits the same thing: a naive string comparison
// between a raw argv[1]-derived URL and import.meta.url silently returns false, this `if`
// block never runs, NOTHING is printed, and the process exits 0 by default (JS without
// `--test` or any error has 0 as the natural implicit exit code) — a drift gate that is
// supposed to fail a bad repo state instead passes it, in total silence. Found by an
// independent reviewer during brief-A2 (2026-10-15); reproduced directly on this machine:
// `node /tmp/<dir>/check.mjs` (argv[1] keeps the literal /tmp prefix) vs this same file's own
// `import.meta.url` (resolved to /private/tmp/...) compared unequal before this fix.
function isMain() {
  if (!process.argv[1]) return false;
  let invokedPath;
  try {
    invokedPath = realpathSync(resolve(process.argv[1]));
  } catch {
    invokedPath = resolve(process.argv[1]); // argv[1] doesn't literally exist on disk; fall through to a direct compare below
  }
  let selfPath;
  try {
    selfPath = realpathSync(fileURLToPath(import.meta.url));
  } catch {
    selfPath = fileURLToPath(import.meta.url);
  }
  if (invokedPath === selfPath) return true;
  // Last-resort fallback for the (pre-fix) exact literal-string match, kept so a caller that
  // somehow can't realpath either side (e.g. a restrictive sandbox) still gets the old
  // behavior rather than a hard crash.
  return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

// Defense-in-depth, independent of the realpath fix above: if argv[1] has the exact same
// FILENAME as this module but isMain() still said "not main" (a future path-resolution edge
// case this round's fix did not anticipate), never let that resolve to silence — a check
// script that can silently no-op on a CLI invocation is a worse failure mode than one that
// errors loudly. This can only trigger when argv[1]'s basename is literally "check.mjs"
// (i.e. someone ran `node .../check.mjs` directly); importing check.mjs as a library (every
// *.test.mjs file, which has a different basename) never matches this condition.
function looksLikeDirectInvocationButIsNotMain() {
  if (!process.argv[1] || isMain()) return false;
  return basename(resolve(process.argv[1])) === basename(fileURLToPath(import.meta.url));
}

if (isMain()) {
  // brief-F R5 (2026-10-15): previously uncaught — a missing/malformed distribution/channels.json,
  // distribution/listing.json, or npm-package/package.json (loadConfig's three reads) threw a raw
  // Node stack trace with no indication of WHICH file or WHAT to do about it. Matches
  // generate.mjs's existing CLI error-handling shape exactly: one `[check] FATAL <reason> fix=
  // <hint>` line + exit 1, never a bare stack trace.
  let results;
  try {
    results = await runChecks(ROOT);
  } catch (err) {
    const hint =
      err.agent_instruction ??
      "ensure distribution/channels.json, distribution/listing.json, and npm-package/package.json all exist and parse as valid JSON";
    console.error(`[check] FATAL ${err.message} fix=${hint}`);
    process.exit(1);
  }
  let anyFail = false;
  for (const { name, failures, skipped } of results) {
    if (skipped) {
      console.log(`[check] ${name}: SKIPPED`);
      continue;
    }
    if (failures.length === 0) {
      console.log(`[check] ${name}: PASS`);
    } else {
      anyFail = true;
      for (const f of failures) console.error(`[check] ${name}: FAIL ${f}`);
    }
  }
  // brief-I I4: print every currently-VALID claims-ignore marker so a reviewer sees every
  // suppression in one place, independent of pass/fail — this is informational, not a check.
  try {
    const markers = await collectClaimsIgnoreMarkers(ROOT);
    console.log(`[check] claims_consistent: ${markers.length} claims-ignore markers in use`);
    for (const m of markers) console.log(`[check] claims_consistent:   ${m.relPath}:${m.line} — ${m.reason}`);
  } catch (err) {
    console.error(`[check] claims_consistent: could not list claims-ignore markers in use — ${err.message}`);
  }
  // brief-K K4 (2026-10-15): print every claim_excludes entry's glob, reason, and how many
  // currently-tracked files it matches, unconditionally — same "informational, not a check"
  // posture as the markers summary above.
  try {
    const excludes = await collectClaimExcludeSummary(ROOT);
    console.log(`[check] claims_consistent: ${excludes.length} claim_excludes entries in use`);
    for (const e of excludes) console.log(`[check] claims_consistent:   exclude=${JSON.stringify(e.glob)} matched=${e.matchedCount} reason=${e.reason}`);
  } catch (err) {
    console.error(`[check] claims_consistent: could not list claim_excludes summary — ${err.message}`);
  }
  // brief-M (2026-10-15, M4): warn, unconditionally when non-empty, about every UNTRACKED file
  // claims_consistent cannot currently see at all — the exact mechanism that let 16 real failures
  // in a brand-new distribution/README.md and distribution/research/channel-facts.md go
  // unreported in every real local run of this gate before this round. Printed via console.warn
  // (not console.log, unlike the two informational summaries above) because, unlike those two,
  // this one names a genuine local-verification gap, not just an audit trail — but it still never
  // fails the check or changes the exit code: CI always runs against a fully-tracked checkout (see
  // this file's own README "Claim consistency" section), so this can only ever fire on a local,
  // uncommitted working tree, exactly like listTrackedProseFiles' own git-ls-files fallback.
  try {
    const untracked = await collectUntrackedProseFileWarning(ROOT);
    if (untracked.length > 0) {
      console.warn(`[check] claims_consistent: WARNING ${untracked.length} untracked prose file(s) not scanned: ${untracked.join(", ")}`);
    }
  } catch (err) {
    console.error(`[check] claims_consistent: could not check for untracked prose files — ${err.message}`);
  }
  // brief-K K1 (2026-10-15): print every pinned-hashes.json entry whose hash differs from the
  // version at `git merge-base HEAD origin/main`, so a reviewer always sees "these hand-authored
  // manifests changed in this branch" — never fails on the ref being unavailable, just reports
  // the summary as skipped.
  try {
    const summary = computePinnedHashesBranchSummary(ROOT);
    if (summary.skipped) {
      console.log(`[check] tamper_evident(branch-summary): skipped — ${summary.reason}`);
    } else if (summary.changed.length === 0) {
      console.log(`[check] tamper_evident(branch-summary): no pinned-hashes.json entries changed since merge-base ${summary.mergeBase}`);
    } else {
      console.log(
        `[check] tamper_evident(branch-summary): ${summary.changed.length} hand-authored manifest(s) changed in this branch (merge-base ${summary.mergeBase}):`
      );
      for (const c of summary.changed) {
        console.log(`[check] tamper_evident(branch-summary):   ${c.rowId} ${c.baseSha ?? "(none — new pin)"} -> ${c.headSha}`);
      }
    }
  } catch (err) {
    console.error(`[check] tamper_evident(branch-summary): could not compute — ${err.message}`);
  }
  process.exit(anyFail ? 1 : 0);
} else if (looksLikeDirectInvocationButIsNotMain()) {
  console.error(
    `[check] ERROR: process.argv[1] (${process.argv[1]}) has this module's exact filename but failed entry-point identity verification — refusing to silently exit 0. No checks were run. This may indicate a path-resolution edge case (e.g. a different file sharing this basename was actually executed); investigate before trusting any other result from this invocation.`
  );
  process.exit(1);
}
