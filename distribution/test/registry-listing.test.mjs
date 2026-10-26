// Registry listing metadata (2026-10-26): server.json's `title` and `websiteUrl` are hand-authored,
// user-visible listing values (owner-approved copy). closed_shape allowlists both keys and
// pinned_fields pins their exact values, so a drifted or tampered value must fail the check —
// and the pin must still catch it after a --repin launders tamper_evident's whole-file hash.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runChecks } from "../check.mjs";
import { readPinnedHashes, repinRow } from "../generate.mjs";
import { buildGreenFixture, cloneFixture, cleanupFixture, readJson, writeJson } from "./fixtures.mjs";

let GREEN_ROOT;
test.before(() => {
  GREEN_ROOT = buildGreenFixture();
});
test.after(() => {
  cleanupFixture(GREEN_ROOT);
});

function findResult(results, name) {
  const r = results.find((x) => x.name === name);
  assert.ok(r, `no result for check "${name}"`);
  return r;
}

const totalFailures = (results) => results.reduce((n, r) => n + r.failures.length, 0);

test("green fixture: server.json carries the pinned title and websiteUrl and passes every check", async () => {
  const results = await runChecks(GREEN_ROOT);
  assert.equal(totalFailures(results), 0, JSON.stringify(results, null, 2));
});

// One row per pinned listing field — extending coverage is a new row, not a new test.
const LISTING_FIELDS = [
  { key: "title", pointer: "/title", tampered: "Novada MCP (unofficial fork)" },
  { key: "websiteUrl", pointer: "/websiteUrl", tampered: "https://evil.example/?utm_source=mcpregistry" },
];

for (const { key, pointer, tampered } of LISTING_FIELDS) {
  test(`attack: server.json ${key} tampered — PREDICTED exactly 2 failures (closed_shape(pinned) + tamper_evident)`, async () => {
    const root = cloneFixture(GREEN_ROOT);
    try {
      const sj = readJson(root, "npm-package/server.json");
      sj[key] = tampered;
      writeJson(root, "npm-package/server.json", sj);

      const results = await runChecks(root);
      assert.equal(totalFailures(results), 2, JSON.stringify(results, null, 2));
      const cs = findResult(results, "closed_shape");
      assert.equal(cs.failures.length, 1);
      assert.match(cs.failures[0], /closed_shape\(pinned\)/);
      assert.ok(cs.failures[0].includes(`pointer=${pointer}`), cs.failures[0]);
      assert.equal(findResult(results, "tamper_evident").failures.length, 1);
    } finally {
      cleanupFixture(root);
    }
  });

  test(`attack: server.json ${key} tampered then --repin — the pin alone still catches it (exactly 1 failure)`, async () => {
    const root = cloneFixture(GREEN_ROOT);
    try {
      const sj = readJson(root, "npm-package/server.json");
      sj[key] = tampered;
      writeJson(root, "npm-package/server.json", sj);
      const registryRow = readJson(root, "distribution/channels.json").rows.find((r) => r.id === "mcp-registry");
      const pinned = readPinnedHashes(root);
      repinRow(root, registryRow, pinned);
      writeJson(root, "distribution/pinned-hashes.json", pinned);

      const results = await runChecks(root);
      assert.equal(totalFailures(results), 1, JSON.stringify(results, null, 2));
      assert.equal(findResult(results, "tamper_evident").failures.length, 0);
      assert.ok(findResult(results, "closed_shape").failures[0].includes(`pointer=${pointer}`));
    } finally {
      cleanupFixture(root);
    }
  });

  test(`mirror: server.json without ${key} is caught (a pin is "must exist with exactly this value")`, async () => {
    const root = cloneFixture(GREEN_ROOT);
    try {
      const sj = readJson(root, "npm-package/server.json");
      delete sj[key];
      writeJson(root, "npm-package/server.json", sj);

      const results = await runChecks(root);
      const cs = findResult(results, "closed_shape");
      assert.ok(cs.failures.some((f) => f.includes(`pointer=${pointer}`)), JSON.stringify(cs, null, 2));
    } finally {
      cleanupFixture(root);
    }
  });
}
