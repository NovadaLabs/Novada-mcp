# DingTalk (钉钉) health monitoring — Phase 1

Delivers mcp.novada.com health signal to a DingTalk group via a custom-robot
webhook — the piece the 2026-10-09→10-18 "Vercel 402, nobody noticed for 9
days" incident showed was missing (email/GitHub-issue/Linear-comment alone
weren't reaching anyone in time). Full design + rationale:
`~/Projects/novada-mcp/reports/dingtalk-alerting-design-2026-10-22.md`
(local-only report, not part of this repo). This implements **Phase 1**
of that design only — see §7 for what P2 defers.

CI wiring: [`.github/workflows/mcp-health-dingtalk.yml`](../../.github/workflows/mcp-health-dingtalk.yml).

## What it checks

Two modes, both reading the same CHECK TABLE in
[`checks.mjs`](./checks.mjs) (`CHECK_TABLE` — one row per check; adding a
new probe is a new row there, not a new branch anywhere else):

### `--mode alert` — 4x/day (off-peak hours), FREE checks only

| id | what | severity if failing | needs `NOVADA_TEST_KEY`? |
|---|---|---|---|
| `initialize` | JSON-RPC `initialize`, expects `result.serverInfo.version` | P0 | yes |
| `tools_list` | `tools/list` count vs the committed golden baseline (`hosted-server/scripts/golden/baseline/toolslist-default.json`) | P0 | yes |
| `oauth_discovery` | `/.well-known/oauth-protected-resource/mcp` + `/.well-known/oauth-authorization-server` reachable, required RFC 9728/8414 fields present | P0 | no |
| `unauthenticated_401` | an unauthenticated POST `/mcp` returns 401 + `WWW-Authenticate: ... resource_metadata=...` (proves the sign-in entry point itself is reachable) | P0 | no |
| `novada_setup` | one free `tools/call` round trip | P1 | yes |

`mcp.novada.com` requires an API key for EVERY method, including
`initialize` (2026-10-23 review finding) — so "free" here means "doesn't
consume billable Scraper/Capture credits", not "unauthenticated". Every row
above marked "needs `NOVADA_TEST_KEY`: yes" calls `checks.mjs`'s shared
`requireApiKey()` guard FIRST: if `ctx.apiKey` is absent it returns a
distinct `errorClass: "config"` failure (note: `"<id>: monitor
misconfigured: NOVADA_TEST_KEY missing"`) instead of ever attempting the
call — so a CI job wired without the secret can never masquerade as a real
`mcp.novada.com` outage. `run.mjs`'s `runAlertMode()` routes these
`"config"`-class results to a distinct "⚙️ 监控配置缺失" (monitor
misconfigured) DingTalk notice, sent **once** (tracked in
`state.misconfigured`, independent of the outage dedupe map), never through
the alert/heartbeat state machine. `checks.mjs`'s `requiredEnvVarsForCosts()`
derives, per mode, the full set of env vars its active rows need — see
`workflow.test.mjs`, which asserts the workflow's own `env:` blocks actually
provide them (class-level, not a hardcoded per-job check).

**Cadence (2026-10-25 owner decision):** every-15-minutes alert checks were
too much — GitHub's own scheduler was only actually managing to run this
every ~3-4h anyway. `alert-check` now runs 4x/day at off-peak minutes
(`.github/workflows/mcp-health-dingtalk.yml`'s cron: `37 0,6,12,18 * * *`
UTC). The daily report is unchanged (still once/day at 01:07 UTC = 09:07
Beijing, even though GitHub may delay it).

In-run confirmation + dedupe/escalation (implemented in
[`checks.mjs`](./checks.mjs)'s `runChecksWithConfirmation` +
[`state.mjs`](./state.mjs)'s `computeNextAlertState`/`advanceCheckState`,
pure + unit-tested):

- A failing free check gets ONE re-probe inside the SAME run, after waiting
  `checks.mjs`'s `REPROBE_DELAY_MS` (60s) — this is what replaced the old
  "2 consecutive 15-min-apart runs" dedupe: at a 4x/day (~6h-apart) cadence,
  waiting for a 2nd scheduled run before alerting would delay a real outage
  notice by 6-12h. A pass on the re-probe tolerates one transient/network
  blip exactly like the old design did (no alert); a 2nd failure on the
  re-probe is a CONFIRMED failure.
- 1st confirmed-failing run → send ONE "🔴 alert" message immediately.
- still failing on a later run, already alerted → send a "🟡 heartbeat"
  (still-failing reminder) once per run (so an unresolved outage never
  looks silently ignored/read) — at this cadence, at most 4/day; this
  replaced the old fixed 2-hour timer, which doesn't fit a 6h-apart cadence.
- a pass after an alert → send ONE "🟢 recovery" message with the outage duration, then reset.

Dedupe state is committed to a dedicated orphan branch,
`dingtalk-health-state` (one `state.json`, updated via `git` plumbing only —
see `state.mjs`'s header comment for why a git branch was chosen over
`actions/cache` for this).

### `--mode daily` — once/day, FREE + BILLABLE checks

