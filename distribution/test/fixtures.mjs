// distribution/test/fixtures.mjs — shared temp-fixture builder for the check.mjs / generate.mjs
// test suite. Every fixture lives under os.tmpdir() and is deleted after use; nothing here ever
// touches the real worktree (brief-A PHASE 5 invariant: "temp copies only — never mutate the
// real tree in tests").
//
// No top-level side effects (safe to import even if node --test's directory scan loads this
// file directly — it exports helpers only, it has nothing that itself qualifies as a test).

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { generateAll, isClosedShapeRow, repinRow, readPinnedHashes } from "../generate.mjs";

const REAL_ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");

function writeFileDeep(root, relPath, content) {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/**
 * A fully self-consistent, SYNTHETIC distribution tree: real distribution/channels.json +
 * distribution/listing.json (the actual registry under test), plus a minimal set of
 * manifest files built to be clean by construction. The generate.mjs-owned rows are
 * finalized by actually calling generateAll() against this fixture (not by hand-duplicating
 * its field-value logic), so "green" means "what generate.mjs itself considers correct",
 * not "what the test author assumed it should be".
 */
export function buildGreenFixture() {
  const root = mkdtempSync(join(tmpdir(), "novada-dist-test-"));

  // The two registry files under test — copied verbatim from the real worktree.
  const channelsRaw = readFileSync(join(REAL_ROOT, "distribution", "channels.json"), "utf8");
  const listingRaw = readFileSync(join(REAL_ROOT, "distribution", "listing.json"), "utf8");
  writeFileDeep(root, "distribution/channels.json", channelsRaw);
  writeFileDeep(root, "distribution/listing.json", listingRaw);
  const listing = JSON.parse(listingRaw);

  const version = "1.2.3"; // synthetic — decoupled from whatever the real repo's version is today
  writeFileDeep(
    root,
    "npm-package/package.json",
    JSON.stringify({ name: "novada-mcp", version, description: "fixture package.json", type: "module" }, null, 2) + "\n"
  );

  // mcp-registry row: NOT owned by generate.mjs — must already be internally consistent,
  // mirroring what npm-package/scripts/gen-server-json.mjs would have produced. `remotes[0].url`
  // is VERIFY-ONLY (brief-F R1's url_field without owned_fields) so it must already equal
  // listing.hosted_endpoint here, same as every other already-correct owned-field seed above.
  writeFileDeep(
    root,
    "npm-package/server.json",
    JSON.stringify(
      {
        $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
        name: "io.github.NovadaLabs/novada-mcp",
        description: "Search, extract, crawl, map, research, scrape 16 platforms, browser automation, proxy — one API key.",
        version,
        tools: [{ name: "novada_search", description: "Search the web." }],
        // brief-I (2026-10-15, I1): closed_shape's pinned_fields now asserts
        // packages[0].identifier/transport.type exactly — this fixture must carry a packages
        // entry (the real server.json does) for the green baseline to stay green under that
        // new, stricter assertion; previously the fixture omitted it entirely (closed_shape's
        // allowlist check is lenient when the array is absent, but pinned_fields is not — a
        // declared pin is a "must exist with exactly this value" assertion, not optional).
        packages: [
          {
            registryType: "npm",
            identifier: "novada-mcp",
            version,
            transport: { type: "stdio" },
            environmentVariables: [{ name: "NOVADA_API_KEY", description: "Your Novada API key.", isRequired: true, isSecret: true, format: "string" }],
          },
        ],
        remotes: [
          {
            type: "streamable-http",
            url: "https://mcp.novada.com/mcp",
            headers: [{ name: "Authorization", description: "Bearer <NOVADA_API_KEY>", isRequired: true, isSecret: true }],
          },
        ],
      },
      null,
      2
    ) + "\n"
  );

  // glama row: no owned fields at all — just needs to exist and parse.
  writeFileDeep(root, "npm-package/glama.json", JSON.stringify({ $schema: "https://glama.ai/mcp/schemas/server.json", maintainers: ["Goldentrii"] }, null, 2) + "\n");

  // claude-code-plugin row — seeded with WRONG owned-field placeholders on purpose; generateAll()
  // below is what makes this fixture green, exercising the real write path instead of a
  // hand-duplicated "expected" value.
  writeFileDeep(
    root,
    "npm-package/.claude-plugin/plugin.json",
    JSON.stringify({ name: "placeholder", description: "placeholder", version: "0.0.0" }, null, 2) + "\n"
  );

  // claude-code-marketplace row
  writeFileDeep(
    root,
    "npm-package/.claude-plugin/marketplace.json",
    JSON.stringify(
      {
        name: listing.name,
        owner: { name: "NovadaLabs", email: "support@novada.com" },
        plugins: [
          {
            name: listing.name,
            description: "placeholder",
            source: { source: "url", url: "https://github.com/NovadaLabs/novada-mcp.git", sha: "0000000000000000000000000000000000000000" },
            homepage: "https://github.com/NovadaLabs/novada-mcp",
          },
        ],
      },
      null,
      2
    ) + "\n"
  );

  // smithery row — top-level unindented `name`/`description`, plus one NESTED (indented)
  // `description:` line inside a fake tools array to prove the yaml writer leaves it alone.
  // startCommand carries configSchema + commandFunction (brief-I, 2026-10-15, I1) mirroring
  // the real file's shape — closed_shape's pinned_fields now asserts both startCommand.type AND
  // startCommand.commandFunction exactly, so the fixture must actually carry a commandFunction
  // key (the prior fixture omitted it, which is fine for closed_shape's allowlist check — lenient
  // when a key is simply absent — but NOT for a declared pinned_fields assertion, which treats a
  // missing pointer as a mismatch, same reasoning as the server.json packages[] fixture change).
  writeFileDeep(
    root,
    "npm-package/smithery.yaml",
    [
      "name: novada-mcp",
      'description: "placeholder"',
      "startCommand:",
      "  type: stdio",
      "  configSchema:",
      "    type: object",
      "    properties:",
      "      novadaApiKey:",
      "        type: string",
      "    required:",
      "      - novadaApiKey",
      "  commandFunction: |",
      "    config => ({ command: 'npx', args: ['-y', 'novada-mcp'], env: { NOVADA_API_KEY: config.novadaApiKey } })",
      "tools:",
      "  - name: novada_search",
      '    description: "Search the web and get clean, ready-to-use content. 16 platforms mentioned here on purpose — this nested, nested-field is NOT owned by the smithery row and must stay untouched by the yaml-owned-fields writer."',
      "",
    ].join("\n")
  );

  // Known orphan — hosted-server/smithery.yaml. No owned/verified fields; just needs to parse.
  writeFileDeep(
    root,
    "hosted-server/smithery.yaml",
    ["startCommand:", "  type: http", "  configSchema:", "    type: object", "    properties: {}", ""].join("\n")
  );

  // gemini-cli row — repo ROOT, seeded with WRONG owned-field placeholders (same pattern as
  // claude-code-plugin above); generateAll() below fixes name/version/description. mcpServers
  // is NOT an owned field (generate.mjs never touches it) so it's written correctly up front.
  writeFileDeep(
    root,
    "gemini-extension.json",
    JSON.stringify(
      { name: "placeholder", version: "0.0.0", description: "placeholder", mcpServers: { novada: { httpUrl: "https://mcp.novada.com/mcp" } } },
      null,
      2
    ) + "\n"
  );

  // antigravity-plugin row — no version field (confirmed: plugin.json's schema is
  // additionalProperties:false with only name/description). Seeded wrong on purpose.
  writeFileDeep(
    root,
    "distribution/plugins/antigravity/plugin.json",
    JSON.stringify({ name: "placeholder", description: "placeholder" }, null, 2) + "\n"
  );
  // antigravity-mcp-config row — no owned/verified fields at all (same shape as glama.json);
  // just needs to exist and parse, correct from the start.
  writeFileDeep(
    root,
    "distribution/plugins/antigravity/mcp_config.json",
    JSON.stringify({ mcpServers: { novada: { serverUrl: "https://mcp.novada.com/mcp" } } }, null, 2) + "\n"
  );

  // openai-codex-plugin row — has version, seeded wrong on purpose.
  writeFileDeep(
    root,
    "distribution/plugins/openai/.codex-plugin/plugin.json",
    JSON.stringify(
      { name: "placeholder", version: "0.0.0", description: "placeholder", mcpServers: "./.mcp.json" },
      null,
      2
    ) + "\n"
  );
  // openai-codex-mcp-config row — url_field + required_fields owned/verified (brief-F R1/R3);
  // seeded correct from the start (its url_field value is finalized by generateAll() below same
  // as every other owned field, so this merely needs to already parse+exist).
  writeFileDeep(
    root,
    "distribution/plugins/openai/.mcp.json",
    JSON.stringify({ mcpServers: { novada: { type: "http", url: "https://mcp.novada.com/mcp" } } }, null, 2) + "\n"
  );

  // brief-F: a minimal, internally-consistent built-registry tree so endpoint_equal/field_shape
  // (which only read channels.json rows' manifest files, no build/ needed) AND claims_consistent
  // (which DOES need a built registry to compute its facts) all have something real to read,
  // without needing this fixture to depend on actually running `tsc`/webpack against npm-package.
  // Kept deliberately tiny (5 tools, 2 platforms) — the fixture's own claim_surfaces files below
  // are written to make ZERO claims, so these exact numbers only matter to the mutation tests
  // that assert a SPECIFIC got=/want=.
  writeFileDeep(
    root,
    "npm-package/build/core.js",
    [
      "export const TOOLS = [",
      '  { name: "novada_search", description: "Search the web." },',
      '  { name: "novada_extract", description: "Extract a URL." },',
      '  { name: "novada_scrape_amazon", description: "Scrape Amazon." },',
      '  { name: "novada_scrape_google", description: "Scrape Google." },',
      '  { name: "novada_browser", description: "Drive a browser." },',
      "];",
      "",
    ].join("\n")
  );
  writeFileDeep(
    root,
    "npm-package/build/data/scraper_catalog.js",
    ['export const WORKING_PLATFORM_NAMES = ["Amazon", "Google"];', ""].join("\n")
  );
  // Mirrors the real hosted-server/vercel/api/mcp.ts's literal shape that
  // check.mjs's parseHostedHiddenNames() textually parses — NOT imported/compiled, so this
  // fixture never needs a second (hosted-server) build pipeline wired in.
  writeFileDeep(
    root,
    "hosted-server/vercel/api/mcp.ts",
    ['const HOSTED_HIDDEN = new Set([', '  "novada_browser",', "]);", "export {};", ""].join("\n")
  );
  // facts for this fixture, derived the SAME way computeFacts() derives them: tools=5,
  // hosted_tools=5-1=4, platforms=2, scrapers=2 (novada_scrape_amazon, novada_scrape_google).

  // brief-F R2/ci_paths_cover: a minimal workflow file with NO `paths:` filter at all — the
  // documented "drop the filter" fix, which trivially covers every row with zero fixture
  // maintenance burden as new rows are added. Red-fixture tests below add a scoped `paths:`
  // filter explicitly to exercise the check's actual coverage logic.
  writeFileDeep(
    root,
    ".github/workflows/ci.yml",
    ["name: CI", "", "on:", "  push:", "    branches: [main]", "  workflow_dispatch: {}", ""].join("\n")
  );

  // brief-F R10/claims_consistent: minimal claim_surfaces files that make ZERO "<N> <noun>"
  // claims — the green baseline passes trivially; red-fixture tests below mutate these to
  // introduce a specific wrong claim.
  writeFileDeep(root, "README.md", "# novada-mcp\n\nSee docs/TOOLS.md for the full tool reference.\n");
  writeFileDeep(root, "npm-package/README.md", "# novada-mcp (npm package)\n\nSee the repo root README.\n");
  writeFileDeep(root, "docs/TOOLS.md", "# Tool reference\n\nNo counts stated here in this fixture.\n");
  writeFileDeep(root, "hosted-server/landing/index.html", "<!doctype html><title>novada-mcp</title>\n");

  // Finalize every generate.mjs-owned field through the REAL write path — this is what
  // actually makes the fixture "green": it is green because generate.mjs says so, not
  // because this helper duplicated its field-value logic by hand.
  generateAll(root, { checkOnly: false });

  // brief-J (2026-10-15, J1): establish this fixture's OWN whole-file tamper-evidence baseline
  // through the REAL --repin path (generate.mjs's repinRow), exactly mirroring how the real
  // worktree's distribution/pinned-hashes.json was established — never a hand-duplicated hash.
  // This fixture's own server.json/marketplace.json/smithery.yaml/glama.json content is
  // DELIBERATELY synthetic (a different version, a different tools list, a placeholder git sha)
  // from the real worktree's files, so the real worktree's pinned-hashes.json would never match
  // it anyway; this fixture carries its own, self-consistent pin.
  {
    const channels = readJson(root, "distribution/channels.json");
    const pinned = readPinnedHashes(root);
    for (const row of channels.rows) {
      if (!isClosedShapeRow(row)) continue;
      repinRow(root, row, pinned);
    }
    writeFileDeep(root, "distribution/pinned-hashes.json", JSON.stringify(pinned, null, 2) + "\n");
  }

  return root;
}

/** Deep-copies a fixture root to a new temp directory so a test can mutate it freely. */
export function cloneFixture(srcRoot) {
  const dest = mkdtempSync(join(tmpdir(), "novada-dist-test-clone-"));
  cpSync(srcRoot, dest, { recursive: true });
  return dest;
}

export function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), "utf8"));
}

export function writeJson(root, relPath, obj) {
  writeFileDeep(root, relPath, JSON.stringify(obj, null, 2) + "\n");
}

export function writeText(root, relPath, text) {
  writeFileDeep(root, relPath, text);
}

export function cleanupFixture(root) {
  rmSync(root, { recursive: true, force: true });
}
