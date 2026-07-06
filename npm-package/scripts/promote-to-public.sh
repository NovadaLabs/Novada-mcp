#!/usr/bin/env bash
#
# promote-to-public.sh — deliberate, gated promotion of `staging` → public.
#
#   local fix branches (review) ─▶ staging (test repo = latest) ─▶ PUBLIC (customers)
#
# SAFE BY DEFAULT. Running it with no args does a read-only PREVIEW.
# Nothing irreversible (public push, npm publish) happens without BOTH:
#   1. --execute --version X.Y.Z
#   2. every release gate answered "yes"
#   3. typing the word PROMOTE at the final prompt
#
# This mirrors the REDLINE: confidence ≠ permission. The script prepares and
# verifies everything, then makes YOU sign off on the irreversible step.
#
# Usage:
#   scripts/promote-to-public.sh                      # preview (default, safe)
#   scripts/promote-to-public.sh --execute --version 0.9.2
#   scripts/promote-to-public.sh --execute --version 0.9.2 --skip-publish  # push repo only, no npm
#
set -euo pipefail

# ---- config -----------------------------------------------------------------
STAGING="staging"
RELEASE_BRANCH="main"
PUBLIC_REMOTE="origin"      # NovadaLabs/novada-mcp (PUBLIC — customers)
TEST_REMOTE="test"          # NovadaLabs/test-novada-mcp-test (internal)
BASELINE_FAILURES=37        # known pre-existing test failures on staging/main (infra/mock)
PKG_NAME="novada-mcp"

EXECUTE=0
NEW_VERSION=""
SKIP_PUBLISH=0

# ---- args -------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --execute) EXECUTE=1 ;;
    --check) : ;;   # explicit preview (same as no args — default is safe preview)
    --version) NEW_VERSION="${2:-}"; shift ;;
    --skip-publish) SKIP_PUBLISH=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
say() { printf '%s\n' "$*"; }
hr()  { printf '%s\n' "────────────────────────────────────────────────────────────"; }
die() { printf '%s\n' "${c_red}✗ $*${c_off}" >&2; exit 1; }

# ---- preconditions ----------------------------------------------------------
[ -f package.json ] || die "run from the repo root (no package.json here)."
[ "$(node -p "require('./package.json').name")" = "$PKG_NAME" ] || die "this is not the $PKG_NAME repo."
git rev-parse --verify "$STAGING" >/dev/null 2>&1 || die "no local '$STAGING' branch."
git remote get-url "$PUBLIC_REMOTE" >/dev/null 2>&1 || die "no '$PUBLIC_REMOTE' remote."

say "${c_dim}fetching $PUBLIC_REMOTE + $TEST_REMOTE...${c_off}"
git fetch -q "$PUBLIC_REMOTE" 2>/dev/null || say "${c_yel}⚠ could not fetch $PUBLIC_REMOTE${c_off}"
git fetch -q "$TEST_REMOTE"   2>/dev/null || true

CUR_VERSION="$(node -p "require('./package.json').version")"

# ---- what would ship --------------------------------------------------------
hr
say "  ${c_grn}Promote $STAGING → $PUBLIC_REMOTE/$RELEASE_BRANCH${c_off}   (current npm version: $CUR_VERSION)"
hr
say "Commits on $STAGING not yet on $PUBLIC_REMOTE/$RELEASE_BRANCH:"
git log --oneline "$PUBLIC_REMOTE/$RELEASE_BRANCH..$STAGING" 2>/dev/null | sed 's/^/  /' || say "  (cannot compute — fetch failed)"
say ""
say "Files that differ:"
git diff --stat "$PUBLIC_REMOTE/$RELEASE_BRANCH..$STAGING" 2>/dev/null | sed 's/^/  /' | tail -30 || true

# ---- the release gates ------------------------------------------------------
hr
say "  RELEASE GATES — all must be cleared before customers get this"
hr
GATES=(
  "🔴 The 4 leaked credentials were ROTATED on the Novada dashboard (git history is permanent)"
  "🏛️  monitor stable-hash architecture decided (structured content hash) — or monitor consciously shipped as-is"
  "🏛️  bot-challenge detection architecture decided (structured signals) — or consciously shipped as-is"
  "✅ The team CONFIRMED staging works on the internal test repo (zoey / neo signed off)"
)

