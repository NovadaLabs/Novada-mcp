import type { BenchmarkReport, AggregatedStats, ProviderName, CategoryName } from "./types.js";
import { CATEGORY_LABELS } from "./types.js";

const PROVIDER_COLORS: Record<ProviderName, string> = {
  novada: "#4F46E5",    // indigo
  firecrawl: "#F59E0B",  // amber
  tavily: "#10B981",     // emerald
};

const PROVIDER_LABELS: Record<ProviderName, string> = {
  novada: "Novada",
  firecrawl: "Firecrawl",
  tavily: "Tavily",
};

function pct(val: number): string {
  return `${(val * 100).toFixed(1)}%`;
}

function ms(val: number): string {
  return val >= 1000 ? `${(val / 1000).toFixed(1)}s` : `${val}ms`;
}

function generateBarChart(
  title: string,
  categories: CategoryName[],
  providers: ProviderName[],
  getValue: (stats: AggregatedStats) => number,
  formatVal: (v: number) => string,
  aggregated: AggregatedStats[],
  chartId: string
): string {
  const rows: string[] = [];

  for (const cat of categories) {
    const catStats = aggregated.filter((s) => s.category === cat);
    const maxVal = Math.max(...catStats.map(getValue), 0.001);

    const bars = providers
      .map((p) => {
        const stat = catStats.find((s) => s.provider === p);
        if (!stat) return "";
        const val = getValue(stat);
        const widthPct = Math.max((val / maxVal) * 100, 2);
        return `
          <div style="display:flex;align-items:center;gap:8px;margin:3px 0;">
            <span style="width:70px;font-size:12px;color:#666;text-align:right;">${PROVIDER_LABELS[p]}</span>
            <div style="flex:1;background:#f0ebe3;border-radius:6px;overflow:hidden;height:22px;">
              <div style="width:${widthPct}%;background:${PROVIDER_COLORS[p]};height:100%;border-radius:6px;transition:width 0.3s;"></div>
            </div>
            <span style="width:70px;font-size:12px;font-weight:600;color:#333;">${formatVal(val)}</span>
          </div>`;
      })
      .join("");

    rows.push(`
      <div style="margin-bottom:16px;">
        <div style="font-size:13px;font-weight:600;color:#555;margin-bottom:4px;">${CATEGORY_LABELS[cat]}</div>
        ${bars}
      </div>`);
  }

  return `
    <div class="chart-card" id="${chartId}">
      <h3>${title}</h3>
      ${rows.join("")}
    </div>`;
}

