#!/usr/bin/env node
/**
 * monitoring/dingtalk/send.mjs
 *
 * DingTalk custom-robot (群自定义机器人) message sender. Dependency-free
 * (Node >=20 built-in `fetch`/`crypto` only), matching this repo's
 * monitoring/ convention (see monitoring/lib/mcp-client.mjs,
 * monitoring/report/linear-sync.mjs) of stdlib-only + dependency-injected
 * transport so a selftest can run fully offline.
 *
 * Source design: ~/Projects/novada-mcp/reports/dingtalk-alerting-design-2026-10-22.md
 * §1.2-1.5 (endpoint shape, markdown/actionCard bodies, HMAC-SHA256 "加签"
 * signing algorithm, rate limit, error codes).
 *
 * ── Signing ("加签") ─────────────────────────────────────────────────────────
 * DingTalk's documented algorithm (same doc, quoting the official page):
 *   stringToSign = `${timestampMs}\n${secret}`
 *   sign = base64(HMAC-SHA256(key=secret, message=stringToSign))
 *   sign = encodeURIComponent(sign)
 *   finalUrl = webhookUrl + "&timestamp=" + timestampMs + "&sign=" + sign
 * `timestampMs` must be within 1 hour of DingTalk's clock (their constraint,
 * not ours) — always use `Date.now()`, never a cached/stale timestamp.
 *
 * ── Keyword enforcement ──────────────────────────────────────────────────────
 * If DINGTALK_KEYWORD is configured on the webhook's security settings,
 * DingTalk rejects (errcode 310000, errmsg containing "keywords not in
 * content") any message whose title+text doesn't contain it. Rather than
 * just *validate* and let a future template-wording change silently start
 * failing sends (exactly the fragility §1.4 of the design doc warns
 * against), `ensureKeyword()` below GUARANTEES the keyword is present by
 * prepending it to the title when missing — belt-and-suspenders with the
 * "Novada MCP" title prefix this project's run.mjs always uses (which
 * already satisfies a keyword of "MCP" without any prepending).
 *
 * ── Rate limit (20 msg/min per robot) ────────────────────────────────────────
 * DingTalk throttles a custom robot to 20 messages/minute, then imposes a
 * 10-minute lockout on the robot if exceeded. A single workflow run in this
 * project sends at most a handful of messages (one per failing/recovering
 * check), so this is a defensive backstop, not an expected hot path — see
 * `createRateLimiter()`. The WAIT-TIME computation is a pure function
 * (`nextAvailableAt`) so it's unit-testable without a real 60s sleep.
 *
 * ── Secrets never logged ─────────────────────────────────────────────────────
 * No function in this file ever logs the webhook URL (it embeds
 * access_token) or the signing secret. Failure logs include only
 * errcode/errmsg/HTTP status — see `sendDingTalk`'s catch/error branches.
 */

import { createHmac } from "node:crypto";

/** DingTalk's documented "20 messages/minute per robot" limit (design doc §1.5). */
export const RATE_LIMIT_PER_MINUTE = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Compute the DingTalk 加签 (HMAC-SHA256) signature for a given secret and
 * timestamp. Pure function — no Date.now() call inside, so it's exactly
 * reproducible in tests against a fixed vector.
 *
 * Cross-checked against an independent Python implementation of the same
 * documented algorithm (hmac+hashlib+base64+urllib.parse.quote_plus) — see
 * send.test.mjs's SIGNING_FIXTURE, which pins the exact sign string that
 * Python reference produced for the same secret+timestamp, so this isn't
 * just "the JS output equals itself."
 *
 * @param {string} secret the "SEC..." secret from DingTalk's robot security settings
 * @param {number|string} timestampMs milliseconds since epoch
 * @returns {{timestamp: string, sign: string}} `sign` is already URL-encoded
 *   (encodeURIComponent, not a raw base64 string) — append directly to a query string.
 */
export function signDingTalk(secret, timestampMs) {
  const timestamp = String(timestampMs);
  const stringToSign = `${timestamp}\n${secret}`;
  const digestB64 = createHmac("sha256", secret).update(stringToSign, "utf8").digest("base64");
  return { timestamp, sign: encodeURIComponent(digestB64) };
}

