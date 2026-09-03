// Shared two-step approval-token flow for the four irreversible/destructive
// account-management tools (proxy_account_create, ip_whitelist add/del,
// static_ip_mgmt open/renew, capture_apikey reset).
//
// CLOSES F2-2 / G-7 (2026-09-02 audit, workstream W-A1): the tools previously
// gated execution on a STATELESS `confirm: true` flag with no server-side
// second factor. Nothing bound `confirm: true` to a prior preview, so:
//   - an agent could self-supply `confirm: true` on its FIRST call and the
//     purchase/creation/deletion/key-reset executed immediately
//     (F2-eval F2-25, F2-26 — first-contact self-supplied confirm)
//   - an agent "fixing" an unrelated validation error in retry mode
//     unprompted added `confirm: true` while correcting a different field
//     (F2-eval R5, R9 — error-recovery self-supplied confirm)
// The schema text ("Pass `true` ONLY after the human user has approved") is
// advisory-only and cannot bind an LLM (07-30 lesson: description-only gates
// do not hold against a retrying agent).
//
// Fix: a signed, expiring, payload-bound approval token.
//   1. First call (no `approval_token`) -> returns a PREVIEW (no API call)
//      plus a fresh `approval_token`. `confirm: true` is NOT a substitute
//      for this step and is REJECTED if present without a token — this is
//      the exact F2-2 hole, and closing it is the whole point.
//   2. Second call, with `approval_token` set to the exact value from the
//      preview AND the exact same parameters, re-derives the HMAC over the
//      canonical (key-sorted) JSON of those parameters; if it matches and
//      has not expired, the call is authorized and the tool proceeds to the
//      real API call.
// Any other shape (no token + confirm:true; token present but wrong,
// stale-payload, or expired) is REJECTED — thrown as a NovadaError so it
// surfaces as `isError: true` with a fixed `agent_instruction` through the
// standard dispatch -> classifyError path (index.ts / mcp.ts). Never
// silently ignored, never silently downgraded to a preview.
//
// Secret handling:
//   - Local/stdio (single long-lived process): a random 32-byte secret is
//     generated ONCE per process (`crypto.randomBytes(32)`) and reused for
//     the process lifetime. A preview and its matching execute call happen
//     within the same running server process, so no configuration is
//     required and the token cannot be forged or replayed across restarts.
//   - Hosted/serverless (`isHostedEnvironment()` true — Vercel/Lambda, where
//     a preview and its execute call can land on DIFFERENT cold-started
//     instances, each with its own in-memory secret): the secret MUST be
//     shared across instances, so it is read from `NOVADA_APPROVAL_SECRET`.
//     If that env var is unset, EVERY call that reaches this gate FAILS
//     CLOSED with a config error — it does NOT fall back to a per-instance
//     random secret, which would make legitimate execute calls fail
//     unpredictably depending on which instance happened to handle the
//     preview, and would not be a real security boundary anyway.
//     (Only 3 of the 4 gated tools — ip_whitelist, static_ip_mgmt,
//     capture_apikey — are HOSTED_HIDDEN today per hosted-server/vercel/api/
//     mcp.ts:496-505 (see finding G); proxy_account_create is NOT in that
//     set and IS dispatchable on the live hosted deployment right now, so
//     this hosted path is already reachable in production for it — the
//     operator MUST set NOVADA_APPROVAL_SECRET on the Vercel project or
//     every hosted execute call for proxy_account_create fails closed. The
//     util is hosted-safe BY CONSTRUCTION regardless of which tools happen
//     to be hidden — it does not rely on that exclusion for safety.)
//
// Class-not-instance: this is the ONE implementation. All four tools call
// `evaluateApprovalGate()` — no tool re-implements signing/verification.

import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { isHostedEnvironment } from "../config.js";
import { NovadaError, NovadaErrorCode } from "../_core/errors.js";

/** Approval tokens are valid for 10 minutes after being minted. */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;

/**
 * The single canonical instruction surfaced on EVERY rejection shape
 * (missing/invalid/expired/mismatched token, or confirm:true with no
 * token). Deliberately identical text every time so an agent cannot infer
 * anything from message variation about how "close" a forged token was.
 */
export const APPROVAL_AGENT_INSTRUCTION =
  "This action is irreversible and requires two steps. Call again WITHOUT " +
  "approval_token to get a preview and a token, review it, then call again " +
  "with the exact same parameters plus that approval_token. Do not invent a token.";

export type ApprovalGateResult =
  | { authorized: true }
  | {
      authorized: false;
      /** Opaque token: base64url(HMAC-SHA256(secret, canonicalPayload + "|" + exp)) + "|" + exp. */
      approvalToken: string;
      /** Epoch-ms expiry embedded in (and bound by) the token. */
      expiresAt: number;
      expiresInSeconds: number;
    };

// ─── Canonical JSON ─────────────────────────────────────────────────────────

