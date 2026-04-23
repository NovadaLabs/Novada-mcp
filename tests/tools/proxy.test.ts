import { describe, it, expect, afterEach } from "vitest";
import { novadaProxy } from "../../src/tools/proxy.js";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env.NOVADA_PROXY_USER = originalEnv.NOVADA_PROXY_USER;
  process.env.NOVADA_PROXY_PASS = originalEnv.NOVADA_PROXY_PASS;
  process.env.NOVADA_PROXY_ENDPOINT = originalEnv.NOVADA_PROXY_ENDPOINT;
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

  it("adds country to proxy username when specified", async () => {
    process.env.NOVADA_PROXY_USER = "user_ABC123";
    process.env.NOVADA_PROXY_PASS = "pass";
    process.env.NOVADA_PROXY_ENDPOINT = "proxy.example.com:7777";

    const result = await novadaProxy({ type: "residential", country: "us", format: "url" });
    expect(result).toContain("country-us");
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
