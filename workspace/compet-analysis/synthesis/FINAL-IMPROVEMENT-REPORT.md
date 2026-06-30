# novada-mcp 竞品对标改进报告
生成时间：2026-06-24 | 基于 20 个并行 agent 分析

---

## TL;DR

- **分发是第一问题**：npm 1,253 次/月 vs Firecrawl 494K。产品已有竞争力，可见性不够。
- **产品能力**：91.3% 提取率，质量差距 7.5 vs 8.9 可靠代码修复缩小到 8.5+，anti-bot 20% 差距 60% 是代码问题可修。
- **Firecrawl "100% 反爬"是假的**：Proxyway 独立测试 33.69%，倒数第一。Scrapfly 98% 才是真对标。
- **分发/文档/UX 改进 ROI 远高于继续堆功能**。

---

## P0 — 立即修复（< 2h，高影响）

| # | 问题 | 文件:行 | 影响 |
|---|------|---------|------|
| 1 | **github.com INC-142 routing bug** | `domains.ts` | 基准测试 +1 URL (0→100%) |
| 2 | **search 过滤参数被静默丢弃**：`time_range`/`start_date`/`end_date`/`country`/`language` 存入 `cleaned` 变量但从不使用 | `search.ts` | 用户传参失效，无错误提示 |
| 3 | **`novada_unblock` 文档 3 个未实现参数**（`wait_ms`, `block_resources`, `auto_runs`）误导 agent | `index.ts` | Agent UX CRITICAL |
| 4 | **"129 platforms" vs "13 active" 矛盾**出现在 4 处（MCP description, discover.ts, health.ts, novada://guide） | 多文件 | Agent trust erosion |
| 5 | **proxy_static.ts + proxy_dedicated.ts 明文 proxyPass**（其他 5 个工具用 `***` 遮掩）| `proxy_static.ts:~L60`, `proxy_dedicated.ts:~L60` | 安全漏洞 |
| 6 | **`routeFetch` 完全忽略 `DOMAIN_REGISTRY`**：browser 域名走 unblock/crawl 时经历 static→render→browser 三层再落地 | `router.ts` | ~20% 不必要 escalation，延迟 + 费用浪费 |

---

## P1 — 本周修复（中等工作量，大影响）

### HTML 提取质量 7.5 → 8.5+
| 修复 | 影响 |
|------|------|
| BOILERPLATE_SELECTORS 移入 semantic selector 路径（不只在 body fallback 执行） | 最高影响，去除 main/article 内残余导航 |
| 删除无条件 `<form>` 移除，改为条件判断 | 恢复 GitHub content、评论区 |
| `<ol>` 有序列表改为 `1.` 格式（现输出为 `- ` bullets） | 列表语义正确 |
| 代码块保留语言 hint（现在 ` ```python ` 被剥为 ` ``` `） | AI 代码渲染正确 |
| Markdown 转义（asterisks/underscores 在纯文本中污染输出） | 输出合法性 |
| `<header>` 改为条件移除（现在 hard-remove，Medium/Substack 文章 title 消失） | 恢复 article title |
| `<img>` 转为 `![alt](src)` markdown（现在完全丢弃）| 图片语义 |
| 长远：引入 `@mozilla/readability` 作为低密度页面 fallback | 质量分 8.5→8.9 |

### Browser 反爬 Stealth（+5% anti-bot 成功率）
```typescript
// browser.ts:138 — 加两行：
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  (window as any).chrome = { runtime: {} };
});
// browser.ts:149 — 改 waitUntil:
await page.waitForLoadState('networkidle');  // 非 domcontentloaded
```

### Search 延迟优化（P50 -400ms，零后端改动）
1. **300ms pre-wait** 在第一次 poll 前（现在 100ms 触发，后端未就绪，浪费 2-3 次 round-trip）
2. **60s in-memory dedup cache** keyed on `(engine, query, num)` — 重复查询直接命中
3. `search.ts` 超时常量迁移到 `config.ts:TIMEOUTS`，消除维护双副本

### fetchWithRetry 加 jitter
```typescript
// 当前：纯指数 1s/2s/4s — thundering herd 风险
// 改为：full jitter
const jitter = Math.random() * baseDelay;
await sleep(Math.min(jitter, maxDelay));
```

### 3 处 router.ts 吞掉的 browser fallback 错误
`catch {}` 块改为 `catch (err) { lastError = err; }`，确保 `render-failed` 时 agent 看到 browser 也尝试并失败。

---

## P2 — 下两周（较大工作量，中等影响）

### TLS 指纹伪装（+8% anti-bot）
使用 `tls-client` npm 包（Go tls-client wrapper），Chrome JA3 fingerprint impersonation。
现在 axios 的 JA3 hash 在所有主流 WAF 黑名单里。

### cf_clearance Cookie 池
Browser API session 成功后，保存 `cf_clearance` cookie，复用给同域名后续请求。
每个 Cloudflare 域名节省一次 5s challenge。

### Domain routing session 缓存
Session 内记录 `domain → last_successful_tier`，下次调用直接跳到成功层，消除重试链。