/**
 * Append `&timestamp=...&sign=...` to a webhook URL when a secret is
 * configured; returns the URL unchanged when `secret` is falsy (no signing
 * configured — DingTalk also supports keyword-only or no security at all,
 * though the design doc recommends signing for CI use, see §1.4).
 *
 * @param {string} webhookUrl
 * @param {string|undefined} secret
 * @param {number} [nowMs]
 * @returns {string}
 */
export function buildSignedUrl(webhookUrl, secret, nowMs = Date.now()) {
  if (!secret) return webhookUrl;
  const { timestamp, sign } = signDingTalk(secret, nowMs);
  const sep = webhookUrl.includes("?") ? "&" : "?";
  return `${webhookUrl}${sep}timestamp=${timestamp}&sign=${sign}`;
}

/**
 * Guarantee `keyword` appears in title+text by prepending it to the title
 * when absent from both. No-op when `keyword` is falsy (not configured) or
 * already present anywhere in title or text.
 *
 * @param {string} title
 * @param {string} text
 * @param {string|undefined} keyword
 * @returns {{title: string, text: string}}
 */
export function ensureKeyword(title, text, keyword) {
  if (!keyword) return { title, text };
  const haystack = `${title}\n${text}`;
  if (haystack.includes(keyword)) return { title, text };
  return { title: `[${keyword}] ${title}`, text };
}

/** Build a DingTalk `markdown` message body. */
export function buildMarkdownBody(title, text) {
  return { msgtype: "markdown", markdown: { title, text } };
}

/**
 * Build a DingTalk `actionCard` message body — used for real-time alerts so
 * the message carries a "view the run" deep link (design doc §1.3).
 *
 * @param {{title: string, text: string, singleTitle?: string, singleURL?: string}} opts
 */
export function buildActionCardBody({ title, text, singleTitle, singleURL }) {
  const actionCard = { title, text, btnOrientation: "0" };
  if (singleTitle && singleURL) {
    actionCard.singleTitle = singleTitle;
    actionCard.singleURL = singleURL;
  }
  return { msgtype: "actionCard", actionCard };
}

/**
 * Pure function: given the history of past send timestamps (ms epoch,
 * ascending) and "now", compute how many ms to wait before the NEXT send is
 * allowed without exceeding `limit` sends per `windowMs`. Returns 0 when
 * sending immediately is fine.
 *
 * Unit-testable without any real waiting — see send.test.mjs.
 *
 * @param {number[]} history
 * @param {number} now
 * @param {number} [limit]
 * @param {number} [windowMs]
 * @returns {number} milliseconds to wait (0 = send now)
 */
export function nextAvailableInMs(history, now, limit = RATE_LIMIT_PER_MINUTE, windowMs = RATE_LIMIT_WINDOW_MS) {
  const recent = history.filter((t) => now - t < windowMs);
  if (recent.length < limit) return 0;
  // Oldest of the "recent" sends falls out of the window at (t + windowMs);
  // that's the earliest moment a new send is allowed.
  const oldest = Math.min(...recent);
  return Math.max(0, oldest + windowMs - now);
}

/**
 * A tiny in-process sliding-window rate limiter. Dependency-injected `now`/
 * `sleep` so tests can assert on `nextAvailableInMs` without a real 60s
 * sleep (see send.test.mjs — it calls `nextAvailableInMs` directly instead
 * of exercising `acquire()`'s real timer).
 */
