import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { novadaProxy } from "../../src/tools/proxy.js";
import { novadaProxyStatic } from "../../src/tools/proxy_static.js";
import { novadaProxyDedicated } from "../../src/tools/proxy_dedicated.js";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env.NOVADA_PROXY_USER = originalEnv.NOVADA_PROXY_USER;
  process.env.NOVADA_PROXY_PASS = originalEnv.NOVADA_PROXY_PASS;
  process.env.NOVADA_PROXY_ENDPOINT = originalEnv.NOVADA_PROXY_ENDPOINT;
  process.env.NOVADA_STATIC_PROXY_LIST = originalEnv.NOVADA_STATIC_PROXY_LIST;
  process.env.NOVADA_DEDICATED_PROXY_LIST = originalEnv.NOVADA_DEDICATED_PROXY_LIST;
});

describe("novadaProxy", () => {
  it("returns not-configured message when no proxy credentials set", async () => {
    delete process.env.NOVADA_PROXY_USER;
    delete process.env.NOVADA_PROXY_PASS;
    delete process.env.NOVADA_PROXY_ENDPOINT;

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("not configured");
    expect(result).toContain("NOVADA_PROXY_USER");
  });

  it("returns proxy URL when credentials are set", async () => {
    process.env.NOVADA_PROXY_USER = "testuser";
    process.env.NOVADA_PROXY_PASS = "testpass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";

    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).toContain("proxy.example.com:7777");
    expect(result).toContain("proxy_url:");
  });

  it("adds country targeting to output when specified", async () => {
    process.env.NOVADA_PROXY_USER = "user_ABC123";
    process.env.NOVADA_PROXY_PASS = "pass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";

    const result = await novadaProxy({ type: "residential", country: "us", format: "url" });
    // The username builder uses "region-<country>"; verify country targeting is present
    expect(result).toContain("region-us");
  });

  it("returns env format with shell export commands", async () => {
    process.env.NOVADA_PROXY_USER = "user_ABC123";
    process.env.NOVADA_PROXY_PASS = "pass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";

    const result = await novadaProxy({ type: "residential", format: "env" });
    expect(result).toContain("export HTTP_PROXY=");
    expect(result).toContain("export HTTPS_PROXY=");
  });
});

// ─── NOV-674 Group B: proxy username masking ─────────────────────────────────

describe("novadaProxy — username masked in all output formats (NOV-674)", () => {
  const FULL_USER = "customer-ab12-zone-res";

  beforeEach(() => {
    process.env.NOVADA_PROXY_USER = FULL_USER;
    process.env.NOVADA_PROXY_PASS = "supersecretpass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";
  });

  it("url format: raw username is NOT present in output", async () => {
    const result = await novadaProxy({ type: "residential", format: "url" });
    expect(result).not.toContain(FULL_USER);
  });

  it("url format: password placeholder used in Node.js example, not raw username", async () => {
    const result = await novadaProxy({ type: "residential", format: "url" });
    // Should use <PROXY_USER> placeholder in examples
    expect(result).toContain("<PROXY_USER>");
  });

  it("env format: raw username is NOT present in export commands", async () => {
    const result = await novadaProxy({ type: "residential", format: "env" });
    expect(result).not.toContain(FULL_USER);
    expect(result).toContain("export HTTP_PROXY=");
  });

  it("curl format: raw username is NOT present in curl command", async () => {
    const result = await novadaProxy({ type: "residential", format: "curl" });
    expect(result).not.toContain(FULL_USER);
    expect(result).toContain("curl --proxy");
  });

  it("masked proxy_url uses a fixed placeholder, never real username bytes (M7)", async () => {
    const result = await novadaProxy({ type: "residential", format: "url" });
    // M7: the masked username must be a fixed <PROXY_USER> placeholder — no
    // prefix derived from the real username (which is structured and could
    // reveal the account). The old "cust***" leaked the first 4 real chars.
    expect(result).toContain("<PROXY_USER>");
    expect(result).not.toContain("cust***");
    expect(result).not.toContain(FULL_USER);
  });

  it("does not print targeting for isp (country is dropped from the username)", async () => {
    // M7/isp: buildProxyUsername drops country for isp, so the output must not
    // claim geo-targeting that was never applied.
    const result = await novadaProxy({ type: "isp", country: "us", format: "url" });
    expect(result).not.toContain("targeting:");
  });
});

describe("novadaProxyStatic — username masked in all output formats (NOV-674)", () => {
  const FULL_USER = "ax0kSJ8snE6wF1mR";

  beforeEach(() => {
    // Format: IP:PORT:USER:PASS
    process.env.NOVADA_STATIC_PROXY_LIST = `151.242.47.74:8886:${FULL_USER}:p3K0rNpsP2iR`;
  });

  it("url format: raw username not in output", async () => {
    const result = await novadaProxyStatic({ country: "us", session_id: "sess1", format: "url" });
    expect(result).not.toContain(FULL_USER);
  });

  it("env format: raw username not in export commands", async () => {
    const result = await novadaProxyStatic({ country: "us", session_id: "sess1", format: "env" });
    expect(result).not.toContain(FULL_USER);
    expect(result).toContain("<PROXY_USER>");
  });

  it("curl format: raw username not in curl command", async () => {
    const result = await novadaProxyStatic({ country: "us", session_id: "sess1", format: "curl" });
    expect(result).not.toContain(FULL_USER);
    expect(result).toContain("<PROXY_USER>");
  });

  it("url format: uses first-4-chars + *** masking in the command", async () => {
    const result = await novadaProxyStatic({ country: "us", session_id: "sess1", format: "url" });
    // First 4 chars of "ax0kSJ8snE6wF1mR" are "ax0k"
    expect(result).toContain("ax0k***");
  });
});

describe("novadaProxyDedicated — username masked in all output formats (NOV-674)", () => {
  const FULL_USER = "dedUser9876xYz";

  beforeEach(() => {
    process.env.NOVADA_DEDICATED_PROXY_LIST = `192.0.2.10:9999:${FULL_USER}:secretDedicatedPass`;
  });

  it("url format: raw username not in output", async () => {
    const result = await novadaProxyDedicated({ session_id: "my-session", format: "url" });
    expect(result).not.toContain(FULL_USER);
  });

  it("env format: raw username not in export commands", async () => {
    const result = await novadaProxyDedicated({ session_id: "my-session", format: "env" });
    expect(result).not.toContain(FULL_USER);
    expect(result).toContain("<PROXY_USER>");
  });

  it("curl format: raw username not in curl command", async () => {
    const result = await novadaProxyDedicated({ session_id: "my-session", format: "curl" });
    expect(result).not.toContain(FULL_USER);
    expect(result).toContain("<PROXY_USER>");
  });

  it("url format: uses first-4-chars + *** masking in the command", async () => {
    const result = await novadaProxyDedicated({ session_id: "my-session", format: "url" });
    // First 4 chars of "dedUser9876xYz" are "dedU"
    expect(result).toContain("dedU***");
  });
});
