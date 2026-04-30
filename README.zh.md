<p align="center">
  <h1 align="center">Novada MCP 服务器</h1>
  <p align="center"><strong>在任意 AI 智能体或终端中搜索、提取、爬取、映射和研究网络内容。</strong></p>
  <p align="center">由 <a href="https://www.novada.com">novada.com</a> 提供支持 — 覆盖 195 个国家的 1 亿+ 代理 IP。</p>
</p>

<p align="center">
  <a href="https://www.novada.com"><img src="https://img.shields.io/badge/novada.com-获取密钥-ff6b35?style=for-the-badge" alt="novada.com"></a>
  <a href="https://www.npmjs.com/package/novada-search"><img src="https://img.shields.io/npm/v/novada-search?style=for-the-badge&label=MCP&color=blue" alt="npm 版本"></a>
  <a href="https://lobehub.com/mcp/goldentrii-novada-search"><img src="https://lobehub.com/badge/mcp/goldentrii-novada-search" alt="MCP 徽章"></a>
  <a href="https://smithery.ai/server/novada-search"><img src="https://img.shields.io/badge/Smithery-一键安装-8B5CF6?style=for-the-badge" alt="Smithery"></a>
  <a href="#工具"><img src="https://img.shields.io/badge/工具数-11-brightgreen?style=for-the-badge" alt="11 个工具"></a>
  <a href="#nova--命令行工具"><img src="https://img.shields.io/badge/CLI-nova-blueviolet?style=for-the-badge" alt="CLI nova"></a>
  <a href="https://www.novada.com"><img src="https://img.shields.io/badge/代理IP-1亿+-red?style=for-the-badge" alt="1亿+ 代理 IP"></a>
  <a href="https://www.novada.com"><img src="https://img.shields.io/badge/国家覆盖-195-cyan?style=for-the-badge" alt="195 个国家"></a>
  <img src="https://img.shields.io/badge/测试用例-460-green?style=for-the-badge" alt="460 个测试">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/许可证-MIT-yellow?style=for-the-badge" alt="MIT 许可证"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/novada-search"><img src="https://img.shields.io/npm/dt/novada-search" alt="下载量"></a>
  <a href="https://github.com/NovadaLabs/novada-search"><img src="https://img.shields.io/github/stars/NovadaLabs/novada-search?style=social" alt="收藏量"></a>
</p>

<p align="center">
  <strong>语言：</strong>
  <a href="README.md">English</a> &nbsp;·&nbsp; 中文
</p>

---

**快速跳转：** [快速开始](#快速开始) · [工具](#工具) · [真实示例](#真实输出示例) · [用例](#用例) · [为什么选择 Novada](#为什么选择-novada)

---

## `nova` — 命令行工具

```bash
npm install -g novada-search
export NOVADA_API_KEY=你的密钥    # 在 novada.com 免费获取
```

```bash
nova search "东京最好的餐厅" --country jp
nova search "AI 融资新闻" --time week --include "techcrunch.com,wired.com"
nova extract https://example.com
nova crawl https://docs.example.com --max-pages 10 --select "/api/.*"
nova map https://docs.example.com --search "webhook" --max-depth 3
nova research "AI 代理如何使用网络抓取？" --depth deep --focus "生产环境用例"
```

---

## 快速开始

### Claude Code（一条命令）

```bash
claude mcp add novada -e NOVADA_API_KEY=你的密钥 -- npx -y novada-search
```

所有项目生效（`--scope user`）：
```bash
claude mcp add --scope user novada -e NOVADA_API_KEY=你的密钥 -- npx -y novada-search
```

### Smithery（一键安装）

通过 [Smithery](https://smithery.ai/server/novada-search) 安装，支持 Claude Desktop、Cursor、VS Code、Windsurf 等客户端。

```bash
npx -y @smithery/cli install novada-search --client claude
```

<details>
<summary><strong>Cursor / VS Code / Windsurf / Claude Desktop — 手动配置</strong></summary>

**Cursor** — `.cursor/mcp.json`：
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search@latest"],
      "env": { "NOVADA_API_KEY": "你的密钥" }
    }
  }
}
```

**VS Code** — `.vscode/mcp.json`：
```json
{
  "servers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search@latest"],
      "env": { "NOVADA_API_KEY": "你的密钥" }
    }
  }
}
```

**Windsurf** — `~/.codeium/windsurf/mcp_config.json`：
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search@latest"],
      "env": { "NOVADA_API_KEY": "你的密钥" }
    }
  }
}
```

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`：
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search@latest"],
      "env": { "NOVADA_API_KEY": "你的密钥" }
    }
  }
}
```

</details>

<details>
<summary><strong>Python 调用示例</strong></summary>

