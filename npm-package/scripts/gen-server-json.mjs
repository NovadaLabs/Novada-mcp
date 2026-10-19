#!/usr/bin/env node
// gen-server-json.mjs — regenerate server.json FROM package.json + the built tool registry.
//
//   package.json (version) and build/core.js's `TOOLS` export are the sources of truth
//   for the fields this script owns. server.json's `version`, `tools`, and top-level
//   `description` are DERIVED — never hand-edit them (this script overwrites them on
//   every build, so hand edits get clobbered). Every other top-level field ($schema,
//   name, repository, prompts, resources, skills, categories, topics, packages) is
//   hand-authored and PRESERVED as-is — this script does not touch them.
//
//   Runs after `tsc` in the `build` npm script, since it imports the COMPILED
//   build/core.js (not src/core.ts) — build/ must exist.
//
// No dependencies. Node >= 18.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = join(ROOT, "package.json");
const SERVER_JSON_PATH = join(ROOT, "server.json");
const CORE_JS_PATH = join(ROOT, "build", "core.js");
const SCRAPER_CATALOG_JS_PATH = join(ROOT, "build", "data", "scraper_catalog.js");

const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
const serverJson = JSON.parse(readFileSync(SERVER_JSON_PATH, "utf8"));

const { TOOLS } = await import(pathToFileURL(CORE_JS_PATH).href);
// brief-F R7 (2026-10-15): the platform count below used to be a hand-typed "16" that drifted
// from the registry (ground truth is 14 working platforms — see
// npm-package/src/data/scraper_catalog.ts's WORKING_PLATFORM_NAMES, the same export the live
// novada_scrape tool description itself is built from). Import it here too so this script's
// description can never drift from the registry again — the only remaining literal is the fixed
// prose shell, not the count.
const { WORKING_PLATFORM_NAMES } = await import(pathToFileURL(SCRAPER_CATALOG_JS_PATH).href);

// Abbreviations that end in a period but are NOT sentence boundaries — a naive
// /[.!?]\s+/ split treats "Google (incl. Shopping)" as two sentences without
// this exclusion list, truncating the description mid-phrase.
const ABBREVIATIONS = new Set([
  "e.g.", "i.e.", "etc.", "incl.", "vs.", "approx.", "no.",
  "Inc.", "Corp.", "Ltd.", "Mr.", "Mrs.", "Dr.",
]);

/** Split `text` into sentences, skipping false sentence-boundaries at known abbreviations. */
function splitSentences(text) {
  const sentences = [];
  let start = 0;
  const boundary = /[.!?]+(?=\s|$)/g;
  let match;
  while ((match = boundary.exec(text))) {
    const end = match.index + match[0].length;
    const candidate = text.slice(start, end);
    // Strip leading non-letter chars (e.g. the "(" in "Google (incl.") before
    // matching against ABBREVIATIONS, so a parenthetical abbreviation is still
    // recognized as a false boundary.
    const lastWord = (candidate.trim().split(/\s+/).pop() ?? "").replace(/^[^a-zA-Z]+/, "");
    if (ABBREVIATIONS.has(lastWord)) continue; // false boundary — keep scanning
    sentences.push(candidate.trim());
    start = end;
  }
  if (start < text.length) sentences.push(text.slice(start).trim());
  return sentences.filter(Boolean);
}

// Catalog-facing tool description: the first sentence/line of the tool's full
// (multi-paragraph) description, trimmed to ~1-2 sentences with newlines
// collapsed — server.json is a short catalog listing, not the full inputSchema
// description an agent sees when it actually calls the tool.
function shortDescription(full) {
  const firstLine = full.split("\n")[0].trim();
  const sentences = splitSentences(firstLine);
  return (sentences.slice(0, 2).join(" ") || firstLine).trim();
}

serverJson.version = pkg.version;
// Keep packages[].version in lockstep with the top-level version — it is the
// registry-critical "which npm version to install" field and must never drift from it.
if (Array.isArray(serverJson.packages)) {
  for (const p of serverJson.packages) {
    if (p && typeof p === "object" && "version" in p) p.version = pkg.version;
  }
}
// Kept to <=100 chars — the official MCP registry schema's server.json `description`
// field has maxLength:100 (verified live against
// https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json with ajv,
// 2026-09-03: the prior 164-char string here was schema-INVALID, meaning every
// `npm run build` silently reintroduced a registry-blocking server.json). Update this
// string only if you also re-run the ajv check — see
// tests/consistency/server-json-descriptions.test.ts, which now asserts the length bound.
//
// The platform COUNT is derived from WORKING_PLATFORM_NAMES.length (brief-F R7, 2026-10-15) —
// everything else in this sentence stays the fixed prose shell this round's invariant forbids
// changing further. Same digit-width (2 digits) both before and after this fix, so the length
// bound above is unaffected; re-verify with the ajv test above if that ever stops being true.
//
// brief-N (2026-10-19, D1): this ONE server.json listing carries BOTH a local `packages[]`
// entry (stdio, runs the full npm package — HAS browser automation) AND a hosted `remotes[]`
// entry (streamable-http at mcp.novada.com — does NOT, see hosted-server/vercel/api/mcp.ts's
// HOSTED_HIDDEN). The prior wording ("...browser automation, proxy...") was unconditionally
// true only for the local package and silently overclaimed for the remote entry — an
// independent review's HIGH finding. "browser via npm" scopes the claim to the ONE install
// path that actually has it, so this single description stays true for both without needing
// two separate server.json listings. distribution/check.mjs's surface_claims check enforces
// the equivalent per-row rule for every OTHER channel's manifest (see distribution/
// channels.json's row.surface); this script's own template is exempt from that check (it is
// this field's sole owner, per description_derived_reason in that row) but is held to the
// same truthfulness bar by hand, here.
serverJson.description =
  `Search, extract, crawl, map, research, scrape ${WORKING_PLATFORM_NAMES.length} platforms, proxy, browser via npm — one API key.`;
serverJson.tools = TOOLS.map((t) => ({ name: t.name, description: shortDescription(t.description) }));

writeFileSync(SERVER_JSON_PATH, JSON.stringify(serverJson, null, 2) + "\n");
console.log(`gen-server-json: wrote ${SERVER_JSON_PATH} — v${pkg.version}, ${serverJson.tools.length} tools`);
