/**
 * B7 (wave B/C, 2026-11-18) — safeLookup's fallback DNS resolver.
 *
 * Mocks `dns` entirely (own file, own module registry — vitest isolates mocks per
 * test file by default) so the ENOTFOUND→fallback→permanent/transient classification
 * is deterministic and doesn't depend on real network conditions or a genuinely dead
 * test domain staying dead. tests/ssrf.test.ts keeps the real-DNS happy-path/rebinding
 * coverage; this file covers only the NEW fallback-resolver branch added for B7.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLookup = vi.fn();
const mockResolve4 = vi.fn();
const mockSetServers = vi.fn();

vi.mock("dns", () => {
  return {
    default: {
      lookup: (...args: unknown[]) => (mockLookup as (...a: unknown[]) => void)(...args),
      // Must be a real `function` (not an arrow fn) — safeLookup calls `new dns.Resolver()`,
      // and an arrow function cannot be invoked with `new`.
      Resolver: vi.fn().mockImplementation(function Resolver(this: unknown) {
        return {
          setServers: mockSetServers,
          resolve4: (...args: unknown[]) => (mockResolve4 as (...a: unknown[]) => void)(...args),
        };
      }),
    },
  };
});

import { safeLookup } from "../src/utils/ssrf.js";

function call(host: string, opts: object = {}): Promise<{ err?: string; addr?: unknown }> {
  return new Promise((resolve) => {
    safeLookup(host, opts, (err, addr) => resolve({ err: err?.message, addr }));
  });
}

beforeEach(() => {
  mockLookup.mockReset();
  mockResolve4.mockReset();
  mockSetServers.mockReset();
});

describe("safeLookup — B7 fallback DNS resolver (ENOTFOUND only)", () => {
  it("system ENOTFOUND + fallback ALSO fails → permanent, resolvers disclosed in a SHORT tag (survives summarizeAggregateError's ~120-char per-cause truncation)", async () => {
    mockLookup.mockImplementation((host: string, _opts: unknown, cb: (err: NodeJS.ErrnoException, addr: unknown) => void) => {
      const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
      cb(err, []);
    });
    mockResolve4.mockImplementation((host: string, cb: (err: NodeJS.ErrnoException | null, addr?: string[]) => void) => {
      const err = Object.assign(new Error(`queryA ENOTFOUND ${host}`), { code: "ENOTFOUND" });
      cb(err, undefined);
    });

    const r = await call("novada-wave-bc-dead-domain-test.invalid");

    expect(r.err).toMatch(/ENOTFOUND/);
    expect(r.err).toMatch(/\[resolvers:system,1\.1\.1\.1;permanent\]/);
    // Live-verified 2026-11-18: the ORIGINAL verbose tag
    // ("dns_resolvers_tried=...; failure_class=permanent; retry_recommended=false")
    // silently lost everything past "failure_class=perm…" once embedded as one
    // cause inside an aggregate error on a real ~44-char test domain — this
    // asserts the whole tag survives under the SAME 120-char budget.
    expect(r.err!.length).toBeLessThan(120);
    expect(mockSetServers).toHaveBeenCalledWith(["1.1.1.1"]);
  });

  it("system ENOTFOUND + fallback SUCCEEDS with a public IP → lookup succeeds (resolver gap, not a dead domain)", async () => {
    mockLookup.mockImplementation((host: string, _opts: unknown, cb: (err: NodeJS.ErrnoException, addr: unknown) => void) => {
      const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
      cb(err, []);
    });
    mockResolve4.mockImplementation((_host: string, cb: (err: null, addr: string[]) => void) => cb(null, ["93.184.216.34"]));

    const r = await call("novada-wave-bc-resolver-gap-test.invalid", { all: true });

    expect(r.err).toBeUndefined();
    expect(r.addr).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("SSRF re-check still applies to the fallback resolver's result — a rebind via the fallback resolver is STILL refused", async () => {
    mockLookup.mockImplementation((host: string, _opts: unknown, cb: (err: NodeJS.ErrnoException, addr: unknown) => void) => {
      const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
      cb(err, []);
    });
    // Fallback resolver returns a private/metadata IP — must be rejected exactly like
    // the system resolver's own rebinding check does; the choice of resolver must never
    // bypass the SSRF guard.
    mockResolve4.mockImplementation((_host: string, cb: (err: null, addr: string[]) => void) => cb(null, ["169.254.169.254"]));

    const r = await call("novada-wave-bc-rebind-via-fallback-test.invalid");

    expect(r.err).toMatch(/SSRF guard/);
    expect(r.err).toMatch(/rebinding/);
  });

  it("a non-ENOTFOUND system-resolver error (e.g. EAI_AGAIN) does NOT trigger the fallback resolver", async () => {
    mockLookup.mockImplementation((host: string, _opts: unknown, cb: (err: NodeJS.ErrnoException, addr: unknown) => void) => {
      const err = Object.assign(new Error(`getaddrinfo EAI_AGAIN ${host}`), { code: "EAI_AGAIN" });
      cb(err, []);
    });

    const r = await call("novada-wave-bc-transient-dns-server-test.invalid");

    expect(r.err).toMatch(/EAI_AGAIN/);
    expect(mockResolve4).not.toHaveBeenCalled();
  });

  it("the happy path (no ENOTFOUND at all) never touches the fallback resolver — ~0ms added cost", async () => {
    mockLookup.mockImplementation((_host: string, _opts: unknown, cb: (err: null, addr: unknown) => void) =>
      cb(null, [{ address: "93.184.216.34", family: 4 }])
    );

    const r = await call("example.com", { all: true });

    expect(r.err).toBeUndefined();
    expect(mockResolve4).not.toHaveBeenCalled();
  });
});