export function createRateLimiter({ limit = RATE_LIMIT_PER_MINUTE, windowMs = RATE_LIMIT_WINDOW_MS, now = Date.now, sleep = defaultSleep } = {}) {
  const history = [];
  return {
    async acquire() {
      const waitMs = nextAvailableInMs(history, now(), limit, windowMs);
      if (waitMs > 0) await sleep(waitMs);
      history.push(now());
      // Trim old entries so this array never grows unbounded across a long
      // process lifetime (not a concern for this project's short-lived CI
      // runs, but cheap to do and keeps the limiter correct if ever reused).
      const cutoff = now() - windowMs;
      while (history.length > 0 && history[0] < cutoff) history.shift();
    },
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST one message to a DingTalk custom-robot webhook.
 *
 * - Signs the URL when `secret` is set.
 * - Ensures `keyword` appears in title+text when set.
 * - DRY_RUN (`dryRun: true`): prints the composed request instead of
 *   sending; never touches the network; never consults the rate limiter.
 * - Retries ONCE on a transport failure (network error / HTTP 5xx) only —
 *   a 4xx or a DingTalk-level `errcode !== 0` is NOT retried (it won't
 *   become true on a resubmit; see design doc §1.5's error code table).
 * - Never logs `webhookUrl` or `secret` — only errcode/errmsg/HTTP status.
 *
 * @param {object} opts
 * @param {string} opts.webhookUrl
 * @param {string} [opts.secret]
 * @param {string} [opts.keyword]
 * @param {string} opts.title
 * @param {string} opts.text
 * @param {"markdown"|"actionCard"} [opts.kind] default "markdown"
 * @param {{singleTitle?: string, singleURL?: string}} [opts.actionCard] only used when kind==="actionCard"
 * @param {boolean} [opts.dryRun]
 * @param {typeof fetch} [opts.fetchFn]
 * @param {ReturnType<typeof createRateLimiter>} [opts.rateLimiter]
 * @param {(ms: number) => Promise<void>} [opts.sleep] used for the one retry backoff
 * @returns {Promise<{ok: boolean, dryRun?: boolean, errcode?: number, errmsg?: string, httpStatus?: number, retried?: boolean, error?: string}>}
 */
export async function sendDingTalk({
  webhookUrl,
  secret,
  keyword,
  title,
  text,
  kind = "markdown",
  actionCard,
  dryRun = false,
  fetchFn = fetch,
  rateLimiter,
  sleep = defaultSleep,
}) {
  const ensured = ensureKeyword(title, text, keyword);
  const body =
    kind === "actionCard"
      ? buildActionCardBody({ title: ensured.title, text: ensured.text, ...actionCard })
      : buildMarkdownBody(ensured.title, ensured.text);

  if (dryRun) {
    console.log("[dingtalk/send] DRY_RUN — would POST:");
    console.log(JSON.stringify(body, null, 2));
    return { ok: true, dryRun: true };
  }

  if (!webhookUrl) {
    console.error("[dingtalk/send] no webhookUrl configured — cannot send");
    return { ok: false, error: "missing-webhook-url" };
  }

  if (rateLimiter) await rateLimiter.acquire();

  const url = buildSignedUrl(webhookUrl, secret);
  const attempt = async () => {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json;charset=utf-8" },
        body: JSON.stringify(body),
      });
      const httpStatus = res.status;
      let parsed = null;
      try {
        parsed = await res.json();
      } catch {
        // non-JSON body — fall through, treated as a failure below
      }
      return { httpStatus, parsed };
    } catch (err) {
      return { httpStatus: 0, error: String(err?.message || err) };
    }
  };

  let result = await attempt();
  let retried = false;

  const isTransportFailure = (r) => r.httpStatus === 0 || r.httpStatus >= 500;
  if (isTransportFailure(result)) {
    retried = true;
    await sleep(500);
    result = await attempt();
  }

  if (result.httpStatus === 0) {
    console.error(`[dingtalk/send] network error after ${retried ? "retry" : "1 attempt"}: ${result.error}`);
    return { ok: false, error: result.error, retried };
  }
  if (result.httpStatus !== 200 || !result.parsed) {
    console.error(`[dingtalk/send] unexpected HTTP ${result.httpStatus}${retried ? " (after retry)" : ""}`);
    return { ok: false, httpStatus: result.httpStatus, retried };
  }

  const { errcode, errmsg } = result.parsed;
  if (errcode !== 0) {
    // Per design doc §1.5: diagnose by errmsg TEXT, not just the numeric
    // code — different resources disagree on what a given errcode means.
    console.error(`[dingtalk/send] DingTalk rejected message: errcode=${errcode} errmsg=${errmsg}`);
    return { ok: false, errcode, errmsg, httpStatus: result.httpStatus, retried };
  }

  return { ok: true, errcode: 0, httpStatus: result.httpStatus, retried };
}
