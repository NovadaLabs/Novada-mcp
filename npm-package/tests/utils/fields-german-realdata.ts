/**
 * NOV-669 — Real-data simulation via realistic hand-built fixture.
 *
 * NOTE: All live vhs.*.de / kufer sites are unreachable from this environment
 * (JS SPAs, HTTP2 protocol errors, or geo-blocked). This script uses a
 * realistic fixture that mirrors the ACTUAL structure of Kufer VHS pages
 * (confirmed by the feedback ticket's description of the original bug:
 * 2-col table with German labels Beginn, Status, Kursentgelt on course detail pages).
 *
 * Run: npx tsx tests/utils/fields-german-realdata.ts
 */

import { extractFields } from "../../src/utils/fields.js";

// Realistic Kufer VHS course detail page HTML (matches the structure
// described in NOV-669 feedback: 2-column label-value table with German labels)
const REALISTIC_VHS_HTML = `
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <title>Arabisch für Anfänger - VHS Detailseite</title>
</head>
<body>
<div class="kursdetails">
  <h1>Arabisch für Anfänger</h1>
  <div class="kurs-info-block">
    <table class="kursinfo-tabelle">
      <tbody>
        <tr>
          <td class="label">Beginn</td>
          <td class="value">Mo., 07.09.2026, 18:00 - 20:00 Uhr</td>
        </tr>
        <tr>
          <td class="label">Ende</td>
          <td class="value">Mo., 30.11.2026, 20:00 Uhr</td>
        </tr>
        <tr>
          <td class="label">Status</td>
          <td class="value">Anmeldung möglich</td>
        </tr>
        <tr>
          <td class="label">Kursentgelt</td>
          <td class="value">145,00 €</td>
        </tr>
        <tr>
          <td class="label">Kursort</td>
          <td class="value">VHS-Zentrum, Raum 204</td>
        </tr>
        <tr>
          <td class="label">Kursleitung</td>
          <td class="value">Ahmed Al-Rashid</td>
        </tr>
        <tr>
          <td class="label">Anmeldeschluss</td>
          <td class="value">31.08.2026</td>
        </tr>
        <tr>
          <td class="label">Kursnummer</td>
          <td class="value">AR-2026-101</td>
        </tr>
        <tr>
          <td class="label">Dauer</td>
          <td class="value">24 Unterrichtsstunden</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
</body>
</html>
`;

const REALISTIC_VHS_MARKDOWN = `
| Beginn | Mo., 07.09.2026, 18:00 - 20:00 Uhr |
| Ende | Mo., 30.11.2026, 20:00 Uhr |
| Status | Anmeldung möglich |
| Kursentgelt | 145,00 € |
| Kursort | VHS-Zentrum, Raum 204 |
| Kursleitung | Ahmed Al-Rashid |
| Anmeldeschluss | 31.08.2026 |
| Kursnummer | AR-2026-101 |
| Dauer | 24 Unterrichtsstunden |
`;

const fields = ["date", "availability_status", "price", "location", "instructor", "registration_deadline", "course_number", "duration"];

console.log("=== NOV-669 Real-Data Simulation (Realistic Kufer VHS fixture) ===");
console.log("NOTE: Live vhs.*.de pages are all unreachable from this env (JS SPA/HTTP2/geo-blocked).");
console.log("Using hand-built fixture that mirrors actual Kufer 2-col label-value structure.\n");

const results = extractFields(fields, null, REALISTIC_VHS_MARKDOWN, REALISTIC_VHS_HTML);

let allPassed = true;
for (const r of results) {
  const status = r.value !== null ? "PASS" : "FAIL";
  if (r.value === null) allPassed = false;
  console.log(`${status}  ${r.field.padEnd(25)} source=${r.source.padEnd(12)} value=${JSON.stringify(r.value)}`);
}

console.log(`\n${allPassed ? "ALL FIELDS RESOLVED — PASS" : "SOME FIELDS UNRESOLVED — FAIL"}`);

// Explicit checks
const byField = Object.fromEntries(results.map(r => [r.field, r]));
const checks = [
  { field: "date",                 expect_contains: "07.09.2026",    label: "Beginn→date" },
  { field: "availability_status", expect_contains: "Anmeldung",     label: "Status→availability_status" },
  { field: "price",               expect_contains: "145",           label: "Kursentgelt→price" },
  { field: "location",            expect_contains: "Raum 204",      label: "Kursort→location" },
  { field: "instructor",          expect_contains: "Al-Rashid",     label: "Kursleitung→instructor" },
  { field: "registration_deadline", expect_contains: "31.08.2026", label: "Anmeldeschluss→registration_deadline" },
  { field: "course_number",       expect_contains: "AR-2026-101",   label: "Kursnummer→course_number" },
  { field: "duration",            expect_contains: "24",            label: "Dauer→duration" },
];

console.log("\n=== Detailed field checks ===");
let checksPassed = 0;
for (const check of checks) {
  const r = byField[check.field];
  const hasValue = r?.value !== null && r?.value !== undefined;
  const containsExpected = hasValue && r.value!.includes(check.expect_contains);
  const status = containsExpected ? "PASS" : "FAIL";
  if (containsExpected) checksPassed++;
  console.log(`${status}  ${check.label}: expected to contain "${check.expect_contains}", got ${JSON.stringify(r?.value)}`);
}

console.log(`\n${checksPassed}/${checks.length} checks passed`);
if (checksPassed < checks.length) {
  process.exit(1);
}
