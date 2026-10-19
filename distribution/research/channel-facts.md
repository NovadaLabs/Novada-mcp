# Distribution-channel contract research — novada-mcp

Brief B (agent-craft SOP_ID `a6149adb`). Research only; no pushes, no publishes, no global installs.
Worktree: `/Users/tongwu/Projects/novada-mcp-distribution` (branch `feat/distribution-channels`), 2026-10-15.

Machine-readable twin: `channel-facts.json` (array of per-channel objects with `evidence[]`). This file is the
human-readable narrative; where the two disagree, `channel-facts.json` is authoritative for field values —
this file explains the *why*.

---

## Phase 1 — Existing manifests

| Path | Version | Stale? | Hardcoded counts / tool lists |
|---|---|---|---|
| `npm-package/package.json` | **0.9.41** (canonical version source per brief) | — | none |
| `npm-package/server.json` | 0.9.41 | **No — matches** | `tools[]` array has exactly 37 entries, consistent with the live registry (`src/tools/registry.ts`'s own description template interpolates `WORKING_PLATFORM_NAMES.length`/`WORKING_OP_COUNT` dynamically, so the 37-tool *count* is not itself a stale hardcode — but the 37 descriptive strings inside `tools[]` are static snapshots that drift whenever a tool is added/removed and `npm run gen:server-json` isn't re-run). `remotes[0].url` = `https://mcp.novada.com/mcp`, Bearer auth header documented. `$schema` = `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json` (current, matches official quickstart). |
| `npm-package/glama.json` | n/a (no version field — correct per schema) | — | none; minimal `{$schema, maintainers}` form |
| `npm-package/smithery.yaml` | n/a (no version field) | — | description text says "Scrape 16 platforms" — **current**, matches `src/data/scraper_catalog.ts`'s 16 distinct domains |
| `hosted-server/smithery.yaml` | n/a | — | none; stateless `apiKey`-optional config schema for the hosted HTTP endpoint |
| `npm-package/.claude-plugin/plugin.json` | **0.1.0** | **YES — stale, two ways.** (1) Never bumped since creation, unrelated to 0.9.41. (2) Description hardcodes **"scrape 13 platforms"** — the catalog has been at **16 platforms** since the 0.9.x "Tools-v2" scaffold passes (per `CHANGELOG.md` and `src/data/scraper_catalog.ts`); 13 is a leftover from an earlier catalog-truth correction (see `CHANGELOG.md:279`, which itself documents correcting FROM "129 platforms" TO "13 platforms" — this file was never updated for the *next* correction to 16). |
| `npm-package/.claude-plugin/marketplace.json` | n/a (no version field on marketplace entries) | — | same stale **"scrape 13 platforms"** string, duplicated from `plugin.json`'s description |

**Location problem (not just staleness):** `.claude-plugin/` sits at `npm-package/.claude-plugin/`, not at the
monorepo's git repo root. Claude Code's self-hosted-marketplace route expects `.claude-plugin/marketplace.json`
at the root of whatever `claude plugin marketplace add <owner>/<repo>` clones — i.e. the repo root for an
`owner/repo` shorthand add. `claude plugin marketplace add NovadaLabs/novada-mcp` would clone the monorepo root
and not find the file. This is a structural gap the builder must either fix (move/duplicate the files to repo
root, or document that users must add `NovadaLabs/novada-mcp` with an explicit `git-subdir`-style pointer — but
note `.claude-plugin/marketplace.json`'s own `source` entries, not the `marketplace add` command, support
`git-subdir`; the *add* command for a bare marketplace location does not take a subpath) or explicitly flag as
a known limitation in `distribution/channels.json`.

**No `gemini-extension.json`, no `.codex-plugin/*`, no root-level `server.json`, no root-level
`mcp_config.json`/`*.mcp.json` anywhere in the tree** (confirmed via `find`, excluding `node_modules`).

