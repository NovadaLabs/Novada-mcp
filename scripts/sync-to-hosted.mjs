#!/usr/bin/env node
// NOV-578 #7 — deterministic re-vendor of the novada-mcp npm build into the hosted Vercel
// server. Replaces the manual `rm -rf vendor && cp -r build/*` that was the root cause of
// past hosted incidents (stale / partial vendor, or a dep the build uses missing on hosted).
//
// Usage:  npm run sync:hosted            (wired in vercel/package.json)
//    or:  node scripts/sync-to-hosted.mjs
//         NOVADA_MCP_SRC=/path/to/novada-mcp   overrides the source package location.
//
// Steps:
//   1. wipe + recreate vercel/vendor/novada-mcp
//   2. faithfully copy build/* + package.json  (HOSTED_VERSION derives from package.json)
//   3. barrel-load gate: dynamically import the vendored tools/index.js so a broken / stale /
//      missing-dep copy fails HERE, not in production.
//
// NOTE on the "account-file allowlist" from the NOV-578 / NOV-572 audit: the tools/index.js
// barrel RE-EXPORTS capture_apikey / scraper_task_mgmt / static_ip_mgmt, and vercel/api/mcp.ts
// imports that barrel. Physically excluding those files would break the barrel import and crash
// the whole endpoint on load. They are harmless on hosted (not in the served TOOLS catalog, no
// secrets in code, hosted secrets redacted) — assessed acceptable and NOV-572 closed on that
// merit. So we vendor FAITHFULLY (zero drift from the npm build) rather than hand-prune.

import { rm, cp, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // .../novada-mcpserver/scripts
const REPO = path.resolve(HERE, "..");                     // .../novada-mcpserver
const VENDOR = path.join(REPO, "vercel", "vendor", "novada-mcp");
const SRC = path.resolve(process.env.NOVADA_MCP_SRC || path.join(REPO, "..", "novada-mcp"));

async function main() {
  const buildDir = path.join(SRC, "build");
  const pkgFile = path.join(SRC, "package.json");
  if (!existsSync(buildDir)) {
    console.error(`✗ novada-mcp build not found at ${buildDir}`);
    console.error(`  Run \`npm run build\` in ${SRC} first, or set NOVADA_MCP_SRC.`);
    process.exit(1);
  }

  // 1. wipe + recreate the vendor tree
  await rm(VENDOR, { recursive: true, force: true });
  await mkdir(VENDOR, { recursive: true });

  // 2. faithful copy of build/* + package.json
  await cp(buildDir, VENDOR, { recursive: true });
  await cp(pkgFile, path.join(VENDOR, "package.json"));
  const pkg = JSON.parse(await readFile(path.join(VENDOR, "package.json"), "utf8"));

  // 3. barrel-load gate — a broken/stale/missing-dep copy fails HERE, not in prod. Deps resolve
  //    from vercel/node_modules (module resolution walks up from the vendored file path).
  const barrel = pathToFileURL(path.join(VENDOR, "tools", "index.js")).href;
  try {
    await import(barrel);
  } catch (e) {
    console.error(`✗ barrel-load gate FAILED — the vendored tree does not import cleanly:`);
    console.error(`  ${e?.message ?? e}`);
    console.error(`  Likely a dependency the npm build now uses is missing from vercel/package.json,`);
    console.error(`  or the build itself is broken. Fix before deploying — do NOT ship this vendor.`);
    process.exit(1);
  }

  console.log(`✓ re-vendored novada-mcp@${pkg.version} → vercel/vendor/novada-mcp`);
  console.log(`✓ barrel-load gate passed (tools/index.js imported clean)`);
  console.log(`  next: cd vercel && npm run typecheck && npm run deploy`);
  console.log(`  ⚠ if the npm build added new deps, add them to vercel/package.json BEFORE deploy.`);
}

main().catch((e) => {
  console.error("✗ re-vendor failed:", e?.message ?? e);
  process.exit(1);
});
