/**
 * Gateway footer placement — api/_footer.ts (pure helper, same import convention as
 * telemetry.test.mjs: Node's built-in type stripping, mcp.ts itself is never imported).
 *
 * Bug: the "---\ngateway: ..." footer was concatenated onto every result text, so a
 * format=json result no longer parsed with JSON.parse. JSON results must get the footer
 * as a SECOND text block; non-JSON keeps the single-block concatenation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { appendGatewayFooter, isJsonText } from "../api/_footer.ts";

const FOOTER = "\n\n---\ngateway: free call — no quota consumed";

test("JSON object result: footer is a separate block and block 0 still parses", () => {
  const body = JSON.stringify({ ok: true, items: [1, 2] }, null, 2);
  const out = appendGatewayFooter([{ type: "text", text: body }], FOOTER);
  assert.equal(out.length, 2);
  assert.deepEqual(JSON.parse(out[0].text), { ok: true, items: [1, 2] });
  assert.match(out[1].text, /^---\ngateway: /);
});

test("JSON array result (with surrounding whitespace) is also split", () => {
  const out = appendGatewayFooter([{ type: "text", text: "  \n[1,2,3]\n" }], FOOTER);
  assert.equal(out.length, 2);
  assert.deepEqual(JSON.parse(out[0].text), [1, 2, 3]);
});

test("markdown result keeps single-block concatenation (historical behavior)", () => {
  const out = appendGatewayFooter([{ type: "text", text: "## Results\n- a" }], FOOTER);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "## Results\n- a" + FOOTER);
});

test("text that merely starts with { but is not JSON is NOT split", () => {
  const out = appendGatewayFooter([{ type: "text", text: "{not json at all" }], FOOTER);
  assert.equal(out.length, 1);
  assert.ok(out[0].text.endsWith(FOOTER));
  assert.equal(isJsonText("{not json at all"), false);
});

test("a later block (first-run notice) is preserved after the footer", () => {
  const out = appendGatewayFooter(
    [{ type: "text", text: '{"a":1}' }, { type: "text", text: "NOTICE" }],
    FOOTER,
  );
  assert.equal(out.length, 3);
  assert.equal(out[2].text, "NOTICE");
});

test("empty content array does not throw (error path: no result block)", () => {
  const out = appendGatewayFooter([], FOOTER);
  assert.equal(out.length, 1);
  assert.match(out[0].text, /^---\ngateway:/);
});

test("mcp.ts wires every footer site through appendGatewayFooter (no raw concatenation)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(__dirname, "..", "api", "mcp.ts"), "utf8");
  assert.ok(src.includes('from "./_footer.js"'));
  assert.ok(!/\+\s*(statusFooter|discoverFooter|setupFooter)\b/.test(src), "footer must not be concatenated directly");
  assert.equal((src.match(/appendGatewayFooter\(/g) ?? []).length, 3);
});
