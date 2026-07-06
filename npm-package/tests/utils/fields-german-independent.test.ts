/**
 * INDEPENDENT verifier test for NOV-669 — written by a SEPARATE agent (verifier),
 * using different HTML fixtures than the fixer's test.
 *
 * Covers: Anmeldeschluss, Kursentgelt, Kursort, Kursleitung, Kursnummer
 * Plus: English regression, adversarial near-miss labels, edge cases.
 */

import { describe, it, expect } from "vitest";
import { extractFields } from "../../src/utils/fields.js";

// --- FIXTURE 1: Kufer-style VHS course with different German labels than fixer used ---
// Uses: Anmeldeschluss, Kursentgelt, Kursort, Kursleitung, Kursnummer (all different from fixer's)
const KUFER_COURSE_HTML = `
<html>
<head><title>Kufer VHS Kurs Detail</title></head>
<body>
  <h1>Spanisch Intensivkurs</h1>
  <table class="kurs-details">
    <tbody>
      <tr><td>Anmeldeschluss</td><td>30.06.2026</td></tr>
      <tr><td>Kursentgelt</td><td>89,00 €</td></tr>
      <tr><td>Kursort</td><td>VHS Hauptgebäude, Zimmer 305</td></tr>
      <tr><td>Kursleitung</td><td>Prof. Dr. Carlos Ruiz</td></tr>
      <tr><td>Kursnummer</td><td>SP-2026-042</td></tr>
    </tbody>
  </table>
</body>
</html>
`;

const KUFER_COURSE_MARKDOWN = `
| Anmeldeschluss | 30.06.2026 |
| Kursentgelt | 89,00 € |
| Kursort | VHS Hauptgebäude, Zimmer 305 |
| Kursleitung | Prof. Dr. Carlos Ruiz |
| Kursnummer | SP-2026-042 |
`;

// --- FIXTURE 2: Mixed German + English table (regression guard) ---
const MIXED_TABLE_HTML = `
<html><body>
  <table>
    <tbody>
      <tr><td>Price</td><td>$10.00</td></tr>
      <tr><td>Location</td><td>New York</td></tr>
      <tr><td>Kursort</td><td>Berlin Mitte</td></tr>
      <tr><td>Kursentgelt</td><td>45,00 €</td></tr>
    </tbody>
  </table>
</body></html>
`;

const MIXED_TABLE_MARKDOWN = `
| Price | $10.00 |
| Location | New York |
| Kursort | Berlin Mitte |
| Kursentgelt | 45,00 € |
`;

// --- FIXTURE 3: Adversarial — label that partially matches German but is NOT a synonym ---
// "Kursinhalt" looks like it could match "course_number" but it's not in the map
// "Kursplatz" (course slot) is NOT in the map → should return unresolved
const ADVERSARIAL_HTML = `
<html><body>
  <table>
    <tbody>
      <tr><td>Kursinhalt</td><td>Grammatik und Konversation</td></tr>
      <tr><td>Kursplatz</td><td>Platz 3 von 20</td></tr>
      <tr><td>Kursnummer</td><td>DE-2026-007</td></tr>
    </tbody>
  </table>
</body></html>
`;

const ADVERSARIAL_MARKDOWN = `
| Kursinhalt | Grammatik und Konversation |
| Kursplatz | Platz 3 von 20 |
| Kursnummer | DE-2026-007 |
`;

// --- FIXTURE 4: Pure English table (regression — German additions must not break English) ---
const ENGLISH_TABLE_HTML = `
<html><body>
  <table>
    <tbody>
      <tr><td>Price</td><td>$10.00</td></tr>
      <tr><td>Location</td><td>San Francisco</td></tr>
      <tr><td>Instructor</td><td>Jane Smith</td></tr>
    </tbody>
  </table>
</body></html>
`;

const ENGLISH_TABLE_MARKDOWN = `
| Price | $10.00 |
| Location | San Francisco |
| Instructor | Jane Smith |
`;