/**
 * Deterministic JSON serialization: object keys sorted recursively so the
 * SAME logical payload always produces the SAME string regardless of key
 * insertion order (zod's parsed output can reorder keys once defaults are
 * applied, and JS object key order is otherwise insertion-order-dependent).
 * Arrays keep their element order — order is semantically meaningful there.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      out[key] = sortKeysDeep(input[key]);
    }
    return out;
  }
  return value;
}

// ─── Secret resolution ──────────────────────────────────────────────────────

/** Per-process random secret for local/stdio use. Lazily generated (module singleton). */
let localProcessSecret: Buffer | undefined;

function getApprovalSecret(action: string): Buffer {
  if (isHostedEnvironment()) {
    const fromEnv = process.env.NOVADA_APPROVAL_SECRET?.trim();
    if (!fromEnv) {
      // FAIL CLOSED — never fall back to a per-instance random secret on a
      // multi-instance serverless runtime; that would silently break the
      // security guarantee (preview minted on instance A could never be
      // verified by instance B) while looking like it "worked".
      throw new NovadaError({
        code: NovadaErrorCode.PRODUCT_UNAVAILABLE,
        message:
          `"${action}" cannot be authorized on this hosted deployment: ` +
          `NOVADA_APPROVAL_SECRET is not configured.`,
        agent_instruction:
          "This write action is unavailable until the operator sets " +
          "NOVADA_APPROVAL_SECRET on this deployment. This is a server " +
          "configuration issue, not something fixable by retrying or " +
          "changing parameters — do not retry.",
        retryable: false,
      });
    }
    return Buffer.from(fromEnv, "utf8");
  }
  if (!localProcessSecret) {
    localProcessSecret = randomBytes(32);
  }
  return localProcessSecret;
}

// ─── Sign / verify ──────────────────────────────────────────────────────────

function sign(secret: Buffer, canonicalPayload: string, exp: number): string {
  return createHmac("sha256", secret)
    .update(canonicalPayload)
    .update("|")
    .update(String(exp))
    .digest("base64url");
}

/** Constant-time verification of a `<sig>|<exp>` token against the canonical payload. */
function verify(secret: Buffer, token: string, canonicalPayload: string): boolean {
  const sepIdx = token.lastIndexOf("|");
  if (sepIdx <= 0 || sepIdx === token.length - 1) return false; // malformed shape

  const providedSig = token.slice(0, sepIdx);
  const expStr = token.slice(sepIdx + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false; // malformed or expired exp

  const expectedSig = sign(secret, canonicalPayload, exp);
  const a = Buffer.from(providedSig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  // Equal-length check first: timingSafeEqual throws on length mismatch, and
  // an unequal-length signature is trivially invalid regardless.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function rejection(action: string, reason: string): NovadaError {
  return new NovadaError({
    code: NovadaErrorCode.INVALID_PARAMS,
    message: `"${action}" was not authorized: ${reason}`,
    agent_instruction: APPROVAL_AGENT_INSTRUCTION,
    retryable: false,
  });
}

// ─── Public gate ────────────────────────────────────────────────────────────

/**
 * Evaluate the two-step approval gate for one WRITE/destructive tool call.
 *
 * `params` is the tool's OWN zod-parsed params object (so it already
 * includes `approval_token` / `confirm` if the caller supplied them, plus
 * every other field the caller supplied with defaults applied). `action` is
 * a short machine-readable label used only in error/preview text (e.g.
 * "create_proxy_sub_account").
 *
 * Returns `{ authorized: true }` when the call may proceed to the real API.
 *
 * Returns `{ authorized: false, approvalToken, ... }` when the caller should
 * show a preview and STOP — this is the normal, expected first-call shape
 * and is NOT an error.
 *
 * THROWS a NovadaError for every rejected shape: `confirm: true` with no
 * token, a token that doesn't verify (wrong, tampered, payload changed
 * since minting), or an expired token. These are never returned as a
 * "denied" value — they must not be mistakable for a preview, and they must
 * surface as `isError: true` at the MCP layer via the standard
 * dispatch -> classifyError -> toAgentString() path.
 */
export function evaluateApprovalGate(
  params: Record<string, unknown>,
  action: string,
): ApprovalGateResult {
  const secret = getApprovalSecret(action); // throws (fail closed) if hosted + unset
  const { approval_token, confirm, ...rest } = params;
  const canonicalPayload = canonicalJson(rest);

  if (typeof approval_token === "string" && approval_token.length > 0) {
    if (verify(secret, approval_token, canonicalPayload)) {
      return { authorized: true };
    }
    throw rejection(
      action,
      "approval_token is missing, invalid, expired, or does not match the supplied parameters.",
    );
  }

  // F2-2: `confirm: true` alone, with no prior preview token, is the exact
  // self-approval hole this gate closes. Reject — do NOT treat it as either
  // "authorized" or "here's a preview", so an agent can never talk itself
  // into execution by adding `confirm: true` while "fixing" an error.
  if (confirm === true) {
    throw rejection(action, "confirm:true was supplied without a prior approval_token.");
  }

  const expiresAt = Date.now() + APPROVAL_TTL_MS;
  const approvalToken = `${sign(secret, canonicalPayload, expiresAt)}|${expiresAt}`;
  return {
    authorized: false,
    approvalToken,
    expiresAt,
    expiresInSeconds: Math.round(APPROVAL_TTL_MS / 1000),
  };
}
