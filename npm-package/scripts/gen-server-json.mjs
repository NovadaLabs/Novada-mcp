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

const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
const serverJson = JSON.parse(readFileSync(SERVER_JSON_PATH, "utf8"));

const { TOOLS } = await import(pathToFileURL(CORE_JS_PATH).href);

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
serverJson.description =
  "Search the web (Google, DuckDuckGo, Yandex), extract any URL, crawl, map, multi-step research, scrape 16 platforms, browser automation, proxy routing — one API key.";
serverJson.tools = TOOLS.map((t) => ({ name: t.name, description: shortDescription(t.description) }));

writeFileSync(SERVER_JSON_PATH, JSON.stringify(serverJson, null, 2) + "\n");
console.log(`gen-server-json: wrote ${SERVER_JSON_PATH} — v${pkg.version}, ${serverJson.tools.length} tools`);
