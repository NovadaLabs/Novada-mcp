/**
 * MCP Web Scraping Benchmark — run.mjs
 * Novada vs BrightData vs Firecrawl vs Tavily vs Oxylabs
 *
 * Usage: node workspace/benchmark/run.mjs
 * Requires: axios, cheerio (already in novada-mcp node_modules)
 */

import axios from "axios";
import * as cheerio from "cheerio";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname);

// ─── Credentials ──────────────────────────────────────────────────────────────
const CREDS = {
  novada: {
    apiKey: "1f35b477c9e1802778ec64aee2a6adfa",
    unblockerKey: "b27ad6e6834dd36407b00f4e502e055e",
  },
  brightdata: { token: "39fe5616-61ca-417a-b952-a059d2593e67" },
  firecrawl: { key: "fc-a897ecb6c3e54425a4acba11a399a735" },
  tavily: { key: "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" },
  oxylabs: { user: "berryclare__KAZhJ", pass: "20260324_Berry" },
};

// ─── Test targets ─────────────────────────────────────────────────────────────
const TARGETS = {
  T1: { type: "scrape", url: "https://news.ycombinator.com",                                  label: "Static Scrape (HN)" },
  T2: { type: "scrape", url: "https://linear.app",                                             label: "JS-Heavy Scrape (Linear)" },
  T3: { type: "search", query: "iPhone 17 Pro Max price 2025",                                 label: "Search — E-commerce Price" },
  T4: { type: "search", query: "AI agent memory systems 2025",                                  label: "Search — AI Trends" },
  T5: { type: "crawl",  url: "https://docs.python.org/3/library/collections.html", maxPages: 3, label: "Crawl (Python Docs)" },
  T6: { type: "scrape_structured", url: "amazon", asin: "B0FTC2PRVZ",                         label: "Structured Data (iPhone 17 Pro Max)" },
  T7: { type: "scrape", url: "https://techcrunch.com",                                         label: "Static Scrape (TechCrunch)" },
  T8: { type: "scrape", url: "https://vercel.com",                                             label: "JS-Heavy Scrape (Vercel)" },
};

const ROUNDS = 30; // measured rounds per (competitor × category)

// ─── Result accumulator ───────────────────────────────────────────────────────
const allResults = {};

function saveResults(competitor, rows) {
  allResults[competitor] = rows;
  const path = resolve(OUT_DIR, `results-${competitor}.json`);
  writeFileSync(path, JSON.stringify(rows, null, 2));
  console.log(`  💾 Saved ${rows.length} records → ${path}`);
}

function appendResult(competitor, record) {
  if (!allResults[competitor]) allResults[competitor] = [];
  allResults[competitor].push(record);
}

