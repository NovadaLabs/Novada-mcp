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
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
