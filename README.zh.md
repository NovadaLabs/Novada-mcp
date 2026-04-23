<p align="center">
  <h1 align="center">Novada MCP 服务器</h1>
  <p align="center"><strong>在任意 AI 智能体或终端中搜索、提取、爬取、映射和研究网络内容。</strong></p>
  <p align="center">由 <a href="https://www.novada.com">novada.com</a> 提供支持 — 覆盖 195 个国家的 1 亿+ 代理 IP。</p>
</p>

<p align="center">
  <a href="https://www.novada.com"><img src="https://img.shields.io/badge/novada.com-获取密钥-ff6b35?style=for-the-badge" alt="novada.com"></a>
  <a href="https://www.npmjs.com/package/novada-mcp"><img src="https://img.shields.io/npm/v/novada-mcp?style=for-the-badge&label=MCP&color=blue" alt="npm 版本"></a>
  <a href="https://lobehub.com/mcp/goldentrii-novada-mcp"><img src="https://lobehub.com/badge/mcp/goldentrii-novada-mcp" alt="MCP 徽章"></a>
  <a href="https://smithery.ai/server/novada-mcp"><img src="https://img.shields.io/badge/Smithery-一键安装-8B5CF6?style=for-the-badge" alt="Smithery"></a>
  <a href="#工具"><img src="https://img.shields.io/badge/工具数-5-brightgreen?style=for-the-badge" alt="5 个工具"></a>
  <a href="#nova--命令行工具"><img src="https://img.shields.io/badge/CLI-nova-blueviolet?style=for-the-badge" alt="CLI nova"></a>
  <a href="https://www.novada.com"><img src="https://img.shields.io/badge/代理IP-1亿+-red?style=for-the-badge" alt="1亿+ 代理 IP"></a>
  <a href="https://www.novada.com"><img src="https://img.shields.io/badge/国家覆盖-195-cyan?style=for-the-badge" alt="195 个国家"></a>
  <img src="https://img.shields.io/badge/测试用例-124-green?style=for-the-badge" alt="124 个测试">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/许可证-MIT-yellow?style=for-the-badge" alt="MIT 许可证"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/novada-mcp"><img src="https://img.shields.io/npm/dt/novada-mcp" alt="下载量"></a>
  <a href="https://github.com/NovadaLabs/novada-mcp"><img src="https://img.shields.io/github/stars/NovadaLabs/novada-mcp?style=social" alt="收藏量"></a>
</p>

<p align="center">
  <strong>语言：</strong>
  <a href="README.md">English</a> &nbsp;·&nbsp; 中文
</p>

---

**快速跳转：** [快速开始](#快速开始) · [工具](#工具) · [v0.7.0 更新](#v070-更新内容) · [真实示例](#真实输出示例) · [用例](#用例) · [为什么选择 Novada](#为什么选择-novada)

---

## v0.7.0 更新内容

**Agent 智能层** — v0.7.0 在原始 API 和 Agent 之间增加了智能层，确保每次响应都是有用的，而不仅仅是"返回了数据"。

- **搜索自动降级**：请求的引擎失败时，自动切换到可用引擎并告知 Agent 发生了什么
- **研究查询锚定**：子查询保持主题一致 —— "production AI agents"不再偏移到制造业/建筑业结果
- **研究相关性过滤**：自动移除偏题来源，元数据显示过滤了多少条
- **内容质量检测**：提取时在元数据头部警告 Agent 内容过短、语言错误（地域重定向）、CAPTCHA 拦截页
- **动态 Agent Hints**：每次响应末尾的引导基于实际返回结果，不再是固定模板
- **Web Unblocker 集成**：通过 Novada Web Unblocker 绕过反爬保护
- **30,000 字符内容上限**：从 8,000 提升，支持完整文档和长文提取
- **124 个测试**，全部通过

---

## `nova` — 命令行工具

```bash
npm install -g novada-mcp
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
claude mcp add novada -e NOVADA_API_KEY=你的密钥 -- npx -y novada-mcp
```

所有项目生效（`--scope user`）：
```bash
claude mcp add --scope user novada -e NOVADA_API_KEY=你的密钥 -- npx -y novada-mcp
```

### Smithery（一键安装）

通过 [Smithery](https://smithery.ai/server/novada-mcp) 安装，支持 Claude Desktop、Cursor、VS Code、Windsurf 等客户端。

```bash
npx -y @smithery/cli install novada-mcp --client claude
```

<details>
<summary><strong>Cursor / VS Code / Windsurf / Claude Desktop — 手动配置</strong></summary>

**Cursor** — `.cursor/mcp.json`：
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-mcp@latest"],
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
      "args": ["-y", "novada-mcp@latest"],
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
      "args": ["-y", "novada-mcp@latest"],
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
      "args": ["-y", "novada-mcp@latest"],
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
| `url` | string \| string[] | 是 | — | 单个 URL 或 URL 数组（最多 10 个） |
| `format` | string | 否 | `"markdown"` | `markdown` `text` `html` |
| `query` | string | 否 | — | 查询上下文，帮助 agent 聚焦相关内容 |

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

---

## Prompts 预置工作流

MCP Prompts 是预置工作流模板，在支持的客户端（Claude Desktop、LobeChat 等）中可直接选用，无需手动构造参数。

| Prompt 名称 | 功能描述 | 参数 |
|------------|---------|------|
| `research_topic` | 对任意主题进行深度多源研究，可指定国家和聚焦方向 | `topic`（必填）, `country`, `focus` |
| `extract_and_summarize` | 提取一个或多个 URL 的内容并生成结构化摘要 | `urls`（必填）, `focus` |
| `site_audit` | 映射网站结构，再提取并汇总关键章节 | `url`（必填）, `sections` |

---

## Resources 只读数据

Agent 可以在选择工具之前通过 `novada://` URI 访问的参考数据。

| URI | 内容 |
|-----|------|
| `novada://engines` | 5 个搜索引擎的特性说明和推荐使用场景 |
| `novada://countries` | 195 个国家代码（地理定向搜索参考） |
| `novada://guide` | 工具选择决策树和常用工作流模式 |

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
| MCP Prompts | **3 个** | 无 | 无 | 无 |
| MCP Resources | **3 个** | 无 | 无 | 无 |
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
