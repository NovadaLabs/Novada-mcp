/**
 * Health probe via dispatch path — FIX 2 regression tests.
 *
 * Verifies that the core.ts dispatch case for "novada_health" (and its alias
 * "novada_health_all") correctly:
 *   (a) Always appends the honest disclaimer, never calls _performRenderProbe
 *       by default.
 *   (b) Calls _performRenderProbe exactly once when probe:true and includes the
 *       billing disclosure + render_probe block in the output.
 *   (c) Surfaces ok:false when _performRenderProbe returns a failed result.
 *   (d) HealthParamsSchema now accepts the probe field (schema-level contract).
 *
 * Tests run through the real dispatch() function in core.ts so they exercise
 * the actual dispatch path, not novadaHealth() directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock novadaAccount (via account.js) ─────────────────────────────────────
// core.ts imports novadaAccount from ./tools/index.js which re-exports from
// ./tools/account.js.  Mocking the origin module is the cleanest approach.
vi.mock("../../src/tools/account.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/tools/account.js")>();
  return {
    ...original,
    novadaAccount: vi.fn().mockResolvedValue(
      "## Novada Account — Summary\n\nWallet: €10.00\n",
    ),
  };
});

// ─── Mock _performRenderProbe from health.js; keep shared helpers real ────────
// HEALTH_PROBE_DISCLAIMER and formatProbeSection are exported from health.js
// and used by the dispatch case — they must stay real for the output assertions
// to make sense.
vi.mock("../../src/tools/health.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/tools/health.js")>();
  return {
    ...original,
    _performRenderProbe: vi.fn(),
  };
});

// ─── Deferred imports (after vi.mock hoisting) ────────────────────────────────
import { _performRenderProbe } from "../../src/tools/health.js";
import { novadaAccount } from "../../src/tools/account.js";
import { validateHealthParams, HealthParamsSchema } from "../../src/tools/types.js";

const mockedProbe   = vi.mocked(_performRenderProbe);
const mockedAccount = vi.mocked(novadaAccount);

const API_KEY = "test-dispatch-health-key";

beforeEach(() => {
  vi.clearAllMocks();
  mockedAccount.mockResolvedValue("## Novada Account — Summary\n\nWallet: €10.00\n");
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── (a) Default — disclaimer present, probe NOT called ──────────────────────

describe("novada_health via dispatch — default (probe:false)", () => {
  it("(a) disclaimer present in output", async () => {
    const { dispatch } = await import("../../src/core.js");
    const result = await dispatch("novada_health", {}, API_KEY);
    expect(result).toContain("does NOT verify live render capability");
    expect(result).toContain("probe:true");
  });

  it("(a) _performRenderProbe NOT called by default", async () => {
    const { dispatch } = await import("../../src/core.js");
    await dispatch("novada_health", {}, API_KEY);
    expect(mockedProbe).not.toHaveBeenCalled();
  });

  it("(a) output includes the novadaAccount base summary", async () => {
    const { dispatch } = await import("../../src/core.js");
    const result = await dispatch("novada_health", {}, API_KEY);
    expect(result).toContain("Novada Account");
  });
});

// ─── (b) probe:true — _performRenderProbe called once, output has probe block ─

describe("novada_health via dispatch — probe:true success", () => {
  beforeEach(() => {
    mockedProbe.mockResolvedValue({ ok: true, detail: "HTTP 200" });
  });

  it("(b) _performRenderProbe called exactly once", async () => {
    const { dispatch } = await import("../../src/core.js");
    await dispatch("novada_health", { probe: true }, API_KEY);
    expect(mockedProbe).toHaveBeenCalledOnce();
  });

  it("(b) output contains render_probe block", async () => {
    const { dispatch } = await import("../../src/core.js");
    const result = await dispatch("novada_health", { probe: true }, API_KEY);
    expect(result).toContain("render_probe:");
    expect(result).toContain("attempted: true");
  });

  it("(b) output contains billing disclosure", async () => {
    const { dispatch } = await import("../../src/core.js");
    const result = await dispatch("novada_health", { probe: true }, API_KEY);
    expect(result).toContain("probe performed 1 real render call billed to your account");
  });

  it("(b) output reports ok: true on success", async () => {
    const { dispatch } = await import("../../src/core.js");
    const result = await dispatch("novada_health", { probe: true }, API_KEY);
    expect(result).toContain("ok: true");
    expect(result).not.toContain("ok: false");
  });
});

// ─── (c) probe failure → ok:false surfaced, no healthy claim ─────────────────

describe("novada_health via dispatch — probe:true failure", () => {
  beforeEach(() => {
    mockedProbe.mockResolvedValue({ ok: false, detail: "connection refused" });
  });

  it("(c) output reports ok: false", async () => {
    const { dispatch } = await import("../../src/core.js");
    const result = await dispatch("novada_health", { probe: true }, API_KEY);
    expect(result).toContain("ok: false");
  });

  it("(c) output does NOT claim healthy render (ok: true absent)", async () => {
    const { dispatch } = await import("../../src/core.js");
    const result = await dispatch("novada_health", { probe: true }, API_KEY);
    expect(result).not.toContain("ok: true");
  });

  it("(c) failure detail surfaced in output", async () => {
    const { dispatch } = await import("../../src/core.js");
    const result = await dispatch("novada_health", { probe: true }, API_KEY);
    expect(result).toContain("connection refused");
  });
});

// ─── novada_health_all alias inherits same probe treatment ───────────────────

describe("novada_health_all via dispatch — same probe treatment as novada_health", () => {
  it("default: disclaimer present, probe NOT called", async () => {
    const { dispatch } = await import("../../src/core.js");
    const result = await dispatch("novada_health_all", {}, API_KEY);
    expect(result).toContain("does NOT verify live render capability");
    expect(mockedProbe).not.toHaveBeenCalled();
  });

  it("probe:true: _performRenderProbe called once", async () => {
    mockedProbe.mockResolvedValue({ ok: true, detail: "HTTP 200" });
    const { dispatch } = await import("../../src/core.js");
    await dispatch("novada_health_all", { probe: true }, API_KEY);
    expect(mockedProbe).toHaveBeenCalledOnce();
  });
});

// ─── (d) HealthParamsSchema now exposes probe ─────────────────────────────────

describe("HealthParamsSchema — probe field exposed (schema contract)", () => {
  it("(d) validateHealthParams accepts probe:true", () => {
    const result = validateHealthParams({ probe: true });
    expect(result.probe).toBe(true);
  });

  it("(d) validateHealthParams defaults probe to false", () => {
    const result = validateHealthParams({});
    expect(result.probe).toBe(false);
  });

  it("(d) HealthParamsSchema JSON schema includes probe property", () => {
    // Use toJSONSchema() to verify the field is declared in the MCP inputSchema.
    const jsonSchema = HealthParamsSchema.toJSONSchema() as Record<string, unknown>;
    const props = jsonSchema.properties as Record<string, unknown> | undefined;
    expect(props).toBeDefined();
    expect(props!["probe"]).toBeDefined();
  });
});
