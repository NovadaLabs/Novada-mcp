# 给 fudong 的开放问题清单(KR-6 集成)

> 背景:2026-06-05 你确认 developer-api 端点统一用 `multipart/form-data`。我们这边已经把中央 HTTP helper 改成 multipart,`/v1/proxy_account/create` 和 `/v1/proxy_account/list` 两个工具的字段名也按文档校准了(`account`/`limit`/必填 `product` 等)。
>
> 但在审计剩下 6 个工具时,发现一些**文档里没明确说**的地方,以下 7 个问题需要你拍板,我才能把这部分写"对"而不是"猜"。
>
> 不阻塞你 —— 我已经在 MCP 这边给所有 8 个工具写了独立 smoke 脚本,跑起来会原样打印请求/响应,你看输出就能反推到底哪边对。但下面这几个先口头确认会更稳。

---

## 1. `/v1/capture/logs` 这条 path 存在吗?

我们 MCP 工具叫 `novada_capture_logs`,目前打 `POST /v1/capture/logs`,字段 `{page, page_size, start_time?, end_time?, status?}`。**这条路径在抓到的 API docs 里没见过**。

**确认:**
- (a) 路径是不是 `/v1/capture/logs`?如果不是,正确路径是什么?
- (b) 字段是否就是 `{page, page_size}` ?还是用 `limit` 替代 `page_size`?(因为不同端点不一致,`wallet/usage_record` 是 `page_size`,`proxy_account/list` 是 `limit`)
- (c) 有 `status` 这个过滤参数吗?

---

## 2. `mobile_flow` 端点存在吗?

KR-6 里我们假设有:
- `POST /v1/mobile_flow/balance`
- `POST /v1/mobile_flow/consume_log`

文档里**没有** mobile_flow 相关条目,虽然产品代码表里有 product=9 = Mobile。

**确认:** mobile 产品是不是用 `_flow` 端点?或者它是其他形态(类似 `mobile_house/*`)?

---

## 3. `static_flow` 端点存在吗?

同上,我们假设有:
- `POST /v1/static_flow/balance`
- `POST /v1/static_flow/consume_log`

但文档里看到的 static 相关端点是 `/v1/static_house/*`(IP 开通/列表/续费,基于 IP 不基于流量)。

**确认:** static 产品到底是流量计费(有 `_flow` 端点)还是 IP 计费(只有 `static_house`)?如果是后者,我把 traffic_daily / plan_balance_all 里的 static 项移除。

---

## 4. `/v1/capture/get_balance` 响应体 shape

实测返回是 `{"code":0, "data": 39.46, "msg":"success"}` —— `data` 是裸 number(credits)。

**确认:** `data` 永远是裸 number,还是有时候返回 `{"balance": 39.46, "expire_time": ...}` 这种 object 形式?(影响 MCP 这边怎么解析。)

---

## 5. `strat_time` 这个拼写错误是真的吗?

部分端点的 docs 里写的是 `strat_time`(把 start 拼成 strat 了)。我们的 helper 现在 **同时发** `start_time` 和 `strat_time` 两个 key 做 forward-compat。

**确认:**
- 服务器到底吃哪个?
- 是不是所有 `consume_log` / usage_record 端点都有这个 typo,还是只有部分?
- 如果都改成 `start_time`,我可以把这个 shim 去掉。

---

## 6. `consume_log` 响应每一行的字段名

`/v1/{residential,isp,datacenter}_flow/consume_log` 文档只说"200 = consumption log entries",没说每行长什么样。我们的 MCP 工具 `traffic_daily` 现在猜了 5 个候选字段名做求和:
```
traffic_mb || mb || consume_mb || total_mb || value
```

**确认:** 每行的流量字段实际叫什么?单位是 MB 还是 bytes?如果全猜错,`total_mb_across_products` 永远是 0(虽然 raw 数据用户还能看到)。

---

## 7. `/v1/wallet/balance` GET 还是 POST?

2026-06-03 的 smoke 用 GET 跑通了(返回正确余额),但 docs 上写 "所有端点都是 POST"。MCP 这边现在是 POST。

**确认:** POST 是不是标准?GET 是不是只是兼容?长期建议哪个?

---

## 不阻塞 fudong 的事项(给你 FYI,我们这边已经处理掉)

- ✅ 把全部 8 个 KR-6 工具的请求体从 `application/json` 改成 `multipart/form-data`(2026-06-05 完成)
- ✅ `proxy_account/create`:字段名修正 `username → account`,`traffic_limit_mb → limit_flow`,补上必填 `product`/`status`
- ✅ `proxy_account/list`:字段名修正 `page_size → limit`,`username → account`,补上必填 `product`
- ✅ 全部代码 `tsc --noEmit` + `npm run build` 通过
- ✅ Smoke 脚本就绪(见 `workspace/kr6-smoke/`),你或我们随时可以跑(只要 `NOVADA_DEVELOPER_API_KEY` 在手)

---

**最理想的 fudong 回复格式:** 每个问题 1-2 行答案就够,不用展开。我这边收到 7 个答案后,大概 30 分钟之内可以把剩下的 fix 一次落定 + 把 7 个 smoke 全跑绿。
