/**
 * search-goto-links-2026-11-04: table-driven coverage for the Google "goto"
 * redirect resolver (utils/google_redirect.ts). See that module's doc comment
 * for the full investigation (why (b) decode-without-network was rejected,
 * why /goto's 302 is the primary path, the /url HTML fallback and the
 * interstitial-hop fallback added in the 2026-11-04 follow-up, the retention
 * policy for a result that still can't be resolved, and the SSRF posture).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import {
  extractGoogleRedirectToken,
  extractGoogleRedirectQuery,
  resolveGoogleRedirectToken,
  resolveGoogleRedirectTokenDetailed,
  resolveSerpLink,
  resolveSerpLinkDetailed,
  resolveGoogleLinksInPlace,
} from "../../src/utils/google_redirect.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

beforeEach(() => {
  vi.clearAllMocks();
});

const TOKEN = "CAESgwEB6zswFd2JfNe2rKNVoO355XecT_9Dien4MYJbSPiz3I6knYzEXCyb6yX0DoQR";
// Shape of a live upstream redirect_link query (2026-11-05 capture; ved/usg shortened).
const urlQueryFor = (tok: string) => `sa=t&source=web&rct=j&opi=89978449&url=${tok}&ved=2ahUKEwjX9-ab&usg=AOvVaw3x_y-z`;

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

// ─── extractGoogleRedirectQuery — what may be replayed against /url ─────────

describe("extractGoogleRedirectQuery", () => {
  const q = urlQueryFor(TOKEN);
  const cases: Array<[string, string, string | null]> = [
    ["live absolute redirect_link on www.google.com", `https://www.google.com/url?${q}`, q],
    ["absolute on google.com (no www)", `https://google.com/url?${q}`, q],
    ["relative /url", `/url?${q}`, q],
    ["relative /url with a fragment (fragment dropped)", `/url?${q}#frag`, q],
    ["non-Google host with an identical query (SSRF: never replayed)", `https://attacker.example.net/url?${q}`, null],
    ["Google lookalike subdomain host", `https://www.google.com.attacker.net/url?${q}`, null],
    ["Google host but /goto path (not replayable)", `https://www.google.com/goto?url=${TOKEN}`, null],
    ["Google host but /search path", `https://www.google.com/search?${q}`, null],
    ["no url= token", "https://www.google.com/url?sa=t&source=web", null],
    ["query with a character outside the opaque-param charset", `https://www.google.com/url?${q}&x=a@b`, null],
    ["raw CR/LF in the query (header-smuggling attempt)", `/url?${q}\r\nHost: evil`, null],
    ["empty string", "", null],
  ];

  it.each(cases)("%s", (_label, input, expected) => {
    expect(extractGoogleRedirectQuery(input)).toBe(expected);
  });

  it("rejects a query over the length cap", () => {
    expect(extractGoogleRedirectQuery(`/url?url=${TOKEN}&ved=${"a".repeat(5000)}`)).toBeNull();
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

  it("without a replayable /url query, never sends the bare /url?url=<token> form (live: always a generic notice page)", async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, headers: {}, data: "<html>...</html>" });
    const result = await resolveGoogleRedirectToken(TOKEN + "2");
    expect(result).toBeNull();
    const urls = mockedAxios.get.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([`https://www.google.com/goto?url=${TOKEN}2`]);
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

  // ── 2026-11-04 follow-up: fallback paths ──────────────────────────────────

  it("(c2) replays the FULL /url query FIRST and resolves from `var redirectUrl=` — one request, /goto never touched", async () => {
    const tok = TOKEN + "URLJS";
    mockedAxios.get.mockImplementation(async (reqUrl: string) => {
      if (reqUrl.startsWith("https://www.google.com/goto")) {
        return { status: 302, headers: { location: "https://should-not-be-used.example.com/" }, data: "" };
      }
      // /url page shape, live-captured (see module doc (c2)).
      return {
        status: 200,
        headers: {},
        data: `<html><head></head><body><script>var redirectUrl='https://saascompared.io/blog/best-project-management-software-2026/';google.navigateTo(redirectUrl)</script><noscript><meta http-equiv="refresh" content="0;url=https://saascompared.io/blog/best-project-management-software-2026/"></noscript></body></html>`,
      };
    });
    const resolution = await resolveGoogleRedirectTokenDetailed(tok, {}, urlQueryFor(tok));
    expect(resolution.url).toBe("https://saascompared.io/blog/best-project-management-software-2026/");
    expect(resolution.via).toBe("url_page");
    const urls = mockedAxios.get.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([`https://www.google.com/url?${urlQueryFor(tok)}`]);
  });

  it("(c2) decodes the JS \\x3d escape Google emits inside redirectUrl (live YouTube shape)", async () => {
    const tok = TOKEN + "URLX3D";
    mockedAxios.get.mockResolvedValue({
      status: 200,
      headers: {},
      data: `<script>var redirectUrl='https://www.youtube.com/watch?v\\x3dXpQpij6hWHc';</script>`,
    });
    const resolution = await resolveGoogleRedirectTokenDetailed(tok, {}, urlQueryFor(tok));
    expect(resolution.url).toBe("https://www.youtube.com/watch?v=XpQpij6hWHc");
  });

  it("(c2) fails → falls through to /goto's 302, in that order", async () => {
    const tok = TOKEN + "URLTHENGOTO";
    mockedAxios.get.mockImplementation(async (reqUrl: string) => {
      if (reqUrl.startsWith("https://www.google.com/url")) return { status: 200, headers: {}, data: "<html>notice page</html>" };
      return { status: 302, headers: { location: "https://via-goto.example.com/" }, data: "" };
    });
    const resolution = await resolveGoogleRedirectTokenDetailed(tok, {}, urlQueryFor(tok));
    expect(resolution).toEqual({ url: "https://via-goto.example.com/", via: "goto" });
    const urls = mockedAxios.get.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([`https://www.google.com/url?${urlQueryFor(tok)}`, `https://www.google.com/goto?url=${tok}`]);
  });

  it("(c2) resolves via the /url page's <meta refresh> fallback when no JS var is present", async () => {
    const tok = TOKEN + "URLMETA";
    mockedAxios.get.mockResolvedValue({
      status: 200,
      headers: {},
      data: `<noscript><meta http-equiv="refresh" content="0;url=https://example.com/meta-only"></noscript>`,
    });
    const resolution = await resolveGoogleRedirectTokenDetailed(tok, {}, urlQueryFor(tok));
    expect(resolution.url).toBe("https://example.com/meta-only");
    expect(resolution.via).toBe("url_page");
  });

  it("(c2) decodes HTML-entity-escaped ampersands in the /url page's redirectUrl", async () => {
    const tok = TOKEN + "URLAMP";
    mockedAxios.get.mockResolvedValue({ status: 200, headers: {}, data: `<script>var redirectUrl='https://example.com/page?a=1&amp;b=2';</script>` });
    const resolution = await resolveGoogleRedirectTokenDetailed(tok, {}, urlQueryFor(tok));
    expect(resolution.url).toBe("https://example.com/page?a=1&b=2");
    expect(resolution.via).toBe("url_page");
  });

  it("cache keeps the path that resolved — a cached /url resolution still reports via: url_page", async () => {
    const tok = TOKEN + "CACHEVIA";
    mockedAxios.get.mockResolvedValue({ status: 200, headers: {}, data: `<script>var redirectUrl='https://example.com/cached';</script>` });
    const first = await resolveGoogleRedirectTokenDetailed(tok, {}, urlQueryFor(tok));
    const second = await resolveGoogleRedirectTokenDetailed(tok, {}, urlQueryFor(tok));
    expect(second).toEqual(first);
    expect(second.via).toBe("url_page");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it("(c2) rejects a /url page whose redirectUrl points back at a Google redirect host (loop guard)", async () => {
    const tok = TOKEN + "URLLOOP";
    mockedAxios.get.mockImplementation(async (reqUrl: string) => {
      if (reqUrl.startsWith("https://www.google.com/goto")) return { status: 200, headers: {}, data: "" };
      return { status: 200, headers: {}, data: `<script>var redirectUrl='https://www.google.com/goto?url=${tok}';</script>` };
    });
    const resolution = await resolveGoogleRedirectTokenDetailed(tok, {}, urlQueryFor(tok));
    expect(resolution.url).toBeNull();
  });

  it("(c3) follows ONE extra hop when /goto's interstitial embeds a different /goto token", async () => {
    const tok = TOKEN + "INTERA";
    const tok2 = "DIFFERENTTOKEN123";
    mockedAxios.get.mockImplementation(async (reqUrl: string) => {
      if (reqUrl === `https://www.google.com/goto?url=${tok}`) {
        return {
          status: 200,
          headers: {},
          data: `<html>Google<meta http-equiv="refresh" content="39;url=/goto?url=${tok2}"></html>`,
        };
      }
      if (reqUrl === `https://www.google.com/goto?url=${tok2}`) {
        return { status: 302, headers: { location: "https://real-destination.example.com/hopped" }, data: "" };
      }
      return { status: 200, headers: {}, data: "" };
    });
    const resolution = await resolveGoogleRedirectTokenDetailed(tok);
    expect(resolution.url).toBe("https://real-destination.example.com/hopped");
    expect(resolution.via).toBe("interstitial_hop");
    // primary /goto, the ONE extra hop, and (since the hop already resolved) no /url fallback call.
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it("(c3) follows the live bot-check page's JS-escaped continuation token (`/goto?url\\x3d...`)", async () => {
    const tok = TOKEN + "INTERX3D";
    const tok2 = "CAEScQHrOzAV1P2RYi-4HSG69m7bJ6ak9QjSpZ0yjk";
    mockedAxios.get.mockImplementation(async (reqUrl: string) => {
      if (reqUrl === `https://www.google.com/goto?url=${tok}`) {
        // "Anfrage wird verifiziert" interstitial, continuation inside a JS string.
        return { status: 200, headers: {}, data: `<title>Google</title><script>var c='/goto?url\\x3d${tok2}\\x26ved\\x3d1';</script>Anfrage wird verifiziert` };
      }
      if (reqUrl === `https://www.google.com/goto?url=${tok2}`) {
        return { status: 302, headers: { location: "https://www.reddit.com/r/rust/comments/1qj1d6n/x/" }, data: "" };
      }
      return { status: 404, headers: {}, data: "" };
    });
    const resolution = await resolveGoogleRedirectTokenDetailed(tok);
    expect(resolution).toEqual({ url: "https://www.reddit.com/r/rust/comments/1qj1d6n/x/", via: "interstitial_hop" });
  });

  it("(c3) bounds the hop to exactly one extra request — a second interstitial is NOT chased further", async () => {
    const tok = TOKEN + "INTERB";
    const tok2 = "SECONDHOPTOKEN";
    const tok3 = "THIRDHOPTOKEN";
    mockedAxios.get.mockImplementation(async (reqUrl: string) => {
      if (reqUrl === `https://www.google.com/goto?url=${tok}`) {
        return { status: 200, headers: {}, data: `/goto?url=${tok2}` };
      }
      if (reqUrl === `https://www.google.com/goto?url=${tok2}`) {
        // Still an interstitial, embeds a THIRD token — must NOT be chased.
        return { status: 200, headers: {}, data: `/goto?url=${tok3}` };
      }
      return { status: 200, headers: {}, data: "" }; // /url fallback — also unresolvable
    });
    const resolution = await resolveGoogleRedirectTokenDetailed(tok);
    expect(resolution.url).toBeNull();
    // primary /goto + one hop to tok2 = 2; tok3 is never requested.
    const requestedUrls = mockedAxios.get.mock.calls.map((c) => c[0]);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls).not.toContain(`https://www.google.com/goto?url=${tok3}`);
    expect(requestedUrls).not.toContain(`https://www.google.com/url?url=${tok3}`);
  });

  it("all paths fail: /goto unresolvable AND /url unresolvable → null (the all-fail path)", async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, headers: {}, data: "<html>no redirect here</html>" });
    const resolution = await resolveGoogleRedirectTokenDetailed(TOKEN + "ALLFAIL");
    expect(resolution.url).toBeNull();
    expect(resolution.via).toBeNull();
  });
});

// ─── resolveSerpLink — preference order (a) fast path, (c) resolve, (d) unresolved ───

describe("resolveSerpLink", () => {
  it("(a) fast path: an already-absolute non-Google link needs zero network calls", async () => {
    const result = await resolveSerpLink({ link: "https://example.com/real-page" });
    expect(result).toBe("https://example.com/real-page");
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("(a) resolveSerpLinkDetailed reports via: fast_path", async () => {
    const result = await resolveSerpLinkDetailed({ link: "https://example.com/real-page" });
    expect(result).toEqual({ url: "https://example.com/real-page", via: "fast_path" });
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

  it("(c2) replays the item's redirect_link query VERBATIM against our own https://www.google.com/url", async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, headers: {}, data: `<script>var redirectUrl='https://medium.com/rustaceans/x';</script>` });
    const tok = TOKEN + "SERPREPLAY";
    const result = await resolveSerpLinkDetailed({
      link: `/goto?url=${tok}`,
      redirect_link: `https://www.google.com/url?${urlQueryFor(tok)}`,
    });
    expect(result).toEqual({ url: "https://medium.com/rustaceans/x", via: "url_page" });
    expect(mockedAxios.get.mock.calls.map((c) => String(c[0]))).toEqual([`https://www.google.com/url?${urlQueryFor(tok)}`]);
  });

  it("SSRF: an upstream redirect_link on a NON-Google host is never fetched — every request targets https://www.google.com/", async () => {
    // First request (/goto) answers 200 with no Location so the resolver also
    // tries its /url fallback; neither request may go to the upstream host.
    mockedAxios.get.mockResolvedValue({ status: 200, headers: {}, data: "" });
    const result = await resolveSerpLink({
      redirect_link: `https://attacker.example.net/url?sa=t&url=${TOKEN}7&ved=abc`,
    });
    // A token is only taken from a Google redirect host, so this resolves to
    // nothing and makes no request at all; whatever IS requested must be Google.
    expect(result).toBeNull();
    const urls = mockedAxios.get.mock.calls.map((c) => String(c[0]));
    for (const u of urls) {
      expect(u.startsWith("https://www.google.com/")).toBe(true);
      expect(u).not.toContain("attacker.example.net");
    }
  });

  it("(d) unresolved when nothing resolves", async () => {
    mockRedirect(200); // never gives a Location or a parseable /url page
    const result = await resolveSerpLink({ link: `/goto?url=${TOKEN}10` });
    expect(result).toBeNull();
  });

  it("(d) unresolved when link/url/redirect_link are all absent", async () => {
    const result = await resolveSerpLink({});
    expect(result).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

// ─── resolveGoogleLinksInPlace — batch, retention policy, zero-cost pass-through ──

describe("resolveGoogleLinksInPlace", () => {
  it("passes through already-absolute links with ZERO network calls (no-op for every other platform)", async () => {
    const items = [
      { title: "A", link: "https://a.example.com/" },
      { title: "B", link: "https://b.example.com/" },
    ];
    const { kept, dropped, stats } = await resolveGoogleLinksInPlace(items);
    expect(kept).toEqual(items);
    expect(kept[0]).toBe(items[0]); // same reference — never rewritten
    expect(dropped).toBe(0);
    expect(stats.wrapped).toBe(0);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("resolves goto-shaped links and RETAINS unresolvable ones with url cleared, preserving unrelated fields", async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes("TOKENGOOD")) {
        return { status: 302, headers: { location: "https://good.example.com/" }, data: "" };
      }
      return { status: 200, headers: {}, data: "" }; // unresolvable on every path
    });

    const items = [
      { title: "Resolvable", link: "/goto?url=TOKENGOOD", snippet: "keep me" },
      { title: "Unresolvable", link: "/goto?url=TOKENBAD", snippet: "still show my snippet" },
      { title: "Already absolute", link: "https://already.example.com/" },
    ];
    const { kept, dropped, stats } = await resolveGoogleLinksInPlace(items);

    expect(dropped).toBe(1);
    expect(stats.wrapped).toBe(2); // TOKENGOOD + TOKENBAD; "Already absolute" is a zero-cost pass-through
    expect(stats.resolvedViaGoto).toBe(1);
    expect(stats.unresolved).toBe(1);
    // 2026-11-04 follow-up: NEVER drop a result — all 3 inputs are still present.
    expect(kept).toHaveLength(3);

    const resolvable = kept.find((r) => r.title === "Resolvable");
    expect(resolvable?.link).toBe("https://good.example.com/");
    expect(resolvable?.snippet).toBe("keep me");
    expect((resolvable as Record<string, unknown>).url_unavailable).toBeUndefined();

    const unresolvable = kept.find((r) => r.title === "Unresolvable");
    expect(unresolvable).toBeDefined();
    expect(unresolvable?.link).toBe(""); // NEVER a relative/goto path
    expect(unresolvable?.snippet).toBe("still show my snippet"); // title/snippet retained
    expect((unresolvable as Record<string, unknown>).url_unavailable).toBe(true);

    expect(kept.find((r) => r.title === "Already absolute")?.link).toBe("https://already.example.com/");
  });

  it("respects a deadline — items past the deadline are RETAINED (url cleared) without a new request", async () => {
    mockedAxios.get.mockResolvedValue({ status: 302, headers: { location: "https://resolved.example.com/" }, data: "" });
    const items = [{ title: "Too late", link: "/goto?url=TOKENLATE" }];
    const { kept, dropped } = await resolveGoogleLinksInPlace(items, { deadlineMs: Date.now() - 1 });
    expect(dropped).toBe(1);
    expect(kept).toHaveLength(1);
    expect(kept[0].link).toBe("");
    expect((kept[0] as Record<string, unknown>).url_unavailable).toBe(true);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("all-fail path: when EVERY wrapped item is unresolvable, every one is retained with url_unavailable (never near-silently emptied)", async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, headers: {}, data: "<html>no redirect</html>" });
    const items = [
      { title: "One", link: "/goto?url=TOKA", snippet: "snippet A" },
      { title: "Two", link: "/goto?url=TOKB", snippet: "snippet B" },
      { title: "Three", link: "/goto?url=TOKC", snippet: "snippet C" },
    ];
    const { kept, dropped, stats } = await resolveGoogleLinksInPlace(items);
    expect(dropped).toBe(3);
    expect(stats.wrapped).toBe(3);
    expect(stats.unresolved).toBe(3);
    expect(kept).toHaveLength(3);
    for (const r of kept) {
      expect(r.link).toBe("");
      expect((r as Record<string, unknown>).url_unavailable).toBe(true);
      expect(r.snippet).toBeTruthy(); // title/snippet survive even though every link failed
    }
  });
});
