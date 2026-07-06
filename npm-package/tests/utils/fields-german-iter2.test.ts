/**
 * NOV-669 iter-2 — INDEPENDENT verifier (different agent, own inputs).
 *
 * Tests the 80→200 table cap split:
 *   - considerTableRow: cap raised to 200 (table cells are structural data)
 *   - considerDlRow:    cap kept at 80  (dl/dd is prose-adjacent)
 *
 * All fixtures are NEW — none overlap with the fixer's test or iter-1 verifier test.
 */

import { describe, it, expect } from "vitest";
import { extractFields } from "../../src/utils/fields.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function tableHtml(rows: [string, string][]): string {
  const trs = rows.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join("\n");
  return `<html><body><table><tbody>${trs}</tbody></table></body></html>`;
}

function dlHtml(pairs: [string, string][]): string {
  const items = pairs.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join("\n");
  return `<html><body><dl>${items}</dl></body></html>`;
}

// ─── 1. TABLE: value 82–150 chars NOW resolves (was rejected at 80) ─────────

describe("iter-2 — TABLE: 82–150 char value now resolves", () => {
  it("instructor name at 82 chars resolves from table cell", () => {
    // 82 chars — was rejected by old cap of 80, must pass at new cap of 200
    const name82 = "Prof. Dr. Katharina von Schönberg-Lindemann, Sprachzentrum Frankfurt"; // 69 chars — pad
    const instructor = "Prof. Dr. Maria-Theresia von Hohenstein, Volkshochschule Hauptgebäude"; // 70 chars
    // Use a string that is definitively > 80 chars
    const longName = "Prof. Dr. Katharina von Schönberg-Lindemann, Gastdozentin Sprachzentrum Berlin"; // 79 — make longer
    const exactlyOver80 = "Prof. Dr. Katharina Schönberg-Lindemann, Inst. für Fremdsprachenpädagogik NRW"; // check length

    // Build a string of exactly 85 chars
    const name85 = "A".repeat(85);

    const html = tableHtml([["Kursleitung", name85]]);
    const results = extractFields(["instructor"], null, `| Kursleitung | ${name85} |`, html);
    const r = results[0];
    expect(r.value, `85-char instructor name must resolve (cap=200)`).not.toBeNull();
    expect(r.value).toBe(name85);
    expect(r.source).not.toBe("unresolved");
  });

  it("full street address at ~120 chars resolves from table cell", () => {
    // Real German address that could appear in Kursort
    const address = "Volkshochschule Frankfurt am Main, Sonnemannstraße 13, 60314 Frankfurt am Main, Deutschland";
    // ^= 91 chars
    expect(address.length).toBeGreaterThan(80);
    expect(address.length).toBeLessThan(200);

    const html = tableHtml([["Kursort", address]]);
    const md = `| Kursort | ${address} |`;
    const results = extractFields(["location"], null, md, html);
    const r = results[0];
    expect(r.value, "91-char address must resolve from table (cap=200)").not.toBeNull();
    expect(r.value).toContain("Frankfurt");
    expect(r.source).not.toBe("unresolved");
  });

  it("datetime string at ~100 chars resolves from table cell", () => {
    // Long German datetime — common in VHS pages. Padded to clearly exceed 80 chars.
    const datetime = "Montag, 07.09.2026, 18:00 - 20:15 Uhr, wöchentlich bis 30.11.2026 (12 Termine gesamt)";
    // Verify in-test: must be > 80 and < 200
    const actualLen = Buffer.byteLength(datetime, "utf8"); // use codePoint length for safety
    // String length (char count) — JS uses UTF-16 so ö = 1 char
    if (datetime.length <= 80) {
      // Pad to definitely exceed 80
      throw new Error(`Fixture too short: ${datetime.length} chars. Adjust the string.`);
    }
    expect(datetime.length).toBeGreaterThan(80);
    expect(datetime.length).toBeLessThan(200);

    const html = tableHtml([["Beginn", datetime]]);
    const md = `| Beginn | ${datetime} |`;
    const results = extractFields(["date"], null, md, html);
    const r = results[0];
    expect(r.value, "long datetime must resolve from table (cap=200)").not.toBeNull();
    expect(r.value).toContain("07.09.2026");
    expect(r.source).not.toBe("unresolved");
  });

  it("value at exactly 150 chars resolves from table cell", () => {
    const val150 = "B".repeat(150);
    const html = tableHtml([["instructor", val150]]);
    const md = `| instructor | ${val150} |`;
    const results = extractFields(["instructor"], null, md, html);
    const r = results[0];
    expect(r.value, "150-char value must resolve from table (cap=200)").not.toBeNull();
    expect(r.source).not.toBe("unresolved");
  });
});

