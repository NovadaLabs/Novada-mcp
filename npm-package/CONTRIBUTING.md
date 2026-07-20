# Contributing to novada-mcp

Thanks for your interest in improving the Novada MCP server. This guide covers the
essentials for getting a change merged.

## Getting started

```bash
git clone https://github.com/NovadaLabs/novada-mcp.git
cd novada-mcp
npm install
npm run build   # must exit 0
npm test        # must pass
```

Requires Node.js >= 18.

## Development workflow

1. **Open an issue first** for anything beyond a trivial fix, so we can agree on the
   approach before code is written. Use the bug report template under
   `.github/ISSUE_TEMPLATE/`.
2. **Branch** from `main` (e.g. `fix/<short-desc>` or `feat/<short-desc>`).
3. **Make the change.** Touch only what's needed and match the surrounding style
   (TypeScript, explicit types on exported APIs, no `any`, no `console.log` in
   production code — logging goes through the structured helpers).
4. **Add or update tests** for any behavior change. New behavior with no test will not
   be merged.
5. **Verify locally** before pushing:
   ```bash
   npm run build   # exit 0
   npm test        # green
   npm run lint
   ```
6. **Open a pull request** with a clear description of what changed and why. Reference
   the issue it closes.

## Tool-description and agent-first conventions

This is an MCP server whose primary consumer is an LLM agent, not a human. When editing
tool descriptions in `src/core.ts`'s `_TOOL_DEFINITIONS` (see root
[`ARCHITECTURE.md`](../ARCHITECTURE.md) for the full file map — descriptions are NOT in
`src/index.ts`, which only wires transport + request handlers):

- Keep descriptions accurate — they must match the tool's real Zod schema. Do not
  document parameters that don't exist.
- Errors should carry an `agent_instruction` where it helps the model recover.
- Prefer structured, parseable output.

## Changelog & releases

`CHANGELOG.md` is the **single source of truth** for the changelog — add your entry under
`## [Unreleased]` (Keep-a-Changelog style). **Do not hand-edit `docs/update-log.html`** — it is
auto-generated from `CHANGELOG.md` by `scripts/gen-update-log.mjs` (regenerated at release).
Team progress + health goes to the Linear project *"MCP — Hosted + Tools + Optimization"*, not files.

Releases ship via `scripts/promote-to-public.sh` (gated, dry-run by default) — one version to all
platforms (npm + public git + hosted) at once; never hand-bump a single platform. npm versions are
immutable, so the next release is a new number. Full rules for agents and teammates: **[AGENTS.md](./AGENTS.md)**.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `refactor:`, `test:`, `chore:`, `perf:`.

## Reporting bugs and requesting features

Open an issue on GitHub. For bugs, the bug report template asks for repro steps, the
tool involved, and your environment — please fill it in; it makes triage much faster.

## License

By contributing you agree that your contributions are licensed under the project's
[MIT License](./LICENSE).
