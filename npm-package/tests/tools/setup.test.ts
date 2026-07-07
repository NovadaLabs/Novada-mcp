/**
 * Tests for novada_setup — TOW2-252 identity suffix on the wallet balance line.
 *
 * Mocks wallet_balance so validateKey resolves to the "ready" state and we can
 * assert the identity suffix (key tail ≤4 + as-of) is appended to the wallet line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/tools/wallet_balance.js", () => ({
  novadaWalletBalance: vi.fn(),
}));

import { novadaWalletBalance } from "../../src/tools/wallet_balance.js";
const mockedWallet = vi.mocked(novadaWalletBalance);

const { novadaSetup } = await import("../../src/tools/setup.js");

const ENV_KEYS = ["NOVADA_API_KEY", "NOVADA_DEVELOPER_API_KEY", "NOVADA_BROWSER_WS", "NOVADA_PROXY_USER", "NOVADA_PROXY_PASS", "NOVADA_PROXY_ENDPOINT"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  mockedWallet.mockResolvedValue(JSON.stringify({ status: "ok", data: { balance: 105.1 } }));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("novadaSetup — TOW2-252 wallet identity line", () => {
  it("appends key tail (≤4) + as-of to the wallet balance line", async () => {
    const result = await novadaSetup({} as never, "sk-live-abcdWXYZ");
    expect(result).toContain("Wallet balance:");
    expect(result).toContain("account: key …WXYZ");
    expect(result).not.toContain("abcdWXYZ");
    expect(result).toMatch(/as of \d{4}-\d{2}-\d{2}T/);
  });

  it("never leaks more than the last 4 chars of the key", async () => {
    const result = await novadaSetup({} as never, "novada_dev_SECRETTAIL9999");
    expect(result).toContain("…9999");
    expect(result).not.toContain("SECRETTAIL");
  });
});
