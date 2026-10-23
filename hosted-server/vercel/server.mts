/**
 * server.mts — long-lived Node process entrypoint for running the Vercel-hosted
 * MCP server (api/mcp.ts, api/reconcile.ts) on a plain EC2 box behind nginx.
 *
 * This file is EC2-ONLY. It changes nothing about api/mcp.ts or api/reconcile.ts
 * (both already export a Node-style `(req, res) => void` handler — see their
 * header comments) and nothing about how the same code deploys to Vercel: this
 * entrypoint is never imported by vercel.json/the Vercel build, so Vercel is
 * unaffected by anything below.
 *
 * NGINX REQUIREMENT (operator, not this file): getClientIp() in api/mcp.ts
 * (~line 2015) trusts `x-vercel-forwarded-for` first, then `x-real-ip` — both
 * are normally set by Vercel's own edge proxy and are otherwise client-
 * spoofable. The nginx reverse proxy in front of this process on EC2 MUST
 * overwrite BOTH headers with the real connecting IP (nginx's $remote_addr),
 * e.g.:
 *   proxy_set_header X-Real-Ip $remote_addr;
 *   proxy_set_header X-Vercel-Forwarded-For $remote_addr;
 * and must NOT pass through any client-supplied values for either header —
 * otherwise the pre-auth / post-auth per-IP rate limits in api/mcp.ts become
 * trivially bypassable.
 *
 * CORS: api/mcp.ts already sets `access-control-allow-*` headers itself (OPTIONS
 * preflight ~line 2222, and on every /mcp response ~line 2378) and api/_wellknown.ts
 * / api/_oauth.ts handle their own routes. This entrypoint and the nginx config in
 * front of it must NOT add a second copy of those headers (vercel.json's `headers`
 * block is Vercel-only and does not apply here) — duplicate headers would merge into
 * a single invalid comma-joined value for most HTTP clients.
 *
 * ── CRITICAL (P0) hosted-environment invariant ──────────────────────────────
 * Vendored tool logic (vendor/novada-mcp/config.js `isHostedEnvironment()`,
 * utils/output.js, tools/site_copy.js, utils/first-run-notice.js) decides
 * hosted-vs-local behavior SOLELY from `process.env.VERCEL || process.env.VERCEL_ENV
 * || process.env.AWS_LAMBDA_FUNCTION_NAME`. If none of those are set on EC2, the
 * server silently writes customer extraction results to disk (~/Downloads),
 * enables site_copy file writes, and changes approval-key semantics — all wrong
 * for a shared multi-tenant hosted endpoint. So: force the hosted markers BEFORE
 * importing any handler, then verify the vendored predicate actually agrees and
 * refuse to start otherwise.
 *
 * NOVADA_SKIP_HOSTED_FORCE=1 is a narrow TEST-ONLY seam (see test/server.test.mjs):
 * it skips ONLY the forcing step below so a test can prove the fail-closed branch
 * actually exits(1) when the hosted markers are genuinely absent. It must never be
 * set in production — nothing here does anything with it besides this one `if`.
 *
 * cleanUrls (M2, accepted no-op): vercel.json sets `cleanUrls: true`, which is a
 * Vercel-edge-only static-file URL normalization (e.g. serving /about for
 * /about.html). This deployment serves NO static files — every route is a
 * dynamic handler (api/mcp.ts / api/reconcile.ts) that does its own exact-string
 * pathname matching regardless of cleanUrls — so there is nothing for nginx/this
 * entrypoint to replicate. Documented, not fixed, by design.
 */

import cluster from "node:cluster";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { pathToFileURL } from "node:url";
import {
  HEALTHY_AFTER_MS,
  initialCrashLoopState,
  onWorkerExit,
  onWorkerHealthy,
  type CrashLoopState,
} from "./crash-loop-policy.js";

export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

