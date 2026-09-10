/**
 * assert-node.ts — fail LOUD on Node <20 instead of silently misbehaving (A-11).
 *
 * package.json declares `"engines": { "node": ">=20.0.0" }`, but npm's default
 * engines check is a WARNING, not a hard stop — no `engine-strict` .npmrc ships
 * in this package. On an unsupported runtime the server previously continued
 * past startup into whatever runtime error it happened to hit first (missing
 * native fetch/streams/structuredClone, etc.), instead of a clear one-line
 * diagnosis at the door.
 *
 * Import this as the FIRST import in every entry point (index.ts, cli.ts),
 * before the MCP SDK or any other heavy import — so the version check runs at
 * module load, ahead of anything that could itself fail confusingly on an old
 * runtime.
 */
export declare const MIN_NODE_MAJOR = 20;
/** Parses the major version number out of a Node version string, e.g. "20.11.24" or "v18.20.4". Returns 0 if unparsable. */
export declare function parseNodeMajor(versionString: string): number;
/**
 * Checks the running Node major version and exits with a clear stderr message
 * if it is below MIN_NODE_MAJOR. Accepts an injectable version string + exit
 * function so the gate is unit-testable without spawning a real old-Node
 * process (see tests/utils/assert-node.test.ts for the injected-version unit
 * tests, and tests/fixtures/node-gate-old.ts + the spawn-based test for proof
 * against the REAL default-arg auto-run path below).
 *
 * A major of 0 (unparsable version string) is treated as "cannot verify" and
 * does NOT trigger the gate — never false-positive-block a runtime whose
 * version string this function doesn't recognize.
 */
export declare function assertNodeVersion(versionString?: string, exit?: (code: number) => void): void;
//# sourceMappingURL=assert-node.d.ts.map