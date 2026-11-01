/**
 * Integration tests for the crash-loop guard against the REAL BUILT server,
 * round 2 (see crash-loop-policy.ts and stage1-worker-report.md "Fix round 2"
 * for the full redesign rationale: the round-1 wall-clock rolling-window
 * ceiling never tripped at realistic WEB_CONCURRENCY with shipped defaults).
 *
 * Fault injection, reviewer's own method ("building into a temp copy" — never
 * a seam reachable in production code): copies the real BUILT dist/ into a
 * throwaway directory under hosted-server/vercel/ (so Node's node_modules
 * ancestor-walk still resolves bare imports like "@sentry/node" the same way
 * it does for the real dist/), then overwrites ONLY that copy's api/mcp.js.
 * api/mcp.ts itself is never touched — this never runs against the real dist/.
 * The temp directory is created and destroyed entirely within each test's
 * try/finally; `.tmp-crashloop-test-*` is also gitignored as a backstop.
 *
 * Two scenarios, both run with PRODUCTION DEFAULT crash-loop constants (no
 * NOVADA_MAX_EARLY_DEATHS / NOVADA_REFORK_BACKOFF_*_MS overrides) — only
 * NOVADA_HEALTHY_AFTER_MS is shortened in the second scenario, and ONLY
 * because test/crash-loop-policy.test.mjs already proves the default 30s
 * value algebraically (no real server/timer needed for that) — this
 * integration test's job is to prove the WIRING (cluster "listening" event,
 * per-worker timer, shared state threaded through runPrimary) against a real
 * process, not to re-prove the 30s constant itself, which would make this
 * test needlessly slow for no extra coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");
const DIST_SERVER = join(DIST, "server.mjs");

// FAIL, never silently skip — see server.test.mjs for the full rationale.
if (!existsSync(DIST_SERVER)) {
  throw new Error(
    `dist/server.mjs is missing (looked at ${DIST_SERVER}). Run \`npm run build:server\` first — ` +
      "this suite must FAIL, not silently skip, when the EC2 entrypoint hasn't been built.",
  );
}

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

function makeTmpDistCopy(suffix) {
  const tmpDir = join(ROOT, `.tmp-crashloop-test-${suffix}-${process.pid}-${Date.now()}`);
  cpSync(DIST, tmpDir, { recursive: true });
  return tmpDir;
}

function baseEnv(port, extra = {}) {
  return {
    PATH: process.env.PATH,
    PORT: String(port),
    HOST: "127.0.0.1",
    STUB_AUTH_WARNING_ACCEPTED: "true",
    KV_REST_API_URL: "http://127.0.0.1:1",
    KV_REST_API_TOKEN: "dummy-test-token-not-real",
    CRON_SECRET: "dummy-test-cron-secret-not-real",
    ...extra,
  };
}

test("crash-loop guard (PRODUCTION DEFAULTS): persistent startup fault -> primary exits(1) within ~10s instead of looping forever", async () => {
  const tmpDir = makeTmpDistCopy("persistent-fault");
  // Fault injection: this file throws the instant it's imported, so every
  // forked worker dies within milliseconds of starting, well before any
  // HEALTHY_AFTER_MS threshold — exactly the reviewer's original repro shape
  // (a corrupted/missing handler module), now run with NO env overrides for
  // the crash-loop constants (production defaults: MAX_EARLY_DEATHS=3,
  // REFORK_BACKOFF_BASE_MS=1000, REFORK_BACKOFF_MAX_MS=30000).
  writeFileSync(
    join(tmpDir, "api", "mcp.js"),
    'throw new Error("INJECTED_TEST_FAULT: forced import-time crash (test only, never reachable in production)");\n',
  );

  const port = await getFreePort();
  const child = spawn(process.execPath, [join(tmpDir, "server.mjs")], {
    cwd: ROOT,
    env: baseEnv(port, { WEB_CONCURRENCY: "2" }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  child.stdout.on("data", (c) => (out += c.toString()));
  child.stderr.on("data", (c) => (out += c.toString()));

  try {
    const { code, signal, timedOut } = await Promise.race([
      new Promise((resolve) => child.once("exit", (c, s) => resolve({ code: c, signal: s, timedOut: false }))),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 10_000)),
    ]);

    if (timedOut) {
      child.kill("SIGKILL");
      assert.fail(
        `crash-loop guard did not make the primary exit within 10s at PRODUCTION DEFAULTS — this is the exact round-1 regression (quiet permanent loop). Captured output:\n${out}`,
      );
    }

    assert.equal(code, 1, `expected the primary to exit(1) once MAX_EARLY_DEATHS is hit; signal=${signal}; output:\n${out}`);
    assert.match(out, /consecutive pre-healthy worker deaths.*crash-loop detected, exiting\(1\)/s, `expected the crash-loop message in output:\n${out}`);
    assert.match(out, /becameHealthy=false/, `every death here must be classified pre-healthy; output:\n${out}`);

    // At MAX_EARLY_DEATHS=3 (production default) the primary must stop at
    // exactly 3 deaths — not drift, not require many more like the round-1
    // rolling-window version effectively did (it needed 11+ within 60s and
    // STILL never tripped at this concurrency).
    const deathCount = (out.match(/exited unexpectedly/g) ?? []).length;
    assert.equal(deathCount, 3, `expected exactly 3 worker deaths (MAX_EARLY_DEATHS) before exit, got ${deathCount}. Output:\n${out}`);
  } finally {
    if (!child.killed) child.kill("SIGKILL");
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("crash-loop guard mirror: a worker that becomes healthy then crashes ONCE -> primary stays up and reforks (never exits)", async () => {
  const tmpDir = makeTmpDistCopy("healthy-then-crash");
  // Fault injection: rename the real compiled handler aside, then install a
  // thin wrapper that re-exports it unchanged AND, ONLY for cluster worker
  // slot #1 (cluster.worker.id — the first fork; its eventual replacement
  // gets a new, higher id and does NOT re-arm), self-destructs once after
  // NOVADA_TEST_SELF_DESTRUCT_AFTER_MS. This never touches api/mcp.ts and
  // never runs against the real dist/.
  const realHandler = join(tmpDir, "api", "_mcp_real.js");
  renameSync(join(tmpDir, "api", "mcp.js"), realHandler);
  writeFileSync(
    join(tmpDir, "api", "mcp.js"),
    [
      'import cluster from "node:cluster";',
      'export { default, config } from "./_mcp_real.js";',
      "",
      "// Test-only fault injection (temp copy, never production code): the FIRST",
      "// forked worker self-destructs exactly once, after it has already been",
      "// given time to cross NOVADA_HEALTHY_AFTER_MS.",
      'if (cluster.worker && cluster.worker.id === 1) {',
      '  const ms = parseInt(process.env.NOVADA_TEST_SELF_DESTRUCT_AFTER_MS ?? "500", 10);',
      "  setTimeout(() => {",
      '    console.error("[test-fault-injection] self-destructing once (simulated OOM/crash) after", ms, "ms");',
      "    process.exit(1);",
      "  }, ms);",
      "}",
      "",
    ].join("\n"),
  );

  const port = await getFreePort();
  const HEALTHY_AFTER_MS = 200; // short override — default 30s is already covered algebraically
  const SELF_DESTRUCT_AFTER_MS = 600; // fires AFTER the healthy threshold
  const child = spawn(process.execPath, [join(tmpDir, "server.mjs")], {
    cwd: ROOT,
    env: baseEnv(port, {
      WEB_CONCURRENCY: "2",
      NOVADA_HEALTHY_AFTER_MS: String(HEALTHY_AFTER_MS),
      NOVADA_TEST_SELF_DESTRUCT_AFTER_MS: String(SELF_DESTRUCT_AFTER_MS),
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  child.stdout.on("data", (c) => (out += c.toString()));
  child.stderr.on("data", (c) => (out += c.toString()));
  let exited = null;
  child.once("exit", (code, signal) => {
    exited = { code, signal };
  });

  try {
    // Wait comfortably past: healthy threshold (200ms) + self-destruct
    // (600ms) + a refork cycle.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    assert.equal(exited, null, `primary must NOT have exited; output:\n${out}`);
    assert.match(out, /reached healthy \(listening >= 200ms\)/, `expected a healthy-reached log line; output:\n${out}`);
    assert.match(out, /self-destructing once/, `expected the injected self-destruct to have fired; output:\n${out}`);
    assert.match(out, /becameHealthy=true/, `the self-destructed worker must be classified as having become healthy; output:\n${out}`);
    assert.match(out, /refork now \(previous worker had reached healthy before dying\)/, `expected a PROMPT refork (no backoff), not a backoff-delayed one; output:\n${out}`);
    assert.doesNotMatch(out, /crash-loop detected/, `a healthy-then-crash death must never trip the crash-loop ceiling; output:\n${out}`);

    // Prove the service is actually still serving (not just "process alive"):
    // the refork must have brought a working worker back up.
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200, `expected /health to still succeed after the refork; output:\n${out}`);
  } finally {
    const exitPromise = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    child.kill("SIGTERM");
    await Promise.race([exitPromise, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (!child.killed) child.kill("SIGKILL");
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
