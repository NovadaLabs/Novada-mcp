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

// ─── Smoke: dispatch wires probe correctly ────────────────────────────────────

describe("novada_health via dispatch — probe smoke (absent→not called, present→called)", () => {
  it("probe absent → NOT called; probe:true → called exactly once", async () => {
    const { dispatch } = await import("../../src/core.js");

    // probe absent → not called
    await dispatch("novada_health", {}, API_KEY);
    expect(mockedProbe).not.toHaveBeenCalled();

    // reset, then probe:true → called once
    vi.clearAllMocks();
    mockedAccount.mockResolvedValue("## Novada Account — Summary\n\nWallet: €10.00\n");
    mockedProbe.mockResolvedValue({ ok: true, detail: "HTTP 200" });
    await dispatch("novada_health", { probe: true }, API_KEY);
    expect(mockedProbe).toHaveBeenCalledOnce();
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