Adds, on the shared `NOVADA_TEST_KEY`: `novada_search`, `novada_extract`
(`https://example.com`), `novada_scrape_google`/`novada_scrape_bing`
(`web_search`), `novada_account` (`section=summary`). Always sends ONE
markdown digest (date in Asia/Shanghai, overall status, version, tool
count, a full per-check table, a failure-detail section, and — when
present — a separate account-issue section) — findings or not.

Failure annotations come from an explicit `errorCode`/`errorClass` ->
annotation table in `run.mjs` (`classifyFailure()`) — **never** a tool-name
guess (the 2026-10-23 review's HIGH finding: the prior code specifically
branched on `r.id.startsWith("novada_scrape_")`, which mislabeled a
`novada_search` failure with the identical root cause as "unclassified"
while mislabeling the `novada_scrape_*` rows as a benign "upstream" issue).
`novada_search`/`novada_scrape_google`/`novada_scrape_bing` failing with the
SAME `errorCode` always get the SAME annotation now. Two entries are marked
`accountIssue: true` — `INSUFFICIENT_BALANCE` ("测试账号余额不足（不是产品
故障）") and `INVALID_API_KEY` ("测试 key 失效") — a shared-test-account
problem, not a `mcp.novada.com` regression: these are excluded from
**整体状态**/worst-severity and listed in their own **监控账号问题** section
instead (owner wants an exhausted test wallet to never look like a product
outage). `API_DOWN` gets "上游服务故障"; any unrecognized errorCode/errorClass
falls back to "未分类" rather than a guess.

## Setting up secrets

GitHub repo → Settings → Secrets and variables → Actions:

| Secret | Required | Notes |
|---|---|---|
| `DINGTALK_WEBHOOK_URL` | Yes (to actually send) | `https://oapi.dingtalk.com/robot/send?access_token=...` from the robot's DingTalk group settings. Owner-created — see the design doc §4.2 for the click-level DingTalk-side steps; this repo never creates a robot or handles a raw webhook URL. |
| `DINGTALK_SECRET` | Recommended | The `SEC...` 加签 (HMAC-SHA256) secret from the same robot's security settings. Enables request signing — see `send.mjs`'s `signDingTalk()`. |
| `DINGTALK_KEYWORD` | Optional | Only needed if the robot's security mode is "自定义关键词" instead of 加签. `send.mjs` GUARANTEES the keyword appears (prepends it to the title if absent) rather than merely validating — every title this project sends already starts with "Novada MCP", so a keyword of `MCP` needs zero prepending in practice. |
| `NOVADA_MONITOR_KEY` (repo secret) → env `NOVADA_TEST_KEY` | Yes (both modes) | Dedicated low-balance monitor key, separate from the shared `NOVADA_TEST_KEY` used by nightly-canary.yml, so a leak has a bounded cost and the two can be rotated independently. |

If `DINGTALK_WEBHOOK_URL` is unset, **both modes fail loudly** (exit 1,
clear stderr message) rather than silently no-op — see `run.mjs`'s module
doc comment for why this project treats that specific failure mode as the
one thing it must never repeat.

## Running manually

```bash
# Actions tab -> "MCP Health (DingTalk)" -> "Run workflow" -> pick alert/daily

# Locally (dry run — prints the composed message, sends nothing, never
# touches the state branch):
DRY_RUN=1 NOVADA_TEST_KEY=<test key> node monitoring/dingtalk/run.mjs --mode alert
DRY_RUN=1 NOVADA_TEST_KEY=<test key> node monitoring/dingtalk/run.mjs --mode daily

# Locally, for real (needs DINGTALK_WEBHOOK_URL/_SECRET — point these at a
# TEST group first, never the real one, while validating a change):
DINGTALK_WEBHOOK_URL=<url> DINGTALK_SECRET=<secret> NOVADA_TEST_KEY=<key> \
  node monitoring/dingtalk/run.mjs --mode daily
```

## Silencing / pausing

- **Temporarily**: disable the `mcp-health-dingtalk.yml` workflow from the
  Actions tab ("..." → "Disable workflow"). The `dingtalk-health-state`
  branch is left untouched and alert dedupe resumes correctly once
  re-enabled (no backlog of missed heartbeats fires on resume — the state
  machine only reacts to the NEXT run's result, it doesn't replay missed
  intervals).
- **One check only**: remove its row from `CHECK_TABLE` in `checks.mjs`
  (class-not-instance — no other file needs touching).
- **Permanently / reset dedupe state**: delete the `dingtalk-health-state`
  branch; the next run recreates it fresh (treated identically to
  "first-ever run" — see `state.mjs`'s `loadState()`).

## Tests

```bash
node --test monitoring/dingtalk/*.test.mjs
```

Fully offline — no network, no secrets, no live git remote (the
`state.mjs` git-plumbing round trip runs against a throwaway local
`git init --bare` scratch repo, not any real remote).

`workflow.test.mjs` additionally parses
[`mcp-health-dingtalk.yml`](../../.github/workflows/mcp-health-dingtalk.yml)'s
own actual YAML and asserts every job that runs `run.mjs` provides every env
var its mode's `CHECK_TABLE` rows declare via `requiredEnvVars` — derived
from the table, not a hardcoded per-job string, so this is the regression
test for the CRITICAL 2026-10-23 finding (`alert-check` missing
`NOVADA_TEST_KEY`) at the workflow-wiring level, not just the probe level.