if [ "$EXECUTE" -eq 0 ]; then
  for g in "${GATES[@]}"; do say "  [ ] $g"; done
  hr
  say "${c_yel}PREVIEW only — nothing changed.${c_off}"
  say "When every gate is a yes, run:"
  say "  ${c_grn}scripts/promote-to-public.sh --execute --version <X.Y.Z>${c_off}"
  exit 0
fi

# ===== EXECUTE PATH ==========================================================
[ -n "$NEW_VERSION" ] || die "--execute requires --version X.Y.Z"
echo "$NEW_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$' || die "bad version: $NEW_VERSION"
# The real guard: npm versions are IMMUTABLE — refuse to target one already published
# (0.9.1 taught us this; staging may legitimately already carry the target version).
if npm view "$PKG_NAME@$NEW_VERSION" version >/dev/null 2>&1; then
  die "$PKG_NAME@$NEW_VERSION is already published on npm — pick a higher version."
fi
[ -z "$(git status --porcelain)" ] || die "working tree not clean — commit/stash first."

say ""
for g in "${GATES[@]}"; do
  printf '%s\n  type "yes" to confirm: ' "$g"
  read -r ans; [ "$ans" = "yes" ] || die "gate not cleared — aborting. (You answered: '${ans}')"
done

# ---- verify staging in an isolated worktree (non-disruptive) ----------------
VERIFY_WT="$(git rev-parse --show-toplevel)/.promote-verify"
rm -rf "$VERIFY_WT"; git worktree remove --force "$VERIFY_WT" 2>/dev/null || true
say "${c_dim}verifying $STAGING in a temp worktree...${c_off}"
git worktree add -q "$VERIFY_WT" "$STAGING"
cleanup() { git worktree remove --force "$VERIFY_WT" 2>/dev/null || true; }
trap cleanup EXIT
(
  cd "$VERIFY_WT"
  npm ci  >/tmp/promote-ci.log   2>&1 || die "npm ci failed (see /tmp/promote-ci.log)"
  npm run build >/tmp/promote-build.log 2>&1 || die "build failed (see /tmp/promote-build.log)"
  set +e; npx vitest run >/tmp/promote-test.log 2>&1; set -e
  fails="$(grep -Eo 'Tests +[0-9]+ failed' /tmp/promote-test.log | grep -Eo '[0-9]+' | head -1)"; fails="${fails:-0}"
  if [ "$fails" -gt "$BASELINE_FAILURES" ]; then
    die "test failures ($fails) exceed known baseline ($BASELINE_FAILURES) — a regression. See /tmp/promote-test.log"
  fi
  say "${c_grn}✓ build clean · tests: $fails failed (baseline $BASELINE_FAILURES, no new regressions)${c_off}"
)

# ---- finalize the release on staging (version + changelog + generated HTML) -
git checkout -q "$STAGING"
RELEASE_DATE="$(date +%Y-%m-%d)"

# 1. package.json + server.json version == target (idempotent)
STAGE_VERSION="$(node -p "require('./package.json').version")"
if [ "$STAGE_VERSION" != "$NEW_VERSION" ]; then
  say "${c_dim}bumping $STAGE_VERSION → $NEW_VERSION on $STAGING...${c_off}"
  node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.version='$NEW_VERSION';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
  [ -f server.json ] && node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('server.json'));if(s.version)s.version='$NEW_VERSION';if(Array.isArray(s.packages))s.packages.forEach(x=>{if(x.version)x.version='$NEW_VERSION'});fs.writeFileSync('server.json',JSON.stringify(s,null,2)+'\n')" || true
fi

