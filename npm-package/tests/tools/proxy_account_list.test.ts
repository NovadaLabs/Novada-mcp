/**
 * Tests for novada_proxy_account_list — pure projection (TOW2-251).
 *
 * Uses the REAL captured API shape (product=1, uid 56952): two accounts, one
 * metered (limit=0, consumed>0) and one quota'd (limit>0). Asserts the projection
 * (a) never emits a scalar that contradicts the nested consumed/limit truth,
 * (b) renders bytes in human units, (c) keeps passwords masked, (d) drops the
 * ~50 dead-zero noise fields.
 *
 * Mocks devApiPost (network) but uses the REAL maskPasswords so masking is
 * genuinely exercised end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (before dynamic import) ────────────────────────────────────────────

vi.mock("../../src/_core/developer_api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/_core/developer_api.js")>();
  return {
    ...actual,            // keep the REAL maskPasswords
    devApiPost: vi.fn(),  // stub only the network call
  };
});

import { devApiPost } from "../../src/_core/developer_api.js";
const mockedPost = vi.mocked(devApiPost);

const { novadaProxyAccountList, validateProxyAccountListParams } = await import(
  "../../src/tools/proxy_account_list.js"
);

// ─── Real captured fixture (product=1) ────────────────────────────────────────

/** Full ~55-field raw row as returned by the live API. Passwords in CLEARTEXT
 *  here so the real maskPasswords must mask them. */
function rawRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    created_at: 1782933491, updated_at: 1783427402, id: 23747, uid: 56952,
    account: "acct", account_before: "acct", account_after: "_x",
    password: "s3cr3t-plaintext", status: 1,
    residential_balance: 0, residential_all_buy: 0, residential_status: 0,
    mobile_agent_balance: 0, mobile_agent_all_buy: 0, mobile_agent_status: 0,
    dc_balance: 0, dc_all_buy: 0, dc_status: 0,
    isp_balance: 0, isp_all_buy: 0, isp_status: 0,
    unblocker_balance: 0, unblocker_all_buy: 0, unblocker_status: 0,
    flow_type: "resi,res", account_type: "classic", check_white_list: 0, remark: "",
    consumed_residential_flow: 0, limit_residential_flow: 0,
    consumed_mobile_agent_flow: 0, limit_mobile_agent_flow: 0,
    consumed_dc_flow: 0, limit_dc_flow: 0,
    consumed_isp_flow: 0, limit_isp_flow: 0,
    consumed_unblocker_flow: 0, limit_unblocker_flow: 0,
    product: "1", consumed_unlimited_flow: 0, limit_unlimited_flow: 0,
    browser_balance: 0, browser_all_buy: 0, browser_status: 0,
    consumed_browser_flow: 0, limit_browser_flow: 0,
    consumed_resi_cron: 0, consumed_dc_cron: 0, consumed_isp_cron: 0,
    consumed_mob_cron: 0, consumed_unblocker_cron: 0, consumed_browser_cron: 0,
    consumed_resi_cron_last: 0, consumed_dc_cron_last: 0, consumed_isp_cron_last: 0,
    consumed_mob_cron_last: 0, consumed_unblocker_cron_last: 0, consumed_browser_cron_last: 0,
    ...over,
  };
}

/** metered account: consumed>0, limit=0 (pay-as-you-go, NO cap). */
const METERED = rawRow({
  account: "qatest_probe_c_QYFH4h",
  consumed_residential_flow: 8302,
  limit_residential_flow: 0,
});

/** quota account: real cap, ~11.15% used (106.3MB used / 953.7MB cap). */
const QUOTA = rawRow({
  account: "tongwu_TRDI7X",
  account_type: "limit",
  consumed_residential_flow: 111486370,
  limit_residential_flow: 1000000000,
});

beforeEach(() => {
  vi.clearAllMocks();
});

function mockList(rows: Record<string, unknown>[]): void {
  mockedPost.mockResolvedValue({ list: rows, page: 1, total: rows.length });
}

// ─── Schema ────────────────────────────────────────────────────────────────────

