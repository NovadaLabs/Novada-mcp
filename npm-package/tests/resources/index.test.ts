import { describe, it, expect } from "vitest";
import { listResources, readResource, RESOURCES } from "../../src/resources/index.js";

describe("RESOURCES array", () => {
  it("contains all 6 resources", () => {
    expect(RESOURCES).toHaveLength(6);
  });

  it("has correct URIs", () => {
    const uris = RESOURCES.map((r) => r.uri);
    expect(uris).toContain("novada://engines");
    expect(uris).toContain("novada://countries");
    expect(uris).toContain("novada://guide");
    expect(uris).toContain("novada://scraper-platforms");
    expect(uris).toContain("novada://llms-txt");
    expect(uris).toContain("novada://privacy");
  });

  it("all resources have mimeType text/plain", () => {
    for (const r of RESOURCES) {
      expect(r.mimeType).toBe("text/plain");
    }
  });
});

describe("listResources()", () => {
  it("returns all 6 resources", () => {
    const result = listResources();
    expect(result.resources).toHaveLength(6);
  });

  it("includes novada://engines with a description", () => {
    const { resources } = listResources();
    const r = resources.find((x) => x.uri === "novada://engines");
    expect(r).toBeDefined();
    expect(r!.description.length).toBeGreaterThan(0);
  });

  it("includes novada://countries with a description", () => {
    const { resources } = listResources();
    const r = resources.find((x) => x.uri === "novada://countries");
    expect(r).toBeDefined();
    expect(r!.description.length).toBeGreaterThan(0);
  });

  it("includes novada://guide with a description", () => {
    const { resources } = listResources();
    const r = resources.find((x) => x.uri === "novada://guide");
    expect(r).toBeDefined();
    expect(r!.description.length).toBeGreaterThan(0);
  });

  it("includes novada://scraper-platforms with a description", () => {
    const { resources } = listResources();
    const r = resources.find((x) => x.uri === "novada://scraper-platforms");
    expect(r).toBeDefined();
    expect(r!.description.length).toBeGreaterThan(0);
  });
});

describe("readResource() — novada://engines", () => {
  it("returns a contents array with one entry", () => {
    const result = readResource("novada://engines");
    expect(result.contents).toHaveLength(1);
  });

  it("has mimeType text/plain", () => {
    const result = readResource("novada://engines");
    expect(result.contents[0].mimeType).toBe("text/plain");
  });

  it("echoes back the URI", () => {
    const result = readResource("novada://engines");
    expect(result.contents[0].uri).toBe("novada://engines");
  });

  it("contains google", () => {
    const text = readResource("novada://engines").contents[0].text;
    expect(text).toContain("google");
  });

  it("does not list bing as a supported engine (removed)", () => {
    const text = readResource("novada://engines").contents[0].text;
    // bing.com scraper platform still appears in scraper-platforms resource (it's a valid
    // platform for novada_scrape), but bing must not be listed as a search engine option.
    // Check it's absent from the engines section specifically (before the first ##).
    const enginesSection = text.split("##")[0];
    expect(enginesSection).not.toContain("bing       —");
  });

  it("contains duckduckgo", () => {
    const text = readResource("novada://engines").contents[0].text;
    expect(text).toContain("duckduckgo");
  });
});

describe("readResource() — novada://countries", () => {
  it("returns a contents array with one entry", () => {
    const result = readResource("novada://countries");
    expect(result.contents).toHaveLength(1);
  });

  it("has mimeType text/plain", () => {
    const result = readResource("novada://countries");
    expect(result.contents[0].mimeType).toBe("text/plain");
  });

  it("echoes back the URI", () => {
    const result = readResource("novada://countries");
    expect(result.contents[0].uri).toBe("novada://countries");
  });

  it("contains us country code", () => {
    const text = readResource("novada://countries").contents[0].text;
    expect(text).toContain("us");
  });

  it("contains gb country code", () => {
    const text = readResource("novada://countries").contents[0].text;
    expect(text).toContain("gb");
  });

  it("contains de country code", () => {
    const text = readResource("novada://countries").contents[0].text;
    expect(text).toContain("de");
  });
});