```python
import subprocess, os

result = subprocess.run(
    ["nova", "search", "AI 代理框架"],
    capture_output=True, text=True,
    env={**os.environ, "NOVADA_API_KEY": "你的密钥"}
)
print(result.stdout)
```

</details>

---

## 真实输出示例

### `nova search "东京最好的餐厅" --country jp`

```
## Search Results
results:5 | engine:google | country:jp

---

### 1. 东京最佳餐厅 2025 — 米其林指南
url: https://guide.michelin.com/en/tokyo-region/restaurants
snippet: 东京拥有全球最多的米其林星级餐厅，推荐寿司次郎、Narisawa、Den...

### 2. 东京前十大餐厅 — TimeOut
url: https://www.timeout.com/tokyo/restaurants/best-restaurants-in-tokyo
snippet: 从顶级怀石料理到平价拉面，2025 年完整榜单...

---
## Agent Hints
- 完整阅读任一结果：使用 `novada_extract` 传入对应 url
- 批量读取多个结果：`novada_extract` 传入 `url=[url1, url2, ...]`
- 深度多源研究：使用 `novada_research`
```

### `nova research "AI 代理如何使用网络抓取？" --depth deep`

```
## Research Report
question: "AI 代理如何使用网络抓取？"
depth:deep (auto-selected) | searches:6 | results:28 | unique_sources:15

---

## 使用的搜索查询
1. AI 代理如何使用网络抓取？
2. ai agents web scraping overview explained
3. ai agents web scraping best practices real world
4. ai agents web scraping challenges limitations
...

## 主要发现
1. **AI 代理正在改变网络抓取的未来**
   https://medium.com/@davidfagb/...
   这些代理能够思考、理解，并适应网页结构的变化...

## 来源列表
1. [AI 代理与网络抓取](https://medium.com/...)

---
## Agent Hints
- 找到 15 个来源，用 `novada_extract` 提取最相关的内容
- 更广覆盖：使用 depth='comprehensive'（8-10 次搜索）
```

### Map → 批量提取工作流

```bash
# 第一步：发现文档站所有页面
nova map https://docs.example.com --search "webhook" --max-depth 3

# 第二步：一次调用批量提取目标页面
nova extract https://docs.example.com/webhooks/events https://docs.example.com/webhooks/retry
```

---

## 工具

### `novada_search` — 网络搜索

通过 Google、Bing、DuckDuckGo、Yahoo 或 Yandex 搜索网络。自动降级：请求的引擎失败时自动切换到可用引擎并告知原因。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `query` | string | 是 | — | 搜索关键词 |
| `engine` | string | 否 | `"google"` | `google` `bing` `duckduckgo` `yahoo` `yandex` |
| `num` | number | 否 | `10` | 结果数量（1–20） |
| `country` | string | 否 | — | 国家代码（`us` `cn` `jp` `de`） |
| `language` | string | 否 | — | 语言代码（`en` `zh` `ja`） |
| `time_range` | string | 否 | — | 时间范围：`day` `week` `month` `year` |
| `start_date` | string | 否 | — | 起始日期 `YYYY-MM-DD` |
| `end_date` | string | 否 | — | 截止日期 `YYYY-MM-DD` |
| `include_domains` | string[] | 否 | — | 只返回这些域名的结果（最多 10 个） |
| `exclude_domains` | string[] | 否 | — | 排除这些域名的结果（最多 10 个） |

### `novada_extract` — 内容提取

提取任意 URL 的主体内容，支持最多 10 个 URL 并行批量提取。内容质量检测自动警告内容过短、语言错误和 CAPTCHA 拦截页。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string \| string[] | 是 | — | 单个 URL 或 URL 数组（最多 10 个，并行处理） |
| `urls` | string[] | 否 | — | URL 数组的别名（最多 10 个）。批量工作流推荐使用此参数传递多个 URL |
| `format` | string | 否 | `"markdown"` | `markdown` `text` `html` |
| `render` | string | 否 | `"auto"` | `auto`（JS 密集时自动升级）· `static`（快速，无 JS）· `render`（Web Unblocker）· `browser`（完整 CDP） |
| `query` | string | 否 | — | 查询上下文，帮助 agent 聚焦相关内容 |
| `fields` | string[] | 否 | — | 指定要提取的字段（如 `["price", "author", "rating"]`，最多 20 个） |
| `max_chars` | number | 否 | — | 返回内容的最大字符数（默认 25000，最大 100000）。常见错误：不要默认设为 100000 |

### `novada_crawl` — 网站爬取

