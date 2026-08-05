/**
 * kv-stub.mjs — minimal local Upstash-REST stub so @vercel/kv talks to
 * localhost instead of production KV. Test support only — never deployed.
 *
 * Protocol (confirmed against node_modules/@upstash/redis v1.25.1):
 *   - POST <base>/          body = JSON command array   e.g. ["set","k","v","ex",60]
 *   - POST <base>/pipeline  body = array of command arrays
 *   - Auth: Bearer <KV_REST_API_TOKEN> (any non-empty token accepted here)
 *   - Response: {"result": ...} per command; pipeline → [{"result":...}, ...]
 *   - When the client sends `Upstash-Encoding: base64` (@vercel/kv default),
 *     string results MUST be base64-encoded — the client decodes every string
 *     except the literal "OK" (see pe()/ue() in @upstash/redis chunk).
 *
 * Commands: GET, SET(+EX/PX/EXAT), GETDEL, INCR, DECR, EXPIRE, DEL, TTL.
 * Unknown commands → {"result": null} + stderr warn (visible gap, not silent).
 */
import { createServer } from "node:http";

const PORT = 4799;
const store = new Map(); // key → { value: string, expiresAt: number | null }

const now = () => Date.now();

function liveEntry(key) {
  const e = store.get(key);
  if (!e) return null;
  if (e.expiresAt !== null && e.expiresAt <= now()) {
    store.delete(key);
    return null;
  }
  return e;
}

// Periodic sweep so expired keys don't accumulate.
setInterval(() => {
  const t = now();
  for (const [k, e] of store) {
    if (e.expiresAt !== null && e.expiresAt <= t) store.delete(k);
  }
}, 5000).unref();

function execCommand(cmd) {
  if (!Array.isArray(cmd) || cmd.length === 0) return { error: "malformed command" };
  const op = String(cmd[0]).toUpperCase();
  const key = cmd.length > 1 ? String(cmd[1]) : undefined;

  switch (op) {
    case "GET": {
      const e = liveEntry(key);
      return { result: e ? e.value : null };
    }
    case "SET": {
      const value = String(cmd[2]);
      let expiresAt = null;
      for (let i = 3; i < cmd.length; i++) {
        const opt = String(cmd[i]).toUpperCase();
        if (opt === "EX") expiresAt = now() + Number(cmd[++i]) * 1000;
        else if (opt === "PX") expiresAt = now() + Number(cmd[++i]);
        else if (opt === "EXAT") expiresAt = Number(cmd[++i]) * 1000;
      }
      store.set(key, { value, expiresAt });
      return { result: "OK" };
    }
    case "GETDEL": {
      const e = liveEntry(key);
      if (e) store.delete(key);
      return { result: e ? e.value : null };
    }
    case "INCR":
    case "DECR": {
      const e = liveEntry(key);
      const delta = op === "INCR" ? 1 : -1;
      const next = (e ? parseInt(e.value, 10) || 0 : 0) + delta;
      store.set(key, { value: String(next), expiresAt: e ? e.expiresAt : null });
      return { result: next };
    }
    case "EXPIRE": {
      const e = liveEntry(key);
      if (!e) return { result: 0 };
      e.expiresAt = now() + Number(cmd[2]) * 1000;
      return { result: 1 };
    }
    case "DEL": {
      let n = 0;
      for (let i = 1; i < cmd.length; i++) {
        if (liveEntry(String(cmd[i]))) { store.delete(String(cmd[i])); n++; }
      }
      return { result: n };
    }
    case "TTL": {
      const e = liveEntry(key);
      if (!e) return { result: -2 };
      if (e.expiresAt === null) return { result: -1 };
      return { result: Math.ceil((e.expiresAt - now()) / 1000) };
    }
    default:
      console.error(`[kv-stub] WARN unknown command: ${op} (returning null)`);
      return { result: null };
  }
}

/** Base64-encode string results when the client asked for base64 encoding.
 *  The literal "OK" passes through — the @upstash/redis decoder special-cases it. */
function encodeResult(out, wantB64) {
  if (!wantB64 || out.error !== undefined) return out;
  const r = out.result;
  if (typeof r === "string" && r !== "OK") {
    return { result: Buffer.from(r, "utf8").toString("base64") };
  }
  return out;
}

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const auth = req.headers["authorization"] ?? "";
    if (!auth.startsWith("Bearer ")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing bearer token" }));
      return;
    }
    const wantB64 = String(req.headers["upstash-encoding"] ?? "").toLowerCase() === "base64";
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
    let payload;
    if (req.url === "/pipeline" || req.url === "/multi-exec") {
      payload = (Array.isArray(body) ? body : []).map((c) => encodeResult(execCommand(c), wantB64));
    } else {
      payload = encodeResult(execCommand(body), wantB64);
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[kv-stub] listening on http://127.0.0.1:${PORT}`);
});
