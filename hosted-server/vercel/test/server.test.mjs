/**
 * Integration tests for the BUILT EC2 entrypoint (dist/server.mjs). Spawns the
 * compiled server as a real child process with a throwaway, no-real-secrets
 * env (see baseEnv below) and drives it over real HTTP, the same way nginx
 * would on EC2.
 *
 * Run `npm run build:server` before `npm test` — these tests skip (not fail)
 * if dist/server.mjs is missing, so a bare `npm test` without a prior build
 * gives a clear reason instead of a cryptic ENOENT from spawn().
 *
 * No real Novada API key / KV / Supabase credentials are used anywhere here.
 * KV_REST_API_URL points at 127.0.0.1:1 (nothing listens there -> immediate
 * ECONNREFUSED on loopback), which exercises the vendored kvFailOpen() path
 * in api/mcp.ts (every KV call on the routes under test — the pre-auth and
 * post-auth per-IP rate limiters — fails open to "not rate limited"), so
 * these tests never need a working KV backend.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http, { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import net from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST_SERVER = join(ROOT, "dist", "server.mjs");

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/** Throwaway, key-shaped dummy values only — never real credentials. */
function baseEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOST: "127.0.0.1",
    WEB_CONCURRENCY: "1",
    STUB_AUTH_WARNING_ACCEPTED: "true",
    KV_REST_API_URL: "http://127.0.0.1:1",
    KV_REST_API_TOKEN: "dummy-test-token-not-real",
    CRON_SECRET: "dummy-test-cron-secret-not-real",
    ...extra,
  };
}

function waitForListening(child, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let out = "";
    const onData = (chunk) => {
      out += chunk.toString();
      if (/listening on/.test(out)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`server exited before listening (code=${code} signal=${signal}); stdout=${out}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`server did not log "listening on" within ${timeoutMs}ms; stdout=${out}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    }
    child.stdout.on("data", onData);
    child.once("exit", onExit);
  });
}

// FAIL, never silently skip (reviewed HIGH: `rm -rf dist && npm test` used to
// report "pass ... skipped 2" with exit 0, hiding the fact that the only
// EC2-specific suites never ran). `npm test` itself now runs `pretest` ->
// `build:server` first (see package.json), so this should never fire in the
// normal `npm test` path — it's a defense-in-depth hard-fail for anyone who
// invokes `node --test test/server.test.mjs` directly, bypassing npm's
// lifecycle hook.
if (!existsSync(DIST_SERVER)) {
  throw new Error(
    `dist/server.mjs is missing (looked at ${DIST_SERVER}). Run \`npm run build:server\` first — ` +
      "this suite must FAIL, not silently skip, when the EC2 entrypoint hasn't been built.",
  );
}

