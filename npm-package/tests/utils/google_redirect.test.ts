/**
 * search-goto-links-2026-11-04: table-driven coverage for the Google "goto"
 * redirect resolver (utils/google_redirect.ts). See that module's doc comment
 * for the full investigation (why (b) decode-without-network was rejected,
 * why /goto — not /url — is the endpoint that returns a Location header, and
 * the SSRF posture).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import {
  extractGoogleRedirectToken,
  resolveGoogleRedirectToken,
  resolveSerpLink,
  resolveGoogleLinksInPlace,
} from "../../src/utils/google_redirect.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

beforeEach(() => {
  vi.clearAllMocks();
});

const TOKEN = "CAESgwEB6zswFd2JfNe2rKNVoO355XecT_9Dien4MYJbSPiz3I6knYzEXCyb6yX0DoQR";

function mockRedirect(status: number, location?: string) {
  mockedAxios.get.mockResolvedValue({
    status,
    headers: location ? { location } : {},
    data: "",
  });
}

// ─── extractGoogleRedirectToken — table-driven over link shapes ────────────

describe("extractGoogleRedirectToken", () => {
  const cases: Array<[string, string, string | null]> = [
    ["relative /goto", `/goto?url=${TOKEN}`, TOKEN],
    ["relative /goto with trailing params", `/goto?url=${TOKEN}&foo=bar`, TOKEN],
    ["relative /url with leading params", `/url?sa=t&source=web&url=${TOKEN}&ved=abc`, TOKEN],
    ["absolute /goto on www.google.com", `https://www.google.com/goto?url=${TOKEN}`, TOKEN],
    ["absolute /url on google.com (no www)", `https://google.com/url?sa=t&url=${TOKEN}&ved=abc`, TOKEN],
    ["plain absolute non-Google URL", "https://example.com/page", null],
    ["relative path that is not /goto or /url", "/search?q=foo", null],
    ["absolute Google URL but wrong path", "https://www.google.com/search?q=foo", null],
    ["absolute URL on a non-Google host with url= param (must not be mistaken for a token)", "https://evil.com/goto?url=" + TOKEN, null],
    ["empty string", "", null],
    ["goto path with no url param", "/goto?foo=bar", null],
  ];

  it.each(cases)("%s", (_label, input, expected) => {
    expect(extractGoogleRedirectToken(input)).toBe(expected);
  });

  it("rejects a token longer than the sanity cap", () => {
    const huge = "/goto?url=" + "A".repeat(5000);
    expect(extractGoogleRedirectToken(huge)).toBeNull();
  });
});

// ─── resolveGoogleRedirectToken — network behavior, timeout, SSRF, loop guard ──

describe("resolveGoogleRedirectToken", () => {
  it("resolves via the 302 Location header (the live-verified /goto shape)", async () => {
    mockRedirect(302, "https://real-destination.example.com/article");
    const result = await resolveGoogleRedirectToken(TOKEN + "1");
    expect(result).toBe("https://real-destination.example.com/article");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    const [url, config] = mockedAxios.get.mock.calls[0];
    expect(url).toBe(`https://www.google.com/goto?url=${TOKEN}1`);
    expect((config as Record<string, unknown>).maxRedirects).toBe(0);
  });

  it("returns null when the response is 200 (the /url endpoint's HTML+JS shape, not a 3xx)", async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, headers: {}, data: "<html>...</html>" });
    const result = await resolveGoogleRedirectToken(TOKEN + "2");
    expect(result).toBeNull();
  });

  it("returns null when Location is missing on a 3xx", async () => {
    mockRedirect(302, undefined);
    const result = await resolveGoogleRedirectToken(TOKEN + "3");
    expect(result).toBeNull();
  });

  it("SSRF mirror: rejects a Location pointing at a private/loopback host (defense in depth)", async () => {
    mockRedirect(302, "http://169.254.169.254/latest/meta-data/");
    const result = await resolveGoogleRedirectToken(TOKEN + "4");
    expect(result).toBeNull();
  });

  it("loop guard: rejects a Location that is itself another google.com redirect host", async () => {
    mockRedirect(302, "https://www.google.com/url?q=https://example.com");
    const result = await resolveGoogleRedirectToken(TOKEN + "5");
    expect(result).toBeNull();
  });

  it("never throws on a network error — returns null", async () => {
    mockedAxios.get.mockRejectedValue(new Error("ECONNRESET"));
    const result = await resolveGoogleRedirectToken(TOKEN + "6");
    expect(result).toBeNull();
  });

  it("caches a resolved token — the second call for the SAME token makes no new request", async () => {
    mockRedirect(302, "https://cached-destination.example.com/");
    const first = await resolveGoogleRedirectToken(TOKEN + "7");
    const second = await resolveGoogleRedirectToken(TOKEN + "7");
    expect(first).toBe("https://cached-destination.example.com/");
    expect(second).toBe("https://cached-destination.example.com/");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});

// ─── resolveSerpLink — preference order (a) fast path, (c) resolve, (d) drop ───

describe("resolveSerpLink", () => {
  it("(a) fast path: an already-absolute non-Google link needs zero network calls", async () => {
    const result = await resolveSerpLink({ link: "https://example.com/real-page" });
    expect(result).toBe("https://example.com/real-page");
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("(c) resolves a relative /goto link via the token endpoint", async () => {
    mockRedirect(302, "https://resolved.example.com/");
    const result = await resolveSerpLink({ link: `/goto?url=${TOKEN}8` });
    expect(result).toBe("https://resolved.example.com/");
  });

  it("(c) falls back to redirect_link's token when link/url carry none", async () => {
    mockRedirect(302, "https://resolved-via-redirect-link.example.com/");
    const result = await resolveSerpLink({
      redirect_link: `https://www.google.com/url?sa=t&url=${TOKEN}9&ved=abc`,
    });
    expect(result).toBe("https://resolved-via-redirect-link.example.com/");
  });

  it("(d) drops when nothing resolves", async () => {
    mockRedirect(200); // /url-style 200, never gives a Location
    const result = await resolveSerpLink({ link: `/goto?url=${TOKEN}10` });
    expect(result).toBeNull();
  });

  it("(d) drops when link/url/redirect_link are all absent", async () => {
    const result = await resolveSerpLink({});
    expect(result).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

// ─── resolveGoogleLinksInPlace — batch, drop counting, zero-cost pass-through ──

describe("resolveGoogleLinksInPlace", () => {
  it("passes through already-absolute links with ZERO network calls (no-op for every other platform)", async () => {
    const items = [
      { title: "A", link: "https://a.example.com/" },
      { title: "B", link: "https://b.example.com/" },
    ];
    const { kept, dropped } = await resolveGoogleLinksInPlace(items);
    expect(kept).toEqual(items);
    expect(kept[0]).toBe(items[0]); // same reference — never rewritten
    expect(dropped).toBe(0);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("resolves goto-shaped links and drops unresolvable ones, preserving unrelated fields", async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes("TOKENGOOD")) {
        return { status: 302, headers: { location: "https://good.example.com/" }, data: "" };
      }
      return { status: 200, headers: {}, data: "" }; // unresolvable
    });

    const items = [
      { title: "Resolvable", link: "/goto?url=TOKENGOOD", snippet: "keep me" },
      { title: "Unresolvable", link: "/goto?url=TOKENBAD" },
      { title: "Already absolute", link: "https://already.example.com/" },
    ];
    const { kept, dropped } = await resolveGoogleLinksInPlace(items);

    expect(dropped).toBe(1);
    expect(kept).toHaveLength(2);
    expect(kept.find((r) => r.title === "Resolvable")?.link).toBe("https://good.example.com/");
    expect(kept.find((r) => r.title === "Resolvable")?.snippet).toBe("keep me");
    expect(kept.some((r) => r.title === "Unresolvable")).toBe(false);
    expect(kept.find((r) => r.title === "Already absolute")?.link).toBe("https://already.example.com/");
  });

  it("respects a deadline — items past the deadline are dropped without a new request", async () => {
    mockedAxios.get.mockResolvedValue({ status: 302, headers: { location: "https://resolved.example.com/" }, data: "" });
    const items = [{ title: "Too late", link: "/goto?url=TOKENLATE" }];
    const { kept, dropped } = await resolveGoogleLinksInPlace(items, { deadlineMs: Date.now() - 1 });
    expect(dropped).toBe(1);
    expect(kept).toHaveLength(0);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
