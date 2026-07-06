# How to test — Novada MCP internal test repo / 内部测试仓库使用说明

**Repo:** `NovadaLabs/test-novada-mcp-test` (private, internal only / 私有,仅内部)

## The whole model in one line / 一句话模型
**`staging` = the latest internal version. Test it. When we confirm it's good, we ship that exact version to the public repo for customers.**
**`staging` = 最新内部版。测它。确认没问题后,我们把这个确切版本发到公开仓库给客户。**

## Two branches, that's all / 只有两个分支
| Branch 分支 | What it is 是什么 |
|---|---|
| **`staging`** | **The latest — this is what you test. 最新版,你要测的就是它。** |
| `main` | Mirror of what's already public (customers have this). 已发布给客户的镜像。 |

No `fix/*` branches here anymore — feature work stays on our local machines until it's reviewed and folded into `staging`.
这里不再有 `fix/*` 分支——功能开发留在本地,review 通过后才并入 `staging`。

## How to test / 怎么测
```bash
git clone https://github.com/NovadaLabs/test-novada-mcp-test.git
cd test-novada-mcp-test
git checkout staging          # ← the latest / 最新版
npm ci && npm run build
npm run test                  # 37 pre-existing failures are expected (infra/mock) / 37 个已知失败是预期的
# then point your MCP client at build/index.js and try the tools
# 然后把 MCP client 指到 build/index.js,试各个工具
```
Found a bug? File it in Linear (project: **MCP — Hosted + Tools + Optimization**) and mention the `staging` commit SHA.
发现 bug?在 Linear(项目:**MCP — Hosted + Tools + Optimization**)开 issue,附上 `staging` 的 commit SHA。

## ⚠️ Before you trust a result / 测之前请注意
- **`monitor` is preview only** — its deepest layer is a known-incomplete heuristic pending an architecture decision. Test it, but don't treat monitor as final. / `monitor` 是预览版,最深层是已知不完整的启发式,待架构决策。可以测,但别当最终版。
- **`staging` is NOT what customers have.** It is ahead of public. Nothing here reaches customers until we deliberately promote it. / `staging` 不是客户手上的版本,它领先于公开版。任何东西都要经过我们主动促进才会到客户。

## Lifecycle / 生命周期
```
local fix branches (review) ──▶ staging (test repo = latest, team tests) ──▶ public repo (customers)
本地 fix 分支(评审)     ──▶ staging(测试仓 = 最新,团队测)      ──▶ 公开仓库(客户)
```
Promotion to public is a deliberate, approved step (version bump + final review + credential rotation). It never happens automatically.
促进到公开是主动、需批准的一步(版本号 + 终审 + 密钥轮换),绝不自动发生。
