// ─── VISIBILITY: one-shot IP-echo verification of an issued proxy config ─────
//
// Owner's core complaint (F11 follow-through): "how can I SEE if the proxy
// works?" — the answer is to put the evidence in the tool response. After
// novada_proxy issues a config, it performs ONE echo request THROUGH the
// issued proxy and reports exit_ip / org / ASN / country / latency, or a
// classified failure (402 payment / 407 auth / timeout / network error).
//
// Mechanics — absolute-form GET, deliberately NOT a CONNECT tunnel:
//   GET http://<echo-host>/… sent to the proxy host:port with
//   Proxy-Authorization. Plain-HTTP forward proxying works on any HTTP proxy
//   gateway, needs no TLS, and surfaces the gateway's own status line (402/407)
//   directly as a response status — the exact signals the F11 evaluation saw
//   only as opaque `curl` exit 56. Response is ~0.3 KB; the whole probe costs
//   about 1 KB of metered proxy traffic and ~1s of latency (measured live:
//   real consumer-ISP exits answered in ≈1s).
//
// Rules (pinned by tests):
//   - exactly ONE probe per tool call — never inside any retry loop;
//   - 5s timeout, classified as "timeout" (distinct from connection errors);
//   - local/stdio runtimes only — hosted/Edge runtimes may not allow raw
//     proxied sockets, so verify is skipped there and disclosed;
//   - credentials never appear in the result object;
//   - every echoed string is UNTRUSTED (third-party service THROUGH an
//     untrusted gateway) and is charset-allowlisted + length-capped before it
//     can enter agent-facing evidence (see sanitizeEchoField).

import http from "node:http";
import { isHostedEnvironment } from "../config.js";

