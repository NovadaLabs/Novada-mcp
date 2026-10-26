import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

/**
 * format=json must be machine-parseable end to end: the ENTIRE returned string is one JSON
 * document. Nothing (auto-save path, status footer, hints) may be appended after the closing
 * brace. The auto-saved path is carried INSIDE the object as `output_saved`.
 * saveOutput is mocked to a "successful save" so the save-path branch is exercised without
 * writing to ~/Downloads.
 */
vi.mock("axios");
vi.mock("../../src/utils/output.js", async (orig) => {
  const actual = await orig<typeof import("../../src/utils/output.js")>();
  return {
    ...actual,
    saveOutput: vi.fn().mockResolvedValue({ filePath: "/tmp/novada/extract.json", summary: "saved" }),
  };
});

import { novadaExtract } from "../../src/tools/extract.js";
import { clearCache } from "../../src/_core/session-cache.js";

const mockedAxios = vi.mocked(axios);
const html = `<html><head><title>JSON Page</title></head><body><main><p>${"Body text for the page. ".repeat(40)}</p></main></body></html>`;

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
});

describe("novada_extract format=json is a single parseable document", () => {
  it("JSON.parse succeeds on the full output and the save path lives inside the object", async () => {
    mockedAxios.get.mockResolvedValue({ data: html, headers: { "content-type": "text/html" }, status: 200 } as never);

    const out = await novadaExtract({ url: "https://json-parse.example/page", format: "json", render: "static" }, "test-key");

    expect(() => JSON.parse(out)).not.toThrow();
    expect(out.trim().endsWith("}")).toBe(true);
    expect(out).not.toMatch(/\n---\n/);
    const parsed = JSON.parse(out);
    expect(parsed.title).toBe("JSON Page");
    expect(typeof parsed.output_saved).toBe("string");
  });

  it("error path: when the save step throws, output is still parseable JSON (save is best-effort)", async () => {
    const { saveOutput } = await import("../../src/utils/output.js");
    vi.mocked(saveOutput).mockRejectedValueOnce(new Error("disk full"));
    mockedAxios.get.mockResolvedValue({ data: html, headers: { "content-type": "text/html" }, status: 200 } as never);

    const out = await novadaExtract({ url: "https://json-parse2.example/page", format: "json", render: "static" }, "test-key");

    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out).output_saved).toBeUndefined();
  });
});