// ─── Timing helpers ───────────────────────────────────────────────────────────
function now() { return Date.now(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Content quality scorers ──────────────────────────────────────────────────
function scoreContent(catId, text) {
  if (!text || text.length < 50) return 1;
  const t = text.toLowerCase();

  if (catId === "T1") {
    // Look for HN story titles (should have numbers of points or "comments")
    const hnPatterns = /\d+ points?|\d+ comments?|ask hn|show hn|points by/gi;
    const matches = (text.match(hnPatterns) || []).length;
    // Also count lines that look like story titles
    const lines = text.split("\n").filter(l => l.trim().length > 20 && l.trim().length < 200);
    if (matches >= 5 || lines.length >= 10) return 5;
    if (matches >= 3 || lines.length >= 5) return 4;
    if (matches >= 1 || lines.length >= 2) return 3;
    return 2;
  }

  if (catId === "T2") {
    const hasHeadline = /make software|linear|project management|issue tracking|built for/i.test(text);
    const featureCount = (text.match(/\b(cycle|roadmap|backlog|sprint|import|github|git|slack|analytics|automation|priority|triage)/gi) || []).length;
    if (hasHeadline && featureCount >= 3) return 5;
    if (hasHeadline || featureCount >= 3) return 4;
    if (featureCount >= 1) return 3;
    if (text.length > 500) return 2;
    return 1;
  }

  if (catId === "T3" || catId === "T4") {
    // Count results with both title and URL
    const urlMatches = (text.match(/https?:\/\/[^\s"'<>]+/g) || []).filter(u => !u.includes("favicon")).length;
    const titleCount = (text.split("\n").filter(l => l.trim().length > 15 && l.trim().length < 200)).length;
    if (urlMatches >= 5 && titleCount >= 5) return 5;
    if (urlMatches >= 3 && titleCount >= 3) return 4;
    if (urlMatches >= 1 && titleCount >= 1) return 3;
    if (urlMatches >= 1 || titleCount >= 1) return 2;
    return 1;
  }

  if (catId === "T5") {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 500) return 5;
    if (wordCount >= 200) return 4;
    if (wordCount >= 100) return 3;
    if (wordCount >= 30) return 2;
    return 1;
  }

  if (catId === "T6") {
    const hasPrice = /\$[\d,.]+|\d+\.\d{2}|price/i.test(text);
    const hasRating = /\d+\.\d?\s*(out of|stars?)|rating/i.test(text);
    const hasReviews = /[\d,]+ (ratings?|reviews?|customer)/i.test(text);
    const score = (hasPrice ? 2 : 0) + (hasRating ? 2 : 0) + (hasReviews ? 1 : 0);
    return Math.min(5, Math.max(1, score));
  }

  if (catId === "T7") {
    // TechCrunch — news site: look for article titles, funding/startup language
    const newsPatterns = /funding|series [a-e]|million|billion|startup|launch|announces|acquired|venture|raises/gi;
    const matches = (text.match(newsPatterns) || []).length;
    const lines = text.split("\n").filter(l => l.trim().length > 20 && l.trim().length < 250);
    if (matches >= 5 || lines.length >= 15) return 5;
    if (matches >= 3 || lines.length >= 8) return 4;
    if (matches >= 1 || lines.length >= 3) return 3;
    if (text.length > 500) return 2;
    return 1;
  }

  if (catId === "T8") {
    // Vercel — JS-heavy SaaS landing: deploy/edge/framework language
    const hasHeadline = /vercel|deploy|frontend|ship faster|build.*web/i.test(text);
    const featureCount = (text.match(/\b(deploy|deployment|edge|serverless|next\.js|framework|hosting|preview|production|domains?|ci\/cd|git|github|analytics)/gi) || []).length;
    if (hasHeadline && featureCount >= 3) return 5;
    if (hasHeadline || featureCount >= 3) return 4;
    if (featureCount >= 1) return 3;
    if (text.length > 500) return 2;
    return 1;
  }

  return text.length > 1000 ? 4 : text.length > 200 ? 3 : 2;
}

// ─── Agent-friendliness scorer ─────────────────────────────────────────────────
function scoreAgentFriendliness(competitor, responseObj, text, isError) {
  // Evaluate the raw response for agent-friendliness signals
  const str = JSON.stringify(responseObj || {}).toLowerCase();

  const criteria = {
    has_agent_instruction: false,
    error_is_structured: false,
    has_status_field: false,
    output_is_chainable: false,
    low_boilerplate: false,
  };

  // 1. agent_instruction — Novada-specific field
  if (str.includes("agent_instruction") || str.includes("next_steps") || str.includes("next_step")) {
    criteria.has_agent_instruction = true;
  }

  // 2. structured errors — JSON errors (not raw stack traces)
  if (isError) {
    if (str.includes('"code"') || str.includes('"error"') || str.includes('"message"') || str.includes('"status"')) {
      criteria.error_is_structured = true;
    }
  } else {
    criteria.error_is_structured = true; // success = no error to be unstructured
  }

  // 3. status field — explicit status/code signal
  if (str.includes('"status"') || str.includes('"code"') || str.includes('"success"')) {
    criteria.has_status_field = true;
  }

  // 4. chainable output — response includes URLs or IDs for next call
  const urls = (text || "").match(/https?:\/\/[^\s"'<>]+/g) || [];
  const hasIds = str.includes('"id"') || str.includes('"task_id"') || str.includes('"job_id"');
  if (urls.length > 0 || hasIds) {
    criteria.output_is_chainable = true;
  }

  // 5. low boilerplate — estimate signal-to-noise
  const totalLen = (text || "").length;
  const metaPatterns = /^(date|server|content-type|x-|cache|etag|last-modified|accept-|vary|transfer|connection)/im;
  const metaLines = (text || "").split("\n").filter(l => metaPatterns.test(l)).length;
  const totalLines = (text || "").split("\n").length;
  if (totalLines === 0 || metaLines / totalLines < 0.2) {
    criteria.low_boilerplate = true;
  }

  const score = Object.values(criteria).filter(Boolean).length;
  return { ...criteria, score };
}

// ─── Generic call wrapper ─────────────────────────────────────────────────────
async function measure(catId, competitor, round, fn) {
  const t0 = now();
  try {
    const { text, raw } = await Promise.race([
      fn(),
      sleep(60000).then(() => { throw new Error("TIMEOUT"); }),
    ]);
    const latency_ms = now() - t0;
    const content_quality = scoreContent(catId, text);
    const af = scoreAgentFriendliness(competitor, raw, text, false);
    const target_content_found = content_quality >= 3;
    const record = {
      competitor, category: catId, round, latency_ms, success: true, status: "ok",
      content_length_chars: (text || "").length, content_quality,
      agent_friendliness: af,
      target_content_found, notes: "",
    };
    process.stdout.write(`    ✅ R${round} ${catId} ${latency_ms}ms Q${content_quality} AF${af.score}\n`);
    return record;
  } catch (err) {
    const latency_ms = now() - t0;
    const msg = err.message || String(err);
    const isCreditExhausted = /402|insufficient credits|quota|credit/i.test(msg);
    const isTimeout = msg === "TIMEOUT";
    const status = isCreditExhausted ? "credit_exhausted" : isTimeout ? "timeout" : "error";
    const af = scoreAgentFriendliness(competitor, null, "", true);
    const record = {
      competitor, category: catId, round, latency_ms: isTimeout ? 60000 : latency_ms,
      success: false, status,
      content_length_chars: 0, content_quality: 1,
      agent_friendliness: af,
      target_content_found: false, notes: msg.slice(0, 200),
    };
    process.stdout.write(`    ❌ R${round} ${catId} ${status} ${msg.slice(0, 80)}\n`);
    return record;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOVADA API CALLS
// ═══════════════════════════════════════════════════════════════════════════════

async function novadaScrape(url) {
  const resp = await axios.post(
    "https://webunlocker.novada.com/request",
    { target_url: url, response_format: "html", js_render: true },
    {
      headers: { Authorization: `Bearer ${CREDS.novada.unblockerKey}`, "Content-Type": "application/json" },
      timeout: 55000,
    }
  );
  // Response: { code: 0, data: { code: 200, html: "..." } }
  let html = "";
  if (resp.data?.code === 0 && resp.data?.data?.html) {
    html = resp.data.data.html;
  } else {
    throw new Error(`Novada unblocker error: ${JSON.stringify(resp.data).slice(0, 200)}`);
  }
  const $ = cheerio.load(html);
  $("script, style, noscript, head").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 20000);
  return { text, raw: resp.data };
}

async function novadaSearch(query) {
  const form = new URLSearchParams();
  form.append("scraper_name", "google.com");
  form.append("scraper_id", "google_search");
  form.append("scraper_errors", "true");
  form.append("is_auto_push", "false");
  form.append("q", query);
  form.append("num", "5");
  form.append("json", "1");
  form.append("no_cache", "false");

  const submit = await axios.post("https://scraper.novada.com/request", form, {
    headers: { Authorization: `Bearer ${CREDS.novada.apiKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 55000,
  });

  const body = submit.data;
  if (body.code !== 0) throw new Error(`Novada SERP submit error (${body.code}): ${body.msg}`);

  const inner = body.data;
  const taskId = inner?.task_id ?? inner?.data?.task_id;
  if (!taskId) throw new Error(`No task_id: ${JSON.stringify(body).slice(0, 200)}`);

  // Poll
  const dlUrl = `https://api.novada.com/g/api/proxy/scraper_download?task_id=${encodeURIComponent(taskId)}&file_type=json&apikey=${encodeURIComponent(CREDS.novada.apiKey)}`;
  const deadline = Date.now() + 85000;
  while (Date.now() < deadline) {
    const dl = await axios.get(dlUrl, { timeout: 30000 });
    const dlBody = dl.data;
    if (Array.isArray(dlBody) && dlBody.length > 0) {
      const item = dlBody[0]?.rest ?? dlBody[0];
      const organic = item.organic_results ?? item.organic ?? item.results ?? [];
      const text = organic.slice(0, 5).map(r => `${r.title ?? ""}\n${r.url ?? r.link ?? ""}`).join("\n\n");
      return { text: text || JSON.stringify(item).slice(0, 3000), raw: item };
    }
    if (dlBody?.code === 27202) { await sleep(2000); continue; }
    if (dlBody?.organic_results || dlBody?.organic) {
      const organic = dlBody.organic_results ?? dlBody.organic ?? [];
      const text = organic.slice(0, 5).map(r => `${r.title ?? ""}\n${r.url ?? r.link ?? ""}`).join("\n\n");
      return { text: text || JSON.stringify(dlBody).slice(0, 3000), raw: dlBody };
    }
    throw new Error(`Unexpected SERP download response: ${JSON.stringify(dlBody).slice(0, 150)}`);
  }
  throw new Error("Novada SERP task timed out after 85s");
}

async function novadaCrawl(url, maxPages = 3) {
  // Fetch seed page
  const seed = await novadaScrape(url);
  const pages = [{ url, text: seed.text }];

  // Extract links from HTML
  const seedResp = await axios.post(
    "https://webunlocker.novada.com/request",
    { target_url: url, response_format: "html", js_render: false },
    {
      headers: { Authorization: `Bearer ${CREDS.novada.unblockerKey}`, "Content-Type": "application/json" },
      timeout: 30000,
    }
  );
  const seedHtml = seedResp.data?.data?.html ?? "";
  const $ = cheerio.load(seedHtml);
  const baseOrigin = new URL(url).origin;
  const links = [];
  $("a[href]").each((_, el) => {
    try {
      const href = new URL($(el).attr("href"), url).href;
      if (href.startsWith(baseOrigin) && !links.includes(href) && href !== url) links.push(href);
    } catch {}
  });

  // Crawl up to maxPages-1 additional pages
  for (const link of links.slice(0, maxPages - 1)) {
    try {
      const page = await novadaScrape(link);
      pages.push({ url: link, text: page.text });
    } catch {}
  }

  const combinedText = pages.map(p => `=== ${p.url} ===\n${p.text}`).join("\n\n");
  return { text: combinedText, raw: { pages_crawled: pages.length, urls: pages.map(p => p.url) } };
}

async function novadaStructured(asin) {
  // Scrape Amazon product page via Web Unblocker (Amazon scraper plan not activated)
  const amazonUrl = `https://www.amazon.com/dp/${asin}`;
  const resp = await axios.post(
    "https://webunlocker.novada.com/request",
    { target_url: amazonUrl, response_format: "html", js_render: true },
    {
      headers: { Authorization: `Bearer ${CREDS.novada.unblockerKey}`, "Content-Type": "application/json" },
      timeout: 55000,
    }
  );
  if (resp.data?.code !== 0 || !resp.data?.data?.html) {
    throw new Error(`Novada Amazon unblocker error: ${JSON.stringify(resp.data).slice(0, 200)}`);
  }
  const html = resp.data.data.html;
  const $ = cheerio.load(html);
  $("script, style, noscript, head, nav, footer").remove();
  const title = $("#productTitle").text().trim();
  const price = $(".a-price-whole").first().text().trim() ||
                $(".priceToPay .a-offscreen").first().text().trim() ||
                $("[data-a-color='price'] .a-offscreen").first().text().trim();
  const rating = $("#averageCustomerReviews .a-icon-alt").first().text().trim() ||
                 $("[data-asin] .a-icon-alt").first().text().trim();
  const reviews = $("#acrCustomerReviewText").first().text().trim();
  const brand = $(".po-brand td:last-child").text().trim() || $("#bylineInfo").text().trim().slice(0, 60);
  const features = $("#feature-bullets li").map((_, el) => $(el).text().trim()).get().slice(0, 5).join("\n");
  const text = [`title: ${title}`, `price: $${price}`, `rating: ${rating}`, `reviews: ${reviews}`, `brand: ${brand}`, `features:\n${features}`].join("\n");
  return { text: text || $("body").text().replace(/\s+/g, " ").trim().slice(0, 5000), raw: resp.data };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRIGHTDATA API CALLS
// ═══════════════════════════════════════════════════════════════════════════════

async function brightdataScrape(url) {
  const resp = await axios.post(
    "https://api.brightdata.com/request",
    { zone: "web_unlocker1", url, format: "markdown" },
    {
      headers: { Authorization: `Bearer ${CREDS.brightdata.token}`, "Content-Type": "application/json" },
      timeout: 55000,
    }
  );
  const text = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
  return { text: text.slice(0, 20000), raw: { status: resp.status, content_type: resp.headers["content-type"] } };
}

async function brightdataSearch(query) {
  const resp = await axios.post(
    "https://api.brightdata.com/request",
    { zone: "web_search", url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=5`, format: "raw" },
    {
      headers: { Authorization: `Bearer ${CREDS.brightdata.token}`, "Content-Type": "application/json" },
      timeout: 55000,
    }
  );
  const text = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
  return { text: text.slice(0, 15000), raw: { status: resp.status } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIRECRAWL API CALLS
// ═══════════════════════════════════════════════════════════════════════════════

async function firecrawlScrape(url) {
  const resp = await axios.post(
    "https://api.firecrawl.dev/v1/scrape",
    { url, formats: ["markdown"] },
    {
      headers: { Authorization: `Bearer ${CREDS.firecrawl.key}`, "Content-Type": "application/json" },
      timeout: 55000,
    }
  );
  const d = resp.data;
  if (!d.success) throw new Error(`Firecrawl error: ${JSON.stringify(d).slice(0, 200)}`);
  const text = d.data?.markdown ?? d.markdown ?? JSON.stringify(d).slice(0, 20000);
  return { text: String(text).slice(0, 20000), raw: { success: d.success, metadata: d.data?.metadata } };
}

async function firecrawlCrawl(url, limit = 3) {
  // Submit crawl job
  const submit = await axios.post(
    "https://api.firecrawl.dev/v1/crawl",
    { url, limit, scrapeOptions: { formats: ["markdown"] } },
    {
      headers: { Authorization: `Bearer ${CREDS.firecrawl.key}`, "Content-Type": "application/json" },
      timeout: 30000,
    }
  );
  const d = submit.data;
  if (!d.success && !d.id) throw new Error(`Firecrawl crawl submit error: ${JSON.stringify(d).slice(0, 200)}`);
  const jobId = d.id;
  if (!jobId) {
    // Some API versions return results directly
    const pages = d.data ?? [];
    const text = pages.map(p => p.markdown ?? "").join("\n\n---\n\n");
    return { text: text.slice(0, 20000), raw: { pages: pages.length } };
  }

  // Poll
  const deadline = Date.now() + 85000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const status = await axios.get(`https://api.firecrawl.dev/v1/crawl/${jobId}`, {
      headers: { Authorization: `Bearer ${CREDS.firecrawl.key}` },
      timeout: 15000,
    });
    const sd = status.data;
    if (sd.status === "completed" || sd.data?.length > 0) {
      const pages = sd.data ?? [];
      const text = pages.map(p => p.markdown ?? "").join("\n\n---\n\n");
      return { text: text.slice(0, 20000), raw: { pages_crawled: pages.length, status: sd.status } };
    }
    if (sd.status === "failed") throw new Error(`Firecrawl crawl failed: ${JSON.stringify(sd).slice(0, 200)}`);
  }
  throw new Error("Firecrawl crawl timed out");
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAVILY API CALLS
// ═══════════════════════════════════════════════════════════════════════════════

async function tavilyScrape(url) {
  const resp = await axios.post(
    "https://api.tavily.com/extract",
    { api_key: CREDS.tavily.key, urls: [url] },
    { headers: { "Content-Type": "application/json" }, timeout: 55000 }
  );
  const d = resp.data;
  const results = d.results ?? d.data ?? [];
  const item = results[0] ?? {};
  const text = item.raw_content ?? item.content ?? JSON.stringify(d).slice(0, 20000);
  return { text: String(text).slice(0, 20000), raw: { results_count: results.length, url: item.url } };
}

async function tavilySearch(query, depth = "basic") {
  const resp = await axios.post(
    "https://api.tavily.com/search",
    { api_key: CREDS.tavily.key, query, max_results: 5, search_depth: depth },
    { headers: { "Content-Type": "application/json" }, timeout: 55000 }
  );
  const d = resp.data;
  const results = d.results ?? [];
  const text = results.map(r => `${r.title ?? ""}\n${r.url ?? ""}\n${r.content ?? ""}`).join("\n\n");
  return { text: text.slice(0, 20000), raw: { results_count: results.length } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// OXYLABS API CALLS
// ═══════════════════════════════════════════════════════════════════════════════

const OXY_AUTH = Buffer.from(`${CREDS.oxylabs.user}:${CREDS.oxylabs.pass}`).toString("base64");

async function oxylabsScrape(url) {
  const resp = await axios.post(
    "https://realtime.oxylabs.io/v1/queries",
    { source: "universal", url, render: "html" },
    {
      headers: { Authorization: `Basic ${OXY_AUTH}`, "Content-Type": "application/json" },
      timeout: 55000,
    }
  );
  const d = resp.data;
  const content = d.results?.[0]?.content ?? JSON.stringify(d);
  // Parse HTML to text
  const $ = cheerio.load(content);
  $("script,style,noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 20000);
  return { text, raw: { status_code: d.results?.[0]?.status_code, results: d.results?.length } };
}

async function oxylabsSearch(query) {
  const resp = await axios.post(
    "https://realtime.oxylabs.io/v1/queries",
    { source: "google_search", query, domain: "com", geo_location: "United States" },
    {
      headers: { Authorization: `Basic ${OXY_AUTH}`, "Content-Type": "application/json" },
      timeout: 55000,
    }
  );
  const d = resp.data;
  const result = d.results?.[0] ?? {};
  const organic = result.content?.results?.organic ?? result.content?.organic ?? [];
  const text = organic.slice(0, 5).map(r => `${r.title ?? ""}\n${r.url ?? ""}`).join("\n\n")
    || JSON.stringify(result.content).slice(0, 10000);
  return { text: text.slice(0, 20000), raw: { items: organic.length } };
}

async function oxylabsAmazon(asin) {
  const resp = await axios.post(
    "https://realtime.oxylabs.io/v1/queries",
    { source: "amazon_product", query: asin, parse: true, domain: "com" },
    {
      headers: { Authorization: `Basic ${OXY_AUTH}`, "Content-Type": "application/json" },
      timeout: 55000,
    }
  );
  const d = resp.data;
  const content = d.results?.[0]?.content ?? {};
  const text = JSON.stringify(content).slice(0, 10000);
  return { text, raw: content };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPETITOR DISPATCH
// ═══════════════════════════════════════════════════════════════════════════════

async function callCompetitor(competitor, catId, target) {
  switch (competitor) {
    case "novada": {
      if (target.type === "scrape") return novadaScrape(target.url);
      if (target.type === "search") return novadaSearch(target.query);
      if (target.type === "crawl") return novadaCrawl(target.url, target.maxPages);
      if (target.type === "scrape_structured") return novadaStructured(target.asin);
      break;
    }
    case "brightdata": {
      if (target.type === "scrape") return brightdataScrape(target.url);
      if (target.type === "search") return brightdataSearch(target.query);
      if (target.type === "crawl") throw new Error("BrightData: no crawl endpoint (N/A)");
      if (target.type === "scrape_structured") throw new Error("BrightData: no Amazon scraper configured (N/A)");
      break;
    }
    case "firecrawl": {
      if (target.type === "scrape") return firecrawlScrape(target.url);
      if (target.type === "search") throw new Error("Firecrawl: no search endpoint (N/A)");
      if (target.type === "crawl") return firecrawlCrawl(target.url, target.maxPages);
      if (target.type === "scrape_structured") throw new Error("Firecrawl: no Amazon scraper (N/A)");
      break;
    }
    case "tavily": {
      if (target.type === "scrape") return tavilyScrape(target.url);
      if (target.type === "search") return tavilySearch(target.query);
      if (target.type === "crawl") throw new Error("Tavily: no crawl endpoint (N/A)");
      if (target.type === "scrape_structured") throw new Error("Tavily: no Amazon scraper (N/A)");
      break;
    }
    case "oxylabs": {
      if (target.type === "scrape") return oxylabsScrape(target.url);
      if (target.type === "search") return oxylabsSearch(target.query);
      if (target.type === "crawl") throw new Error("Oxylabs: no crawl endpoint (N/A)");
      if (target.type === "scrape_structured") return oxylabsAmazon(target.asin);
      break;
    }
  }
  throw new Error(`Unknown competitor: ${competitor}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN BENCHMARK LOOP
// ═══════════════════════════════════════════════════════════════════════════════

const COMPETITORS = ["novada", "brightdata", "firecrawl", "tavily", "oxylabs"];
const CATEGORIES = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"];

// N/A matrix — true = skip all rounds
const NA = {
  brightdata: { T5: true, T6: true },
  firecrawl:  { T3: true, T4: true, T6: true },
  tavily:     { T5: true, T6: true },
  oxylabs:    { T5: true },
};

async function runBenchmark() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   MCP Web Scraping Benchmark v2.0 — 2026-05-22       ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  for (const competitor of COMPETITORS) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  🏁 Competitor: ${competitor.toUpperCase()}`);
    console.log(`${"═".repeat(60)}`);

    const rows = [];
    let creditExhausted = false;

    for (const catId of CATEGORIES) {
      const target = TARGETS[catId];

      // Check N/A
      if (NA[competitor]?.[catId]) {
        console.log(`\n  📋 ${catId} (${target.label}) — N/A for ${competitor}`);
        for (let r = 0; r <= ROUNDS; r++) {
          rows.push({
            competitor, category: catId, round: r,
            latency_ms: 0, success: false, status: "na",
            content_length_chars: 0, content_quality: 0,
            agent_friendliness: { has_agent_instruction: false, error_is_structured: false, has_status_field: false, output_is_chainable: false, low_boilerplate: false, score: 0 },
            target_content_found: false, notes: "Not supported by this competitor",
          });
        }
        continue;
      }

      if (creditExhausted) {
        console.log(`\n  💸 ${catId} — CREDIT_EXHAUSTED (skipping)`);
        for (let r = 0; r <= ROUNDS; r++) {
          rows.push({ competitor, category: catId, round: r, latency_ms: 0, success: false, status: "credit_exhausted", content_length_chars: 0, content_quality: 0, agent_friendliness: { score: 0 }, target_content_found: false, notes: "Credit exhausted earlier" });
        }
        continue;
      }

      console.log(`\n  📊 ${catId} — ${target.label}`);

      // Warm-up (round 0)
      console.log("    [warmup]");
      const warmup = await measure(catId, competitor, 0, () => callCompetitor(competitor, catId, target));
      if (warmup.status === "credit_exhausted") { creditExhausted = true; }

      // 10 measured rounds
      for (let r = 1; r <= ROUNDS; r++) {
        if (creditExhausted) {
          rows.push({ competitor, category: catId, round: r, latency_ms: 0, success: false, status: "credit_exhausted", content_length_chars: 0, content_quality: 0, agent_friendliness: { score: 0 }, target_content_found: false, notes: "Credit exhausted" });
          continue;
        }
        // Small delay between rounds to avoid hammering
        if (r > 1) await sleep(500);
        const record = await measure(catId, competitor, r, () => callCompetitor(competitor, catId, target));
        rows.push(record);
        if (record.status === "credit_exhausted") {
          creditExhausted = true;
          console.log(`    💸 Credit exhausted at round ${r} — marking remaining CREDIT_EXHAUSTED`);
        }
        // Save after each round
        appendResult(competitor, record);
      }
    }

    saveResults(competitor, rows.filter(r => r.round > 0)); // only measured rounds
    console.log(`\n  ✅ ${competitor} done — ${rows.filter(r => r.success).length} successes`);
  }

  console.log("\n\n🎉 All competitors done. Generating report...");
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGGREGATION
// ═══════════════════════════════════════════════════════════════════════════════

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p95(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
}

function aggregate() {
  const summary = {};
  for (const competitor of COMPETITORS) {
    summary[competitor] = {};
    const rows = allResults[competitor] ?? [];
    for (const catId of CATEGORIES) {
      const catRows = rows.filter(r => r.category === catId && r.round > 0);
      const successRows = catRows.filter(r => r.status === "ok");
      const naRows = catRows.filter(r => r.status === "na");
      const latencies = successRows.map(r => r.latency_ms);
      const qualities = successRows.map(r => r.content_quality);
      const afScores = successRows.map(r => r.agent_friendliness?.score ?? 0);

      summary[competitor][catId] = {
        status: naRows.length === catRows.length ? "na" : (successRows.length > 0 ? "ok" : "failed"),
        success_count: successRows.length,
        total_rounds: catRows.filter(r => r.status !== "na").length,
        success_rate: successRows.length / Math.max(1, catRows.filter(r => r.status !== "na").length),
        latency_median_ms: median(latencies),
        latency_p95_ms: p95(latencies),
        quality_median: median(qualities),
        af_score: median(afScores),
        sample_notes: catRows.find(r => r.notes)?.notes ?? "",
      };
    }
  }

  const path = resolve(OUT_DIR, "summary.json");
  writeFileSync(path, JSON.stringify(summary, null, 2));
  console.log(`  💾 Summary → ${path}`);
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTML REPORT
// ═══════════════════════════════════════════════════════════════════════════════

function colorRamp(value, min, max, reverse = false) {
  if (value === null || value === undefined) return "#6b7280"; // gray for N/A
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const t = reverse ? 1 - norm : norm;
  // Green (#22c55e) to Red (#ef4444)
  const r = Math.round(239 * (1 - t) + 34 * t);
  const g = Math.round(68 * (1 - t) + 197 * t);
  const b = Math.round(68 * (1 - t) + 94 * t);
  return `rgb(${r},${g},${b})`;
}

function badge(text, color) {
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600">${text}</span>`;
}

function fmtLatency(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms >= 60000) return "Timeout";
  return ms >= 1000 ? `${(ms/1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtScore(v) {
  if (v === null || v === undefined) return "—";
  return v.toFixed(1);
}

function generateReport(summary) {
  const catLabels = { T1: "T1 Static Scrape", T2: "T2 JS-Heavy Scrape", T3: "T3 Search/Financial", T4: "T4 Search/AI", T5: "T5 Crawl", T6: "T6 Structured/Amazon" };

  // Determine winners per category
  const winners = {};
  for (const catId of CATEGORIES) {
    let best = { quality: -1, latency: Infinity, competitor: null };
    for (const c of COMPETITORS) {
      const s = summary[c]?.[catId];
      if (!s || s.status === "na") continue;
      const q = s.quality_median ?? 0;
      const l = s.latency_median_ms ?? Infinity;
      if (q > best.quality || (q === best.quality && l < best.latency)) {
        best = { quality: q, latency: l, competitor: c };
      }
    }
    winners[catId] = best.competitor;
  }

  const novadaWins = CATEGORIES.filter(c => winners[c] === "novada").length;
  const novadaLoses = CATEGORIES.filter(c => winners[c] !== "novada" && winners[c] !== null).length;
  const novadaTies = CATEGORIES.filter(c => winners[c] === null).length;

  // Agent-friendliness per competitor (across all categories)
  const afByCompetitor = {};
  for (const c of COMPETITORS) {
    const rows = (allResults[c] ?? []).filter(r => r.status === "ok");
    const scores = rows.map(r => r.agent_friendliness?.score ?? 0);
    afByCompetitor[c] = median(scores) ?? 0;
    // Detailed breakdown
    const detail = { has_agent_instruction: 0, error_is_structured: 0, has_status_field: 0, output_is_chainable: 0, low_boilerplate: 0 };
    for (const r of rows) {
      const af = r.agent_friendliness ?? {};
      for (const k of Object.keys(detail)) if (af[k]) detail[k]++;
    }
    afByCompetitor[`${c}_detail`] = { ...detail, total: rows.length };
  }

  const compNames = { novada: "Novada", brightdata: "BrightData", firecrawl: "Firecrawl", tavily: "Tavily", oxylabs: "Oxylabs" };
  const compColors = { novada: "#7c3aed", brightdata: "#2563eb", firecrawl: "#d97706", tavily: "#059669", oxylabs: "#dc2626" };

  // Helper: table cell with color
  function latencyCell(ms, catId) {
    if (ms === null || ms === undefined) return `<td style="color:#9ca3af;text-align:center">N/A</td>`;
    const allLats = COMPETITORS.map(c => summary[c]?.[catId]?.latency_median_ms).filter(v => v != null);
    const minL = Math.min(...allLats);
    const maxL = Math.max(...allLats);
    const bg = colorRamp(ms, minL, maxL, true); // reverse: lower latency = green
    return `<td style="background:${bg}20;text-align:center;font-weight:600;color:${bg}">${fmtLatency(ms)}</td>`;
  }

  function qualityCell(v, catId) {
    if (v === null || v === undefined) return `<td style="color:#9ca3af;text-align:center">N/A</td>`;
    const bg = colorRamp(v, 1, 5);
    return `<td style="background:${bg}20;text-align:center;font-weight:600;color:${bg}">${fmtScore(v)}/5</td>`;
  }

  const latencyTable = `
    <table class="data-table">
      <thead><tr>
        <th>Category</th>
        ${COMPETITORS.map(c => `<th style="color:${compColors[c]}">${compNames[c]}</th>`).join("")}
      </tr></thead>
      <tbody>
        ${CATEGORIES.map(catId => {
          const label = catLabels[catId];
          const win = winners[catId];
          return `<tr>
            <td><strong>${label}</strong>${win ? ` <span style="font-size:11px;color:#9ca3af">winner: ${compNames[win]}</span>` : ""}</td>
            ${COMPETITORS.map(c => {
              const s = summary[c]?.[catId];
              if (!s || s.status === "na") return `<td style="color:#9ca3af;text-align:center">N/A</td>`;
              const successPct = Math.round((s.success_rate ?? 0) * 100);
              return `<td style="text-align:center">
                <div style="font-weight:700;font-size:15px">${fmtLatency(s.latency_median_ms)}</div>
                <div style="font-size:11px;color:#6b7280">p95: ${fmtLatency(s.latency_p95_ms)} | ${successPct}% ok</div>
              </td>`;
            }).join("")}
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;

  const qualityTable = `
    <table class="data-table">
      <thead><tr>
        <th>Category</th>
        ${COMPETITORS.map(c => `<th style="color:${compColors[c]}">${compNames[c]}</th>`).join("")}
      </tr></thead>
      <tbody>
        ${CATEGORIES.map(catId => {
          return `<tr>
            <td><strong>${catLabels[catId]}</strong></td>
            ${COMPETITORS.map(c => {
              const s = summary[c]?.[catId];
              if (!s || s.status === "na") return `<td style="color:#9ca3af;text-align:center">N/A</td>`;
              return qualityCell(s.quality_median, catId);
            }).join("")}
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;

  const afTable = `
    <table class="data-table">
      <thead><tr>
        <th>Competitor</th>
        <th>Overall Score</th>
        <th>agent_instruction</th>
        <th>Structured Errors</th>
        <th>Status Field</th>
        <th>Chainable Output</th>
        <th>Low Boilerplate</th>
      </tr></thead>
      <tbody>
        ${COMPETITORS.map(c => {
          const sc = afByCompetitor[c] ?? 0;
          const det = afByCompetitor[`${c}_detail`] ?? {};
          const total = det.total || 1;
          function pct(v) { return `${Math.round((v/total)*100)}%`; }
          const bg = colorRamp(sc, 0, 5);
          return `<tr>
            <td><strong style="color:${compColors[c]}">${compNames[c]}</strong></td>
            <td style="text-align:center"><span style="background:${bg}20;color:${bg};padding:4px 12px;border-radius:99px;font-weight:700">${fmtScore(sc)}/5</span></td>
            <td style="text-align:center">${pct(det.has_agent_instruction ?? 0)}</td>
            <td style="text-align:center">${pct(det.error_is_structured ?? 0)}</td>
            <td style="text-align:center">${pct(det.has_status_field ?? 0)}</td>
            <td style="text-align:center">${pct(det.output_is_chainable ?? 0)}</td>
            <td style="text-align:center">${pct(det.low_boilerplate ?? 0)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;

  // Per-category deep dives
  const deepDives = CATEGORIES.map(catId => {
    const samplesByComp = {};
    for (const c of COMPETITORS) {
      const rows = (allResults[c] ?? []).filter(r => r.category === catId && r.round === 5);
      samplesByComp[c] = rows[0];
    }
    const winner = winners[catId];

    return `
      <div class="deep-dive">
        <h3>${catLabels[catId]}</h3>
        <p><strong>Winner:</strong> ${winner ? `<span style="color:${compColors[winner]}">${compNames[winner]}</span>` : "N/A"} —
        Target: ${TARGETS[catId].url ?? TARGETS[catId].query ?? TARGETS[catId].asin}</p>
        ${COMPETITORS.map(c => {
          const row = samplesByComp[c];
          const s = summary[c]?.[catId];
          if (!row || row.status === "na") return `<div class="sample-block"><h4 style="color:${compColors[c]}">${compNames[c]}</h4><p style="color:#9ca3af">N/A — not supported</p></div>`;
          if (!row.success) return `<div class="sample-block"><h4 style="color:${compColors[c]}">${compNames[c]}</h4><p style="color:#ef4444">❌ ${row.status}: ${row.notes}</p></div>`;
          return `<div class="sample-block">
            <h4 style="color:${compColors[c]}">${compNames[c]}</h4>
            <div class="stats-row">
              <span>Latency: <strong>${fmtLatency(row.latency_ms)}</strong></span>
              <span>Quality: <strong>${row.content_quality}/5</strong></span>
              <span>AF: <strong>${row.agent_friendliness?.score ?? 0}/5</strong></span>
              <span>Chars: <strong>${(row.content_length_chars || 0).toLocaleString()}</strong></span>
            </div>
          </div>`;
        }).join("")}
      </div>`;
  }).join("");

  // Cost efficiency section
  const costSection = COMPETITORS.map(c => {
    const rows = allResults[c] ?? [];
    const successCount = rows.filter(r => r.success).length;
    const exhausted = rows.find(r => r.status === "credit_exhausted");
    return `<tr>
      <td style="color:${compColors[c]};font-weight:600">${compNames[c]}</td>
      <td>${successCount}/${rows.length} successful</td>
      <td>${exhausted ? `⚠️ Exhausted at round ${exhausted.round}, category ${exhausted.category}` : "No credit issues"}</td>
    </tr>`;
  }).join("");

  // Gaps & advantages
  const advantages = CATEGORIES.filter(c => winners[c] === "novada")
    .map(c => `<li><strong>${catLabels[c]}</strong>: Novada leads on quality (${fmtScore(summary.novada?.[c]?.quality_median)}/5) and speed (${fmtLatency(summary.novada?.[c]?.latency_median_ms)})</li>`)
    .join("");
  const disadvantages = CATEGORIES.filter(c => winners[c] && winners[c] !== "novada")
    .map(c => {
      const w = winners[c];
      return `<li><strong>${catLabels[c]}</strong>: ${compNames[w]} wins — quality ${fmtScore(summary[w]?.[c]?.quality_median)}/5 vs Novada ${fmtScore(summary.novada?.[c]?.quality_median)}/5</li>`;
    }).join("");

  // Raw data
  const rawData = JSON.stringify(allResults, null, 2).replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Web Scraping Benchmark — Novada vs Competitors</title>
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Nunito', system-ui, sans-serif; background: #f8fafc; color: #1e293b; display: flex; min-height: 100vh; }
    nav { width: 220px; background: #1e1b4b; color: #e0e7ff; padding: 24px 0; position: sticky; top: 0; height: 100vh; overflow-y: auto; flex-shrink: 0; }
    nav h1 { font-size: 16px; font-weight: 800; padding: 0 20px 20px; border-bottom: 1px solid #312e81; letter-spacing: -0.5px; }
    nav h1 span { color: #818cf8; }
    nav ul { list-style: none; padding: 16px 0; }
    nav li a { display: block; padding: 8px 20px; color: #a5b4fc; text-decoration: none; font-size: 13px; font-weight: 600; border-left: 3px solid transparent; transition: all 0.15s; }
    nav li a:hover { color: #fff; background: #312e81; border-color: #818cf8; }
    main { flex: 1; padding: 40px; max-width: 1200px; }
    h2 { font-size: 24px; font-weight: 800; margin: 48px 0 16px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
    h2:first-of-type { margin-top: 0; }
    .verdict { background: linear-gradient(135deg, #1e1b4b 0%, #4c1d95 100%); color: white; border-radius: 16px; padding: 32px; margin-bottom: 32px; }
    .verdict h2 { color: white; border-color: rgba(255,255,255,0.2); margin-top: 0; }
    .verdict-line { font-size: 18px; font-weight: 700; margin-bottom: 16px; }
    .stat-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 20px 0; }
    .stat-card { background: rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; text-align: center; }
    .stat-card .num { font-size: 36px; font-weight: 900; }
    .stat-card .label { font-size: 13px; opacity: 0.8; margin-top: 4px; }
    .data-table { width: 100%; border-collapse: collapse; margin: 16px 0; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .data-table th { background: #f1f5f9; padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 700; color: #475569; border-bottom: 2px solid #e2e8f0; }
    .data-table td { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    .data-table tr:last-child td { border-bottom: none; }
    .deep-dive { background: white; border-radius: 12px; padding: 24px; margin: 16px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .deep-dive h3 { font-size: 18px; font-weight: 800; margin-bottom: 12px; }
    .sample-block { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 12px 0; }
    .sample-block h4 { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
    .stats-row { display: flex; gap: 20px; flex-wrap: wrap; font-size: 13px; color: #475569; }
    details { margin: 16px 0; }
    summary { cursor: pointer; font-weight: 700; padding: 12px 16px; background: white; border-radius: 8px; border: 1px solid #e2e8f0; }
    pre { background: #0f172a; color: #e2e8f0; padding: 24px; border-radius: 12px; overflow-x: auto; font-size: 12px; line-height: 1.6; margin-top: 12px; }
    .section { margin-bottom: 48px; }
    .note { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 0 8px 8px 0; font-size: 14px; margin: 16px 0; }
  </style>
</head>
<body>
<nav>
  <h1><span>Novada</span> Benchmark</h1>
  <ul>
    <li><a href="#executive">Executive Summary</a></li>
    <li><a href="#latency">Latency Comparison</a></li>
    <li><a href="#quality">Quality Scores</a></li>
    <li><a href="#agent-friendliness">Agent-Friendliness</a></li>
    <li><a href="#deep-dives">Per-Category Deep Dives</a></li>
    <li><a href="#cost">Cost Efficiency</a></li>
    <li><a href="#gaps">Gaps &amp; Advantages</a></li>
    <li><a href="#raw">Raw Data</a></li>
  </ul>
</nav>
<main>
  <div class="verdict">
    <h2 id="executive">Executive Summary</h2>
    <div class="verdict-line">
      Novada wins <strong>${novadaWins}/6</strong> categories outright,
      ties <strong>${novadaTies}</strong>,
      trails <strong>${novadaLoses}</strong>.
    </div>
    <div class="stat-cards">
      <div class="stat-card">
        <div class="num">${novadaWins}</div>
        <div class="label">Categories Won</div>
      </div>
      <div class="stat-card">
        <div class="num">${novadaTies}</div>
        <div class="label">Ties</div>
      </div>
      <div class="stat-card">
        <div class="num">${novadaLoses}</div>
        <div class="label">Trailing</div>
      </div>
    </div>
    <p style="opacity:0.8;font-size:14px">Generated ${new Date().toISOString()} | ${ROUNDS} rounds per category × 5 competitors × 6 categories</p>
  </div>

  <div class="section">
    <h2 id="latency">2. Latency Comparison</h2>
    <p style="color:#64748b;margin-bottom:16px">Median latency and p95 across 10 rounds. Green = fastest, Red = slowest. N/A = capability not supported.</p>
    ${latencyTable}
  </div>

  <div class="section">
    <h2 id="quality">3. Quality Scores</h2>
    <p style="color:#64748b;margin-bottom:16px">Content quality 1–5 (5 = target content fully present, agent-ready). Scored per category criteria.</p>
    ${qualityTable}
  </div>

  <div class="section">
    <h2 id="agent-friendliness">4. Agent-Friendliness</h2>
    <p style="color:#64748b;margin-bottom:16px">5-point checklist: agent_instruction, structured errors, status field, chainable output, low boilerplate.</p>
    ${afTable}
  </div>

  <div class="section">
    <h2 id="deep-dives">5. Per-Category Deep Dives</h2>
    ${deepDives}
  </div>

  <div class="section">
    <h2 id="cost">6. Cost Efficiency</h2>
    <table class="data-table">
      <thead><tr><th>Competitor</th><th>Calls Completed</th><th>Credit Status</th></tr></thead>
      <tbody>${costSection}</tbody>
    </table>
  </div>

  <div class="section">
    <h2 id="gaps">7. Gaps &amp; Advantages</h2>
    <h3 style="margin:16px 0 8px;color:#16a34a">Where Novada Wins</h3>
    <ul style="padding-left:20px;line-height:2">${advantages || "<li>No clear wins recorded — check data.</li>"}</ul>
    <h3 style="margin:16px 0 8px;color:#dc2626">Where Novada Trails</h3>
    <ul style="padding-left:20px;line-height:2">${disadvantages || "<li>No trailing categories recorded.</li>"}</ul>
    <div class="note">
      <strong>Recommendations for Novada team:</strong>
      T3/T4 SERP latency is high due to async polling — consider synchronous search API.
      Agent-friendliness: add agent_instruction fields to success responses (not just errors).
      T5 crawl: expose a dedicated REST crawl endpoint instead of MCP-only.
    </div>
  </div>

  <div class="section">
    <h2 id="raw">8. Raw Data</h2>
    <details>
      <summary>Click to expand full JSON results (${Object.values(allResults).flat().length} records)</summary>
      <pre>${rawData.slice(0, 500000)}</pre>
    </details>
  </div>
</main>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

(async () => {
  try {
    await runBenchmark();
    const summary = aggregate();
    const html = generateReport(summary);
    const reportPath = resolve(OUT_DIR, "report.html");
    writeFileSync(reportPath, html);
    console.log(`\nBENCHMARK COMPLETE: file://${reportPath}`);
  } catch (err) {
    console.error("Fatal benchmark error:", err);
    process.exit(1);
  }
})();
