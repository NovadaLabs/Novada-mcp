/**
 * NOV-669 — fields=[...] fails on 2-column German label-value tables.
 *
 * Reproduces the VHS scraping miss and verifies two fixes:
 * 1. German synonym expansion: "Beginn"→date, "Status"→availability_status, etc.
 * 2. Table-cell value cap raised from 80→200 chars for <tr> rows (addresses, long names).
 */

import { describe, it, expect } from "vitest";
import { extractFields } from "../../src/utils/fields.js";

const GERMAN_VHS_HTML = `
<html>
<head><title>VHS Kurs</title></head>
<body>
  <table>
    <tbody>
      <tr><td>Beginn</td><td>Do., 09.07.2026, 10:00 - 11:00 Uhr</td></tr>
      <tr><td>Status</td><td>Dieser Kurs ist leider ausgebucht</td></tr>
      <tr><td>Kursentgelt</td><td>25,00 €</td></tr>
      <tr><td>Kursort</td><td>Volkshochschule, Raum 12</td></tr>
      <tr><td>Kursleitung</td><td>Maria Müller</td></tr>
    </tbody>
  </table>
</body>
</html>
`;

const GERMAN_VHS_MARKDOWN = `
| Beginn | Do., 09.07.2026, 10:00 - 11:00 Uhr |
| Status | Dieser Kurs ist leider ausgebucht |
| Kursentgelt | 25,00 € |
| Kursort | Volkshochschule, Raum 12 |
| Kursleitung | Maria Müller |
`;

// Long-value fixtures for the 80→200 cap test (iter-2)
const LONG_VALUE_HTML = `
<html>
<head><title>VHS Kurs Extended</title></head>
<body>
  <table>
    <tbody>
      <tr><td>Kursleitung</td><td>Prof. Dr. Elisabeth Rosenberger-Hoffmann, Fachbereich Sprachen und Kommunikation</td></tr>
      <tr><td>Kursort</td><td>VHS Hauptgebäude, Zimmer 305, Musterstraße 12, 40210 Düsseldorf</td></tr>
    </tbody>
  </table>
</body>
</html>
`;

const LONG_VALUE_MARKDOWN = `
| Kursleitung | Prof. Dr. Elisabeth Rosenberger-Hoffmann, Fachbereich Sprachen und Kommunikation |
| Kursort | VHS Hauptgebäude, Zimmer 305, Musterstraße 12, 40210 Düsseldorf |
`;

// A genuine paragraph in a table cell — should NOT be harvested as a field value.
// 210 chars — exceeds the 200-char cap so it is rejected.
const PROSE_PARAGRAPH_HTML = `
<html>
<head><title>Test</title></head>
<body>
  <table>
    <tbody>
      <tr><td>Kursleitung</td><td>Dieser Kurs richtet sich an Teilnehmer, die bereits Grundkenntnisse in der deutschen Sprache besitzen und ihre Kenntnisse in Grammatik und Wortschatz systematisch erweitern und vertiefen möchten. Vorkenntnisse sind erforderlich.</td></tr>
    </tbody>
  </table>
</body>
</html>
`;

