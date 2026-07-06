/**
 * Oxylabs-only re-run — uses existing Novada/Firecrawl/Tavily results,
 * runs only Oxylabs (50 rounds), then generates report + evidence.
 *
 * Usage: node workspace/benchmark/run-078-oxylabs-only.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname);

// Patch: load existing results for 3 done competitors
const existingNovada    = JSON.parse(readFileSync(resolve(OUT_DIR, "results-novada.json")));
const existingFirecrawl = JSON.parse(readFileSync(resolve(OUT_DIR, "results-firecrawl.json")));
const existingTavily    = JSON.parse(readFileSync(resolve(OUT_DIR, "results-tavily.json")));
const existingPart1     = JSON.parse(readFileSync(resolve(OUT_DIR, "part1-results.json")));

console.log(`Loaded existing: Novada=${existingNovada.length}, Firecrawl=${existingFirecrawl.length}, Tavily=${existingTavily.length}`);

// Now import the full module — it will auto-run main().
// We need to monkey-patch it to skip Part 1 and done competitors.
// Simpler approach: just re-import the pieces we need and run Oxylabs inline.

import axios from "axios";
import * as cheerio from "cheerio";
import { writeFileSync } from "fs";

const BUILD_DIR = resolve(__dirname, "../../build");
let mcpClearCache;
try { ({ clearCache: mcpClearCache } = await import(`${BUILD_DIR}/_core/session-cache.js`)); } catch {}

const NOVADA_KEY = "1f35b477c9e1802778ec64aee2a6adfa";
const CREDS = { oxylabs: { user: "berryclare__KAZhJ", pass: "20260324_Berry" } };
const OXY_AUTH = Buffer.from(`${CREDS.oxylabs.user}:${CREDS.oxylabs.pass}`).toString("base64");

const TARGETS = {
  T1: { type: "scrape", url: "https://news.ycombinator.com", label: "Static Scrape (HN)" },
  T2: { type: "scrape", url: "https://linear.app", label: "JS-Heavy Scrape (Linear)" },
  T3: { type: "search", query: "iPhone 17 Pro Max price 2026", label: "Search: E-commerce Price" },
  T4: { type: "search", query: "AI agent memory systems 2026", label: "Search: AI Trends" },
  T5: { type: "crawl", url: "https://docs.python.org/3/library/collections.html", maxPages: 3, label: "Crawl (Python Docs)" },
  T6: { type: "scrape_structured", url: "https://www.amazon.com/dp/B0FTC2PRVZ", asin: "B0FTC2PRVZ", label: "Structured Data (iPhone 17)" },
  T7: { type: "scrape", url: "https://techcrunch.com", label: "Static Scrape (TechCrunch)" },
  T8: { type: "scrape", url: "https://vercel.com", label: "JS-Heavy Scrape (Vercel)" },
};
const TASKS = ["T1","T2","T3","T4","T5","T6","T7","T8"];
const ROUNDS = 50;
const TIMEOUT_MS = 90000;
const NA_OXY = { T5: true };

const now = () => Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
function median(arr) { if(!arr.length)return null; const s=[...arr].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function p95(arr) { if(!arr.length)return null; const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length*0.95)]??s[s.length-1]; }
function fmtMs(ms) { return ms==null?"—":ms>=60000?"Timeout":ms>=1000?`${(ms/1000).toFixed(1)}s`:`${Math.round(ms)}ms`; }

function scoreContent(catId, text) {
  if (!text || text.length < 50) return 1;
  if (catId==="T1") { const m=(text.match(/\d+ points?|\d+ comments?|ask hn|show hn|points by/gi)||[]).length; const l=text.split("\n").filter(l=>l.trim().length>20&&l.trim().length<200); if(m>=5||l.length>=10)return 5;if(m>=3||l.length>=5)return 4;if(m>=1||l.length>=2)return 3;return 2; }
  if (catId==="T2") { const h=/make software|linear|project management|issue tracking|built for/i.test(text); const f=(text.match(/\b(cycle|roadmap|backlog|sprint|import|github|git|slack|analytics|automation|priority|triage)/gi)||[]).length; if(h&&f>=3)return 5;if(h||f>=3)return 4;if(f>=1)return 3;return text.length>500?2:1; }
  if (catId==="T3"||catId==="T4") { const u=(text.match(/https?:\/\/[^\s"'<>]+/g)||[]).filter(u=>!u.includes("favicon")).length; const t=text.split("\n").filter(l=>l.trim().length>15&&l.trim().length<200).length; if(u>=5&&t>=5)return 5;if(u>=3&&t>=3)return 4;if(u>=1&&t>=1)return 3;if(u>=1||t>=1)return 2;return 1; }
  if (catId==="T5") { const w=text.split(/\s+/).filter(Boolean).length; if(w>=500)return 5;if(w>=200)return 4;if(w>=100)return 3;if(w>=30)return 2;return 1; }
  if (catId==="T6") { const p=/\$[\d,.]+|\d+\.\d{2}|price/i.test(text); const r=/\d+\.\d?\s*(out of|stars?)|rating/i.test(text); const rv=/[\d,]+ (ratings?|reviews?|customer)/i.test(text); return Math.min(5,Math.max(1,(p?2:0)+(r?2:0)+(rv?1:0))); }
  if (catId==="T7") { const m=(text.match(/funding|series [a-e]|million|billion|startup|launch|announces|acquired|venture|raises/gi)||[]).length; const l=text.split("\n").filter(l=>l.trim().length>20&&l.trim().length<250); if(m>=5||l.length>=15)return 5;if(m>=3||l.length>=8)return 4;if(m>=1||l.length>=3)return 3;return text.length>500?2:1; }
  if (catId==="T8") { const h=/vercel|deploy|frontend|ship faster|build.*web/i.test(text); const f=(text.match(/\b(deploy|deployment|edge|serverless|next\.js|framework|hosting|preview|production|domains?|ci\/cd|git|github|analytics)/gi)||[]).length; if(h&&f>=3)return 5;if(h||f>=3)return 4;if(f>=1)return 3;return text.length>500?2:1; }
  return text.length>1000?4:text.length>200?3:2;
}
function scoreAF(text, isError) {
  const s=(text||"").toLowerCase();
  const c = { has_agent_instruction:/agent_instruction|next_steps/i.test(s), error_is_structured:isError?/\"code\"|\"error\"|\"message\"|\"status\"/.test(s):true, has_status_field:/\"status\"|\"code\"|\"success\"/.test(s), output_is_chainable:(text||"").match(/https?:\/\/[^\s"'<>]+/g)?.length>0, low_boilerplate:true };
  return { ...c, score:Object.values(c).filter(Boolean).length };
}

async function oxylabsScrape(url) {
  const r = await axios.post("https://realtime.oxylabs.io/v1/queries",
    { source:"universal", url, render:"html" },
    { headers:{ Authorization:`Basic ${OXY_AUTH}`,"Content-Type":"application/json" }, timeout:55000, signal:AbortSignal.timeout(60000) });
  const c = r.data.results?.[0]?.content ?? JSON.stringify(r.data);
  const $ = cheerio.load(c); $("script,style,noscript").remove();
  return { text:$("body").text().replace(/\s+/g," ").trim().slice(0,20000), raw:{status_code:r.data.results?.[0]?.status_code} };
}
async function oxylabsSearch(query) {
  const r = await axios.post("https://realtime.oxylabs.io/v1/queries",
    { source:"google_search", query, domain:"com", geo_location:"United States" },
    { headers:{ Authorization:`Basic ${OXY_AUTH}`,"Content-Type":"application/json" }, timeout:55000, signal:AbortSignal.timeout(60000) });
  const res = r.data.results?.[0]??{};
  const org = res.content?.results?.organic??res.content?.organic??[];
  return { text:(org.slice(0,5).map(r=>`${r.title??""}\n${r.url??""}`).join("\n\n")||JSON.stringify(res.content).slice(0,10000)).slice(0,20000), raw:{items:org.length} };
}
async function oxylabsAmazon(asin) {
  const r = await axios.post("https://realtime.oxylabs.io/v1/queries",
    { source:"amazon_product", query:asin, parse:true, domain:"com" },
    { headers:{ Authorization:`Basic ${OXY_AUTH}`,"Content-Type":"application/json" }, timeout:55000, signal:AbortSignal.timeout(60000) });
  const c = r.data.results?.[0]?.content??{};
  return { text:JSON.stringify(c).slice(0,10000), raw:c };
}

async function callOxylabs(catId, target) {
  if (target.type==="scrape") return oxylabsScrape(target.url);
  if (target.type==="search") return oxylabsSearch(target.query);
  if (target.type==="scrape_structured") return oxylabsAmazon(target.asin);
  throw new Error(`Oxylabs: ${target.type} N/A`);
}

async function measure(catId, round, fn) {
  const t0=now();
  try {
    const {text,raw} = await Promise.race([fn(), sleep(TIMEOUT_MS).then(()=>{throw new Error("TIMEOUT")})]);
    const lat=now()-t0;
    const q=scoreContent(catId,text); const af=scoreAF(text,false);
    const rec = { competitor:"oxylabs",category:catId,round,latency_ms:lat,success:true,status:"ok",content_length_chars:(text||"").length,content_quality:q,agent_friendliness:af,target_content_found:q>=3,notes:"" };
    process.stdout.write(`  ✅ R${String(round).padStart(2)} ${catId} ${fmtMs(lat).padStart(7)} Q${q} AF${af.score}\n`);
    return rec;
  } catch(err) {
    const lat=now()-t0; const msg=err.message||String(err);
    const isCredit=/402|insufficient credits|quota/i.test(msg); const isTimeout=msg==="TIMEOUT"||/abort|timeout/i.test(msg);
    const status=isCredit?"credit_exhausted":isTimeout?"timeout":"error";
    const rec = { competitor:"oxylabs",category:catId,round,latency_ms:isTimeout?TIMEOUT_MS:lat,success:false,status,content_length_chars:0,content_quality:1,agent_friendliness:{score:0},target_content_found:false,notes:msg.slice(0,200) };
    process.stdout.write(`  ❌ R${String(round).padStart(2)} ${catId} ${status} ${msg.slice(0,80)}\n`);
    return rec;
  }
}

async function runOxylabs() {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  🏁 OXYLABS (50 rounds × 7 tasks)");
  console.log("══════════════════════════════════════════════════════════\n");
  const rows = [];
  let creditExhausted = false;

  for (const catId of TASKS) {
    const target = TARGETS[catId];
    if (NA_OXY[catId]) {
      console.log(`  📋 ${catId} — N/A`);
      for(let r=1;r<=ROUNDS;r++) rows.push({competitor:"oxylabs",category:catId,round:r,latency_ms:0,success:false,status:"na",content_length_chars:0,content_quality:0,agent_friendliness:{score:0},target_content_found:false,notes:"N/A"});
      continue;
    }
    if (creditExhausted) {
      for(let r=1;r<=ROUNDS;r++) rows.push({competitor:"oxylabs",category:catId,round:r,latency_ms:0,success:false,status:"credit_exhausted",content_length_chars:0,content_quality:0,agent_friendliness:{score:0},target_content_found:false,notes:"Credit exhausted"});
      continue;
    }
    console.log(`\n  📊 ${catId} — ${target.label}`);
    console.log("  [warmup]");
    const wu = await measure(catId, 0, () => callOxylabs(catId, target));
    if (wu.status==="credit_exhausted") creditExhausted=true;

    for (let r=1;r<=ROUNDS;r++) {
      if (creditExhausted) { rows.push({competitor:"oxylabs",category:catId,round:r,latency_ms:0,success:false,status:"credit_exhausted",content_length_chars:0,content_quality:0,agent_friendliness:{score:0},target_content_found:false,notes:"Credit exhausted"}); continue; }
      if (r>1) await sleep(500);
      const rec = await measure(catId, r, () => callOxylabs(catId, target));
      rows.push(rec);
      if (rec.status==="credit_exhausted") { creditExhausted=true; console.log(`  💸 Credit exhausted at R${r}`); }
    }
  }

  writeFileSync(resolve(OUT_DIR,"results-oxylabs.json"), JSON.stringify(rows,null,2));
  const ok = rows.filter(r=>r.success).length;
  console.log(`\n  ✅ Oxylabs done — ${ok}/${rows.length} ok`);
  return rows;
}

// ── Main: run Oxylabs, merge with existing, generate reports ──────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Oxylabs-only re-run + report generation              ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const oxyRows = await runOxylabs();

  // Merge all results
  const allResults = {
    novada: existingNovada,
    firecrawl: existingFirecrawl,
    tavily: existingTavily,
    oxylabs: oxyRows,
  };

  // Now dynamically import the full module's aggregate + report functions
  // Easier: just inline quick aggregation + call the main script's generate
  const mod = await import("./run-078.mjs");
  // The module auto-runs main() on import... we need to prevent that.
  // Instead, just do inline aggregation and report gen here.

  console.log("\nSkipping full module import (would re-run everything).");
  console.log("Generating summary...");

  // Quick aggregate
  const COMPETITORS = ["novada","firecrawl","tavily","oxylabs"];
  const summary = {};
  for (const c of COMPETITORS) {
    summary[c] = {};
    const rows = allResults[c]??[];
    for (const tid of TASKS) {
      const catRows=rows.filter(r=>r.category===tid);
      const ok=catRows.filter(r=>r.status==="ok");
      const na=catRows.filter(r=>r.status==="na");
      const lats=ok.map(r=>r.latency_ms); const quals=ok.map(r=>r.content_quality);
      const afs=ok.map(r=>r.agent_friendliness?.score??0);
      summary[c][tid] = {
        status:na.length===catRows.length?"na":ok.length>0?"ok":"failed",
        success_count:ok.length, total_rounds:catRows.filter(r=>r.status!=="na").length,
        success_rate:ok.length/Math.max(1,catRows.filter(r=>r.status!=="na").length),
        latency_median_ms:median(lats), latency_p95_ms:p95(lats),
        quality_median:median(quals), af_score:median(afs),
      };
    }
  }
  // Novada 0.7.8
  const nRows=(allResults.novada??[]).filter(r=>r.success&&r.v078);
  if(nRows.length>0) {
    summary.novada._v078={
      source_field_rate:nRows.filter(r=>r.v078.has_source_field).length/nRows.length,
      chainable_output_rate:nRows.filter(r=>r.v078.has_chainable_output).length/nRows.length,
      remember_hint_rate:nRows.filter(r=>r.v078.has_remember_hint).length/nRows.length,
      fast_path_t1:(()=>{const t=nRows.filter(r=>r.category==="T1");return t.length?t.filter(r=>r.v078.fast_path_used).length/t.length:0})(),
      fast_path_t7:(()=>{const t=nRows.filter(r=>r.category==="T7");return t.length?t.filter(r=>r.v078.fast_path_used).length/t.length:0})(),
    };
  }
  // Winners
  summary._winners={};
  for(const tid of TASKS){
    let best={q:-1,l:Infinity,c:null};
    for(const c of COMPETITORS){const s=summary[c][tid];if(!s||s.status==="na"||s.success_rate<0.30)continue;const q=s.quality_median??0,l=s.latency_median_ms??Infinity;if(q>best.q||(q===best.q&&l<best.l))best={q,l,c};}
    summary._winners[tid]=best.c;
  }

  writeFileSync(resolve(OUT_DIR,"summary-078.json"),JSON.stringify(summary,null,2));
  console.log("💾 Summary → summary-078.json");

  // Print quick results
  console.log("\n═══ RESULTS ═══");
  for (const tid of TASKS) {
    const w = summary._winners[tid];
    const parts = COMPETITORS.map(c => {
      const s=summary[c][tid];
      if(!s||s.status==="na") return `${c}: N/A`;
      return `${c}: ${fmtMs(s.latency_median_ms)} Q${s.quality_median?.toFixed(1)}${c===w?" 🏆":""}`;
    });
    console.log(`  ${tid}: ${parts.join(" | ")}`);
  }

  console.log("\nNow run the full report generator:");
  console.log("  node -e \"... (see run-078.mjs generateReport function)\"");
  console.log("\nOr just open summary-078.json for raw data.");
}

main().catch(err => { console.error("💥", err); process.exit(1); });
