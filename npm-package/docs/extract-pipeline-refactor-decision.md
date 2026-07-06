# Decision Memo — Should the `novada_extract` escalation pipeline be refactored post-benchmark?

- **Ticket:** NOV-342
- **Date:** 2026-06-30
- **Status:** Decision recorded — **KEEP the current architecture; apply two targeted, in-place fixes.** Do **not** do a structural rewrite.
- **Scope:** the static → render → browser → wayback escalation chain inside `src/tools/extract.ts`.
- **Inputs:** the 2026-06-23 competitive benchmark (240 live requests, Novada vs Firecrawl vs Tavily;
  `benchmark/results/latest-summary.json` + the raw `2026-06-23-benchmark.{json,html,csv}`) and the
  2026-06-29 deterministic optimization loops (`benchmark/results/2026-06-29-optimization-loops.md`).

---

## 1. Current design (what exists today)

`extract()` resolves a single **effective mode** and then either takes a forced path or climbs a
quality-gated ladder. The decision points, in order:

1. **Mode resolution** (`render="auto"` only):
   - `lookupDomain(url)` — the hand-curated `DOMAIN_REGISTRY` (30+ hard targets: Amazon, LinkedIn, G2,
     Zillow, Glassdoor, Walmart, Instagram, TikTok, Shein …). A registry hit is **authoritative** and
     pins the method + proxy tier, skipping the ladder entirely.
   - `getRouteHint(url)` — NOV-330 per-session routing memory. Consulted only when the registry has no
     entry; if a prior request this session found the winning mode for the host, start there. Advisory:
     the quality checks below still run, so a stale hint self-corrects (`recordRouteSuccess` re-pins).
   - Otherwise the raw `render` value (`auto` / `static` / `render` / `browser`; `js` normalizes to `render`).

2. **Forced / registry-resolved modes** skip escalation:
   - `browser` → `fetchViaBrowser` (CDP).
   - `render` → `fetchWithRender` (Web Unblocker), with a **QW-4 guard**: if the rendered body is
     `< 2000` chars *and* `detectBotChallenge` fires *and* a browser is configured, try browser once and
     keep whichever is longer.