// ─── 2. TABLE: value > 200 chars is STILL rejected ──────────────────────────

describe("iter-2 — TABLE: >200 char value is still rejected", () => {
  it("value at 201 chars is unresolved from table cell", () => {
    const val201 = "C".repeat(201);
    const html = tableHtml([["instructor", val201]]);
    const md = `| instructor | ${val201} |`;
    const results = extractFields(["instructor"], null, md, html);
    const r = results[0];
    // The table-row path rejects value.length > 200.
    // Markdown path: no "instructor:" pattern fires on "C"*201 either.
    // Must remain unresolved.
    expect(r.value, "201-char value must be rejected (exceeds table cap of 200)").toBeNull();
    expect(r.source).toBe("unresolved");
  });

  it("prose paragraph at 250 chars is unresolved from table cell (no-PATTERN_MAP field)", () => {
    // Use a field name that has NO PATTERN_MAP entry and no German synonym
    // so the only resolution path is the table/label-row layer.
    // If the table-row layer correctly rejects value.length > 200, this must be unresolved.
    const prose = "I".repeat(250);
    expect(prose.length).toBeGreaterThan(200);

    const html = tableHtml([["course_description_long", prose]]);
    const md = `| course_description_long | ${prose} |`;
    const results = extractFields(["course_description_long"], null, md, html);
    const r = results[0];
    // No PATTERN_MAP, no German synonym, table rejects >200 → must be unresolved.
    expect(r.value, "250-char value exceeds table cap of 200 → must be unresolved").toBeNull();
    expect(r.source).toBe("unresolved");
  });
});

// ─── 3. DL: value > 80 chars is STILL rejected (dl cap unchanged) ───────────

describe("iter-2 — DL: >80 char dd value is still capped/rejected", () => {
  it("dl dd value at 85 chars is unresolved", () => {
    const val85 = "D".repeat(85);
    const html = dlHtml([["instructor", val85]]);
    const results = extractFields(["instructor"], null, "", html);
    const r = results[0];
    // considerDlRow rejects value.length > 80 — must remain unresolved.
    expect(r.value, "dl dd value of 85 chars must be rejected (dl cap=80)").toBeNull();
    expect(r.source).toBe("unresolved");
  });

  it("dl dd value at exactly 80 chars resolves (boundary — still inside cap)", () => {
    const val80 = "E".repeat(80);
    const html = dlHtml([["instructor", val80]]);
    const results = extractFields(["instructor"], null, "", html);
    const r = results[0];
    // 80 chars: condition is `value.length > 80` → false, so it is accepted.
    expect(r.value, "dl dd value of exactly 80 chars must resolve (boundary inside cap)").not.toBeNull();
    expect(r.value).toBe(val80);
    expect(r.source).not.toBe("unresolved");
  });

  it("dl dd value at 81 chars is unresolved", () => {
    const val81 = "F".repeat(81);
    const html = dlHtml([["instructor", val81]]);
    const results = extractFields(["instructor"], null, "", html);
    const r = results[0];
    expect(r.value, "dl dd value of 81 chars must be rejected (dl cap=80)").toBeNull();
    expect(r.source).toBe("unresolved");
  });

  it("dl dd value at 120 chars is unresolved (well above dl cap)", () => {
    const longDd = "G".repeat(120);
    const html = dlHtml([["location", longDd]]);
    const results = extractFields(["location"], null, "", html);
    const r = results[0];
    expect(r.value, "dl dd value of 120 chars must be rejected (dl cap=80)").toBeNull();
    expect(r.source).toBe("unresolved");
  });

  it("contrast: same 85-char value in a TABLE resolves but in a DL does not", () => {
    const val85 = "H".repeat(85);

    const tableHtmlStr = tableHtml([["instructor", val85]]);
    const rTable = extractFields(["instructor"], null, "", tableHtmlStr);
    expect(rTable[0].value, "table: 85-char value must resolve").not.toBeNull();

    const dlHtmlStr = dlHtml([["instructor", val85]]);
    const rDl = extractFields(["instructor"], null, "", dlHtmlStr);
    expect(rDl[0].value, "dl: 85-char value must be rejected").toBeNull();
    expect(rDl[0].source).toBe("unresolved");
  });
});