// ─── Concurrency: node:cluster, no pm2, no global binaries ───────────────────
// WEB_CONCURRENCY=1 (or unset→2) controls worker count; systemd supervises the
// ONE primary process. Workers that die unexpectedly are re-forked; a clean
// shutdown (SIGTERM) never triggers a refork.
function resolveConcurrency(): number {
  const raw = parseInt(process.env.WEB_CONCURRENCY ?? "2", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
}

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "127.0.0.1";

// Requests may legitimately run up to the vendored FUNCTION_MAX_DURATION_S (300s,
// see api/mcp.ts's `config.maxDuration`). Keep every Node-level timeout comfortably
// above that so Node never cuts a slow-but-legitimate request itself.
const REQUEST_TIMEOUT_MS = 310_000;
const HEADERS_TIMEOUT_MS = 65_000;
const KEEP_ALIVE_TIMEOUT_MS = 61_000;
// Drain grace period on SIGTERM — long enough to let an in-flight 300s request
// finish, short enough that systemd's own TimeoutStopSec (set a bit above this)
// is never the thing that kills us.
const SHUTDOWN_GRACE_MS = 310_000;
// uncaughtException means the process is in an undefined state (Node's own
// guidance: stop doing new work). "Drain briefly" per the fix brief, NOT the
// full 310s request-grace window — a worker that just threw out of the event
// loop should not keep accepting new connections for 5 minutes first.
const UNCAUGHT_EXCEPTION_DRAIN_MS = 5_000;

// Crash-loop guard constants/policy live in crash-loop-policy.ts (pure,
// independently unit-tested against production defaults) — see that file's
// header comment for the round-2 redesign rationale. HEALTHY_AFTER_MS,
// MAX_EARLY_DEATHS, REFORK_BACKOFF_{BASE,MAX}_MS are all env-overridable
// there; these are ordinary ops knobs (how patient the primary is before
// deferring to systemd), not a security-relevant seam like
// NOVADA_SKIP_HOSTED_FORCE.

/**
 * Force the Vercel hosted-environment markers into process.env. MUST run
 * before any handler module is imported (handler modules read these at
 * import time in some vendored code paths, not just per-request).
 */
export function forceHostedEnvMarkers(): void {
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV ??= "production";
  process.env.VERCEL_REGION ??= "aws-eu-central-1";
}

/**
 * Fail closed: import the SAME vendored predicate the request path uses
 * (never a hand-reimplemented copy — class-not-instance) and exit(1) if it
 * disagrees that we're "hosted". Returns normally (void) when the check passes.
 */
export async function verifyHostedOrExit(): Promise<void> {
  const vendorConfigUrl = new URL("./vendor/novada-mcp/config.js", import.meta.url);
  const { isHostedEnvironment } = (await import(vendorConfigUrl.href)) as {
    isHostedEnvironment: () => boolean;
  };
  if (!isHostedEnvironment()) {
    console.error(
      "[server] FATAL: isHostedEnvironment() returned false after startup. " +
        "Refusing to start — running with this flag false on a shared host would " +
        "silently write customer data to local disk and change auth semantics. " +
        "Expected VERCEL=1 (or VERCEL_ENV / AWS_LAMBDA_FUNCTION_NAME) to be set.",
    );
    process.exit(1);
  }
}

/**
 * Build the Node http request listener: routes by pathname only (query string
 * ignored, same as vercel.json's exact-match rewrite for /api/reconcile).
 * Every other path — /mcp, /api/mcp, /:key/mcp, /health, /, /.well-known/*,
 * OAuth paths, and any unmatched path — goes to `mcpHandler` UNCHANGED
 * (original req.url preserved), exactly as vercel.json's catch-all does;
 * mcp.ts inspects req.url itself to do all of that routing.
 *
 * Defense in depth: both handlers already catch their own errors and emit a
 * JSON 500 (see api/mcp.ts nodeHandler's try/catch and api/reconcile.ts's
 * internal try/catches), but a synchronous throw or an unexpected rejection
 * here must never crash this long-lived process or hang the socket — this
 * process serves many requests over its lifetime, unlike a one-shot Vercel
 * invocation — and the NEXT request must still be served normally.
 */
export function createRequestListener(
  mcpHandler: NodeHandler,
  reconcileHandler: NodeHandler,
): (req: IncomingMessage, res: ServerResponse) => void {
  return function requestListener(req, res) {
    const pathname = (req.url ?? "/").split("?")[0];
    const handler = pathname === "/api/reconcile" ? reconcileHandler : mcpHandler;

    Promise.resolve()
      .then(() => handler(req, res))
      .catch((err: unknown) => {
        console.error("[server] handler threw:", err instanceof Error ? (err.stack ?? err.message) : err);
        if (res.headersSent) {
          if (!res.writableEnded) res.end();
          return;
        }
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "INTERNAL_ERROR", message: "An internal error occurred. Please try again or contact support." }));
      });
  };
}