describe("validateProxyAccountListParams", () => {
  it("requires product as a string, rejects integer", () => {
    expect(() => validateProxyAccountListParams({ product: 1 })).toThrow();
    expect(validateProxyAccountListParams({ product: "1" }).product).toBe("1");
  });
});

// ─── Pure projection ─────────────────────────────────────────────────────────

describe("novadaProxyAccountList — pure projection (TOW2-251)", () => {
  it("never emits a scalar that contradicts nested consumed/limit truth", async () => {
    mockList([QUOTA]);
    const result = await novadaProxyAccountList(validateProxyAccountListParams({ product: "1" }));
    const obj = JSON.parse(result) as { data: { list: Array<Record<string, unknown>> } };
    const acct = obj.data.list[0];
    // The contradicting `residential_balance: 0` scalar must be GONE.
    expect(acct.residential_balance).toBeUndefined();
    // No top-level `*_balance` scalar of any kind survives.
    for (const k of Object.keys(acct)) {
      expect(k.endsWith("_balance")).toBe(false);
    }
  });

  it("renders quota account in human units with correct percent", async () => {
    mockList([QUOTA]);
    const result = await novadaProxyAccountList(validateProxyAccountListParams({ product: "1" }));
    const obj = JSON.parse(result) as { data: { list: Array<Record<string, any>> } };
    const res = obj.data.list[0].products.residential;
    // 111486370 bytes = 106.32 MB ; 1000000000 bytes = 953.67 MB ; ~11.1%
    expect(res.used).toMatch(/106\.\d+\s*MB/);
    expect(res.limit).toMatch(/953\.\d+\s*MB/);
    expect(res.percent).toBe("11.1%");
  });

  it("metered account (limit=0, consumed>0) reports used only — no fake limit/percent", async () => {
    mockList([METERED]);
    const result = await novadaProxyAccountList(validateProxyAccountListParams({ product: "1" }));
    const obj = JSON.parse(result) as { data: { list: Array<Record<string, any>> } };
    const res = obj.data.list[0].products.residential;
    expect(res.used).toMatch(/MB|GB/);
    expect(res.limit).toBeUndefined();
    expect(res.percent).toBeUndefined();
  });

  it("drops dead-zero products (no quota, no usage)", async () => {
    mockList([QUOTA]);
    const result = await novadaProxyAccountList(validateProxyAccountListParams({ product: "1" }));
    const obj = JSON.parse(result) as { data: { list: Array<Record<string, any>> } };
    const products = obj.data.list[0].products;
    // residential has signal; mobile/datacenter/isp/etc. are all zero → omitted.
    expect(Object.keys(products)).toEqual(["residential"]);
  });

  it("keeps passwords masked (never leaks plaintext)", async () => {
    mockList([QUOTA]);
    const result = await novadaProxyAccountList(validateProxyAccountListParams({ product: "1" }));
    expect(result).not.toContain("s3cr3t-plaintext");
    const obj = JSON.parse(result) as { data: { list: Array<Record<string, any>> } };
    expect(obj.data.list[0].password).toBe("****");
  });

  it("keeps account, status, and pagination envelope", async () => {
    mockList([METERED, QUOTA]);
    const result = await novadaProxyAccountList(validateProxyAccountListParams({ product: "1" }));
    const obj = JSON.parse(result) as { data: { list: Array<Record<string, any>>; total: number } };
    expect(obj.data.total).toBe(2);
    expect(obj.data.list[0].account).toBe("qatest_probe_c_QYFH4h");
    expect(obj.data.list[0].status).toBe("active");
  });

  it("collapses the ~55-field row to a handful of legible keys", async () => {
    mockList([QUOTA]);
    const result = await novadaProxyAccountList(validateProxyAccountListParams({ product: "1" }));
    const obj = JSON.parse(result) as { data: { list: Array<Record<string, any>> } };
    const keys = Object.keys(obj.data.list[0]);
    // account, status, password, products (+ remark only when non-empty)
    expect(keys.length).toBeLessThanOrEqual(5);
    expect(keys).toContain("account");
    expect(keys).toContain("products");
  });
});