export function generateHtmlReport(report: BenchmarkReport): string {
  const { aggregated, summary, config, runDate } = report;
  const providers = config.providers;
  const categories = config.categories;

  // Summary cards
  const summaryCards = summary
    .map(
      (s) => `
    <div class="summary-card" style="border-left: 4px solid ${PROVIDER_COLORS[s.provider]}">
      <h3>${PROVIDER_LABELS[s.provider]}</h3>
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-value">${pct(s.overallSuccessRate)}</div>
          <div class="stat-label">Success Rate</div>
        </div>
        <div class="stat">
          <div class="stat-value">${ms(s.overallLatencyP50)}</div>
          <div class="stat-label">Latency P50</div>
        </div>
        <div class="stat">
          <div class="stat-value">${ms(s.overallLatencyP95)}</div>
          <div class="stat-label">Latency P95</div>
        </div>
        <div class="stat">
          <div class="stat-value">${s.overallAvgQuality.toFixed(1)}/10</div>
          <div class="stat-label">Quality Score</div>
        </div>
        <div class="stat">
          <div class="stat-value">${s.overallAvgChars.toLocaleString()}</div>
          <div class="stat-label">Avg Chars</div>
        </div>
        <div class="stat">
          <div class="stat-value">$${s.estimatedCostPer1k.toFixed(2)}</div>
          <div class="stat-label">Cost / 1k reqs</div>
        </div>
      </div>
    </div>`
    )
    .join("");

  // Bar charts
  const successChart = generateBarChart(
    "Success Rate by Category",
    categories,
    providers,
    (s) => s.successRate,
    (v) => pct(v),
    aggregated,
    "success-chart"
  );

  const latencyChart = generateBarChart(
    "Latency P50 by Category",
    categories,
    providers,
    (s) => s.latencyP50,
    (v) => ms(v),
    aggregated,
    "latency-chart"
  );

  const qualityChart = generateBarChart(
    "Quality Score by Category",
    categories,
    providers,
    (s) => s.avgQualityScore,
    (v) => v.toFixed(1),
    aggregated,
    "quality-chart"
  );

  const charsChart = generateBarChart(
    "Avg Content Length by Category",
    categories,
    providers,
    (s) => s.avgCharCount,
    (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v),
    aggregated,
    "chars-chart"
  );

  // Detailed table
  const tableHeader = `
    <tr>
      <th>Category</th>
      <th>Provider</th>
      <th>URLs</th>
      <th>Success</th>
      <th>Rate</th>
      <th>P50</th>
      <th>P95</th>
      <th>P99</th>
      <th>Avg Chars</th>
      <th>Quality</th>
      <th>$/req</th>
    </tr>`;

  const tableRows = aggregated
    .map(
      (s) => `
    <tr>
      <td>${CATEGORY_LABELS[s.category]}</td>
      <td><span style="color:${PROVIDER_COLORS[s.provider]};font-weight:600;">${PROVIDER_LABELS[s.provider]}</span></td>
      <td>${s.totalUrls}</td>
      <td>${s.successCount}</td>
      <td>${pct(s.successRate)}</td>
      <td>${ms(s.latencyP50)}</td>
      <td>${ms(s.latencyP95)}</td>
      <td>${ms(s.latencyP99)}</td>
      <td>${s.avgCharCount.toLocaleString()}</td>
      <td>${s.avgQualityScore.toFixed(1)}</td>
      <td>$${s.costPerRequest.toFixed(4)}</td>
    </tr>`
    )
    .join("");

  // Failures table
  const failures = report.results.filter((r) => !r.success);
  const failuresSection =
    failures.length > 0
      ? `
    <div class="section">
      <h2>Failed Extractions (${failures.length})</h2>
      <table>
        <tr><th>Provider</th><th>Category</th><th>URL</th><th>Error</th></tr>
        ${failures
          .slice(0, 50)
          .map(
            (f) => `
          <tr>
            <td><span style="color:${PROVIDER_COLORS[f.provider]}">${PROVIDER_LABELS[f.provider]}</span></td>
            <td>${CATEGORY_LABELS[f.category]}</td>
            <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.url}</td>
            <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dc2626;">${f.error || "Empty content"}</td>
          </tr>`
          )
          .join("")}
        ${failures.length > 50 ? `<tr><td colspan="4" style="text-align:center;color:#999;">...and ${failures.length - 50} more</td></tr>` : ""}
      </table>
    </div>`
      : "";

  const totalUrls = report.results.length / providers.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Novada Benchmark Report — ${runDate}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #faf7f2;
      color: #1a1a1a;
      line-height: 1.6;
      padding: 40px 20px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #1a1a1a;
    }

    .subtitle {
      font-size: 14px;
      color: #888;
      margin-bottom: 32px;
    }

    h2 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 16px;
      color: #333;
    }

    h3 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
      color: #444;
    }

    .section {
      margin-bottom: 40px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }

    .summary-card {
      background: #fff;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }

    .summary-card h3 {
      margin-bottom: 16px;
    }

    .stat-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .stat {
      text-align: center;
    }

    .stat-value {
      font-size: 22px;
      font-weight: 700;
      color: #1a1a1a;
    }

    .stat-label {
      font-size: 11px;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }

    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }

    .chart-card {
      background: #fff;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }

    th {
      background: #f5f0ea;
      text-align: left;
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 600;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    td {
      padding: 10px 12px;
      font-size: 13px;
      border-bottom: 1px solid #f0ebe3;
    }

    tr:last-child td {
      border-bottom: none;
    }

    .legend {
      display: flex;
      gap: 24px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #555;
    }

    .legend-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }

    .meta {
      font-size: 12px;
      color: #aaa;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e8e2d9;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Novada Competitive Benchmark</h1>
    <p class="subtitle">Run: ${runDate} | URLs: ${totalUrls} | Providers: ${providers.map((p) => PROVIDER_LABELS[p]).join(", ")}</p>

    <div class="legend">
      ${providers.map((p) => `<div class="legend-item"><div class="legend-dot" style="background:${PROVIDER_COLORS[p]}"></div>${PROVIDER_LABELS[p]}</div>`).join("")}
    </div>

    <div class="section">
      <h2>Provider Summary</h2>
      <div class="summary-grid">
        ${summaryCards}
      </div>
    </div>

    <div class="section">
      <h2>Category Comparison</h2>
      <div class="charts-grid">
        ${successChart}
        ${latencyChart}
        ${qualityChart}
        ${charsChart}
      </div>
    </div>

    <div class="section">
      <h2>Detailed Results</h2>
      <table>
        ${tableHeader}
        ${tableRows}
      </table>
    </div>

    ${failuresSection}

    <div class="meta">
      Generated by novada-search benchmark harness v1.0 | Config: timeout=${config.timeout}ms, limit=${config.limit}/category
    </div>
  </div>
</body>
</html>`;
}

/** Generate CSV from aggregated stats */
export function generateCsv(report: BenchmarkReport): string {
  const header = "Category,Provider,Total URLs,Success Count,Success Rate,Latency P50 (ms),Latency P95 (ms),Latency P99 (ms),Avg Chars,Avg Quality Score,Cost Per Request ($)";

  const rows = report.aggregated.map(
    (s) =>
      `${CATEGORY_LABELS[s.category]},${PROVIDER_LABELS[s.provider]},${s.totalUrls},${s.successCount},${(s.successRate * 100).toFixed(1)}%,${s.latencyP50},${s.latencyP95},${s.latencyP99},${s.avgCharCount},${s.avgQualityScore.toFixed(1)},${s.costPerRequest.toFixed(4)}`
  );

  return [header, ...rows].join("\n");
}