describe("readResource() — novada://guide", () => {
  it("returns a contents array with one entry", () => {
    const result = readResource("novada://guide");
    expect(result.contents).toHaveLength(1);
  });

  it("has mimeType text/plain", () => {
    const result = readResource("novada://guide");
    expect(result.contents[0].mimeType).toBe("text/plain");
  });

  it("echoes back the URI", () => {
    const result = readResource("novada://guide");
    expect(result.contents[0].uri).toBe("novada://guide");
  });

  it("contains novada_extract", () => {
    const text = readResource("novada://guide").contents[0].text;
    expect(text).toContain("novada_extract");
  });

  it("contains novada_search", () => {
    const text = readResource("novada://guide").contents[0].text;
    expect(text).toContain("novada_search");
  });

  it("contains Failure Recovery section", () => {
    const text = readResource("novada://guide").contents[0].text;
    expect(text).toContain("Failure Recovery");
  });
});

describe("readResource() — novada://scraper-platforms", () => {
  it("returns a contents array with one entry", () => {
    const result = readResource("novada://scraper-platforms");
    expect(result.contents).toHaveLength(1);
  });

  it("has mimeType text/plain", () => {
    const result = readResource("novada://scraper-platforms");
    expect(result.contents[0].mimeType).toBe("text/plain");
  });

  it("echoes back the URI", () => {
    const result = readResource("novada://scraper-platforms");
    expect(result.contents[0].uri).toBe("novada://scraper-platforms");
  });

  it("contains amazon.com", () => {
    const text = readResource("novada://scraper-platforms").contents[0].text;
    expect(text).toContain("amazon.com");
  });

  it("contains reddit.com", () => {
    const text = readResource("novada://scraper-platforms").contents[0].text;
    expect(text).toContain("reddit.com");
  });

  it("contains linkedin.com", () => {
    const text = readResource("novada://scraper-platforms").contents[0].text;
    expect(text).toContain("linkedin.com");
  });
});

describe("readResource() — novada://privacy", () => {
  it("resolves with one text/plain content entry echoing the URI", () => {
    const result = readResource("novada://privacy");
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe("text/plain");
    expect(result.contents[0].uri).toBe("novada://privacy");
  });

  it("lists every mcp_events field including target_domain", () => {
    const text = readResource("novada://privacy").contents[0].text;
    for (const field of [
      "ts", "event_type", "request_id", "token_hash", "plan",
      "client_name", "client_version", "protocol_version", "tool",
      "arg_keys", "target_domain", "outcome", "latency_ms", "charged",
      "over_cap_allowed", "quota_remaining", "server_version", "region",
    ]) {
      expect(text).toContain(field);
    }
  });

  it("states the hostname-only rule for target_domain", () => {
    const text = readResource("novada://privacy").contents[0].text;
    expect(text).toContain("HOSTNAME");
    expect(text).toContain("Never the path, query");
  });

  it("states what is never logged", () => {
    const text = readResource("novada://privacy").contents[0].text;
    expect(text).toContain("What is NEVER logged");
    expect(text).toContain("Search queries");
    expect(text).toContain("Parameter VALUES");
  });

  it("covers retention and contact", () => {
    const text = readResource("novada://privacy").contents[0].text;
    expect(text).toContain("Retention");
    expect(text).toContain("support@novada.com");
  });

  it("clarifies the local npm server sends no telemetry", () => {
    const text = readResource("novada://privacy").contents[0].text;
    expect(text).toContain("local npm server");
    expect(text).toContain("no usage telemetry");
  });
});

describe("readResource() — unknown URI", () => {
  it("throws an error for an unknown URI", () => {
    expect(() => readResource("novada://nonexistent")).toThrow("Unknown resource URI");
    expect(() => readResource("novada://nonexistent")).toThrow("novada://nonexistent");
  });
});
