# Bug Report：Bing 搜索 API 返回 `data.data=null`，导致客户端无法获取 task_id

**报告人：** Tongwu  
**日期：** 2026-05-20  
**严重等级：** P1（功能性故障，Bing 搜索对所有外部客户端不可用）  
**受影响产品：** Scraper API — `bing_search` 操作

---

## 问题描述

通过 API 调用 Bing 搜索时，服务端返回 `data.data=null`，而非预期的 `data.data.task_id`。由于客户端无法获取 `task_id`，无法通过下载端点拉取结果，导致 Bing 搜索对外部 API 用户**完全不可用**。

**关键矛盾：** 任务实际上已在后台成功创建并完成（Scraping Duration 5-9 秒，Status: Success），但 API 响应中缺失 `task_id`，客户端无从得知。

---

## 复现步骤

使用 Dashboard 文档页面中展示的标准 curl 命令：

```bash
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=bing.com" \
  -d "scraper_id=bing_search" \
  -d "scraper_errors=true" \
  -d "a_auto_push=false" \
  -d "q=apple" \
  -d "json=1" \
  -d "no_cache=false" \
  -d "safe=off"
```

> 注：`a_auto_push=false` 参数来源于 Dashboard API Playground 页面的 Code Example（非 `is_auto_push`）。

---

## 实际返回（有问题）

```json
{
  "code": 0,
  "data": {
    "data": null
  }
}
```

**问题：** `data.data` 为 `null`，没有 `task_id`，没有 HTML，客户端无法继续。

---

## 期望返回

```json
{
  "code": 0,
  "data": {
    "data": {
      "task_id": "5bda779b03ff8e0d04e4b814352de91f"
    }
  }
}
```

---

## 频率与稳定性

在 2026-05-20 的测试中，连续发送 5 次相同请求：

| 请求 # | 返回结果 | 说明 |
|--------|----------|------|
| 1 | `data.data=null` | 失败 |
| 2 | `data.data=null` | 失败 |
| 3 | `data.data={task_id: "..."}` | 成功（"apple stock price" 查询） |
| 4 | `data.data=null` | 失败 |
| 5 | `data.data=null` | 失败 |

**失败率约 67-80%**，偶发性成功说明后端任务调度本身没问题，是 **响应组装阶段** 出现了 race condition 或字段填充遗漏。

---

## 关键证据：任务已创建，但 task_id 未回传

通过 Dashboard 任务列表可以看到两条 Bing 搜索任务（同一 API Key，2026-05-20 12:05）：

| Task ID | 状态 | 消耗 | 下载次数 | 说明 |
|---------|------|------|----------|------|
| `1daae4e771ea57...` | Success | $0 | 0 次 | **API 客户端提交，未获取 task_id** |
| `5bda779b03ff8e...` | Success | $0.0011 | 1 次 | Dashboard UI 提交，正常返回 task_id |

- `1daae4e771ea57...`：任务成功完成、数据已抓取，但 API 响应中 `data.data=null`，客户端无法下载，结果永久搁置。
- `5bda779b03ff8e...`：同一账户通过 Dashboard UI 提交，正确返回 task_id，结果成功下载。

**说明：后端 scraping 逻辑正常，问题出在 API 响应构造层。**

---

## 其他平台对比（同一 API，同一 Key）

为确认是否为 Bing 专属问题，测试了其他平台：

| 平台 | 参数 | `data.data` 返回 | 是否可用 |
|------|------|------------------|----------|
| `bing.com` / `bing_search` | `a_auto_push=false` | `null` | ❌ **BUG** |
| `google.com` / `google_search` | `is_auto_push=false` | `{filename:'', html:'...'}` 同步 HTML | ✅ 正常（同步模式） |
| `duckduckgo.com` / `duckduckgo` | `is_auto_push=false` | `{filename:'', html:'...'}` 同步 HTML | ✅ 正常（同步模式） |
| `amazon.com` / `amazon_product_keywords` | `is_auto_push=false` | `{task_id:'c7a01562...'}` | ✅ 正常（异步模式） |

**结论：`data.data=null` 是 Bing 专属问题，其他平台均正常返回数据或 task_id。**

---

## 根本原因分析（客户端视角推测）

Bing 搜索应走**异步模式**（返回 task_id，客户端轮询下载端点）。但当前行为：

1. 后端接收请求，创建任务（任务 ID 已分配，scraping 开始）
2. API 在 scraping 完成之前就返回了响应
3. 响应构造时 `task_id` 字段尚未填充，写入了 `null`
4. 客户端收到 `data.data=null`，无从得知 task_id

**推测：** Bing scraper 启动速度比 Google/DDG 慢（需要 5-9 秒才能获得 task_id），但 API handler 没有等待 task_id 就提前返回了响应。

---

## 影响

- **外部 MCP 客户端（novada-mcp）**：Bing 搜索完全不可用，用户调用返回空结果
- **所有通过 API 使用 Bing search 的外部用户**：受同等影响
- **Dashboard UI**：不受影响（UI 走不同的请求路径或有内部重试）

---

## 期望修复

**选项 A（推荐）：** 确保 `a_auto_push=false` 时，API handler 等待 task_id 分配后再返回响应，将 `task_id` 填入 `data.data`。

**选项 B：** 在响应中直接返回同步 HTML（与 Google/DDG 行为一致），无需 task_id 轮询流程。

**选项 C：** 返回 `data.task_id`（顶层字段，而非 `data.data.task_id`），客户端配合调整。

---

## 附：可用于验证修复的 curl 命令

```bash
# 修复后，以下命令应稳定返回 task_id（而非 null）
curl -X POST "https://scraper.novada.com/request" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "scraper_name=bing.com" \
  -d "scraper_id=bing_search" \
  -d "scraper_errors=true" \
  -d "a_auto_push=false" \
  -d "q=apple+stock+price" \
  -d "json=1" \
  -d "no_cache=false" \
  -d "safe=off"

# 期望响应：
# {"code":0,"data":{"data":{"task_id":"<some-uuid>"}}}
# 或：{"code":0,"data":{"task_id":"<some-uuid>"}}
# 或：{"code":0,"data":{"data":{"html":"<bing SERP html>"}}}
```

---

*如需提供更多测试数据或协助验证修复，联系：tongwu*
