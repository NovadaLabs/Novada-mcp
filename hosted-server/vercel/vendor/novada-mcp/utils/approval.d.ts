/** Approval tokens are valid for 10 minutes after being minted. */
export declare const APPROVAL_TTL_MS: number;
/**
 * The single canonical instruction surfaced on EVERY rejection shape
 * (missing/invalid/expired/mismatched token, or confirm:true with no
 * token). Deliberately identical text every time so an agent cannot infer
 * anything from message variation about how "close" a forged token was.
 */
export declare const APPROVAL_AGENT_INSTRUCTION: string;
export type ApprovalGateResult = {
    authorized: true;
} | {
    authorized: false;
    /** Opaque token: base64url(HMAC-SHA256(secret, canonicalPayload + "|" + exp)) + "|" + exp. */
    approvalToken: string;
    /** Epoch-ms expiry embedded in (and bound by) the token. */
    expiresAt: number;
    expiresInSeconds: number;
};
/**
 * Deterministic JSON serialization: object keys sorted recursively so the
 * SAME logical payload always produces the SAME string regardless of key
 * insertion order (zod's parsed output can reorder keys once defaults are
 * applied, and JS object key order is otherwise insertion-order-dependent).
 * Arrays keep their element order — order is semantically meaningful there.
 */
export declare function canonicalJson(value: unknown): string;
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
export declare function evaluateApprovalGate(params: Record<string, unknown>, action: string): ApprovalGateResult;
//# sourceMappingURL=approval.d.ts.map