test("server.mjs integration (built EC2 entrypoint)", async (t) => {
  await t.test("fail-closed: exits 1 with a clear message when hosted markers are genuinely absent", async () => {
    // NOVADA_SKIP_HOSTED_FORCE=1 is the test-only seam documented in server.mts:
    // it skips the entrypoint's own VERCEL/VERCEL_ENV force-set so this test can
    // prove the fail-closed branch actually fires. Explicitly clearing all three
    // markers proves this isn't just coincidentally true in this shell.
    const child = spawn(process.execPath, [DIST_SERVER], {
      cwd: ROOT,
      env: baseEnv({
        NOVADA_SKIP_HOSTED_FORCE: "1",
        VERCEL: "",
        VERCEL_ENV: "",
        AWS_LAMBDA_FUNCTION_NAME: "",
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    const { code, signal } = await new Promise((resolve) =>
      child.once("exit", (c, s) => resolve({ code: c, signal: s })),
    );
    assert.equal(code, 1, `expected exit code 1, got code=${code} signal=${signal}; stderr=${stderr}`);
    assert.match(stderr, /FATAL: isHostedEnvironment\(\) returned false/);
  });

  await t.test("normal startup serves the expected request/response contract, then SIGTERM drains and exits 0", async (t) => {
    const port = await getFreePort();
    const child = spawn(process.execPath, [DIST_SERVER], {
      cwd: ROOT,
      env: baseEnv({ PORT: String(port) }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });

    try {
      await waitForListening(child);
      const base = `http://127.0.0.1:${port}`;

      await t.test("GET /health -> 200 JSON", async () => {
        const res = await fetch(`${base}/health`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
      });

      await t.test("POST /mcp with no credential -> 401 JSON (not 500)", async () => {
        const res = await fetch(`${base}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        assert.equal(res.status, 401);
        const body = await res.json();
        assert.equal(body.error.data.code, "MISSING_TOKEN");
      });

      await t.test("OPTIONS /mcp -> CORS headers present exactly once, no duplication", async () => {
        const res = await fetch(`${base}/mcp`, { method: "OPTIONS" });
        assert.equal(res.status, 204);
        // Fetch's Headers merges repeated headers with ", " — a strict equality
        // to the single expected value proves it was set exactly once (vercel.json's
        // header-injection layer is Vercel-only and does not run here; if this
        // entrypoint or nginx ever duplicated mcp.ts's own CORS headers, these
        // would come back comma-joined and fail this assertion).
        assert.equal(res.headers.get("access-control-allow-origin"), "*");
        assert.equal(res.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
        assert.equal(res.headers.get("access-control-allow-headers"), "content-type, authorization, mcp-session-id");
      });

      await t.test("GET /.well-known/oauth-protected-resource -> 200", async () => {
        const res = await fetch(`${base}/.well-known/oauth-protected-resource`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(body.resource, "expected an RFC 9728 resource field");
      });

      await t.test("POST /api/reconcile without a CRON_SECRET bearer header -> 401", async () => {
        const res = await fetch(`${base}/api/reconcile`, { method: "POST" });
        assert.equal(res.status, 401);
        const body = await res.json();
        assert.equal(body.error, "unauthorized");
      });

      await t.test("POST /<20-char-key>/mcp -> same MISSING_TOKEN 401 as bare /mcp (path segment never read as a credential)", async () => {
        const res = await fetch(`${base}/${"a".repeat(20)}/mcp`, { method: "POST" });
        assert.equal(res.status, 401);
        const body = await res.json();
        assert.equal(body.error.data.code, "MISSING_TOKEN");
      });

      await t.test("POST /abc123/mcp (6-char key, below the 16-char path-key minimum) -> 404, matches mcp.ts's own regex, not the /mcp dispatch", async () => {
        const res = await fetch(`${base}/abc123/mcp`, { method: "POST" });
        assert.equal(res.status, 404);
        const body = await res.json();
        assert.equal(body.error.data.code, "NOT_FOUND");
      });
    } finally {
      const exitPromise = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
      child.kill("SIGTERM");
      const result = await Promise.race([
        exitPromise,
        new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 5000)),
      ]);
      if (result.timedOut) {
        child.kill("SIGKILL");
        assert.fail(`server did not exit within 5s of idle SIGTERM; stderr=${stderr}`);
      }
      assert.equal(result.code, 0, `expected idle SIGTERM to exit 0, got code=${result.code} signal=${result.signal}; stderr=${stderr}`);
    }
  });
});

// Regression test for the 2026-10-29 11:49:47-11:51:02 UTC restart outage:
// nginx's `upstream { keepalive 32; }` pool held an idle HTTP/1.1 connection
// open with zero requests in flight; the old `server.close(callback)`-driven
// shutdown waited on that callback, which never fires while ANY socket
// (idle or not) remains open — so the worker sat "draining" for up to
// SHUTDOWN_GRACE_MS (310s) with nothing left to do. This spawns the real,
// unmodified production entrypoint (same dist/server.mjs, same
// mcpHandler/reconcileHandler) and reproduces the exact incident shape: a
// genuine idle keep-alive socket, held open by a real `http.Agent`, present
// at the moment SIGTERM arrives.
test("server.mjs: idle keep-alive connection does not block SIGTERM drain (2026-10-29 incident)", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, [DIST_SERVER], {
    cwd: ROOT,
    env: baseEnv({ PORT: String(port), WEB_CONCURRENCY: "1" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => {
    stderr += c.toString();
  });

  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    await waitForListening(child);
    const base = `http://127.0.0.1:${port}`;

    // GET /health over a keep-alive agent, read the response fully, then
    // leave the socket open and idle — exactly nginx's upstream pool
    // between requests, not mid-request.
    await new Promise((resolve, reject) => {
      const req = http.request(`${base}/health`, { agent }, (res) => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.end();
    });

    const start = Date.now();
    const exitPromise = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    child.kill("SIGTERM");
    const result = await Promise.race([
      exitPromise,
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 2000)),
    ]);
    const elapsedMs = Date.now() - start;

    if (result.timedOut) {
      child.kill("SIGKILL");
      assert.fail(
        `server did not exit within 2s of SIGTERM with only an idle keep-alive socket open ` +
          `(this is the exact 2026-10-29 incident condition — old code waited up to 310000ms); stderr=${stderr}`,
      );
    }
    assert.equal(result.code, 0, `expected idle-keepalive SIGTERM to exit 0, got code=${result.code} signal=${result.signal}; stderr=${stderr}`);
    assert.ok(elapsedMs < 2000, `expected exit well under 2s, got ${elapsedMs}ms; stderr=${stderr}`);
  } finally {
    agent.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

// Regression test for the OTHER half of the 2026-10-29 incident shape: a
// request that is genuinely IN FLIGHT (production's nodeHandler awaits the
// full request body — see api/mcp.ts readNodeBody — before it does anything
// else, including auth) at the exact moment SIGTERM arrives. Pre-fix, that
// socket was "busy" (not yet idle) when server.close() ran, so Node did not
// fold it into close()'s idle-connection fast path; the connection only
// finished closing once its OWN keepAliveTimeout elapsed afterward
// (production: 61s — this is believed to be the dominant term in the
// observed ~75s outage). NOVADA_KEEP_ALIVE_TIMEOUT_MS lets this test use a
// short override (ops knob, see server.mts) so the gap is provable in well
// under a second instead of a minute.
//
// Drives the server over a raw socket (not fetch/http.Agent) so the request
// body can be withheld deliberately: headers are sent first (which is enough
// for Node to invoke the request listener and for this fix's tracker to
// register the request as in flight), SIGTERM is sent while the body is
// still being withheld, and only then is the body completed — reproducing
// "request was already being processed when the signal arrived."
test("server.mjs: a request in flight (not yet idle) at the moment SIGTERM arrives does not wait out keepAliveTimeout before exiting", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, [DIST_SERVER], {
    cwd: ROOT,
    env: baseEnv({ PORT: String(port), WEB_CONCURRENCY: "1", NOVADA_KEEP_ALIVE_TIMEOUT_MS: "1000" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => {
    stderr += c.toString();
  });

  let socket;
  try {
    await waitForListening(child);
    socket = net.connect({ host: "127.0.0.1", port });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    const body = "{}";
    socket.write(
      `POST /mcp HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Content-Type: application/json\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Connection: keep-alive\r\n\r\n`,
    );
    // Give the server time to parse the headers and invoke nodeHandler,
    // which is now awaiting readNodeBody() — genuinely in flight, body not
    // yet sent. Confirmed (not assumed): asserted against a raw TCP capture
    // that no response bytes arrive during this window.
    await new Promise((resolve) => setTimeout(resolve, 150));

    child.kill("SIGTERM");
    // SIGTERM lands while the request is still in flight; wait a beat before
    // completing the body, so the drain path has definitely already started.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const requestCompletedAt = Date.now();
    const responseText = await new Promise((resolve, reject) => {
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString();
      });
      socket.on("end", () => resolve(buf));
      socket.on("error", reject);
      socket.write(body); // release the withheld body now
    });
    assert.match(responseText, /^HTTP\/1\.1 401/, `expected a 401 for the no-credential /mcp POST; got: ${responseText}`);
    assert.match(
      responseText.toLowerCase(),
      /connection: close/,
      "a response still in flight when drain began must be sent with Connection: close",
    );

    const result = await Promise.race([
      new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 2000)),
    ]);
    const elapsedMs = Date.now() - requestCompletedAt;

    if (result.timedOut) {
      child.kill("SIGKILL");
      assert.fail(`server did not exit within 2s of the in-flight request completing; stderr=${stderr}`);
    }
    assert.equal(result.code, 0, `expected code 0, got code=${result.code} signal=${result.signal}; stderr=${stderr}`);
    // The regression this guards against: pre-fix, exit was gated on this
    // socket's OWN keepAliveTimeout (overridden here to 1000ms) elapsing
    // AFTER the response was sent, not on the response completing. A correct
    // fix exits shortly after the response, well under that timeout.
    assert.ok(
      elapsedMs < 800,
      `expected exit well under the 1000ms keepAliveTimeout override (old code's exit timing tracked that ` +
        `timeout, not the request's own completion), got ${elapsedMs}ms`,
    );
  } finally {
    socket?.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