/**
 * Primary: forks `count` workers, re-forking any that die unexpectedly — per
 * the pure policy in crash-loop-policy.ts (fix for a reviewed HIGH, round 2:
 * see that file's header for why the round-1 wall-clock rolling-window
 * ceiling was starvable by its own backoff pacing at realistic
 * WEB_CONCURRENCY values and never actually tripped for a persistent fault).
 *
 * `crashLoopState` is ONE shared CrashLoopState across every worker this
 * primary forks — a bad release kills all of them before any reaches
 * healthy, so the shared counter must trip fast regardless of which worker
 * slot is dying. Each worker additionally gets its OWN `becameHealthy` flag
 * and a `cluster.on("listening", ...)`-driven timer: once a given worker has
 * been listening for >= HEALTHY_AFTER_MS, it's marked healthy, which both
 * flags that worker's own eventual death as "not early" AND immediately
 * resets the shared state for every other worker too (onWorkerHealthy).
 */
function runPrimary(count: number): void {
  const workers = new Set<ReturnType<typeof cluster.fork>>();
  let shuttingDown = false;
  let crashLoopState: CrashLoopState = initialCrashLoopState();

  const spawnWorker = (): void => {
    const w = cluster.fork();
    workers.add(w);
    let becameHealthy = false;
    let healthyTimer: NodeJS.Timeout | undefined;

    const onListening = (listeningWorker: typeof w): void => {
      if (listeningWorker.id !== w.id) return; // cluster's "listening" is primary-wide; filter to this fork
      healthyTimer = setTimeout(() => {
        becameHealthy = true;
        crashLoopState = onWorkerHealthy(crashLoopState);
        console.log(
          `[server] worker ${w.process.pid} reached healthy (listening >= ${HEALTHY_AFTER_MS}ms) — crash-loop counters reset`,
        );
      }, HEALTHY_AFTER_MS);
    };
    cluster.on("listening", onListening);

    w.on("exit", (code, signal) => {
      cluster.removeListener("listening", onListening);
      if (healthyTimer) clearTimeout(healthyTimer);
      workers.delete(w);
      if (shuttingDown) return; // no refork during shutdown — unchanged behavior

      console.error(
        `[server] worker ${w.process.pid} exited unexpectedly (code=${code} signal=${signal}) becameHealthy=${becameHealthy}`,
      );

      const { nextState, decision } = onWorkerExit(crashLoopState, becameHealthy);
      crashLoopState = nextState;

      if (decision.action === "exit") {
        console.error(
          `[server] primary: ${crashLoopState.consecutiveEarlyDeaths} consecutive pre-healthy worker deaths — ` +
            "crash-loop detected, exiting(1) so systemd's Restart= policy takes over " +
            "(unit should set Restart=on-failure and RestartSec>=2s).",
        );
        process.exit(1);
        return;
      }

      if (decision.delayMs > 0) {
        console.error(`[server] refork scheduled in ${decision.delayMs}ms (backoff)`);
        setTimeout(() => {
          if (!shuttingDown) spawnWorker();
        }, decision.delayMs);
      } else {
        console.error("[server] refork now (previous worker had reached healthy before dying)");
        spawnWorker();
      }
    });
  };

  for (let i = 0; i < count; i++) spawnWorker();
  console.log(`[server] primary ${process.pid} supervising ${count} workers`);

  const shutdownPrimary = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] primary received ${signal}, forwarding to ${workers.size} worker(s)`);
    for (const w of workers) w.process.kill(signal);

    const forceExit = setTimeout(() => {
      console.error("[server] primary: workers did not exit within grace period, forcing exit");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);

    const poll = setInterval(() => {
      if (workers.size === 0) {
        clearInterval(poll);
        clearTimeout(forceExit);
        process.exit(0);
      }
    }, 100);
  };

  process.on("SIGTERM", () => shutdownPrimary("SIGTERM"));
  process.on("SIGINT", () => shutdownPrimary("SIGINT"));
}

/**
 * Register process-level last-resort nets (fix for a reviewed MEDIUM):
 * createRequestListener already isolates per-request errors, but that
 * safety is contingent on every fire-and-forget promise anywhere in
 * api/mcp.ts / api/reconcile.ts / vendor code being equally disciplined
 * (today they are — see stage1-worker-report.md's waitUntil() audit — but
 * one future unguarded floating promise would otherwise crash the whole
 * worker process per Node's default unhandled-rejection behavior).
 *
 * - unhandledRejection: logged, worker keeps serving (NOT fatal — a rejected
 *   promise alone doesn't mean process state is corrupted).
 * - uncaughtException: logged, then `onUncaughtException` runs (in
 *   production: stop accepting new connections, drain briefly, exit(1) so
 *   the primary's crash-loop-guarded refork takes over) — Node's own
 *   guidance is to never keep serving after a truly uncaught exception.
 *
 * Never logs request bodies/headers: these are process-level events with no
 * req/res in scope, only the thrown error/rejection reason itself.
 *
 * Exported (and the fatal action injected via `opts`, not hardcoded) so
 * test/server-process-guards.test.mjs can verify both behaviors in-process
 * without actually crashing the test runner or spawning a child process.
 */
export function installWorkerProcessGuards(opts: { onUncaughtException: (err: unknown) => void }): void {
  process.on("unhandledRejection", (reason) => {
    console.error(
      "[server] unhandledRejection (worker still serving):",
      reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
    );
  });
  process.on("uncaughtException", (err) => {
    console.error(
      "[server] uncaughtException — stopping new connections, will exit(1) shortly so the primary can refork:",
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    opts.onUncaughtException(err);
  });
}

/** Worker (or the sole process when WEB_CONCURRENCY=1): serves HTTP requests. */
async function runWorker(): Promise<void> {
  // Dynamic import AFTER the hosted-env force + verification in main() below,
  // mirrors local-harness.mts's "import handler AFTER env is loaded" convention.
  const { default: mcpHandler } = (await import("./api/mcp.js")) as { default: NodeHandler };
  const { default: reconcileHandler } = (await import("./api/reconcile.js")) as { default: NodeHandler };

  const server: Server = createServer(createRequestListener(mcpHandler, reconcileHandler));
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;

  let shuttingDown = false;
  const shutdown = (reason: string, exitCode: number, graceMs: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] worker ${process.pid} ${reason}, draining (up to ${graceMs}ms)...`);
    server.close(() => {
      console.log(`[server] worker ${process.pid} drained, exiting(${exitCode})`);
      process.exit(exitCode);
    });
    setTimeout(() => {
      console.error(`[server] worker ${process.pid} drain timed out, forcing exit(1)`);
      process.exit(1);
    }, graceMs);
  };
  process.on("SIGTERM", () => shutdown("received SIGTERM", 0, SHUTDOWN_GRACE_MS));
  process.on("SIGINT", () => shutdown("received SIGINT", 0, SHUTDOWN_GRACE_MS));
  installWorkerProcessGuards({
    onUncaughtException: () => shutdown("hit an uncaughtException", 1, UNCAUGHT_EXCEPTION_DRAIN_MS),
  });

  await new Promise<void>((resolve) => server.listen(PORT, HOST, resolve));
  console.log(`[server] worker ${process.pid} listening on http://${HOST}:${PORT}`);
}

async function main(): Promise<void> {
  if (process.env.NOVADA_SKIP_HOSTED_FORCE !== "1") {
    forceHostedEnvMarkers();
  }
  await verifyHostedOrExit();

  const concurrency = resolveConcurrency();
  if (concurrency > 1 && cluster.isPrimary) {
    runPrimary(concurrency);
  } else {
    await runWorker();
  }
}

/** True when this module was invoked directly (`node dist/server.mjs`), false
 *  when imported (e.g. by test/server-router.test.mjs for unit testing
 *  createRequestListener in isolation, with no cluster/port side effects). */
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  main().catch((err) => {
    console.error("[server] fatal startup error:", err);
    process.exit(1);
  });
}
