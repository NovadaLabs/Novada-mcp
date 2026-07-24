# Synthetic Monitor — mcp.novada.com

Four layers, increasing depth and cost, watching the live hosted endpoint
(`https://mcp.novada.com`) between deploys.

| Layer | What | Owns it | Frequency |
|-------|------|---------|-----------|
| **A** | UptimeRobot / Better Stack liveness probe on `novada_setup` + `novada_discover`, status page, alerting | Owner-provisioned — **not in this repo** | ~5 min |
| **B** | All-tools smoke (`monitoring/smoke/all-tools-smoke.mjs`) | This repo, via CI | every 6h |
| **C** | k6 stress (`monitoring/stress/k6-stress.js`) | This repo, via CI | daily |
| **D** | Full-tools probe (`monitoring/smoke/full-tools-probe.mjs`) | This repo, via CI | daily |

CI wiring for Layers B, C, and D lives in
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

## Layer D — daily full-tools probe (this repo)

`monitoring/smoke/full-tools-probe.mjs` (dependency-free Node ≥20) +
`monitoring/report/render-report.py` (Python 3 + `openpyxl`). Unlike Layer B
(cheap/free calls, every 6h), this is the **daily "test every hosted tool for
real" probe**: one representative, safe (or dry-run) call against **every**
tool currently served by `tools/list` — including every billable
per-platform scraper (`novada_scrape_amazon`, `_x`, `_tiktok`, etc.). It
never hardcodes the tool inventory: `tools/list` is the single source of
truth, and the script only cross-checks that every tool in its own embedded
probe list is still present (a probe tool missing from the live list is
itself a regression).

Run locally:

```bash
set -a; . ~/.novada/monitor.env; set +a
node monitoring/smoke/full-tools-probe.mjs
python3 monitoring/report/render-report.py   # renders the latest monitoring/reports/full-*.json
```

(`~/.novada/monitor.env` is expected to export `NOVADA_TEST_KEY`, and
optionally `MCP_URL`/`SMOKE_SLOW_MS`/`SMOKE_DELAY_MS` — never commit that file
or its contents; it is outside this repo.)

### Processing → poll disambiguation

Some scraper platforms (Amazon, Walmart, TikTok, X, SHEIN, Perplexity, …) are
slow enough that the hosted tool's ~45s synchronous poll ceiling elapses
before the task finishes. `npm-package/src/tools/scrape.ts` returns this as a
**clean, non-error** `status: processing` / `records: 0` result carrying a
`task_id`. Rather than mis-classify that as a failure, the probe extracts the
`task_id` and polls **once** via the generic dispatcher
(`novada_scrape({ platform, operation: <catalog scraper_id>, task_id })`,
90s timeout):

- Poll returns `records >= 1` → the tool is **SLOW**, not broken (it needed
  one extra poll — this is expected behavior for slow platforms, not a bug).
- Poll is still processing/empty, or itself fails → the platform's task never
  completed server-side → classified `③-backend` (not ours).

### Fault-domain and severity rubric

Every result is classified into a DOMAIN (who owns the fix) and — for
failures — a SEVERITY:

| Domain | Meaning | Examples |
|--------|---------|----------|
| `①-mcp-code` | Ours: a validation/logic bug in this repo's tool wrappers, or a probe tool missing from `tools/list` | bad operation id, missing required param, tool removed from hosted deploy |
| `②-gateway` | Ours: the hosted Vercel wrapper/gateway, not the tool logic itself | HTTP 5xx, a client-abort timeout with no backend error surfaced, version desync, research no-streaming |
| `③-backend` | Not ours: the Novada Scraper API backend | `维护中`/520/`API_DOWN`/"Scraper API error (HTTP undefined)"/activation errors, a known-flaky platform (TOW2-305) failing, or a scraper task still stuck after one poll |
| `-` | Pass | — |

| Severity | Meaning |
|----------|---------|
| **P0** | Endpoint down, OR a CORE tool broken (`novada_search`/`novada_extract`/`novada_scrape`/`novada_setup`/`novada_discover`/`novada_account`) with domain ①/②, OR ≥4 ①/② failures in one run (shared root cause, affecting many tools) |
| **P1** | A single ①/② (ours) failure on a non-core tool, OR ≥4 distinct backend platforms failing at once (systemic Novada Scraper API outage) |
| **P2** | One isolated `③-backend` platform down or stuck (non-flaky) |
| **P3** | Slow-but-returns (needed a poll), latency drift, or a single known-flaky-platform (TOW2-305) failure |

**Exit code:** non-zero (1) **only** when the run found an OURS-domain
(①/②) finding at severity P0 or P1, or a probe tool went MISSING from the
live tool list. A `③-backend` finding — even a full ≥4-platform systemic
outage — always exits 0: it's reported for visibility, never used to page
us, because we don't own the Novada Scraper API backend.

### Report output

Every run writes:

- `monitoring/reports/full-<UTC timestamp>.json` — the raw structured report
  (gitignored, artifact-only — same as Layer B/C reports).
