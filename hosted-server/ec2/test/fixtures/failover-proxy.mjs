#!/usr/bin/env node
// failover-proxy.mjs — tiny local reverse-proxy fixture for
// drill-zero-downtime-selftest.sh's "one real instance down" scenario. NOT
// a reimplementation of nginx or of drill-zero-downtime.sh's own logic —
// both of those are exercised unmodified elsewhere. This fixture exists
// only to stand in for nginx's documented proxy_next_upstream default
// (`error timeout`: on a connection error or timeout to one upstream,
// retry the request against the next one in the list — see
// nginx-snippet-novada-mcp-proxy.conf's own comment, which quotes the real
// directive this mirrors) so the drill can be pointed at something that
// behaves like "one instance down, nginx fails over to the other" without
// needing a real nginx install in this sandbox.
//
// Round-robins across --targets (comma-separated ports) per request, and on
// a connection error to the chosen target, retries the OTHER targets in
// order before giving up and answering 502 — exactly mirroring nginx's
// "exhausted the upstream list" fallback.
import http from "node:http";

const args = process.argv.slice(2);
function argVal(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const listenPort = parseInt(argVal("--listen", "0"), 10);
const targets = argVal("--targets", "")
  .split(",")
  .map((p) => parseInt(p, 10))
  .filter((p) => Number.isFinite(p));

if (targets.length === 0) {
  console.error("failover-proxy: --targets is required (comma-separated ports)");
  process.exit(1);
}

let rrIndex = 0;

function proxyOnce(targetPort, req, bodyChunks) {
  return new Promise((resolve, reject) => {
    const upstreamReq = http.request(
      {
        host: "127.0.0.1",
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
        timeout: 2000,
      },
      (upstreamRes) => {
        const chunks = [];
        upstreamRes.on("data", (c) => chunks.push(c));
        upstreamRes.on("end", () =>
          resolve({ statusCode: upstreamRes.statusCode, headers: upstreamRes.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    upstreamReq.on("timeout", () => upstreamReq.destroy(new Error("timeout")));
    upstreamReq.on("error", reject);
    for (const chunk of bodyChunks) upstreamReq.write(chunk);
    upstreamReq.end();
  });
}

const server = http.createServer(async (req, res) => {
  const bodyChunks = [];
  req.on("data", (c) => bodyChunks.push(c));
  req.on("end", async () => {
    // Round-robin starting point, then fail over through the rest of the
    // list on a connection error — same shape as nginx's proxy_next_upstream
    // walking the upstream block.
    const order = [];
    for (let i = 0; i < targets.length; i++) order.push(targets[(rrIndex + i) % targets.length]);
    rrIndex = (rrIndex + 1) % targets.length;

    for (const targetPort of order) {
      try {
        const result = await proxyOnce(targetPort, req, bodyChunks);
        res.writeHead(result.statusCode, result.headers);
        res.end(result.body);
        return;
      } catch {
        // connection error/timeout to this target -> try the next one,
        // exactly like nginx's default `error timeout` next_upstream list.
        continue;
      }
    }
    // Every target failed -> same as nginx exhausting the upstream block.
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("Bad Gateway (all upstreams unreachable)");
  });
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`failover-proxy: listening on 127.0.0.1:${listenPort}, targets=${targets.join(",")}`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
