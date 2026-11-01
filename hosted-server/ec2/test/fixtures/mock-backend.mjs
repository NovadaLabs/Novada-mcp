#!/usr/bin/env node
// mock-backend.mjs — tiny local HTTP backend fixture for
// drill-zero-downtime-selftest.sh. Answers GET /health with 200 and POST
// /mcp (no credential) with 401, mirroring the two probes
// drill-zero-downtime.sh itself issues. --mode flaky additionally returns
// 502 for every request landing in a fixed ~1s window starting ~1s after
// this process starts, simulating a brief real outage window.
import http from "node:http";

const args = process.argv.slice(2);
function argVal(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const port = parseInt(argVal("--port", "0"), 10);
const mode = argVal("--mode", "up");
const start = Date.now();

const server = http.createServer((req, res) => {
  if (mode === "flaky") {
    const elapsed = Date.now() - start;
    if (elapsed > 1000 && elapsed < 2000) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("Bad Gateway (simulated outage window)");
      return;
    }
  }
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  if (req.url === "/mcp" && req.method === "POST") {
    res.writeHead(401, { "content-type": "application/json" });
    res.end('{"error":"missing token"}');
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock-backend: listening on 127.0.0.1:${port} mode=${mode}`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
