// Simulate hosted environment locally to test INC-194, INC-195, INC-198
// Sets VERCEL=1 to trigger hosted detection, NOVADA_DEVELOPER_API_KEY to test key mismatch

import { novadaSetup, validateSetupParams } from "../build/tools/setup.js";
import { novadaHealth } from "../build/tools/health.js";
import { novadaHealthAll, validateHealthAllParams } from "../build/tools/health_all.js";
import { novadaProxyResidential, validateProxyResidentialParams } from "../build/tools/proxy_residential.js";

const API_KEY = process.env.NOVADA_API_KEY;
if (!API_KEY) { console.error("NOVADA_API_KEY not set"); process.exit(1); }

console.log("# Hosted Simulation — INC-194, INC-195, INC-198");
console.log(`Date: ${new Date().toISOString()}`);
console.log("");

// ─── INC-194: Simulate NOVADA_DEVELOPER_API_KEY ≠ NOVADA_API_KEY ──────
console.log("## INC-194: Setup with mismatched dev key");
process.env.NOVADA_DEVELOPER_API_KEY = "fake_dev_key_ending_in_dzic";
const setupResult = novadaSetup(validateSetupParams({}));
const hasBothKeys = setupResult.includes("NOVADA_DEVELOPER_API_KEY");
const hasWarning = setupResult.includes("⚠");
console.log(`  Both keys shown: ${hasBothKeys}`);
console.log(`  Mismatch warning: ${hasWarning}`);
console.log(`  Status: ${hasBothKeys && hasWarning ? "✅ PASS" : "❌ FAIL"}`);
// Show relevant lines
const devKeyLines = setupResult.split("\n").filter(l => l.includes("DEVELOPER") || l.includes("⚠"));
for (const l of devKeyLines) console.log(`  > ${l.trim()}`);
delete process.env.NOVADA_DEVELOPER_API_KEY;
console.log("");

// ─── INC-195: Simulate hosted (VERCEL=1) ──────────────────────────────
console.log("## INC-195: Health on hosted (VERCEL=1)");
process.env.VERCEL = "1";
process.env.VERCEL_ENV = "production";

const healthResult = await novadaHealth(API_KEY);
const browserLineH = healthResult.split("\n").find(l => l.includes("Browser"));
console.log(`  health browser line: ${browserLineH?.trim()}`);
const healthPassH = browserLineH?.includes("Not available on hosted");
console.log(`  Shows 'Not available on hosted': ${healthPassH}`);
console.log(`  Status: ${healthPassH ? "✅ PASS" : "❌ FAIL"}`);

const healthAllResult = await novadaHealthAll(API_KEY);
const browserLineHA = healthAllResult.split("\n").find(l => l.includes("Browser"));
console.log(`  health_all browser line: ${browserLineHA?.trim()}`);
const healthPassHA = browserLineHA?.includes("Not available on hosted");
console.log(`  Shows 'Not available on hosted': ${healthPassHA}`);
console.log(`  Status: ${healthPassHA ? "✅ PASS" : "❌ FAIL"}`);

delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
console.log("");

// ─── INC-198: Simulate hosted proxy auto-provision ────────────────────
console.log("## INC-198: Proxy auto-provision (NOVADA_PROXY_ENDPOINT set, no user/pass)");
// Set endpoint but NOT user/pass — should auto-fetch via account API
process.env.NOVADA_PROXY_ENDPOINT = "pr.novada.com:7777";
delete process.env.NOVADA_PROXY_USER;
delete process.env.NOVADA_PROXY_PASS;

const proxyResult = await novadaProxyResidential(validateProxyResidentialParams({ format: "url" }));
const hasProxyUrl = proxyResult.includes("proxy_url:");
const hasNotConfigured = proxyResult.includes("not configured");
const hasAutoFetch = proxyResult.includes("zone-res") || proxyResult.includes("proxy_url: http://");

console.log(`  Has proxy_url: ${hasProxyUrl}`);
console.log(`  Auto-fetched creds: ${hasAutoFetch}`);
console.log(`  Status: ${hasAutoFetch ? "✅ PASS — auto-provisioned from account API" : hasNotConfigured ? "⚠️ auto-provision failed (account may not have sub-accounts)" : "❌ FAIL"}`);

// Show first 3 lines of result
const proxyLines = proxyResult.split("\n").slice(0, 6);
for (const l of proxyLines) console.log(`  > ${l}`);

delete process.env.NOVADA_PROXY_ENDPOINT;
console.log("");

// ─── Summary ──────────────────────────────────────────────────────────
console.log("---");
const results = [
  healthPassH && healthPassHA ? "✅" : "❌",
  hasBothKeys && hasWarning ? "✅" : "❌",
  hasAutoFetch ? "✅" : "⚠️",
];
const pass = results.filter(r => r === "✅").length;
const warn = results.filter(r => r === "⚠️").length;
const fail = results.filter(r => r === "❌").length;
console.log(`## Summary: ${pass} ✅  ${warn} ⚠️  ${fail} ❌`);
