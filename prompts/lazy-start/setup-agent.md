# 懒人启动 — Novada Auto-Setup Agent Prompt

Copy the prompt below into Claude Code (with Chrome DevTools MCP enabled).
The agent will open your browser, extract your Novada credentials, and wire
everything up automatically — zero manual copy-pasting.

---

## Requirements

- **Claude Code** installed
- **Chrome DevTools MCP** connected to your running Chrome
  ([setup guide](https://github.com/modelcontextprotocol/servers/tree/main/src/chrome-devtools))
- Chrome open and **logged into** [dashboard.novada.com](https://dashboard.novada.com)

> No Chrome DevTools MCP? Use the manual setup in
> [setup-manual.md](./setup-manual.md) instead.

---

## Auto-Setup Prompt (paste into Claude Code)

```
You are a Novada MCP setup agent. Your job is to configure the novada-search
MCP server for this machine by extracting credentials from the Novada dashboard
via the user's existing Chrome session.

## Step 1 — Find or open dashboard.novada.com

1. Call mcp__chrome-devtools__list_pages to see open Chrome tabs.
2. If a tab with "dashboard.novada.com" is already open, select it.
3. If not, call mcp__chrome-devtools__new_page and navigate to
   https://dashboard.novada.com/overview/.
4. Take a screenshot with mcp__chrome-devtools__take_screenshot to confirm
   the page loaded and you are logged in. If a login screen appears, stop and
   tell the user to log in first, then re-run this prompt.

## Step 2 — Extract the API key

1. Navigate to https://dashboard.novada.com/overview/api-keys/ (or equivalent).
2. Take a screenshot.
3. Try to extract the API key value using mcp__chrome-devtools__evaluate_script:
   ```js
   document.querySelector('[data-testid="api-key"], .api-key-value, code, pre')?.textContent
   ```
4. If the selector doesn't work, take a full-page screenshot and read the key
   visually from the screenshot.
5. Store the result as NOVADA_API_KEY.

## Step 3 — Extract proxy credentials

1. Navigate to the proxy credentials page. Try these paths in order:
   - https://dashboard.novada.com/overview/proxy/
   - https://dashboard.novada.com/proxy/
   - https://dashboard.novada.com/proxies/
2. Take a screenshot of the page.
3. Look for these four values on the page (screenshot + JS extraction):
   - Proxy username (format: customer-XXXXX or user-XXXXX)
   - Proxy password
   - Proxy endpoint hostname (e.g., residential.novada.com or proxy.novada.com)
   - Proxy port (typically 7777 or 10000)
4. If a "Generate credentials" button is present, click it and re-screenshot.
5. Store results as:
   - NOVADA_PROXY_USER
   - NOVADA_PROXY_PASS
   - NOVADA_PROXY_ENDPOINT (hostname only, no port)

## Step 4 — Write the MCP configuration

Determine which config file to write based on what exists:

**Option A — Claude Code project (.mcp.json in current directory):**
If a .mcp.json file exists in the current working directory, add or update the
novada entry:
```json
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search"],
      "env": {
        "NOVADA_API_KEY": "<NOVADA_API_KEY>",
        "NOVADA_PROXY_USER": "<NOVADA_PROXY_USER>",
        "NOVADA_PROXY_PASS": "<NOVADA_PROXY_PASS>",
        "NOVADA_PROXY_ENDPOINT": "<NOVADA_PROXY_ENDPOINT>"
      }
    }
  }
}
```

**Option B — Claude Desktop (~/.config/claude/claude_desktop_config.json
or ~/Library/Application Support/Claude/claude_desktop_config.json):**
If .mcp.json doesn't exist, update the Claude Desktop config with the same
structure above.

**Option C — Environment file (.env in current directory):**
If neither config exists, create a .env file:
```
NOVADA_API_KEY=<value>
NOVADA_PROXY_USER=<value>
NOVADA_PROXY_PASS=<value>
NOVADA_PROXY_ENDPOINT=<value>
```
And print the Claude Code install command:
```
claude mcp add novada \
  -e NOVADA_API_KEY=<value> \
  -e NOVADA_PROXY_USER=<value> \
  -e NOVADA_PROXY_PASS=<value> \
  -e NOVADA_PROXY_ENDPOINT=<value> \
  -- npx -y novada-search
```

## Step 5 — Verify the configuration

1. Restart the MCP subprocess: run `pkill -f "novada-search"` in the terminal.
2. Call novada_health (if available) to confirm the API key is active.
3. Call novada_proxy_residential with format="env" to confirm proxy credentials
   are loaded (output should show ${NOVADA_PROXY_PASS} as a shell placeholder,
   not an empty string or error).

## Step 6 — Report results

Print a summary table:
| Credential         | Status   | Source         |
|--------------------|----------|----------------|
| NOVADA_API_KEY     | ✓ set    | API Keys page  |
| NOVADA_PROXY_USER  | ✓ set    | Proxy page     |
| NOVADA_PROXY_PASS  | ✓ set    | Proxy page     |
| NOVADA_PROXY_ENDPOINT | ✓ set | Proxy page     |

If any credential could not be extracted, print a specific error and the
manual fallback URL for that credential.

## Rules
- Never print credentials in plain text to the chat after storing them.
  Use [REDACTED] in the summary table for password fields.
- If a page requires clicking "Reveal" or "Show" to display a credential,
  click it before screenshotting.
- If dashboard.novada.com is unresponsive or gives a 5xx error, stop and
  tell the user to try again later.
- Do not create or modify any files outside .mcp.json, claude_desktop_config.json,
  and .env in the current working directory.
```

