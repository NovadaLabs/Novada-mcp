/**
 * Unit tests for server.mts's createRequestListener — the EC2 entrypoint's
 * pathname router + error-isolation wrapper. Imports the BUILT dist/server.mjs
 * directly (run `npm run build:server` first) rather than the real
 * api/mcp.js / api/reconcile.js handlers, so these tests are fast, hermetic,
 * and exercise exactly the routing + error-handling logic this file adds —
 * api/mcp.ts's own behavior is covered by the rest of test/*.test.mjs.
 *
 * Importing dist/server.mjs here does NOT start a cluster or bind a port:
 * main() only runs when server.mts is the Node entrypoint (see isMainModule()
 * in server.mts) — plain `import()` just gives us the exported helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_SERVER = join(__dirname, "..", "dist", "server.mjs");

// FAIL, never silently skip (reviewed HIGH: `rm -rf dist && npm test` used to
// report "pass ... skipped 2" with exit 0, hiding the fact that the only
// EC2-specific suites never ran). `npm test` itself now runs `pretest` ->
// `build:server` first (see package.json), so this should never fire in the
// normal `npm test` path — it's a defense-in-depth hard-fail for anyone who
// invokes `node --test test/server-router.test.mjs` directly, bypassing npm's
// lifecycle hook.
if (!existsSync(DIST_SERVER)) {
  throw new Error(
    `dist/server.mjs is missing (looked at ${DIST_SERVER}). Run \`npm run build:server\` first — ` +
      "this suite must FAIL, not silently skip, when the EC2 entrypoint hasn't been built.",
  );
}

async function withListener(mcpHandler, reconcileHandler, run) {
  const { createRequestListener } = await import(DIST_SERVER);
  const server = createServer(createRequestListener(mcpHandler, reconcileHandler));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("server-router", async (t) => {
  await t.test("synchronous throw in handler -> 500 JSON, not a crash", async () => {
    const throwing = () => {
      throw new Error("boom");
    };
    const ok = async (_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    };
    await withListener(throwing, ok, async (base) => {
      const res = await fetch(`${base}/mcp`);
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.error, "INTERNAL_ERROR");
    });
  });

  await t.test("a rejected promise from an async handler also -> 500 JSON", async () => {
    const rejecting = async () => {
      throw new Error("async boom");
    };
    const ok = async (_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    };
    await withListener(rejecting, ok, async (base) => {
      const res = await fetch(`${base}/mcp`);
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.error, "INTERNAL_ERROR");
    });
  });

  await t.test("after a handler throws, the server keeps serving subsequent requests (no crash, no hang)", async () => {
    let calls = 0;
    const flaky = async (_req, res) => {
      calls++;
      if (calls === 1) throw new Error("first call fails");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, calls }));
    };
    const ok = async (_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    };
    await withListener(flaky, ok, async (base) => {
      const r1 = await fetch(`${base}/mcp`);
      assert.equal(r1.status, 500);
      const r2 = await fetch(`${base}/mcp`);
      assert.equal(r2.status, 200);
      const body = await r2.json();
      assert.deepEqual(body, { ok: true, calls: 2 });
    });
  });

  await t.test("a handler that already sent headers before throwing does not double-send", async () => {
    const partial = async (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.write("partial");
      throw new Error("boom after headers sent");
    };
    const ok = async (_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    };
    await withListener(partial, ok, async (base) => {
      const res = await fetch(`${base}/mcp`);
      // Headers were already 200 before the throw — the catch must not try to
      // set a new status/headers (that would throw ERR_HTTP_HEADERS_SENT and
      // could crash the process). It should just end the response.
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.equal(text, "partial");
    });
  });

  await t.test("routes /api/reconcile to reconcileHandler (query string ignored for routing), everything else to mcpHandler", async () => {
    const seen = [];
    const mcp = async (req, res) => {
      seen.push(["mcp", req.url]);
      res.statusCode = 200;
      res.end();
    };
    const reconcile = async (req, res) => {
      seen.push(["reconcile", req.url]);
      res.statusCode = 200;
      res.end();
    };
    await withListener(mcp, reconcile, async (base) => {
      await fetch(`${base}/api/reconcile?lookbackHours=5`);
      await fetch(`${base}/mcp`);
      await fetch(`${base}/`);
      await fetch(`${base}/health`);
      await fetch(`${base}/some/unmatched/path`);
      assert.deepEqual(seen, [
        ["reconcile", "/api/reconcile?lookbackHours=5"],
        ["mcp", "/mcp"],
        ["mcp", "/"],
        ["mcp", "/health"],
        ["mcp", "/some/unmatched/path"],
      ]);
    });
  });
});
