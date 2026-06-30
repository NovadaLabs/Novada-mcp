# Worker-B Report: Claude Plugin Marketplace Submission
**Date:** 2026-06-18
**Status:** MANUAL_REQUIRED — blocked on 2 items before submission

---

## Submission Path Identified

The Claude Plugin Marketplace submission process is:

**Target marketplace:** `anthropics/claude-plugins-community` (community catalog, 2200+ plugins)
**Submission URL:** https://clau.de/plugin-directory-submission
  → redirects to: https://code.claude.com/docs/en/plugins#submit-your-plugin-to-the-official-marketplace
  → actual form: https://platform.claude.com/plugins/submit (requires Console login)
  → alternate form: https://claude.ai/admin-settings/directory/submissions/plugins/new (requires Team/Enterprise org)

The community marketplace is a **read-only mirror** of an internal Anthropic review pipeline. You cannot open PRs directly to `anthropics/claude-plugins-community` — all submissions go through the form and are approved/pinned by Anthropic's pipeline.

The official marketplace (`claude-plugins-official`) is **invitation-only** — no application process exists.

---

## Manifest Validation

### claude-plugin.json (root, npm-style)
```json
{
  "name": "novada",
  "version": "0.8.1",
  "install_command": "claude mcp add novada",
  ...
}
```
**Status:** Valid for npmjs/Claude MCP install. NOT the plugin manifest format.

### .claude-plugin/plugin.json (plugin manifest)
```json
{
  "name": "novada-mcp",
  "description": "...",
  "version": "0.1.0",
  "author": { "name": "NovadaLabs", "url": "https://novada.com" }
}
```
**Status:** Valid. Present on remote at `NovadaLabs/novada-mcp`. ✓

### .claude-plugin/marketplace.json (submission manifest)
**Before (INVALID):** Had `$schema` and top-level `description` keys — both unrecognized.
**After fix (this session):** Removed invalid keys, converted `source` from `"./"` string to proper `{source, url, sha}` object. SHA pinned to current HEAD `3da9207d`.

```json
{
  "name": "novada-mcp",
  "owner": { "name": "NovadaLabs", "email": "support@novada.com" },
  "plugins": [{
    "name": "novada-mcp",
    "description": "...",
    "source": {
      "source": "url",
      "url": "https://github.com/NovadaLabs/novada-mcp.git",
      "sha": "3da9207d66a050b680fe9074966b631767fcb28c"
    },
    "homepage": "https://github.com/NovadaLabs/novada-mcp"
  }]
}
```

`claude plugin validate .` result: **✔ Validation passed with warnings**
Warning: optional `description` field at top-level. Non-blocking.

---

## Blockers Before Submission

### BLOCKER 1 (P0 — Security): Credentials in .mcp.json on public remote

`/Users/tongwu/Projects/novada-mcp/.mcp.json` is committed to and publicly readable at:
`https://raw.githubusercontent.com/NovadaLabs/novada-mcp/main/.mcp.json`

It contains hardcoded credentials:
- `NOVADA_API_KEY`: `1f35b477c9e1802778ec64aee2a6adfa`
- `NOVADA_PROXY_USER` + `NOVADA_PROXY_PASS`
- `NOVADA_WEB_UNBLOCKER_KEY`
- `NOVADA_BROWSER_WS` (includes credentials in URL)

The submission form runs automated security scanning. This will fail or result in rejection. The file also exposes live credentials.

**Required action:** Remove `.mcp.json` from git history (or overwrite with a template using env-var placeholders), rotate the exposed credentials.

### BLOCKER 2 (P1 — Auth): Submission form requires browser login

`https://platform.claude.com/plugins/submit` requires a logged-in Console session. The automated agent cannot log in and fill the form.

**Required action:** Human submits the form. Fields needed:
- **Repository URL:** `https://github.com/NovadaLabs/novada-mcp`
- **Plugin name:** `novada-mcp`
- **Description:** already in `.claude-plugin/plugin.json`
- **Category:** development / web-tools
- **Homepage:** `https://github.com/NovadaLabs/novada-mcp`

---

## Already Listed Check

Searched `anthropics/claude-plugins-community` marketplace.json (2200 plugins):
**novada: NOT FOUND** — not yet submitted or approved.

Also searched Smithery.ai for `novada-mcp`: **404 Not Found** — not listed there either.

---

## Current State Summary

| Item | Status |
|------|--------|
| Repository public | ✓ github.com/NovadaLabs/novada-mcp |
| .claude-plugin/plugin.json on remote | ✓ Valid |
| .claude-plugin/marketplace.json fixed | ✓ Validation passes (local) |
| smithery.yaml on remote | ✓ Present |
| .mcp.json credentials exposed | ✗ BLOCKER — rotate + remove |
| Already in community marketplace | ✗ Not listed |
| Submission form filled | ✗ Needs human login |

---

## Next Steps (in order)

1. **[Human]** Rotate all credentials in `.mcp.json` — API key, proxy user/pass, browser WS.
2. **[Agent]** Remove `.mcp.json` from git history and push, or overwrite with env-var template and push.
3. **[Human]** Navigate to https://platform.claude.com/plugins/submit and submit with:
   - Repo URL: `https://github.com/NovadaLabs/novada-mcp`
   - All other fields pulled from `.claude-plugin/plugin.json`
4. After approval, plugin appears in `anthropics/claude-plugins-community` and users install via:
   ```
   claude plugin marketplace add anthropics/claude-plugins-community
   claude plugin install novada-mcp@claude-community
   ```

---

## Files Modified This Session

- `/Users/tongwu/Projects/novada-mcp/.claude-plugin/marketplace.json` — fixed schema (removed invalid keys, correct source format, real SHA)
