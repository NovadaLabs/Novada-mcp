#!/usr/bin/env node
/**
 * Debug: for DDG - poll directly using the task_id from a cached/working response
 * Strategy: patch submitSearchScrapeTask to NOT throw on missing task_id but instead
 * check if the submit response itself contains parseable data
 */
import axios from "axios";

const API_KEY = "1f35b477c9e1802778ec64aee2a6adfa";
const SCRAPER_API = "https://scraper.novada.com";
const SCRAPER_DL  = "https://scraper-download.novada.com";

// First: try a submit with no_cache=true to get a fresh task_id
async function submit(scraperName, scraperId, query, queryParam = "q", extraParams = {}) {
  const form = new URLSearchParams();
  form.append("scraper_name", scraperName);
  form.append("scraper_id", scraperId);
  form.append("scraper_errors", "true");
  form.append("is_auto_push", "false");
  form.append(queryParam, query);
  form.append("num", "5");
  form.append("json", "1");
  form.append("no_cache", "true"); // force fresh to get a task_id
  for (const [k, v] of Object.entries(extraParams)) form.append(k, v);

  const resp = await axios.post(`${SCRAPER_API}/request`, form, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 60000,
  });
  return resp.data;
}

async function poll(taskId) {
  const url = `${SCRAPER_DL}/scraper_download?task_id=${encodeURIComponent(taskId)}&file_type=json&apikey=${encodeURIComponent(API_KEY)}`;
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

// === DDG: try no_cache=true to get a task_id ===
console.log("\n=== DDG (no_cache=true) ===");
const ddgSubmit = await submit("duckduckgo.com", "duckduckgo", "iPhone 17 price", "q");
console.log("Submit raw:", JSON.stringify(ddgSubmit).slice(0, 1000));
const ddgInner = ddgSubmit?.data;
const ddgTaskId = ddgInner?.task_id ?? ddgInner?.data?.task_id;
console.log("task_id:", ddgTaskId ?? "(none — inline result?)", "data.keys:", ddgInner?.data ? Object.keys(ddgInner.data) : "null");

if (ddgTaskId) {
  console.log("Polling...");
  const result = await poll(ddgTaskId);
  if (result) {
    // Show first item keys to find URL field
    const arr = Array.isArray(result) ? result : [result];
    const first = arr[0];
    console.log("Poll result type:", Array.isArray(result) ? "array" : typeof result);
    if (Array.isArray(result)) {
      console.log("First item keys:", first ? Object.keys(first) : "empty");
      const organic = first?.organic_results ?? first?.organic ?? first?.results ?? first?.items;
      if (Array.isArray(organic) && organic.length > 0) {
        console.log("Organic[0] keys:", Object.keys(organic[0]));
        console.log("Organic[0]:", JSON.stringify(organic[0]).slice(0, 400));
      } else {
        console.log("No organic array found. First item:", JSON.stringify(first).slice(0, 800));
      }
    } else {
      console.log("Result keys:", Object.keys(result));
      const organic = result?.organic_results ?? result?.organic ?? result?.results;
      if (Array.isArray(organic) && organic.length > 0) {
        console.log("Organic[0] keys:", Object.keys(organic[0]));
        console.log("Organic[0]:", JSON.stringify(organic[0]).slice(0, 400));
      }
    }
  }
} else if (ddgInner?.data?.html) {
  console.log("Submit returned inline HTML — no async task. DDG uses sync mode.");
  console.log("No task_id path exists for DDG with json=1. Try without json=1...");

  // Try without json=1
  const ddgSubmit2 = await submit("duckduckgo.com", "duckduckgo", "iPhone 17 price", "q", { no_cache: "true" });
  // Remove json=1 by rebuilding
  const form2 = new URLSearchParams();
  form2.append("scraper_name", "duckduckgo.com");
  form2.append("scraper_id", "duckduckgo");
  form2.append("scraper_errors", "true");
  form2.append("is_auto_push", "false");
  form2.append("q", "iPhone 17 price");
  form2.append("num", "5");
  form2.append("no_cache", "true");
  const resp2 = await axios.post(`${SCRAPER_API}/request`, form2, {
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 60000,
  });
  const body2 = resp2.data;
  const inner2 = body2?.data;
  const taskId2 = inner2?.task_id ?? inner2?.data?.task_id;
  console.log("Without json=1 task_id:", taskId2 ?? "(none)");
  if (taskId2) {
    console.log("Polling...");
    const result2 = await poll(taskId2);
    if (result2) {
      const arr = Array.isArray(result2) ? result2 : [result2];
      const organic = arr[0]?.organic_results ?? arr[0]?.organic ?? arr[0]?.results;
      if (Array.isArray(organic) && organic.length > 0) {
        console.log("Organic[0]:", JSON.stringify(organic[0]).slice(0, 400));
      } else {
        console.log("First item:", JSON.stringify(arr[0]).slice(0, 800));
      }
    }
  }
}

// === BING: try with keyword param (original param name) ===
console.log("\n\n=== BING (test keyword vs q) ===");
for (const qp of ["q", "keyword"]) {
  console.log(`\nBing with query_param="${qp}":`);
  const resp = await submit("bing.com", "bing_search", "iPhone 17 price", qp, { safe: "off" });
  const inner = resp?.data;
  const taskId = inner?.task_id ?? inner?.data?.task_id;
  console.log("task_id:", taskId ?? "(none)", "| data.data:", JSON.stringify(inner?.data).slice(0, 100));
  if (taskId) {
    console.log("Polling...");
    const r = await poll(taskId);
    const arr = Array.isArray(r) ? r : [r];
    const organic = arr[0]?.organic_results ?? arr[0]?.organic ?? arr[0]?.results;
    if (organic?.length > 0) console.log("Organic[0]:", JSON.stringify(organic[0]).slice(0, 300));
    else console.log("No organic. Keys:", arr[0] ? Object.keys(arr[0]) : r);
  }
}
