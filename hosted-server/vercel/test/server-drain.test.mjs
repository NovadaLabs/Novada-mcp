/**
 * Regression tests for the 2026-10-29 11:49:47–11:51:02 UTC restart outage.
 *
 * Root cause: `systemctl restart novada-mcp` sends SIGTERM; the old worker
 * shutdown called `server.close(callback)` and waited for the callback to
 * decide when to `process.exit()`. That callback only fires once EVERY
 * socket is closed — including sockets nginx's `upstream { keepalive 32; }`
 * pool was holding open between requests with nothing in flight at all. One
 * worker (no idle keepalive socket at that instant) drained instantly; the
 * other sat in "draining (up to 310000ms)" until SIGKILL, because an idle
 * keep-alive socket alone kept `server.close()`'s callback from ever firing.
 * `systemctl restart` is stop-then-start, so the service was fully down for
 * ~75s.
 *
 * Fix under test (`createDrainTracker` / `drainServer` / `createRequestListener`
 * in server.mts): track in-flight requests EXPLICITLY — never infer liveness
 * from connection/socket count — and exit the instant that count hits zero,
 * using `server.closeIdleConnections()` to force-close idle sockets
 * immediately rather than waiting for them.
 *
 * These tests exercise the exported drain primitives directly against a real
 * `node:http` server (same pattern as test/server-router.test.mjs: real
 * server + stub handlers, not the production mcp.ts handler — that handler's
 * own behavior is covered by the rest of test/*.test.mjs). This keeps the
 * tests fast and deterministic while still exercising the REAL
 * `createRequestListener` / `createDrainTracker` / `drainServer` wiring that
 * runWorker() uses in production, unmodified.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_SERVER = join(__dirname, "..", "dist", "server.mjs");

// FAIL, never silently skip — see test/server.test.mjs's identical guard for
// the reviewed HIGH this pattern fixes (a missing build used to make these
// suites silently skip with exit 0).
if (!existsSync(DIST_SERVER)) {
  throw new Error(
    `dist/server.mjs is missing (looked at ${DIST_SERVER}). Run \`npm run build:server\` first — ` +
      "this suite must FAIL, not silently skip, when the EC2 entrypoint hasn't been built.",
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET on a keep-alive agent, read the response fully, then DO NOT close the
 *  socket — leaves it genuinely idle (no request in flight) from the
 *  server's point of view, exactly nginx's upstream keepalive pool's state
 *  between requests. */
