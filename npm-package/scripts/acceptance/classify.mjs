/**
 * Three-way classification of a live scraper smoke-call result — the heart of the
 * release-acceptance live-smoke gate (scripts/acceptance/live-smoke.mjs).
 *
 * Live web scraping has TWO failure modes that MUST NOT be conflated:
 *   - "wire_fail" — OUR integration is wrong: bad scraper_id (11006), bad/missing params
 *                   (10001), unknown platform, or auth. THIS blocks the release.
 *   - "flake"     — the request was accepted by Novada but the TARGET site returned a
 *                   CAPTCHA / 403 / 5xx, or the upstream timed out. Transient, target-side,
 *                   NOT our bug. Reported + retried once, but never blocks a release.
 *
 * A smoke test that blocked every release the moment Instagram happened to serve a CAPTCHA
 * would be the boy who cried wolf — untrustworthy. Separating these two is exactly what makes
 * the gate's "green" mean "our integration is sound" (which is the only thing we control).
 * Observed live 2026-07-20: the failing set changed run-to-run (instagram/github/perplexity
 * one run, a different 4 the next) — the signature of target-side transients, not wire bugs.
 */

// The scraper accepted the request AND returned data / a task id / progress.
export const ACCEPT_PATTERNS = [/source:\s*live/i, /records:\s*\d+/i, /task_id/i, /status:\s*processing/i];

// Wire-integration failures (OUR bug) — these BLOCK the release.
export const WIRE_FAIL_PATTERNS = [
  /\b11006\b/,            // invalid/unsupported operation id
  /\b10001\b/,            // missing required parameters
  /Unknown platform/i,    // bad scraper_name
  /failure_class:\s*auth/i,
  /auth error/i,
  /INVALID_API_KEY/i,
];

// Upstream/target-side transient signals (NOT our bug) — used only to LABEL a flake in the
// report. Classification does not depend on this list: anything that is neither an accept
// signal nor a wire-fail is treated as a flake by default (surfaced, never silently passed).
export const UPSTREAM_FLAKE_PATTERNS = [
  /API_DOWN/i, /\bCAPTCHA\b/i, /Forbidden/i, /\b403\b/, /\b5\d\d\b/,
  /HTTP undefined/i, /\btimeout\b/i, /result data not exist/i,
];

/**
 * @param {string} text  the string dispatch() returned or the error text it threw
 * @returns {"pass"|"wire_fail"|"flake"}
 */
export function classify(text) {
  const t = String(text ?? "");
  if (WIRE_FAIL_PATTERNS.some((re) => re.test(t))) return "wire_fail";
  if (ACCEPT_PATTERNS.some((re) => re.test(t))) return "pass";
  return "flake";
}

/** Human-readable reason for a flake, for the report note. */
export function flakeReason(text) {
  const t = String(text ?? "");
  return UPSTREAM_FLAKE_PATTERNS.some((re) => re.test(t))
    ? "upstream/target transient (CAPTCHA/403/5xx/timeout)"
    : "no accept signal (empty or unrecognized response)";
}
