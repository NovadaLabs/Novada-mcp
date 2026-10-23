#!/usr/bin/env node
/**
 * copy-server-assets.mjs — post-tsc step for `npm run build:server` (EC2 target
 * only; never invoked by the Vercel build).
 *
 * `tsc -p tsconfig.server.json` only compiles api/**\/*.ts + server.mts into
 * dist/ — it does not touch plain .js files or non-TS directories. Two things
 * the compiled output needs at runtime are NOT .ts sources, so tsc never
 * copies them into dist/ on its own:
 *
 *   1. api/_polyfills.js — imported (side-effect only) by api/mcp.ts as
 *      "./_polyfills.js". Already plain JS; copied through unchanged.
 *   2. vendor/ — already-compiled JS (the npm-package build output), imported
 *      via relative paths like "../vendor/novada-mcp/tools/index.js" and one
 *      `with { type: "json" }` import of vendor/novada-mcp/package.json.
 *      Copied wholesale so those relative paths resolve the same way from
 *      dist/api/*.js as they do from the uncompiled api/*.ts today.
 *
 * Never edit vendor/ by hand (see repo CLAUDE.md) — this script only reads it.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // hosted-server/vercel/
const DIST = join(ROOT, "dist");

if (!existsSync(DIST)) {
  console.error(`[copy-server-assets] ${DIST} does not exist — run tsc first.`);
  process.exit(1);
}

// 1. api/_polyfills.js
mkdirSync(join(DIST, "api"), { recursive: true });
cpSync(join(ROOT, "api", "_polyfills.js"), join(DIST, "api", "_polyfills.js"));

// 2. vendor/ (wholesale, already-built JS)
cpSync(join(ROOT, "vendor"), join(DIST, "vendor"), { recursive: true });

console.log("[copy-server-assets] copied api/_polyfills.js and vendor/ into dist/");