以 BFS 或 DFS 策略并发爬取网站多个页面（最多 20 页），支持路径过滤和自然语言指令。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string | 是 | — | 起始 URL |
| `max_pages` | number | 否 | `5` | 最大爬取页数（1–20） |
| `strategy` | string | 否 | `"bfs"` | `bfs`（广度优先）或 `dfs`（深度优先） |
| `select_paths` | string[] | 否 | — | 正则表达式 — 只爬取匹配路径 |
| `exclude_paths` | string[] | 否 | — | 正则表达式 — 跳过匹配路径 |
| `instructions` | string | 否 | — | 自然语言指令，说明优先爬取哪些页面 |

### `novada_map` — URL 发现

快速发现网站所有 URL，不提取页面内容，速度远快于爬取，适合页面结构探索。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string | 是 | — | 根 URL |
| `search` | string | 否 | — | 按关键词过滤发现的 URL |
| `limit` | number | 否 | `50` | 返回最多 URL 数（1–100） |
| `max_depth` | number | 否 | `2` | BFS 深度上限（1–5） |
| `include_subdomains` | boolean | 否 | `false` | 是否包含子域名 URL |

### `novada_research` — 深度研究

多步骤网络研究：使用主题锚定查询和相关性过滤。并行生成 3–10 个搜索查询，去重去噪，自动移除偏题来源，返回带引用的综合报告。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `question` | string | 是 | — | 研究问题（最少 5 个字符） |
| `depth` | string | 否 | `"auto"` | `auto` `quick` `deep` `comprehensive` |
| `focus` | string | 否 | — | 聚焦方向（如 `"技术实现"` `"市场分析"` `"最新动态"`） |

### `novada_proxy` — 代理凭据

生成即用代理凭据（住宅、移动、ISP、数据中心）。

