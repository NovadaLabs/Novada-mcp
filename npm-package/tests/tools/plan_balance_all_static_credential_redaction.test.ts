/**
 * Tests for novadaPlanBalanceAll's fetchStaticIpSummary — the SECOND call site
 * that hits /v1/static_house/list raw (account-tools-redaction, 2026-10-30).
 *
 * This is reachable via novada_account(section="plans"/"summary") and
 * novada_plan_balance_all directly — a user asking a casual "what's my static
 * IP quota?" question is more likely to land here than on
 * novada_static_ip_mgmt(action="list") directly, so the SAME credential leak
 * (per-IP dial account/password echoed raw in `balance.raw`) must be fixed
 * here too. Only devApiPost is mocked; devApiParallel stays real — with
 * products:["static"] the flow-product fan-out list is empty, so
 * devApiParallel never touches the network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/_core/developer_api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/_core/developer_api.js")>();
  return {
    ...actual, // keep the REAL maskCredentials + devApiParallel
    devApiPost: vi.fn(),
    // staticHouseStatusTotal calls devApiPost INTERNALLY within the same
    // module — a same-module call is NOT intercepted by mocking devApiPost
    // from an external importer (Vitest/esbuild module-mock gotcha). Mock it
    // explicitly wherever a test needs to control the expired/released counts.
    staticHouseStatusTotal: vi.fn(),
  };
});

import { devApiPost, staticHouseStatusTotal } from "../../src/_core/developer_api.js";
const mockedPost = vi.mocked(devApiPost);
const mockedStatusTotal = vi.mocked(staticHouseStatusTotal);

const { novadaPlanBalanceAll } = await import("../../src/tools/plan_balance_all.js");

beforeEach(() => {
  mockedPost.mockReset();
  mockedStatusTotal.mockReset();
  // Deterministic default — every fetchStaticIpSummary call fires 2
  // staticHouseStatusTotal probes unconditionally; without an explicit mock
  // they'd fall through to the REAL (un-interceptable, same-module) devApiPost
  // and depend on the sandbox's network reachability to fail fast. Tests that
  // care about specific counts override this per-test.
  mockedStatusTotal.mockResolvedValue(undefined);
});

function ipRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    ip: "203.0.113.4",
    port: 8886,
    region: "frankfurt",
    status: 1,
    expire_time: 1798761600,
    account: "ax0kSJ8snE6wF1mR",
    password: "p3K0rNpsP2iR",
    ...over,
  };
}

describe("novadaPlanBalanceAll — static IP credential redaction (fetchStaticIpSummary)", () => {
  it("masks account/password in balance.raw.list while preserving ip/port/region/expiry", async () => {
    mockedPost.mockResolvedValueOnce({ list: [ipRow({})], total: 1 });

    const out = await novadaPlanBalanceAll({ products: ["static"] } as never, "caller-key");
    expect(out).not.toContain("ax0kSJ8snE6wF1mR");
    expect(out).not.toContain("p3K0rNpsP2iR");

    const obj = JSON.parse(out) as {
      per_product: { static: { status: string; balance: { raw: { list: Array<Record<string, unknown>> } } } };
    };
    const row = obj.per_product.static.balance.raw.list[0];
    expect(row.account).toBe("<PROXY_USER>");
    expect(row.password).toBe("***");
    expect(row.ip).toBe("203.0.113.4");
    expect(row.region).toBe("frankfurt");
    expect(row.expire_time).toBe(1798761600);
  });

  it("region_breakdown and active_ip_count are computed from the (unmasked-at-read-time) list correctly", async () => {
    mockedPost.mockResolvedValueOnce({
      list: [ipRow({ region: "us" }), ipRow({ region: "us", id: 2 }), ipRow({ region: "de", id: 3 })],
      total: 3,
    });

    const out = await novadaPlanBalanceAll({ products: ["static"] } as never, "caller-key");
    const obj = JSON.parse(out) as {
      per_product: { static: { balance: { active_ip_count: number; region_breakdown: Record<string, number> } } };
    };
    expect(obj.per_product.static.balance.active_ip_count).toBe(3);
    expect(obj.per_product.static.balance.region_breakdown).toEqual({ us: 2, de: 1 });
  });
});

// ─── active_ip_count scoped to in-use only (2026-10-30, scope addition #1) ────
//
// Orchestrator finding: fetchStaticIpSummary used to query static_house/list
// with NO status filter (server default = All), so active_ip_count counted
// expired/released IPs as "active" — the SAME "shows every IP including
// long-expired ones" defect as novada_static_ip_mgmt's list/export, reachable
// via the HOSTED path novada_account(section="plans"/"summary").
describe("novadaPlanBalanceAll — active_ip_count scoped to in-use (status=\"1\") only", () => {
  it("requests status:\"1\" on the primary static_house/list call", async () => {
    mockedPost.mockResolvedValue({ list: [], total: 0 });
    await novadaPlanBalanceAll({ products: ["static"] } as never, "caller-key");
    const mainCall = mockedPost.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>).limit === 200,
    );
    expect(mainCall).toBeTruthy();
    expect((mainCall![1] as Record<string, unknown>).status).toBe("1");
  });

  it("MIRROR: an all-in-use list produces the SAME active_ip_count as the old unfiltered behavior", async () => {
    // Every row is in-use (status:1) — filtering to status="1" must not change
    // the count for the common case where nothing is expired/released.
    mockedPost.mockImplementation(async (_path: string, body: Record<string, unknown>) => {
      if (body.limit === 200) return { list: [ipRow({}), ipRow({ id: 2 }), ipRow({ id: 3 })], total: 3 };
      return { list: [], total: 0 }; // expired/released count probes
    });
    const out = await novadaPlanBalanceAll({ products: ["static"] } as never, "caller-key");
    const obj = JSON.parse(out) as { per_product: { static: { balance: { active_ip_count: number } } } };
    expect(obj.per_product.static.balance.active_ip_count).toBe(3);
  });

  it("adds expired_ip_count/released_ip_count as additive fields, computed via separate count-only probes", async () => {
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });
    // staticHouseStatusTotal's internal devApiPost call is NOT reachable
    // through mockedPost (same-module call) — mock the exported helper directly.
    mockedStatusTotal.mockImplementation(async (status: "2" | "3") =>
      status === "2" ? 4 : 7,
    );

    const out = await novadaPlanBalanceAll({ products: ["static"] } as never, "caller-key");
    const obj = JSON.parse(out) as {
      per_product: {
        static: { balance: { active_ip_count: number; expired_ip_count?: number; released_ip_count?: number } };
      };
    };
    expect(obj.per_product.static.balance.active_ip_count).toBe(1);
    expect(obj.per_product.static.balance.expired_ip_count).toBe(4);
    expect(obj.per_product.static.balance.released_ip_count).toBe(7);
    expect(mockedStatusTotal).toHaveBeenCalledWith("2", "caller-key");
    expect(mockedStatusTotal).toHaveBeenCalledWith("3", "caller-key");
  });

  it("a failed count probe omits the field rather than crashing the whole response", async () => {
    mockedPost.mockResolvedValue({ list: [ipRow({})], total: 1 });
    // staticHouseStatusTotal already swallows its own errors internally and
    // resolves to undefined — simulate that contract directly here.
    mockedStatusTotal.mockImplementation(async (status: "2" | "3") =>
      status === "2" ? undefined : 0,
    );

    const out = await novadaPlanBalanceAll({ products: ["static"] } as never, "caller-key");
    const obj = JSON.parse(out) as {
      per_product: { static: { status: string; balance: { expired_ip_count?: number; released_ip_count?: number } } };
    };
    expect(obj.per_product.static.status).toBe("ok");
    expect(obj.per_product.static.balance.expired_ip_count).toBeUndefined();
    expect(obj.per_product.static.balance.released_ip_count).toBe(0);
  });
});
