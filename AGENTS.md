# AGENTS.md — how to record an update & ship (read before you change anything)

This file is for **every agent and teammate** working on `novada-mcp`. It defines the ONE
correct way to log an update and to release. Follow it — don't invent a second convention.

## The update log — single source of truth

- **`CHANGELOG.md` is the only place you write.** Add your entry under `## [Unreleased]`
  (create that section if missing), using Keep-a-Changelog style (`### Fixed`, `### Added`, `- item`).
- **`docs/update-log.html` is AUTO-GENERATED — never hand-edit it.** It is produced from
  `CHANGELOG.md` by `scripts/gen-update-log.mjs`. Any manual edit is overwritten on the next run.
  - Regenerate locally: `node scripts/gen-update-log.mjs`
  - At release, `scripts/promote-to-public.sh` regenerates it for you.
- **Team progress + health lives in Linear, not in files.** Post a project update (with health:
  on track / at risk / off track) on the Linear project **"MCP — Hosted + Tools + Optimization"**.
  That is the trackable, notify-everyone surface. GitHub has no "health" concept — don't try to put it there.

So, to record an update: **edit `CHANGELOG.md` → run the gen script (or let the promote script do it) → post a Linear update.** That's it. No hand-written HTML, ever.

## Branch & release model

```
local  fix/* branches (build + review, stay local)
   │  merge reviewed work →
staging  ← the LATEST internal version; the team tests THIS on the test repo
   │  promote-to-public.sh --execute (gated) →
public  npm + public git + hosted   ← customers
```

- The internal **test repo** (`NovadaLabs/test-novada-mcp-test`) holds only **`main` + `staging`**.
  The auto-mirror git hook mirrors ONLY those two branches — keep `fix/*` branches local.
- **Never hand-bump a single platform's version.** One release = one version pushed to npm +
  public git + hosted together, via `scripts/promote-to-public.sh`. Ad-hoc bumps cause desync.

## Versioning

- **npm versions are immutable.** `0.9.1` is already published — the next release is **`0.9.2`**
  (not a re-publish of 0.9.1). Check `npm view novada-mcp version` before choosing a number.
- `package.json`, `server.json` (`.version` + `packages[].version`) must all match the release version.
  The promote script keeps them in sync; don't set them by hand across platforms.

## Releasing (the gated flow)

`scripts/promote-to-public.sh` — safe **dry-run by default**. Preview: run with no args.
To ship: `scripts/promote-to-public.sh --execute --version X.Y.Z`, which requires every release
gate answered `yes` **and** typing `PROMOTE` before any push/publish. Gates:
1. Leaked credentials rotated on the Novada dashboard (git history is permanent).
2. `monitor` + bot-challenge-detection architecture decisions made (or consciously shipped as preview).
3. Human merge-review of the change set.

Nothing reaches customers automatically. The redline: no public push / npm publish / version bump
without explicit human approval.
