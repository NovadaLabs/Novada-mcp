# distribution/ — the novada-mcp channel registry

novada-mcp ships to several distribution channels: the official MCP Registry, Claude Code's
plugin + marketplace system, Smithery, Glama, Gemini CLI, Antigravity, and OpenAI Codex
(the last three added 2026-10-15, brief-A2). Each channel reads its own manifest file, and every
one of those manifests used to be hand-maintained — which is exactly how they drifted
(`plugin.json` said version `"0.1.0"` and "scrape `<N>` platforms" while `package.json` was
`0.9.41` with a different, real platform count — see `distribution/research/channel-facts.md` for
the exact historical numbers and dates; that file is excluded from the check below for exactly
this reason, so quoting its old values here can never itself go stale against today's build).

**brief-F (2026-10-15)** closed a second wave of findings from three independent reviews of the
brief-A2 build — the hosted endpoint URL was hand-written in 4 places with nothing ever
comparing it to `listing.json` (tampering passed every check), a channel's own field *shape*
(not just its value) went unverified, `ci.yml`'s `paths:` filter silently excluded a whole
channel's manifest from CI, `secret_literal` missed non-`Authorization` auth-shaped keys and
URL-embedded query-string secrets, and — the CLASS-level one — nothing outside this registry's
own rows ever checked whether README/landing PROSE stated a tool/platform/scraper count that
matches the built registry, the exact mechanism that let `plugin.json`'s original "scrape 13
platforms" bug happen in the first place. See "The checks" below for what each new guard does.

This directory fixes the class of bug, not the instance: **channels are rows in a table, never
branches in code.** Adding a channel means adding a row to `channels.json`; it never means
writing an `if (channel === "...")`.

## Files

| File | Purpose |
|---|---|
| `listing.json` | The one canonical set of cross-channel facts (name, description, homepage, repository, support contact, keywords, hosted endpoint). **The description has no hardcoded tool/platform count on purpose** — that's the single biggest structural fix here: a count that's never written can't go stale. |
| `channels.json` | The channel registry. `version_source` names the single source of truth for the version (`npm-package/package.json#/version`). `manifest_patterns` lists every manifest filename/glob this registry knows about, including channels that don't exist yet (Gemini, Codex...). `known_orphans` documents manifest-pattern files that exist but aren't owned by a row. `rows[]` is one entry per channel — see the `$comment` block at the top of the file for exact field semantics. |
| `generate.mjs` | Regenerates every row's **owned fields only** from `listing.json` + `package.json`'s version. `--check` reports drift without writing. Table-driven: the only per-format logic is the two-entry `WRITERS` lookup (`json-owned-fields`, `yaml-owned-fields`); there is no per-channel branch anywhere in this file. Also regenerates `INSTALL.md`. |
| `check.mjs` | The drift gate — 12 checks (5 from round 1 + 4 added brief-F + 2 added brief-I + 1 added brief-K, 2026-10-15), never short-circuits, prints every failure with the file, rule, and a fix hint. Exit 0 = clean, exit 1 = at least one failure. Also prints three reviewer-visible, ALWAYS-shown (pass-or-fail, never gating) summaries after every run: every currently-valid `claims-ignore` marker (brief-I I4), every `claim_excludes` entry's matched-file count (brief-K K4), and every `pinned-hashes.json` entry that changed since `git merge-base HEAD origin/main` (brief-K K1) — see "Reviewer-visible summaries" below. |
| `test/*.test.mjs` | `node:test` coverage: a green fixture (all 5 checks pass) plus at least one red fixture per check, each paired with a mutation-probe assertion (see "Mutation probe" below). Fixtures live under `os.tmpdir()`; nothing here ever touches the real worktree. `test/check-cli.test.mjs` (2026-10-15, brief-A2) additionally spawns `check.mjs` as a real child process through a deliberately-created symlink, proving its CLI entry point still runs — and never silently no-ops — when invoked through a symlinked path (see "CLI entry-point robustness" below). |
| `INSTALL.md` | GENERATED — one install snippet per row, taken verbatim from `channels.json`'s `install_snippet`. Do not hand-edit; `generate.mjs` owns it the same way it owns manifest fields. |

## The 12 checks (`check.mjs`)

1. **version_equal** — every row's `version_field` (where non-null) equals `package.json`'s version.
2. **generated_clean** — `generate.mjs --check` reports zero diffs; a hand-edit of an owned field fails this.
3. **no_orphans** — every file in the repo matching a `manifest_patterns` glob is claimed by exactly
   one row's `path`, or listed in `known_orphans` with a reason.
4. **location_rules** — every row's file(s) exist where `channels.json` says they must.
5. **legibility** — name equals `listing.name` (or a documented `name_override`); description length
   is within the row's `description_max_len`; no hand-typed
   `/\b\d+\+?\s*(tools|platforms|engines)\b/i` count in `name_field`/`description_field`
   unless the row marks it `description_derived`; every row's file(s) parse (JSON.parse, or a
   line-level YAML sanity check for `.yaml` — no dependency either way); **(added 2026-10-15,
   brief-A2) no manifest file contains a literal secret** — an auth/token-shaped KEY carrying a
   literal (non-`${VAR}`) value, or a key/token-shaped literal VALUE anywhere in the file
   (Stripe-, GitHub-, Slack-, Google-, AWS-style prefixes). This is a WHOLE-FILE scan, unlike the
   hand-typed-count rule above, because a secret can hide in a field no row's
   `version_field`/`name_field`/`description_field` pointer ever reaches (e.g. an
   `mcp_config.json`'s `headers.Authorization`). `${VAR}` templates are always allowed — they
   resolve on the user's own machine and never ship a real secret in this repo. Deliberately
   scoped to known key FORMATS, not a generic high-entropy/long-string scan, so it never
   false-positives on this registry's own legitimate 40-hex-char git commit SHAs (e.g.
   `marketplace.json`'s pinned `source.sha`). **(extended 2026-10-15, brief-F R4)** the
   auth/token-shaped-KEY rule now also matches `x-api-key` and any key CONTAINING `token`
   (`access_token`, `refresh_token`, `apiToken`, ...) — not just a field literally named/ending
   `Authorization` — and, independently of field name, any string value anywhere in the file is
   also scanned for a literal API key/token sitting in a URL's own query string
   (`?apikey=...`/`api_key=...`/`token=...`). Deliberately NOT a generic `api[-_]?key`
   key-name pattern: that broader shape also matched `hosted-server/smithery.yaml`'s
   `configSchema.properties.apiKey` — a JSON-SCHEMA PROPERTY NAME with a documentation
   placeholder value (`"your-api-key-here"`), not a live header/token — discovered as a real
   false positive during this round's own first run and narrowed to the exact `x-api-key` header
   name instead.
6. **endpoint_equal** *(added 2026-10-15, brief-F R1)* — every row that sets `url_field` (whether
   or not it's also `owned_fields`-writable) has that pointer's value equal `listing.json`'s
   `hosted_endpoint`. Before this round the hosted MCP endpoint URL was hand-written in
   `gemini-extension.json`, Antigravity's `mcp_config.json`, OpenAI's `.mcp.json`, and
   `npm-package/server.json`'s `remotes[0].url` with nothing ever reading `listing.hosted_endpoint`
   to compare against — tampering with any of the four passed every check (5/5 PASS). The
   `mcp-registry` row sets `url_field` without adding it to `owned_fields` (gen-server-json.mjs
   remains its sole writer, per this round's invariant), so this check still catches drift there
   without `generate.mjs` ever writing into a file it doesn't own.
7. **field_shape** *(added 2026-10-15, brief-F R3)* — a row's `required_fields` object maps an
   exact JSON pointer to `{must:"exist"}`, `{must:"not_exist"}`, or `{must:"equal", value:<literal>}`,
   enforced for every row that sets it. This is how a channel-specific field-NAME typo is now
   caught (e.g. hand-editing Antigravity's `mcp_config.json` from `serverUrl` to `url` previously
   produced 0 failures — no check inspected `mcpServers.*`'s internal key shape at all; it now
   produces 4: `endpoint_equal` can no longer read the relocated field, `generated_clean` sees the
   now-missing owned field as drift, and `field_shape` reports both the missing `serverUrl` and
   the stray `url`) and a wrong literal (OpenAI's `.mcp.json` `type` must be `"http"`).
8. **closed_shape** *(added 2026-10-15, brief-I I1 CRITICAL)* — a row's `closed_shape` maps an
   object path (`""` = the file's top level; `"/x/*"` = every element of the JSON array at `/x`;
   a bare YAML key = its own direct children, one level deep) to an EXACT allowlist of permitted
   keys there, and `pinned_fields` maps one pointer/`yaml.path` to its exact required literal
   value. Before this round, every manifest's shape was verified only by an ALLOWLIST of
   individual field pointers (`version_field`/`name_field`/`description_field`/`required_fields`)
   — a sibling key no pointer ever named (a second `mcpServers.<rogue>` entry with its own
   `command`, a tampered `smithery.yaml` `commandFunction`, an extra `server.json` top-level
   field) round-tripped through `generated_clean`'s partial field-write untouched and passed
   every check. Closed with TWO mechanisms, declared per row (see `shape_declared` below): a
   `writer_kind: "json-full"` row (see `generate.mjs`'s own comment) has its ENTIRE file rebuilt
   from `full_template` every run, so `generated_clean`'s exact-text diff catches ANY extra/
   missing key; a `closed_shape` row (the 4 genuinely hand-authored manifests — `server.json`,
   `marketplace.json`, `smithery.yaml`, `glama.json`) is checked here instead.
   **(extended 2026-10-15, brief-K K1 CRITICAL)** two more pin mechanisms, alongside
   `pinned_fields`'s literal-value pins: `pinned_fields_template` maps a pointer to a string that
   may embed one or more `{{token}}` placeholders (resolved dynamically against `listing.json` +
   `package.json`'s version via `generate.mjs`'s `resolveTemplateString`) — an exact-equality
   check against a value DERIVED at check time, not a hand-duplicated literal that could itself
   drift; `pinned_fields_format` maps a pointer to a regular expression — a FORMAT pin for a field
   whose exact value legitimately changes release-over-release (a git commit sha) but whose shape
   never should. `claude-code-marketplace`'s `plugins[0].source.url`/`.sha` previously had no pin
   of either kind — a diff that swapped the URL to a fork (or corrupted the sha's hex format) AND
   re-ran `--repin` (updating `tamper_evident`'s own baseline to accept the tamper) passed every
   check. Both new pins are evaluated dynamically at check time, independent of whatever
   `pinned-hashes.json` records, so `--repin` cannot launder either attack the way it could before.
9. **shape_declared** *(added 2026-10-15, brief-I I1)* — a meta-check over `channels.json`
   itself: fails any row declaring NEITHER `writer_kind: "json-full"` NOR a non-empty
   `closed_shape` — so a FUTURE channel row can't silently ship with zero shape protection the
   way all 10 of today's rows did before this round.
10. **ci_paths_cover** *(added 2026-10-15, brief-F R2)* — parses `.github/workflows/ci.yml`'s own
   `paths:` filter list(s) (a small line-based extractor, no dependency) and fails if any channel
   row's path isn't matched by EVERY `paths:` block found. Before this round, `gemini-extension.json`
   (a repo-ROOT file) was outside every glob in that filter — a PR touching only that file never
   triggered CI, so this entire drift gate could be failing with nobody ever seeing it. If `ci.yml`
   drops its `paths:` filter entirely (the other brief-sanctioned fix for this class of bug), every
   row trivially passes — an unfiltered trigger already covers every path by definition.
11. **claims_consistent** *(added 2026-10-15, brief-F R10 — CLASS fix; extended brief-I I2/I3/I4)*
   — see "Claim consistency (claims_consistent)" below; this is the only check that reads prose
   outside `channels.json`'s own rows.
12. **json_no_duplicate_keys** *(added 2026-10-15, brief-K K2 HIGH)* — `JSON.parse` silently
   keeps only the LAST-declared value of a key repeated within the same object; every check above
   that reads a JSON manifest (`closed_shape`, `pinned_fields`/`pinned_fields_template`/
   `pinned_fields_format`, `generated_clean`, even `tamper_evident`'s own hash — all of which call
   `JSON.parse`) is structurally blind to an EARLIER occurrence of a repeated key, which simply
   isn't in the parsed object any other check ever inspects. A small, hand-rolled, no-dependency
   recursive-descent scanner (`findDuplicateJsonKeys`) walks the raw TEXT once — never building a
   JS value at all — tracking, per object scope (reset on each nested `{...}`), which keys have
   already been seen at that exact nesting level; the same key appearing twice across SIBLING
   objects (e.g. two different array elements each declaring `"name"`) is normal and not flagged.
   Runs on every row declaring `writer_kind: "json-full"` or a non-empty `closed_shape` (every
   JSON manifest this registry currently verifies the shape of); YAML files are out of scope here
   (`legibility`'s own `yamlLooksValid` already flags a duplicate TOP-LEVEL YAML key).

## Claim consistency (`claims_consistent`, brief-F R10)

Every check above reads only `channels.json`'s own rows' manifest FILES. Nothing read README/docs/
landing PROSE — which is exactly where the original class of bug (a hand-typed platform/tool count
going stale) keeps recurring even after R7 fixes its two concrete 2026-10-15 instances, because
nothing stops the *next* one. `claims_consistent` is the generic gate for that:

- **`facts`** are computed from the BUILT registry, never hand-typed: `tools` (`npm-package/build/
  core.js`'s `TOOLS.length`), `hosted_tools` (`tools` minus `hosted-server/vercel/api/mcp.ts`'s
  `HOSTED_HIDDEN` set size — parsed TEXTUALLY out of that `.ts` source's own `new Set([...])`
  literal, not imported, so this check never needs a second build pipeline wired in just to read
  one constant), `platforms` (`build/data/scraper_catalog.js`'s `WORKING_PLATFORM_NAMES.length`),
  and `scrapers` (count of `TOOLS` entries named `novada_scrape_<platform>`).
- **Scope (brief-J J3, 2026-10-15 — opt-OUT, not opt-in):** the check scans every file
  `git ls-files` reports as TRACKED under `*.md`/`*.html`/`*.txt` (any depth) MINUS
  `channels.json`'s `claim_excludes` list (`{glob, reason}`, reason mandatory — see
  `channels.json`'s own `$comment` for every current exclude and why). **This means an
  UNTRACKED file (one that exists on disk but hasn't been `git add`ed yet) is invisible to this
  check** — `listTrackedProseFiles`'s only fallback to a plain directory walk is for a
  synthetic, non-git test fixture (this suite's own `fixtures.mjs`), never silently masking a
  real "not yet tracked" gap in an actual checkout. **Run `git add` (or commit) a new/edited
  prose file before trusting a local `node distribution/check.mjs` run to have scanned it** — CI
  always runs against a freshly checked-out (fully tracked) commit, so this gap only bites a
  local, uncommitted working tree.
- **`channels.json`'s `claim_surfaces`** no longer gates WHICH files are scanned at all (that
  opt-in model was J3's own named bug — see `channels.json`'s `$comment` for the concrete
  previously-invisible instances it caused). It keeps its `fact_overrides` role: an entry may be a
  bare glob string (no override — every claims noun checks its plain fact) or a `{glob,
  fact_overrides, reason}` object naming a DIFFERENT fact key a given surface must be checked
  against instead (e.g. `hosted-server/landing`'s **three separate**
  `**/*.html` / `*.txt` / `*.md` entries — not one combined brace-glob, since
  `distribution/check.mjs`'s own glob matcher has no brace-expansion support).
- **`channels.json`'s `claims`** maps each narrow noun this project actually uses to the fact key
  it must equal: `tools`/`platforms`/`(per-platform )?scrapers` (ASCII) and, since brief-I
  (2026-10-15, I2), their CJK counterparts `工具`/`平台`/`爬虫` (each carrying a `unit: "个"` —
  see "Claim consistency" below for the CJK match shape). Nouns are deliberately narrow so this
  never matches unrelated prose like "195 countries" or "100M+ IPs".
- The check scans every claim-surface file for a literal `"<N>(+)? <noun>"` occurrence — ASCII,
  with up to 2 intervening words from a small, verified-safe adjective list allowed between the
  number and the noun (brief-I I3: `supported|working|MCP|data`; see `check.mjs`'s own comment
  for which words were deliberately EXCLUDED after grepping the real repo, and why) — or, for a
  CJK claim, `"<digits>个<=6 chars, lazy><noun>"` (brief-I I2) — and fails any line where `N`
  doesn't equal that noun's fact — UNLESS the same line also carries a JUSTIFIED opt-out marker,
  exactly `claims-ignore: <reason>` with a reason of at least 10 characters (brief-I I4: a bare
  marker no longer suppresses anything and is itself reported as a failure), for historical/
  changelog prose or a line whose number legitimately denotes a different metric that happens to
  share this project's noun. `check.mjs`'s CLI also prints every currently-valid marker's
  file:line and reason as a summary line, independent of pass/fail.
- Matches below a per-fact noise floor (`FACT_CLAIM_FLOOR`, default 10) are skipped outright: every
  real WHOLE-CATALOG fact (`tools`/`hosted_tools`/`platforms`/`scrapers`) is `>=14`, and
  single-digit occurrences discovered in the real repo during this round are structurally
  per-category/delta/UI-counter text (`hosted-server/landing/configure.html`'s JS-updated "1
  tool"/"0 tools" counter seed text; `docs/TOOLS.md`'s "9 tools" describing the `HOSTED_HIDDEN`
  delta, 37 minus 28), not whole-catalog claims. **NOT every fact has that property** (round 2,
  2026-10-19): `dify_tools` (D3's `distribution/dify/README.md` override) is correctly,
  permanently single-digit (7) — it carries its own floor of 0 in `FACT_CLAIM_FLOOR`, so it is
  always compared, never silently skipped the way a single global constant used to skip it
  regardless of which fact a line's claim actually resolved to.
- **Per-surface fact scope (brief-H, 2026-10-15): `claim_surfaces` entries may override a fact
  per surface.** An entry may be a bare glob string (checked against every claims noun's plain
  fact, as before — every pre-brief-H entry still works verbatim) OR a `{glob, fact_overrides,
  reason}` object, where `fact_overrides` maps one claims fact key (e.g. `tools`) to a DIFFERENT
  fact key this surface must be checked against instead (e.g. `hosted_tools`) — fact scope is a
  property of the SURFACE, not a single global constant. The real `hosted-server/landing/**/*.html`
  / `*.txt` / `*.md` entries (three separate list entries, not one brace-glob — see "The checks"
  above) now each carry `{tools: "hosted_tools"}`: those pages legitimately describe
  the 28-tool HOSTED subset, not the 37-tool local-package total, using the same word "tools"
  `README.md` uses for the total. An override naming a fact key `computeFacts()` doesn't produce
  is a loud, thrown config error (`checkClaimsConsistent` validates every `fact_overrides` entry
  against the computed `facts` object BEFORE scanning a single file) — never a silent pass, so a
  typo here can't quietly disable this check for a whole surface.
- **Known limitation, discovered applying the override above: per-SURFACE scope is still coarser
  than per-LINE intent.** `hosted-server/landing/llms.txt` legitimately states BOTH the 28-tool
  HOSTED count (correctly scoped by the override) AND, in two separate sentences, the 37-tool
  LOCAL/self-host total ("...are available locally" / "Local (`npx novada-mcp`) = all 37 tools
  including Playwright flows...") — same file, same bare noun, two different intended metrics.
  The override necessarily checks every "tools" occurrence on that surface against
  `hosted_tools`, so those 2 self-host lines are now flagged `claims_consistent` failures even
  though their stated number (37) is itself correct for what they describe. Resolving this
  cleanly needs either a `claims-ignore` marker on those 2 lines (a content edit) or a future
  per-LINE/per-phrase override granularity — both out of brief-H's edit budget (distribution/**
  and one docs/TOOLS.md marker only); flagged here rather than silently narrowed or guessed at.
  These 2 lines are EXPECTED to be red until a human resolves them, same category as the next
  bullet.
- **Known limitation (narrowed by brief-I I3, 2026-10-15 — CLOSED for the one concrete instance
  that motivated it, open in general):** the pattern matches `"<N> <noun>"` with the noun either
  DIRECTLY adjacent to the number, or separated by up to `MAX_CLAIM_ADJACENT_WORDS` (2) words from
  a small, deliberately narrow allowed-adjacent-word list (`CLAIM_ADJACENT_WORDS` in `check.mjs`:
  `supported`/`working`/`MCP`/`data`). That list was widened specifically to catch
  `docs/TOOLS.md`'s then-stale "`<N>` **supported** platforms" instance (now fixed and marker-
  justified there, see its own `claims-ignore` comment) — it is no longer an example of something
  this check misses. A phrase using a DIFFERENT intervening word OUTSIDE that list (e.g. "`<N>`
  typed platforms", "`<N>` dedicated platforms") is still not caught by design: widening the list
  further risks new false positives elsewhere (`check.mjs`'s own comment on
  `CLAIM_ADJACENT_WORDS` names exactly which additional words were tried and excluded, and why,
  against the real repo as it stood then). This is a reviewed, intentionally narrow allowlist, not
  an oversight — flagged here for a future round rather than widened without that same grep-first
  verification.
- **Expected to be red right now (owner positioning decision pending, brief-H 2026-10-15):**
  `hosted-server/landing/tools.html` hand-states a stale "26 tools" <!-- claims-ignore: quoting tools.html's own deliberately-left-stale hosted-tool count, not a claim about this README's facts -->
  and the Scraper API's own, much larger, unrelated "129 platforms" count in several places, <!-- claims-ignore: quoting tools.html's own deliberately-left-stale, unrelated Scraper-API count, not a claim about this README's facts -->
  and is deliberately left
  unedited by brief-H (owner positioning decision pending) — its failures must stay red and
  visible, never silently reworded or marker-suppressed by an agent. See the `llms.txt` bullet
  above for a second, independently-discovered surface in the same "needs a human" category.

## Reviewer-visible summaries (brief-K, 2026-10-15; extended brief-M M4, 2026-10-15)

Four summaries print on EVERY `check.mjs` run — pass or fail, never a check in their own right,
never gating the exit code. Three are unconditional (printed even with "0" to report); the fourth
(untracked prose files) prints only when it has something to say, same "WARNING" posture as every
other loud-not-silent signal in this file. Each exists because the mechanism it reports on can be
CORRECTLY silent about something a human reviewer still needs to see:

- **`claims-ignore` markers in use** (brief-I I4) — every currently-valid suppression marker,
  file:line and reason, so a reviewer can audit every "this number is allowed to be different"
  decision in one place instead of hunting the diff.
- **`claim_excludes` match counts** (brief-K K4) — every configured exclude's glob, how many
  currently-tracked files it matches today, and its own recorded reason. An exclude that's grown
  to swallow far more than its original justification covers (or dropped to zero matches, meaning
  its justification may now be stale/no-op) is otherwise invisible — `claim_excludes` silently
  exempts whole trees from `claims_consistent` with no reviewer-visible signal of which files, or
  how many, it's actually exempting on a given run.
- **`WARNING <N> untracked prose file(s) not scanned: ...`** (brief-M M4, 2026-10-15) — this is
  THE fix for the exact mechanism that let 16 real `claims_consistent` failures in a brand-new,
  still-uncommitted `distribution/README.md`/`distribution/research/channel-facts.md` go
  completely unreported in every real local run of this gate before this round: the "Claim
  consistency" section above has always documented that an untracked file is invisible to the
  scan, but a local run had no way to know WHICH files that applied to on a given run. Lists every
  `*.md`/`*.html`/`*.txt` file `git ls-files --others --exclude-standard` reports (minus whatever
  `claim_excludes` would also exempt once tracked — warning about a file that wouldn't be scanned
  anyway is noise) — `git add` (or commit) every file named here before trusting this run's
  `claims_consistent` result. Printed only when non-empty (a clean, fully-committed checkout, which
  CI always is, prints nothing); never a git work tree at all (a synthetic test fixture) also
  prints nothing, same as `claims-ignore` markers' own git-ls-files-based scan.
- **`pinned-hashes.json` entries changed since `git merge-base HEAD origin/main`** (brief-K K1) —
  for every row `tamper_evident` hashes, compares the CURRENT pinned sha256 against whatever was
  recorded at this branch's merge-base with `origin/main` and lists every row whose hash moved
  (`(none — new pin)` for a row with no recorded baseline at the merge-base at all). This is the
  trust-model answer to "a diff that edits a hand-authored manifest AND re-runs `--repin` passes
  every check" (K1's own named attack): `pinned-hashes.json` detects UNREVIEWED drift — it cannot,
  by itself, distinguish an honest maintainer's reviewed edit from an attacker who tampered the
  content and then ran the same `--repin` command a legitimate maintainer would. This summary is
  the human-review backstop: every hand-authored manifest that changed in the current branch is
  always listed, so a reviewer sees it regardless of whether the PR's own diff happens to be
  skimmed. Never fails the build when `origin/main` is unavailable (a shallow checkout, a fork
  with no such remote, a non-git fixture) — reports the summary as skipped instead, exactly the
  same "informed, never silent" posture as the other three summaries above.

## CLI entry-point robustness (fixed 2026-10-15, brief-A2)

`check.mjs` and `generate.mjs` both guard their CLI block with an `isMain()` check (distinguishing
"this file is the literal process entry point" from "this file was `import`ed as a library by a
test"). The original version compared a raw string — `pathToFileURL(resolve(process.argv[1])).href
=== import.meta.url` — which silently returns `false` whenever the invocation path crosses a
symlink, because Node's ESM loader resolves `import.meta.url` through symlinks but leaves
`process.argv[1]` as the literal, unresolved string the caller typed. This is not an exotic edge
case: macOS resolves `/tmp` to `private/tmp` and `/var` to `private/var`, so `os.tmpdir()` (which
every fixture in this suite is built under) is *already* behind a symlink on every macOS
development machine, and a symlinked CI checkout or git worktree hits the same thing. When the
comparison silently failed, the `if (isMain())` block never ran: **nothing was printed, and the
process exited 0** — a drift gate that was supposed to fail a bad repo state instead passed it, in
total silence. Found by an independent reviewer during this round; reproduced directly (see
`test/check-cli.test.mjs`). Fixed by comparing `fs.realpathSync` on both sides in both files, with
a loud, non-zero-exit fallback (`looksLikeDirectInvocationButIsNotMain()`) if `process.argv[1]`'s
filename matches this module's own filename but the realpath-based check still disagrees — so a
future regression of this exact class fails LOUD instead of silent.

## Known scope decisions (flagged, not silent)

These are deliberate narrowings of the brief's literal wording, made during this round and
reported here so the owner can override any of them:

- **brief-A2 (2026-10-15) added 5 new rows across 3 new channels, not "3 new rows" /
  "8 total" as the brief's own `SUCCESS_WHEN` literally stated.** Gemini CLI is one row
  (`gemini-cli`), but Antigravity and OpenAI Codex each ship TWO manifest files with
  INCOMPATIBLE field schemas (a plugin manifest with name/description, and a separate MCP
  server-config file with neither) — modeled as `antigravity-plugin` + `antigravity-mcp-config`
  and `openai-codex-plugin` + `openai-codex-mcp-config`, reusing the exact
  `claude-code-plugin`/`claude-code-marketplace` precedent round 1 already established (see
  "Adding a new channel" above for why a single multi-path row would be incorrect here, not just
  stylistically different). Total: 10 rows (5 old + 5 new).
- **CLOSED brief-F, 2026-10-15 (was: "Antigravity's `mcp_config.json` using `url` instead of
  the confirmed `serverUrl` field name is currently undetected by every check").** R9 reworded
  this bullet because its prior wording was ambiguous about tense — read literally, it could be
  misread as claiming the SHIPPED `mcp_config.json` file currently uses `url` today, when the gap
  it described was hypothetical ("if you hand-edited it to `url`, nothing would catch it"); the
  file itself has always shipped the correct `serverUrl`. The gap itself is now closed: `channels.json`'s
  `antigravity-mcp-config` and `openai-codex-mcp-config` rows now carry `url_field`
  (brief-F R1, verified/owned against `listing.hosted_endpoint`) and `required_fields`
  (brief-F R3, a generic `field_shape` check — see "The 11 checks" above) — hand-editing
  `serverUrl` to `url` today produces 4 failures, not 0 (see `distribution/test/check.test.mjs`'s
  "brief-F R1/R3 ... is NOW CAUGHT" test for the exact breakdown).

- **The no-hand-typed-counts rule is checked against extracted field VALUES
  (`version_field`/`name_field`/`description_field`), not a whole-file text scan.**
  This protects a hand-authored per-tool `tools[].description` entry that legitimately states that
  TOOL's own capability count — a different thing from this round's channel-manifest metadata
  drift, which is exactly where the real bug lived (the TOP-LEVEL description field) — from a
  false positive. **(corrected brief-M, 2026-10-15 — the example below WAS this bullet's
  grounding, but R7 (see the next bullet) has since reworded it away):** as of this writing,
  `npm-package/smithery.yaml`'s own per-tool descriptions carry NO hardcoded counts at all — the
  `novada_scrape` entry that once did was reworded to name the platforms without a number at all.
  This scope decision is now purely architectural, not grounded in a currently-live counterexample
  — a FUTURE per-tool description that does state an accurate count is exactly what it protects.
  A whole-file scan would false-positive on a legitimate string like that.
- **`npm-package/smithery.yaml`'s `tools:` array stays hand-authored (this round, brief-F R7,
  fixed its two CONCRETE drift instances but did not attempt full derivation).** R7 removed the
  `novada_scrape_shein` entry (confirmed via `npm-package/build/core.js`'s `TOOLS`: no
  `novada_scrape_shein` tool is registered at runtime — zero working ops, matching
  `scripts/check-hosted-drift.mjs`'s finding) and de-counted `novada_scrape`'s own nested
  description (was "`<N>` platforms (~`<M>` operations)", stale by 2 platforms/11 operations
  against the live registry's own generated text — see `npm-package/src/core.ts`'s `novada_scrape`
  description, "Supports 14 platforms (~76 operations)" — now reworded to name the platforms
  without a hardcoded count at all, so it cannot go stale again). The array still lists only 31 of
  the 37 real tools (unchanged this round — out of R7's scope, which named exactly these two
  drift instances). Deriving the WHOLE array fully from `npm-package/build/core.js` (the same
  approach `npm-package/scripts/gen-server-json.mjs` already uses for `server.json`) was
  considered this round (the brief's R7 text explicitly invited it, "if feasible without
  changing other fields") and judged NOT feasible within this round's scope: it would rewrite
  all 30 other entries' hand-authored wording to the registry's own (differently-worded)
  descriptions, a far larger semantic change than the two concrete drift instances this round's
  review actually found, with no corresponding red-test coverage for the other 29 entries'
  content. Real, valuable future work — flagged for the owner in `report-A-build.md` and again
  here, not attempted this round.
- **`hosted-server/smithery.yaml` is a documented `known_orphans` entry, not a row.** It
  configures the HOSTED HTTP deployment (a different Smithery runtime target from the npm
  package's stdio `smithery.yaml`, this round's `smithery` row owner) and currently carries no
  name/version/description fields to drift. Whether Smithery treats these as one listing or two
  is an owner question, not something this round could verify.
- **`npm-package/.claude-plugin/marketplace.json`'s `plugins[0].source.sha` is not an owned
  field.** Regenerating it would require this script to know the commit SHA of a future release
  before that commit exists. Flagged as owner-decision future work.
- **Mutation probe mechanism:** `check.mjs`'s `runChecks(root, { skip })` parameter is what the
  test suite uses to "temporarily disable" a check (PHASE 5) — `skip` is a plain function
  argument the CLI entry point never populates from user input or an env var, so there is no
  runtime flag that could silently bypass a check in a real run. `report-A-build.md` also
  records one literal source-edit-and-restore run (disabling `legibility` directly in
  `CHECK_FNS`) as a confirmatory cross-check of the same result.

## Adding a new channel

1. Add one row to `channels.json`'s `rows[]` (copy an existing row's shape). **If the channel
   ships more than one manifest FILE and those files have DIFFERENT field schemas (one has
   name/version/description, the other doesn't — e.g. a plugin manifest plus a separate MCP
   server-config file), add ONE ROW PER FILE, not one row with `path` as an array.** This is the
   existing `claude-code-plugin`/`claude-code-marketplace` pattern, reused by
   `antigravity-plugin`/`antigravity-mcp-config` and `openai-codex-plugin`/
   `openai-codex-mcp-config` (2026-10-15, brief-A2): `check.mjs`'s `name_field`/`version_field`/
   `description_field` apply uniformly across every path in a row's `path` array, so putting two
   files with different schemas under one row makes `legibility` report a false failure against
   whichever file doesn't actually have that field. A row's `install_snippet` can point back to
   its sibling row's real command (e.g. `"# installed together with <other-row-id>..."`) instead
   of repeating it.
2. If its manifest format isn't JSON or YAML-with-a-top-level-key already, add one entry to
   `generate.mjs`'s `WRITERS` table — never an `if (row.id === ...)` branch. (All ten of this
   round's rows reuse the existing `json-owned-fields`/`yaml-owned-fields` writers — zero new
   writer kinds were needed for Gemini CLI, Antigravity, or OpenAI Codex.)
3. Add its filename/glob to `manifest_patterns` if it isn't already covered. (`.codex-plugin/
   plugin.json`, `mcp_config.json`, and `gemini-extension.json` were already anticipated in
   round 1's `manifest_patterns`; only the bare filename `.mcp.json` — OpenAI's separate MCP
   server-config file, distinct from Antigravity's `mcp_config.json` — needed adding.)
4. Optionally set `audience` (to-B vs to-C-reaching — who actually installs/discovers this
   channel) and `auth_summary` (OAuth vs API-key-alternative, in one sentence) on the row;
   `generate.mjs` renders both into `distribution/INSTALL.md` under the row's install snippet,
   alongside the existing `publish_mechanism` field, if present. None of the three are enforced
   by any check — they're documentation-only, same category as `notes`.
5. `node distribution/generate.mjs && node distribution/check.mjs` — must exit 0.
6. Add a green-fixture entry for it in `distribution/test/fixtures.mjs` and at least one red
   fixture exercising a drift specific to it. Do not assume every plausible drift is already
   caught: a row with `writer_kind:null` and no `*_field` set (the `glama`/`*-mcp-config`
   shape) has NO content-shape validation today beyond "exists, parses, no secrets" — e.g.
   hand-editing Antigravity's `mcp_config.json` from `serverUrl` to `url` currently produces
   **zero** failures (verified, brief-A2 PHASE 4; flagged in `antigravity-mcp-config`'s `notes`
   as future work, not fixed this round).

## Reproduce

```bash
cd npm-package && npm ci && npm run build   # produces npm-package/build/ — REQUIRED (not merely
                                             # optional): claims_consistent reads
                                             # build/core.js + build/data/scraper_catalog.js to
                                             # compute its facts; check.mjs throws a loud, typed
                                             # error naming this exact command if build/ is missing
cd ..
node distribution/generate.mjs              # writes every owned field
node distribution/check.mjs                 # must exit 0 except hosted-server/landing/tools.html's
                                             # own, deliberately-left-red claims_consistent lines
                                             # (see "Claim consistency" above) — always prints the
                                             # reviewer-visible summaries too (see "Reviewer-
                                             # visible summaries" above), pass or fail. IF YOU SEE
                                             # a "WARNING N untracked prose file(s) not scanned"
                                             # line, this run has NOT scanned every claim surface —
                                             # see "Verifying an uncommitted checkout" below before
                                             # trusting its claims_consistent result.
node --test distribution/test/*.test.mjs    # must be all green — see the CI step's comment in
                                             # .github/workflows/ci.yml for why this is a glob,
                                             # not `node --test distribution/test/`
(cd npm-package && npm test)                # unrelated regression guard — unaffected by this round
```

## Verifying an uncommitted checkout (brief-M, 2026-10-15)

`claims_consistent` only ever scans `git ls-files`-TRACKED prose files (see "Claim consistency"
above) — a brand-new or hand-edited `*.md`/`*.html`/`*.txt` file that hasn't been `git add`ed yet
is invisible to it, and so is a `claims-ignore` marker sitting inside one. This is exactly how a
real round of this registry shipped 16 unreported `claims_consistent` failures (a stale
illustrative count in a still-untracked `distribution/README.md`, and quoted-historical-research
numbers in a still-untracked `distribution/research/channel-facts.md`): a local
`node distribution/check.mjs` run against the real, uncommitted worktree reported ZERO failures
outside `hosted-server/landing/tools.html`, because every file carrying the other 16 was
untracked at the time. The gate's own `[check] claims_consistent: WARNING N untracked prose
file(s) not scanned: ...` line (see "Reviewer-visible summaries" above) now surfaces exactly this
gap on every local run that has one — but the only way to get a result that is PROVABLY as
complete as what CI will see (CI always runs against a fully-tracked checkout) is to verify
against a fully committed copy:

```bash
rsync -a --exclude .git /path/to/your/worktree/ /tmp/verify-copy/   # copy working-tree state only
cd /tmp/verify-copy
git init -q && git add -A && git commit -qm base                   # a FRESH repo, fully tracked —
                                                                     # never touches your real
                                                                     # worktree's own git history
node distribution/check.mjs                                        # the WARNING line above must
                                                                     # now be ABSENT; any failure
                                                                     # this reports that your real
                                                                     # worktree's run did NOT is
                                                                     # exactly the class this
                                                                     # procedure exists to catch
```

**Never run this inside your real worktree** — the `git init`/`git add -A`/`git commit` sequence
is scoped to the throwaway `/tmp/verify-copy` copy only, precisely so this verification procedure
can never itself commit or stage anything in the repository you're actually working in.

**CI job layout (brief-K K3, 2026-10-15):** `.github/workflows/ci.yml` runs this as TWO
independent jobs, not two steps in one job — `build` (checkout, install, build, `npm run
test:coverage`, `npm run lint` — its EXACT pre-brief-J shape, no distribution step in it at all)
and `distribution` (its own checkout/install/build, then `Distribution tests` then `Distribution
gate`, running in parallel with `build`, no `needs:` between them). Before this fix, both
distribution steps ran INSIDE the `build` job, ahead of its Test/Lint steps — GitHub Actions skips
every remaining step in a job once an earlier one fails, so once `Distribution gate` failed (which
it is DESIGNED to do today, see above), `build`'s own Test/Lint steps never ran at all, on every
single CI run, with zero signal they'd silently stopped executing. Splitting into two independent
jobs means a failure in one can never skip a step in the other (GitHub Actions jobs are
independent runners by default) — `distribution/test/ci-layout.test.mjs` proves this structurally
(parses `ci.yml`'s own job/step layout) and operationally (a small, GitHub-Actions-semantics-
accurate simulator over the parsed steps, given a forced per-step outcome).
