/**
 * Tests for novada_setup — TOW2-252 identity suffix on the wallet balance line.
 * Also covers fix/truthful-self-report: server_version must equal the canonical
 * version string injected by the host (NOVADA_SERVER_VERSION env var), so that
 * novada_setup output == serverInfo.version in both stdio and hosted modes.
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
import { VERSION } from "../../src/config.js";

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

// ─── fix/truthful-self-report ─────────────────────────────────────────────────
// INVARIANT: novada_setup output server_version === the canonical version string.
// In hosted mode the hosted wrapper sets NOVADA_SERVER_VERSION to its HOSTED_VERSION
// (e.g. "0.9.26-hosted"), and setup must report THAT string, not the bare VERSION.
// In stdio mode (no env var) setup falls back to VERSION (the package.json version).
describe("novadaSetup — server_version truthfulness invariant", () => {
  const HOSTED_SIM = "0.9.26-hosted"; // simulates what mcp.ts sets in hosted mode

  it("reports NOVADA_SERVER_VERSION when set (hosted mode) — RED before fix", async () => {
    process.env.NOVADA_SERVER_VERSION = HOSTED_SIM;
    const result = await novadaSetup({} as never, "sk-test-ABCD1234");
    expect(result).toContain(`server_version: ${HOSTED_SIM}`);
  });

  it("falls back to VERSION constant when NOVADA_SERVER_VERSION not set (stdio mode)", async () => {
    // global beforeEach strips NOVADA_* so NOVADA_SERVER_VERSION is already unset here
    const result = await novadaSetup({} as never, "sk-test-ABCD1234");
    expect(result).toContain(`server_version: ${VERSION}`);
  });

  afterEach(() => {
    delete process.env.NOVADA_SERVER_VERSION;
  });
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