function getKeepingSocketOpen(base, agent) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/ok`, { agent }, (res) => {
      res.resume();
      res.on("end", () => resolve());
    });
    req.on("error", reject);
    req.end();
  });
}

function postExpectingResponse(base, agent, path = "/slow") {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method: "POST", agent }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

test("drain (server-drain)", async (t) => {
  await t.test("idle keep-alive connection + drain -> exits in well under the grace period, no new connections accepted", async () => {
    const { createDrainTracker, createRequestListener, drainServer } = await import(DIST_SERVER);

    const ok = async (_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    };
    const tracker = createDrainTracker();
    const server = createServer(createRequestListener(ok, ok, tracker));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      // Request completes fully, then the socket is left open and idle —
      // this is the exact incident condition: a connection with zero
      // in-flight requests, held open by the client's keepalive pool.
      await getKeepingSocketOpen(base, agent);
      assert.equal(tracker.activeCount(), 0, "no request should be in flight after it completed");

      const start = Date.now();
      const exitCode = await new Promise((resolve) => {
        drainServer(server, tracker, { graceMs: 5000, onExit: resolve });
      });
      const elapsedMs = Date.now() - start;

      assert.equal(exitCode, 0, "a drain with nothing in flight must exit cleanly, not via the grace-timeout path");
      assert.ok(
        elapsedMs < 2000,
        `expected exit well under the 2s incident threshold (old code waited up to 310000ms), got ${elapsedMs}ms`,
      );

      // No new connections accepted during drain: the listening socket is
      // already closed by drainServer() (server.close()), independent of
      // the tracker/activeCount logic above.
      await assert.rejects(
        () => new Promise((resolve, reject) => {
          const probe = http.request(`${base}/ok`, { agent: new http.Agent({ keepAlive: false }) }, resolve);
          probe.on("error", reject);
          probe.end();
        }),
        /ECONNREFUSED/,
        "a new connection attempt after drain has begun must be refused",
      );
    } finally {
      agent.destroy();
    }
  });

  await t.test("in-flight slow request + drain -> request completes with 200 and Connection: close, worker drains right after (not the full grace period)", async () => {
    const { createDrainTracker, createRequestListener, drainServer } = await import(DIST_SERVER);

    // Deliberately shorter than the ~3s tool-call shape this mirrors
    // (production's FUNCTION_MAX_DURATION_S is 300s) — long enough to
    // reliably still be in flight when drainServer() is called, short enough
    // to keep the test fast. Mirrors the HANDLER_DELAY_MS pattern already
    // used by test/server-crash-loop.test.mjs (shortening a production-shaped
    // constant for test speed, with the production path proven separately).
    const HANDLER_DELAY_MS = 400;
    let handlerStarted = false;
    const slow = async (_req, res) => {
      handlerStarted = true;
      await sleep(HANDLER_DELAY_MS);
      res.statusCode = 200;
      res.end("slow-ok");
    };
    const ok = async (_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    };
    const tracker = createDrainTracker();
    const server = createServer(createRequestListener(slow, ok, tracker));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const responsePromise = postExpectingResponse(base, agent, "/slow");
      // Wait until the handler has actually started (request is genuinely
      // in flight) before draining, so this isn't racing request dispatch.
      while (!handlerStarted) {
        await sleep(5);
      }
      assert.equal(tracker.activeCount(), 1, "the slow request must be tracked as in flight");

      const drainStart = Date.now();
      const exitCodePromise = new Promise((resolve) => {
        drainServer(server, tracker, { graceMs: 5000, onExit: resolve });
      });

      const response = await responsePromise;
      assert.equal(response.status, 200, "the in-flight request must complete normally, not be cut off by the drain");
      assert.equal(response.body, "slow-ok");
      assert.equal(
        response.headers.connection,
        "close",
        "a response still in flight when drain began must carry Connection: close so its socket is not returned to a keepalive pool",
      );

      const exitCode = await exitCodePromise;
      const elapsedMs = Date.now() - drainStart;
      assert.equal(exitCode, 0, "drain must resolve cleanly once the in-flight request finishes");
      assert.ok(
        elapsedMs < HANDLER_DELAY_MS + 1500,
        `expected drain to finish shortly after the in-flight request completed (~${HANDLER_DELAY_MS}ms), not wait out the 5000ms grace period; got ${elapsedMs}ms`,
      );
      assert.equal(tracker.activeCount(), 0);
    } finally {
      agent.destroy();
    }
  });

  await t.test("drain with nothing in flight and nothing idle still resolves immediately (no hang waiting for a connection that never existed)", async () => {
    const { createDrainTracker, createRequestListener, drainServer } = await import(DIST_SERVER);
    const ok = async (_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    };
    const tracker = createDrainTracker();
    const server = createServer(createRequestListener(ok, ok, tracker));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    const exitCode = await new Promise((resolve) => {
      drainServer(server, tracker, { graceMs: 5000, onExit: resolve });
    });
    assert.equal(exitCode, 0);
  });

  await t.test("a request that genuinely exceeds the grace period forces exit(1) via the hard cap, not an infinite hang", async () => {
    const { createDrainTracker, createRequestListener, drainServer } = await import(DIST_SERVER);
    const stuck = async () => {
      // Never calls res.end() — simulates a request that would run past the
      // grace period. drainServer's hard cap must still fire.
    };
    const tracker = createDrainTracker();
    const server = createServer(createRequestListener(stuck, stuck, tracker));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const req = http.request(`${base}/stuck`, { method: "POST", agent });
      // This request is never answered (by design) — cleanup below forcibly
      // destroys its socket, which would otherwise surface as an unhandled
      // "socket hang up" after the test has already finished.
      req.on("error", () => {});
      req.end();
      await new Promise((resolve) => req.on("socket", (socket) => socket.on("connect", resolve)));
      await sleep(50); // let the request reach the handler

      const start = Date.now();
      const exitCode = await new Promise((resolve) => {
        drainServer(server, tracker, { graceMs: 300, onExit: resolve });
      });
      const elapsedMs = Date.now() - start;
      assert.equal(exitCode, 1, "an un-drainable request must hit the hard-cap force-exit path, not hang forever");
      assert.ok(elapsedMs >= 300 && elapsedMs < 1500, `expected the ~300ms grace cap to fire, got ${elapsedMs}ms`);
    } finally {
      // In production, process.exit() (triggered by onExit above) would tear
      // down every remaining socket along with the whole process. Here we
      // only resolved a promise, so the still-open "stuck" connection must be
      // cleaned up explicitly to avoid leaking it into later tests.
      server.closeAllConnections();
      agent.destroy();
    }
  });
});
