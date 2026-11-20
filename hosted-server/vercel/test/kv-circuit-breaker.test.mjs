/**
 * api/_kv.ts circuit breaker + shared initial connect, against a REAL redis.
 *  - hung redis (SIGSTOP): first call ~2 s timeout, then fail-fast (<50 ms)
 *    for the open window, then (after SIGCONT) a half-open probe recovers.
 *  - 20 concurrent first-use gets all succeed (all await the same connect).
 * Skips loudly if no redis binary is runnable.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tryStartRedis } from "./support/redis-fixture.mjs";

let redis, kvMod;

before(async () => {
  redis = await tryStartRedis();
  kvMod = await import("../api/_kv.ts");
});
after(async () => {
  try { if (redis?.pid) process.kill(redis.pid, "SIGCONT"); } catch {}
  await kvMod?.kvClose();
  await redis?.stop();
});

const timed = async (fn) => {
  const t0 = performance.now();
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  return { ms: performance.now() - t0, err };
};

test("20 concurrent gets right after first use all succeed (shared connect)", async (t) => {
  if (!redis) return t.skip("NO REDIS BINARY");
  await kvMod.kvClose();
  process.env.REDIS_URL = redis.url;
  await new Promise((r) => setTimeout(r, 0));
  // First use creates the client; the other 19 arrive while it is still connecting.
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => kvMod.kv.get(`cb:concurrent:${i}`)));
  assert.equal(results.length, 20);
  assert.ok(results.every((r) => r === null));
});

test("hung redis: 1st call ~2s timeout, then fail-fast in the open window, then recovers", async (t) => {
  if (!redis) return t.skip("NO REDIS BINARY");
  process.env.REDIS_URL = redis.url;
  await kvMod.kv.set("cb:k", "v", { ex: 60 });
  assert.equal(await kvMod.kv.get("cb:k"), "v");

  process.kill(redis.pid, "SIGSTOP");
  try {
    const first = await timed(() => kvMod.kv.get("cb:k"));
    assert.ok(first.err, "first call must fail");
    assert.ok(first.ms > 1500 && first.ms < 3500, `first call took ${first.ms}ms`);

    for (let i = 0; i < 5; i++) {
      const r = await timed(() => kvMod.kv.get("cb:k"));
      assert.ok(r.err instanceof Error, "fast-fail must throw an Error");
      assert.equal(r.err.name, "KvCircuitOpenError");
      assert.ok(r.ms < 50, `open-window call #${i} took ${r.ms}ms`);
    }
  } finally {
    process.kill(redis.pid, "SIGCONT");
  }

  // Still inside the window: remains fast-fail even though redis is back.
  const early = await timed(() => kvMod.kv.get("cb:k"));
  assert.equal(early.err?.name, "KvCircuitOpenError");

  // After the window, one probe goes through and the breaker closes.
  await new Promise((r) => setTimeout(r, kvMod.KV_BREAKER_OPEN_MS + 200));
  const probe = await timed(() => kvMod.kv.get("cb:k"));
  assert.equal(probe.err, null, `probe failed: ${probe.err}`);
  assert.equal(await kvMod.kv.get("cb:k"), "v");
});

test("half-open probe against still-hung redis re-opens the breaker", async (t) => {
  if (!redis) return t.skip("NO REDIS BINARY");
  process.env.REDIS_URL = redis.url;
  process.kill(redis.pid, "SIGSTOP");
  try {
    await timed(() => kvMod.kv.get("cb:k")); // trips (2 s)
    await new Promise((r) => setTimeout(r, kvMod.KV_BREAKER_OPEN_MS + 200));
    const probe = await timed(() => kvMod.kv.get("cb:k"));
    assert.ok(probe.err && probe.ms > 1500, "probe goes to the network and times out");
    const after = await timed(() => kvMod.kv.get("cb:k"));
    assert.equal(after.err?.name, "KvCircuitOpenError");
    assert.ok(after.ms < 50);
  } finally {
    process.kill(redis.pid, "SIGCONT");
  }
  await new Promise((r) => setTimeout(r, kvMod.KV_BREAKER_OPEN_MS + 200));
  assert.equal((await timed(() => kvMod.kv.get("cb:k"))).err, null);
});

test("redis reply errors (WRONGTYPE) do not trip the breaker", async (t) => {
  if (!redis) return t.skip("NO REDIS BINARY");
  process.env.REDIS_URL = redis.url;
  await kvMod.kv.incr("cb:counter");
  const bad = await timed(() => kvMod.kv.expire("cb:counter", "x"));
  // EXPIRE with a non-integer is a redis reply error; the next call must still hit redis.
  assert.ok(bad.err);
  assert.notEqual(bad.err.name, "KvCircuitOpenError");
  const ok = await timed(() => kvMod.kv.get("cb:counter"));
  assert.equal(ok.err, null);
});

test("vercel-kv path (REDIS_URL unset) is untouched by the breaker", async () => {
  delete process.env.REDIS_URL;
  assert.equal(kvMod.kvBackend(), "vercel-kv");
});
