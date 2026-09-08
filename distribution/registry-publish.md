# Registry / directory publish sequence — ALL STEPS OWNER-GATED

**Nothing in this file has been executed.** Every command below is a live, externally-visible
action (registry write, GitHub PR, third-party form submission) and falls under REDLINE — this
worker produces files only. The owner runs these, in this order, after reviewing the diff in this
worktree.

## Background — why the sequence is "remotes-only first, npm-mcpName second" and not the other way around

The 2026-09-02 audit's first pass (finding B-1) concluded the official MCP Registry could never
register `novada-mcp` because `npm-package/package.json`'s `mcpName: "novada"` doesn't match
`server.json`'s `name: "io.github.NovadaLabs/novada-mcp"`, and npm published versions are
immutable — so 0.9.37 could never pass the registry's npm-ownership validator.

The adversarial re-verification pass (`V1-verification-ABP.md`, section "1. B-1") found that
conclusion **overstated the blocker**: the official registry schema requires only
`name`/`description`/`version` — `packages` and `remotes` are independent optionals — and remote
transport URLs are validated for shape only (no namespace-to-domain check exists anywhere in the
registry source). A `io.github.NovadaLabs/novada-mcp` entry can therefore be registered **today**,
remotes-only, pointing at the hosted endpoint, with **zero npm changes** — GitHub-login namespace
auth for `io.github.NovadaLabs/*` is already proven working (`io.github.NovadaLabs/proxy4agents-mcp`
published 2026-04-10).

This worker's fix already did the file-level part of that path: `npm-package/server.json` now
declares a `remotes` block (see `git diff` in this worktree). The `package.json` `mcpName` field is
also already corrected in this worktree — but that fix only takes effect for the **npm package
registry entry**, which requires a NEW npm publish (mcpName is read from the immutable per-version
npm packument, so no existing published version can ever satisfy it). Do not let that npm-side fact
gate the remotes-only registration below — they are independent steps.

## Step 0 — review before running anything

```bash
cd ~/Projects/novada-mcp-audit-fix
git status
git diff npm-package/server.json npm-package/package.json npm-package/smithery.yaml README.md npm-package/README.md docs/TOOLS.md
```

Confirm: `server.json` has the new `remotes` block, tools[] is unchanged (still 38, still
core-derived), and no `version` field anywhere was touched. Merge this branch to the canonical
repo's main branch (owner's normal PR/merge flow) before running any command below — `mcp-publisher`
validates against whatever `server.json` exists in the checked-out working tree, so it must be the
merged, canonical copy, not this worktree.

## Step 1 — OWNER-GATED: register with the official MCP Registry (remotes-only, no npm release needed)

```bash
# from the canonical repo root, npm-package/ directory containing the fixed server.json
cd npm-package
mcp-publisher login github
mcp-publisher publish
```

- `login github` opens a device-code flow against your GitHub account; you must be a maintainer of
  `NovadaLabs` for `io.github.NovadaLabs/*` namespace auth to succeed (already proven working for
  `proxy4agents-mcp`).
- `publish` reads `server.json` in the current directory. It will validate the `remotes[0].url`
  (shape-only — https, no localhost) and skip npm-ownership validation entirely if you do NOT also
  keep an npm `packages` entry pointing at a version whose `mcpName` doesn't match. **Two valid
  options here — pick one:**
  - **(a) Remotes-only, ship now:** temporarily remove the `packages` array from the copy of
    `server.json` you publish with (keep it in git for the next npm release), so only the `remotes`
    entry is submitted. Fastest path to registry presence.
  - **(b) Wait one release cycle, ship both:** do Step 2 (npm release) first, then publish
    `server.json` as-is (both `packages` and `remotes` present, both valid). Slower but avoids a
    second edit + republish later.
- Verify after publishing: `curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=novada'`
  should return `io.github.NovadaLabs/novada-mcp` (currently returns only
  `io.github.NovadaLabs/proxy4agents-mcp`).

## Step 2 — OWNER-GATED: npm release with the corrected `mcpName` (only needed for the npm `packages` entry)

Only run this when the owner decides to cut a release (not forced by this finding alone — see
`V1-verification-ABP.md`: "the owner should not be pushed into an out-of-cycle version bump by this
finding alone"). When a release does happen for any other reason, this fix rides along at zero
extra cost since `package.json` already carries the corrected `mcpName` in this worktree:

```bash
cd npm-package
npm run build          # regenerates server.json's tools[]/description/version from package.json + build/core.js
npm publish             # owner decides the version number — see CLAUDE.md version-discipline rule
```

After that publish, if the registry entry was created remotes-only in Step 1, re-run
`mcp-publisher publish` with the full `server.json` (packages + remotes) to add the npm install
path to the existing registry entry.

## Step 3 — OWNER-GATED: smithery.ai submission

Precondition (done by this worker): `npm-package/smithery.yaml` regenerated with the full 38-tool
catalog, corrected engine list (google/duckduckgo/yandex — no Bing/Yahoo), and the corrected
`novada_research` contract description (extractive source material, not "a cited report"). Do not
submit the previous stale 5-tool file.

1. Go to `https://smithery.ai` and sign in with the GitHub account that owns `NovadaLabs/Novada-mcp`.
2. "Add Server" / "Claim Server" flow → point it at the repo; smithery reads `smithery.yaml` from
   the repo root's `npm-package/` directory (or wherever the deploy config specifies).
3. Verify after: `https://registry.smithery.ai/servers?q=novada` should return a `novada-mcp` entry
   (currently 0 matches, and `servers/novada-mcp` / `servers/@NovadaLabs/novada-mcp` /
   `servers/novadalabs/novada-mcp` all 404).

## Step 4 — OWNER-GATED: mcp.so submission

`mcp.so` (chatmcp's directory) currently returns 1 result for "novada" and it's the unrelated
community `Proxy Veil` project, not this server.

1. Check `mcp.so`'s current submission flow (as of the audit date it was PR/form-based against the
   chatmcp directory source — reverify the current mechanism before submitting, it may have
   changed).
2. Submit with: name `Novada MCP`, GitHub `NovadaLabs/Novada-mcp`, hosted URL
   `https://mcp.novada.com/mcp`, category Web Scraping (matches the Firecrawl/Tavily/BrightData
   category placement already observed there).
3. Verify after: `curl -s 'https://mcp.so/search?q=novada'` SSR payload should show `total:2`
   (Proxy Veil + Novada), not `total:1`.

## Step 5 — OWNER-GATED: `punkpeye/awesome-mcp-servers` PR

93.8k-star list; Firecrawl (line 442), Tavily (line 3077), BrightData (line 3085) are all present;
`novada` has 0 grep hits in the 3,939-line README.

1. Fork `github.com/punkpeye/awesome-mcp-servers`.
2. Add one line under the "Web Scraping & Data Collection" (or equivalent current) section,
   alongside the Firecrawl entry, following that list's existing entry format exactly (name, one-line
   description, link).
3. Open a PR against `main`. This is a community-maintained list — acceptance is not guaranteed and
   is on the maintainer's timeline, not ours.

## Step 6 — OWNER-GATED: GitHub repo topics

See `distribution/github-topics.md` — a separate, smaller owner action (repo Settings → About →
Topics), not part of any registry publish flow above.
