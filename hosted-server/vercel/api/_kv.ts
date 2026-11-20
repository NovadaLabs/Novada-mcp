/**
 * _kv.ts — the ONE key-value backend seam for the hosted server.
 *
 * Two backends behind the same 5-method surface mcp.ts uses
 * (get / set / getdel / incr / expire):
 *
 *   REDIS_URL set    → node-redis over TCP (the EC2 box's local redis-server).
 *   REDIS_URL unset  → the original `@vercel/kv` (Upstash REST) client,
 *                      called with the caller's arguments UNCHANGED — the
 *                      rollback path is "unset REDIS_URL and restart".
 *
 * The backend is resolved PER CALL from process.env, so flipping the env var
 * (and nothing else) flips the backend; no module-load side effects, which
 * keeps this file importable from tests.
 *
 * ── Value-encoding parity with @vercel/kv (@upstash/redis 1.25.1) ──
 * Verified against node_modules/@upstash/redis (chunk "ge"/"he"/"Ce"):
 *   encode (every command argument):
 *     string | number | boolean → sent as-is (Redis stores String(value))
 *     anything else (object, array, null) → JSON.stringify(value)
 *   decode (GET / GETDEL / SET…GET result, automaticDeserialization on):
 *     raw = the stored string
 *     try  n = JSON.parse(raw)
 *          if typeof n === "number" && String(n) !== raw → return raw   (e.g. "007", "1e3", unsafe ints)
 *          else return n
 *     catch → return raw
 *     missing key → null
 * Consequences kept bit-for-bit: the string "123" reads back as the number
 * 123, "true" as boolean true, '{"a":1}' as an object, and a stored `null`
 * is indistinguishable from a miss. test/kv-adapter-parity.test.mjs pins this.
 *
 * ── Failure model (never hang a request) ──
 * - one lazy connection per process (each cluster worker has its own);
 * - connect timeout 2 s, reconnect with capped exponential backoff;
 * - offline queue DISABLED: while redis is down a command fails immediately
 *   instead of queueing behind a dead socket;
 * - every command is raced against a 2 s deadline as a backstop;
 * - all failures surface as thrown Errors, so the existing fail-open call
 *   sites (kvFailOpen, validateToken, cacheTokenVerify, …) keep working and
 *   the OAuth layer can map them to a structured 503.
 */
import { kv as vercelKv } from "@vercel/kv";
import { createClient } from "redis";

/** SET options the codebase (and @upstash/redis) understands. */
export interface KvSetOptions {
  ex?: number;
  px?: number;
  exat?: number;
  pxat?: number;
  nx?: boolean;
  xx?: boolean;
  get?: boolean;
  keepTtl?: boolean;
}

export const KV_CONNECT_TIMEOUT_MS = 2000;
export const KV_COMMAND_TIMEOUT_MS = 2000;
const RECONNECT_BASE_MS = 50;
const RECONNECT_MAX_MS = 2000;
const ERROR_LOG_INTERVAL_MS = 10_000;

// ── value codec (parity with @upstash/redis — see header) ─────────────────────

/** Encode one command argument exactly like @upstash/redis's `ge`. */
export function encodeValue(v: unknown): string {
  switch (typeof v) {
    case "string":
      return v;
    case "number":
    case "boolean":
      return String(v);
    default:
      return JSON.stringify(v) ?? "null";
  }
}

/** Decode a raw reply exactly like @upstash/redis's `Ce` (never throws). */
export function decodeValue(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    const n = JSON.parse(raw);
    return typeof n === "number" && n.toString() !== raw ? raw : n;
  } catch {
    return raw;
  }
}

/** SET argument tail in @upstash/redis's order: nx|xx, get, then ONE expiry. */
export function buildSetArgs(key: string, value: unknown, opts?: KvSetOptions): string[] {
  const args = ["SET", key, encodeValue(value)];
  if (!opts) return args;
  if (opts.nx) args.push("NX");
  else if (opts.xx) args.push("XX");
  if (opts.get) args.push("GET");
  if (typeof opts.ex === "number") args.push("EX", String(opts.ex));
  else if (typeof opts.px === "number") args.push("PX", String(opts.px));
  else if (typeof opts.exat === "number") args.push("EXAT", String(opts.exat));
  else if (typeof opts.pxat === "number") args.push("PXAT", String(opts.pxat));
  else if (opts.keepTtl) args.push("KEEPTTL");
  return args;
}

