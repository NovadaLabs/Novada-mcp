/**
 * VISIBILITY — the IP-echo prober (src/tools/proxy_verify.ts).
 *
 * Owner's core complaint: "how can I SEE if the proxy works?" — the answer is
 * evidence in the tool response. This file proves the prober itself against a
 * LOCAL loopback stand-in for the proxy gateway (never the real network, never
 * real credentials):
 *
 *   - success       → { verified:true, exit_ip, org, asn, country, latency_ms }
 *   - HTTP 402      → payment_required  (the confirmed F11 gateway signature:
 *                     auth accepted, routing refused — curl shows only exit 56)
 *   - HTTP 407      → auth_failed
 *   - no response   → timeout (bounded by timeoutMs, default 5s)
 *   - conn refused  → network_error
 *   - garbage body  → bad_response
 *
 * Also pinned: the request is a single absolute-form GET carrying
 * Proxy-Authorization (never a CONNECT tunnel — works on any HTTP forward
 * proxy), credentials never appear in the RESULT object, and verify is
 * local-stdio-only (hosted runtimes are detected and refused).
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  verifyProxyExit,
  isVerifySupportedRuntime,
  pickProxyListEntry,
  DEFAULT_ECHO_TIMEOUT_MS,
} from "../../src/tools/proxy_verify.js";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => {
    s.closeAllConnections?.();
    return new Promise((res) => s.close(res));
  }));
  servers.length = 0;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.NEXT_RUNTIME;
});

/** Loopback stand-in for the proxy gateway. Returns { port, requests }. */
async function startFakeGateway(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ port: number; requests: http.IncomingMessage[] }> {
  const requests: http.IncomingMessage[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req);
    handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const port = (server.address() as AddressInfo).port;
  return { port, requests };
}

const TARGET = { host: "127.0.0.1", username: "fixture-user-zone-res", password: "fixture-pass" };

const ECHO_BODY = JSON.stringify({
  status: "success",
  query: "68.14.23.7",
  country: "United States",
  countryCode: "US",
  org: "Cox Communications",
  as: "AS22773 Cox Communications Inc.",
});

describe("verifyProxyExit — success evidence", () => {
  it("200 + echo JSON → verified with exit_ip / org / asn / country / latency", async () => {
    const { port, requests } = await startFakeGateway((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(ECHO_BODY);
    });

    const result = await verifyProxyExit({ ...TARGET, port });
    expect(result.verified).toBe(true);
    if (!result.verified) throw new Error("unreachable");
    expect(result.exit_ip).toBe("68.14.23.7");
    expect(result.org).toBe("Cox Communications");
    expect(result.asn).toBe("AS22773 Cox Communications Inc.");
    expect(result.country).toBe("United States");
    expect(result.country_code).toBe("US");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);

    // ONE request, absolute-form GET (forward-proxy semantics, no CONNECT),
    // with Proxy-Authorization carrying the issued credentials.
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].url).toMatch(/^http:\/\//);
    const auth = requests[0].headers["proxy-authorization"];
    expect(auth).toMatch(/^Basic /);
    const decoded = Buffer.from((auth as string).slice(6), "base64").toString("utf8");
    expect(decoded).toBe("fixture-user-zone-res:fixture-pass");
  });

  it("INVARIANT: credentials never appear in the result object", async () => {
    const { port } = await startFakeGateway((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(ECHO_BODY);
    });
    const result = await verifyProxyExit({ ...TARGET, port });
    const dump = JSON.stringify(result);
    expect(dump).not.toContain("fixture-user-zone-res");
    expect(dump).not.toContain("fixture-pass");
  });
});

describe("verifyProxyExit — failure classification", () => {
  it("HTTP 402 → payment_required (gateway auths then refuses to route — the F11 signature)", async () => {
    const { port } = await startFakeGateway((_req, res) => {
      res.writeHead(402);
      res.end("Payment Required");
    });
    const result = await verifyProxyExit({ ...TARGET, port });
    expect(result.verified).toBe(false);
    if (result.verified) throw new Error("unreachable");
    expect(result.failure_class).toBe("payment_required");
    expect(result.http_status).toBe(402);
    expect(result.detail).toMatch(/402/);
  });

  it("HTTP 407 → auth_failed", async () => {
    const { port } = await startFakeGateway((_req, res) => {
      res.writeHead(407, { "Proxy-Authenticate": "Basic" });
      res.end();
    });
    const result = await verifyProxyExit({ ...TARGET, port });
    expect(result.verified).toBe(false);
    if (result.verified) throw new Error("unreachable");
    expect(result.failure_class).toBe("auth_failed");
    expect(result.http_status).toBe(407);
  });

  it("gateway never responds → timeout (bounded by timeoutMs)", async () => {
    const { port } = await startFakeGateway(() => {
      /* accept the request, never answer */
    });
    const started = Date.now();
    const result = await verifyProxyExit({ ...TARGET, port }, 200);
    expect(Date.now() - started).toBeLessThan(DEFAULT_ECHO_TIMEOUT_MS);
    expect(result.verified).toBe(false);
    if (result.verified) throw new Error("unreachable");
    expect(result.failure_class).toBe("timeout");
  });

  it("connection refused → network_error", async () => {
    // Grab a port, then close the server so the port is dead.
    const { port } = await startFakeGateway((_req, res) => res.end());
    await new Promise((res) => servers.pop()!.close(res));

    const result = await verifyProxyExit({ ...TARGET, port });
    expect(result.verified).toBe(false);
    if (result.verified) throw new Error("unreachable");
    expect(result.failure_class).toBe("network_error");
  });

  it("200 + non-JSON body → bad_response", async () => {
    const { port } = await startFakeGateway((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>blocked</html>");
    });
    const result = await verifyProxyExit({ ...TARGET, port });
    expect(result.verified).toBe(false);
    if (result.verified) throw new Error("unreachable");
    expect(result.failure_class).toBe("bad_response");
  });
});

describe("isVerifySupportedRuntime — verify is local-stdio-only", () => {
  it("plain local process → supported", () => {
    expect(isVerifySupportedRuntime()).toBe(true);
  });
  it("VERCEL runtime → not supported", () => {
    process.env.VERCEL = "1";
    expect(isVerifySupportedRuntime()).toBe(false);
  });
  it("edge runtime → not supported", () => {
    process.env.NEXT_RUNTIME = "edge";
    expect(isVerifySupportedRuntime()).toBe(false);
  });
});

describe("pickProxyListEntry — first entry of an IP:PORT:USER:PASS list", () => {
  it("parses the first valid entry (password may contain colons)", () => {
    const entry = pickProxyListEntry("151.242.47.74:8886:fixtureUser:fixture:pass:with:colons\n1.2.3.4:1:u:p");
    expect(entry).toEqual({
      host: "151.242.47.74",
      port: 8886,
      username: "fixtureUser",
      password: "fixture:pass:with:colons",
    });
  });
  it("returns null for unset / empty / malformed lists", () => {
    expect(pickProxyListEntry(undefined)).toBeNull();
    expect(pickProxyListEntry("")).toBeNull();
    expect(pickProxyListEntry("host-only\n1.2.3.4:80")).toBeNull();
    expect(pickProxyListEntry("1.2.3.4:notaport:u:p")).toBeNull();
  });
});
