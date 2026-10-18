// distribution/test/generate.test.mjs — unit coverage for generate.mjs's format-agnostic
// JSON-pointer / top-level-YAML-key helpers, plus an idempotency check on the writer path
// (computeWrites() against the green fixture reports zero changes; a single-field mutation
// reports exactly one changed write).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getJsonPointer, getYamlTopLevelValue, computeWrites } from "../generate.mjs";
import { buildGreenFixture, cloneFixture, cleanupFixture, readJson, writeJson } from "./fixtures.mjs";

let GREEN_ROOT;
test.before(() => {
  GREEN_ROOT = buildGreenFixture();
});
test.after(() => {
  cleanupFixture(GREEN_ROOT);
});

test("getJsonPointer: resolves a nested array-index pointer", () => {
  const obj = { plugins: [{ name: "novada-mcp", description: "x" }] };
  assert.equal(getJsonPointer(obj, "/plugins/0/name"), "novada-mcp");
  assert.equal(getJsonPointer(obj, "/plugins/0/description"), "x");
});

test("getJsonPointer: returns undefined for a missing path instead of throwing", () => {
  const obj = { a: { b: 1 } };
  assert.equal(getJsonPointer(obj, "/a/c"), undefined);
  assert.equal(getJsonPointer(obj, "/z/y/x"), undefined);
});

test("getYamlTopLevelValue: reads an unindented top-level key, unquoting it", () => {
  const src = ['name: novada-mcp', 'description: "Hello world"', "startCommand:", "  type: stdio"].join("\n");
  assert.equal(getYamlTopLevelValue(src, "name"), "novada-mcp");
  assert.equal(getYamlTopLevelValue(src, "description"), "Hello world");
});

test("getYamlTopLevelValue: ignores an indented (nested) key of the same name", () => {
  const src = [
    'description: "top level"',
    "tools:",
    "  - name: x",
    '    description: "nested, must not be returned by a top-level lookup"',
  ].join("\n");
  assert.equal(getYamlTopLevelValue(src, "description"), "top level");
});

test("computeWrites: reports zero changes against an already-green fixture", () => {
  const writes = computeWrites(GREEN_ROOT);
  const changed = writes.filter((w) => w.changed);
  assert.deepEqual(changed, [], `expected no drift, got: ${JSON.stringify(changed.map((w) => w.relPath))}`);
});

test("computeWrites: reports exactly one changed write after mutating one owned field", () => {
  const root = cloneFixture(GREEN_ROOT);
  try {
    const pj = readJson(root, "npm-package/.claude-plugin/plugin.json");
    pj.description = "drifted";
    writeJson(root, "npm-package/.claude-plugin/plugin.json", pj);

    const writes = computeWrites(root);
    const changed = writes.filter((w) => w.changed);
    assert.equal(changed.length, 1, `expected exactly 1 changed write, got: ${JSON.stringify(changed.map((w) => w.relPath))}`);
    assert.equal(changed[0].relPath, "npm-package/.claude-plugin/plugin.json");
  } finally {
    cleanupFixture(root);
  }
});

test("yaml-owned-fields writer leaves an indented same-named field untouched", () => {
  const smitheryPath = join(GREEN_ROOT, "npm-package", "smithery.yaml");
  const raw = readFileSync(smitheryPath, "utf8");
  assert.match(raw, /16 platforms mentioned here on purpose/, "fixture's nested tool description should be untouched by the yaml writer");
});
