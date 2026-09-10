/**
 * F12/F13 regression pins (Path C error matrix, 2026-09-10 audit —
 * novada-mcp/reports/novada-mcp-eval-path-c-error-matrix-2026-09-10.md).
 *
 * F13 — tool-NAME resolution must run BEFORE the API-key gate:
 *   keyless `novada_ghost_tool` / `novada_serch` used to return
 *   Error [INVALID_API_KEY] (the auth gate answered before name resolution).
 *   Pinned here: unknown tool → unknown-tool error (with close-name suggestion
 *   when cheap) in BOTH key states, and the refusal text is IDENTICAL across
 *   key states.
 *
 * F12 — key handling must be consistent and disclosed per tool CLASS:
 *   key_required tools refuse keyless callers locally (unchanged);
 *   novada_extract's basic direct fetch is an explicit unauthenticated tier,
 *   but an EXPLICIT render/browser escalation request still requires a key
 *   and refuses locally when keyless.
 *
 * Genuine end-to-end pins (real JSON-RPC over stdio via the MCP SDK's own
 * Client + StdioClientTransport, same harness as 2026-09-02-f-probe-replay).
 * Every probe below resolves locally — no network call is ever made.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VITE_NODE_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "vite-node");
const INDEX_TS = path.join(REPO_ROOT, "src", "index.ts");

/** Syntactically plausible but non-functional — never reaches the network here. */
const INVALID_KEY = "sk-test-invalid-0000000000000000";

async function spawnClient(env: Record<string, string> = {}): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [VITE_NODE_BIN, INDEX_TS],
    env: { ...getDefaultEnvironment(), NOVADA_API_KEY: "", ...env },
    cwd: REPO_ROOT,
  });
  const client = new Client({ name: "f12-f13-gate-order", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, close: () => transport.close() };
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n---\n");
}

describe("F13: tool-name resolution runs before the API-key gate", () => {
  let keyless: { client: Client; close: () => Promise<void> };
  let invalidKey: { client: Client; close: () => Promise<void> };

  beforeAll(async () => {
    keyless = await spawnClient();
    invalidKey = await spawnClient({ NOVADA_API_KEY: INVALID_KEY });
  }, 30_000);

  afterAll(async () => {
    await keyless?.close();
    await invalidKey?.close();
  });

  it("keyless novada_ghost_tool → unknown-tool error, NOT INVALID_API_KEY", async () => {
    const res = await keyless.client.callTool({ name: "novada_ghost_tool", arguments: {} });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("Unknown tool");
    expect(text).not.toContain("INVALID_API_KEY");
    expect(text).not.toContain("NOVADA_API_KEY is not set");
  }, 15_000);

  it("invalid-key novada_ghost_tool → IDENTICAL unknown-tool error as keyless", async () => {
    const [a, b] = await Promise.all([
      keyless.client.callTool({ name: "novada_ghost_tool", arguments: {} }),
      invalidKey.client.callTool({ name: "novada_ghost_tool", arguments: {} }),
    ]);
    expect(a.isError).toBe(true);
    expect(b.isError).toBe(true);
    expect(textOf(b as never)).toBe(textOf(a as never));
  }, 15_000);

  it("novada_serch (typo) → close-name suggestion novada_search, in both key states", async () => {
    for (const c of [keyless, invalidKey]) {
      const res = await c.client.callTool({ name: "novada_serch", arguments: { query: "hello" } });
      const text = textOf(res as never);
      expect(res.isError).toBe(true);
      expect(text).toContain("Unknown tool");
      expect(text).toMatch(/Did you mean: novada_search\?/);
      expect(text).not.toContain("NOVADA_API_KEY is not set");
    }
  }, 15_000);

  it("order pin: unknown NAME wins over bad params AND missing key", async () => {
    // novada_serch with NO arguments at all: name resolution must answer first —
    // not param validation, not the key gate.
    const res = await keyless.client.callTool({ name: "novada_serch", arguments: {} });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("Unknown tool");
    expect(text).not.toContain("Invalid parameters");
    expect(text).not.toContain("NOVADA_API_KEY is not set");
  }, 15_000);
});

describe("F12: key gate is consistent per tool class (local decisions only)", () => {
  let keyless: { client: Client; close: () => Promise<void> };

  beforeAll(async () => {
    keyless = await spawnClient();
  }, 30_000);

  afterAll(async () => {
    await keyless?.close();
  });

  it("key_required tool (novada_search, valid params) keyless → INVALID_API_KEY refusal (unchanged)", async () => {
    const res = await keyless.client.callTool({ name: "novada_search", arguments: { query: "hello" } });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("Error [INVALID_API_KEY]");
    expect(text).toContain("failure_class: auth");
  }, 15_000);

  it("unauth-tier tool with EXPLICIT escalation (novada_extract render=render) keyless → INVALID_API_KEY refusal naming the tier", async () => {
    const res = await keyless.client.callTool({
      name: "novada_extract",
      arguments: { url: "https://example.com", render: "render" },
    });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("Error [INVALID_API_KEY]");
    expect(text).toContain("failure_class: auth");
    // Names the tier boundary: escalation requires a valid key; basic fetch does not.
    expect(text).toMatch(/escalation/i);
    expect(text).toMatch(/basic/i);
  }, 15_000);

  it("unauth-tier tool with browser escalation keyless → same refusal class", async () => {
    const res = await keyless.client.callTool({
      name: "novada_extract",
      arguments: { url: "https://example.com", render: "browser" },
    });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("Error [INVALID_API_KEY]");
  }, 15_000);
});
