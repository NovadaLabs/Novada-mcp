import { describe, it, expect } from "vitest";
import { lookupDomain } from "../../src/utils/domains.js";

describe("lookupDomain", () => {
  it("returns render for amazon.com", () => {
    const entry = lookupDomain("https://www.amazon.com/dp/B08N5WRWNW");
    expect(entry).not.toBeNull();
    expect(entry?.method).toBe("render");
  });

  it("returns static for en.wikipedia.org", () => {
    const entry = lookupDomain("https://en.wikipedia.org/wiki/Artificial_intelligence");
    expect(entry).not.toBeNull();
    expect(entry?.method).toBe("static");
  });

  it("returns browser for booking.com", () => {
    const entry = lookupDomain("https://booking.com/hotel/us/some-hotel.html");
    expect(entry).not.toBeNull();
    expect(entry?.method).toBe("browser");
  });

  it("returns null for unknown domain", () => {
    const entry = lookupDomain("https://unknown-site.example.xyz/page");
    expect(entry).toBeNull();
  });

  it("returns render for store.steampowered.com (exact match)", () => {
    const entry = lookupDomain("https://store.steampowered.com/app/730/CSGO");
    expect(entry).not.toBeNull();
    expect(entry?.method).toBe("render");
  });

  it("returns browser for subdomain of booking.com via fallback", () => {
    const entry = lookupDomain("https://subdomain.booking.com/something");
    expect(entry).not.toBeNull();
    expect(entry?.method).toBe("browser");
  });

  it("returns static for github.com", () => {
    const entry = lookupDomain("https://github.com/openai/openai-python");
    expect(entry).not.toBeNull();
    expect(entry?.method).toBe("static");
  });

  it("strips www before lookup", () => {
    const entry = lookupDomain("https://www.github.com/octocat");
    expect(entry).not.toBeNull();
    expect(entry?.method).toBe("static");
  });

  it("returns null for invalid URL", () => {
    const entry = lookupDomain("not-a-url");
    expect(entry).toBeNull();
  });

  it("includes a note field", () => {
    const entry = lookupDomain("https://glassdoor.com/jobs");
    expect(entry).not.toBeNull();
    expect(typeof entry?.note).toBe("string");
    expect(entry!.note.length).toBeGreaterThan(0);
  });
});