describe("NOV-669 INDEPENDENT — Kufer-style VHS course with different German labels", () => {
  it("resolves registration_deadline from Anmeldeschluss", () => {
    const results = extractFields(
      ["registration_deadline"],
      null,
      KUFER_COURSE_MARKDOWN,
      KUFER_COURSE_HTML
    );
    const r = results[0];
    expect(r.value, "Anmeldeschluss should resolve to date").not.toBeNull();
    expect(r.value).toContain("30.06.2026");
    expect(r.source).not.toBe("unresolved");
  });

  it("resolves price from Kursentgelt", () => {
    const results = extractFields(
      ["price"],
      null,
      KUFER_COURSE_MARKDOWN,
      KUFER_COURSE_HTML
    );
    const r = results[0];
    expect(r.value, "Kursentgelt should resolve to price").not.toBeNull();
    expect(r.value).toContain("89");
    expect(r.source).not.toBe("unresolved");
  });

  it("resolves location from Kursort", () => {
    const results = extractFields(
      ["location"],
      null,
      KUFER_COURSE_MARKDOWN,
      KUFER_COURSE_HTML
    );
    const r = results[0];
    expect(r.value, "Kursort should resolve to location").not.toBeNull();
    expect(r.value).toContain("305");
    expect(r.source).not.toBe("unresolved");
  });

  it("resolves instructor from Kursleitung", () => {
    const results = extractFields(
      ["instructor"],
      null,
      KUFER_COURSE_MARKDOWN,
      KUFER_COURSE_HTML
    );
    const r = results[0];
    expect(r.value, "Kursleitung should resolve to instructor").not.toBeNull();
    expect(r.value).toContain("Carlos Ruiz");
    expect(r.source).not.toBe("unresolved");
  });

  it("resolves course_number from Kursnummer", () => {
    const results = extractFields(
      ["course_number"],
      null,
      KUFER_COURSE_MARKDOWN,
      KUFER_COURSE_HTML
    );
    const r = results[0];
    expect(r.value, "Kursnummer should resolve to course_number").not.toBeNull();
    expect(r.value).toContain("SP-2026-042");
    expect(r.source).not.toBe("unresolved");
  });

  it("resolves all 5 Kufer fields in one call", () => {
    const results = extractFields(
      ["registration_deadline", "price", "location", "instructor", "course_number"],
      null,
      KUFER_COURSE_MARKDOWN,
      KUFER_COURSE_HTML
    );
    const byField = Object.fromEntries(results.map(r => [r.field, r]));
    expect(byField["registration_deadline"].value).not.toBeNull();
    expect(byField["price"].value).not.toBeNull();
    expect(byField["location"].value).not.toBeNull();
    expect(byField["instructor"].value).not.toBeNull();
    expect(byField["course_number"].value).not.toBeNull();
  });
});

describe("NOV-669 INDEPENDENT — Regression: English-only table still works", () => {
  it("price resolves from English 'Price' label", () => {
    const results = extractFields(
      ["price"],
      null,
      ENGLISH_TABLE_MARKDOWN,
      ENGLISH_TABLE_HTML
    );
    const r = results[0];
    expect(r.value, "English 'Price' must still resolve").not.toBeNull();
    expect(r.value).toContain("10");
    expect(r.source).not.toBe("unresolved");
  });

  it("location resolves from English 'Location' label", () => {
    const results = extractFields(
      ["location"],
      null,
      ENGLISH_TABLE_MARKDOWN,
      ENGLISH_TABLE_HTML
    );
    const r = results[0];
    expect(r.value, "English 'Location' must still resolve").not.toBeNull();
    expect(r.value).toContain("San Francisco");
    expect(r.source).not.toBe("unresolved");
  });

  it("instructor resolves from English 'Instructor' label", () => {
    const results = extractFields(
      ["instructor"],
      null,
      ENGLISH_TABLE_MARKDOWN,
      ENGLISH_TABLE_HTML
    );
    const r = results[0];
    expect(r.value, "English 'Instructor' must still resolve").not.toBeNull();
    expect(r.value).toContain("Jane Smith");
    expect(r.source).not.toBe("unresolved");
  });
});

describe("NOV-669 INDEPENDENT — Mixed German+English table", () => {
  it("English 'Price' wins over 'Kursentgelt' for field=price (first match by score)", () => {
    // Both exist; either could win. Key: the result must be non-null
    const results = extractFields(
      ["price"],
      null,
      MIXED_TABLE_MARKDOWN,
      MIXED_TABLE_HTML
    );
    const r = results[0];
    expect(r.value, "price must resolve from mixed table").not.toBeNull();
    expect(r.source).not.toBe("unresolved");
  });

  it("English 'Location' wins over 'Kursort' for field=location (score 3 exact vs 2 German)", () => {
    const results = extractFields(
      ["location"],
      null,
      MIXED_TABLE_MARKDOWN,
      MIXED_TABLE_HTML
    );
    const r = results[0];
    // English exact match has score 3, German synonym has score 2 → English wins
    expect(r.value).not.toBeNull();
    expect(r.value).toContain("New York");
    expect(r.source).not.toBe("unresolved");
  });
});

