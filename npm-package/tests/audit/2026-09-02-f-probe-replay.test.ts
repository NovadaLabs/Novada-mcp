/**
 * Replays the 11 error-quality probes from
 * novada-test-engineering/ledger/novada-mcp/2026-09-02-full-evaluation/evidence/F-probe-report.txt
 * against the ACTUAL stdio server (spawned via vite-node, no build step needed)
 * to self-verify the F-4/F-12/F-3/F-5/F-2/F2-3/P-4/A-11 fixes in this worker's
 * pass, using the SAME rubric the original audit used:
 *   0 = opaque · 1 = says what's wrong · 2 = +valid values/expected type ·
 *   3 = +instruction uniquely determining the correct retry
 *
 * This is a genuine end-to-end replay (real JSON-RPC over real stdio, via the
 * MCP SDK's own Client + StdioClientTransport) — not a unit test of the
 * formatter in isolation. Grading is automated via concrete text-presence
 * checks derived from the rubric, not subjective judgment, so the score is
 * reproducible.
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

// A syntactically-plausible but non-functional key — every probe below fails
// LOCAL validation/preflight before any network call, so no real credential
// is ever needed (matches how the original F-probe-report.txt evaluation was
// run: "with a valid key already set" per its own gate-order note).
const DUMMY_KEY = "dummy_test_key_for_probe_replay_0000";

async function spawnClient(env: Record<string, string> = {}): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [VITE_NODE_BIN, INDEX_TS],
    env: { ...getDefaultEnvironment(), NOVADA_API_KEY: DUMMY_KEY, ...env },
    cwd: REPO_ROOT,
  });
  const client = new Client({ name: "f-probe-replay", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, close: () => transport.close() };
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n---\n");
}

describe("F-probe replay (2026-09-02 audit, worker B2 fixes)", () => {
  let keyed: { client: Client; close: () => Promise<void> };
  let keyless: { client: Client; close: () => Promise<void> };

  beforeAll(async () => {
    keyed = await spawnClient();
    keyless = await spawnClient({ NOVADA_API_KEY: "" });
  }, 30_000);

  afterAll(async () => {
    await keyed?.close();
    await keyless?.close();
  });

  it("P1: novada_search {} (omit required) — grade 3: names field, expected type, and a specific fix instruction", async () => {
    const res = await keyed.client.callTool({ name: "novada_search", arguments: {} });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("query");
    expect(text).toMatch(/agent_instruction:.*Add the required parameter query/);
    expect(text).toContain("string"); // expected type
  }, 15_000);

  it("P2: novada_account {section:\"billing\"} (wrong enum) — grade 3: valid values + specific instruction", async () => {
    const res = await keyed.client.callTool({ name: "novada_account", arguments: { section: "billing" } });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("valid values");
    expect(text).toMatch(/agent_instruction:.*Set section to one of:/);
  }, 15_000);

  it("P3: novada_extract {url:12345} (wrong type, union field) — grade 3: instruction recovers expected types Zod's own bare message omits", async () => {
    const res = await keyed.client.callTool({ name: "novada_extract", arguments: { url: 12345 } });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    // Zod's own per-field line is legitimately still bare "Invalid input" for
    // a union mismatch (unchanged, verbatim from Zod) — the fix is the
    // agent_instruction line now naming the real expected types.
    expect(text).toMatch(/agent_instruction:.*Change url to one of these types:/);
    expect(text).toMatch(/string/);
  }, 15_000);

  it("P4a: novada_discover {category:\"Proxy\", bogus_param:\"hello\"} — grade 3: was silent (0), now names the ignored key", async () => {
    const res = await keyed.client.callTool({ name: "novada_discover", arguments: { category: "Proxy", bogus_param: "hello" } });
    const text = textOf(res as never);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("Novada MCP");
    expect(text).toMatch(/agent_instruction:.*Unknown parameter\(s\) ignored on novada_discover.*'bogus_param'/);
  }, 15_000);

  it("P4b: novada_setup {bogus_param:\"hello\"} (strict tool) — no regression: still a clear hard-reject", async () => {
    const res = await keyless.client.callTool({ name: "novada_setup", arguments: { bogus_param: "hello" } });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("bogus_param");
    expect(text).toMatch(/agent_instruction:/);
  }, 15_000);

  it("P4c: novada_search {querry:\"typo\"} (typo'd param) — grade 3: both the missing 'query' AND the typo'd 'querry' are named", async () => {
    const res = await keyed.client.callTool({ name: "novada_search", arguments: { querry: "typo of query" } });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toMatch(/agent_instruction:.*Add the required parameter query/);
    // The regression this closes: P4c's original grade-1.5 defect was that
    // "querry" (the actual typo) was never mentioned anywhere in the response.
    expect(text).toContain("'querry'");
  }, 15_000);

  it("P4d: novada_session_stats {bogus:1} — grade 3: was silent (0), now names the ignored key", async () => {
    const res = await keyed.client.callTool({ name: "novada_session_stats", arguments: { bogus: 1 } });
    const text = textOf(res as never);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("Session Stats");
    expect(text).toMatch(/agent_instruction:.*Unknown parameter\(s\) ignored on novada_session_stats.*'bogus'/);
  }, 15_000);

  it("P5: novada_scrape amazon + invalid operation id — no regression: preflight still grade 3", async () => {
    const res = await keyed.client.callTool({
      name: "novada_scrape",
      arguments: { platform: "amazon.com", operation: "amazon_bogus_op", params: { keyword: "x" } },
    });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("Unknown operation 'amazon_bogus_op'");
    expect(text).toContain("preflight:unknown_operation");
    expect(text).toMatch(/agent_instruction:/);
  }, 15_000);

  it("P6: novada_scrape walmart missing conditionally-required 'domain' — no regression: preflight still grade 3", async () => {
    const res = await keyed.client.callTool({
      name: "novada_scrape",
      arguments: { platform: "walmart.com", operation: "walmart_product_keywords", params: { keyword: "laptop" } },
    });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("requires ALL of 'domain', 'keyword'");
    expect(text).toContain("missing: 'domain'");
    expect(text).toMatch(/agent_instruction:.*domain.*e\.g\.,? novada_scrape/i);
  }, 15_000);

  it("P7: novada_scrape {format:\"yaml\"} (wrong enum) — grade 3: valid values + specific instruction", async () => {
    const res = await keyed.client.callTool({
      name: "novada_scrape",
      arguments: { platform: "amazon.com", operation: "amazon_product_asin", format: "yaml", params: {} },
    });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("valid values");
    expect(text).toMatch(/agent_instruction:.*Set format to one of:/);
  }, 15_000);

  it("P8: novada_scrape_amazon {operation:\"not_a_real_op\"} — grade 3: valid values + specific instruction", async () => {
    const res = await keyed.client.callTool({ name: "novada_scrape_amazon", arguments: { operation: "not_a_real_op", params: {} } });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("valid values");
    expect(text).toMatch(/agent_instruction:.*Set operation to one of:/);
  }, 15_000);

  // ─── F2-3: validation-before-key-gate ordering ─────────────────────────────

  it("F2-3: keyless caller with a bad param learns about the PARAM, not just the missing key", async () => {
    const res = await keyless.client.callTool({ name: "novada_search", arguments: {} });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    // Before this fix: keyless always returned Error [INVALID_API_KEY] here,
    // regardless of the (also-broken) params — the auth gate preempted zod.
    expect(text).not.toContain("INVALID_API_KEY");
    expect(text).toContain("Invalid parameters for novada_search");
    expect(text).toMatch(/agent_instruction:.*Add the required parameter query/);
  }, 15_000);

  it("F2-3: keyless caller with VALID params still gets the missing-key error (no bypass)", async () => {
    const res = await keyless.client.callTool({ name: "novada_search", arguments: { query: "hello" } });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).toContain("INVALID_API_KEY");
  }, 15_000);

  it("A-7/F2-3: novada_discover works with NO key at all", async () => {
    const res = await keyless.client.callTool({ name: "novada_discover", arguments: {} });
    const text = textOf(res as never);
    expect(res.isError).toBeFalsy();
    expect(text).toContain("Novada MCP");
  }, 15_000);

  it("grep proof: 'Next step:' token is gone from the search_feedback validation path", async () => {
    const res = await keyed.client.callTool({ name: "novada_search_feedback", arguments: { search_id: "x" } });
    const text = textOf(res as never);
    expect(res.isError).toBe(true);
    expect(text).not.toContain("Next step:");
    expect(text).toMatch(/agent_instruction:/);
  }, 15_000);
});
