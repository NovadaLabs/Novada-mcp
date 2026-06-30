#!/usr/bin/env node
/**
 * Debug: get raw DDG poll result (correct download URL) + bing diagnosis
 */
import axios from "axios";

const API_KEY = "1f35b477c9e1802778ec64aee2a6adfa";
const SCRAPER_API  = "https://scraper.novada.com";
const DOWNLOAD_BASE = "https://api.novada.com/g/api/proxy"; // correct URL from config.js

async function submit(scraperName, scraperId, query, queryParam = "q", extraParams = {}) {
  const form = new URLSearchParams();
  form.append("scraper_name", scraperName);
  form.append("scraper_id", scraperId);
  form.append("scraper_errors", "true");
  form.append("is_auto_push", "false");
  form.append(queryParam, query);
  form.append("num", "5");
  form.append("json", "1");
  form.append("no_cache", "false");
  for (const [k, v] of Object.entries(extraParams)) form.append(k, v);

  const resp = await axios.post(`${SCRAPER_API}/request`, form, {
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 60000,
  });
  return resp.data;
}

async function poll(taskId) {
  const url = `${DOWNLOAD_BASE}/scraper_download?task_id=${encodeURIComponent(taskId)}&file_type=json&apikey=${encodeURIComponent(API_KEY)}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const resp = await axios.get(url, { timeout: 30000 });
    const body = resp.data;
    if (body?.code === 27202) { process.stdout.write("."); continue; }
    return body;
  }
  return null;
}

// === DDG raw result ===
console.log("=== DDG ===");
const ddgSub = await submit("duckduckgo.com", "duckduckgo", "cheapest phones 2025");
const ddgInner = ddgSub?.data;
const ddgTaskId = ddgInner?.task_id ?? ddgInner?.data?.task_id;
console.log("task_id:", ddgTaskId, "| inner keys:", Object.keys(ddgInner ?? {}));
if (ddgTaskId) {
  console.log("Polling...");
  const r = await poll(ddgTaskId);
  console.log("\nRaw type:", Array.isArray(r) ? "array["+r.length+"]" : typeof r);
  const items = Array.isArray(r) ? r : [r];
  const first = items[0];
  if (first) {
    console.log("First item keys:", Object.keys(first));
    // Look for organic/results array
    for (const key of ["organic_results","organic","results","items","web_pages","webPages","hits","links"]) {
      if (first[key]) {
        console.log(`Found ${key}[${first[key].length}]`);
        const item0 = first[key][0];
        if (item0) {
          console.log("Result[0] keys:", Object.keys(item0));
          console.log("Result[0]:", JSON.stringify(item0).slice(0, 500));
        }
        break;
      }
    }
    if (!first.organic_results && !first.organic && !first.results) {
      console.log("No standard organic key. Raw first:", JSON.stringify(first).slice(0, 1000));
    }
  }
}

// === BING: try different approaches ===
console.log("\n\n=== BING ===");
for (const [label, params] of [
  ["q + safe=off",      { qp: "q",       extra: { safe: "off" } }],
  ["keyword + safe=off",{ qp: "keyword", extra: { safe: "off" } }],
  ["q only",            { qp: "q",       extra: {} }],
]) {
  console.log(`\n[${label}]`);
  const bSub = await submit("bing.com", "bing_search", "iPhone 17 price", params.qp, params.extra);
  const bInner = bSub?.data;
  const bTaskId = bInner?.task_id ?? bInner?.data?.task_id;
  console.log("task_id:", bTaskId ?? "(none)", "| data.data:", JSON.stringify(bInner?.data).slice(0, 80));
  if (bTaskId) {
    console.log("Polling...");
    const r = await poll(bTaskId);
    if (r) {
      const items = Array.isArray(r) ? r : [r];
      const first = items[0];
      const organic = first?.organic_results ?? first?.organic ?? first?.results;
      if (organic?.length) {
        console.log(`FOUND: ${organic.length} results. keys:`, Object.keys(organic[0]));
        console.log("Result[0]:", JSON.stringify(organic[0]).slice(0, 400));
      } else {
        console.log("First item keys:", first ? Object.keys(first) : "null");
        console.log("First item:", JSON.stringify(first).slice(0, 600));
      }
    }
    break; // stop on first working approach
  }
}
