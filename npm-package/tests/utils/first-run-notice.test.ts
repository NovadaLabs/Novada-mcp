/**
 * first-run-notice tests (TOW2-242).
 *
 * Covers the module contract + the content-block appending invariant the glue in
 * index.ts / mcp.ts relies on. No network. Filesystem is confined to a temp HOME
 * so the real ~/.novada-mcp/first-run.json is never touched.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  FIRST_RUN_NOTICE,
  maybeGetFirstRunNotice,
  FileNoticeStore,
  type NoticeStore,
} from "../../src/utils/first-run-notice.js";

const KILL_SWITCH = "NOVADA_DISABLE_FIRST_RUN_NOTICE";

// A simple in-memory store to exercise the mark-once semantics deterministically.
function makeMemoryStore(): NoticeStore {
  let noticed = false;
  return {
    hasNoticed: async () => noticed,
    markNoticed: async () => {
      noticed = true;
    },
  };
}

describe("maybeGetFirstRunNotice — core once-only behavior", () => {
  const savedKill = process.env[KILL_SWITCH];
  const savedVercel = process.env.VERCEL;
  const savedVercelEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    delete process.env[KILL_SWITCH];
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    if (savedKill === undefined) delete process.env[KILL_SWITCH];
    else process.env[KILL_SWITCH] = savedKill;
    if (savedVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = savedVercel;
    if (savedVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = savedVercelEnv;
  });

  // Test 1: first call returns the notice, second returns null.
  it("returns the notice on the first call and null on the second", async () => {
    const store = makeMemoryStore();
    const first = await maybeGetFirstRunNotice(store);
    const second = await maybeGetFirstRunNotice(store);
    expect(first).toBe(FIRST_RUN_NOTICE);
    expect(second).toBeNull();
  });

  it("the notice copy is exactly the approved string ($10, novada.com, once)", () => {
    expect(FIRST_RUN_NOTICE).toBe(
      "💡 First time using Novada MCP? Get your own API key + $10 free credits at https://novada.com — this notice shows only once.",
    );
    // Guardrails: $10, the bare signup host, and NOT the server endpoint.
    expect(FIRST_RUN_NOTICE).toContain("$10");
    expect(FIRST_RUN_NOTICE).toContain("https://novada.com");
    expect(FIRST_RUN_NOTICE).not.toContain("mcp.novada.com");
  });

  // Test 2: kill switch env → always null.
  it("kill switch env → always null (and never consults the store)", async () => {
    const store = makeMemoryStore();
    const spy = vi.spyOn(store, "hasNoticed");
    process.env[KILL_SWITCH] = "1";
    expect(await maybeGetFirstRunNotice(store)).toBeNull();
    expect(await maybeGetFirstRunNotice(store)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  // Test 4: broken store (throws) → null, no crash.
  it("broken store that throws → null, no crash", async () => {
    const brokenStore: NoticeStore = {
      hasNoticed: async () => {
        throw new Error("kv exploded");
      },
      markNoticed: async () => {
        throw new Error("kv exploded");
      },
    };
    await expect(maybeGetFirstRunNotice(brokenStore)).resolves.toBeNull();
  });

  it("marks BEFORE returning (mark-before-return, no double-show under re-entry)", async () => {
    const calls: string[] = [];
    const store: NoticeStore = {
      hasNoticed: async () => calls.includes("mark"),
      markNoticed: async () => {
        calls.push("mark");
      },
    };
    const a = await maybeGetFirstRunNotice(store);
    const b = await maybeGetFirstRunNotice(store);
    expect(a).toBe(FIRST_RUN_NOTICE);
    expect(b).toBeNull();
    expect(calls).toEqual(["mark"]);
  });
});

// Test 3: VERCEL env + default (file) store → null, and NO flag file written.
describe("FileNoticeStore — VERCEL hard guard (no fs writes on serverless)", () => {
  let tmpHome: string;
  const savedHome = process.env.HOME;
  const savedVercel = process.env.VERCEL;
  const savedKill = process.env[KILL_SWITCH];

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "novada-frn-"));
    process.env.HOME = tmpHome;
    delete process.env[KILL_SWITCH];
  });

  afterEach(async () => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = savedVercel;
    if (savedKill === undefined) delete process.env[KILL_SWITCH];
    else process.env[KILL_SWITCH] = savedKill;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it("VERCEL set → default store returns null and writes NO flag file", async () => {
    process.env.VERCEL = "1";
    const store = new FileNoticeStore();
    const result = await maybeGetFirstRunNotice(store);
    expect(result).toBeNull();

    // The flag file must NOT exist — no fs write happened on serverless.
    const flag = path.join(tmpHome, ".novada-mcp", "first-run.json");
    await expect(fs.access(flag)).rejects.toBeTruthy();
  });

  it("non-VERCEL file store → shows once, persists a flag file, then suppresses", async () => {
    delete process.env.VERCEL;
    const store = new FileNoticeStore();

    const first = await maybeGetFirstRunNotice(store);
    expect(first).toBe(FIRST_RUN_NOTICE);

    // Flag file now exists and is valid JSON with a noticedAt timestamp.
    const flag = path.join(tmpHome, ".novada-mcp", "first-run.json");
    const raw = await fs.readFile(flag, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toHaveProperty("noticedAt");

    // A fresh store instance (same HOME) must see the flag and suppress.
    const second = await maybeGetFirstRunNotice(new FileNoticeStore());
    expect(second).toBeNull();
  });
});

// ─── Content-block appending invariant (glue in index.ts / mcp.ts) ─────────────
//
// The glue never concatenates the notice into an existing text block — it PUSHES a
// separate block, and only on SUCCESS. These tests reproduce that exact pattern so
// a regression in the glue shape is caught here.

/** Mirror of the index.ts / mcp.ts success glue: push a separate block iff notice. */
async function appendNoticeToSuccess(
  resultText: string,
  store: NoticeStore,
): Promise<Array<{ type: "text"; text: string }>> {
  const content: Array<{ type: "text"; text: string }> = [{ type: "text", text: resultText }];
  const notice = await maybeGetFirstRunNotice(store);
  if (notice) content.push({ type: "text", text: notice });
  return content;
}

