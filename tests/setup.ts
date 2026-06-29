/**
 * Global vitest setup — wired via vitest.config `setupFiles`.
 *
 * Two jobs, both about test determinism (NOT about the production code under test):
 *
 * 1. Env hygiene. The dev shell that runs the suite often exports real NOVADA_*
 *    credentials (NOVADA_API_KEY etc.). Credential getters fall back to
 *    NOVADA_API_KEY, so a leaked key silently flips "key absent" branches and
 *    makes tests like `getWebUnblockerKey() === undefined` or the
 *    render→render-failed fallback fail depending on the operator's shell. We snapshot
 *    and strip every NOVADA_* var before each test and restore the snapshot afterwards,
 *    so a test that explicitly sets one still works and nothing leaks across files.
 *
 * 2. Network safety net. A unit test must never hit the real network. Most suites
 *    mock axios at the top of the file (hoisted `vi.mock("axios")`); this file does
 *    NOT install a competing global mock — doing so would shadow those carefully
 *    shaped per-file mocks. Instead it leaves axios alone and only guarantees the
 *    credential surface is clean. (Tests that forgot to mock axios were already
 *    failing on `main`; fixing each of those is out of scope here and is tracked
 *    separately — see the file-local `vi.mock` placement bugs.)
 */
import { afterEach, beforeEach } from "vitest";

/** Snapshot of every NOVADA_* env var captured before a test strips them. */
let savedNovadaEnv: Record<string, string | undefined> = {};

function novadaKeys(): string[] {
  return Object.keys(process.env).filter((k) => k.startsWith("NOVADA_"));
}

beforeEach(() => {
  savedNovadaEnv = {};
  for (const key of novadaKeys()) {
    savedNovadaEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  // Remove anything a test set, then restore the original shell snapshot exactly.
  for (const key of novadaKeys()) {
    if (!(key in savedNovadaEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(savedNovadaEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
