// Fixture for the A-11 Node-gate spawn test (tests/utils/assert-node.test.ts).
//
// Simulates a Node <20 runtime by stubbing process.version/process.versions.node
// BEFORE importing src/utils/assert-node.ts, then imports it. The module's own
// top-level self-check (`assertNodeVersion()` called at the bottom of that file)
// must print the FATAL message to stderr and exit(1) — proving the REAL
// default-argument auto-run path (not just the injectable core function) works
// against an actual separate Node process, without needing a real Node <20
// runtime installed on the test machine.
Object.defineProperty(process, "version", { value: "v18.20.4", configurable: true });
Object.defineProperty(process.versions, "node", { value: "18.20.4", configurable: true });

await import("../../src/utils/assert-node.js");

// Unreachable if the gate worked (assertNodeVersion() calls process.exit(1)
// before this module's static import resolves control back here).
console.log("NODE_GATE_DID_NOT_EXIT");