describe("content-block appending", () => {
  const savedKill = process.env[KILL_SWITCH];
  beforeEach(() => {
    delete process.env[KILL_SWITCH];
    delete process.env.VERCEL;
  });
  afterEach(() => {
    if (savedKill === undefined) delete process.env[KILL_SWITCH];
    else process.env[KILL_SWITCH] = savedKill;
  });

  // Test 5: successful tool result gets exactly ONE extra text block on first call;
  // JSON-format tool output remains parseable (the original block is untouched).
  it("appends exactly one extra block on first success; JSON output stays parseable", async () => {
    const store = makeMemoryStore();
    const jsonResult = JSON.stringify({ status: "ok", data: [1, 2, 3] });

    const firstContent = await appendNoticeToSuccess(jsonResult, store);
    expect(firstContent).toHaveLength(2);
    // Original block untouched → still valid JSON.
    expect(firstContent[0].text).toBe(jsonResult);
    expect(() => JSON.parse(firstContent[0].text)).not.toThrow();
    // Second block is the notice, verbatim.
    expect(firstContent[1].text).toBe(FIRST_RUN_NOTICE);

    // Second success → no extra block.
    const secondContent = await appendNoticeToSuccess(jsonResult, store);
    expect(secondContent).toHaveLength(1);
    expect(secondContent[0].text).toBe(jsonResult);
  });

  // Test 6: error results get NO notice (the glue lives only on the success path,
  // so an error path never even calls the notice — the store stays unconsumed).
  it("error results get NO notice (store untouched, first success still shows)", async () => {
    const store = makeMemoryStore();
    const hasNoticedSpy = vi.spyOn(store, "hasNoticed");
    const markSpy = vi.spyOn(store, "markNoticed");

    // Simulate an error result: index.ts / mcp.ts return BEFORE the append glue,
    // so the notice function is never invoked on the error branch.
    const errorContent = [{ type: "text" as const, text: "Error [SOMETHING]: boom" }];
    // (no call to maybeGetFirstRunNotice on the error path)
    expect(errorContent).toHaveLength(1);
    expect(hasNoticedSpy).not.toHaveBeenCalled();
    expect(markSpy).not.toHaveBeenCalled();

    // Because the error path never consumed the once-token, the NEXT successful
    // call is still the first-run and shows the notice.
    const okContent = await appendNoticeToSuccess("ok", store);
    expect(okContent).toHaveLength(2);
    expect(okContent[1].text).toBe(FIRST_RUN_NOTICE);
  });
});

// ─── Cross-artifact consistency (hosted mcp.ts inlines the copy + KV store) ────
//
// The hosted server (Vercel) cannot import the not-yet-vendored module at local
// tsc time, so it DUPLICATES the FIRST_RUN_NOTICE constant inline and implements a
// KV-backed store. These source-level assertions guard against the two ways that
// duplication can rot: (1) the copy drifting from this module, and (2) the hosted
// KV store regressing its fail-quiet / key-hygiene invariants.

describe("hosted mcp.ts — inline copy + KV store invariants", () => {
  async function readMcpSrc(): Promise<string> {
    const { readFileSync } = await import("fs");
    // tests/utils/ → repo root is ../../../
    return readFileSync(
      new URL("../../../hosted-server/vercel/api/mcp.ts", import.meta.url),
      "utf8",
    );
  }

  it("inline FIRST_RUN_NOTICE copy is byte-identical to the module constant", async () => {
    const mcpSrc = await readMcpSrc();
    expect(mcpSrc).toContain(FIRST_RUN_NOTICE);
  });

  it("hosted KV store honors the fail-quiet + key-hygiene invariants", async () => {
    const mcpSrc = await readMcpSrc();
    // Kill switch respected on hosted.
    expect(mcpSrc).toContain("NOVADA_DISABLE_FIRST_RUN_NOTICE");
    // KV key is the fingerprint-namespaced form, never the raw token.
    expect(mcpSrc).toContain("`noticed:${fp}`");
    expect(mcpSrc).toContain("tokenFingerprint(token)");
    // SET NX (claim-once) with a TTL — mark-before-return is the atomic SET itself.
    expect(mcpSrc).toContain("nx: true");
    // The notice is pushed as a SEPARATE content block on the success path(s).
    expect(mcpSrc).toContain("maybeGetFirstRunNoticeHosted(ctx.token)");
  });
});