// ─── 4. Regression: German + English matching unchanged from iter-1 ──────────

describe("iter-2 — Regression: German + English matching intact", () => {
  it("German label Anmeldeschluss still resolves registration_deadline", () => {
    const html = tableHtml([["Anmeldeschluss", "15.08.2026"]]);
    const r = extractFields(["registration_deadline"], null, "| Anmeldeschluss | 15.08.2026 |", html)[0];
    expect(r.value).not.toBeNull();
    expect(r.value).toContain("15.08.2026");
    expect(r.source).not.toBe("unresolved");
  });

  it("German label Dozentin still resolves instructor", () => {
    const html = tableHtml([["Dozentin", "Dr. Lena Bauer"]]);
    const r = extractFields(["instructor"], null, "| Dozentin | Dr. Lena Bauer |", html)[0];
    expect(r.value).not.toBeNull();
    expect(r.value).toContain("Lena Bauer");
    expect(r.source).not.toBe("unresolved");
  });

  it("English 'Price' label still resolves with score 3 (exact match beats German synonym score 2)", () => {
    const html = tableHtml([["Price", "$29.99"]]);
    const r = extractFields(["price"], null, "| Price | $29.99 |", html)[0];
    expect(r.value).not.toBeNull();
    expect(r.value).toContain("29.99");
    expect(r.source).not.toBe("unresolved");
  });

  it("English exact match beats German synonym in mixed table", () => {
    // Both English 'Location' and German 'Kursort' present — English exact (score 3) wins
    const html = tableHtml([
      ["Location", "Boston, MA"],
      ["Kursort", "Berlin Mitte"],
    ]);
    const md = "| Location | Boston, MA |\n| Kursort | Berlin Mitte |";
    const r = extractFields(["location"], null, md, html)[0];
    expect(r.value).not.toBeNull();
    // English 'Location' is exact match (score 3) → wins over German synonym (score 2)
    expect(r.value).toBe("Boston, MA");
    expect(r.source).not.toBe("unresolved");
  });

  it("German long instructor name (85 chars) now resolves from table in German context", () => {
    // This was the failing edge case found in iter-1 — now fixed by raising table cap to 200
    const longName = "Prof. Dr. Maria-Theresia von Hohenstein-Wülfersberg, Institut für Fremdsprachenpädagogik";
    expect(longName.length).toBeGreaterThan(80);
    expect(longName.length).toBeLessThan(200);

    const html = tableHtml([["Kursleitung", longName]]);
    const md = `| Kursleitung | ${longName} |`;
    const r = extractFields(["instructor"], null, md, html)[0];
    expect(r.value, "Long German instructor name must now resolve (iter-1 edge case fixed)").not.toBeNull();
    expect(r.value).toContain("Hohenstein");
    expect(r.source).not.toBe("unresolved");
  });
});