> **需要：** `NOVADA_PROXY_USER`、`NOVADA_PROXY_PASS`、`NOVADA_PROXY_ENDPOINT` 环境变量。从 [dashboard.novada.com](https://dashboard.novada.com) → Residential Proxies → Endpoint Generator 获取。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `type` | string | 否 | `"residential"` | `residential` `mobile` `isp` `datacenter` |
| `country` | string | 否 | — | ISO 2 字母国家代码（`us` `gb` `de`） |
| `city` | string | 否 | — | 城市级定向（需同时指定 `country`） |
| `session_id` | string | 否 | — | 粘性会话 — 相同 ID 返回同一 IP |
| `format` | string | 否 | `"url"` | `url` · `env`（export 命令）· `curl`（--proxy 参数） |

### `novada_scrape` — 平台结构化数据

从 129 平台（Amazon、Reddit、TikTok、LinkedIn、Google Shopping 等）抓取结构化数据，无需手动解析 HTML。

> **注意：** 需要激活 Scraper API 产品。如果遇到错误 11006，请联系 [novada.com](https://www.novada.com/) 客服。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `platform` | string | 是 | — | 平台域名（如 `amazon.com` `reddit.com` `tiktok.com`） |
| `operation` | string | 是 | — | 操作 ID（如 `amazon_product_by-keywords`） |
| `params` | object | 否 | `{}` | 操作特定参数（如 `{ keyword: "iphone 16", num: 5 }`） |
| `limit` | number | 否 | `20` | 最大记录数（1-100） |
| `format` | string | 否 | `"markdown"` | `markdown` · `json`（结构化记录）。注意：`csv`/`html`/`xlsx` 仅在 `nova` CLI 中可用，不支持 MCP 调用。 |

### `novada_verify` — 事实核查

针对实时网络来源验证一个事实性声明。并行运行 3 次搜索（支持、质疑、中立核查角度），返回结构化裁定。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `claim` | string | 是 | — | 要验证的事实声明（最少 10 个字符） |
| `context` | string | 否 | — | 可选上下文，缩小搜索范围（如 `"截至 2024 年"` `"在美国"`） |

**裁定值：** `supported`（支持）· `unsupported`（不支持）· `contested`（存疑）· `insufficient_data`（数据不足）

### `novada_unblock` — 强制解锁

强制使用 Web Unblocker 或 Browser API CDP 渲染指定 URL。当 `novada_extract` 速度不够快时直接调用。

> **需要：** `NOVADA_WEB_UNBLOCKER_KEY` 或 `NOVADA_BROWSER_WS`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string | 是 | — | 要解锁的 URL |
| `method` | string | 否 | `"render"` | `render`（Web Unblocker）· `browser`（完整 CDP） |

### `novada_browser` — 浏览器自动化

云端浏览器自动化（CDP / Playwright）。每次会话最多 20 个链式操作，适用于需要登录流程、表单填写或截图捕获的场景。

> **需要：** `NOVADA_BROWSER_WS`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `actions` | array | 是 | — | 有序浏览器操作列表（最多 20 个） |

**支持操作：** `navigate`（导航）· `click`（点击）· `type`（输入）· `screenshot`（截图）· `aria_snapshot`（快照）· `evaluate`（执行 JS）· `wait`（等待）· `scroll`（滚动）· `hover`（悬停）· `press_key`（按键）· `select`（选择）

### `novada_health` — 健康检查

检查所有已配置凭据和工具的连通状态，返回各项功能的可用性报告。无需参数。

---

## Prompts 预置工作流

MCP Prompts 是预置工作流模板，在支持的客户端（Claude Desktop、LobeChat 等）中可直接选用，无需手动构造参数。

| Prompt 名称 | 功能描述 | 参数 |
|------------|---------|------|
| `research_topic` | 对任意主题进行深度多源研究，可指定国家和聚焦方向 | `topic`（必填）, `country`, `focus` |
| `extract_and_summarize` | 提取一个或多个 URL 的内容并生成结构化摘要 | `urls`（必填）, `focus` |
| `site_audit` | 映射网站结构，再提取并汇总关键章节 | `url`（必填）, `sections` |
| `scrape_platform_data` | 从指定平台（Amazon、Reddit、TikTok 等）抓取结构化数据 | `platform`（必填）, `data_type`（必填）, `query`（必填） |
| `browser_stateful_workflow` | 在持久会话中执行多步骤浏览器自动化工作流 | `url`（必填）, `workflow`（必填）, `session_id` |

---

## Resources 只读数据

Agent 可以在选择工具之前通过 `novada://` URI 访问的参考数据。

| URI | 内容 |
|-----|------|
| `novada://engines` | 5 个搜索引擎的特性说明和推荐使用场景 |
| `novada://countries` | 195 个国家代码（地理定向搜索参考） |
| `novada://guide` | 工具选择决策树和常用工作流模式 |
| `novada://scraper-platforms` | 129 个平台数据的有效 operation ID 列表 |

---

## 用例

| 用例场景 | 使用工具 | 实现方式 |
|---------|---------|---------|
| **RAG 数据管道** | `search` + `extract` | 搜索 → 批量提取全文 → 存入向量数据库 |
| **AI 智能研究** | `research` | 一次调用 → 多源综合带引用报告 |
| **实时知识补充** | `search` | 获取模型训练截止日期之后的事实 |
| **竞品情报分析** | `crawl` | 爬取竞争对手网站 → 提取内容变化 |
| **商业线索挖掘** | `search` | 结构化的公司/产品列表 |
| **SEO 追踪监控** | `search` | 跨 5 个引擎、195 个国家追踪关键词排名 |
| **网站全面审计** | `map` → `extract` | 发现所有页面，批量提取目标内容 |
| **受信来源过滤** | `search` | `include_domains` 限定可信来源范围 |
| **趋势热点追踪** | `search` | `time_range=week` 只获取最新结果 |

---

## 为什么选择 Novada？

| 功能特性 | Novada | Tavily | Firecrawl | Brave Search |
|---------|--------|--------|-----------|-------------|
| 搜索引擎数量 | **5 个** | 1 个 | 1 个 | 1 个 |
| 搜索自动降级 | **支持** | 无 | 无 | 无 |
| URL 内容提取 | 支持 | 支持 | 支持 | 不支持 |
| 批量提取 | **支持（最多 10 个 URL）** | 不支持 | 支持 | 不支持 |
| 内容质量检测 | **支持** | 无 | 无 | 无 |
| 网站爬取 | BFS/DFS | 支持 | 支持（异步） | 不支持 |
| URL 发现映射 | 支持 | 支持 | 支持 | 不支持 |
| 多源深度研究 | **相关性过滤** | 支持 | 不支持 | 不支持 |
| MCP Prompts | **5 个** | 无 | 无 | 无 |
| MCP Resources | **4 个** | 无 | 无 | 无 |
| 地理定向 | **195 个国家** | 国家参数 | 无 | 国家参数 |
| 域名过滤 | **include/exclude 双向** | 无 | 无 | 无 |
| 反机器人绕过 | **代理 + Web Unblocker** | 无 | 无头浏览器 | 无 |
| 命令行工具 | **`nova` 命令** | 无 | 无 | 无 |
| Agent 引导提示 | **动态、基于每次响应** | 无 | 无 | 无 |

---

## 前置要求

- **API 密钥** — [在 novada.com 免费注册获取](https://www.novada.com/)
- **Node.js** v18+

---

## 关于 Novada

[Novada](https://www.novada.com/) — 面向开发者和 AI 智能体的网络数据基础设施。1亿+ 代理 IP，覆盖 195 个国家，内置反机器人绕过能力。

## 许可证

MIT