export interface ProxyVerifyTarget {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ProxyVerifySuccess {
  verified: true;
  exit_ip: string;
  org?: string;
  asn?: string;
  country?: string;
  country_code?: string;
  latency_ms: number;
}

export type VerifyFailureClass =
  | "payment_required"
  | "auth_failed"
  | "timeout"
  | "network_error"
  | "bad_response";

export interface ProxyVerifyFailure {
  verified: false;
  failure_class: VerifyFailureClass;
  detail: string;
  http_status?: number;
  latency_ms: number;
}

export type ProxyVerifyResult = ProxyVerifySuccess | ProxyVerifyFailure;

export const DEFAULT_ECHO_TIMEOUT_MS = 5000;

// THE echo endpoint — one named constant, HTTP (not HTTPS) on purpose (see
// module header: absolute-form forward-proxy GET, no CONNECT tunnel).
// ipinfo.io replaces ip-api.com (review MEDIUM-4: ip-api.com's free tier is
// licensed for NON-commercial use only; ipinfo.io's terms permit commercial
// use and it answers plain-HTTP requests).
// TODO(owner): replace with a Novada-owned echo endpoint (e.g. a JSON mode of
// ipinfo.novada.pro, already used in proxy_static/dedicated curl examples) so
// the probe stays first-party end-to-end.
const ECHO_HOST = "ipinfo.io";
export const ECHO_URL = `http://${ECHO_HOST}/json`;

/** Cap the echo body read — the expected reply is ~0.3 KB. */
const MAX_ECHO_BODY_BYTES = 64 * 1024;

/**
 * Verify is local-stdio-only: hosted runtimes (Vercel serverless, AWS Lambda)
 * and the Edge runtime may not permit raw proxied sockets, and a false
 * negative there would smear a working proxy. Callers skip the probe and
 * disclose the skip instead.
 *
 * Class-not-instance (review MEDIUM-3): hosted detection reuses the ONE
 * canonical predicate (config.ts isHostedEnvironment — VERCEL / VERCEL_ENV /
 * AWS_LAMBDA_FUNCTION_NAME) instead of a parallel hand-rolled list; the Edge
 * runtime is the only verify-specific member.
 */
export function isVerifySupportedRuntime(): boolean {
  return !(isHostedEnvironment() || process.env.NEXT_RUNTIME === "edge");
}

// ─── Echo-field sanitization (agent-context injection surface) ───────────────
//
// Echoed strings come from a third party THROUGH an untrusted gateway; a
// hostile/compromised exit can splice instruction-shaped text into them. Every
// field is allowlist-filtered and length-capped BEFORE it can reach the
// agent-facing evidence block. CLASS-shaped: fields are address-shaped or
// text-shaped — a new echoed field picks a ROW here, never a new ad-hoc regex.
const ECHO_FIELD_RULES = {
  /** IPv4/IPv6 literal — hex digits, dots, colons; 45 = max IPv6 length. */
  ip: { strip: /[^0-9a-fA-F.:]/g, maxLen: 45 },
  /** Human text (org/ASN/country) — printable ASCII subset; no newlines,
   *  backticks, angle brackets, quotes or control chars survive. */
  text: { strip: /[^A-Za-z0-9 ._:,'()/&+-]/g, maxLen: 128 },
} as const;

/**
 * Reduce an untrusted echoed value to its allowlisted charset and cap its
 * length. Returns undefined for non-strings and values with no legal chars.
 */
export function sanitizeEchoField(
  value: unknown,
  kind: keyof typeof ECHO_FIELD_RULES = "text",
): string | undefined {
  if (typeof value !== "string") return undefined;
  const rule = ECHO_FIELD_RULES[kind];
  const cleaned = value.replace(rule.strip, "").trim().slice(0, rule.maxLen);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** ipinfo.io reply shape: ip, country (2-letter code), org ("AS#### Name"). */
interface EchoPayload {
  ip?: string;
  country?: string;
  org?: string;
}

/**
 * Perform ONE IP-echo request through the proxy at `target`. Resolves (never
 * rejects) with either the exit-node evidence or a classified failure. The
 * caller must not retry — one probe per issued config.
 */
export function verifyProxyExit(
  target: ProxyVerifyTarget,
  timeoutMs: number = DEFAULT_ECHO_TIMEOUT_MS,
): Promise<ProxyVerifyResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const settle = (r: ProxyVerifyResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const fail = (failure_class: VerifyFailureClass, detail: string, http_status?: number) =>
      settle({
        verified: false,
        failure_class,
        detail,
        ...(http_status !== undefined ? { http_status } : {}),
        latency_ms: Date.now() - started,
      });

    const auth = Buffer.from(`${target.username}:${target.password}`).toString("base64");
    const req = http.request(
      {
        host: target.host,
        port: target.port,
        method: "GET",
        // Absolute-form URI = forward-proxy semantics (no CONNECT tunnel).
        path: ECHO_URL,
        headers: {
          Host: ECHO_HOST,
          "Proxy-Authorization": `Basic ${auth}`,
          Accept: "application/json",
          Connection: "close",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status === 402) {
          res.resume();
          fail(
            "payment_required",
            "gateway accepted the credentials but refused to route traffic (HTTP 402 Payment Required) — " +
              "the plan's balance is exhausted or the plan is expired. Outside this check the failure is " +
              "visible only as curl exit code 56.",
            402,
          );
          return;
        }
        if (status === 407) {
          res.resume();
          fail(
            "auth_failed",
            "proxy rejected the credentials (HTTP 407 Proxy Authentication Required) — username/password " +
              "invalid for this gateway.",
            407,
          );
          return;
        }
        if (status !== 200) {
          res.resume();
          fail("bad_response", `echo request returned HTTP ${status} through the proxy`, status);
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > MAX_ECHO_BODY_BYTES) {
            fail("bad_response", "echo response body exceeded the size cap");
            req.destroy();
          }
        });
        res.on("error", (err) => fail("network_error", `echo response stream failed: ${err.message}`));
        res.on("end", () => {
          let payload: EchoPayload;
          try {
            payload = JSON.parse(body) as EchoPayload;
          } catch {
            fail("bad_response", "echo returned a non-JSON body (the proxy may be intercepting traffic)");
            return;
          }
          // UNTRUSTED external content: sanitize every echoed field before it
          // can enter agent-facing evidence (see ECHO_FIELD_RULES).
          const exitIp = sanitizeEchoField(payload.ip, "ip");
          if (!exitIp) {
            fail("bad_response", "echo service did not report an exit IP");
            return;
          }
          // ipinfo.io's `org` combines ASN + name ("AS22773 Cox Communications
          // Inc.") — split so the evidence block keeps its org/(asn) layout.
          const rawOrg = sanitizeEchoField(payload.org, "text");
          const orgMatch = rawOrg?.match(/^(AS\d+)\s+(.+)$/);
          const asn = orgMatch?.[1];
          const org = orgMatch?.[2] ?? rawOrg;
          const countryCode = sanitizeEchoField(payload.country, "text");
          settle({
            verified: true,
            exit_ip: exitIp,
            ...(org ? { org } : {}),
            ...(asn ? { asn } : {}),
            ...(countryCode ? { country_code: countryCode } : {}),
            latency_ms: Date.now() - started,
          });
        });
      },
    );

    req.on("timeout", () => {
      timedOut = true;
      req.destroy();
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (timedOut) {
        fail("timeout", `no echo response within ${timeoutMs}ms — network path issue or gateway overload`);
      } else {
        fail("network_error", `could not reach the proxy gateway: ${err.code ?? err.message}`);
      }
    });
    req.end();
  });
}

/**
 * First usable entry of an `IP:PORT:USER:PASS`-per-line proxy list (the
 * NOVADA_STATIC_PROXY_LIST / NOVADA_DEDICATED_PROXY_LIST format). Mirrors the
 * entry the static/dedicated handlers themselves surface (both take the first
 * valid line), so the probe verifies the SAME credentials the tool returned.
 * Password may contain ":" — everything after the third colon is the password.
 */
export function pickProxyListEntry(envValue: string | undefined): ProxyVerifyTarget | null {
  if (!envValue) return null;
  const entries = envValue
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.split(":").length >= 4);
  if (entries.length === 0) return null;
  const parts = entries[0].split(":");
  const [host, portRaw, username] = parts;
  const password = parts.slice(3).join(":");
  const port = Number.parseInt(portRaw, 10);
  if (!host || !Number.isFinite(port) || port <= 0 || !username || !password) return null;
  return { host, port, username, password };
}
