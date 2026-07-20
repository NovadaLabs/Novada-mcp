#!/usr/bin/env node
// gen-update-log.mjs — regenerate docs/update-log.html FROM CHANGELOG.md.
//
//   CHANGELOG.md is the single written source of truth.
//   docs/update-log.html is DERIVED — never hand-edit it (edits get overwritten).
//   To record a release/update: edit CHANGELOG.md, then run this (the promote
//   script runs it automatically at release). Team progress + health lives in
//   Linear project updates, not here.
//
// No dependencies. Node >= 18.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "CHANGELOG.md");
const OUT = join(ROOT, "docs", "update-log.html");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// inline markdown: `code`, **bold**, [text](url) — escape first, then re-inject safe tags
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, b) => `<b>${b}</b>`);
  t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_, txt, url) => `<a href="${url}">${txt}</a>`);
  return t;
}

// ---- parse CHANGELOG.md into release blocks ----
const lines = readFileSync(SRC, "utf8").split("\n");
const releases = [];
let cur = null, sub = null;
for (const raw of lines) {
  const line = raw.replace(/\s+$/, "");
  const rel = line.match(/^##\s+\[([^\]]+)\]\s*(?:[—-]\s*(.+))?$/); // ## [x.y.z] — date  OR  ## [Unreleased]
  if (rel) {
    cur = { version: rel[1].trim(), date: (rel[2] || "").trim(), intro: [], sections: [] };
    releases.push(cur); sub = null; continue;
  }
  if (!cur) continue; // skip title/intro before first release
  const secm = line.match(/^###\s+(.+)$/);
  if (secm) { sub = { title: secm[1].trim(), items: [] }; cur.sections.push(sub); continue; }
  const item = line.match(/^[-*]\s+(.+)$/);
  if (item) { (sub ? sub.items : (sub = { title: "", items: [] }, cur.sections.push(sub), sub.items)).push(item[1]); continue; }
  if (line && !line.startsWith("#") && line !== "---") { if (!sub) cur.intro.push(line); }
}

// ---- render ----
const unreleased = (v) => /unreleased|next|testing/i.test(v);
// First word of a subsection heading, lowercased/slugged — used only to pick a CSS
// hook (sec-testing, sec-notes, ...) so "Testing"/"Notes" can get a distinct labeled
// block without the parser or renderer needing to know about specific headings.
// Stays stable across headings with parenthetical suffixes, e.g. "Known issues
// (backend — reported to Novada)" -> "known".
const secSlug = (title) => (title.trim().split(/\s+/)[0] || "").toLowerCase().replace(/[^a-z0-9]/g, "") || "section";
const cards = releases.map((r) => {
  const pre = unreleased(r.version);
  const chip = pre
    ? `<span class="chip pre">${esc(r.version)}</span>`
    : `<span class="chip">v${esc(r.version.replace(/^v/, ""))}</span>`;
  const dateHtml = r.date ? `<span class="date">${esc(r.date)}</span>` : `<span class="date">—</span>`;
  const introHtml = r.intro.length ? `<p class="intro">${inline(r.intro.join(" "))}</p>` : "";
  // Any "### Heading" subsection renders generically (not just Added/Changed/Fixed) —
  // Testing/Notes/Known issues/etc. all get an <h4> + <ul>. Each is wrapped in a
  // `.sec.sec-<slug>` div so specific headings (sec-testing, sec-notes) can be styled
  // as a distinct labeled block via CSS alone, without special-casing the parser.
  const secs = r.sections.map((s) => {
    const items = s.items.map((it) => `<li>${inline(it)}</li>`).join("\n        ");
    const h = s.title ? `<h4>${esc(s.title)}</h4>` : "";
    const cls = s.title ? ` sec-${secSlug(s.title)}` : "";
    return `      <div class="sec${cls}">\n      ${h}\n      <ul>\n        ${items}\n      </ul>\n      </div>`;
  }).join("\n");
  return `  <details class="card${pre ? " pre" : ""}"${pre ? " open" : ""}>
    <summary>
      ${dateHtml}
      ${pre ? '<span class="tag">In testing · not released</span>' : ""}
      <span class="ttl">${pre ? "Next release (in testing)" : "v" + esc(r.version.replace(/^v/, ""))}</span>
      ${chip}
    </summary>
    <div class="body">
      ${introHtml}
${secs}
    </div>
  </details>`;
}).join("\n\n");

const latest = releases.find((r) => !unreleased(r.version));
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Novada MCP — Update Log</title>
<!-- ⚠ AUTO-GENERATED from CHANGELOG.md by scripts/gen-update-log.mjs — DO NOT EDIT BY HAND. -->
<style>
  :root{--purple:#5D34F2;--pink:#C21BBA;--ink:#181235;--muted:#6B6690;--muted2:#9691B8;
    --bg:#FBFAFF;--card:#fff;--tint:#F5F1FF;--line:rgba(93,52,242,.14);--line2:rgba(24,18,53,.08);
    --grad:linear-gradient(115deg,#5D34F2,#8C64F9 45%,#C21BBA);--amber:#B8791A;--green:#1E7A4C;
    --shadow:0 1px 2px rgba(24,18,53,.04),0 8px 24px rgba(93,52,242,.06);}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,"PingFang SC",Roboto,Arial,sans-serif;
    background:radial-gradient(1100px 600px at 88% -8%,rgba(93,52,242,.09),transparent 60%),var(--bg);
    color:var(--ink);line-height:1.6;-webkit-font-smoothing:antialiased}
  .gline{height:4px;background:var(--grad)}
  .wrap{max-width:900px;margin:0 auto;padding:0 22px 70px}
  a{color:var(--purple);text-decoration:none} a:hover{text-decoration:underline}
  code{font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:.85em;background:var(--tint);
    padding:.1em .4em;border-radius:5px;color:#5A38C7;border:1px solid var(--line)}
  header{padding:48px 0 26px}
  .brand{font-weight:800;letter-spacing:.14em;font-size:14px;background:var(--grad);
    -webkit-background-clip:text;background-clip:text;color:transparent}
  h1{font-size:30px;font-weight:820;letter-spacing:-.02em;margin:8px 0 6px}
  .sub{color:var(--muted);font-size:14px}
  .gen{margin-top:10px;font-size:12px;color:var(--muted2)}
  .gen code{font-size:11px}
  details.card{background:var(--card);border:1px solid var(--line);border-radius:14px;
    margin:14px 0;box-shadow:var(--shadow);overflow:hidden}
  details.card.pre{border-color:rgba(140,100,249,.4);background:linear-gradient(180deg,#F6F2FF,#fff)}
  summary{display:flex;align-items:center;gap:12px;padding:16px 20px;cursor:pointer;list-style:none;flex-wrap:wrap}
  summary::-webkit-details-marker{display:none}
  .date{font-size:12px;color:var(--muted2);font-variant-numeric:tabular-nums;min-width:88px}
  .ttl{font-weight:700;font-size:15px;flex:1}
  .tag{font-size:11px;font-weight:700;padding:2px 9px;border-radius:100px;background:rgba(184,121,26,.14);color:#8A5D10}
  .chip{font-size:12px;font-weight:800;padding:3px 11px;border-radius:100px;background:var(--tint);color:var(--purple);border:1px solid var(--line)}
  .chip.pre{background:rgba(140,100,249,.16);color:#7A4DE0}
  .body{padding:2px 22px 20px}
  .intro{color:var(--muted);font-size:14px;margin:6px 0 12px}
  h4{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--pink);margin:14px 0 6px}
  ul{margin:0 0 4px;padding-left:20px} li{font-size:14px;margin:5px 0;color:var(--ink)} li code{color:#5A38C7}
  /* Labeled blocks for specific subsections (Testing/Notes) — everything else (Added/
     Changed/Fixed/Known issues/...) keeps the plain look above; only these two get a
     bordered, tinted box so the "what was verified" / "what was hard" content reads as
     a distinct, extra-specificity block instead of blending into the feature list. */
  .sec-testing{border-left:3px solid rgba(30,122,76,.35);background:rgba(30,122,76,.06);
    border-radius:0 10px 10px 0;padding:1px 16px 10px;margin:16px 0}
  .sec-testing h4{color:var(--green)}
  .sec-notes{border-left:3px solid rgba(184,121,26,.35);background:rgba(184,121,26,.06);
    border-radius:0 10px 10px 0;padding:1px 16px 10px;margin:16px 0}
  .sec-notes h4{color:var(--amber)}
  footer{margin-top:30px;padding-top:18px;border-top:1px solid var(--line2);font-size:12.5px;color:var(--muted2)}
</style>
</head>
<body>
<div class="gline"></div>
<div class="wrap">
  <header>
    <div class="brand">NOVADA · MCP</div>
    <h1>Update Log</h1>
    <div class="sub">Latest released: <b>v${latest ? esc(latest.version.replace(/^v/, "")) : "—"}</b>${latest && latest.date ? " · " + esc(latest.date) : ""} · npm <code>novada-mcp</code></div>
    <div class="gen">⚙ Auto-generated from <code>CHANGELOG.md</code> — do not edit this file by hand. Team progress &amp; health live in the Linear project "MCP — Hosted + Tools + Optimization".</div>
  </header>

${cards}

  <footer>Generated by <code>scripts/gen-update-log.mjs</code> from <code>CHANGELOG.md</code>. Public changelog = this / <code>CHANGELOG.md</code> · Internal health &amp; progress = Linear project updates.</footer>
</div>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`gen-update-log: wrote ${OUT} — ${releases.length} release blocks (latest v${latest ? latest.version : "?"})`);