- `monitoring/reports/full-<UTC timestamp>.xlsx` — two sheets, rendered by
  `render-report.py`: `逐工具测试结果` (per-tool results, sorted worst→best by
  severity, status-colored, autofiltered, frozen header) and `汇总` (run
  summary: counts by status/severity, ours vs. backend counts, missing
  tools).
- `monitoring/reports/full-<UTC timestamp>.csv` — the same per-tool table as
  UTF-8-BOM CSV (opens with correct Chinese headers in Excel).

**Phase 2 (implemented):** the `full-daily` job also delivers this report
privately — a private archive-repo push, then `monitoring/report/linear-sync.mjs`
files a Linear alert issue on any P0/P1/P2 finding, or posts a green
heartbeat comment otherwise. See the "Privacy model" section above for the
full picture and why nothing here ever reaches the public repo's Actions UI.

## Privacy model

**This repo (`NovadaLabs/Novada-mcp`) is PUBLIC** — its Actions logs AND
artifacts are world-readable to anyone. The synthetic-monitor *action*
(this workflow, the probe scripts) is fine to keep here; the *report
results* — which backends are down, our fault-domain analysis, per-tool
error text — must **never** be public. Three things enforce that:

1. **No artifacts.** None of the three jobs (`smoke`, `stress`, `full-daily`)
   upload an `actions/upload-artifact` step. Report files never leave the
   ephemeral runner via the public repo.
2. **Quiet public logs.** `full-tools-probe.mjs` and `all-tools-smoke.mjs`
   both read `MONITOR_QUIET` — the CI workflow sets it to `"1"` on both the
   Layer B and Layer D probe steps. In quiet mode, stdout is reduced to a
   single non-revealing completion line (e.g. `[full-tools-probe] complete:
   30 probed, exit 0`) — no tool names, domains, backend names, or severity
   breakdown. The full per-tool detail is unaffected in the JSON report
   file; only what a human reading the public Actions log sees is reduced.
   Local/manual runs leave `MONITOR_QUIET` unset and get the full
   human-readable table, exactly as before.
3. **Private delivery, both channels.** Only the `full-daily` job (Layer D)
   delivers report data anywhere, and only to two private destinations:
   - A **private archive repo**, `NovadaLabs/novada-mcp-monitoring`, holds
     the actual downloadable report files (`full-*.json`/`.xlsx`/`.csv`),
     pushed by the "Push report to private archive" step into
     `reports/<YYYY>/<MM>/`. This repo is where the real, detailed report
     data lives — it is never the public `Novada-mcp` repo.
   - A **private Linear workspace** (team `TongWu`, project `Novada MCP —
     Daily Monitoring Loop`, label `Wutong`) gets an inline alert issue on
     any P0/P1/P2 finding, or a dated heartbeat comment on green days — see
     `monitoring/report/linear-sync.mjs`. The issue/comment body is a
     compact summary plus a **link** to the file in the private archive
     repo above, deliberately avoiding Linear's file-upload flow.

   Neither delivery step ever fails the job on error (missing secret,
   network failure, archive repo not provisioned yet, GraphQL error) — both
   are fail-soft by design, since a delivery failure must never be confused
   with a real monitor-run failure.

Layers B and C (`smoke`, `stress`) intentionally get **neither** private
delivery channel — only Layer D's daily full-tools probe is deep/important
enough to warrant it. Their reports simply stay on the ephemeral runner
(quieted, un-uploaded) and vanish when the job ends; a Layer B/C failure
still surfaces via the `Alert on failure` step (if `ALERT_WEBHOOK` is
configured) or GitHub's own failed-scheduled-run notification.

## Required GitHub Secrets

| Secret | Required | Notes |
|--------|----------|-------|
| `NOVADA_TEST_KEY` | Yes | A **dedicated, low-value test key with a budget cap** — never a production key. Used by Layer B, Layer C, and Layer D. |
| `MONITOR_ARCHIVE_TOKEN` | No (recommended) | A GitHub PAT with push access to the **private** `NovadaLabs/novada-mcp-monitoring` archive repo. If unset, the "Push report to private archive" step is skipped entirely (guarded via the `env` context, never `secrets.*`, inside `if:` — see the workflow file's own comments on why). |
| `LINEAR_API_KEY` | No (recommended) | A Linear personal API key used by `monitoring/report/linear-sync.mjs` to file the daily alert issue / heartbeat comment. If unset, the "Sync report to Linear" step is skipped entirely. Never printed by the script, even on error. |
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
- Layer D (daily) is the one layer allowed to execute **every** billable
  per-platform scraper in a single run, precisely because it only runs once a
  day, one call per platform, `limit:1` on every scraper call.
- `NOVADA_TEST_KEY` must always be a budget-capped test key, never a
  production key — a runaway loop or bad regression should hit a spend
  ceiling, not the real account.

## Frequencies at a glance

| Layer | Frequency | Trigger |
|-------|-----------|---------|
| A — UptimeRobot/Better Stack | ~5 min | External, owner-configured |
| B — all-tools smoke | every 6h | `synthetic-monitor.yml` (`17 */6 * * *` UTC) |
| C — k6 stress | daily | `synthetic-monitor.yml` (`23 4 * * *` UTC) |
| D — full-tools probe | daily | `synthetic-monitor.yml` (`17 0 * * *` UTC) |
