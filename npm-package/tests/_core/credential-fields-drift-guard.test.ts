/**
 * Drift guard for maskCredentials()'s CREDENTIAL_FIELDS table (2026-10-30).
 *
 * maskCredentials matches field names exactly, so a credential-bearing field
 * the table does not list (e.g. a future `dial_password`) would pass through
 * unmasked with no test failing. This test reads the local developer-API /
 * scraper-API reference mirror, collects every JSON field name that LOOKS
 * credential-like, and requires each one to be classified: either masked
 * (a row in CREDENTIAL_FIELDS) or explicitly known-safe (a row below, with
 * the reason). A new credential-looking field in the mirror fails here until
 * someone decides which list it belongs to.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CREDENTIAL_FIELDS, maskCredentials } from "../../src/_core/developer_api.js";

const DOCS = resolve(__dirname, "../../docs");
const MIRROR_FILES = [
  join(DOCS, "novada-developer-api-full.md"),
  ...readdirSync(join(DOCS, "novada-api"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(DOCS, "novada-api", f)),
];

// Field names that look credential-like but carry no credential. One row per
// name — extending coverage is a new row, never a new branch.
const KNOWN_SAFE_FIELDS: ReadonlyArray<{ key: string; reason: string }> = [
  { key: "keyword", reason: "search keyword parameter" },
  { key: "key_word", reason: "list/export search filter" },
  { key: "key", reason: "generic param name inside scraper_params examples, not a secret" },
  { key: "Authorization", reason: "request header documented for callers; never part of a response" },
  { key: "token_type", reason: "the literal 'bearer', not a token" },
  { key: "account_id", reason: "numeric account identifier, not a login credential" },
];

const CREDENTIAL_LOOKING = /^[A-Za-z_]*(pass|pwd|secret|token|key|account|user|auth|cred)[A-Za-z_]*$/i;

function mirrorFieldNames(): Set<string> {
  const names = new Set<string>();
  for (const file of MIRROR_FILES) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/"([A-Za-z_]+)"\s*:/g)) {
      if (CREDENTIAL_LOOKING.test(m[1])) names.add(m[1]);
    }
  }
  return names;
}

describe("CREDENTIAL_FIELDS drift guard", () => {
  it("the reference mirror exists (guard is not vacuous)", () => {
    expect(MIRROR_FILES.length).toBeGreaterThan(1);
    for (const f of MIRROR_FILES) expect(existsSync(f)).toBe(true);
    // Known credential fields documented today must actually be found, or the
    // extraction regex has silently stopped matching anything.
    const found = mirrorFieldNames();
    for (const expected of ["account", "password", "apikey"]) expect(found.has(expected)).toBe(true);
  });

  it("every credential-looking field in the API mirror is classified (masked or known-safe)", () => {
    const masked = new Set(CREDENTIAL_FIELDS.map((f) => f.key.toLowerCase()));
    const safe = new Set(KNOWN_SAFE_FIELDS.map((f) => f.key.toLowerCase()));
    const unclassified = [...mirrorFieldNames()].filter(
      (name) => !masked.has(name.toLowerCase()) && !safe.has(name.toLowerCase()),
    );
    expect(unclassified, "add each name to CREDENTIAL_FIELDS (if it carries a credential) or KNOWN_SAFE_FIELDS (with a reason)").toEqual([]);
  });

  it("no name is both masked and known-safe", () => {
    const masked = new Set(CREDENTIAL_FIELDS.map((f) => f.key.toLowerCase()));
    const overlap = KNOWN_SAFE_FIELDS.filter((f) => masked.has(f.key.toLowerCase())).map((f) => f.key);
    expect(overlap).toEqual([]);
  });

  it("every masked field the mirror documents is actually masked by maskCredentials", () => {
    const documented = [...mirrorFieldNames()].filter((n) =>
      CREDENTIAL_FIELDS.some((f) => f.key.toLowerCase() === n.toLowerCase()),
    );
    expect(documented.length).toBeGreaterThan(0);
    for (const name of documented) {
      const masked = maskCredentials({ [name]: "real-credential-value", ip: "203.0.113.7" }) as Record<string, unknown>;
      expect(masked[name]).not.toBe("real-credential-value");
      expect(masked.ip).toBe("203.0.113.7");
    }
  });
});
