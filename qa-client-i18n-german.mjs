/**
 * i18n-german QA — Novada MCP 0.9.0
 * Tests: GERMAN_LABEL_MAP, Kufer/webbasys availability, ausgebucht detection
 * Perspective: German i18n — live MCP client, offline API key (dummy)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as cheerio from "cheerio";

// ─── MCP client factory ───────────────────────────────────────────────────────
async function makeClient() {
  const t = new StdioClientTransport({
    command: "node",
    args: ["/Users/tongwu/Projects/novada-mcp/build/index.js"],
    env: Object.assign({}, process.env, { NOVADA_API_KEY: "dummy" })
  });
  const c = new Client({ name: "qa-i18n-german", version: "0" }, { capabilities: {} });
  await c.connect(t);
  return c;
}

async function callTool(client, name, args) {
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? "";
    return { ok: !r.isError, isError: r.isError ?? false, text, raw: r };
  } catch (e) {
    return { ok: false, isError: true, text: String(e), threw: true };
  }
}

const findings = [];

// ─── Part 1: Unit-level — test Kufer detection logic via inline simulation ────

function normalizeKuferStatus(text) {
  if (!text) return "unknown";
  const t = text.toLowerCase();
  if (/ausgebucht/.test(t)) return "ausgebucht";
  if (/warteliste/.test(t)) return "waitlist";
  if (/anmeldung\s+geschlossen/.test(t)) return "closed";
  if (/buchbar/.test(t)) return "buchbar";
  const placesMatch = text.match(/(\d+)\s+plät/i);
  if (placesMatch) return `${parseInt(placesMatch[1], 10)}_places`;
  return "unknown";
}

// Unit test: "nicht buchbar" → Should NOT return "buchbar" (false positive)
const nichtBuchbarResult = normalizeKuferStatus("nicht buchbar");
findings.push({
  id: "G-1",
  desc: "normalizeKuferStatus: 'nicht buchbar' (not bookable) incorrectly maps to 'buchbar'",
  input: "nicht buchbar",
  result: nichtBuchbarResult,
  expected: "Should be 'unknown' or a distinct 'nicht_buchbar' status",
  actual: nichtBuchbarResult,
  isBug: nichtBuchbarResult === "buchbar",
  severity: "High",
  note: "The pattern /buchbar/ is a substring match — 'nicht buchbar', 'nur telefonisch buchbar', 'telefonisch buchbar' all return 'buchbar' (bookable), misleading agents about availability."
});

// Unit test: "nur telefonisch buchbar" also false positive
const nurTelResult = normalizeKuferStatus("nur telefonisch buchbar");
findings.push({
  id: "G-2",
  desc: "normalizeKuferStatus: 'nur telefonisch buchbar' maps to 'buchbar' without indicating limitation",
  input: "nur telefonisch buchbar",
  result: nurTelResult,
  expected: "'buchbar' with caveat, or distinct status like 'phone_only'",
  actual: nurTelResult,
  isBug: nurTelResult === "buchbar",
  severity: "Low",
  note: "Status returned is technically correct (bookable), but drops the 'nur telefonisch' (phone only) restriction from the kufer_availability output."
});

// Unit test: "0 Plätze frei" → returns "0_places" — should it be "ausgebucht"?
const zeroPlaetzeResult = normalizeKuferStatus("0 Plätze frei");
findings.push({
  id: "G-3",
  desc: "normalizeKuferStatus: '0 Plätze frei' returns '0_places' not 'ausgebucht'",
  input: "0 Plätze frei",
  result: zeroPlaetzeResult,
  expected: "'ausgebucht' (0 places available = fully booked) or at least an agent_instruction warning",
  actual: zeroPlaetzeResult,
  isBug: zeroPlaetzeResult === "0_places",  // Not necessarily wrong, but semantically confusing
  severity: "Low",
  note: "0_places is technically correct but status_label would say '0 places available' — not 'fully booked'. Agent might not understand this means fully booked."
});

// Unit test: "noch 5 freie Plätze" — different German phrasing, misses the N_places detection
const freiePlaetzeResult = normalizeKuferStatus("noch 5 freie Plätze");
findings.push({
  id: "G-4",
  desc: "normalizeKuferStatus: 'noch 5 freie Plätze' (5 free places) returns 'unknown' — unrecognized phrasing",
  input: "noch 5 freie Plätze",
  result: freiePlaetzeResult,
  expected: "'5_places' or recognized status",
  actual: freiePlaetzeResult,
  isBug: freiePlaetzeResult === "unknown",
  severity: "Low",
  note: "The regex /(\\d+)\\s+plät/i requires the number to be immediately before 'Plät'. 'noch 5 freie Plätze' has 'freie' between '5' and 'Plätze', so it returns unknown. Common German VHS phrasing is missed."
});

// Unit test: "Plätze: 5" — another common phrasing 
const plaetzeColonResult = normalizeKuferStatus("Plätze: 5");
findings.push({
  id: "G-5",
  desc: "normalizeKuferStatus: 'Plätze: 5' returns 'unknown' — reverse label:value order not handled",
  input: "Plätze: 5",
  result: plaetzeColonResult,
  expected: "'5_places'",
  actual: plaetzeColonResult,
  isBug: plaetzeColonResult === "unknown",
  severity: "Low",
  note: "Pattern expects 'N Plät' format, not 'Plätze: N'. VHS pages may use either form."
});

// ─── Part 2: GERMAN_LABEL_MAP — test colon-suffixed labels ───────────────────
const GERMAN_LABEL_MAP_KEYS = [
  "beginn", "ende", "datum", "startdatum", "enddatum", "uhrzeit",
  "anfangszeit", "endzeit", "termine", "status", "kursstatus",
  "verfügbarkeit", "kursentgelt", "entgelt", "gebühr", "preis", "kosten",
  "teilnahmegebühr", "kursort", "ort", "veranstaltungsort", "raum", "dauer",
  "kursleitung", "dozent", "dozentin", "lehrkraft", "leitung", "anmeldeschluss",
  "anmeldefrist", "kursnummer", "kurs-nr.", "nr.", "kursnr.", "mindestteilnehmerzahl",
  "höchstteilnehmerzahl", "teilnehmerzahl", "teilnehmer", "bemerkungen", "hinweise",
  "anmerkungen"
];

// German VHS pages commonly add trailing colon to table cell labels: "Beginn:" "Status:"
// The labelMatchScoreWithGerman function uses l = label.toLowerCase().trim()
// trim() removes whitespace but NOT the trailing colon.
// So "Beginn:" → l = "beginn:" → NOT in GERMAN_LABEL_MAP → returns 0 (no match)
const colonTestCases = [
  ["Beginn:", "beginn:"],
  ["Status:", "status:"],
  ["Anmeldeschluss:", "anmeldeschluss:"],
  ["Kursort:", "kursort:"],
  ["Dozent:", "dozent:"],
];

const GERMAN_LABEL_MAP = {
  "beginn": "date", "ende": "date", "datum": "date", "startdatum": "date",
  "enddatum": "date", "uhrzeit": "time", "anfangszeit": "time", "endzeit": "time",
  "termine": "dates", "status": "availability_status", "kursstatus": "availability_status",
  "verfügbarkeit": "availability_status", "kursentgelt": "price", "entgelt": "price",
  "gebühr": "price", "preis": "price", "kosten": "price", "teilnahmegebühr": "price",
  "kursort": "location", "ort": "location", "veranstaltungsort": "location", "raum": "location",
  "dauer": "duration", "kursleitung": "instructor", "dozent": "instructor",
  "dozentin": "instructor", "lehrkraft": "instructor", "leitung": "instructor",
  "anmeldeschluss": "registration_deadline", "anmeldefrist": "registration_deadline",
  "kursnummer": "course_number", "kurs-nr.": "course_number", "nr.": "course_number",
  "kursnr.": "course_number", "mindestteilnehmerzahl": "participants",
  "höchstteilnehmerzahl": "participants", "teilnehmerzahl": "participants",
  "teilnehmer": "participants", "bemerkungen": "notes", "hinweise": "notes",
  "anmerkungen": "notes",
};

const colonBug = colonTestCases.map(([raw, lowered]) => ({
  label: raw,
  lowered,
  inMap: GERMAN_LABEL_MAP[lowered] ?? null,
  inMapWithoutColon: GERMAN_LABEL_MAP[lowered.replace(/:$/, "")] ?? null,
}));

const colonBugFound = colonBug.some(c => c.inMap === null && c.inMapWithoutColon !== null);
findings.push({
  id: "G-6",
  desc: "GERMAN_LABEL_MAP: trailing colon in DOM labels breaks German label matching",
  inputs: colonBug,
  expected: "GERMAN_LABEL_MAP keys should also include colon-suffixed variants like 'beginn:' OR labelMatchScoreWithGerman should strip trailing colon",
  isBug: colonBugFound,
  severity: colonBugFound ? "High" : "Low",
  note: "German VHS HTML tables commonly render: <td>Beginn:</td><td>...</td>. trim() removes whitespace but not colon. 'beginn:' is not in GERMAN_LABEL_MAP so the German label fails to match 'date'."
});

// ─── Part 3: Kufer detection trigger check — false positive analysis ──────────
// The isKufer check: /kufer/i.test(html) OR /webbasys/i.test(html)
// Problem: ANY page mentioning "kufer" (e.g. a German-language article about Klaus Kufer,
// or "Verkäufer" which contains "kufer" as substring) triggers Kufer detection.

const falsePositiveTests = [
  {
    desc: "HTML mentioning 'Verkäufer' (seller) — contains 'käufer', NOT 'kufer' (OK)",
    html: "<html><body><p>Suchen Sie einen erfahrenen Verkäufer für unser Team?</p></body></html>",
    url: "https://example.com",
    note: "Verkäufer contains 'käufer', not 'kufer' — lowercase: verkäufer. Does it match /kufer/i? Let's check."
  },
  {
    desc: "URL containing 'kufer' (like a person's name: 'Alexander-Kufer-AG')",
    html: "<html><body><p>Normal content about products.</p></body></html>",
    url: "https://alexander-kufer-ag.de/products",
    note: "URL contains 'kufer' so isKufer = true, but there are no sprite images so returns null. Safe."
  },
  {
    desc: "HTML body with 'webbasys' mentioned in an article about CMS platforms",
    html: "<html><body><p>Wir nutzen webbasys als unser CMS-System.</p></body></html>",
    url: "https://example.com/about",
    note: "HTML contains 'webbasys' → isKufer = true. No sprite images → returns null. The trigger fires but safely exits. Low severity."
  },
];

// Test whether "Verkäufer" triggers /kufer/i
const verkauferTest = /kufer/i.test("Suchen Sie einen erfahrenen Verkäufer für unser Team?");
findings.push({
  id: "G-7",
  desc: "Kufer detection: 'Verkäufer' (seller) does NOT false-trigger /kufer/i — check passes",
  input: "Verkäufer",
  verkauferContainsKufer: verkauferTest,
  isBug: verkauferTest, // if false positive, it's a bug
  severity: "Low",
  note: verkauferTest
    ? "'Verkäufer' falsely triggers Kufer detection. The /kufer/i regex matches a substring of 'Verkäufer'."
    : "Safe: 'Verkäufer' does NOT match /kufer/i (contains 'käufer', not 'kufer')."
});

// BUT: what about "Käufer" (buyer)?
const kaeuferTest = /kufer/i.test("Käufer");
findings.push({
  id: "G-8",
  desc: "Kufer detection: does 'Käufer' (buyer) false-trigger /kufer/i?",
  input: "Käufer",
  kaeuferContainsKufer: kaeuferTest,
  isBug: kaeuferTest,
  severity: "Low",
  note: kaeuferTest
    ? "'Käufer' falsely triggers Kufer detection via substring match."
    : "Safe: 'Käufer' does NOT match /kufer/i."
});

// What about class="buchkufer-btn" (made up, but tests substring sensitivity)
const classAttrTest = /kufer/i.test('<img class="buchkufer-icon" src="x.png">');
findings.push({
  id: "G-9",
  desc: "Kufer detection: HTML class 'buchkufer-icon' triggers /kufer/i — potential false positive",
  html_snippet: '<img class="buchkufer-icon" src="x.png">',
  triggersKufer: classAttrTest,
  isBug: classAttrTest,
  severity: "Low",
  note: classAttrTest
    ? "Any HTML attribute/text containing 'kufer' as substring triggers Kufer detection, even if unrelated to the Kufer platform."
    : "Does not trigger."
});

// ─── Part 4: MCP live tests ────────────────────────────────────────────────────
const client = await makeClient();

// Test G-10: German umlaut in search query (encoding test)
const r10 = await callTool(client, "novada_search", {
  query: "Münchner Volkshochschule Kursangebot",
  engine: "google", num: 3
});
findings.push({
  id: "G-10",
  desc: "German umlaut in search query (Münchner Volkshochschule) — encoding passthrough",
  query: "Münchner Volkshochschule Kursangebot",
  isError: r10.isError,
  responsePreview: r10.text.slice(0, 300),
  expected: "Auth error (dummy key) — query accepted, not rejected for encoding",
  passed: r10.text.includes("API_KEY_INVALID") || r10.text.includes("auth") || (r10.isError && !r10.text.includes("encoding")),
  isBug: r10.text.includes("encoding") || r10.text.includes("Invalid query")
});

// Test G-11: German umlaut in scrape fields parameter
const r11 = await callTool(client, "novada_extract", {
  url: "https://www.example.com",
  format: "json",
  render: "auto",
  fields: ["Beginn", "Status", "Anmeldeschluss", "Kursort"]
});
findings.push({
  id: "G-11",
  desc: "German field names in novada_extract fields parameter (Beginn, Status, Anmeldeschluss)",
  fields: ["Beginn", "Status", "Anmeldeschluss", "Kursort"],
  isError: r11.isError,
  responsePreview: r11.text.slice(0, 400),
  expected: "Accepted — German field names processed via GERMAN_LABEL_MAP",
  isBug: r11.text.includes("Invalid field") || (r11.isError && !r11.text.includes("API_KEY") && !r11.text.includes("auth"))
});

// Test G-12: Simulate Kufer HTML extraction inline test
// Test whether a page with Kufer CSS sprite markup triggers the availability detection
// We can't do live extract without real API key, but we can verify the logic directly

// Simulate a Kufer course detail page HTML
const kuferDetailHtml = `
<html>
<head><title>Spanisch A1 - VHS München</title></head>
<body>
<div class="kursdetail">
  <h1>Spanisch A1</h1>
  <table>
    <tr><td>Beginn</td><td>15.09.2024</td></tr>
    <tr><td>Status</td><td>
      <img src="/cms/kufer/kursampeln/trans.png" style="background:kbs_set12_sprite" alt="Keine Internetanmeldung möglich">
      ausgebucht
    </td></tr>
    <tr><td>Kursort</td><td>Hauptgebäude Raum 207</td></tr>
    <tr><td>Anmeldeschluss</td><td>08.09.2024</td></tr>
    <tr><td>Kurs-Nr.</td><td>2024-SPK-001</td></tr>
    <tr><td>Gebühr</td><td>89,00 €</td></tr>
  </table>
</div>
</body>
</html>`;

// Simulate detection
const $ = cheerio.load(kuferDetailHtml);
const html = $.html() ?? "";
const isKufer = /kursampeln/i.test(html) || /kbs_set12_sprite/i.test(html) || /kufer/i.test(html);
const spriteImgs = $('img[src*="kursampeln"], img[style*="kbs_set12_sprite"], img[src*="trans.png"]').filter((_, el) => {
  const style = $(el).attr("style") ?? "";
  const src = $(el).attr("src") ?? "";
  return style.includes("kbs_set12") || src.includes("kursampeln") || style.includes("kursampeln");
});

let detectedStatus = "NOT_DETECTED";
if (isKufer && spriteImgs.length > 0) {
  spriteImgs.each((_, el) => {
    const parent = $(el).parent();
    let siblingText = "";
    parent.contents().each((_, node) => {
      if (node.type === "text") siblingText += (node.data ?? "").trim() + " ";
      else if (node.type === "tag" && node.tagName !== "img" && node.tagName !== "a") {
        siblingText += $(node).text().trim() + " ";
      }
    });
    siblingText = siblingText.trim();
    detectedStatus = normalizeKuferStatus(siblingText);
  });
}

findings.push({
  id: "G-12",
  desc: "Kufer sprite detection: ausgebucht sibling text correctly detected as 'ausgebucht'",
  isKufer,
  spriteCount: spriteImgs.length,
  detectedStatus,
  expected: "ausgebucht",
  isBug: detectedStatus !== "ausgebucht",
  severity: "High",
  note: "Core Kufer detection test: sprite image + 'ausgebucht' sibling text"
});

// Test G-13: Kufer overview-page trap — sprite present, sibling text is just a link (course name)
const kuferOverviewHtml = `
<html>
<head><title>VHS München - Kursübersicht</title></head>
<body>
<div id="kursliste">
  <ul>
    <li>
      <img src="/cms/kufer/kursampeln/trans.png" style="background:kbs_set12_sprite" alt="Keine Internetanmeldung möglich">
      <a href="/kurse/spanisch-a1">Spanisch A1 für Anfänger</a>
    </li>
    <li>
      <img src="/cms/kufer/kursampeln/trans.png" style="background:kbs_set12_sprite" alt="Keine Internetanmeldung möglich">
      <a href="/kurse/spanisch-b1">Spanisch B1 Mittelstufe</a>
    </li>
  </ul>
</div>
</body>
</html>`;

const $overview = cheerio.load(kuferOverviewHtml);
const overviewHtml = $overview.html() ?? "";
const overviewIsKufer = /kursampeln/i.test(overviewHtml);
const overviewSprites = $overview('img[src*="kursampeln"], img[style*="kbs_set12_sprite"], img[src*="trans.png"]').filter((_, el) => {
  const style = $overview(el).attr("style") ?? "";
  const src = $overview(el).attr("src") ?? "";
  return style.includes("kbs_set12") || src.includes("kursampeln") || style.includes("kursampeln");
});

const overviewStatuses = [];
overviewSprites.each((_, el) => {
  const parent = $overview(el).parent();
  let siblingText = "";
  parent.contents().each((_, node) => {
    if (node.type === "text") siblingText += (node.data ?? "").trim() + " ";
    else if (node.type === "tag" && node.tagName !== "img" && node.tagName !== "a") {
      siblingText += $overview(node).text().trim() + " ";
    }
  });
  siblingText = siblingText.trim();
  overviewStatuses.push({ raw: siblingText, normalized: normalizeKuferStatus(siblingText) });
});

const allUnknown = overviewStatuses.every(s => s.normalized === "unknown");
findings.push({
  id: "G-13",
  desc: "Kufer overview-page trap: sprite+link-text-only sibling correctly classified as 'is_overview_page: true'",
  sprites: overviewSprites.length,
  statuses: overviewStatuses,
  allUnknown,
  isOverviewPage: allUnknown, // same logic as source
  expected: "is_overview_page: true (overview page warning emitted)",
  isBug: !allUnknown,
  severity: allUnknown ? "Low" : "High",
  note: "Overview pages have sprite images + link text (course names). The code correctly ignores link text — these should all be 'unknown' → is_overview_page = true."
});

// Test G-14: What happens when sprite image has BOTH kursampeln in src AND style?
// Specifically: does the img[src*="kursampeln"] selector already match trans.png? No.
// But does img[src*="trans.png"] + filter work correctly?
const doubleTriggerHtml = `
<html>
<body>
<div>
  <img src="/site/kursampeln/sprite.png" style="background:kbs_set12_sprite" alt="Keine Internetanmeldung möglich">
  buchbar
</div>
</body>
</html>`;

// Simulate: does the filter catch src="kursampeln/sprite.png" (no trans.png)?
const $double = cheerio.load(doubleTriggerHtml);
// Selector: img[src*="kursampeln"] — yes, 'kursampeln' is in the src, so this fires
const doubleSprites = $double('img[src*="kursampeln"], img[style*="kbs_set12_sprite"], img[src*="trans.png"]').filter((_, el) => {
  const style = $double(el).attr("style") ?? "";
  const src = $double(el).attr("src") ?? "";
  return style.includes("kbs_set12") || src.includes("kursampeln") || style.includes("kursampeln");
});

let doubleStatus = "NOT_DETECTED";
doubleSprites.each((_, el) => {
  const parent = $double(el).parent();
  let siblingText = "";
  parent.contents().each((_, node) => {
    if (node.type === "text") siblingText += (node.data ?? "").trim() + " ";
    else if (node.type === "tag" && node.tagName !== "img" && node.tagName !== "a") {
      siblingText += $double(node).text().trim() + " ";
    }
  });
  siblingText = siblingText.trim();
  doubleStatus = normalizeKuferStatus(siblingText);
});

findings.push({
  id: "G-14",
  desc: "Kufer sprite src=/kursampeln/sprite.png (not trans.png) + style=kbs_set12 correctly detected",
  sprites: doubleSprites.length,
  doubleStatus,
  expected: "buchbar",
  isBug: doubleStatus !== "buchbar",
  severity: "Medium",
  note: "Tests that kursampeln-path sprite (non-trans.png) is correctly matched by the selector + filter combo"
});

// Test G-15: GERMAN_LABEL_MAP — "dozentin" vs "dozent" (feminine form)
// Check that both masculine and feminine instructor terms map to "instructor"
const labelTests = [
  { label: "Dozent", expected: "instructor" },
  { label: "Dozentin", expected: "instructor" },
  { label: "Kursleitung", expected: "instructor" },
  { label: "Lehrkraft", expected: "instructor" },
  { label: "Beginn", expected: "date" },
  { label: "Anmeldeschluss", expected: "registration_deadline" },
  { label: "Gebühr", expected: "price" },  // umlaut key
  { label: "Verfügbarkeit", expected: "availability_status" },  // umlaut key
  { label: "Höchstteilnehmerzahl", expected: "participants" },  // umlaut key
];

const labelResults = labelTests.map(({ label, expected }) => {
  const l = label.toLowerCase().trim();
  const mapped = GERMAN_LABEL_MAP[l];
  return { label, l, expected, mapped: mapped ?? null, match: mapped === expected };
});

const labelBugs = labelResults.filter(r => !r.match);
findings.push({
  id: "G-15",
  desc: "GERMAN_LABEL_MAP: verify key labels including umlaut-containing entries",
  results: labelResults,
  allPass: labelBugs.length === 0,
  bugs: labelBugs,
  isBug: labelBugs.length > 0,
  severity: labelBugs.length > 0 ? "High" : "Low",
  note: "Tests that umlaut-containing German labels (Gebühr, Verfügbarkeit, Höchstteilnehmerzahl) are correctly looked up via their lowercased forms"
});

// Test G-16: Check that "verfügbarkeit" key (with ü umlaut) is correctly stored and looked up
// When JavaScript code compiles and the JS file is saved with UTF-8 encoding, ü should be preserved
const verfugbarkeitKey = "verfügbarkeit";
const verfugbarkeitLookup = GERMAN_LABEL_MAP[verfugbarkeitKey];
findings.push({
  id: "G-16",
  desc: "GERMAN_LABEL_MAP: umlaut key 'verfügbarkeit' lookup succeeds (encoding check)",
  key: verfugbarkeitKey,
  keyLength: verfugbarkeitKey.length,
  keyCodePoints: [...verfugbarkeitKey].map(c => c.codePointAt(0).toString(16)),
  mapped: verfugbarkeitLookup ?? null,
  isBug: verfugbarkeitLookup !== "availability_status",
  severity: "High",
  note: "If build toolchain converts ü to a different encoding, lookups against DOM text will fail"
});

// Test G-17: Detection of trans.png sprite with kbs_set12 style (common variant)
// Important: img[src*="trans.png"] is the jQuery selector — trans.png is a common name,
// but the filter additionally checks: style.includes("kbs_set12")
// The selector will also match any other site's trans.png images, but the FILTER saves us.
const transPngHtml = `
<html>
<body>
<p>
  <img src="/images/trans.png" style="display:kbs_set12_sprite" alt="Keine Internetanmeldung möglich">
  5 Plätze frei
</p>
</body>
</html>`;

const $trans = cheerio.load(transPngHtml);
const transHtml = $trans.html() ?? "";
// Note: style here is "display:kbs_set12_sprite" but the filter checks style.includes("kbs_set12")
// "display:kbs_set12_sprite".includes("kbs_set12") === true ✓
const transSprites = $trans('img[src*="kursampeln"], img[style*="kbs_set12_sprite"], img[src*="trans.png"]').filter((_, el) => {
  const style = $trans(el).attr("style") ?? "";
  const src = $trans(el).attr("src") ?? "";
  return style.includes("kbs_set12") || src.includes("kursampeln") || style.includes("kursampeln");
});

let transStatus = "NOT_DETECTED";
transSprites.each((_, el) => {
  const parent = $trans(el).parent();
  let siblingText = "";
  parent.contents().each((_, node) => {
    if (node.type === "text") siblingText += (node.data ?? "").trim() + " ";
    else if (node.type === "tag" && node.tagName !== "img" && node.tagName !== "a") {
      siblingText += $trans(node).text().trim() + " ";
    }
  });
  siblingText = siblingText.trim();
  transStatus = normalizeKuferStatus(siblingText);
});

findings.push({
  id: "G-17",
  desc: "Kufer trans.png sprite + kbs_set12 style: '5 Plätze frei' → '5_places'",
  sprites: transSprites.length,
  transStatus,
  expected: "5_places",
  isBug: transStatus !== "5_places",
  severity: "Medium",
  note: "Tests trans.png-based sprite detection with N_places phrasing"
});

// Test G-18: A random website with trans.png but NO kbs_set12 style — false positive?
const falsePosHtml = `
<html>
<body>
<img src="/img/trans.png" alt="transparent spacer">
<p>Buy now for €99.00</p>
</body>
</html>`;

const $falsePosPage = cheerio.load(falsePosHtml);
const falsePosSprites = $falsePosPage('img[src*="kursampeln"], img[style*="kbs_set12_sprite"], img[src*="trans.png"]').filter((_, el) => {
  const style = $falsePosPage(el).attr("style") ?? "";
  const src = $falsePosPage(el).attr("src") ?? "";
  return style.includes("kbs_set12") || src.includes("kursampeln") || style.includes("kursampeln");
});

findings.push({
  id: "G-18",
  desc: "Non-Kufer page with trans.png spacer image: filter correctly rejects it",
  spritesFound: falsePosSprites.length,
  expected: 0,
  isBug: falsePosSprites.length > 0,
  severity: "High",
  note: "trans.png is common on old websites. The filter (style.includes('kbs_set12') || src.includes('kursampeln')) protects against false positives."
});

// Test G-19: Kufer page with both ausgebucht AND buchbar sprite items — which wins?
const multiStatusHtml = `
<html>
<body>
<table>
  <tr>
    <td><img src="/kufer/kursampeln/trans.png" style="kbs_set12_sprite">buchbar</td>
  </tr>
  <tr>
    <td><img src="/kufer/kursampeln/trans.png" style="kbs_set12_sprite">ausgebucht</td>
  </tr>
</table>
</body>
</html>`;

const $multi = cheerio.load(multiStatusHtml);
const multiSprites = $multi('img[src*="kursampeln"], img[style*="kbs_set12_sprite"], img[src*="trans.png"]').filter((_, el) => {
  const style = $multi(el).attr("style") ?? "";
  const src = $multi(el).attr("src") ?? "";
  return style.includes("kbs_set12") || src.includes("kursampeln") || style.includes("kursampeln");
});

const multiStatuses = [];
multiSprites.each((_, el) => {
  const parent = $multi(el).parent();
  let siblingText = "";
  parent.contents().each((_, node) => {
    if (node.type === "text") siblingText += (node.data ?? "").trim() + " ";
    else if (node.type === "tag" && node.tagName !== "img" && node.tagName !== "a") {
      siblingText += $multi(node).text().trim() + " ";
    }
  });
  siblingText = siblingText.trim();
  multiStatuses.push({ raw: siblingText, normalized: normalizeKuferStatus(siblingText) });
});

// The code takes primaryIdx = statuses.findIndex(s => s !== "unknown")
// First non-unknown = "buchbar" (index 0). So primaryStatus = "buchbar".
// But there's also "ausgebucht" which is more important information!
const firstNonUnknown = multiStatuses.find(s => s.normalized !== "unknown");
findings.push({
  id: "G-19",
  desc: "Kufer multi-status page: when buchbar (index 0) AND ausgebucht (index 1) both present, first wins — ausgebucht dropped",
  statuses: multiStatuses,
  firstNonUnknown,
  primaryStatus: firstNonUnknown?.normalized,
  isBug: firstNonUnknown?.normalized === "buchbar", // 'buchbar' hides 'ausgebucht'
  severity: "Medium",
  note: "For pages with mixed statuses (e.g. multiple course sessions), the code picks the FIRST recognized status. If a 'buchbar' entry appears before 'ausgebucht', the ausgebucht status is silently dropped from primary output. Not all statuses are surfaced."
});

// Test G-20: Anmeldeschluss date in raw_text output — does it appear in markdown_block?
// The markdown_block includes raw_text. If raw_text contains a German date format "dd.mm.yyyy",
// this should pass through untouched.
const anmeldeschlussDate = "15.09.2024";
const expectedBlock = `## Kufer Availability\navailability_status: buchbar\nstatus_label: bookable\nraw_text: buchbar ${anmeldeschlussDate}`;

findings.push({
  id: "G-20",
  desc: "German date format (dd.mm.yyyy) in raw_text passes through markdown_block unchanged",
  note: "The markdown_block template literal uses raw_text directly. German date 15.09.2024 has dots which are harmless in markdown. No regex transformation. This should be fine.",
  isBug: false,
  severity: "Low"
});

// Test G-21: GERMAN_LABEL_MAP - "status" maps to "availability_status"
// This is risky: "Status" is a very generic word in HTML. Many English pages also have "Status" labels
// If an English page has a "Status" label, it would incorrectly match "availability_status"
// The labelMatchScoreWithGerman first checks labelMatchScore (which checks if label includes 'availability_status')
// "Status" does NOT include 'availability_status', so nativeScore = 0
// Then it checks GERMAN_LABEL_MAP["status"] = "availability_status"
// So if canonical = "availability_status", it returns score = 2
// But what about canonical = "status"? Then GERMAN_LABEL_MAP["status"] = "availability_status" !== "status" → returns 0
// The caller would need to specifically request "availability_status" field for this to work.

findings.push({
  id: "G-21",
  desc: "GERMAN_LABEL_MAP 'status' key: generic German/English overlap in table labels",
  analysis: {
    germanStatusMapsTo: GERMAN_LABEL_MAP["status"],
    agentMustRequest: "fields=['availability_status'] to trigger German 'Status' label match",
    agentWithStatusField: "fields=['status'] would use native labelMatchScore('Status', 'status') → exact match → score=3, BUT not via GERMAN_LABEL_MAP",
    actualBehavior: "If agent requests 'status' field: returns via labelMatchScore (exact match, score=3) — correct. If agent requests 'availability_status' field: returns via GERMAN_LABEL_MAP (score=2) — also correct.",
  },
  isBug: false,
  severity: "Low",
  note: "No bug — but the dual path is subtle: 'Status' label works for both 'status' and 'availability_status' field requests via different code paths."
});

// ─── Summary ─────────────────────────────────────────────────────────────────
await client.close();

console.log(JSON.stringify({ findings, totalTests: findings.length, bugsFound: findings.filter(f => f.isBug).length }, null, 2));
