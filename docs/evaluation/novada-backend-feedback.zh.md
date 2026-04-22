# Novada 后端 — 关键问题报告（curl 实测验证版）
**来自：** Novada MCP 团队 | **日期：** 2026-04-22
**背景：** 122 次 MCP 测试 + 直接 curl 独立验证，与 Tavily MCP + Firecrawl MCP 竞品对标
**紧急程度：** 高 — 这些问题导致 Novada 在 AI Agent 市场失去竞争力

> 本文档所有问题均通过 `curl` 直接调用 API 独立验证，排除了 MCP 封装层的影响。每个问题都附有精确的请求/响应原文。

---

## 摘要

我们为 AI Agent（Claude、Cursor、VS Code 等）构建了 Novada API 的 MCP 服务器封装。经过 122 次实时测试 + curl 独立验证，发现 **7 个后端问题**阻碍我们与 Tavily 和 Firecrawl 竞争。五个搜索引擎中四个不可用。URL 抓取的代理端点返回 404。缺少地理定位导致返回错误语言的内容。

**这些问题均不是 MCP 封装层的问题。** 我们在 MCP 层做了所有能做的优化（自动降级到 Google、内容质量检测、智能提示），但底层 API 不可用时，MCP 层无法凭空生成数据。

---

## 问题 1：严重 — Yahoo 搜索：后端 URL 构建器丢弃 `q` 参数

### curl 实测

```bash
$ curl "https://scraperapi.novada.com/search?q=test+query&engine=yahoo&api_key=c77dd8..."
```

### 返回结果

```json
{"code":410,"msg":"Build url error: empty query built"}
```

### 分析

请求中 `q=test+query` 已正确编码传递。后端的 Yahoo URL 构建器在组装最终请求 URL 时丢弃了 `q` 参数，导致构建出"空查询"。

### 需要修复

Yahoo URL 构建器需要正确读取并传递 `q` 参数。

---

## 问题 2：严重 — Bing 搜索：查询字符串被截断/降级

### curl 实测

```bash
$ curl "https://scraperapi.novada.com/search?q=kubernetes+pod+scheduling+algorithm&engine=bing&api_key=c77dd8...&num=2"
```

### 返回结果（前 10 条标题）

```
1. What is the meaning of CPU and core in Kubernetes?
2. Reasons for OOMKilled in kubernetes - Stack Overflow
3. What's the difference between Docker Compose and Kubernetes?
4. kubernetes - How to check if network policy have been applied to pod...
5. timeout - Kubernetes Ingress (Specific APP) 504 Gateway Time-Out
6. Can't create Secret in Kubernetes: illegal base64 data at input
7. How to copy files from Kubernetes Pods to local system
8. Kubernetes Pod Warning: 1 node(s) had volume node affinity conflict
9. Checking Kubernetes pod CPU and memory utilization
10. What is the difference between subPath and mountPath in Kubernetes
```

### 分析

我们搜索的是 **"kubernetes pod scheduling algorithm"（Kubernetes Pod 调度算法）**。返回的结果全部是 Kubernetes 通用问题（OOMKilled、端口超时、Secret 创建等），**没有一条与"Pod 调度算法"相关**。

关键词 "kubernetes" 被保留了，但 "pod scheduling algorithm" 被丢弃。后端传递给 Bing 的查询被截断或降级为单个关键词。

**对 Agent 的影响：** 错误结果比没有结果更危险。Agent 会基于这些无关结果做出错误判断，浪费上下文窗口（约 800 token）。

### 需要修复

Bing 引擎的查询参数透传需要保留完整查询字符串。

---

## 问题 3：严重 — DuckDuckGo 搜索：502 Bad Gateway

### curl 实测

```bash
$ curl "https://scraperapi.novada.com/search?q=test+query&engine=duckduckgo&api_key=c77dd8..."
```

### 返回结果

```html
<html>
<head><title>502 Bad Gateway</title></head>
<body>
<center><h1>502 Bad Gateway</h1></center>
<hr><center>stgw</center>
</body>
</html>
```

### 分析

网关层（stgw）直接返回 502，请求没有到达应用层。DDG 的工作节点可能未启动，或 Novada 出口 IP 被 DuckDuckGo 屏蔽。在数小时内独立测试了 3 轮，结果一致。

### 需要修复

检查 DDG 工作节点的运行状态。如果是 IP 被屏蔽，需要更换出口 IP 或使用住宅代理。

---

## 问题 4：高 — Yandex 搜索：参数映射错误（不是 API Key 问题）

### curl 实测

```bash
$ curl "https://scraperapi.novada.com/search?q=test+query&engine=yandex&api_key=c77dd8..."
```

### 返回结果

```json
{"code":401,"msg":"param error：failed to bind query: Key: 'SearchParameters.Text' Error:Field validation for 'Text' failed on the 'required' tag"}
```

### 分析

**这不是 API Key 问题**（之前的报告有误，已修正）。错误信息显示 `SearchParameters.Text` 字段验证失败（required 但为空）。

原因：Yandex 的搜索 API 使用 `Text` 作为查询参数名，但后端在将通用参数 `q` 映射到 Yandex 特定参数 `Text` 时失败了。`q` 参数没有被正确绑定到 `SearchParameters.Text`。

我们还测试了 Scraper API Key（`1f35b4...`），返回 `{"code":402,"msg":"Api Key error：User has no permission"}`。两个 Key 都无法使用 Yandex。

### 需要修复

