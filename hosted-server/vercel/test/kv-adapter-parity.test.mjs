/**
 * api/_kv.ts parity: the redis (REDIS_URL) path must encode/decode values
 * exactly like @vercel/kv (@upstash/redis 1.25.1) does, and build the same
 * SET command for every option shape the codebase uses.
 *
 *  - value round-trip: string, numeric string, number, object, boolean, null,
 *    plus codec edge cases ("007", unsafe int, JSON-looking string) — through
 *    (a) REAL redis via the adapter and (b) the REAL @vercel/kv client talking
 *    to the local Upstash-REST stub (support/kv-stub.mjs). Both must agree.
 *  - command parity: the SET argv _kv.ts sends to redis equals the argv the
 *    real @upstash/redis client posts (captured by a recording HTTP server).
 *  - REDIS_URL unset → the @vercel/kv path is used (rollback path).
 *
 * Skips with a loud message (not silently) if no redis binary can run.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tryStartRedis } from "./support/redis-fixture.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KV_STUB = join(__dirname, "support", "kv-stub.mjs");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on("error", reject);
  });
}

let stub, redis, recorder, recorded = [];
let kvMod;

before(async () => {
  const stubPort = await freePort();
  stub = spawn(process.execPath, [KV_STUB], { env: { PATH: process.env.PATH, KV_STUB_PORT: String(stubPort) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    stub.stdout.on("data", (c) => /listening on/.test(String(c)) && resolve());
    stub.on("exit", () => reject(new Error("kv-stub exited")));
  });
  // Recording server: captures argv @upstash/redis sends, answers null.
  recorder = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      recorded.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: null }));
    });
  });
  const recPort = await freePort();
  await new Promise((r) => recorder.listen(recPort, "127.0.0.1", r));
  // @vercel/kv constructs its client ONCE from env at first use — point it at
  // the stub now; command-parity test swaps via a second module instance below.
  process.env.KV_REST_API_URL = `http://127.0.0.1:${stubPort}`;
  process.env.KV_REST_API_TOKEN = "stub";
  process.env.RECORDER_URL = `http://127.0.0.1:${recPort}`;
  redis = await tryStartRedis();
  kvMod = await import("../api/_kv.ts");
});

after(async () => {
  await kvMod?.kvClose();
  stub?.kill();
  recorder?.close();
  await redis?.stop();
});

const VALUES = {
  "plain string": "hello",
  "numeric string": "123",
  "leading-zero string": "007",
  "unsafe-int string": "12345678901234567890",
  "bool-looking string": "true",
  "json-looking string": '{"a":1}',
  "number": 42,
  "float": 1.5,
  "boolean true": true,
  "boolean false": false,
  "object": { a: 1, b: ["x", { c: null }], d: "s" },
  "array": [1, "2", null],
  "null": null,
};

test("value round-trip: redis path === @vercel/kv path for every value class", { skip: false }, async (t) => {
  if (!redis) return t.skip("NO REDIS BINARY — redis-path parity NOT verified (see redis-fixture stderr)");
  for (const [label, value] of Object.entries(VALUES)) {
    const key = `parity:${label}`;
    delete process.env.REDIS_URL;
    assert.equal(kvMod.kvBackend(), "vercel-kv");
    await kvMod.kv.set(key, value, { ex: 60 });
    const viaRest = await kvMod.kv.get(key);

    process.env.REDIS_URL = redis.url;
    assert.equal(kvMod.kvBackend(), "redis");
    await kvMod.kv.set(key, value, { ex: 60 });
    const viaRedis = await kvMod.kv.get(key);

    assert.deepEqual(viaRedis, viaRest, `${label}: redis=${JSON.stringify(viaRedis)} rest=${JSON.stringify(viaRest)}`);
  }
  delete process.env.REDIS_URL;
});

test("pinned decode semantics (documented in _kv.ts header)", async (t) => {
  if (!redis) return t.skip("NO REDIS BINARY");
  process.env.REDIS_URL = redis.url;
  const { kv } = kvMod;
  await kv.set("pin:a", "123");   assert.strictEqual(await kv.get("pin:a"), 123);
  await kv.set("pin:b", "007");   assert.strictEqual(await kv.get("pin:b"), "007");
  await kv.set("pin:c", "true");  assert.strictEqual(await kv.get("pin:c"), true);
  await kv.set("pin:d", "plain"); assert.strictEqual(await kv.get("pin:d"), "plain");
  await kv.set("pin:e", { a: 1 });assert.deepEqual(await kv.get("pin:e"), { a: 1 });
  await kv.set("pin:f", null);    assert.strictEqual(await kv.get("pin:f"), null);
  assert.strictEqual(await kv.get("pin:missing"), null);
  delete process.env.REDIS_URL;
});

test("getdel / incr / expire / nx semantics on real redis", async (t) => {
  if (!redis) return t.skip("NO REDIS BINARY");
  process.env.REDIS_URL = redis.url;
  const { kv } = kvMod;
  await kv.set("gd:1", { x: 1 }, { ex: 60 });
  assert.deepEqual(await kv.getdel("gd:1"), { x: 1 });
  assert.strictEqual(await kv.getdel("gd:1"), null, "single-use: second getdel is a miss");
  assert.strictEqual(await kv.incr("cnt:1"), 1);
  assert.strictEqual(await kv.incr("cnt:1"), 2);
  assert.strictEqual(await kv.expire("cnt:1", 120), 1);
  assert.strictEqual(await kv.expire("cnt:none", 120), 0);
  assert.strictEqual(await kv.set("nx:1", Date.now(), { nx: true, ex: 60 }), "OK");
  assert.strictEqual(await kv.set("nx:1", Date.now(), { nx: true, ex: 60 }), null, "nx loses → null (maybeGetFirstRunNoticeHosted relies on it)");
  delete process.env.REDIS_URL;
});

test("every set-option shape used in the codebase builds the right argv", () => {
  const { buildSetArgs } = kvMod;
  assert.deepEqual(buildSetArgs("k", "v", { ex: 5 }), ["SET", "k", "v", "EX", "5"]);
  assert.deepEqual(buildSetArgs("k", 1, { nx: true, ex: 5 }), ["SET", "k", "1", "NX", "EX", "5"]);
  assert.deepEqual(buildSetArgs("k", { a: 1 }, { px: 9 }), ["SET", "k", '{"a":1}', "PX", "9"]);
  assert.deepEqual(buildSetArgs("k", "v", { xx: true, exat: 7 }), ["SET", "k", "v", "XX", "EXAT", "7"]);
  assert.deepEqual(buildSetArgs("k", "v", { get: true, pxat: 7 }), ["SET", "k", "v", "GET", "PXAT", "7"]);
  assert.deepEqual(buildSetArgs("k", "v", { keepTtl: true }), ["SET", "k", "v", "KEEPTTL"]);
  assert.deepEqual(buildSetArgs("k", "v"), ["SET", "k", "v"]);
});

test("SET argv equals what the real @upstash/redis client sends (same options)", async () => {
  // Real @upstash/redis client aimed at the recording server.
  const { Redis } = await import("@upstash/redis");
  const real = new Redis({ url: process.env.RECORDER_URL, token: "x", responseEncoding: false, retry: false });
  const shapes = [
    ["k1", "v", { ex: 60 }],
    ["k2", 123, { nx: true, ex: 60 }],
    ["k3", { a: [1] }, { px: 500 }],
    ["k4", true, { xx: true, exat: 1900000000 }],
    ["k5", null, { get: true, pxat: 1900000000000 }],
    ["k6", "v", { keepTtl: true }],
    ["k7", "v", undefined],
  ];
  for (const [k, v, o] of shapes) {
    recorded = [];
    await real.set(k, v, o);
    assert.equal(recorded.length, 1);
    // argv[0..2] = command, key, encoded value (case-sensitive); the tail
    // (option names) is compared case-insensitively — @upstash sends lowercase.
    const norm = (argv) => argv.map((x, i) => (i > 2 ? String(x).toLowerCase() : String(x)));
    const sent = norm(recorded[0].map((x, i) => (i === 0 ? String(x).toUpperCase() : x)));
    const exp = norm(kvMod.buildSetArgs(k, v, o));
    assert.deepEqual(sent, exp, `shape ${JSON.stringify([k, v, o])}`);
  }
});

test("REDIS_URL unset → @vercel/kv path (rollback): hits the REST stub, not redis", async () => {
  delete process.env.REDIS_URL;
  assert.equal(kvMod.kvBackend(), "vercel-kv");
  await kvMod.kv.set("rb:1", { ok: true }, { ex: 60 });
  assert.deepEqual(await kvMod.kv.get("rb:1"), { ok: true });
  assert.strictEqual(await kvMod.kv.incr("rb:cnt"), 1);
});

test("kvConfigured accepts REDIS_URL OR both REST vars", () => {
  const save = { ...process.env };
  try {
    delete process.env.REDIS_URL; delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
    assert.equal(kvMod.kvConfigured(), false);
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    assert.equal(kvMod.kvConfigured(), true);
    delete process.env.REDIS_URL; process.env.KV_REST_API_URL = "http://x";
    assert.equal(kvMod.kvConfigured(), false, "URL without TOKEN is not configured");
    process.env.KV_REST_API_TOKEN = "t";
    assert.equal(kvMod.kvConfigured(), true);
  } finally {
    for (const k of ["REDIS_URL", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) {
      if (save[k] === undefined) delete process.env[k]; else process.env[k] = save[k];
    }
  }
});
