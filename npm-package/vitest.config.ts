import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Never add --changed/--related to the `vitest run` invocation (here or in
    // package.json/CI) — the interaction-matrix guarantee ("shared-code change
    // re-validates every sibling tool") depends on the full suite always running.
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Vitest's 5s default is too tight for the COVERAGE run — and `npm run
    // test:coverage` is what ci.yml actually executes. Measured 2026-07-30:
    // v8 instrumentation stretches aggregate test time ~3.6x (29s bare ->
    // 105s with coverage), so slower mock-heavy specs randomly blew the 5s
    // budget. The failing set DRIFTED between runs (f6-f11 -> none ->
    // sdk/client+crawl+extract-markdown), i.e. contention flake, never a
    // logic fault: re-running the same suite at --testTimeout=30000 turned
    // every one of them green. 20s keeps a genuinely hung test failing fast
    // enough while removing a CI-red generator unrelated to code quality.
    // Do NOT raise this to paper over a test that is legitimately slow —
    // fix the test instead.
    testTimeout: 20_000,
    // Strips leaked NOVADA_* env vars before each test so credential-fallback
    // branches are deterministic regardless of the operator's shell. See tests/setup.ts.
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Ratchet gate, not a target. Measured baseline (v8 provider, `npm test --
      // --coverage`, 92 files / 1661 tests, 2026-07-19, no runtime changes):
      //   statements 74.07%  branches 75.91%  functions 78.21%  lines 74.07%
      // Thresholds below are set ~2 points under that measured baseline (global/
      // aggregate — NOT perFile; several files sit at 0% by design, e.g. cli.ts
      // and index.ts are process-entry glue exercised by e2e/manual runs, not
      // unit tests) so today's suite passes green with headroom for normal
      // variance, while a real regression (a change that drops aggregate
      // coverage by more than ~2 points) fails the build. Re-measure and raise
      // these numbers deliberately when coverage genuinely improves — never
      // lower them to make a failing PR pass.
      thresholds: {
        statements: 72,
        lines: 72,
        functions: 76,
        branches: 73,
      },
    },
  },
});
