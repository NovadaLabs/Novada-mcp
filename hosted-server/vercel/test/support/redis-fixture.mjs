/**
 * redis-fixture.mjs — a REAL redis-server for tests. The binary comes from the
 * redis-memory-server devDependency (built into node_modules/.cache on
 * `npm ci`); this fixture spawns it directly because RedisMemoryServer cannot
 * restart on the SAME port, which the kill/revive fault tests need.
 * Test support only — never deployed.
 *
 * Returns { url, port, stop(), start() }. `tryStartRedis()` resolves null (and
 * logs why) if no binary is runnable; tests then skip LOUDLY.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { RedisBinary } from "redis-memory-server";

async function freePort() {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function spawnRedis(binary, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["--port", String(port), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no", "--daemonize", "no"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`redis-server start timeout; out=${out}`)); }, 10000);
    const onData = (c) => {
      out += c.toString();
      if (/Ready to accept connections/.test(out)) { clearTimeout(timer); child.stdout.off("data", onData); resolve(child); }
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`redis-server exited (${code}); out=${out}`)); });
  });
}

export async function startRedis() {
  const binary = await RedisBinary.getPath();
  const port = await freePort();
  let child = await spawnRedis(binary, port);
  return {
    port,
    url: `redis://127.0.0.1:${port}`,
    async stop() {
      if (!child) return;
      const c = child;
      child = null;
      const exited = new Promise((r) => c.once("exit", r));
      c.kill("SIGKILL"); // abrupt on purpose: models a crash / OOM-kill
      await exited;
    },
    async start() {
      if (child) return;
      child = await spawnRedis(binary, port); // fresh, empty dataset on the same port
    },
  };
}

export async function tryStartRedis() {
  try {
    return await startRedis();
  } catch (err) {
    console.error(`[redis-fixture] cannot start redis-server: ${err?.message ?? err}`);
    return null;
  }
}
