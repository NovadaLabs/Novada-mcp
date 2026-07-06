import { novadaExtract } from "../build/tools/extract.js";

const tests = [
  { url: "https://www.douban.com/", label: "Douban 豆瓣", render: "render" },
  { url: "https://www.36kr.com/", label: "36Kr 创业媒体", render: "render" },
  { url: "https://juejin.cn/", label: "掘金 开发者社区", render: "render" },
  { url: "https://www.csdn.net/", label: "CSDN 技术博客", render: "render" },
  { url: "https://www.indeed.com/", label: "Indeed (anti-bot)", render: "auto" },
  { url: "https://www.booking.com/", label: "Booking.com", render: "auto" },
  { url: "https://www.walmart.com/", label: "Walmart (anti-bot)", render: "auto" },
];

const apiKey = process.env.NOVADA_API_KEY;

console.log("=== Proxy Auto-Provision Scraping Test ===\n");

for (const { url, label, render } of tests) {
  const start = Date.now();
  try {
    const result = await novadaExtract({ url, render, format: "markdown", max_chars: 400 }, apiKey);
    const ms = Date.now() - start;
    const ok = !result.includes("Extract Failed") && result.length > 200;
    console.log(`${ok ? "✅" : "❌"} ${label} | ${ms}ms | ${result.length} chars`);
    if (ok) {
      const preview = result.replace(/\n/g, " ").slice(80, 260);
      console.log(`   "${preview}"`);
    } else {
      const err = result.replace(/\n/g, " ").slice(50, 200);
      console.log(`   ERR: ${err}`);
    }
    console.log("");
  } catch (e) {
    const ms = Date.now() - start;
    console.log(`❌ ${label} | ${ms}ms | ERR: ${e.message?.slice(0, 80)}\n`);
  }
}