# 2. CHANGELOG: promote [Unreleased] → [$NEW_VERSION]; else prepend a stub if this version is missing
if [ -f CHANGELOG.md ]; then
  if grep -qE '^##[[:space:]]+\[Unreleased\]' CHANGELOG.md; then
    node -e "const fs=require('fs');let c=fs.readFileSync('CHANGELOG.md','utf8');c=c.replace(/^##[ \t]+\[Unreleased\][^\n]*/m,'## [$NEW_VERSION] — $RELEASE_DATE');fs.writeFileSync('CHANGELOG.md',c)"
    say "${c_grn}✓ CHANGELOG [Unreleased] → [$NEW_VERSION]${c_off}"
  elif ! grep -qE "^##[[:space:]]+\[$NEW_VERSION\]" CHANGELOG.md; then
    { printf '## [%s] — %s\n\n- Promoted from staging. See NOV-680 / NOV-684 for the change set.\n\n' "$NEW_VERSION" "$RELEASE_DATE"; cat CHANGELOG.md; } > CHANGELOG.tmp && mv CHANGELOG.tmp CHANGELOG.md
  fi
fi

# 3. regenerate the public HTML changelog FROM CHANGELOG.md (never hand-edited)
[ -f scripts/gen-update-log.mjs ] && { node scripts/gen-update-log.mjs >/dev/null 2>&1 && say "${c_grn}✓ docs/update-log.html regenerated${c_off}" || say "${c_yel}⚠ gen-update-log failed (non-fatal)${c_off}"; }

# 4. commit whatever changed on staging (idempotent — no-op if already finalized)
git add package.json server.json CHANGELOG.md docs/update-log.html 2>/dev/null || true
if git diff --cached --quiet; then
  say "${c_grn}✓ $STAGING already finalized at $NEW_VERSION — nothing to commit${c_off}"
else
  git commit -q -m "chore: release $NEW_VERSION (version + changelog + regenerated update-log)" && say "${c_grn}✓ release $NEW_VERSION committed on $STAGING${c_off}"
fi

# ---- merge staging → main (local) -------------------------------------------
git checkout -q "$RELEASE_BRANCH"
git merge --no-edit "$STAGING" >/dev/null 2>&1 || die "merge $STAGING → $RELEASE_BRANCH conflicted — resolve manually."
say "${c_grn}✓ $STAGING merged into local $RELEASE_BRANCH${c_off}"

# ---- FINAL REDLINE CONFIRMATION --------------------------------------------
hr
say "  ${c_red}IRREVERSIBLE — about to publish to customers${c_off}"
hr
say "  • git push $PUBLIC_REMOTE $RELEASE_BRANCH   (PUBLIC repo)"
say "  • git tag v$NEW_VERSION && push tag"
[ "$SKIP_PUBLISH" -eq 0 ] && say "  • npm publish   (version $NEW_VERSION → customers)" || say "  • ${c_yel}npm publish SKIPPED (--skip-publish)${c_off}"
say ""
printf 'Type %sPROMOTE%s to execute, anything else to stop here: ' "$c_red" "$c_off"
read -r confirm
if [ "$confirm" != "PROMOTE" ]; then
  hr
  say "${c_yel}STOPPED before the irreversible step. Local $RELEASE_BRANCH is ready.${c_off}"
  say "To finish manually when ready:"
  say "  git push $PUBLIC_REMOTE $RELEASE_BRANCH"
  say "  git tag v$NEW_VERSION && git push $PUBLIC_REMOTE v$NEW_VERSION"
  [ "$SKIP_PUBLISH" -eq 0 ] && say "  npm publish"
  exit 0
fi

git push "$PUBLIC_REMOTE" "$RELEASE_BRANCH"
git tag "v$NEW_VERSION" && git push "$PUBLIC_REMOTE" "v$NEW_VERSION"
if [ "$SKIP_PUBLISH" -eq 0 ]; then
  ( cd "$VERIFY_WT" && npm publish )
fi
hr
say "${c_grn}✓ Promoted $NEW_VERSION to $PUBLIC_REMOTE${c_off}"
[ "$SKIP_PUBLISH" -eq 0 ] && say "${c_grn}✓ npm publish $NEW_VERSION done${c_off}"
say "Remember to move the test repo's main forward and file the release note."
