# Synthetic Monitor — mcp.novada.com

Three layers, increasing depth and cost, watching the live hosted endpoint
(`https://mcp.novada.com`) between deploys.

| Layer | What | Owns it | Frequency |
|-------|------|---------|-----------|
| **A** | UptimeRobot / Better Stack liveness probe on `novada_setup` + `novada_discover`, status page, alerting | Owner-provisioned — **not in this repo** | ~5 min |
| **B** | All-tools smoke (`monitoring/smoke/all-tools-smoke.mjs`) | This repo, via CI | every 6h |
| **C** | k6 stress (`monitoring/stress/k6-stress.js`) | This repo, via CI | daily |

CI wiring for Layers B and C lives in
[`.github/workflows/synthetic-monitor.yml`](../.github/workflows/synthetic-monitor.yml).
It is **scheduled + manual (`workflow_dispatch`) only** — it never runs on
push/PR, so routine commits never burn test-key budget or k6 minutes.

## Layer A — liveness (owner-provisioned, external)

A cheap external prober (UptimeRobot or Better Stack) hits `novada_setup` and
`novada_discover` roughly every 5 minutes and drives a public status page +
alert routing (email/Slack/etc.). This is configured directly in the
UptimeRobot/Better Stack dashboard by the owner — there is no code for it in
this repo, and it is intentionally kept outside CI so basic liveness doesn't
depend on GitHub Actions being healthy.

## Layer B — all-tools smoke (this repo)

`monitoring/smoke/all-tools-smoke.mjs` — dependency-free Node ≥20 script.
Exercises the tool surface end-to-end, writes a dated JSON report to
`monitoring/reports/smoke-<date>.json`, and exits non-zero only on a real
regression (not on transient flakiness).

Run locally:

```bash
NOVADA_TEST_KEY=<key> node monitoring/smoke/all-tools-smoke.mjs
```

### Tool-drift baseline (`monitoring/smoke/baseline-tools.json`)

Tier-2 (presence-check every live tool) detects a removed/renamed tool by
diffing the live `tools/list` against a **committed** baseline file,
`monitoring/smoke/baseline-tools.json` (shape: `{ "capturedAt": "<ISO>",
"tools": [...] }`). This file is checked into git deliberately —
`monitoring/reports/` is gitignored (see `.gitignore`'s `reports/` rule) and
every CI run starts from a fresh checkout, so a "diff against last run's
report" baseline would always be empty in CI and regression detection would
never fire. The committed file survives across checkouts, so it works.

- A baseline tool **missing** from the live `tools/list` = regression → the
  run exits non-zero.
- A live tool **not yet** in the baseline = informational "new tool" warning
  only — never fails the run.
- If `baseline-tools.json` doesn't exist yet, the run bootstraps it from the
  live tool list and passes (first run only).
- To intentionally adopt new/renamed tools into the baseline (e.g. after a
  deliberate tool add), run with `UPDATE_BASELINE=1` and commit the result:

```bash
NOVADA_TEST_KEY=<key> UPDATE_BASELINE=1 node monitoring/smoke/all-tools-smoke.mjs
git add monitoring/smoke/baseline-tools.json && git commit -m "chore: refresh smoke tool baseline"
```

## Layer C — k6 stress (this repo)

`monitoring/stress/k6-stress.js` — a k6 load/stress script.

Run locally (requires [k6](https://k6.io/docs/get-started/installation/) installed):

```bash
NOVADA_TEST_KEY=<key> k6 run monitoring/stress/k6-stress.js
```

## Required GitHub Secrets

| Secret | Required | Notes |
|--------|----------|-------|
| `NOVADA_TEST_KEY` | Yes | A **dedicated, low-value test key with a budget cap** — never a production key. Used by both Layer B and Layer C. |
| `ALERT_WEBHOOK` | No | Slack/Telegram-compatible incoming webhook URL. If set, a failed job POSTs a one-line status message to it. If unset, the alert step is skipped and **GitHub's own failed-scheduled-run notification** (email to repo watchers / Actions tab) is the fallback — no silent failures either way. |

## Cost rule

High-frequency layers must stay cheap:

- Layer A is a liveness ping only — two lightweight, free/no-cost tool calls.
- Layer B (every 6h) defaults to free/cheap tool calls only. Billable
  scraper operations are **gated behind `SMOKE_SCRAPERS=1`** and **off by
  default**. Locally, set that env var explicitly. In CI, the scheduled 6h
  run never sets it — the only way to turn Tier-3 on is a **manual dispatch**
  of `synthetic-monitor.yml` with its `smoke_scrapers` input checked (Actions
  tab → "Run workflow" → toggle "Also execute one real Tier-3 scraper call"),
  which the workflow maps to `SMOKE_SCRAPERS=1` for that run only. Either way,
  expect it to cost real credits.
- Layer C (daily, off-peak) is the one layer allowed to generate real load,
  precisely because it only runs once a day.
- `NOVADA_TEST_KEY` must always be a budget-capped test key, never a
  production key — a runaway loop or bad regression should hit a spend
  ceiling, not the real account.

## Frequencies at a glance

| Layer | Frequency | Trigger |
|-------|-----------|---------|
| A — UptimeRobot/Better Stack | ~5 min | External, owner-configured |
| B — all-tools smoke | every 6h | `synthetic-monitor.yml` (`17 */6 * * *` UTC) |
| C — k6 stress | daily | `synthetic-monitor.yml` (`23 4 * * *` UTC) |
