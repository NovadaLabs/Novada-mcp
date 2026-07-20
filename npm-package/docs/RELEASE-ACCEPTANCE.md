# Release Acceptance

The repeatable, standardized test system for every novada-mcp release. Same gates,
every time, producing a dated report that proves "it still works AND no new problem
was introduced" — so shipping is a decision made from a report, not a memory of what
was checked last time.

## Run it

```bash
node scripts/acceptance/run.mjs --feature=<x>
```

Args (all optional):

| Flag | Default | Meaning |
|------|---------|---------|
| `--feature=<slug>` | `release` | Short label for this run, used in the report path |
| `--version=<v>` | `package.json`'s `version` | Version stamped in the report header |
| `--date=<YYYY-MM-DD>` | today | Date stamped in the report header and path |

Environment (keys are read from `process.env` only — never hardcode a key anywhere):

| Env var | Unlocks | Without it |
|---------|---------|------------|
| `NOVADA_SCRAPER_KEY` | Gate 7 (live-smoke) | Gate 7 is SKIPPED, not failed |
| `ANTHROPIC_API_KEY` | Gate 6 (Tier-B eval) | Gate 6 is SKIPPED, not failed |

The local net — build, test:coverage, lint, check-hosted-drift, and eval Tier-A — needs
**no keys at all** and should always be run before every release, even when a keyed run
isn't currently possible.

## The standard gates

| # | Gate | What it proves | Green criterion |
|---|------|-----------------|------------------|
| 1 | `build` (`npm run build`) | The TypeScript compiles cleanly | `tsc` exits 0 |
| 2 | `test:coverage` (`npm run test:coverage`) | The full unit/integration suite still passes, at the committed coverage floor | vitest exits 0 (all tests pass, coverage thresholds met) |
| 3 | `lint` (`npm run lint`) | No type errors slipped in (belt-and-suspenders alongside build) | `tsc --noEmit` exits 0 |
| 4 | `check-hosted-drift` (`node scripts/check-hosted-drift.mjs`) | The hosted (mcp.novada.com) tool surface is still derived from core and hasn't silently drifted from `config/surfaces.json` | script exits 0 (no drift detected) |
| 5 | eval Tier-A (`eval/baseline-selector.mjs`) | Deterministic, $0 tool-selection regression floor — no NEW description collision was introduced since the recorded baseline | `gate_pass: true` in its JSON output |
| 6 | eval Tier-B (`eval/model-eval-runner.mjs`) | A REAL model's first-try tool selection still clears the accuracy floor and no sibling tool's routing regressed | `gate_pass: true` in its JSON output (SKIPPED without `ANTHROPIC_API_KEY`) |
| 7 | live-smoke (`scripts/acceptance/live-smoke.mjs`) | The wire format for all 15 platform-scraper tools actually returns data from the LIVE Novada Scraper API — not just a mock | all 15 platforms accepted (SKIPPED without `NOVADA_SCRAPER_KEY`) |

Notes:

- The platform-scraper ↔ catalog cross-check (no dead/typo'd `scraper_id` ever reaches a
  customer) is a `npm test` suite already — `tests/tools/platform-scraper-catalog.test.ts`
  — so it's covered by gate 2 and is not re-run separately here.
- Gates 1-5 are the "static net": zero third-party API cost, zero external credentials,
  safe to run on every commit including forks with no secrets configured.
- Gates 6-7 are the "keyed net": real, billed calls to a third-party (Anthropic) or the
  live Novada Scraper API. They are opt-in by design (SKIP, never FAIL, when the key is
  absent) — but a release should not ship without having run them at least once against
  the code being shipped.

## When you ADD or CHANGE tools — extra checks

The gates above catch regressions to *existing* tools automatically. Adding or changing
a tool needs a few manual touches on top — checklist:

- [ ] Bump the `novada_discover` tool-count guard (and any other test asserting an exact
      tool count) to match the new total.
- [ ] Update the README and SKILL.md tool counts (they are prose, not generated — no
      automated gate catches a stale count).
- [ ] Regenerate the collision baseline (`tests/tools/collision-matrix.test.ts`'s
      committed fixture) if the new/changed tool's description meaningfully overlaps an
      existing one.
- [ ] Add an eval task (a new `T-<id>` entry in `eval/eval-tasks.json`) so Tier-A and
      Tier-B actually exercise the new tool's selection — an untested tool contributes
      zero signal to gates 5/6 even though it's live.
- [ ] Add the new platform to live-smoke's coverage — for the platform-scraper family
      (`novada_scrape_<platform>`) this is automatic (`live-smoke.mjs` iterates
      `PLATFORM_SCRAPER_TOOLS` and derives params from the catalog directly, so a 16th
      platform is covered with zero code change); for any OTHER new tool family, add an
      equivalent one-call-per-tool smoke case.
- [ ] No action needed for the catalog-cross-check guard
      (`tests/tools/platform-scraper-catalog.test.ts`) — it already covers any new
      platform-scraper config generically via `PLATFORM_SCRAPER_TOOLS`, with no
      per-platform code to add.

## What green means

Every non-skipped gate PASS = "works + no new problem introduced = confident to ship
(pending the keyed gates if they were skipped)." A SKIPPED gate is not a green light on
its own — it means that dimension simply wasn't checked in this run. Ship with skipped
gates only when you have a recent keyed run's report to point to for the same code.

## Report naming

```
reports/<YYYY-MM-DD>-<feature>/<YYYY-MM-DD>-<feature>-release-acceptance.md
```

Same convention as every other dated deliverable in this repo's `reports/` directory
(repo root, not `npm-package/reports/`) — one folder per feature/date, one file per
artifact.
