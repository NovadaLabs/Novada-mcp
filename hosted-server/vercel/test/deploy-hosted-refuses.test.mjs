/**
 * scripts/deploy-hosted.sh must REFUSE its Vercel deploy phase unless
 * --vercel-standby is passed (audit row q, 2026-11-21: production is EC2, the
 * Vercel project is paused). Refusal happens before any build/deploy work, so
 * these tests are fast and touch nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "deploy-hosted.sh");

test("no flag -> exit 2, points at ec2/deploy-ec2.sh, runs no phase", () => {
  const r = spawnSync("bash", [SCRIPT], { encoding: "utf8", env: { ...process.env, NOVADA_MCP_KEY: "", NOVADA_API_KEY: "" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /production deploys use hosted-server\/ec2\/deploy-ec2\.sh/);
  assert.doesNotMatch(r.stdout + r.stderr, /phase: BUILD/);
});

test("unknown flag still exits 1 and names both supported flags", () => {
  const r = spawnSync("bash", [SCRIPT, "--bogus"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--vendor-only, --vercel-standby/);
});

test("source: --vendor-only still precedes the refusal check, and phase 4 re-asserts the standby flag", () => {
  const src = readFileSync(SCRIPT, "utf8");
  assert.match(src, /"\$VENDOR_ONLY" != "true" && "\$VERCEL_STANDBY" != "true"/);
  assert.match(src, /\[\[ "\$VERCEL_STANDBY" == "true" \]\] \|\| abort/);
});
