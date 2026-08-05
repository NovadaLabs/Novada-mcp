# MCP 日志上报 — 状态字段取值说明

> 配套文档：`mcp_log_create_接口文档.md`（接口契约）。本文件只讲 **MCP 侧实际发出去的状态类字段取值**，供做测试服务器 / 落库 / 控制台展示的同学建列与映射。
>
> **取值来源（唯一权威）**：novada-mcp 仓库源码，非文档口径。
> - `status_bucket` 折叠逻辑：`hosted-server/vercel/api/_hq_push.ts` → `hqStatusBucket()`
> - `error_code` 枚举：`npm-package/src/_core/errors.ts` → `NovadaErrorCode`
> - `failure_class` 映射：同文件 `FAILURE_CLASS` 表
> - 出站 payload 构造：`_hq_push.ts` → `buildHqPayload()`
>
> 所有取值均为 **英文小写串**。不是中文，不是数字枚举。中文标签由你的展示层自行映射。

---

## 1. `status_bucket` — 客户可见状态（必发，3 个值）

我们出站前会把内部细粒度状态折叠成下面 3 个桶，你收到的**永远只有这 3 个串**：

| 值 | 含义 | 归属 |
| --- | --- | --- |
| `success` | 调用成功 | — |
| `client_error` | 客户侧可修正：参数错 / apikey 无效 / 限流 / 目标错 / 产品不可用 / 被拦截 | 客户 |
| `server_error` | Novada 侧问题：上游宕机 / 代理鉴权失败 / gateway 超时 / 会话过期 / 未分类兜底 | 我们 |

> ⚠️ 我们**不发** `处理中`/`pending`、`不适用`/`not_applicable` 作为独立值——上报发生在调用完成之后，`not_applicable` 已折进 `client_error`。任何未显式映射的结局一律落 `server_error`，绝不落 `success`。

---

## 2. `error_code` — 内部错误码（13 个，**成功时发空串 `""`**）

比 `status_bucket` 更细，供排查用。第 3 列是它折进哪个 `status_bucket`：

| error_code | 含义 | 折进 status_bucket |
| --- | --- | --- |
| `INVALID_API_KEY` | apikey 无效或缺失 | `client_error` |
| `INVALID_PARAMS` | 入参非法 / 缺必填字段 | `client_error` |
| `WRONG_TARGET` | 工具用错对象（平台 / 目标类型不对） | `client_error` |
| `PRODUCT_UNAVAILABLE` | 该产品 / 操作当前不可用（如后端维护） | `client_error` |
| `URL_UNREACHABLE` | 目标 URL 打不开 / 无响应 | `client_error` |
| `RATE_LIMITED` | 触发限流（调用太快） | `client_error` |
| `TASK_NOT_FOUND` | 异步任务 id 找不到 | `client_error` |
| `API_DOWN` | 上游 Novada API 宕机 | `server_error` |
| `PROXY_AUTH_FAILURE` | 代理鉴权失败 | `server_error` |
| `SESSION_EXPIRED` | 会话过期，需重建 | `server_error` |
| `SPA_NO_URLS_FOUND` | SPA 页面没抓到任何 URL | `server_error` ※兜底 |
| `TASK_PENDING` | 异步任务仍在执行 | `server_error` ※兜底 |
| `UNKNOWN` | 未分类错误 | `server_error` ※兜底 |

※ 兜底 = 代码里未显式映射，统一落 `server_error`。

---

## 3. `failure_class` — 失败大类（4 个，**成功时发空串 `""`**）

每个 `error_code` 附带一个，供聚合 / 告警分层：

| failure_class | 含义 | `retryable` 倾向 |
| --- | --- | --- |
| `auth` | 鉴权类（apikey / 代理凭证） | `0` 不可重试 |
| `quota` | 配额 / 限流类 | `1` 可重试 |
| `transient` | 瞬时故障 | `1` 可重试 |
| `permanent` | 永久错，重试无意义 | `0` 不可重试 |

**error_code → failure_class 对照：**

| failure_class | 覆盖的 error_code |
| --- | --- |
| `auth` | `INVALID_API_KEY`, `PROXY_AUTH_FAILURE` |
| `quota` | `RATE_LIMITED` |
| `transient` | `URL_UNREACHABLE`, `API_DOWN`, `TASK_PENDING` |
| `permanent` | `INVALID_PARAMS`, `WRONG_TARGET`, `PRODUCT_UNAVAILABLE`, `TASK_NOT_FOUND`, `SESSION_EXPIRED`, `SPA_NO_URLS_FOUND`, `UNKNOWN` |

---

## 4. 建列/落库注意（易踩坑）

- `retryable` / `charged` 发的是 **int `0/1`**，不是布尔 `true/false`。
- 可选字段的空值统一发 **空串 `""`**，不是 JSON `null`（对齐契约文档「成功时传空字符串」的约定）——`error_code` / `failure_class` / `operation` / `product` 等成功时都是 `""`。
- 出站 payload 共 **17 个字段**，**不含 `key_version`**。若你按 `key_version` 建了必填列，会一直收到空——请确认该字段留还是删。