// ── redis backend ─────────────────────────────────────────────────────────────

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let clientUrl: string | null = null;
let connecting: Promise<unknown> | null = null;
let firstConnectWaited = false;
let lastErrorLogAt = 0;

function logRedisError(msg: string, err: unknown): void {
  const now = Date.now();
  if (now - lastErrorLogAt < ERROR_LOG_INTERVAL_MS) return;
  lastErrorLogAt = now;
  console.error(JSON.stringify({
    evt: "kv_redis_error",
    msg,
    error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
  }));
}

function getClient(url: string): RedisClient {
  if (client && clientUrl === url) return client;
  // REDIS_URL changed under a live process (tests only) — drop the old client.
  if (client) {
    const old = client;
    client = null;
    old.destroy();
  }
  const c = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: KV_CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries: number) =>
        Math.min(RECONNECT_BASE_MS * 2 ** Math.min(retries, 10), RECONNECT_MAX_MS),
    },
  });
  // An unhandled 'error' event would crash the process; node-redis emits one
  // per failed reconnect attempt. Log (rate-limited) and keep serving.
  c.on("error", (err: unknown) => logRedisError("redis client error", err));
  client = c;
  clientUrl = url;
  firstConnectWaited = false;
  console.log(JSON.stringify({ evt: "kv_backend", backend: "redis" }));
  connecting = c.connect().catch((err: unknown) => logRedisError("redis connect failed", err));
  return c;
}

function deadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`KV ${what} timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer)) as Promise<T>;
}

async function redisCommand(url: string, args: string[]): Promise<unknown> {
  const c = getClient(url);
  if (!c.isReady) {
    // Only the very first request after process start waits for the initial
    // connect (≤ connect timeout). Afterwards a not-ready client fails fast
    // while node-redis reconnects in the background with backoff.
    if (!firstConnectWaited && connecting) {
      firstConnectWaited = true;
      await deadline(connecting, KV_CONNECT_TIMEOUT_MS, "connect");
    }
    if (!c.isReady) throw new Error("KV redis unavailable (not connected)");
  }
  return deadline(c.sendCommand(args), KV_COMMAND_TIMEOUT_MS, `${args[0]} command`);
}

/** Close the redis client (tests / graceful shutdown). Idempotent. */
export async function kvClose(): Promise<void> {
  const c = client;
  client = null;
  clientUrl = null;
  connecting = null;
  if (c) {
    try { c.destroy(); } catch { /* already closed */ }
  }
}

// ── public surface ────────────────────────────────────────────────────────────

function redisUrl(): string | undefined {
  const u = process.env.REDIS_URL;
  return u && u.trim() ? u.trim() : undefined;
}

/** True when SOME backend is configured (REDIS_URL, or both Upstash REST vars). */
export function kvConfigured(): boolean {
  return !!redisUrl() || (!!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN);
}

export function kvBackend(): "redis" | "vercel-kv" {
  return redisUrl() ? "redis" : "vercel-kv";
}

export const kv = {
  async get<T = unknown>(key: string): Promise<T | null> {
    const url = redisUrl();
    if (!url) return vercelKv.get<T>(key);
    return decodeValue(await redisCommand(url, ["GET", key])) as T | null;
  },

  async set(key: string, value: unknown, opts?: KvSetOptions): Promise<unknown> {
    const url = redisUrl();
    if (!url) return vercelKv.set(key, value, opts as never);
    return decodeValue(await redisCommand(url, buildSetArgs(key, value, opts)));
  },

  async getdel<T = unknown>(key: string): Promise<T | null> {
    const url = redisUrl();
    if (!url) return vercelKv.getdel<T>(key);
    return decodeValue(await redisCommand(url, ["GETDEL", key])) as T | null;
  },

  async incr(key: string): Promise<number> {
    const url = redisUrl();
    if (!url) return vercelKv.incr(key);
    return (await redisCommand(url, ["INCR", key])) as number;
  },

  async expire(key: string, seconds: number): Promise<unknown> {
    const url = redisUrl();
    if (!url) return vercelKv.expire(key, seconds);
    return redisCommand(url, ["EXPIRE", key, String(seconds)]);
  },
};
