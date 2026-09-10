/**
 * MEDIUM-2 review fix (reports/review-fix-eval-f-rows-2026-09-10.md, commit 2b9a21a):
 * the unauth-tier WIRING in src/index.ts — the `runUnauthenticatedTier()` wrap around
 * dispatch() and the UNAUTH_TIER_DISCLOSURE content-block append inside the
 * CallToolRequest handler — was revert-invisible. gate.test.ts pins the gate
 * primitives, key-state-consistency.test.ts creates the tier context ITSELF around
 * dispatch(), and the stdio e2e pins only refusal paths, so deleting the index.ts
 * glue kept the entire suite green while silently reopening E2 (keyless extract
 * writing to ~/Downloads with no disclosure).
 *
 * This suite exercises the REAL dispatch path in-process: the real src/index.ts
 * module (real NovadaMCPServer, real SDK Server, real CallToolRequest handler, real
 * gate → dispatch → saveOutput glue) served over the MCP SDK's own InMemoryTransport
 * and driven by a real MCP Client — no reimplementation of any wiring under test.
 *
 * WHY THIS FILE MAY IMPORT src/index.ts (repo convention says tests never do — see
 * tests/tools/discover.test.ts header): the hazard behind that convention is the
 * module-top-level STDIO boot, not the module itself. Here StdioServerTransport is
 * substituted (vi.mock) with the server half of an InMemoryTransport pair, so the
 * boot never touches process stdin/stdout, and process.argv is sanitized around the
 * import so the --list-tools/--help process.exit branches are unreachable.
 * Everything else in the graph is REAL except:
 *   - axios              (mocked — no network; same shapes as key-state-consistency),
 *   - fs/promises        (writeFile/mkdir spied — no real ~/Downloads writes),
 *   - usage-log          (disabled via its own documented switch NOVADA_MCP_LOG=off),
 *   - first-run notice   (disabled via NOVADA_DISABLE_FIRST_RUN_NOTICE).
 *
 * REVERT CANARY (verified RED at authoring time): replace index.ts's tier ternary
 * with a plain `await dispatch(...)` and delete the disclosure push — the keyless
 * extract test below fails (disclosure block missing, `path:` header reappears).
 * That closes the tautology MEDIUM-2 describes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { UNAUTH_TIER_DISCLOSURE } from "../../src/_core/gate.js";

vi.mock("axios");

// vi.hoisted: the mock factories below are hoisted above module consts, so shared
// state they close over must be created in a hoisted block (same pattern as
// tests/_core/key-state-consistency.test.ts).
const { writeFileSpy, mkdirSpy, transportHolder } = vi.hoisted(() => ({
  writeFileSpy: vi.fn(async () => undefined),
  mkdirSpy: vi.fn(async () => undefined),
  transportHolder: { clientSide: undefined as unknown },
}));

// Never let this suite reach the real filesystem's write path — reads stay real.
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    writeFile: (...args: unknown[]) => writeFileSpy(...args),
    mkdir: (...args: unknown[]) => mkdirSpy(...args),
  };
});

// The transport substitution that makes importing index.ts safe: its stdio boot
// connects the REAL Server to the server half of an in-memory pair; the client
// half is exposed for the test's real MCP Client.
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", async () => {
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  return {
    StdioServerTransport: function StdioServerTransportInMemory() {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      transportHolder.clientSide = clientSide;
      return serverSide;
    } as unknown as (typeof import("@modelcontextprotocol/sdk/server/stdio.js"))["StdioServerTransport"],
  };
});

/** Syntactically plausible but non-functional — never reaches the network here. */
const INVALID_KEY = "sk-test-invalid-0000000000000000";

// Same fixture page as tests/_core/key-state-consistency.test.ts — passes extract's
// static-quality threshold so the basic direct fetch never attempts escalation.
const SAMPLE_HTML = `
  <html>
    <head><title>Test Page</title><meta name="description" content="A test page"></head>
    <body><main>
      <h1>Main Content</h1>
      <p>This is the main content of the page with enough text to pass the threshold for
      content extraction. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
      eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.</p>
    </main></body>
  </html>
`;

/**
 * The classification = the bracketed error code + the failure_class line — exactly
 * the two fields the F12 contract pins across key states. Extracted (not the whole
 * message) because the keyless refusal is a local gate string while the invalid-key
 * refusal is an upstream-classified error: the CLASSIFICATION must be byte-identical,
 * the prose around it legitimately differs.
 */
function classificationOf(text: string): string {
  const code = text.match(/Error \[([A-Z_]+)\]/)?.[1] ?? "(no code)";
  const failureClass = text.match(/^failure_class: .+$/m)?.[0] ?? "(no failure_class)";
  return `${code}\n${failureClass}`;
}

/** Both key states must classify to exactly this — asserting each against the same
 *  pinned constant makes the cross-state comparison byte-identical by transitivity. */
const PINNED_AUTH_CLASSIFICATION = "INVALID_API_KEY\nfailure_class: auth";

function textsOf(res: unknown): string[] {
  const content = (res as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string);
}

function isErrorOf(res: unknown): boolean {
  return (res as { isError?: boolean }).isError === true;
}

const openClients: Client[] = [];

afterEach(async () => {
  for (const c of openClients.splice(0)) {
    try {
      await c.close();
    } catch {
      // already closed by the paired transport — fine
    }
  }
});

/**
 * Boot the REAL entry module fresh (index.ts reads NOVADA_API_KEY at module load,
 * so each key state needs its own module generation) and connect a real MCP Client
 * to it over the in-memory pair.
 */