3. **`auto` / `static` path** — the ladder:
   - **P1-2 static race:** for `auto`, `Promise.any([ direct fetch (3s, no proxy), proxy fetch ])`.
     Direct only "wins" if it returns clean HTML (no bot challenge, not JS-heavy); otherwise the proxy
     result is used. Open static sites (Wikipedia, HN, TechCrunch) return in ~300 ms instead of ~3 s.
   - **Escalation trigger:** if `auto`, no registry hit, not a PDF, and
     `detectJsHeavyContent(html) || detectBotChallenge(html)` → escalate to `fetchWithRender`.
   - If render still returns a bot challenge → escalate to `fetchViaBrowser` **iff** a browser is
     configured. `pickBetterHtml` (NOV #1/#12) scores candidate vs incumbent by extracted-content length
     under the *same* extractor the formatter uses, so a good static/render result is never clobbered by
     an empty challenge stub. If nothing better is found, `usedMode = "render-failed"` and a structured
     `renderError` is attached.
   - **Wayback tail:** when the live chain yields empty/blocked content, `extract()` falls back to
     `https://web.archive.org/web/2024/<url>`, sets `source: "wayback"`, and surfaces a staleness hint.

4. **Output:** every response carries `mode`, `source` (`live`/`wayback`), a 0-100 quality block
   (`content_present` / `content_ok` / `cleanliness_score`, post-NOV-565), structured errors with
   `failure_class`, and an `## Agent Action` block.

**Design intent:** cheapest method first, escalate only on evidence, never lose a good earlier result,
and let a curated registry short-circuit known-hard domains so they pay the latency once, not per probe.

---

## 2. What the benchmark + QA actually found

### 2a. Success rate is competitive; the gap is latency and quality-of-volume, not correctness

From `latest-summary.json` (2026-06-23, 20 URLs × 4 categories × 3 providers):

| Provider | Success | P50 latency | P95 latency | $/1k | Avg chars |
|----------|---------|-------------|-------------|------|-----------|
| **novada** | 91.3% | 7,102 ms | 28,566 ms | **$1** | 7,149 (clean) |
| firecrawl | 92.5% | 761 ms | 7,561 ms | $4 | 72,057 (raw dump) |
| tavily | 86.3% | 376 ms | 567 ms | $5 | 35,206 (indexed) |

Per category, Novada is at parity except anti-bot: static 95%, js_heavy **100%**, structured 90%,
anti_bot **80%** (16/20). Novada's success rate jumped 70%→91% between the 06-22 and 06-23 runs after the
registry/route work landed — the architecture is **converging upward**, not stuck.

The two real deltas:
- **Latency.** P50 7.1 s vs Firecrawl's 0.76 s. This is inherent to a *serialized* ladder: static is
  attempted, allowed to fail, then render, then browser. The 06-22 report flagged "parallel escalation"
  as the fix (dispatch static + browser, return first success) for a projected ~8 s → ~3 s P50 cut.
- **Quality is a measurement artifact.** `scoreContentQuality` (`benchmark/providers/base.ts`) maxes any
  provider that returns >5 k chars with headings/lists. Firecrawl's 8.9 "beats" Novada's 7.5 largely
  because it returns 10× the raw bytes. Novada returns clean main content by design. This is a
  **scorer** problem, not a pipeline problem (already called out in the 06-22 report §2 caveat).

### 2b. Render-fallback correctness — already fixed, do not reopen

The "render fallback" QA finding (NOV #1/#12) was that escalating to the browser tier
*unconditionally overwrote* `html`, so an empty CDP challenge stub destroyed good static content.
This is **already resolved** by `pickBetterHtml` + the `render-failed` sentinel (shipped in 0.8.8;
covered by `tests/tools/extract.test.ts` escalation cases). A rewrite would risk regressing this
hard-won behavior. Net: the fallback logic is correct; the open issue is purely *when* we escalate
(serial vs parallel), not *whether we keep the right result*.

### 2c. Cold-start / first-hit latency

Two cold-start effects compound the P50:
- **Browser CDP cold start** — first `fetchViaBrowser` for a session pays connection/warm-up before any
  navigation; hard-target registry domains hit this on their first request.
- **Serial probe tax on unknown hosts** — a host not in the registry and not yet in NOV-330 route memory
  pays the *full* static→render(→browser) climb on its first visit; only the *second* visit this session
  is fast. The registry + route memory mitigate this for repeat traffic but not first contact.

P95 (28.6 s) and the worst tail entries in the raw run (e.g. `costco.com` 52 s, `medium.com` 60 s
timeout) are dominated by these cold/serial paths on anti-bot hosts, not by the steady state.

### 2d. Quality gating already improved (NOV-565)

A separate prior finding — docs pages mislabeled "poor" and needlessly escalated — was fixed by splitting
`content_present` from `cleanliness_score` so a full-text docs page no longer trips render escalation.
That removed a class of *unnecessary* escalations and is the kind of surgical change that works here.

---

## 3. Options considered

| Option | What it is | Verdict |
|--------|------------|---------|
| **A. Structural rewrite** | Replace the imperative ladder with a declarative strategy/pipeline engine (pluggable stages, a planner). | **Reject.** High risk to the just-stabilized `pickBetterHtml`/`render-failed`/wayback/PDF/JSON branches; benchmark shows no *correctness* deficit that a rewrite would address. Pure infra-over-revenue. |
| **B. Keep + targeted fixes** | Leave the control flow; add (1) opt-in parallel escalation for known-hard categories, (2) a session-scoped browser warm-up to amortize CDP cold start. | **Accept.** Attacks the only real metric gap (latency) at low blast radius, behind flags, with the existing escalation tests as a guard rail. |
| **C. Do nothing** | Ship as-is. | Partial. Acceptable for correctness, but leaves the 7 s P50 / cold-start tail that is the one place competitors visibly win. |

---

## 4. Recommendation

**Keep the current escalation architecture. Do not refactor it structurally.** The pipeline is
correct, converging upward on success rate (70%→91%), cost-leading (4–5×), and its highest-risk
behavior (render fallback / best-result retention) was *just* fixed and test-covered — a rewrite would
spend risk to buy nothing the benchmark asks for.

Instead, apply two **in-place, flag-gated** optimizations, each landing with a deterministic test before
it ships (per the project's verify-first rule):

1. **Parallel escalation for hard categories (latency).** For registry-tagged hard targets (and,
   optionally, the anti_bot class), dispatch the proxy/render and browser attempts concurrently and keep
   the better result via the *existing* `pickBetterHtml`. Projected P50 ~7 s → ~3 s with no change to the
   result-selection contract. Gate behind a flag (e.g. `NOVADA_PARALLEL_ESCALATE`) so the serial path
   stays the default until the numbers are confirmed on a fresh run.

2. **Session browser warm-up (cold start).** Lazily warm one CDP connection on the first hard-target
   request of a session so subsequent browser escalations skip the cold-start tax. Bounded, opt-in, and
   invisible to the result format.

Explicitly **out of scope** (separate tickets): fixing `scoreContentQuality` to reward semantic density
over raw byte volume (it understates Novada and is a *benchmark scorer* change, not a pipeline change),
and any CAPTCHA-solver work for the remaining anti_bot misses.

**Re-evaluate** this decision only if a future run shows a *success-rate* regression (not a latency or
quality-score gap) traceable to the control flow itself — that, and only that, would justify revisiting
Option A.