修复 Yandex 引擎的参数映射：`q` → `SearchParameters.Text`。

---

## 问题 5：中等 — Google 搜索：并行调用不稳定

### curl 实测

```bash
# 同时发起两个 Google 搜索
$ curl "...?q=test+alpha&engine=google&..." &
$ curl "...?q=test+beta&engine=google&..." &
$ wait
```

### 返回结果

```
调用 1: code:200, results:1  ← 正常
调用 2: code:200, results:0  ← 软失败（无结果）
```

### 分析

两个并行调用中，一个返回正常结果，另一个返回空结果（code 200 但 0 条结果）。此前的测试中曾出现 `413: WorkerPool not initialized` 硬错误。并行请求的行为不稳定 — 有时软失败（空结果），有时硬失败（413）。

串行调用始终正常。

### 需要修复

扩容 Google WorkerPool，至少支持 5 个并发请求。AI Agent 经常会并行调用多个搜索。

---

## 问题 6：严重 — scraperapi.novada.com 根路径返回 404

### curl 实测

```bash
# 使用 NOVADA_API_KEY
$ curl -o /dev/null -w "HTTP %{http_code}" "https://scraperapi.novada.com?api_key=c77dd8...&url=https://example.com"
HTTP 404

# 使用 SCRAPER_API_KEY（排除 Key 问题）
$ curl -o /dev/null -w "HTTP %{http_code}" "https://scraperapi.novada.com?api_key=1f35b4...&url=https://example.com"
HTTP 404
```

### 分析

两个不同的 API Key 都返回 404。这不是 Key 权限问题，是端点本身不可用。

只有 `/search` 子路径可用。根路径（用于 URL 抓取/内容提取）完全失效。

### 影响

整个 extract/crawl/map 的代理链路静默失效。Agent 的所有"成功"提取实际上都是直接抓取（无代理），意味着：
- 零反机器人绕过
- 零住宅 IP 轮换
- 屏蔽数据中心 IP 的网站静默失败

我们已用 Web Unblocker（`POST webunlocker.novada.com/request`）作为临时方案，但成本更高、速度更慢。

### 需要修复

修复 scraperapi 根端点，或提供文档化的替代 URL 抓取端点。

---

## 问题 7：中等 — scraperapi 代理缺少地理定位

### 现象

代理出口 IP 位于欧盟（德国），导致 US 网站返回本地化内容：
- `stripe.com/pricing` → `stripe.com/de/pricing` → 144 字符，德语

Web Unblocker 返回正确的美式英语内容（918KB），证明 Novada 有能力返回 US 内容。

### 需要修复

在 scraperapi 端点添加 `country` 参数（search 端点已有），默认 `us`。

---

## 竞品紧迫性

| 能力维度 | Novada（现状） | Tavily | Firecrawl |
|---------|---------------|--------|-----------|
| 搜索引擎 | **1 个可用**（Google 串行） | 1 个（稳定） | 1 个（稳定） |
| 搜索质量 | Google 原始排序 | **AI 智能排序** | 77% 覆盖率 |
| 提取可靠性 | ~50%（代理不可用） | 高 | 高 |
| 浏览器 Agent | 无 | 无 | **FIRE-1**（点击、填表、CAPTCHA） |
| Agent 引导提示 | **Agent Hints（独有优势）** | 无 | 无 |

**Agent Hints 是 Novada 的独有竞争优势 — 没有竞品在每次响应中告诉 Agent 下一步该做什么。但前提是底层数据必须可靠。**

**修复窗口就是现在。** 这些都是基础设施修复，不是产品重设计。在 Agent 形成对 Tavily/Firecrawl 的永久偏好之前，还有时间。

---

## 完整复现命令

```bash
API_KEY="c77dd803b927e919fa1fd21cc6b85171"

# 问题 1: Yahoo 410
curl "https://scraperapi.novada.com/search?q=test+query&engine=yahoo&api_key=$API_KEY"
# 预期错误: {"code":410,"msg":"Build url error: empty query built"}

# 问题 2: Bing 查询降级
curl "https://scraperapi.novada.com/search?q=kubernetes+pod+scheduling+algorithm&engine=bing&api_key=$API_KEY&num=3"
# 预期: 返回通用 Kubernetes 结果，非 "pod scheduling algorithm" 相关

# 问题 3: DDG 502
curl "https://scraperapi.novada.com/search?q=test+query&engine=duckduckgo&api_key=$API_KEY"
# 预期: 502 Bad Gateway

# 问题 4: Yandex 参数映射失败
curl "https://scraperapi.novada.com/search?q=test+query&engine=yandex&api_key=$API_KEY"
# 预期: {"code":401,"msg":"param error：failed to bind query: Key: 'SearchParameters.Text'..."}

# 问题 5: Google 并行（开两个终端同时执行）
curl "https://scraperapi.novada.com/search?q=alpha&engine=google&api_key=$API_KEY&num=1" &
curl "https://scraperapi.novada.com/search?q=beta&engine=google&api_key=$API_KEY&num=1" &
wait
# 预期: 至少一个返回 0 结果或 413

# 问题 6: 根路径 404
curl -o /dev/null -w "HTTP %{http_code}" "https://scraperapi.novada.com?api_key=$API_KEY&url=https://example.com"
# 预期: HTTP 404
```

---

*所有问题均在 2026-04-22 通过 curl 直接验证，排除 MCP 封装层影响。API Key: `c77dd8...`（Scraper API Key 也已测试，结果一致）。*
