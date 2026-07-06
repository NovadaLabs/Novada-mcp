/**
 * NOV-330: session-level domain→fetch-mode routing memory.
 * Pure in-process logic, no network. Uses fake timers for TTL/LRU assertions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getRouteHint,
  recordRouteSuccess,
  clearRouteMemory,
  routeKey,
} from "../../src/_core/route-memory.js";

beforeEach(() => {
  clearRouteMemory();
});

describe("routeKey", () => {
  it("lowercases host and strips leading www.", () => {
    expect(routeKey("https://WWW.Example.COM/path")).toBe("example.com");
  });

  it("keeps subdomains (per-host keying)", () => {
    expect(routeKey("https://app.example.com/x")).toBe("app.example.com");
  });

  it("returns null for unparseable input", () => {
    expect(routeKey("not a url")).toBeNull();
    expect(routeKey("")).toBeNull();
  });
});

describe("record + get round-trip", () => {
  it("returns null when nothing recorded", () => {
    expect(getRouteHint("https://example.com")).toBeNull();
  });

  it("remembers a recorded success mode for the host", () => {
    recordRouteSuccess("https://example.com/a", "render");
    expect(getRouteHint("https://example.com/b")).toBe("render");
  });

  it("keys by host so different paths share the memory", () => {
    recordRouteSuccess("https://example.com/page1", "browser");
    expect(getRouteHint("https://example.com/page2")).toBe("browser");
  });

  it("treats www. and apex as the same host", () => {
    recordRouteSuccess("https://www.example.com", "static");
    expect(getRouteHint("https://example.com")).toBe("static");
  });

  it("keeps distinct subdomains separate", () => {
    recordRouteSuccess("https://app.example.com", "browser");
    recordRouteSuccess("https://docs.example.com", "static");
    expect(getRouteHint("https://app.example.com")).toBe("browser");
    expect(getRouteHint("https://docs.example.com")).toBe("static");
  });

  it("overwrites with the latest recorded mode", () => {
    recordRouteSuccess("https://example.com", "static");
    recordRouteSuccess("https://example.com", "render");
    expect(getRouteHint("https://example.com")).toBe("render");
  });
});

describe("success-mode filtering", () => {
  it("ignores the render-failed pseudo-mode", () => {
    recordRouteSuccess("https://example.com", "render-failed");
    expect(getRouteHint("https://example.com")).toBeNull();
  });

  it("ignores arbitrary non-success tokens", () => {
    recordRouteSuccess("https://example.com", "garbage");
    expect(getRouteHint("https://example.com")).toBeNull();
  });

  it("ignores unparseable URLs silently", () => {
    expect(() => recordRouteSuccess("::not a url::", "render")).not.toThrow();
    expect(getRouteHint("::not a url::")).toBeNull();
  });
});

describe("TTL expiry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the mode within TTL", () => {
    recordRouteSuccess("https://example.com", "render");
    vi.advanceTimersByTime(29 * 60 * 1000); // 29 min < 30 min TTL
    expect(getRouteHint("https://example.com")).toBe("render");
  });

  it("evicts and returns null after TTL", () => {
    recordRouteSuccess("https://example.com", "render");
    vi.advanceTimersByTime(31 * 60 * 1000); // 31 min > 30 min TTL
    expect(getRouteHint("https://example.com")).toBeNull();
  });

  it("a read does not extend TTL (age counts from last success)", () => {
    recordRouteSuccess("https://example.com", "render");
    vi.advanceTimersByTime(20 * 60 * 1000);
    expect(getRouteHint("https://example.com")).toBe("render"); // live read
    vi.advanceTimersByTime(11 * 60 * 1000); // total 31 min from the success
    expect(getRouteHint("https://example.com")).toBeNull();
  });
});

describe("bounded LRU eviction", () => {
  it("evicts the least-recently-used entry past the cap (200)", () => {
    // Fill exactly to the cap.
    for (let i = 0; i < 200; i++) {
      recordRouteSuccess(`https://host${i}.com`, "static");
    }
    // host0 is the LRU. Touch it via a read to move it to the tail.
    expect(getRouteHint("https://host0.com")).toBe("static");
    // Now host1 is the LRU. Inserting a 201st entry should evict host1, not host0.
    recordRouteSuccess("https://host200.com", "render");
    expect(getRouteHint("https://host1.com")).toBeNull(); // evicted
    expect(getRouteHint("https://host0.com")).toBe("static"); // survived (recently read)
    expect(getRouteHint("https://host200.com")).toBe("render"); // newest
  });
});

describe("clearRouteMemory", () => {
  it("wipes all entries", () => {
    recordRouteSuccess("https://example.com", "render");
    clearRouteMemory();
    expect(getRouteHint("https://example.com")).toBeNull();
  });
});
