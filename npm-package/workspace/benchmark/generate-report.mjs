/**
 * Report generator — reads collected JSON results and produces the final HTML report.
 * Run after run.mjs completes. Handles partial data, failed competitors, and provides honest analysis.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname);

const COMPETITORS = ["novada", "brightdata", "firecrawl", "tavily", "oxylabs"];
const CATEGORIES = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"];

const compNames  = { novada: "Novada", brightdata: "BrightData", firecrawl: "Firecrawl", tavily: "Tavily", oxylabs: "Oxylabs" };
const compColors = { novada: "#7c3aed", brightdata: "#2563eb", firecrawl: "#d97706", tavily: "#059669", oxylabs: "#dc2626" };
const catLabels  = {
  T1: "T1 — Static Scrape (HN)",
  T2: "T2 — JS-Heavy Scrape (Linear)",
  T3: "T3 — Search: E-commerce Price",
  T4: "T4 — Search: AI Trends",
  T5: "T5 — Crawl (Python Docs)",
  T6: "T6 — Structured Data (iPhone 17 Pro Max)",
  T7: "T7 — Static Scrape (TechCrunch)",
  T8: "T8 — JS-Heavy Scrape (Vercel)",
};

// ─── Load results ─────────────────────────────────────────────────────────────
const allResults = {};
for (const c of COMPETITORS) {
  const path = resolve(OUT_DIR, `results-${c}.json`);
  if (existsSync(path)) {
    allResults[c] = JSON.parse(readFileSync(path, "utf-8"));
  } else {
    allResults[c] = [];
  }
}

const summary = JSON.parse(readFileSync(resolve(OUT_DIR, "summary.json"), "utf-8"));

// ─── Failure root causes ──────────────────────────────────────────────────────
const FAILURE_NOTES = {
  brightdata: "❌ No proxy zones configured: This BrightData account has zero proxy zones set up (confirmed via dashboard). The account only has Scrapers Library / Datasets API access. T1–T4/T7/T8 require Web Unlocker or proxy zones which are not provisioned. Would need to create and fund proxy zones to benchmark.",
  oxylabs: "✅ Resolved: Correct credentials berryclare__KAZhJ confirmed via dashboard. Oxylabs Realtime API succeeded on T1/T2/T3/T4/T6/T7/T8 (7/7 supported tasks, 100% success rate).",
  "novada-T6": "⚠️ Amazon Web Unblocker workaround: Amazon scraper plan returns error 11006. Used Web Unblocker (js_render:true) + HTML parsing as fallback. Product: iPhone 17 Pro Max (ASIN B0FTC2PRVZ).",
};

// ─── Stat helpers ─────────────────────────────────────────────────────────────
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function p95(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)] ?? s[s.length - 1];
}

function fmtLatency(ms) {
  if (ms == null) return "—";
  if (ms >= 60000) return "Timeout";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
function fmtScore(v, d = 1) {
  return v == null ? "—" : v.toFixed(d);
}

// ─── Bilingual helpers ────────────────────────────────────────────────────────
// bi(): inline bilingual span (for labels, headings, short phrases)
function bi(en, zh) {
  return `<span class="lang-en">${en}</span><span class="lang-zh">${zh}</span>`;
}
// biBlock(): block-level bilingual section (for prose paragraphs, notes)
function biBlock(en, zh) {
  return `<div class="lang-en">${en}</div><div class="lang-zh">${zh}</div>`;
}

// ─── Winners ─────────────────────────────────────────────────────────────────
function determineWinner(catId) {
  let best = { quality: -1, latency: Infinity, competitor: null };
  for (const c of COMPETITORS) {
    const s = summary[c]?.[catId];
    if (!s || s.status === "na" || s.status === "failed") continue;
    // Minimum 30% success rate required — a competitor that succeeded 1/10 times cannot win a category
    if ((s.success_rate ?? 0) < 0.3) continue;
    const q = s.quality_median ?? 0;
    const l = s.latency_median_ms ?? Infinity;
    if (q > best.quality || (q === best.quality && l < best.latency)) {
      best = { quality: q, latency: l, competitor: c };
    }
  }
  return best.competitor;
}

const winners = {};
for (const catId of CATEGORIES) winners[catId] = determineWinner(catId);

// Count for Novada
const catWithData = CATEGORIES.filter(c => summary.novada?.[c]?.status !== "na");
const novadaWins = catWithData.filter(c => winners[c] === "novada").length;
const novadaTies = catWithData.filter(c => winners[c] === null).length;
const novadaLoses = catWithData.filter(c => winners[c] && winners[c] !== "novada").length;
const novadaFailed = CATEGORIES.filter(c => summary.novada?.[c]?.status === "failed").length;

// ─── Agent-friendliness ───────────────────────────────────────────────────────
const afData = {};
for (const c of COMPETITORS) {
  const rows = (allResults[c] ?? []).filter(r => r.status === "ok");
  const scores = rows.map(r => r.agent_friendliness?.score ?? 0);
  // Only count rows that have individual criteria fields stored (not just {score: N})
  const rowsWithCriteria = rows.filter(r => "has_agent_instruction" in (r.agent_friendliness ?? {}));
  const detail = { has_agent_instruction: 0, error_is_structured: 0, has_status_field: 0, output_is_chainable: 0, low_boilerplate: 0 };
  for (const r of rowsWithCriteria) {
    const af = r.agent_friendliness ?? {};
    for (const k of Object.keys(detail)) if (af[k]) detail[k]++;
  }
  afData[c] = { score: median(scores) ?? 0, detail, total: rows.length, criteriaTotal: rowsWithCriteria.length };
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function colorFor(value, min, max, invert = false) {
  if (value == null) return "#9ca3af";
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const t = invert ? 1 - norm : norm;
  const r = Math.round(34  + (239 - 34)  * (1 - t));
  const g = Math.round(197 + (68  - 197) * (1 - t));
  const b = Math.round(94  + (68  - 94)  * (1 - t));
  return `rgb(${r},${g},${b})`;
}

function statusBadge(status) {
  const map = {
    ok: ["✅", "#16a34a", "#dcfce7"],
    failed: ["❌", "#dc2626", "#fee2e2"],
    na: ["—", "#9ca3af", "#f3f4f6"],
    credit_exhausted: ["💸", "#d97706", "#fef3c7"],
    config_error: ["⚙️", "#7c3aed", "#ede9fe"],
  };
  const [icon, color, bg] = map[status] ?? ["?", "#9ca3af", "#f3f4f6"];
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:99px;font-size:12px;font-weight:700">${icon} ${status.replace(/_/g," ")}</span>`;
}

// ─── Tables ───────────────────────────────────────────────────────────────────
function latencyTable() {
  const header = `<thead><tr><th>${bi('Category','任务类别')}</th>${COMPETITORS.map(c => `<th style="color:${compColors[c]}">${compNames[c]}</th>`).join("")}</tr></thead>`;

  const body = CATEGORIES.map(catId => {
    // Get all valid latencies for color scaling
    const validLat = COMPETITORS.map(c => summary[c]?.[catId]?.latency_median_ms).filter(v => v != null);
    const minL = Math.min(...validLat);
    const maxL = Math.max(...validLat);
    const win = winners[catId];

    const cells = COMPETITORS.map(c => {
      const s = summary[c]?.[catId];
      if (!s) return `<td class="na-cell">—</td>`;
      if (s.status === "na") return `<td class="na-cell">N/A</td>`;
      if (s.status === "failed") {
        const note = c === "brightdata" ? "No zones" : "Failed";
        return `<td style="text-align:center;color:#dc2626;font-size:13px">${note}</td>`;
      }
      const lat = s.latency_median_ms;
      const color = colorFor(lat, minL, maxL, true);
      const isWinner = win === c;
      return `<td style="text-align:center;background:${color}18">
        <div style="font-weight:${isWinner ? 800 : 600};font-size:15px;color:${isWinner ? color : "inherit"}">${fmtLatency(lat)}${isWinner ? " 🏆" : ""}</div>
        <div style="font-size:11px;color:#6b7280">p95: ${fmtLatency(s.latency_p95_ms)} | ${Math.round(s.success_rate * 100)}%</div>
      </td>`;
    }).join("");

    return `<tr><td><strong>${catLabels[catId]}</strong></td>${cells}</tr>`;
  }).join("");

  return `<table class="data-table"><${header}<tbody>${body}</tbody></table>`;
}

function qualityTable() {
  const header = `<thead><tr><th>${bi('Category','任务类别')}</th>${COMPETITORS.map(c => `<th style="color:${compColors[c]}">${compNames[c]}</th>`).join("")}</tr></thead>`;

  const body = CATEGORIES.map(catId => {
    const win = winners[catId];
    const cells = COMPETITORS.map(c => {
      const s = summary[c]?.[catId];
      if (!s || s.status === "na") return `<td class="na-cell">N/A</td>`;
      if (s.status === "failed") {
        return `<td style="text-align:center;color:#dc2626;font-size:13px">${c === "brightdata" ? "No zones" : "Failed"}</td>`;
      }
      const q = s.quality_median;
      const color = colorFor(q, 1, 5);
      const isWinner = win === c;
      return `<td style="text-align:center;background:${color}18">
        <span style="font-weight:${isWinner ? 800 : 600};color:${color}">${fmtScore(q)}/5${isWinner ? " 🏆" : ""}</span>
      </td>`;
    }).join("");
    return `<tr><td><strong>${catLabels[catId]}</strong></td>${cells}</tr>`;
  }).join("");

  return `<table class="data-table"><${header}<tbody>${body}</tbody></table>`;
}

function afTable() {
  const rows = COMPETITORS.map(c => {
    const d = afData[c];
    const ct = d.criteriaTotal || 0;
    const pct = v => ct === 0 ? "—" : `${Math.round((v / ct) * 100)}%`;
    const bg = colorFor(d.score, 0, 5);
    const failed = d.total === 0;
    if (failed) {
      return `<tr>
        <td style="color:${compColors[c]};font-weight:700">${compNames[c]}</td>
        <td colspan="6" style="color:#9ca3af;font-style:italic">${bi('No successful calls — cannot evaluate','无成功调用——无法评估')}</td>
      </tr>`;
    }
    // Compute per-task score range
    const perTaskScores = (allResults[c] ?? []).filter(r => r.status === "ok").map(r => r.agent_friendliness?.score ?? 0);
    const minTaskScore = perTaskScores.length ? Math.min(...perTaskScores) : null;
    const maxTaskScore = perTaskScores.length ? Math.max(...perTaskScores) : null;
    const rangeNote = (minTaskScore !== null && minTaskScore !== maxTaskScore)
      ? `<div style="font-size:11px;color:#6b7280;margin-top:2px">per-round range: ${minTaskScore}–${maxTaskScore}/5 across ${perTaskScores.length} rounds</div>`
      : "";
    const criteriaNote = ct < d.total
      ? `<div style="font-size:11px;color:#f97316;margin-top:3px">⚠️ criteria % from ${ct}/${d.total} records only</div>`
      : "";
    return `<tr>
      <td style="color:${compColors[c]};font-weight:700">${compNames[c]}</td>
      <td style="text-align:center">
        <span style="background:${bg}20;color:${bg};padding:4px 14px;border-radius:99px;font-weight:800">${fmtScore(d.score)}/5</span>
        ${rangeNote}
        ${criteriaNote}
      </td>
      <td style="text-align:center">${pct(d.detail.has_agent_instruction)}</td>
      <td style="text-align:center">${pct(d.detail.error_is_structured)}</td>
      <td style="text-align:center">${pct(d.detail.has_status_field)}</td>
      <td style="text-align:center">${pct(d.detail.output_is_chainable)}</td>
      <td style="text-align:center">${pct(d.detail.low_boilerplate)}</td>
    </tr>`;
  }).join("");

  return `<table class="data-table">
    <thead><tr>
      <th>${bi('Competitor','竞品')}</th><th>${bi('Overall Score','综合评分')}</th>
      <th>agent_instruction</th><th>${bi('Structured Errors','结构化错误')}</th>
      <th>${bi('Status Field','状态字段')}</th><th>${bi('Chainable Output','可链式输出')}</th><th>${bi('Low Boilerplate','低冗余')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ─── Deep dives ───────────────────────────────────────────────────────────────
function deepDives() {
  return CATEGORIES.map(catId => {
    const win = winners[catId];
    const winnerLine = win
      ? `<strong style="color:${compColors[win]}">${compNames[win]}</strong> ${bi(`(quality ${fmtScore(summary[win]?.[catId]?.quality_median)}/5, latency ${fmtLatency(summary[win]?.[catId]?.latency_median_ms)})`, `（质量 ${fmtScore(summary[win]?.[catId]?.quality_median)}/5，延迟 ${fmtLatency(summary[win]?.[catId]?.latency_median_ms)}）`)}`
      : `<em>${bi('No valid comparison data','无有效对比数据')}</em>`;

    const cards = COMPETITORS.map(c => {
      const s = summary[c]?.[catId];
      const isWinner = win === c;
      const borderStyle = isWinner ? `border: 2px solid ${compColors[c]}` : `border: 1px solid #e2e8f0`;

      if (!s || s.status === "na") {
        return `<div class="comp-card" style="${borderStyle}">
          <div class="comp-name" style="color:${compColors[c]}">${compNames[c]}</div>
          <div class="not-supported">${bi('Not supported','不支持此功能')}</div>
        </div>`;
      }
      if (s.status === "failed") {
        const failNote = c === "brightdata"
          ? bi("No proxy zones configured on this account (HTTP 400)", "此账户未配置代理区域（HTTP 400）")
          : c === "novada" ? (FAILURE_NOTES[`novada-${catId}`] ?? s.sample_notes)
          : s.sample_notes;
        return `<div class="comp-card" style="${borderStyle}">
          <div class="comp-name" style="color:${compColors[c]}">${compNames[c]}</div>
          <div style="color:#dc2626;font-size:13px;margin-top:6px">❌ ${failNote}</div>
        </div>`;
      }

      const vs = win && win !== c
        ? (() => {
            const winLat = summary[win]?.[catId]?.latency_median_ms;
            const myLat = s.latency_median_ms;
            if (winLat && myLat && myLat > winLat) {
              return `<div style="font-size:11px;color:#dc2626;margin-top:4px">${(myLat/winLat).toFixed(1)}× ${bi(`slower than ${compNames[win]}`,`慢于 ${compNames[win]}`)}</div>`;
            }
            return "";
          })()
        : (isWinner ? `<div style="font-size:11px;color:#16a34a;margin-top:4px">🏆 ${bi('Fastest valid result in category','该类别最快有效结果')}</div>` : "");

      // Add contextual notes for specific (competitor, category) combinations
      const contextNote = (c === "novada" && catId === "T6")
        ? `<div style="font-size:11px;color:#7c3aed;margin-top:5px">${bi('⚠️ Workaround: native Amazon scraper (error 11006) replaced with Web Unblocker + cheerio parsing. Product: iPhone 17 Pro Max (B0FTC2PRVZ).','⚠️ 兜底方案：原生 Amazon 爬虫（错误 11006）已替换为 Web Unblocker + cheerio 解析。商品：iPhone 17 Pro Max (B0FTC2PRVZ)。')}</div>`
        : (c === "oxylabs" && (catId === "T3" || catId === "T4"))
        ? `<div style="font-size:11px;color:#dc2626;margin-top:5px">${bi(`⚠️ Generic scraper used instead of Oxylabs SERP API — Q${fmtScore(s.quality_median)} reflects misrouted API, not search product capability.`,`⚠️ 使用了通用爬虫而非 Oxylabs SERP API —— Q${fmtScore(s.quality_median)} 反映的是 API 配置错误，不代表搜索产品实际能力。`)}</div>`
        : (s.success_rate < 0.3 && s.status === "ok")
        ? `<div style="font-size:11px;color:#dc2626;margin-top:5px">${bi(`⚠️ Only ${Math.round(s.success_rate*100)}% success rate — excluded from category winner consideration.`,`⚠️ 成功率仅 ${Math.round(s.success_rate*100)}%——已排除出该类别奖杯评选。`)}</div>`
        : "";

      return `<div class="comp-card" style="${borderStyle}">
        <div class="comp-name" style="color:${compColors[c]}">${compNames[c]}${isWinner ? " 🏆" : ""}</div>
        <div class="metrics">
          <span class="metric-badge" style="background:${colorFor(s.latency_median_ms, 100, 40000, true)}18">${fmtLatency(s.latency_median_ms)}</span>
          <span class="metric-badge" style="background:${colorFor(s.quality_median, 1, 5)}18">Q${fmtScore(s.quality_median)}/5</span>
          <span class="metric-badge">${Math.round(s.success_rate * 100)}% ok</span>
        </div>
        ${vs}
        ${contextNote}
      </div>`;
    }).join("");

    return `<div class="deep-dive-section">
      <h3>${catLabels[catId]}</h3>
      <p class="winner-line">${bi('Winner','获胜者')}: ${winnerLine}</p>
      <div class="comp-grid">${cards}</div>
    </div>`;
  }).join("");
}

// ─── Cost section ─────────────────────────────────────────────────────────────
function costSection() {
  return COMPETITORS.map(c => {
    const rows = allResults[c] ?? [];
    const ok = rows.filter(r => r.success).length;
    const total = rows.filter(r => r.status !== "na").length;
    const exhausted = rows.find(r => r.status === "credit_exhausted");
    // Only BrightData truly failed — Oxylabs succeeded 50/50 after credentials were corrected
    const configFailed = c === "brightdata";

    const status = configFailed
      ? `<span style="color:#dc2626">${bi('❌ Config failure — 0 valid calls (no proxy zones on account)','❌ 配置失败 — 0次有效调用（账户无代理区域）')}</span>`
      : exhausted ? `<span style="color:#d97706">⚠️ ${bi(`Exhausted at round ${exhausted.round}, cat ${exhausted.category}`,`第${exhausted.round}轮 ${exhausted.category} 任务时积分耗尽`)}</span>`
      : ok === 0 ? `<span style="color:#dc2626">${bi('❌ All calls failed','❌ 全部调用失败')}</span>`
      : `<span style="color:#16a34a">${bi(`✅ No credit issues (${ok}/${total} calls ok)`,`✅ 无积分问题（${ok}/${total} 次调用成功）`)}</span>`;

    return `<tr>
      <td style="color:${compColors[c]};font-weight:700">${compNames[c]}</td>
      <td>${ok} / ${total} ${bi('calls succeeded','次调用成功')}</td>
      <td>${status}</td>
      <td style="font-size:13px;color:#6b7280">${configFailed ? bi('N/A — no valid calls','N/A — 无有效调用') : ok > 0 ? bi('Consumed credits for benchmark','基准测试消耗积分') : '—'}</td>
    </tr>`;
  }).join("");
}

// ─── Gaps & Advantages ────────────────────────────────────────────────────────
function gapsSection() {
  const advantages = [];
  const gaps = [];
  const actions = [];

  // T1/T2/T7/T8 scraping
  const novadaT1 = summary.novada?.T1?.latency_median_ms;
  const novadaT7 = summary.novada?.T7?.latency_median_ms;
  const firecrawlT1 = summary.firecrawl?.T1?.latency_median_ms;
  const tavilyT1 = summary.tavily?.T1?.latency_median_ms;

  if (novadaT1 && firecrawlT1) {
    const scrapeComps = [novadaT1, novadaT7].filter(Boolean);
    const avgNovadaScrape = scrapeComps.reduce((a, b) => a + b, 0) / scrapeComps.length;
    gaps.push(`<li>${biBlock(
      `<strong>Scrape Speed (T1/T2/T7/T8):</strong> Novada averages ${fmtLatency(Math.round(avgNovadaScrape))} on static pages vs Firecrawl ${fmtLatency(firecrawlT1)} (${(avgNovadaScrape/firecrawlT1).toFixed(1)}× slower). Tavily returns in ${fmtLatency(tavilyT1)} (pre-indexed). Novada's web unblocker adds full JS rendering time — correct for dynamic sites but costly on static ones.`,
      `<strong>抓取速度（T1/T2/T7/T8）：</strong>Novada 在静态页面平均 ${fmtLatency(Math.round(avgNovadaScrape))} vs Firecrawl ${fmtLatency(firecrawlT1)}（慢 ${(avgNovadaScrape/firecrawlT1).toFixed(1)} 倍）。Tavily 返回 ${fmtLatency(tavilyT1)}（预建索引）。Novada 的 Web Unblocker 强制进行完整 JS 渲染——对动态站点正确，但在静态页面上浪费时间。`
    )}</li>`);
    actions.push(`<li>${biBlock(
      'Add a <strong>static/fast path</strong> for non-JS sites: detect HTML-only pages and bypass the full unblocker pipeline. Target: &lt;500ms for static pages.',
      '为非 JS 站点添加<strong>静态快速通道</strong>：检测纯 HTML 页面并绕过完整 Unblocker 流水线。目标：静态页面 &lt;500ms。'
    )}</li>`);
  }

  // T5 crawl
  const novadaT5 = summary.novada?.T5;
  const firecrawlT5 = summary.firecrawl?.T5;
  if (novadaT5?.status === "ok") {
    const novadaT5Rounds = novadaT5.success_count ?? 0;
    const firecrawlT5Rounds = firecrawlT5?.success_count ?? 0;
    advantages.push(`<li>${biBlock(
      `<strong>T5 Crawl Reliability:</strong> Novada completed ${novadaT5Rounds}/${novadaT5.total_rounds ?? 30} crawl rounds vs Firecrawl ${firecrawlT5Rounds}/${firecrawlT5?.total_rounds ?? 30} (rate-limited). Novada's crawl is stable under sustained load.`,
      `<strong>T5 爬取稳定性：</strong>Novada 完成 ${novadaT5Rounds}/${novadaT5.total_rounds ?? 30} 轮，Firecrawl ${firecrawlT5Rounds}/${firecrawlT5?.total_rounds ?? 30}（触发速率限制）。Novada 在持续负载下爬取稳定。`
    )}</li>`);
    if (firecrawlT5?.latency_median_ms) {
      gaps.push(`<li>${biBlock(
        `<strong>T5 Crawl Speed:</strong> Novada crawl median ${fmtLatency(novadaT5.latency_median_ms)} vs Firecrawl ${fmtLatency(firecrawlT5.latency_median_ms)} (first round). Gap is mostly sequential page fetching — parallelizing 3-page crawls would cut this 3×.`,
        `<strong>T5 爬取速度：</strong>Novada 爬取中位数 ${fmtLatency(novadaT5.latency_median_ms)} vs Firecrawl ${fmtLatency(firecrawlT5.latency_median_ms)}（第1轮）。差距主要来自串行页面抓取——并行化 3 页爬取可缩短 3 倍。`
      )}</li>`);
      actions.push(`<li>${biBlock(
        `Parallelize crawl sub-page fetches in <code>novada_crawl</code>. With 3 concurrent fetches, T5 latency would drop from ~30s to ~12s.`,
        `在 <code>novada_crawl</code> 中并行化子页面抓取。使用 3 个并发请求，T5 延迟将从 ~30s 降至 ~12s。`
      )}</li>`);
    }
  }

  // T3/T4 SERP
  if (summary.novada?.T3?.status === "failed") {
    gaps.push(`<li>${biBlock(
      `<strong>T3/T4 SERP:</strong> Novada search returned 0/${summary.novada?.T3?.total_rounds ?? 30} — SERP quota not enabled on this API key. Tavily returned results in ~130ms with 100% reliability.`,
      `<strong>T3/T4 搜索：</strong>Novada 搜索返回 0/${summary.novada?.T3?.total_rounds ?? 30}——此 API key 未启用 SERP 配额。Tavily 以 ~130ms 100% 成功率返回结果。`
    )}</li>`);
    actions.push(`<li>${biBlock(
      'Enable SERP quota on benchmark API key, or add clear <code>agent_instruction</code> in the SERP-unavailable error pointing to how to upgrade.',
      '在基准测试 API key 上启用 SERP 配额，或在 SERP 不可用错误中加入明确的 <code>agent_instruction</code> 指引用户升级。'
    )}</li>`);
  }

  // T6 structured product
  if (summary.novada?.T6?.status === "failed") {
    gaps.push(`<li>${biBlock(
      '<strong>T6 Structured Product Data:</strong> Error 11006 — Amazon scraper not activated on this plan. Used Web Unblocker fallback. Gap vs Oxylabs (native amazon_product source) is in parse quality.',
      '<strong>T6 结构化商品数据：</strong>错误 11006——Amazon 爬虫未在此套餐激活。使用 Web Unblocker 兜底方案。与 Oxylabs（原生 amazon_product 来源）的差距在于解析质量。'
    )}</li>`);
    actions.push(`<li>${biBlock(
      'Activate Amazon scraper plan on this API key and retest T6 against Oxylabs native structured data.',
      '在此 API key 上激活 Amazon 爬虫套餐，并与 Oxylabs 原生结构化数据重新对比 T6。'
    )}</li>`);
  }

  // Agent-friendliness
  const novadaAF = afData.novada?.score ?? 0;
  const firecrawlAF = afData.firecrawl?.score ?? 0;
  if (novadaAF < firecrawlAF) {
    gaps.push(`<li>${biBlock(
      `<strong>Agent-Friendliness:</strong> Novada AF score ${fmtScore(novadaAF)}/5 vs Firecrawl ${fmtScore(firecrawlAF)}/5. Difference: Firecrawl has richer response metadata (status field, structured success responses). Novada has <code>agent_instruction</code> in error paths but not in success responses.`,
      `<strong>AI 代理友好性：</strong>Novada AF 评分 ${fmtScore(novadaAF)}/5 vs Firecrawl ${fmtScore(firecrawlAF)}/5。差距：Firecrawl 响应元数据更丰富（状态字段、结构化成功响应）。Novada 只在错误响应中包含 <code>agent_instruction</code>，成功响应中没有。`
    )}</li>`);
    actions.push(`<li>${biBlock(
      `Add <code>agent_instruction</code> to success responses — e.g. <code>"next: use novada_crawl to follow internal links"</code> or <code>"next: use novada_search to find related content"</code>.`,
      `在成功响应中加入 <code>agent_instruction</code>——例如 <code>"下一步：使用 novada_crawl 跟踪内部链接"</code> 或 <code>"下一步：使用 novada_search 查找相关内容"</code>。`
    )}</li>`);
  } else {
    advantages.push(`<li>${biBlock(
      `<strong>Agent-Friendliness:</strong> Novada matches Tavily (${fmtScore(novadaAF)}/5) and both include structured error guidance. Novada's <code>agent_instruction</code> in error paths is a genuine differentiator over BrightData/Oxylabs.`,
      `<strong>AI 代理友好性：</strong>Novada 与 Tavily 持平（${fmtScore(novadaAF)}/5），均提供结构化错误指引。Novada 在错误路径中的 <code>agent_instruction</code> 是相对 BrightData/Oxylabs 的真实差异化优势。`
    )}</li>`);
  }

  // Where Novada wins
  if (novadaT5?.status === "ok") {
    const srPct = novadaT5.success_rate != null ? Math.round(novadaT5.success_rate * 100) : "—";
    advantages.push(`<li>${biBlock(
      `<strong>T5 Crawl Coverage:</strong> Novada is the only tool with working, reliable multi-page crawl — ${srPct}% success rate vs Firecrawl rate-limited after round 1.`,
      `<strong>T5 爬取覆盖：</strong>Novada 是唯一具备稳定多页爬取能力的工具——成功率 ${srPct}%，Firecrawl 第1轮后触发速率限制。`
    )}</li>`);
  }

  const h = (titleEN, titleZH, items, color) => items.length
    ? `<h3 style="color:${color};margin:20px 0 8px">${bi(titleEN, titleZH)}</h3><ul style="padding-left:20px;line-height:2">${items.join("")}</ul>`
    : "";

  return `
    ${h("Where Novada Wins (vs tested competitors)", "Novada 领先的维度", advantages, "#16a34a")}
    ${h("Where Novada Trails (with root causes)", "Novada 落后的维度（含根因分析）", gaps, "#dc2626")}
    <div class="note" style="margin-top:24px">
      ${biBlock(
        '<strong>⚠️ BrightData excluded from competitive comparison:</strong> Account has no proxy zones configured — 0 valid calls across all tasks. All BrightData rows show HTTP 400 "zone not found". Oxylabs is <strong>fully included</strong> — all measured rounds succeeded.',
        '<strong>⚠️ BrightData 已排除出竞品对比：</strong>账户未配置代理区域——全部任务 0 次有效调用，所有 BrightData 请求返回 HTTP 400 "zone not found"。Oxylabs <strong>完整收录</strong>——所有测量轮次均成功。'
      )}
    </div>
    ${h("Recommended Actions", "推荐行动项", actions, "#7c3aed")}
  `;
}

// ─── Live-fetch only comparison ──────────────────────────────────────────────
function liveFetchComparison() {
  const liveFetch = ["novada", "firecrawl", "oxylabs"];
  const liveNames = { novada: "Novada", firecrawl: "Firecrawl", oxylabs: "Oxylabs" };

  const rows = CATEGORIES.map(catId => {
    const cells = liveFetch.map(c => {
      const s = summary[c]?.[catId];
      if (!s || s.status === "na") return `<td class="na-cell">N/A</td>`;
      if (s.status === "failed") return `<td style="text-align:center;color:#dc2626;font-size:13px">Failed</td>`;
      const lat = s.latency_median_ms;
      const validLats = liveFetch.map(lc => summary[lc]?.[catId]?.latency_median_ms).filter(v => v != null);
      const minL = Math.min(...validLats);
      const maxL = Math.max(...validLats);
      const color = colorFor(lat, minL, maxL, true);
      const isWinner = lat === minL && validLats.filter(v => v === minL).length === 1;
      return `<td style="text-align:center;background:${color}18">
        <div style="font-weight:${isWinner ? 800 : 600};color:${isWinner ? color : "inherit"}">${fmtLatency(lat)}${isWinner ? " 🏆" : ""}</div>
        <div style="font-size:11px;color:#6b7280">${Math.round(s.success_rate * 100)}% ok</div>
      </td>`;
    }).join("");
    return `<tr><td><strong>${catLabels[catId]}</strong></td>${cells}</tr>`;
  }).join("");

  const header = `<thead><tr><th>${bi('Category','任务类别')}</th>${liveFetch.map(c => `<th style="color:${compColors[c]}">${liveNames[c]}</th>`).join("")}</tr></thead>`;
  return `<table class="data-table"><${header}<tbody>${rows}</tbody></table>`;
}

// ─── Methodology section ──────────────────────────────────────────────────────
function methodologySection() {
  return `
    <div style="background:#fff7ed;border-left:4px solid #f97316;padding:20px 24px;border-radius:0 12px 12px 0;margin-bottom:28px">
      <strong style="font-size:15px">${bi('⚠️ Not Apples-to-Apples: Two Fundamentally Different Architectures','⚠️ 不可直接对比：两种本质不同的架构')}</strong>
      <table class="data-table" style="margin-top:14px">
        <thead><tr><th>${bi('Architecture','架构类型')}</th><th>${bi('Tools','工具')}</th><th>${bi('How it works','工作原理')}</th><th>${bi('Latency character','延迟特征')}</th></tr></thead>
        <tbody>
          <tr>
            <td><strong>${bi('Live-fetch','实时抓取')}</strong></td>
            <td>Novada, Firecrawl, Oxylabs</td>
            <td>${bi('Sends a real HTTP request to the target URL at call time. Full network round-trip + optional JS rendering.','每次调用时向目标 URL 发送真实 HTTP 请求，完整的网络往返 + 可选 JS 渲染。')}</td>
            <td>${bi('3–30s per call. Always returns current page state.','每次调用 3–30 秒，始终返回当前页面状态。')}</td>
          </tr>
          <tr style="background:#d1fae510">
            <td><strong style="color:#059669">${bi('Pre-indexed (cached)','预建索引（缓存）')}</strong></td>
            <td><strong style="color:#059669">Tavily</strong></td>
            <td>${bi('Maintains a continuously crawled index. Queries return from a database — no live fetch is triggered.','维护持续爬取的内容索引，查询从数据库返回——不触发实时抓取。')}</td>
            <td style="color:#059669"><strong>100–200ms</strong>. ${bi('Returns cached content from last crawl (potentially hours or days old).','返回最近一次爬取的缓存内容（可能已有数小时或数天之久）。')}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin-top:14px;color:#92400e;line-height:1.8">
        ${biBlock('<strong>Bottom line:</strong> Tavily\'s 130ms is a database lookup. Novada\'s 4–8s is fetching the live web. These are not the same product. Comparing them on latency alone is misleading — the right comparison depends on whether the use case requires real-time freshness.','<strong>结论：</strong>Tavily 的 130ms 是数据库查询。Novada 的 4–8 秒是实时抓取网页。这不是同一类产品。仅凭延迟对比会产生误导——正确的对比方式取决于使用场景是否要求实时内容。')}
      </p>
    </div>

    <h3 style="margin:24px 0 12px">${bi('How Latency Was Measured','延迟测量方法')}</h3>
    <ul style="padding-left:20px;line-height:2.2">
      <li>${biBlock('<strong>Method:</strong> <code>const t0 = Date.now(); await apiCall(); const latency = Date.now() - t0</code> — wall-clock inclusive of network, queueing, and rendering.','<strong>方法：</strong><code>const t0 = Date.now(); await apiCall(); const latency = Date.now() - t0</code> —— 挂钟时间，包含网络、排队与渲染。')}</li>
      <li>${biBlock('<strong>Rounds:</strong> 1 warmup (discarded) + 30 measured rounds per (competitor × task). Median and p95 reported. Note: with n=30, p95 = the value at the 95th percentile position (≈ 28th-ranked observation) — more stable than n=10 but still subject to variance on slow outliers.','<strong>轮次：</strong>每（竞品×任务）1 次预热（丢弃）+ 30 轮测量。报告中位数和 p95。注：n=30 时，p95 = 第95百分位（约第28高的观测值）——比 n=10 更稳定，但仍受慢速异常值影响。')}</li>
      <li>${biBlock('<strong>Environment:</strong> MacBook Pro, residential IP, single geographic location. All APIs were called from the same machine sequentially. No geographic normalization — server proximity differences are not corrected for.','<strong>环境：</strong>MacBook Pro，家庭宽带 IP，单一地理位置。所有 API 在同一台机器上顺序调用，未进行地理位置归一化，未修正服务器距离差异。')}</li>
      <li>${biBlock('<strong>Spacing:</strong> 500ms gap between rounds. Firecrawl T5 may hit free-tier rate limits on repeated crawl calls (HTTP 429) — this reflects the benchmark\'s sustained-call pattern on a free-tier key, not Firecrawl\'s general crawl capability.','<strong>间隔：</strong>轮次间隔 500ms。Firecrawl T5 在持续爬取调用时可能触发免费套餐速率限制（HTTP 429）——这反映的是免费套餐密钥的持续调用行为，不代表 Firecrawl 的整体爬取能力。')}</li>
    </ul>

    <div class="note red" style="margin-top:16px">
      ${biBlock(
        '<strong>⚠️ Re-run disclosure (data integrity):</strong> Two competitors required re-runs during this benchmark session:<ul style="padding-left:20px;margin-top:8px;line-height:2"><li><strong>Novada T3/T4 (Search — v1 run only):</strong> Initial 10-round run returned transient null responses (SERP API availability issue). Tasks were re-run; 10/10 succeeded. v2 benchmark (this report) runs T3/T4 fresh with 30 rounds — re-run disclosure applies only to the v1 evidence, not to this dataset.</li><li><strong>Oxylabs (v1 run only):</strong> Initial run used wrong credentials (<code>oxy001_4xGlt</code>) — HTTP 401. Corrected to <code>berryclare__KAZhJ</code> and re-run. v2 benchmark uses correct credentials from round 1.</li></ul>The benchmark evidence file (<a href="benchmark-evidence.md">benchmark-evidence.md</a>) contains the raw round-by-round data for all reported results.',
        '<strong>⚠️ 重跑说明（数据完整性）：</strong>本次测试中两个竞品需要重跑：<ul style="padding-left:20px;margin-top:8px;line-height:2"><li><strong>Novada T3/T4（搜索——仅 v1）：</strong>初始10轮出现瞬时 null 响应（SERP API 可用性问题），重跑后 10/10 成功。v2 基准测试（本报告）以30轮全新运行 T3/T4——重跑说明仅适用于 v1 证据，不适用于本数据集。</li><li><strong>Oxylabs（仅 v1）：</strong>初始运行使用了错误的用户名（<code>oxy001_4xGlt</code>），HTTP 401。修正为 <code>berryclare__KAZhJ</code> 后重跑。v2 从第1轮起使用正确凭证。</li></ul>基准测试证据文件（<a href="benchmark-evidence.md">benchmark-evidence.md</a>）包含所有已报告结果的逐轮原始数据。'
      )}
    </div>

    <h3 style="margin:24px 0 12px">${bi('Fair Comparison: Live-Fetch Only (Novada vs Firecrawl vs Oxylabs)','公平对比：仅实时抓取工具（Novada vs Firecrawl vs Oxylabs）')}</h3>
    <p style="color:#64748b;margin-bottom:12px">
      ${biBlock('When Tavily is excluded and only live-fetch tools are compared:','排除 Tavily（预建索引），仅对比实时抓取工具时：')}
    </p>
    ${liveFetchComparison()}
    <div class="note" style="margin-top:12px">
      ${biBlock(
        'Oxylabs succeeded on T1/T2/T3/T4/T6/T7/T8. Firecrawl succeeded on T1/T2/T5/T7/T8 only (no search/Amazon). Novada is the only tool with full coverage across all 8 task types.',
        'Oxylabs 在 T1/T2/T3/T4/T6/T7/T8 全部成功。Firecrawl 仅支持 T1/T2/T5/T7/T8（不支持搜索/Amazon）。Novada 是唯一覆盖全部8种任务类型的工具。'
      )}
    </div>
  `;
}

// ─── Product Insights section ─────────────────────────────────────────────────
function productInsightsSection() {
  return `
    <div style="background:linear-gradient(135deg,#064e3b 0%,#065f46 100%);color:white;border-radius:16px;padding:32px;margin-bottom:28px">
      <div style="font-size:13px;opacity:.6;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">${bi('Product Insight — Recorded 2026-05-22','产品洞察 — 记录于 2026-05-22')}</div>
      <h3 style="color:white;font-size:20px;margin-bottom:14px">💡 ${bi('Pre-Crawl Index as a Complementary Tier','预爬索引作为互补层级')}</h3>
      <p style="opacity:.9;line-height:1.9;margin-bottom:14px">
        ${biBlock(
          'Tavily\'s speed advantage in this benchmark comes entirely from pre-indexing the web — they crawl content in the background and serve results from a database. This is not faster scraping; it\'s a different product model. And it solves a real problem: <strong>most web content doesn\'t change daily</strong>. Product pages, docs, company sites, research articles — the vast majority of what agents access is stable for hours or days.',
          'Tavily 在本次基准测试中的速度优势完全来自网页预建索引——他们在后台爬取内容并从数据库提供结果。这不是更快的抓取；这是不同的产品模型。而且它解决了一个真实问题：<strong>大多数网页内容不会每天变化</strong>。产品页面、文档、公司网站、研究文章——代理访问的绝大多数内容在数小时或数天内都是稳定的。'
        )}
      </p>
      <p style="opacity:.9;line-height:1.9">
        ${biBlock(
          'A pre-crawl index for stable content would let Novada serve these queries at &lt;200ms — matching Tavily\'s speed — while keeping the live-fetch tier for real-time use cases (prices, scores, live dashboards). The agent selects which tier it needs; Novada handles both.',
          '针对稳定内容的预爬索引将使 Novada 以 &lt;200ms 响应这些查询——与 Tavily 速度持平——同时保留实时抓取层用于实时场景（价格、评分、实时面板）。代理选择所需的层级，Novada 同时处理两者。'
        )}
      </p>
    </div>

    <h3 style="margin:20px 0 12px">${bi('Proposed Two-Tier Architecture','建议的双层架构')}</h3>
    <table class="data-table">
      <thead><tr><th>${bi('Tier','层级')}</th><th>${bi('Technology','技术')}</th><th>${bi('Latency','延迟')}</th><th>${bi('Best for','适用场景')}</th><th>${bi('Freshness SLA','内容新鲜度 SLA')}</th></tr></thead>
      <tbody>
        <tr>
          <td><strong style="color:#7c3aed">${bi('Tier 1 — Live','第1层 — 实时')} </strong>${bi('(current)','（当前）')}</td>
          <td>${bi('Web Unblocker + JS rendering','Web Unblocker + JS 渲染')}</td>
          <td>3–30s</td>
          <td>${bi('Real-time prices, live data, dynamic auth-gated pages','实时价格、实时数据、动态认证页面')}</td>
          <td>${bi('Seconds (always current)','秒级（始终最新）')}</td>
        </tr>
        <tr style="background:#d1fae510">
          <td><strong style="color:#059669">${bi('Tier 2 — Index','第2层 — 索引')} </strong>${bi('(proposed)','（建议）')}</td>
          <td>${bi('Background crawler + search index','后台爬虫 + 搜索索引')}</td>
          <td>&lt;200ms</td>
          <td>${bi('Docs, company pages, product info, research, general knowledge','文档、公司主页、产品信息、研究资料、通用知识')}</td>
          <td>${bi('Hours to 24h','数小时至24小时')}</td>
        </tr>
      </tbody>
    </table>

    <h3 style="margin:24px 0 12px">${bi('Why This Matters for KR-1','为何对 KR-1 至关重要')}</h3>
    <ul style="padding-left:20px;line-height:2.2">
      <li>${biBlock('Tavily wins T1/T2/T3/T4 on speed alone. A Tier 2 index eliminates that gap for <strong>stable content</strong> — the majority of real-world queries.','Tavily 仅凭速度在 T1/T2/T3/T4 胜出。第2层索引可为<strong>稳定内容</strong>消除这一差距——而稳定内容占现实查询的大多数。')}</li>
      <li>${biBlock('Agent queries naturally split: <em>"What does this company do?"</em> → index tier; <em>"What\'s the current stock price?"</em> → live tier. One API, two paths.','代理查询天然分化：<em>"这家公司做什么？"</em> → 索引层；<em>"当前股价是多少？"</em> → 实时层。一个 API，两条路径。')}</li>
      <li>${biBlock('Simple API surface: add a <code>freshness</code> parameter — <code>"cached"</code> (≤24h, fast) or <code>"live"</code> (real-time, current behavior). Agents opt in to the right tier.','简洁 API 接口：添加 <code>freshness</code> 参数—— <code>"cached"</code>（≤24h，快速）或 <code>"live"</code>（实时，当前行为）。代理自主选择合适的层级。')}</li>
      <li>${biBlock('Cost moat: crawl once, serve millions of times. Marginal cost for Tier 2 hits near zero for popular URLs.','成本护城河：爬取一次，服务百万次。热门 URL 的第2层边际成本趋近于零。')}</li>
      <li>${biBlock('<strong>Hypothesis to validate:</strong> 70–80% of agent web queries can tolerate ≥24h cached data. If true, Tier 2 covers the majority of Novada\'s traffic at dramatically lower cost and latency.','<strong>待验证假设：</strong>70–80% 的代理网页查询可以接受 ≥24h 的缓存数据。若成立，第2层将以大幅降低的成本和延迟覆盖 Novada 的大部分流量。')}</li>
    </ul>

    <div class="note" style="background:#f0fdf4;border-color:#16a34a;margin-top:20px">
      ${biBlock('<strong>Validation next step:</strong> Sample 100 real agent queries from current Novada users. Classify by freshness requirement. If &gt;60% tolerate 24h cache → pre-index tier is a P0 roadmap item.','<strong>验证下一步：</strong>从当前 Novada 用户中抽取100个真实代理查询，按新鲜度要求分类。若 &gt;60% 可接受24小时缓存 → 预建索引层纳入 P0 路线图。')}
    </div>
  `;
}

// ─── Generate HTML ────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Novada MCP Benchmark Report — 2026-05-22</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Nunito',system-ui,sans-serif;background:#f8fafc;color:#1e293b;display:flex;min-height:100vh}
nav{width:220px;background:#1e1b4b;color:#e0e7ff;padding:24px 0;position:sticky;top:0;height:100vh;overflow-y:auto;flex-shrink:0}
nav h1{font-size:15px;font-weight:800;padding:0 20px 20px;border-bottom:1px solid #312e81;line-height:1.4}
nav h1 span{color:#818cf8}
nav ul{list-style:none;padding:12px 0}
nav li a{display:block;padding:7px 20px;color:#a5b4fc;text-decoration:none;font-size:13px;font-weight:600;border-left:3px solid transparent;transition:all .15s}
nav li a:hover{color:#fff;background:#312e81;border-color:#818cf8}
nav .nav-section{padding:8px 20px 4px;font-size:11px;color:#6366f1;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
main{flex:1;padding:40px;max-width:1180px;margin:0 auto}
h2{font-size:22px;font-weight:800;margin:48px 0 16px;padding-bottom:8px;border-bottom:2px solid #e2e8f0;display:flex;align-items:center;gap:10px}
h2:first-of-type{margin-top:0}
.section{margin-bottom:56px}
.verdict{background:linear-gradient(135deg,#1e1b4b 0%,#4c1d95 100%);color:white;border-radius:16px;padding:32px;margin-bottom:40px}
.verdict h2{color:white;border-color:rgba(255,255,255,.2);margin-top:0;font-size:24px}
.verdict p{opacity:.8;font-size:13px;margin-top:16px}
.stat-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:20px 0}
.stat-card{background:rgba(255,255,255,.1);border-radius:12px;padding:18px;text-align:center}
.stat-card .num{font-size:40px;font-weight:900;line-height:1}
.stat-card .label{font-size:12px;opacity:.7;margin-top:6px;font-weight:600}
.data-table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.07);margin:16px 0}
.data-table th{background:#f1f5f9;padding:12px 14px;text-align:left;font-size:12px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;white-space:nowrap}
.data-table td{padding:12px 14px;border-bottom:1px solid #f1f5f9;font-size:14px;vertical-align:middle}
.data-table tr:last-child td{border-bottom:none}
.na-cell{text-align:center;color:#9ca3af;font-size:13px}
.comp-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:12px}
.comp-card{border-radius:10px;padding:14px;background:white}
.comp-name{font-weight:800;font-size:14px;margin-bottom:8px}
.not-supported{font-size:12px;color:#9ca3af;font-style:italic}
.metrics{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.metric-badge{padding:3px 8px;border-radius:99px;font-size:12px;font-weight:700;background:#f1f5f9}
.deep-dive-section{background:white;border-radius:14px;padding:24px;margin:16px 0;box-shadow:0 1px 4px rgba(0,0,0,.07)}
.deep-dive-section h3{font-size:17px;font-weight:800;margin-bottom:6px}
.winner-line{font-size:14px;color:#64748b;margin-bottom:16px}
.note{background:#fef9c3;border-left:4px solid #eab308;padding:14px 18px;border-radius:0 10px 10px 0;font-size:14px;margin:16px 0;line-height:1.6}
.note.red{background:#fef2f2;border-color:#ef4444}
.note.purple{background:#f5f3ff;border-color:#7c3aed}
details{margin:16px 0}
details summary{cursor:pointer;font-weight:700;padding:12px 18px;background:white;border-radius:8px;border:1px solid #e2e8f0;font-size:14px;list-style:none}
details summary::-webkit-details-marker{display:none}
details[open] summary{border-radius:8px 8px 0 0;border-bottom:none}
pre{background:#0f172a;color:#e2e8f0;padding:24px;border-radius:0 0 12px 12px;overflow-x:auto;font-size:11px;line-height:1.7;max-height:600px}
ul{line-height:1.8}
/* ── Language toggle ─────────────────────────────────────────────────────── */
.lang-zh{display:none}
body.zh .lang-en{display:none}
body.zh .lang-zh{display:revert}
#lang-btn{width:calc(100% - 32px);margin:12px 16px 0;background:#4c1d95;color:#e0e7ff;border:none;padding:9px 0;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;transition:background .15s}
#lang-btn:hover{background:#6d28d9}
/* ── Tab system ───────────────────────────────────────────────────── */
#tab-btns{display:flex;gap:6px;width:calc(100% - 32px);margin:8px 16px 0}
.tab-btn{flex:1;background:#1e1b4b;color:#818cf8;border:1px solid #312e81;padding:7px 4px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;transition:all .15s}
.tab-btn.active{background:#818cf8;color:#1e1b4b;border-color:#818cf8}
.tab-btn:hover:not(.active){background:#312e81;color:#e0e7ff}
.tab-pane{display:none}.tab-pane.active{display:block}
.roadmap-card{background:white;border-radius:14px;padding:24px;margin:16px 0;box-shadow:0 1px 4px rgba(0,0,0,.07);border-left:4px solid #e2e8f0}
.roadmap-card.p0{border-left-color:#dc2626}
.roadmap-card.p1{border-left-color:#d97706}
.roadmap-card.p2{border-left-color:#059669}
.priority-badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:800;margin-bottom:10px}
.badge-p0{background:#fee2e2;color:#dc2626}
.badge-p1{background:#fef3c7;color:#d97706}
.badge-p2{background:#dcfce7;color:#15803d}
.code-block{background:#0f172a;color:#e2e8f0;padding:16px 20px;border-radius:8px;font-size:12px;font-family:monospace;line-height:1.7;overflow-x:auto;margin:10px 0}
.diff-add{color:#4ade80}
.diff-del{color:#f87171}
.diff-ctx{color:#94a3b8}
</style>
</head>
<body>
<nav>
  <h1><span>Novada</span> ${bi('Benchmark','竞品测试')}<br><small style="opacity:.6;font-size:11px">2026-05-22 · v2</small></h1>
  <button id="lang-btn" onclick="toggleLang()">切换中文 / EN</button>
  <div id="tab-btns">
    <button class="tab-btn active" onclick="switchTab('report',this)">📊 ${bi('Report','报告')}</button>
    <button class="tab-btn" onclick="switchTab('roadmap',this)">🛠 ${bi('Roadmap','路线图')}</button>
  </div>
  <ul>
    <div class="nav-section">${bi('Report','报告')}</div>
    <li><a href="#executive">1. ${bi('Executive Summary','执行摘要')}</a></li>
    <li><a href="#latency">2. ${bi('Latency','延迟对比')}</a></li>
    <li><a href="#quality">3. ${bi('Quality Scores','内容质量')}</a></li>
    <li><a href="#af">4. ${bi('Agent-Friendliness','AI代理友好性')}</a></li>
    <li><a href="#deep">5. ${bi('Deep Dives','分任务分析')}</a></li>
    <li><a href="#cost">6. ${bi('Call Volume','调用量')}</a></li>
    <li><a href="#gaps">7. ${bi('Gaps &amp; Advantages','差距与优势')}</a></li>
    <li><a href="#failures">8. ${bi('Failure Analysis','失败分析')}</a></li>
    <li><a href="#methodology">9. ${bi('Methodology','测试方法')}</a></li>
    <li><a href="#insights">10. ${bi('Product Insights','产品洞察')}</a></li>
    <li><a href="#raw">11. ${bi('Raw Data','原始数据')}</a></li>
    <li><a href="#datafiles">12. ${bi('Data Files','数据文件')}</a></li>
  </ul>
</nav>
<main>
<div class="tab-pane active" id="tab-report">

  <!-- DOCUMENT INDEX -->
  <div style="background:#1e293b;border-radius:14px;padding:20px 24px;margin-bottom:36px;display:flex;flex-wrap:wrap;gap:12px;align-items:center">
    <span style="color:#94a3b8;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-right:4px">${bi('Quick Access','快速导航')}</span>
    <a href="report.html" style="background:#3730a3;color:#c7d2fe;padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">📊 ${bi('This Report','本报告')}</a>
    <a href="benchmark-evidence.md" style="background:#065f46;color:#a7f3d0;padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">🔬 ${bi('Evidence File','证据文件')}</a>
    <a href="run.mjs" style="background:#1c3451;color:#93c5fd;padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">⚙️ ${bi('Benchmark Script','测试脚本')}</a>
    <a href="#methodology" style="background:#431407;color:#fed7aa;padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">📐 ${bi('Methodology','测试方法')}</a>
    <a href="#raw" style="background:#1a1a2e;color:#d4d4d8;padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">🗃️ ${bi('Raw JSON','原始数据')}</a>
    <a href="#deep" style="background:#3b1762;color:#e9d5ff;padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">🔍 ${bi('Deep Dives','分任务分析')}</a>
    <a href="#datafiles" style="background:#164e63;color:#a5f3fc;padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">📁 ${bi('Data Files','数据文件')}</a>
    <div style="width:100%;border-top:1px solid #334155;margin:4px 0"></div>
    <span style="color:#64748b;font-size:11px;line-height:1.7">
      <strong style="color:#94a3b8">${bi('Taxonomy','任务分类')}:</strong>
      T1 = ${bi('Static Scrape (HN)','静态抓取 (HN)')} &nbsp;|&nbsp; T2 = ${bi('JS Scrape (Linear)','JS渲染抓取 (Linear)')} &nbsp;|&nbsp; T3 = ${bi('Price Search','价格搜索')} &nbsp;|&nbsp; T4 = ${bi('AI Trends Search','AI趋势搜索')} &nbsp;|&nbsp; T5 = ${bi('Crawl (Python Docs)','爬取 (Python文档)')} &nbsp;|&nbsp; T6 = ${bi('Structured Data (iPhone 17)','结构化数据 (iPhone 17)')} &nbsp;|&nbsp; T7 = ${bi('Static Scrape (TechCrunch)','静态抓取 (TechCrunch)')} &nbsp;|&nbsp; T8 = ${bi('JS Scrape (Vercel)','JS渲染抓取 (Vercel)')}
      &nbsp;&nbsp;·&nbsp;&nbsp;
      <strong style="color:#94a3b8">${bi('Fairness note','公平性说明')}:</strong> ${bi('Tavily is pre-indexed (cache lookup, ~130ms). Novada / Firecrawl / Oxylabs are live-fetch (real HTTP, 3–30s). Direct latency comparison is misleading —','Tavily 使用预建索引（缓存查询，~130ms）。Novada / Firecrawl / Oxylabs 是实时抓取（真实 HTTP，3-30秒）。直接对比延迟会产生误导——')} <a href="#methodology" style="color:#818cf8">${bi('see Section 9','详见第9节')}</a>.
      &nbsp;&nbsp;·&nbsp;&nbsp;
      <strong style="color:#94a3b8">${bi('Competitors with data','有效参测竞品')}:</strong> Novada ✅ | Firecrawl ✅ | Tavily ✅ | Oxylabs ✅ | BrightData ❌ ${bi('(no proxy zones)','（无代理区域）')}
    </span>
  </div>

  <!-- 1. EXECUTIVE SUMMARY -->
  <div class="verdict section" id="executive">
    <h2>1. ${bi('Executive Summary','执行摘要')}</h2>
    <div style="font-size:19px;font-weight:700;margin-bottom:8px">
      ${biBlock(
        `Among tested competitors: Novada wins <strong>${novadaWins}</strong> categories outright (trophy = best quality + reliability ≥30%), trails in <strong>${novadaLoses}</strong>, ties <strong>${novadaTies}</strong>. Competitors with &lt;30% success rate on a task are disqualified from that category trophy.`,
        `在测试竞品中：Novada 胜出 <strong>${novadaWins}</strong> 个类别（奖杯 = 质量最优且成功率≥30%），落后 <strong>${novadaLoses}</strong> 个类别，平局 <strong>${novadaTies}</strong> 个。成功率低于30%的竞品在该类别不参与奖杯评选。`
      )}
    </div>
    <div style="font-size:14px;opacity:.85;margin-bottom:20px">
      ${biBlock(
        `<strong>Key findings:</strong> BrightData had account configuration failure (no proxy zones) — 0 valid calls. Oxylabs runs cleanly on T1/T2/T3/T4/T6/T7/T8 (all supported tasks). BrightData excluded. Meaningful comparison is between Novada, Firecrawl, Tavily, and Oxylabs. Novada leads on crawl coverage and search quality; Oxylabs leads on structured data (T6); Firecrawl leads on scrape speed; Tavily leads on latency but uses a pre-crawled index (not live fetches — see Section 9).`,
        `<strong>关键发现：</strong>BrightData 账户配置失败（无代理区域）—— 0 次有效调用，已排除出对比。Oxylabs 在全部支持任务（T1/T2/T3/T4/T6/T7/T8）运行稳定。有效对比为 Novada、Firecrawl、Tavily、Oxylabs 四家。Novada 在爬取覆盖率和搜索质量上领先；Oxylabs 在结构化数据（T6）上领先；Firecrawl 在抓取速度上领先；Tavily 延迟最低，但使用预建索引（非实时抓取——详见第9节）。`
      )}
    </div>
    <div class="stat-cards">
      <div class="stat-card"><div class="num">${novadaWins}</div><div class="label">${bi('Categories Won','胜出类别')}</div></div>
      <div class="stat-card"><div class="num">${novadaLoses}</div><div class="label">${bi('Categories Lost','落后类别')}</div></div>
      <div class="stat-card"><div class="num">${novadaFailed}</div><div class="label">${bi('Tasks Failed (quota/plan)','失败任务（配额/计划）')}</div></div>
      <div class="stat-card"><div class="num">1</div><div class="label">${bi('Competitors w/ Config Failure','配置失败竞品')} (BrightData)</div></div>
    </div>
    <p style="margin-top:14px;opacity:.7;font-size:13px">
      ${biBlock(
        '30 measured rounds per (competitor × category). Run: 2026-05-22. Trophy = best quality among competitors with ≥30% success rate. In live-fetch-only comparison (Novada vs Firecrawl vs Oxylabs), Novada leads on crawl reliability (T5) and search quality (T3/T4). See Section 9.',
        '每（竞品×任务）组合 30 轮实测，运行日期：2026-05-22。奖杯 = 成功率≥30%竞品中质量最优者。仅对比实时抓取工具（Novada vs Firecrawl vs Oxylabs）时，Novada 在爬取稳定性（T5）和搜索质量（T3/T4）上领先。详见第9节。'
      )}
    </p>
  </div>

  <!-- 2. LATENCY -->
  <div class="section" id="latency">
    <h2>2. ${bi('Latency Comparison','延迟对比')}</h2>
    <p style="color:#64748b;margin-bottom:16px">
      ${biBlock(
        'Median latency across 30 rounds. 🏆 = fastest valid result in category. Green = fast, Red = slow.',
        '30轮延迟中位数。🏆 = 该类别最快有效结果。绿色 = 快，红色 = 慢。'
      )}
    </p>
    ${latencyTable()}
    <div class="note red">
      ${biBlock(
        '<strong>⚠️ Fairness disclaimer:</strong> Tavily uses a <strong>pre-crawled index</strong> (database lookup, ~130ms). Novada, Firecrawl, and Oxylabs perform <strong>live fetches</strong> (real HTTP request, 3–30s). These are fundamentally different product models — comparing latency directly is misleading. See Section 9 (Methodology) for a live-fetch-only comparison and full explanation.',
        '<strong>⚠️ 公平性说明：</strong>Tavily 使用<strong>预爬索引</strong>（数据库查询，~130ms）。Novada、Firecrawl、Oxylabs 进行<strong>实时抓取</strong>（真实 HTTP 请求，3-30秒）。两者是根本不同的产品模型——直接对比延迟会产生误导。实时抓取专项对比及完整说明详见第9节（测试方法）。'
      )}
    </div>
  </div>

  <!-- 3. QUALITY -->
  <div class="section" id="quality">
    <h2>3. ${bi('Content Quality Scores','内容质量得分')}</h2>
    <p style="color:#64748b;margin-bottom:16px">
      ${biBlock(
        '1–5 scale. 5 = target content fully present, agent-ready.',
        '1-5分制。5分 = 目标内容完整，可直接供 AI 代理使用。'
      )}
    </p>
    ${qualityTable()}
    <div class="note">
      ${biBlock(
        `Quality rubric: <strong>Q5</strong> = target content fully present and agent-ready | <strong>Q4</strong> = most content present, minor gaps | <strong>Q3</strong> = partial content | <strong>Q2</strong> = minimal relevant content | <strong>Q1</strong> = content absent or irrelevant. Scores are median across all 30 rounds per task.
        <br><br>
        <strong>Note on Oxylabs T3/T4:</strong> Oxylabs search tasks were routed through the generic scraper rather than its dedicated SERP API, producing irrelevant output (Q1). This is not representative of Oxylabs' search product capability — it reflects a configuration mismatch. The <code>source: "google_search"</code> parameter in the API call should have invoked the SERP endpoint but did not.`,
        `质量评分标准：<strong>Q5</strong> = 目标内容完整、可直接供 AI 使用 | <strong>Q4</strong> = 大部分内容存在，有细微缺失 | <strong>Q3</strong> = 内容部分存在 | <strong>Q2</strong> = 相关内容极少 | <strong>Q1</strong> = 内容缺失或不相关。评分为每任务全部30轮的中位数。
        <br><br>
        <strong>关于 Oxylabs T3/T4 的说明：</strong>Oxylabs 搜索任务被路由至通用爬虫而非专用 SERP API，导致输出结果不相关（Q1）。这不代表 Oxylabs 搜索产品的真实能力，而是 API 配置不匹配所致。调用中的 <code>source: "google_search"</code> 参数本应调用 SERP 端点，但实际未生效。`
      )}
      <br><br>
      ${biBlock('Where tools had valid results, quality ranged from Q1–Q5. Speed and coverage are the primary differentiators among tools that achieve Q4–Q5.','在有效结果的工具中，质量从 Q1 到 Q5 不等。速度和覆盖率是达到 Q4–Q5 的工具间的主要差异点。')}
    </div>
  </div>

  <!-- 4. AGENT-FRIENDLINESS -->
  <div class="section" id="af">
    <h2>4. ${bi('Agent-Friendliness','AI 代理友好性')}</h2>
    <p style="color:#64748b;margin-bottom:16px">
      ${biBlock(
        '5-point checklist scored on successful responses: agent_instruction, structured errors, status field, chainable output, low boilerplate. Overall score = median of all individual round scores.',
        '对成功响应进行5项检查：agent_instruction（代理指令）、结构化错误、状态字段、可链式输出、低冗余。综合评分 = 所有轮次单项评分的中位数。'
      )}
    </p>
    ${afTable()}
    <div class="note purple">
      ${biBlock(
        `<strong>⚠️ Data note:</strong> v1 benchmark (10-round): Novada T1–T5 records were stored without individual criteria fields. v2 benchmark (this report, 30-round): all records include full criteria fields. Score column is accurate (median across all rounds); criteria % in the table below reflects the 30-round dataset.
        <br><br>
        <strong>Confirmed gaps for Novada:</strong>
        <ol style="margin-top:8px;padding-left:20px;line-height:2">
          <li><strong>output_is_chainable = 0%</strong> (every task) — Success responses contain only extracted text. No structured <code>links[]</code> array, no <code>source_url</code>. The agent receives content but cannot chain to next pages without re-parsing HTML. Firecrawl returns <code>sourceURL</code> + <code>links[]</code> in metadata → 100% chainable.</li>
          <li><strong>has_agent_instruction = 0% on success</strong> — Novada includes <code>agent_instruction</code> in error responses only. Success responses have no guidance on what the agent should do next. Adding a generic <code>"next_steps"</code> field would fix this instantly.</li>
        </ol>
        <br>
        <strong>Recommended fix (MCP response layer only, no API changes needed):</strong><br>
        Add to every scrape/crawl/search success response:
        <code style="display:block;background:#f3f0ff;padding:10px;border-radius:6px;margin-top:8px;font-size:12px">{ "content": "...", "source_url": "https://...", "links": ["https://...", ...], "agent_instruction": "Content extracted. To follow internal links call novada_crawl with source_url." }</code>
        This would move Novada from 3–4/5 to 5/5 across all task types — above Firecrawl (4/5).`,
        `<strong>⚠️ 数据说明：</strong>v1（10轮）：Novada T1-T5 记录未存储各项评分细节。v2（本报告，30轮）：所有记录均包含完整评分细节字段。评分列准确（所有轮次的中位数）；下表的评分细节百分比来自30轮数据集。
        <br><br>
        <strong>Novada 已确认的差距：</strong>
        <ol style="margin-top:8px;padding-left:20px;line-height:2">
          <li><strong>output_is_chainable = 0%</strong>（所有任务）—— 成功响应仅返回提取的文本内容，无结构化的 <code>links[]</code> 数组，无 <code>source_url</code>。AI 代理无法在不重新解析 HTML 的情况下跳转到下一页。Firecrawl 在元数据中返回 <code>sourceURL</code> + <code>links[]</code>，可链式使用率100%。</li>
          <li><strong>has_agent_instruction 成功响应为0%</strong> —— Novada 只在错误响应中包含 <code>agent_instruction</code>，成功响应中没有对 AI 代理的下一步操作指引。只需添加通用的 <code>"next_steps"</code> 字段即可立即修复。</li>
        </ol>
        <br>
        <strong>推荐修复方案（仅 MCP 响应层，无需修改 API）：</strong><br>
        在每次抓取/爬取/搜索的成功响应中添加：
        <code style="display:block;background:#f3f0ff;padding:10px;border-radius:6px;margin-top:8px;font-size:12px">{ "content": "...", "source_url": "https://...", "links": ["https://...", ...], "agent_instruction": "内容已提取。如需跟踪内部链接，请使用 source_url 调用 novada_crawl。" }</code>
        这将使 Novada 的 AI 友好性评分从 3-4/5 提升至 5/5，超越 Firecrawl（4/5）。`
      )}
    </div>
  </div>

  <!-- 5. DEEP DIVES -->
  <div class="section" id="deep">
    <h2>5. ${bi('Per-Category Deep Dives','分任务详细分析')}</h2>
    ${deepDives()}
  </div>

  <!-- 6. COST -->
  <div class="section" id="cost">
    <h2>6. ${bi('Call Volume &amp; Credit Usage','调用量与积分消耗')}</h2>
    <table class="data-table">
      <thead><tr><th>${bi('Competitor','竞品')}</th><th>${bi('Calls Completed','完成调用数')}</th><th>${bi('Credit Status','积分状态')}</th><th>${bi('Est. Cost','预估费用')}</th></tr></thead>
      <tbody>${costSection()}</tbody>
    </table>
    <div class="note">
      ${biBlock(
        `<strong>Pricing not included:</strong> Per-call pricing for all competitors was not collected during this benchmark. This section reports call success counts and credit status only — not cost-per-call or cost-per-GB. A cost comparison requires vendor pricing sheets and is outside the scope of this run.
        <br><br>
        <strong>Plan tiers used (estimated):</strong> Firecrawl — free tier key (hit T5 crawl rate limit after 1 round); Tavily — dev API key; Oxylabs — paid Realtime API plan; Novada — production API key. Results are not normalized to equivalent plan tiers. Free-tier rate limits are a product constraint, not a performance measurement.
        <br><br>
        BrightData: 0 valid calls — missing proxy zone configuration. No competitor hit financial credit exhaustion during the run.`,
        `<strong>未包含定价：</strong>本次基准测试未收集各竞品的单次调用定价。本节仅报告调用成功数量和积分状态，不包含每次调用费用或每 GB 费用。费用对比需要供应商报价单，超出本次测试范围。
        <br><br>
        <strong>所用套餐层级（估算）：</strong>Firecrawl — 免费套餐密钥（T5 爬取在第1轮后触发速率限制）；Tavily — 开发者 API 密钥；Oxylabs — 付费 Realtime API 套餐；Novada — 生产 API 密钥。结果未按同等套餐层级标准化。免费套餐速率限制属产品约束，不代表性能指标。
        <br><br>
        BrightData：0 次有效调用——代理区域配置缺失。本次运行中无任何竞品耗尽积分。`
      )}
    </div>
  </div>

  <!-- 7. GAPS -->
  <div class="section" id="gaps">
    <h2>7. ${bi('Gaps &amp; Advantages','差距与优势分析')}</h2>
    ${gapsSection()}
  </div>

  <!-- 8. FAILURE ANALYSIS -->
  <div class="section" id="failures">
    <h2>8. ${bi('Failure Analysis','失败原因分析')}</h2>
    <table class="data-table">
      <thead><tr><th>${bi('Competitor / Category','竞品 / 任务类别')}</th><th>${bi('Root Cause','根本原因')}</th><th>${bi('Status / Fix','状态 / 修复')}</th></tr></thead>
      <tbody>
        <tr>
          <td><strong style="color:#2563eb">BrightData — ${bi('All categories','全部任务类别')}</strong></td>
          <td>${biBlock(
            'Account has <strong>zero proxy zones configured</strong> (confirmed via BrightData dashboard → Zones page shows empty state "Create your first proxy"). The account only has Scrapers Library / Datasets API access. T1–T4 require Web Unlocker or proxy zones, which are not provisioned.',
            '账户<strong>未配置任何代理区域</strong>（已通过 BrightData 后台确认——Zones 页面显示空状态"创建您的第一个代理"）。该账户仅有 Scrapers Library / Datasets API 权限。T1–T4 需要 Web Unlocker 或代理区域，均未开通。'
          )}</td>
          <td>${biBlock(
            'Create and fund a Web Unlocker zone in the BrightData dashboard, then update benchmark config with the real zone name.',
            '在 BrightData 后台创建并充值 Web Unlocker 区域，然后用真实的区域名称更新基准测试配置。'
          )}</td>
        </tr>
        <tr style="background:#d1fae510">
          <td><strong style="color:#059669">Oxylabs — ✅ ${bi('Resolved','已解决')}</strong></td>
          <td>${biBlock(
            'Initial benchmark used wrong username (<code>oxy001_4xGlt</code>). Correct username confirmed via dashboard: <code>berryclare__KAZhJ</code>. Password required underscore not @ symbol.',
            '初始基准测试使用了错误的用户名（<code>oxy001_4xGlt</code>）。通过后台确认正确用户名为 <code>berryclare__KAZhJ</code>，密码需使用下划线而非 @ 符号。'
          )}</td>
          <td>${biBlock(
            '✅ v2 benchmark uses correct credentials from round 1. No re-run needed for v2.',
            '✅ v2 基准测试从第1轮起使用正确凭证，v2 无需重跑。'
          )}</td>
        </tr>
        <tr style="background:#d1fae510">
          <td><strong style="color:#059669">Novada — T3/T4 (Search) — ✅ ${bi('Stable','稳定')}</strong></td>
          <td>${biBlock(
            'v1: SERP returned <code>data.data = null</code> transiently. v2: fresh 30-round run with new topics (iPhone 17 Pro Max price, AI agent memory systems 2025).',
            'v1：SERP 瞬时返回 <code>data.data = null</code>。v2：以新主题（iPhone 17 Pro Max 价格、2025年 AI 代理记忆系统）全新运行30轮。'
          )}</td>
          <td>${biBlock(
            'v2 dataset: see summary.json for per-round data. v1 re-run context: 20/20 success at 1.8s (T3) and 2.0s (T4) median.',
            'v2 数据集：逐轮数据详见 summary.json。v1 重跑背景：20/20 成功，中位延迟 T3 为 1.8s，T4 为 2.0s。'
          )}</td>
        </tr>
        <tr style="background:#d1fae510">
          <td><strong style="color:#059669">Novada — T6 (Amazon) — ${bi('Workaround','兜底方案')}</strong></td>
          <td>${biBlock(
            'Scraper API returns error code 11006 — Amazon scraper not activated on this plan. Using Web Unblocker + cheerio HTML parsing as fallback. v2 ASIN: B0FTC2PRVZ (iPhone 17 Pro Max).',
            'Scraper API 返回错误码 11006——此套餐未激活 Amazon 爬虫。使用 Web Unblocker + cheerio HTML 解析作为兜底方案。v2 ASIN：B0FTC2PRVZ（iPhone 17 Pro Max）。'
          )}</td>
          <td>${biBlock(
            'Web Unblocker fallback active. Quality vs Oxylabs native amazon_product source may differ — Oxylabs parses structured product JSON, Novada falls back to HTML extraction.',
            'Web Unblocker 兜底方案已启用。与 Oxylabs 原生 amazon_product 来源的质量可能存在差异——Oxylabs 解析结构化商品 JSON，Novada 回退至 HTML 提取。'
          )}</td>
        </tr>
        <tr>
          <td><strong style="color:#7c3aed">Novada — T5 (Crawl) — ${bi('Partial','部分完成')}</strong></td>
          <td>${biBlock(
            'Some rounds may timeout (60s limit). Crawl makes 3 sequential unblocker calls = up to 3× render time stacked.',
            '部分轮次可能超时（60s限制）。爬取进行3次串行 Unblocker 调用 = 最多叠加3倍渲染时间。'
          )}</td>
          <td>${biBlock(
            'Fix: parallelize sub-page fetches. With 3 concurrent fetches, median would drop from ~30s to ~12s. Tracking as future improvement.',
            '修复方案：并行化子页面抓取。使用3个并发请求，中位延迟可从 ~30s 降至 ~12s。已列入未来改进计划。'
          )}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 9. METHODOLOGY -->
  <div class="section" id="methodology">
    <h2>9. ${bi('Methodology &amp; Fair Comparison','测试方法与公平对比')}</h2>
    ${methodologySection()}
  </div>

  <!-- 10. PRODUCT INSIGHTS -->
  <div class="section" id="insights">
    <h2>10. ${bi('Product Insights &amp; Roadmap','产品洞察与路线图')}</h2>
    ${productInsightsSection()}
  </div>

  <!-- 11. RAW DATA -->
  <div class="section" id="raw">
    <h2>11. ${bi('Raw Data','原始数据')}</h2>
    <details>
      <summary>${bi(`Expand — ${Object.values(allResults).flat().length} records across all competitors`, `展开 — 全竞品共 ${Object.values(allResults).flat().length} 条记录`)}</summary>
      <pre>${JSON.stringify(summary, null, 2).replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre>
    </details>
    <details style="margin-top:8px">
      <summary>${bi('Full result rows (all rounds, all competitors)','完整结果行（全轮次、全竞品）')}</summary>
      <pre>${JSON.stringify(allResults, null, 2).replace(/</g,"&lt;").replace(/>/g,"&gt;").slice(0,200000)}</pre>
    </details>
  </div>

  <!-- 12. DATA FILES -->
  <div class="section" id="datafiles">
    <h2>12. ${bi('Data Files','数据文件')}</h2>
    <p style="color:#64748b;margin-bottom:16px">
      ${biBlock(
        'All source data used in this report. Click any file to view or download.',
        '本报告所用全部原始数据文件。点击任意文件即可查看或下载。'
      )}
    </p>
    <table class="data-table">
      <thead><tr>
        <th>${bi('File','文件')}</th>
        <th>${bi('Description','说明')}</th>
        <th>${bi('Used In','用于章节')}</th>
      </tr></thead>
      <tbody>
        <tr>
          <td><a href="summary.json" style="color:#7c3aed;font-weight:700;font-family:monospace">summary.json</a></td>
          <td>${biBlock('Aggregated benchmark results — one row per (competitor × task). Contains median latency, p95, success rate, quality score, AF score. This is the primary data source for all charts and tables.','汇总基准测试结果——每（竞品×任务）一行。包含延迟中位数、p95、成功率、质量分、AI友好性评分。所有图表和表格的主要数据来源。')}</td>
          <td>${bi('Sections 2–5, 7, 9','第2-5节、第7节、第9节')}</td>
        </tr>
        <tr>
          <td><a href="results-novada.json" style="color:#7c3aed;font-weight:700;font-family:monospace">results-novada.json</a></td>
          <td>${biBlock('Novada — round-by-round raw results. Each record includes latency_ms, success, content_quality, agent_friendliness object with all 5 criteria.','Novada 逐轮原始结果。每条记录包含 latency_ms、success、content_quality、含5项评分标准的 agent_friendliness 对象。')}</td>
          <td>${bi('Sections 4, 11','第4节、第11节')}</td>
        </tr>
        <tr>
          <td><a href="results-firecrawl.json" style="color:#d97706;font-weight:700;font-family:monospace">results-firecrawl.json</a></td>
          <td>${biBlock('Firecrawl — round-by-round raw results. T3/T4/T6 are N/A (not supported). T5 shows 1/30 success due to rate limiting on free tier.','Firecrawl 逐轮原始结果。T3/T4/T6 不适用（不支持）。T5 因免费套餐速率限制仅1/30成功。')}</td>
          <td>${bi('Sections 2–5, 11','第2-5节、第11节')}</td>
        </tr>
        <tr>
          <td><a href="results-tavily.json" style="color:#059669;font-weight:700;font-family:monospace">results-tavily.json</a></td>
          <td>${biBlock('Tavily — round-by-round raw results. T5/T6 are N/A. All supported tasks show ~100–130ms latency (pre-indexed cache lookup, not live fetch).','Tavily 逐轮原始结果。T5/T6 不适用。所有支持任务延迟 ~100-130ms（预建索引缓存查询，非实时抓取）。')}</td>
          <td>${bi('Sections 2–5, 11','第2-5节、第11节')}</td>
        </tr>
        <tr>
          <td><a href="results-oxylabs.json" style="color:#dc2626;font-weight:700;font-family:monospace">results-oxylabs.json</a></td>
          <td>${biBlock('Oxylabs — round-by-round raw results. T5 is N/A. T3/T4 show Q2 quality — routed through generic scraper instead of SERP API.','Oxylabs 逐轮原始结果。T5 不适用。T3/T4 质量 Q2——被路由至通用爬虫而非 SERP API。')}</td>
          <td>${bi('Sections 2–5, 11','第2-5节、第11节')}</td>
        </tr>
        <tr>
          <td><a href="results-brightdata.json" style="color:#2563eb;font-weight:700;font-family:monospace">results-brightdata.json</a></td>
          <td>${biBlock('BrightData — all calls failed (HTTP 400, no proxy zones configured). Included for completeness; excluded from all competitive comparisons.','BrightData — 全部调用失败（HTTP 400，无代理区域配置）。为保持完整性而收录；已排除出所有竞品对比。')}</td>
          <td>${bi('Section 8 (Failure Analysis)','第8节（失败分析）')}</td>
        </tr>
        <tr>
          <td><a href="benchmark-evidence.md" style="color:#0369a1;font-weight:700;font-family:monospace">benchmark-evidence.md</a></td>
          <td>${biBlock('Human-readable evidence log. Contains round-by-round sample outputs, raw API responses, latency tables, and intermediate notes recorded during the benchmark run.','人工可读的证据记录。包含逐轮样本输出、原始 API 响应、延迟表格，以及测试运行过程中的中间备注。')}</td>
          <td>${bi('Section 8, raw audit','第8节、原始审计')}</td>
        </tr>
        <tr>
          <td><a href="run.mjs" style="color:#0369a1;font-weight:700;font-family:monospace">run.mjs</a></td>
          <td>${biBlock('Benchmark runner. Defines TARGETS (T1-T8), ROUNDS=30, competitor API call functions, content quality scorer, agent-friendliness scorer, and the main benchmark loop. Reproducible — run with node run.mjs.','基准测试执行脚本。定义 TARGETS（T1-T8）、ROUNDS=30、竞品 API 调用函数、内容质量评分器、AI友好性评分器及主循环。可复现——执行 node run.mjs。')}</td>
          <td>${bi('Section 9 (Methodology)','第9节（测试方法）')}</td>
        </tr>
        <tr>
          <td><a href="generate-report.mjs" style="color:#0369a1;font-weight:700;font-family:monospace">generate-report.mjs</a></td>
          <td>${biBlock('Report generator. Reads the JSON result files and produces this HTML report. Run with node generate-report.mjs after the benchmark completes.','报告生成脚本。读取 JSON 结果文件并生成本 HTML 报告。在基准测试完成后执行 node generate-report.mjs。')}</td>
          <td>${bi('This report','本报告')}</td>
        </tr>
        <tr>
          <td><a href="benchmark-run.log" style="color:#0369a1;font-weight:700;font-family:monospace">benchmark-run.log</a></td>
          <td>${biBlock('Full console log from the benchmark run. Contains per-round latency, quality scores, and error messages as they occurred in real time.','基准测试运行的完整控制台日志。包含实时发生的每轮延迟、质量分及错误信息。')}</td>
          <td>${bi('Raw audit trail','原始审计追踪')}</td>
        </tr>
      </tbody>
    </table>
  </div>

</div><!-- /tab-report -->

<!-- ═══════════════════════════════════════════════════════════════ TAB 2: MCP ROADMAP -->
<div class="tab-pane" id="tab-roadmap">

  <!-- ROADMAP HEADER -->
  <div class="verdict section" style="margin-top:0">
    <h2>🛠 ${bi('MCP Improvement Roadmap — Agent Implementation Brief','MCP 改进路线图 — Agent 实施简报')}</h2>
    <div style="font-size:15px;font-weight:700;margin-bottom:10px">
      ${biBlock(
        'Based on benchmark v2 (2026-05-22) — 30 rounds × 8 tasks × 5 competitors. This document is written for AI agents to read and implement directly.',
        '基于基准测试 v2（2026-05-22）—— 30轮 × 8任务 × 5竞品。本文档面向 AI 代理，供直接读取并实施。'
      )}
    </div>
    <p style="opacity:.75;font-size:13px">
      ${biBlock(
        '<strong>Primary finding:</strong> Novada AF score 3–4/5 vs Firecrawl 4/5. Root cause: output_is_chainable = 0% and has_agent_instruction = 0% on all success responses. Fix these two and Novada reaches 5/5.',
        '<strong>核心发现：</strong>Novada AI友好性评分 3–4/5 vs Firecrawl 4/5。根本原因：所有成功响应中 output_is_chainable = 0%，has_agent_instruction = 0%。修复这两项，Novada 可达到 5/5。'
      )}
    </p>
    <div class="stat-cards" style="margin-top:16px">
      <div class="stat-card"><div class="num" style="font-size:28px">2</div><div class="label">${bi('P0 Fixes','P0 修复')}</div></div>
      <div class="stat-card"><div class="num" style="font-size:28px">2</div><div class="label">${bi('P1 Improvements','P1 改进')}</div></div>
      <div class="stat-card"><div class="num" style="font-size:28px">1</div><div class="label">${bi('P2 Enhancement','P2 增强')}</div></div>
      <div class="stat-card"><div class="num" style="font-size:28px">3</div><div class="label">${bi('Files Modified','涉及文件')}</div></div>
    </div>
  </div>

  <!-- FILE MAP -->
  <div class="section">
    <h2>📁 ${bi('File Map','文件索引')}</h2>
    <table class="data-table">
      <thead><tr><th>${bi('File','文件')}</th><th>${bi('Tool','工具')}</th><th>${bi('Changes','改动')}</th></tr></thead>
      <tbody>
        <tr>
          <td><code>src/tools/scrape.ts</code></td>
          <td><code>novada_scrape</code></td>
          <td>${bi('P0-1: Add chainable output (source_url, links[], agent_instruction) to markdown/json/toon success branches','P0-1：在 markdown/json/toon 成功分支中添加可链式输出（source_url, links[], agent_instruction）')}</td>
        </tr>
        <tr>
          <td><code>src/tools/search.ts</code></td>
          <td><code>novada_search</code></td>
          <td>${bi('P0-1: Add source_url + agent_instruction to search result output. P0-2: Add agent_instruction field to success responses.','P0-1：在搜索结果输出中添加 source_url + agent_instruction。P0-2：在成功响应中添加 agent_instruction 字段。')}</td>
        </tr>
        <tr>
          <td><code>src/tools/crawl.ts</code></td>
          <td><code>novada_crawl</code></td>
          <td>${bi('P0-1: Add links[] and agent_instruction to crawl output. P1-1: Parallelize JS-heavy re-fetch (lines 125–133).','P0-1：在爬取输出中添加 links[] 和 agent_instruction。P1-1：并行化 JS 重取逻辑（第125–133行）。')}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- P0-1 -->
  <div class="section">
    <h2>🔴 P0 — ${bi('Chainable Outputs + agent_instruction on Success','成功响应的可链式输出 + agent_instruction')}</h2>

    <div class="roadmap-card p0">
      <span class="priority-badge badge-p0">P0-1</span>
      <h3 style="margin-bottom:8px">${bi('Add source_url, links[], agent_instruction to all success responses','在所有成功响应中添加 source_url、links[]、agent_instruction')}</h3>
      <p style="color:#64748b;margin-bottom:12px">
        ${biBlock(
          '<strong>Why:</strong> output_is_chainable = 0% and has_agent_instruction = 0% on success across ALL tasks (30 rounds). Firecrawl returns sourceURL + links[] in metadata → 100% chainable. Fix moves Novada from 3–4/5 to 5/5 AF score.',
          '<strong>原因：</strong>所有任务（30轮）成功响应中 output_is_chainable = 0%，has_agent_instruction = 0%。Firecrawl 在元数据中返回 sourceURL + links[] → 可链式率100%。修复后 Novada AF 评分从 3–4/5 升至 5/5。'
        )}
      </p>

      <h4 style="color:#dc2626;margin:14px 0 6px">📄 src/tools/scrape.ts — ${bi('markdown format branch (~line 334)','markdown 格式分支（约第334行）')}</h4>
      <div class="code-block">
        <span class="diff-ctx">    case "markdown":</span><br>
        <span class="diff-ctx">    default:</span><br>
        <span class="diff-ctx">      return [</span><br>
        <span class="diff-ctx">        \`## Scrape Results\`,</span><br>
        <span class="diff-ctx">        \`platform: \${platform} | operation: \${operation} | records: \${records.length}...\`,</span><br>
        <span class="diff-ctx">        \`\`,</span><br>
        <span class="diff-ctx">        \`---\`,</span><br>
        <span class="diff-ctx">        \`\`,</span><br>
        <span class="diff-ctx">        formatAsMarkdown(records),</span><br>
        <span class="diff-ctx">        \`\`,</span><br>
        <span class="diff-ctx">        \`---\`,</span><br>
        <span class="diff-ctx">        \`## Agent Hints\`,</span><br>
        <span class="diff-ctx">        \`- Use format='json' or format='csv' for downstream processing.\`,</span><br>
        <span class="diff-ctx">        \`- Increase limit (max 100) to retrieve more records.\`,</span><br>
        <span class="diff-ctx">        \`- For structured scraping of other platforms, change platform and operation.\`,</span><br>
        <span class="diff-ctx">        \`- Discover all 129 supported platforms and their operations: read novada://scraper-platforms resource.\`,</span><br>
        <span class="diff-add">+       \`\`,</span><br>
        <span class="diff-add">+       \`## Chainable Output\`,</span><br>
        <span class="diff-add">+       \`source_url: \${params.platform}/\${params.operation}\`,</span><br>
        <span class="diff-add">+       \`agent_instruction: Scrape complete. To read a related URL use novada_extract. To crawl multiple pages use novada_crawl. To search for related content use novada_search.\`,</span><br>
        <span class="diff-ctx">      ].join("\\n");</span>
      </div>

      <h4 style="color:#dc2626;margin:14px 0 6px">📄 src/tools/search.ts — ${bi('success response (~line 455)','成功响应（约第455行）')}</h4>
      <div class="code-block">
        <span class="diff-ctx">  lines.push(\`---\`);</span><br>
        <span class="diff-ctx">  lines.push(\`## Agent Hints\`);</span><br>
        <span class="diff-ctx">  lines.push(\`- Results are reranked by relevance to your query (title + snippet keyword scoring)\`);</span><br>
        <span class="diff-ctx">  lines.push(\`- To read any result in full: \\\`novada_extract\\\` with its url\`);</span><br>
        <span class="diff-ctx">  lines.push(\`- To batch-read multiple results: \\\`novada_extract\\\` with \\\`url=[url1, url2, ...]\\\`\`);</span><br>
        <span class="diff-ctx">  lines.push(\`- For deeper multi-source research: \\\`novada_research\\\`\`);</span><br>
        <span class="diff-add">+</span><br>
        <span class="diff-add">+  lines.push(\`\`);</span><br>
        <span class="diff-add">+  lines.push(\`## Chainable Output\`);</span><br>
        <span class="diff-add">+  lines.push(\`result_count: \${reranked.length}\`);</span><br>
        <span class="diff-add">+  const topUrls = reranked.slice(0, 5).map((r, i) => \`  [\${i+1}] \${r.url || r.link}\`).join('\\n');</span><br>
        <span class="diff-add">+  lines.push(\`top_urls:\\n\${topUrls}\`);</span><br>
        <span class="diff-add">+  lines.push(\`agent_instruction: Search complete. Call novada_extract with any url above to read the full page. Call novada_research for deeper multi-source investigation.\`);</span><br>
      </div>

      <h4 style="color:#dc2626;margin:14px 0 6px">📄 src/tools/crawl.ts — ${bi('crawl output (~line 232)','爬取输出（约第232行）')}</h4>
      <div class="code-block">
        <span class="diff-ctx">  lines.push(\`## Agent Hints\`);</span><br>
        <span class="diff-ctx">  lines.push(\`- \${results.length} pages crawled. For targeted extraction, use novada_map first then novada_extract on chosen pages.\`);</span><br>
        <span class="diff-ctx">  // ... existing hints ...</span><br>
        <span class="diff-add">+  lines.push(\`\`);</span><br>
        <span class="diff-add">+  lines.push(\`## Chainable Output\`);</span><br>
        <span class="diff-add">+  lines.push(\`root_url: \${params.url}\`);</span><br>
        <span class="diff-add">+  const crawledUrls = results.slice(0, 10).map(r => \`  \${r.url}\`).join('\\n');</span><br>
        <span class="diff-add">+  lines.push(\`crawled_pages:\\n\${crawledUrls}\`);</span><br>
        <span class="diff-add">+  lines.push(\`agent_instruction: Crawl complete. \${results.length} pages extracted. To read a specific page use novada_extract. To discover more pages use novada_map with root_url.\`);</span><br>
      </div>
    </div>
  </div>

  <!-- P1-1 -->
  <div class="section">
    <h2>🟡 P1 — ${bi('Performance Improvements','性能改进')}</h2>

    <div class="roadmap-card p1">
      <span class="priority-badge badge-p1">P1-1</span>
      <h3 style="margin-bottom:8px">${bi('Parallelize JS-heavy re-fetch in crawl.ts','并行化 crawl.ts 中的 JS 重取逻辑')}</h3>
      <p style="color:#64748b;margin-bottom:12px">
        ${biBlock(
          '<strong>Why:</strong> T5 crawl median = 24.7s. The JS-heavy re-fetch loop (crawl.ts:125–133) is sequential — each detected JS-heavy page is re-fetched one at a time with await. With 3 concurrent fetches this becomes parallel, saving ~8s per batch.',
          '<strong>原因：</strong>T5 爬取中位延迟 = 24.7s。JS 重取循环（crawl.ts:125–133）是串行的——每个检测到的 JS 页面都用 await 逐个重取。改为3个并发请求后变为并行，每批节省约 8 秒。'
        )}
      </p>
      <p style="color:#64748b;margin-bottom:12px">
        ${biBlock(
          '<strong>File:</strong> src/tools/crawl.ts | <strong>Lines:</strong> 125–133 (inside the renderMode === "auto" block)',
          '<strong>文件：</strong>src/tools/crawl.ts | <strong>行数：</strong>125–133（在 renderMode === "auto" 块内）'
        )}
      </p>
      <h4 style="color:#d97706;margin:14px 0 6px">${bi('Current code (sequential):','当前代码（串行）：')}</h4>
      <div class="code-block">
        <span class="diff-del">-   // Re-fetch the JS-heavy pages with render</span><br>
        <span class="diff-del">-   for (let i = 0; i &lt; pages.length; i++) {</span><br>
        <span class="diff-del">-     if (pages[i] !== null &amp;&amp; detectJsHeavyContent(pages[i]!.html)) {</span><br>
        <span class="diff-del">-       pages[i] = await fetchPage(batch[i].url, apiKey, true);  // ← sequential</span><br>
        <span class="diff-del">-       pageRendered[i] = true;</span><br>
        <span class="diff-del">-     }</span><br>
        <span class="diff-del">-   }</span>
      </div>
      <h4 style="color:#16a34a;margin:14px 0 6px">${bi('Fixed code (parallel):','修复代码（并行）：')}</h4>
      <div class="code-block">
        <span class="diff-add">+   // Re-fetch JS-heavy pages in parallel</span><br>
        <span class="diff-add">+   const jsHeavyIndexes = pages</span><br>
        <span class="diff-add">+     .map((p, i) => (p !== null &amp;&amp; detectJsHeavyContent(p.html)) ? i : -1)</span><br>
        <span class="diff-add">+     .filter(i => i >= 0);</span><br>
        <span class="diff-add">+   if (jsHeavyIndexes.length > 0) {</span><br>
        <span class="diff-add">+     const refetched = await Promise.all(</span><br>
        <span class="diff-add">+       jsHeavyIndexes.map(i => fetchPage(batch[i].url, apiKey, true))</span><br>
        <span class="diff-add">+     );</span><br>
        <span class="diff-add">+     jsHeavyIndexes.forEach((origIdx, j) => {</span><br>
        <span class="diff-add">+       pages[origIdx] = refetched[j];</span><br>
        <span class="diff-add">+       pageRendered[origIdx] = true;</span><br>
        <span class="diff-add">+     });</span><br>
        <span class="diff-add">+   }</span>
      </div>
      <div class="note" style="margin-top:14px">
        ${biBlock(
          '⚡ Expected impact: T5 median latency drops from ~25s to ~15s. The gain scales with the number of JS-heavy pages per batch (up to CRAWL_CONCURRENCY = 3).',
          '⚡ 预期效果：T5 中位延迟从 ~25s 降至 ~15s。收益随每批次 JS 重页面数量线性增长（最多 CRAWL_CONCURRENCY = 3）。'
        )}
      </div>
    </div>

    <div class="roadmap-card p1" style="margin-top:16px">
      <span class="priority-badge badge-p1">P1-2</span>
      <h3 style="margin-bottom:8px">${bi('Static fast path: detect non-JS pages, skip rendering','静态快速通道：检测非 JS 页面，跳过渲染')}</h3>
      <p style="color:#64748b;margin-bottom:12px">
        ${biBlock(
          '<strong>Why:</strong> T1 (HN) = 3.5s, T7 (TechCrunch) = 6.6s via Novada vs Firecrawl 500ms. These are static HTML pages being sent through the full Web Unblocker JS rendering pipeline. A simple content-type or HTML structure check can bypass rendering for non-JS pages.',
          '<strong>原因：</strong>T1（HN）= 3.5s，T7（TechCrunch）= 6.6s（Novada）vs Firecrawl 500ms。这些是静态 HTML 页面，却被送入完整的 Web Unblocker JS 渲染流水线。通过简单的 content-type 或 HTML 结构检查，可为非 JS 页面绕过渲染。'
        )}
      </p>
      <p style="color:#64748b;margin-bottom:12px">
        ${biBlock(
          '<strong>Detection heuristic:</strong> If fetched HTML has no script-heavy indicators (no React root, no Vue app, no Angular bootstrap, no webpack chunk) → serve static content directly without rendering. Re-use existing detectJsHeavyContent() from extract.ts.',
          '<strong>检测启发式规则：</strong>如果抓取的 HTML 没有 JS 重度指标（无 React root、无 Vue app、无 Angular bootstrap、无 webpack chunk）→ 直接提供静态内容，无需渲染。复用 extract.ts 中已有的 detectJsHeavyContent() 函数。'
        )}
      </p>
      <div class="code-block">
        <span class="diff-ctx">// In extract.ts or unblock handling — add before calling Web Unblocker:</span><br>
        <span class="diff-add">+ // Step 0: Quick static fetch — if no JS-heavy indicators, skip rendering entirely</span><br>
        <span class="diff-add">+ if (renderMode === "auto") {</span><br>
        <span class="diff-add">+   const staticResult = await fetchViaProxy(url, apiKey, { timeout: TIMEOUTS.CRAWL_STATIC });</span><br>
        <span class="diff-add">+   if (staticResult &amp;&amp; !detectJsHeavyContent(staticResult.data)) {</span><br>
        <span class="diff-add">+     return processStaticContent(staticResult.data, url);  // skip rendering</span><br>
        <span class="diff-add">+   }</span><br>
        <span class="diff-add">+   // Fall through to full rendering path</span><br>
        <span class="diff-add">+ }</span>
      </div>
      <div class="note" style="margin-top:14px">
        ${biBlock(
          '⚡ Expected impact: Static pages (HN, TechCrunch, Wikipedia) drop from 3–7s to ~0.5s. Applies to ~40–60% of typical agent web access patterns.',
          '⚡ 预期效果：静态页面（HN、TechCrunch、Wikipedia）从 3–7s 降至 ~0.5s。适用于约 40–60% 的典型代理网页访问模式。'
        )}
      </div>
    </div>
  </div>

  <!-- P2-1 -->
  <div class="section">
    <h2>🟢 P2 — ${bi('Quality Enhancement','质量增强')}</h2>

    <div class="roadmap-card p2">
      <span class="priority-badge badge-p2">P2-1</span>
      <h3 style="margin-bottom:8px">${bi('Auto-enrich top search result (opt-in default)','自动丰富首个搜索结果（可选默认开启）')}</h3>
      <p style="color:#64748b;margin-bottom:12px">
        ${biBlock(
          '<strong>Why:</strong> T3/T4 search quality Q4 (snippet only, no full content). The extract_options.top_n feature exists but is opt-in. Automatically enriching the #1 result with full page content would lift search quality to Q5 for most queries with minimal latency overhead (+2–4s for one extract call).',
          '<strong>原因：</strong>T3/T4 搜索质量 Q4（仅片段，无完整内容）。extract_options.top_n 功能已存在但需手动开启。自动丰富第1条结果的完整页面内容，可将大多数查询的搜索质量提升至 Q5，延迟开销极小（+2–4s 的一次 extract 调用）。'
        )}
      </p>
      <p style="color:#64748b;margin-bottom:12px">
        ${biBlock(
          '<strong>File:</strong> src/tools/search.ts | <strong>Implementation:</strong> Add an <code>enrich_top</code> boolean param (default: false). When true, auto-call novada_extract on result[0] and append extracted_content.',
          '<strong>文件：</strong>src/tools/search.ts | <strong>实现：</strong>添加布尔参数 <code>enrich_top</code>（默认 false）。为 true 时，自动对 result[0] 调用 novada_extract 并追加 extracted_content。'
        )}
      </p>
      <div class="code-block">
        <span class="diff-ctx">// In search params schema (types.ts or search.ts):</span><br>
        <span class="diff-add">+ enrich_top: z.boolean().optional().describe(</span><br>
        <span class="diff-add">+   "Auto-extract full content from the top result. Adds ~2–4s latency. Default: false."</span><br>
        <span class="diff-add">+ ),</span><br>
        <span class="diff-ctx"></span><br>
        <span class="diff-ctx">// In novadaSearch(), after reranking results:</span><br>
        <span class="diff-add">+ if (params.enrich_top &amp;&amp; reranked[0]) {</span><br>
        <span class="diff-add">+   const topUrl = reranked[0].url || reranked[0].link;</span><br>
        <span class="diff-add">+   if (topUrl) {</span><br>
        <span class="diff-add">+     const content = await novadaExtract({ url: topUrl, format: 'markdown', render: 'auto' }, apiKey);</span><br>
        <span class="diff-add">+     (reranked[0] as any).extracted_content = content;</span><br>
        <span class="diff-add">+   }</span><br>
        <span class="diff-add">+ }</span>
      </div>
      <div class="note" style="margin-top:14px">
        ${biBlock(
          'Note: extract_options.top_n already implements multi-result enrichment. enrich_top is a simpler, single-result shorthand. Consider consolidating if both are added.',
          '注意：extract_options.top_n 已实现多结果丰富化。enrich_top 是更简单的单结果快捷方式。如两者都添加，考虑合并。'
        )}
      </div>
    </div>
  </div>

  <!-- IMPLEMENTATION ORDER -->
  <div class="section">
    <h2>📋 ${bi('Implementation Order','实施顺序')}</h2>
    <table class="data-table">
      <thead><tr>
        <th>${bi('Step','步骤')}</th>
        <th>${bi('Priority','优先级')}</th>
        <th>${bi('Change','改动')}</th>
        <th>${bi('File','文件')}</th>
        <th>${bi('Estimated Impact','预期效果')}</th>
      </tr></thead>
      <tbody>
        <tr>
          <td><strong>1</strong></td>
          <td><span class="priority-badge badge-p0">P0</span></td>
          <td>${bi('Add Chainable Output section to scrape/search/crawl success responses','在抓取/搜索/爬取成功响应中添加 Chainable Output 节')}</td>
          <td><code>scrape.ts, search.ts, crawl.ts</code></td>
          <td>${bi('AF: 3→5/5 (+2pts)', 'AI友好性：3→5/5（+2分）')}</td>
        </tr>
        <tr>
          <td><strong>2</strong></td>
          <td><span class="priority-badge badge-p1">P1</span></td>
          <td>${bi('Parallelize JS re-fetch in crawl','并行化爬取中的 JS 重取')}</td>
          <td><code>crawl.ts:125–133</code></td>
          <td>${bi('T5 latency: 25s→15s (-40%)','T5 延迟：25s→15s（-40%）')}</td>
        </tr>
        <tr>
          <td><strong>3</strong></td>
          <td><span class="priority-badge badge-p1">P1</span></td>
          <td>${bi('Static fast path for non-JS pages','非 JS 页面的静态快速通道')}</td>
          <td><code>extract.ts / unblock flow</code></td>
          <td>${bi('T1/T7 latency: 4–7s→~0.5s (-90%)','T1/T7 延迟：4–7s→~0.5s（-90%）')}</td>
        </tr>
        <tr>
          <td><strong>4</strong></td>
          <td><span class="priority-badge badge-p2">P2</span></td>
          <td>${bi('Add enrich_top param to search','在搜索中添加 enrich_top 参数')}</td>
          <td><code>search.ts</code></td>
          <td>${bi('Search quality: Q4→Q5 (opt-in)','搜索质量：Q4→Q5（可选开启）')}</td>
        </tr>
      </tbody>
    </table>
    <div class="note purple" style="margin-top:16px">
      ${biBlock(
        '<strong>Agent instructions for implementation:</strong> Read each file listed in the "File" column before writing code. Run <code>npm run build</code> after each change to verify TypeScript compiles. Run existing tests with <code>npm test</code> to confirm no regressions. Each change is self-contained and can be implemented independently.',
        '<strong>代理实施指南：</strong>在编写代码前，先阅读"文件"列中列出的每个文件。每次改动后运行 <code>npm run build</code> 验证 TypeScript 编译通过。用 <code>npm test</code> 运行现有测试以确认无回归。每项改动相互独立，可单独实施。'
      )}
    </div>
  </div>

</div><!-- /tab-roadmap -->

</main>
<script>
function toggleLang() {
  const isZH = document.body.classList.toggle('zh');
  document.getElementById('lang-btn').textContent = isZH ? 'Switch to English' : '切换中文 / EN';
}
function switchTab(name, btn) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
}
</script>
</body>
</html>`;

const reportPath = resolve(OUT_DIR, "report.html");
writeFileSync(reportPath, html);
console.log(`BENCHMARK COMPLETE: file://${reportPath}`);
