#!/usr/bin/env node
/**
 * Debug test: raw API calls for bing + DDG
 */
import axios from "axios";

const API_KEY = "1f35b477c9e1802778ec64aee2a6adfa";
const SCRAPER_API = "https://scraper.novada.com";
const SCRAPER_DL  = "https://scraper-download.novada.com";

async function submitAndFetch(scraperName, scraperId, query, queryParam = "q", extraParams = {}) {
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

  console.log("  Submitting to:", `${SCRAPER_API}/request`);
  console.log("  Form:", Object.fromEntries(form.entries()));

  const resp = await axios.post(`${SCRAPER_API}/request`, form, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 60000,
  });
  const body = resp.data;
  console.log("  Submit response:", JSON.stringify(body));

  // Try to extract task_id from multiple locations
  const inner = body.data;
  const taskId =
    inner?.task_id ??
    inner?.data?.task_id ??
    body.task_id;

  if (!taskId) {
    console.log("  ERROR: No task_id found in response");
    return;
  }

  console.log("  task_id:", taskId);

  // Poll
  const deadline = Date.now() + 90_000;
  let attempts = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const url = `${SCRAPER_DL}/scraper_download?task_id=${encodeURIComponent(taskId)}&file_type=json&apikey=${encodeURIComponent(API_KEY)}`;
    const dlResp = await axios.get(url, { timeout: 30000 });
    const dlBody = dlResp.data;
    attempts++;

    if (dlBody?.code === 27202 || dlBody?.code === "27202") {
      process.stdout.write(".");
      continue;
    }
    console.log(`\n  Poll #${attempts} result (first 800 chars):`, JSON.stringify(dlBody).slice(0, 800));
    return dlBody;
  }
  console.log("\n  TIMEOUT after", Math.round((Date.now() - (deadline - 90000)) / 1000), "s");
}

console.log("\n════ BING ════");
await submitAndFetch("bing.com", "bing_search", "iPhone 17 Pro Max price", "q", { safe: "off" });

console.log("\n\n════ DUCKDUCKGO ════");
await submitAndFetch("duckduckgo.com", "duckduckgo", "cheapest platform to buy phones", "q");
