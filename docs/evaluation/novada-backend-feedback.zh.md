# Novada MCP 集成 — 技术对接问题
**来自：** Novada MCP 团队 | **日期：** 2026-04-22
**背景：** 正在构建 Novada 官方 MCP 服务器，面向 AI Agent（Claude、Cursor、VS Code）。已发布到 npm（`novada-mcp`）。完成 122 次测试调用，与 Tavily MCP + Firecrawl MCP 进行了竞品对标。

---

## 总结

我们构建并发布了 Novada MCP 服务器 — 5 个工具（search、extract、crawl、map、research）供 AI Agent 使用。Novada 产品基础设施很强：4/5 搜索引擎在 Scraper API 上正常工作，Web Unblocker 反爬能力经过验证，爬虫库非常丰富。

**我们需要 3 个技术问题的答案，以完成集成并为 Agent 解锁所有引擎。**

---

## 问题 1（关键）：如何获取 Scraper API 的任务结果？

### 我们做了什么

成功向 `POST https://scraper.novada.com/request` 提交搜索任务：

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer 1f35b477c9e1802778ec64aee2a6adfa" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=bing.com" \
  -d "scraper_id=bing_search" \
  -d "q=apple" \
  -d "json=1"
```

返回：`{"code":0,"data":{"code":200,"data":{"task_id":"1f1901dc..."}}}`

### 我们遇到的问题

API 返回 `task_id`，但我们找不到获取结果的端点。尝试了 13 种 URL 模式，全部返回 404：

```
GET  /result/{task_id}
GET  /task/{task_id}
GET  /request/{task_id}
POST /result（body 中带 task_id）
GET  /v1/task/{task_id}
GET  /results?task_id=...
... 等等
```

### 请提供

1. 结果获取端点（例如 `GET /result/{task_id}`）
2. 或者：API 是否支持同步模式？（例如 `sync=true` 参数，阻塞直到结果就绪）
3. 或者：是否支持 `callback_url` 参数用于 webhook 回调？

### 为什么这很重要

MCP 工具是同步的 — Agent 调用工具后等待响应返回。如果无法获取任务结果，我们就无法从旧端点（`scraperapi.novada.com/search`）迁移到 Scraper API。**这一个端点就能为所有使用 Novada 的 AI Agent 解锁 4 个搜索引擎（Google、Bing、DDG、Yandex）。**

---

## 问题 2：Scraper ID — 已验证 vs 未找到

### 已验证可用（20 次测试调用）

| 引擎 | scraper_name | scraper_id | 额外参数 | 状态 |
|------|-------------|-----------|---------|------|
| Google | `google.com` | `google_search` | — | ✅ 返回 task_id |
| Bing | `bing.com` | `bing_search` | `safe=off` | ✅ 返回 task_id |
| DuckDuckGo | `duckduckgo.com` | `duckduckgo` | — | ✅ 返回 task_id |
| Yandex | `yandex.com` | `yandex` | `yandex_domain=yandex.com` | ✅ 返回 task_id |

### 不可用

| 引擎 | scraper_name | scraper_id | 错误 |
|------|-------------|-----------|------|
| Yahoo | `yahoo.com` | `yahoo_search` / `yahoo` | `11006 Scraper error` |
| Yandex | `yandex.com` | `yandex_search` | `11006`（错误 id — 用 `yandex` 可以） |

### 请确认

1. Yahoo 搜索在 Scraper API 上是否可用？如果可用，正确的 `scraper_id` 是什么？
2. 能否提供搜索引擎的完整 scraper_id 列表？（网页库显示 Google 有 4 个爬虫，我们只确认了 `google_search`）
3. 各引擎是否有额外必填参数？（例如 Yandex 需要 `yandex_domain`）

---

## 问题 3：旧端点 scraperapi.novada.com 是否已弃用？

我们最初基于 `scraperapi.novada.com` 构建 MCP，发现以下情况：

| 端点 | 状态 |
|------|------|
| `scraperapi.novada.com/search` | 仅 Google 可用，其他引擎有问题 |
| `scraperapi.novada.com?url=...`（根路径） | 两个 API Key 都返回 404 |

### 请确认

1. `scraperapi.novada.com` 是否已被 Scraper API（`scraper.novada.com`）替代？
2. URL 抓取（内容提取）应该使用 Web Unblocker 还是 scraperapi？
3. 如果 scraperapi 仍在维护，以下引擎问题是否会修复？
   - Yahoo：`q` 参数被丢弃 → `410 empty query built`
   - Bing：查询字符串被截断 — 仅第一个关键词传递
   - DDG：网关层返回 `502 Bad Gateway`
   - Yandex：`SearchParameters.Text` 参数映射失败

---

## 竞品格局

我们对 Novada MCP 与 Tavily MCP、Firecrawl MCP 进行了对标：

**Novada 优势：**
- **Agent Hints** — 独有功能，竞品没有（每次响应都告诉 Agent 下一步做什么）
- **5 个搜索引擎**（Scraper API 集成完成后）vs 竞品的 1 个
- **丰富的爬虫库**（Amazon、YouTube、LinkedIn 等）— MCP 扩展的巨大潜力
- **195 国地理定位** — 代理基础设施
- **批量提取**（10 个 URL 并行）— Tavily 没有

**竞品有但我们还没有的：**
- Firecrawl：自主浏览器 Agent（FIRE-1）、JSON Schema 结构化提取、异步爬取 + 轮询
- Tavily：AI 智能相关性排序

**获得结果端点后的计划：**
1. 将 `novada_search` 迁移到 Scraper API — 为 Agent 解锁 4 个引擎
2. `novada_research` 支持多引擎并行搜索 — 独特能力
3. 逐步将更多爬虫（Amazon、YouTube、LinkedIn）暴露为 MCP 工具

---

## 问题 4（高）：爬虫库 — 哪些爬虫实际可用？

### 问题说明

Novada 控制台显示大量爬虫（Google、Bing、DDG、Yandex、Amazon、YouTube、LinkedIn、TikTok、GitHub、eBay、Walmart、IKEA 等）。但我们目前无法验证哪些爬虫真正能产出结果，哪些只是接受请求但不返回数据。

**我们今天能验证的：**

| 类别 | 观察结果 | 这证明了什么 |
|------|---------|------------|
| Google/Bing/DDG/Yandex 返回 `task_id` | API 接受了请求 | **不能**证明爬虫实际完成并返回数据 |
| Yahoo 返回 `11006 Scraper error` | API 拒绝了请求 | 可能是 scraper_id 错误，也可能是爬虫不可用 |
| Amazon/YouTube/LinkedIn 等返回 `11006` | API 拒绝了请求 | 我们猜测了 scraper_id — 可能参数错误，也可能不可用 |

**我们无法验证的：**
- 返回 `task_id` 的任务是否真正完成并产生搜索结果
- `11006` 错误是参数问题还是爬虫本身不可用
- 爬虫库中哪些是生产就绪的，哪些是实验性/计划中的

### 为什么这很重要

如果我们把爬虫暴露为 MCP 工具，Agent 发现它们不返回数据后，会对整个 Novada MCP 失去信任 — 不仅仅是那个坏掉的爬虫。这和我们发现的 5 引擎搜索问题一样：**宣传了实际不可用的功能，对信誉的损害比功能少但全部可用要大得多。**

### 我们需要的

1. **状态矩阵：** 爬虫库中哪些是生产就绪、哪些是测试版、哪些是计划中？
2. **每个可用爬虫的正确 scraper_id + 必填参数**
3. **预期任务完成时间**（秒级？分钟级？）
4. 如果可能：**健康检查端点**（`GET /scrapers/status`），让 MCP 动态知道哪些爬虫可用

---

## 需要回复的问题汇总

| # | 问题 | 优先级 | 影响 |
|---|------|-------|------|
| 1 | Scraper API 结果获取端点 | **关键** | 为所有 AI Agent 解锁 4 个搜索引擎 |
| 2 | 搜索引擎完整 scraper_id 列表 | 高 | 确保集成参数正确 |
| 3 | scraperapi.novada.com 是否弃用 | 中 | 架构决策 |
| 4 | 爬虫库可用状态矩阵 | 高 | 决定哪些爬虫暴露给 Agent，哪些隐藏 |

Novada 产品基础设施有很强的潜力。这些答案将帮助我们有信心地完成 MCP 集成 — 只暴露真正可用的功能，同时规划后续路线图。

---

*Novada MCP v0.6.5 — 已发布到 npm，上架 Smithery + LobeHub。117 个测试通过。*
