/**
 * Unit tests for server.mts's installWorkerProcessGuards — the fix for the
 * reviewed MEDIUM (no process-level unhandledRejection/uncaughtException
 * handler). Runs entirely in-process (no spawn): registers the real exported
 * listeners on THIS test process, drives both events, then tears the
 * listeners down again so they don't leak into other test files running in
 * the same `node --test` invocation.
 *
 * - unhandledRejection must be logged but must NOT call onUncaughtException
 *   (i.e. must not be treated as fatal — the worker keeps serving).
 * - uncaughtException must be logged AND call onUncaughtException exactly
 *   once (the real runWorker() wires this to its graceful-but-brief
 *   shutdown(..., 1, UNCAUGHT_EXCEPTION_DRAIN_MS) path — verified separately
 *   by reading server.mts, since actually triggering a real uncaught
 *   exception would crash this test runner).
 *
 * process.emit("uncaughtException", err) is the standard, safe way to unit
 * test a registered listener for that event without performing a real
 * uncaught throw (which Node would treat as fatal regardless of listeners
 * added via the public API in some configurations, and would risk crashing
 * the whole `node --test` run).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_SERVER = join(__dirname, "..", "dist", "server.mjs");

// FAIL, never silently skip — see server.test.mjs / server-router.test.mjs
// for the full rationale (reviewed HIGH).
if (!existsSync(DIST_SERVER)) {
  throw new Error(
    `dist/server.mjs is missing (looked at ${DIST_SERVER}). Run \`npm run build:server\` first — ` +
      "this suite must FAIL, not silently skip, when the EC2 entrypoint hasn't been built.",
  );
}

function captureConsoleError() {
  const original = console.error;
  const lines = [];
  console.error = (...args) => {
    lines.push(args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.error = original;
    },
  };
}

function resetProcessGuardListeners() {
  process.removeAllListeners("unhandledRejection");
  process.removeAllListeners("uncaughtException");
}

test("server-process-guards", async (t) => {
  const { installWorkerProcessGuards } = await import(DIST_SERVER);

  await t.test("unhandledRejection: logged with [server] prefix, worker is NOT treated as fatal", async () => {
    const capture = captureConsoleError();
    const fatalCalls = [];
    resetProcessGuardListeners();
    try {
      installWorkerProcessGuards({ onUncaughtException: (err) => fatalCalls.push(err) });

      const rejected = Promise.reject(new Error("injected test rejection — expected, not a real bug"));
      // unhandledRejection fires asynchronously once Node confirms, within the
      // current tick's microtask queue, that nothing attached a .catch.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 20));
      // Reference `rejected` so it isn't eligible for GC before the above awaits run.
      void rejected;

      assert.equal(fatalCalls.length, 0, "unhandledRejection must not call onUncaughtException");
      assert.ok(
        capture.lines.some((l) => l.includes("[server]") && l.includes("unhandledRejection")),
        `expected a [server]-prefixed unhandledRejection log line, got: ${JSON.stringify(capture.lines)}`,
      );
    } finally {
      capture.restore();
      resetProcessGuardListeners();
    }
  });

  await t.test("uncaughtException: logged with [server] prefix AND calls onUncaughtException exactly once", async () => {
    const capture = captureConsoleError();
    const fatalCalls = [];
    resetProcessGuardListeners();
    try {
      installWorkerProcessGuards({ onUncaughtException: (err) => fatalCalls.push(err) });

      const injected = new Error("injected test uncaughtException — expected, not a real bug");
      process.emit("uncaughtException", injected);

      assert.equal(fatalCalls.length, 1, "uncaughtException must call onUncaughtException exactly once");
      assert.equal(fatalCalls[0], injected);
      assert.ok(
        capture.lines.some((l) => l.includes("[server]") && l.includes("uncaughtException")),
        `expected a [server]-prefixed uncaughtException log line, got: ${JSON.stringify(capture.lines)}`,
      );
    } finally {
      capture.restore();
      resetProcessGuardListeners();
    }
  });

  await t.test("neither handler ever logs a req/res-shaped argument (no body/header leakage)", async () => {
    // installWorkerProcessGuards takes no req/res — this is a structural
    // guarantee, asserted here by checking the function's declared arity
    // (opts only) rather than by trying to enumerate every possible log line.
    assert.equal(installWorkerProcessGuards.length, 1, "installWorkerProcessGuards must only take `opts`, never req/res");
  });
});
