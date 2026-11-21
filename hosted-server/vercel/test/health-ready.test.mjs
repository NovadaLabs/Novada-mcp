/**
 * /health/ready — KV-aware, direct-loopback-only readiness gate used by
 * deploy-ec2.sh / restart-rolling.sh. Through the BUILT dist/server.mjs.
 *   good redis            → 200 {ok, kv:"redis"}
 *   proxied (nginx hdrs)  → 404, no KV work (public callers can never reach it)
 *   wrong REDIS_URL       → 503
 *   redis killed          → 503
 *   no KV configured      → 503
 *   /health               → unchanged static 200 even when KV is down
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tryStartRedis } from "./support/redis-fixture.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_SERVER = join(ROOT, "dist", "server.mjs");
if (!existsSync(DIST_SERVER)) throw new Error("dist/server.mjs missing — run npm run build:server");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function startServer(extraEnv) {
  const port = await freePort();
  const child = spawn(process.execPath, [DIST_SERVER], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOST: "127.0.0.1", PORT: String(port), WEB_CONCURRENCY: "1",
      STUB_AUTH_WARNING_ACCEPTED: "true", CRON_SECRET: "dummy-test-cron-secret-not-real", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    let out = "";
    const t = setTimeout(() => reject(new Error(`start timeout: ${out}`)), 15000);
    child.stdout.on("data", (c) => { out += c; if (/listening on/.test(out)) { clearTimeout(t); resolve(); } });
    child.on("exit", (c) => reject(new Error(`exited ${c}: ${out}`)));
  });
  return {
    base: `http://127.0.0.1:${port}`,
    async stop() { const e = new Promise((r) => child.once("exit", r)); child.kill("SIGTERM"); await e; },
  };
}

test("health/ready", async (t) => {
  const redis = await tryStartRedis();
  if (!redis) return t.skip("NO REDIS BINARY");
  const good = await startServer({ REDIS_URL: redis.url });
  const deadPort = await freePort();
  const wrong = await startServer({ REDIS_URL: `redis://127.0.0.1:${deadPort}` });
  const none = await startServer({});
  try {
    await t.test("good redis → 200", async () => {
      const r = await fetch(`${good.base}/health/ready`);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { ok: true, kv: "redis" });
    });
    await t.test("proxied request (nginx adds X-Real-IP / X-Forwarded-For) → 404", async () => {
      for (const h of ["x-real-ip", "x-forwarded-for"]) {
        const r = await fetch(`${good.base}/health/ready`, { headers: { [h]: "203.0.113.9" } });
        assert.equal(r.status, 404, h);
      }
    });
    await t.test("wrong REDIS_URL → 503 while /health stays 200", async () => {
      const r = await fetch(`${wrong.base}/health/ready`);
      assert.equal(r.status, 503);
      assert.equal((await r.json()).ok, false);
      assert.equal((await fetch(`${wrong.base}/health`)).status, 200);
    });
    await t.test("no KV configured → 503", async () => {
      assert.equal((await fetch(`${none.base}/health/ready`)).status, 503);
    });
    await t.test("redis killed → 503, /health unchanged", async () => {
      await redis.stop();
      const r = await fetch(`${good.base}/health/ready`);
      assert.equal(r.status, 503);
      assert.deepEqual(await (await fetch(`${good.base}/health`)).json(), { ok: true, service: "novada-mcp-hosted", endpoint: "/mcp" });
    });
  } finally {
    await good.stop(); await wrong.stop(); await none.stop(); await redis.stop();
  }
});