async function bootServer(env: Record<string, string>): Promise<{
  client: Client;
  axios: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
}> {
  vi.resetModules();
  vi.clearAllMocks();
  transportHolder.clientSide = undefined;

  // Call-time env switches — read per call, and tests/setup.ts strips NOVADA_*
  // before every test, so they must be (re)set inside each test's boot:
  process.env.NOVADA_MCP_LOG = "off"; // usage-log kill switch (no ~/.novada-mcp/logs writes)
  process.env.NOVADA_DISABLE_FIRST_RUN_NOTICE = "1"; // no ~/.novada-mcp/first-run.json access
  delete process.env.NOVADA_API_KEY;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  // Same-generation axios automock as the graph index.ts is about to import.
  const axiosMod = vi.mocked((await import("axios")).default, true);
  axiosMod.get.mockResolvedValue({ data: SAMPLE_HTML });
  axiosMod.post.mockResolvedValue({ data: { code: 10001, msg: "invalid key" } });

  // Import the REAL entry module. argv sanitized so the --list-tools/--help
  // process.exit branches can never fire inside the test worker.
  const argv = process.argv;
  process.argv = argv.slice(0, 2);
  try {
    await import("../../src/index.js");
  } finally {
    process.argv = argv;
  }

  if (!transportHolder.clientSide) {
    throw new Error("index.ts boot did not construct its transport — wiring changed?");
  }
  const client = new Client(
    { name: "unauth-tier-wiring-pin", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(transportHolder.clientSide as Transport);
  openClients.push(client);
  return { client, axios: { get: axiosMod.get as ReturnType<typeof vi.fn>, post: axiosMod.post as ReturnType<typeof vi.fn> } };
}

describe("MEDIUM-2: unauth-tier wiring pinned through the REAL index.ts dispatch path", () => {
  it("keyless novada_extract is SERVED with UNAUTH_TIER_DISCLOSURE appended and no path: header (E2)", async () => {
    const { client } = await bootServer({});

    const res = await client.callTool({
      name: "novada_extract",
      arguments: { url: "https://example.com/wiring-keyless" },
    });
    const texts = textsOf(res);
    const joined = texts.join("\n---\n");

    // (a) SERVED — the gate admitted the keyless basic fetch and real extract
    // content came back through the real handler.
    expect(isErrorOf(res)).toBe(false);
    expect(joined).toContain("Test Page");
    expect(joined).toContain("Main Content");

    // The disclosure must arrive as its OWN content block, byte-equal to the pinned
    // constant. REVERT CANARY: deleting index.ts's disclosure push fails this line.
    expect(texts).toContain(UNAUTH_TIER_DISCLOSURE);

    // E2 through the real glue: the tier context set in index.ts must have reached
    // saveOutput. REVERT CANARY: replacing the runUnauthenticatedTier wrap with a
    // plain dispatch makes the `path:` header reappear and this fail.
    expect(joined).not.toMatch(/^path: /m);
    const downloadWrites = writeFileSpy.mock.calls.filter((c) => String(c[0]).includes("novada-mcp"));
    expect(downloadWrites).toHaveLength(0);
  });

  it("keyless novada_search refuses locally with the pinned INVALID_API_KEY contract — no upstream call", async () => {
    const { client, axios } = await bootServer({});

    const res = await client.callTool({ name: "novada_search", arguments: { query: "hello" } });
    const joined = textsOf(res).join("\n---\n");

    // (b) refusal with the pinned code — the key_required class is untouched by the tier.
    expect(isErrorOf(res)).toBe(true);
    expect(joined).toContain("Error [INVALID_API_KEY]: NOVADA_API_KEY is not set.");
    expect(joined).toContain("failure_class: auth");
    expect(joined).toContain("retry_recommended: false");
    expect(classificationOf(joined)).toBe(PINNED_AUTH_CLASSIFICATION);

    // The refusal is the gate's own, pre-dispatch: nothing reached the (mocked) network.
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("invalid key: extract SERVED outside the tier (control) and search refusal classification byte-identical to keyless", async () => {
    const { client } = await bootServer({ NOVADA_API_KEY: INVALID_KEY });

    // (c1) unauth-tier member under an invalid key: same SERVED classification as
    // keyless. Current pinned behavior (review MEDIUM-1 residual, flagged for owner
    // in reports/w2-auth-gate-2026-09-10.md CHALLENGE #2 — presence is the gate's
    // only local signal): the tier context does NOT apply, so the save path runs
    // (write mocked) and no disclosure is appended. This is the control proving the
    // index.ts wiring routes BY GATE DECISION, not by blanket-wrapping every call.
    const extractRes = await client.callTool({
      name: "novada_extract",
      arguments: { url: "https://example.com/wiring-invalid" },
    });
    const extractTexts = textsOf(extractRes);
    const extractJoined = extractTexts.join("\n---\n");
    expect(isErrorOf(extractRes)).toBe(false); // served — same classification as keyless
    expect(extractJoined).toContain("Test Page");
    expect(extractTexts).not.toContain(UNAUTH_TIER_DISCLOSURE);
    expect(extractJoined).toMatch(/^path: /m); // control: save path reached (mocked write)
    const downloadWrites = writeFileSpy.mock.calls.filter((c) => String(c[0]).includes("novada-mcp"));
    expect(downloadWrites.length).toBeGreaterThan(0);

    // (c2) key_required member under an invalid key: upstream code 10001 classifies
    // to the byte-identical code + failure_class the keyless local refusal carries.
    const searchRes = await client.callTool({ name: "novada_search", arguments: { query: "hello" } });
    const searchJoined = textsOf(searchRes).join("\n---\n");
    expect(isErrorOf(searchRes)).toBe(true);
    expect(classificationOf(searchJoined)).toBe(PINNED_AUTH_CLASSIFICATION);
    expect(searchJoined).toContain("retry_recommended: false");
  });
});