**git log -5 `novada-corp/feat/oauth-restore`:**
```
053c10a harden(oauth): allowlist redirect origin shape before splicing into CSP (TOW2-377 review follow-up)
8633f47 fix(oauth): widen CSP form-action to the validated redirect origin — Authorize click was silently blocked (TOW2-377)
3bf9fe8 perf(hosted): reconciler newest-first + concurrency 20 for near-real-time HQ sync
bb25c57 chore(release): 0.9.34 — TOW2-257 async fast-handoff + TOW2-372 google_search locale fix
f03f1c3 fix(scrape): google_search empty SERP — default country=us when caller omits locale (TOW2-372)
```
**Merged-to-main state: MERGED.** `git merge-base --is-ancestor novada-corp/feat/oauth-restore HEAD` succeeds
against the current worktree HEAD (branched from `release/0.9.41`'s merge commit `f8cc96a`), and independently
against `novada-corp/main` directly. `git log HEAD..novada-corp/feat/oauth-restore` is empty — every commit on
that branch is already an ancestor of main. The hosted endpoint's OAuth 2.1 Authorization Server
(`hosted-server/vercel/api/_oauth.ts`, implementing RFC 8414/9728/7591/6749/7636) is live code, not dead:
`mcp.ts` imports from `_oauth.js` and its own header comment states "mcp.ts is the DI root for api/_oauth.ts...
this is its ONLY real caller." This is directly relevant to blocking question (c)/(d): novada-mcp's hosted
endpoint already has the OAuth 2.1 machinery OpenAI's submission path requires.

---

## Phase 2/3 — per-channel contracts and the four blocking questions

Full field-by-field data lives in `channel-facts.json`. Narrative for each channel, with the headline risk a
builder would otherwise encode wrong:

### gemini-cli
Fully automatic, crawler-driven gallery — public repo + `gemini-cli-extension` GitHub topic +
`gemini-extension.json` at the **absolute repo root**. For this monorepo that means the git repo root, not
`npm-package/`. No submission form exists; real GitHub issues show the crawl is not 100% reliable even when all
documented requirements are met (treat "listed within 24h" as probabilistic). Update detection is NOT uniform —
it differs by install method (release-tag API query / `git ls-remote` HEAD compare / local manifest-version
compare), and two of the three explicitly **ignore** the manifest `version` field.

### antigravity-cli
`serverUrl` (not `url`/`httpUrl`) confirmed for remote MCP entries — matches the brief's "known so far." Secret
passing to a remote server has **no documented `${VAR}` templating** — only a literal `headers` object or OAuth
DCR/manual client credentials. Marketplace *listing* is gated behind a manual interest form (no self-serve
publish API); direct `agy plugin install <github-url>` bypasses the marketplace entirely and needs no
registration. The brief's "known so far" schema URL (`antigravity.google/schemas/v1/plugin.json`) returned a
live **HTTP 404** when fetched directly in this research pass — flag it as unverified/possibly moved, don't
carry it forward as fact without re-checking at build time.

### openai-plugins (ChatGPT + Codex)
One shared "universal plugin directory" — a single submission reaches both surfaces, so this is correctly
modeled as ONE channel, not two. OAuth 2.1 is mandatory for any authenticated data access; static API-key
headers (what novada-mcp's hosted endpoint currently uses as its primary mechanism) are explicitly rejected:
*"ChatGPT does not support ... custom API keys or customer-provided mTLS certificates."* EU-data-residency
projects are explicitly blocked from submitting. Both of these map directly onto why
`novada-corp/feat/oauth-restore`'s work matters — it's the prerequisite, not a nice-to-have.

### claude-code-marketplace
Two distinct routes exist and must not be collapsed into one row: (A) the self-hosted
`.claude-plugin/marketplace.json` route this repo already uses — push-to-publish, no form, but **this repo's
files are in the wrong location** (see Phase 1); (B) Anthropic's official directory via a paid-plan web portal
at `claude.ai/directory/manage`, a materially different, higher-friction path. `claude plugin validate` is the
only validator for both. Version-bump semantics are explicit and strict: omit `version` to track git commits,
or bump it every release — a plugin pinned at a stale `version` (like this repo's `0.1.0`) silently stops
delivering updates to anyone who installs it, independent of what's actually in the files.

### mcp-registry (server.json)
The one channel with a crisp, unambiguous answer on every field, including the brief's own self-check: version
bumps are **mandatory and immutable** — "Once published, version metadata is immutable (similar to npm)," and
there is no unpublish capability yet. Publishing is authenticated identity-first (GitHub OAuth binds
`io.github.*`, or DNS/HTTP domain-proof binds `com.example.*`) and is entirely separate from the *server's own*
runtime auth, which server.json only describes, never enforces. novada-mcp's existing server.json is internally
consistent (name matches `mcpName`, version matches package.json, schema URL is current) — this is the
healthiest of the seven manifests in the repo today.

### smithery
The messiest channel to pin down from docs alone: two of the three primary doc URLs this research attempted
(`smithery.ai/docs/build/deployments`, `smithery.ai/docs/config`) returned 404 during this session, so several
fields (location_rule enforcement, version-field semantics, redeploy-on-push behavior) are UNVERIFIED rather
than confirmed, despite a confident-sounding web-search summary claiming a 24-hour crawler cycle — that claim
is flagged UNVERIFIED-THIRD-PARTY and must not be stated as fact. Structurally, novada-mcp already has **two**
`smithery.yaml` files (`npm-package/` for stdio, `hosted-server/` for HTTP) in one repo, and it's unverified
which one a GitHub-connected Smithery deployment would actually discover.

### glama
Low-friction, GitHub-first: "Add MCP Server" + a repo URL is enough to be listed; `glama.json` is needed only
to *claim* ownership (required for org-owned repos like `NovadaLabs/novada-mcp`, since GitHub-account claiming
only works for personal-account repos). novada-mcp's existing `glama.json` is already schema-correct and
matches the documented minimal form exactly. Metadata-sync is explicitly manual ("go through the Claim
ownership flow again"); code-level re-scan cadence for an already-claimed GitHub-indexed server was not
confirmed by any primary source reached in this pass.

---

## Blocking questions

**(a) Gemini CLI: does `${VAR}` from extension `settings` get substituted inside `mcpServers.headers`?**

**VERDICT: YES** — confirmed directly in source, not just docs.

- `packages/cli/src/config/extension-manager.ts` (commit `06d329873703ddabe8a842d962342ac4ad779e83`, branch
  `main`), lines 780–800:
  ```
  780  let userSettings: Record<string, string> = {};
  781  let workspaceSettings: Record<string, string> = {};
  ...
  799  const customEnv = { ...userSettings, ...workspaceSettings };
  800  config = resolveEnvVarsInObject(config, customEnv);
  ```
  `userSettings`/`workspaceSettings` are populated via `getScopedEnvContents(config, extensionId, ...)`, keyed
  by each declared extension `settings[].envVar` name (lines 783–797) — i.e. exactly the `settings` array a
  `gemini-extension.json` author declares. `resolveEnvVarsInObject` is called on the **whole config object**,
  which includes `mcpServers`, **before** any mcpServers-specific filtering happens (the only later mcpServers
  step, `filterMcpConfig`, just strips the `trust` key — no further substitution).
  Gated behind `this.settings.experimental.extensionConfig` (line 783) — an experimental flag.

- `packages/cli/src/utils/envVarResolver.ts`, same commit:
  - Lines 23–58, `resolveEnvVarsInString`: regex `/\$(?:(\w+)|{([^}]+?)(?::-([^}]*))?})/g` matches `$VAR`,
    `${VAR}`, `${VAR:-default}`; lookup order is `customEnv[varName]` first (line 44–46), then
    `process.env[varName]` (lines 47–51), then the inline default.
  - Lines 94–153, `resolveEnvVarsInObjectInternal`: recurses through **every key of every plain object**
    (`for (const key in newObj)`, line 142) and every array element, with cycle protection via `WeakSet`. A
    string value nested at `mcpServers.<name>.headers.<headerName>` is an ordinary object-key string and is
    walked and substituted exactly like any other field — there is no special-casing that excludes `headers`.

Net effect: an author can write `"headers": {"Authorization": "Bearer ${NOVADA_API_KEY}"}` in
`gemini-extension.json`, declare `settings: [{name: "...", envVar: "NOVADA_API_KEY", sensitive: true}]`, and the
CLI will substitute the user-supplied value into the header at config-load time — **subject to the
experimental-flag gate above**, which the builder should surface as a caveat (users on a non-experimental
config path would see the literal `${NOVADA_API_KEY}` string sent as a header, which is a real failure mode to
document, not hypothetical).

**(b) Antigravity: does `agy plugin install <github-url>` support a repo SUBFOLDER? How does a plugin pass a user secret to a remote MCP server?**

**VERDICT, subfolder install: YES** — confirmed by live CLI test (docs were silent, so per the SOP's fallback
an actual `/tmp`-only local test was run):
```
$ /tmp/agy-test/agy plugin install "https://github.com/google-gemini/gemini-cli/tree/main/packages/cli"
Cloning plugin from https://github.com/google-gemini/gemini-cli.git...
Error: could not detect plugin structure at /var/folders/.../plugin-install-3986463622/packages/cli
```
(agy v1.3.5, darwin_arm64, run 2026-10-15.) The CLI parsed the `/tree/main/packages/cli` suffix, cloned the
**whole** repository, then looked for the plugin manifest specifically at the `packages/cli` subpath inside the
clone — not at the clone root. The error is "could not detect plugin structure," not a URL-parse error or
"repository not found," which is exactly the signature of correct subfolder-path resolution against a subpath
that (correctly, in this test) has no `plugin.json`. This directly answers the question: subfolder installs
from a monorepo are structurally supported by `agy plugin install`.

**VERDICT, secret passing: no templating documented.** Official docs (`antigravity.google/docs/mcp`,
`antigravity.google/docs/plugins`) show only a literal `headers` object
(`{"Authorization": "Bearer YOUR_API_TOKEN"}`) with no `${VAR}`/`${input:...}` substitution syntax anywhere in
`mcp_config.json`. The two real mechanisms found are: (1) hardcode the literal secret value directly in the
user's local `mcp_config.json` (fine for personal/local use, irrelevant to *distribution* since it's user-local
config, not shipped in the plugin package), or (2) OAuth — automatic for servers supporting Dynamic Client
Registration, or a manual `oauth{clientId, clientSecret}` block. **There is no mechanism by which novada-mcp
could ship a plugin.json that asks the user for their `NOVADA_API_KEY` once and templates it into `headers` at
install/load time** — unlike Gemini CLI's `settings[].envVar` + `${VAR}` pattern. The builder must not assume
feature parity between the two CLIs here.

**(c) OpenAI: does plugin/app directory submission require OAuth 2.1 for remote MCP (are API-key headers rejected)?**

**VERDICT: YES.** `developers.openai.com/plugins/build/auth`: *"ChatGPT does **not** support machine-to-machine
OAuth grants such as client credentials, service accounts, or JWT bearer assertions, nor can it present custom
API keys or customer-provided mTLS certificates."* OAuth 2.1 (via `provided` / `dcr` / `cimd` client
registration) is required for any plugin touching user-specific data; a `noauth` anonymous mode exists only for
tools that touch no user data, which does not describe a billed, per-key API. novada-mcp's hosted endpoint's
current primary mechanism (`Authorization: Bearer <NOVADA_API_KEY>` static key) would be rejected for
submission as-is — this is exactly the gap `novada-corp/feat/oauth-restore`'s already-merged OAuth 2.1
Authorization Server (RFC 8414/9728/7591/6749/7636, wired live into `mcp.ts`) is built to close.

**(d) OpenAI: are EU-data-residency projects excluded from MCP plugin submission?**

**VERDICT: YES.** `developers.openai.com/plugins/deploy/app-review`: *"projects with EU data residency cannot
submit plugins with MCP servers for review. Use a project with global data residency."* This is a constraint on
which **OpenAI developer-platform project** is used to perform the submission (an org-level setting on OpenAI's
side), not a constraint on where novada-mcp's own infrastructure is hosted — the submitting org simply needs a
project configured for global data residency, separate from wherever Novada's servers actually run.

---

## BLOCKERS

Anything below must NOT be encoded as settled fact by the builder without further verification:

1. **Antigravity plugin.json schema URL** — `https://antigravity.google/schemas/v1/plugin.json` (the brief's
   "known so far" value) returned a live **HTTP 404** when fetched directly on 2026-10-15. Either the URL is
   wrong, moved, or temporarily down. Re-check before hardcoding it into `distribution/channels.json`'s
   `schema_url` field; the JSON row currently carries this caveat inline rather than a clean value.
2. **Antigravity plugin.json `version` field** — exact field name/semantics not confirmed verbatim in official
   docs reached in this pass (only `name` and `description` field schemas were directly quoted from the
   primary page). Don't assume it mirrors Gemini CLI's or Claude Code's `version` semantics.
3. **Antigravity update-detection mechanism** — completely undocumented in official sources found. Do not
   invent a mechanism (e.g. "git tag compare") by analogy to Gemini CLI or Claude Code.
4. **Antigravity publish/resubmit mechanism** — marketplace *listing* requires a manual interest-form request
   (no API/PR path found); whether/how a listed plugin's version update reaches installed users is unverified.
5. **Smithery location_rule, version-field semantics, and redeploy-on-push behavior** — two of three primary
   doc URLs attempted 404'd this session (`smithery.ai/docs/build/deployments`, `smithery.ai/docs/config`).
   The "24-hour crawler re-scan" claim is UNVERIFIED-THIRD-PARTY only (WebSearch synthesis, not independently
   re-fetched from a primary page) — do not state it as confirmed fact.
6. **Which of novada-mcp's two existing `smithery.yaml` files (if either) a GitHub-connected Smithery
   deployment would discover** — unverified; the repo currently has one in `npm-package/` and one in
   `hosted-server/`, neither at the monorepo root.
7. **Glama's `connector.json` schema URL** (`https://glama.ai/mcp/schemas/connector.json`) and the exact
   "org repos must use glama.json, personal repos can use GitHub-account claiming" rule — both sourced only
   from a WebSearch synthesis of Glama's docs, not an independently re-fetched primary page in this pass.
8. **Glama's code-level re-scan cadence** for an already-claimed GitHub-indexed server (vs. the confirmed-daily
   domain-*ownership* recheck, which is a different thing) — not found in any source reached.
9. **OpenAI "does every version bump require full app-review re-review?"** — the ZIP-upload → scan →
   submit-for-review flow and the daily automated tool-scan for already-approved apps are both confirmed, but
   the exact phrase for whether a NEW VERSION of an already-approved app goes through full human re-review
   (vs. just the automated scan) was not reached in the pages fetched (`developers.openai.com/plugins/submit`
   returned 404; the canonical "Update a published plugin"-style page for OpenAI's flow was not located).
10. **Claude Code's "Submit to Anthropic's directory" route's exact re-review mechanics on a version bump** —
    confirmed to exist and require a paid plan + portal submission, but the page documenting "Update a
    published plugin" specifically (linked from `code.claude.com/docs/en/plugins/publish`) was referenced, not
    independently fetched, in this pass.
11. **`.claude-plugin/` location mismatch** (see Phase 1) is a confirmed FACT, not a blocker on the fact
    itself — but the *remediation* (move files to repo root vs. document a workaround) is an owner/builder
    decision, not something this research resolves.

**Process note for the orchestrator:** `distribution/channels.json`, `distribution/listing.json`,
`distribution/github-topics.md`, `distribution/registry-publish.md`, `distribution/generate.mjs`, and
`distribution/check.mjs` already exist in this worktree with timestamps from this same session window —
evidence another agent (presumably the builder, or Brief A) is working in the same worktree concurrently. Per
this brief's scope, none of those files were read or touched; only the two files listed in this brief's OUTPUT
section were written.