### HTTP connection pooling
```typescript
// http.ts — 全局 Agent（现在无 httpAgent，每次重建 TCP/TLS）
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });
// 传入所有 axios 调用
```

### LLM 提取端点（Firecrawl 最大差距之一）
`novada_extract` 加 `llm` 模式：用 LLM 从任意 URL + JSON Schema 提取结构化数据。
Firecrawl 的 FIRE-1 是核心卖点，我们完全没有。

---

## P3 — Tool Description 改进（低技术难度，高 agent 体验 ROI）

| 改进 | 具体行动 |
|------|---------|
| **Format decision trees** | 在 `novada_extract` 描述加 CRITICAL 块："当要提取特定字段时（价格/作者/标题），MUST 用 `fields` 参数而非解析全 markdown" |
| **参数命名统一** | 全面统一为 snake_case（Firecrawl 统一 camelCase，我们现在混用） |
| **outputSchema 支持** | MCP spec 2025-06-18 新特性，`novada_scrape`/`novada_search` 先加 |
| **MCP prompts** | 加 2 个 prompt（像 BrightData）给 agent 工具选择决策树 |
| **`novada_monitor` 警告前置** | "⚠️ 数据仅在本 session 有效，重启丢失" 移到描述第一行 |
| **`novada_scraper_submit` 列出合法 scraper_type** | 现在 agent 只能猜 |

---

## P4 — 产品层（需要团队决策）

| 项目 | 优先级 | 说明 |
|------|--------|------|
| **Feedback flywheel** (`novada_search_feedback`) | HIGH | Firecrawl 用 1-credit 退款激励 agent 提交反馈，大规模采集使用数据。我们完全没有。 |
| **Hosted mcp.novada.com** | HIGH | Streamable HTTP + OAuth 2.1 + JWT session。Render.com（非 Vercel，cold start 断 SSE）。BrightData 有，我们没有。 |
| **`session_stats` 工具** | MEDIUM | Agent 查询自己的用量（BrightData 有）。Cost-aware agent behavior 的前提。 |
| **`generate_schema` 工具** | MEDIUM | 让 agent 先生成提取 schema 再调 scraper（Oxylabs 有）。 |
| **Per-request telemetry headers** | MEDIUM | `x-mcp-tool`/`x-mcp-client-name`，后端知道哪个工具触发请求。 |
| **Progress notifications** | MEDIUM | `notifications/progress` for crawl/research（MCP spec 原生支持）。 |
| **`ai_browser_agent` 工具** | LOW | 单次调用目标导向浏览器自动化（Oxylabs 有）。 |
| **Platform coverage 扩展** | LOW | Reddit, Glassdoor, LinkedIn profiles, Yelp, Indeed, Airbnb — BrightData 700+，我们 13。 |

---

## 分发 vs 产品 优先级

**核心结论**：npm 1,253 vs 494K（395×差距）说明分发才是第一问题。

```
产品改进 ROI ≈ 1 (质量从 7.5 → 8.9，用户从 X 到 1.01X)
分发改进 ROI ≈ 100 (用户从 X 到 10-50X)
```

攻击面：
- Firecrawl credit multiplier（AI extraction = 5× credits）用户积极抱怨，r/codex 有人主动切换
- Firecrawl 真实反爬表现 33.69%（我们在简单测试的 80%、Scrapfly 的 98% 之间）
- Novada 价格 4-5× 优势是真实的

**分发行动项（非代码）**：
1. GitHub stars 2 → 需要 Show HN / Hacker News / Reddit 发帖
2. npm 教程文档（INC-160）— Zoey 放官网
3. 控制台 MCP 模块（INC-163）— 最快的新用户入口

---

## 竞品对比总结

| 维度 | Novada | Firecrawl | Tavily | BrightData | Oxylabs |
|------|--------|-----------|--------|------------|---------|
| 整体提取率 | 91.3% | 92.5% | 86.3% | N/A | N/A |
| 反爬（真实测试） | ~80% | **33.69%**（Proxyway） | ~85% | N/A | N/A |
| P50 延迟 | 7,102ms | 761ms | 376ms | N/A | N/A |
| 内容质量 | 7.5/10 | 8.9/10 | 8.8/10 | N/A | N/A |
| 成本/1K | **$1** ✅ | $4 | $5 | 高 | 高 |
| agent_instruction 错误 | ✅ 最优 | ❌ throw Error | ❌ plain text | 部分 | 部分 |
| Hosted MCP | ❌ | ❌ | ✅ | ✅ | ❌ |
| Feedback flywheel | ❌ | ✅ | ❌ | ❌ | ❌ |
| LLM extraction | ❌ | ✅ FIRE-1 | ❌ | ❌ | ❌ |
| npm 月下载 | 1,253 | 494K | 179K | N/A | N/A |
| Proxy 深度 | ✅ 6种 | ❌ | ❌ | 1-2种 | 1-2种 |

---

*Report generated from 20 parallel agents | 2026-06-24*