describe("NOV-669 — German 2-column label-value table extraction", () => {
  it("REPRODUCES: date returns unresolved before fix (Beginn→date miss)", () => {
    // This test documents the pre-fix behavior. After the fix it should resolve.
    // If this assertion fails, the fix is in place — see the pass test below.
    const results = extractFields(["date"], null, GERMAN_VHS_MARKDOWN, GERMAN_VHS_HTML);
    // Pre-fix: labelMatchScore("beginn", "date") == 0, so nothing resolves.
    // Post-fix: German synonym map maps "beginn" → "date", so it resolves.
    // We assert the post-fix behavior (resolved with "09.07.2026"):
    expect(results[0].value).not.toBeNull();
    expect(results[0].value).toContain("09.07.2026");
    expect(results[0].source).not.toBe("unresolved");
  });

  it("REPRODUCES: availability_status returns unresolved before fix (Status→availability_status miss)", () => {
    const results = extractFields(
      ["availability_status"],
      null,
      GERMAN_VHS_MARKDOWN,
      GERMAN_VHS_HTML
    );
    // Pre-fix: labelMatchScore("status", "availability_status") == 0.
    // Post-fix: German synonym map maps "status" → "availability_status".
    expect(results[0].value).not.toBeNull();
    expect(results[0].value).toContain("ausgebucht");
    expect(results[0].source).not.toBe("unresolved");
  });

  it("resolves date, availability_status, price from German VHS table fixture", () => {
    const results = extractFields(
      ["date", "availability_status", "price"],
      null,
      GERMAN_VHS_MARKDOWN,
      GERMAN_VHS_HTML
    );

    const dateResult = results.find(r => r.field === "date")!;
    const statusResult = results.find(r => r.field === "availability_status")!;
    const priceResult = results.find(r => r.field === "price")!;

    // date: "Beginn" row should resolve to the datetime string
    expect(dateResult.value).not.toBeNull();
    expect(dateResult.value).toContain("09.07.2026");
    expect(dateResult.source).not.toBe("unresolved");

    // availability_status: "Status" row should resolve to the status text
    expect(statusResult.value).not.toBeNull();
    expect(statusResult.value).toContain("ausgebucht");
    expect(statusResult.source).not.toBe("unresolved");

    // price: "Kursentgelt" row should resolve
    expect(priceResult.value).not.toBeNull();
    expect(priceResult.source).not.toBe("unresolved");
  });

  it("truly-absent field still returns unresolved with agent_instruction", () => {
    const results = extractFields(
      ["registration_number_xyz_nonexistent"],
      null,
      GERMAN_VHS_MARKDOWN,
      GERMAN_VHS_HTML
    );
    expect(results[0].value).toBeNull();
    expect(results[0].source).toBe("unresolved");
    expect(results[0].agent_instruction).toBeDefined();
    expect(results[0].agent_instruction).toContain("registration_number_xyz_nonexistent");
  });

  it("resolves location from German 'Kursort' label", () => {
    const results = extractFields(["location"], null, GERMAN_VHS_MARKDOWN, GERMAN_VHS_HTML);
    expect(results[0].value).not.toBeNull();
    expect(results[0].source).not.toBe("unresolved");
  });

  it("resolves instructor from German 'Kursleitung' label", () => {
    const results = extractFields(["instructor"], null, GERMAN_VHS_MARKDOWN, GERMAN_VHS_HTML);
    expect(results[0].value).not.toBeNull();
    expect(results[0].source).not.toBe("unresolved");
  });

  it("accepts English canonical field name alongside German label (bidirectional)", () => {
    // "date" (English) should match German label "Beginn"
    const results = extractFields(["date"], null, GERMAN_VHS_MARKDOWN, GERMAN_VHS_HTML);
    expect(results[0].value).not.toBeNull();
    expect(results[0].value).toContain("09.07.2026");
  });
});

describe("NOV-669 iter-2 — table-cell value cap raised 80→200 chars", () => {
  it("resolves instructor with a long name (>80 chars) from table cell", () => {
    // "Prof. Dr. Elisabeth Rosenberger-Hoffmann, Fachbereich Sprachen und Kommunikation" = 82 chars
    // Would have been rejected by the old 80-char cap.
    const results = extractFields(["instructor"], null, LONG_VALUE_MARKDOWN, LONG_VALUE_HTML);
    expect(results[0].value).not.toBeNull();
    expect(results[0].source).not.toBe("unresolved");
    expect(results[0].value).toContain("Rosenberger-Hoffmann");
  });

  it("resolves location with a full address (>80 chars) from table cell", () => {
    // "VHS Hauptgebäude, Zimmer 305, Musterstraße 12, 40210 Düsseldorf" = 64 chars — passes even old cap
    // Use the instructor fixture which is the harder case above 80.
    const results = extractFields(["location"], null, LONG_VALUE_MARKDOWN, LONG_VALUE_HTML);
    expect(results[0].value).not.toBeNull();
    expect(results[0].source).not.toBe("unresolved");
    expect(results[0].value).toContain("Düsseldorf");
  });

  it("does NOT harvest a genuine prose paragraph (>200 chars) from a table cell", () => {
    // Value is 210+ chars — exceeds the 200-char table-cell cap, should be rejected.
    const results = extractFields(["instructor"], null, "", PROSE_PARAGRAPH_HTML);
    expect(results[0].value).toBeNull();
    expect(results[0].source).toBe("unresolved");
  });
});