---

## Chinese Version / 中文版本

```
你是 Novada MCP 配置助手。你的任务是：通过用户已登录的 Chrome 浏览器，
从 Novada 控制台提取凭证，然后自动配置 novada-search MCP 服务器。

## 第一步 — 找到或打开 dashboard.novada.com

1. 调用 mcp__chrome-devtools__list_pages，查看当前打开的 Chrome 标签页。
2. 如果已有 dashboard.novada.com 的标签页，选择它。
3. 如果没有，调用 mcp__chrome-devtools__new_page，导航到
   https://dashboard.novada.com/overview/
4. 截图确认页面已加载且已登录。若出现登录页面，停止并告知用户先登录，
   然后重新运行此提示词。

## 第二步 — 获取 API Key

1. 导航到 https://dashboard.novada.com/overview/api-keys/
2. 截图。
3. 尝试用 JS 提取 API Key 值：
   document.querySelector('[data-testid="api-key"], .api-key-value, code, pre')?.textContent
4. 若 JS 选择器失效，直接从截图读取 Key 值。
5. 记录为 NOVADA_API_KEY。

## 第三步 — 获取代理凭证

1. 依次尝试以下路径找到代理凭证页面：
   - https://dashboard.novada.com/overview/proxy/
   - https://dashboard.novada.com/proxy/
   - https://dashboard.novada.com/proxies/
2. 截图。
3. 从页面提取以下四个值（截图 + JS 提取均可）：
   - 代理用户名（格式：customer-XXXXX 或 user-XXXXX）
   - 代理密码
   - 代理端点主机名（如 residential.novada.com）
   - 代理端口（通常为 7777 或 10000）
4. 若有"生成凭证"按钮，先点击再截图。
5. 分别记录为 NOVADA_PROXY_USER、NOVADA_PROXY_PASS、NOVADA_PROXY_ENDPOINT。

## 第四步 — 写入 MCP 配置

根据以下优先级写入：

A. 当前目录有 .mcp.json → 在 mcpServers 中添加或更新 novada 条目
B. Claude Desktop 配置文件存在 → 更新 claude_desktop_config.json
C. 两者都没有 → 创建 .env 文件，并输出 claude mcp add 命令

配置格式（A/B 选项）：
{
  "mcpServers": {
    "novada": {
      "command": "npx",
      "args": ["-y", "novada-search"],
      "env": {
        "NOVADA_API_KEY": "<你的Key>",
        "NOVADA_PROXY_USER": "<代理用户名>",
        "NOVADA_PROXY_PASS": "<代理密码>",
        "NOVADA_PROXY_ENDPOINT": "<代理端点>"
      }
    }
  }
}

## 第五步 — 验证配置

1. 执行 pkill -f "novada-search" 重启 MCP 子进程。
2. 调用 novada_health 确认 API Key 有效。
3. 调用 novada_proxy_residential format="env" 确认代理凭证已加载。

## 第六步 — 输出结果摘要

打印以下摘要表格：
| 凭证                  | 状态   | 来源         |
|-----------------------|--------|--------------|
| NOVADA_API_KEY        | ✓ 已设置 | API Keys 页面 |
| NOVADA_PROXY_USER     | ✓ 已设置 | 代理页面      |
| NOVADA_PROXY_PASS     | ✓ 已设置 | 代理页面      |
| NOVADA_PROXY_ENDPOINT | ✓ 已设置 | 代理页面      |

密码字段用 [已隐藏] 代替明文。

## 规则
- 凭证写入文件后，不在聊天中打印明文密码。
- 若页面有"显示"或"Reveal"按钮，先点击再截图。
- 只操作 .mcp.json、claude_desktop_config.json 和当前目录的 .env，不修改其他文件。
- 若 dashboard.novada.com 无响应，停止并告知用户稍后重试。
```

---

## Manual Fallback / 手动备用方案

If Chrome DevTools MCP is not available, configure manually:

1. Get your API key: <https://dashboard.novada.com/overview/api-keys/>
2. Get proxy credentials: <https://dashboard.novada.com/overview/proxy/>
3. Run the setup command:

```bash
claude mcp add novada \
  -e NOVADA_API_KEY=your_key_here \
  -e NOVADA_PROXY_USER=your_proxy_user \
  -e NOVADA_PROXY_PASS=your_proxy_pass \
  -e NOVADA_PROXY_ENDPOINT=your_proxy_endpoint \
  -- npx -y novada-search
```

4. Verify:

```bash
# In Claude Code — call this tool:
novada_health
```