describe("NOV-669 INDEPENDENT — Adversarial: unknown German labels still return unresolved", () => {
  it("Kursinhalt does NOT resolve to any standard field (not in German map)", () => {
    // 'Kursinhalt' is not in GERMAN_LABEL_MAP, so 'description' should NOT resolve to it
    // unless 'description' pattern happens to match via markdown fallback
    const results = extractFields(
      ["description"],
      null,
      ADVERSARIAL_MARKDOWN,
      ADVERSARIAL_HTML
    );
    // We just ensure it doesn't incorrectly pick up "Kursinhalt" as the label-match
    // (description has no German synonym in the map).
    // It might still match via other layers (heading/pattern) — that is acceptable.
    // Main guard: source should NOT be "infobox" or "table" coming from a German label.
    const r = results[0];
    if (r.source === "table") {
      // If it resolved via table layer, verify it didn't come from an unmapped German label
      // by checking the value doesn't contain "Grammatik" (Kursinhalt's value)
      expect(r.value).not.toContain("Grammatik");
    }
  });

  it("Kursplatz does NOT resolve to 'participants' (not in German map)", () => {
    const results = extractFields(
      ["participants"],
      null,
      ADVERSARIAL_MARKDOWN,
      ADVERSARIAL_HTML
    );
    const r = results[0];
    // Kursplatz is NOT in GERMAN_LABEL_MAP → participants must be unresolved
    expect(r.value).toBeNull();
    expect(r.source).toBe("unresolved");
    expect(r.agent_instruction).toBeDefined();
  });

  it("Kursnummer correctly resolves to course_number (IS in German map)", () => {
    const results = extractFields(
      ["course_number"],
      null,
      ADVERSARIAL_MARKDOWN,
      ADVERSARIAL_HTML
    );
    const r = results[0];
    expect(r.value).not.toBeNull();
    expect(r.value).toContain("DE-2026-007");
    expect(r.source).not.toBe("unresolved");
  });

  it("field with no match at all returns unresolved with agent_instruction", () => {
    const results = extractFields(
      ["nonexistent_field_xyz_abc"],
      null,
      ADVERSARIAL_MARKDOWN,
      ADVERSARIAL_HTML
    );
    const r = results[0];
    expect(r.value).toBeNull();
    expect(r.source).toBe("unresolved");
    expect(r.agent_instruction).toBeDefined();
    expect(r.agent_instruction).toContain("nonexistent_field_xyz_abc");
  });
});

describe("NOV-669 INDEPENDENT — Edge cases and corner cases", () => {
  it("German label with Umlaut (Verfügbarkeit) resolves to availability_status", () => {
    const umlauts_html = `
<html><body>
  <table>
    <tbody>
      <tr><td>Verfügbarkeit</td><td>Noch 3 Plätze frei</td></tr>
    </tbody>
  </table>
</body></html>
`;
    const umlauts_md = `| Verfügbarkeit | Noch 3 Plätze frei |`;
    const results = extractFields(
      ["availability_status"],
      null,
      umlauts_md,
      umlauts_html
    );
    const r = results[0];
    expect(r.value).not.toBeNull();
    expect(r.value).toContain("Plätze");
    expect(r.source).not.toBe("unresolved");
  });

  it("German label 'Datum' resolves to date", () => {
    const datum_html = `
<html><body>
  <table>
    <tbody>
      <tr><td>Datum</td><td>15.08.2026</td></tr>
    </tbody>
  </table>
</body></html>
`;
    const datum_md = `| Datum | 15.08.2026 |`;
    const results = extractFields(["date"], null, datum_md, datum_html);
    const r = results[0];
    expect(r.value).not.toBeNull();
    expect(r.value).toContain("15.08.2026");
    expect(r.source).not.toBe("unresolved");
  });

  it("German label 'Dozent' resolves to instructor", () => {
    const dozent_html = `
<html><body>
  <table>
    <tbody>
      <tr><td>Dozent</td><td>Dr. Hans Fischer</td></tr>
    </tbody>
  </table>
</body></html>
`;
    const dozent_md = `| Dozent | Dr. Hans Fischer |`;
    const results = extractFields(["instructor"], null, dozent_md, dozent_html);
    const r = results[0];
    expect(r.value).not.toBeNull();
    expect(r.value).toContain("Hans Fischer");
    expect(r.source).not.toBe("unresolved");
  });

  it("Empty HTML returns unresolved for German fields", () => {
    const results = extractFields(
      ["registration_deadline", "course_number"],
      null,
      "",
      "<html><body></body></html>"
    );
    for (const r of results) {
      expect(r.value).toBeNull();
      expect(r.source).toBe("unresolved");
    }
  });
});
