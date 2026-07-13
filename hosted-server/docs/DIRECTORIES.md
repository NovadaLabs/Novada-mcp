# MCP Directory Submissions

> Goal: get Novada Hosted MCP listed in every reputable MCP directory so AI agents and developers discover us by default.

---

## Submission template (paste this everywhere)

```text
Name:        Novada MCP
URL:         https://mcp.novada.com/mcp
Tagline:     One server. Every web data tool. Zero install.
Description: Hosted MCP server giving AI agents instant access to Novada's
             web data stack: search, scrape, extract, crawl, map, headless
             browser, source verification, deep research, and 6 proxy types.
             1000 calls/month free (paid accounts uncapped).
GitHub:      https://github.com/NovadaLabs/novada-mcp
Install:     Add `https://mcp.novada.com/mcp?token=YOUR_KEY` to your MCP client.
Categories:  Web Scraping, Search, Proxy, Data Extraction, Research
Logo:        https://www.novada.com/images/header/header-logo1.svg
Contact:     support@novada.com
License:     MIT (source) / Novada ToS (service)
```

Required common fields per directory:

- **Name**, **Tagline**, **Description (50–300 words)**, **GitHub URL**, **Install command/URL**, **At least 1 screenshot or logo**.

---

## Tracker

| #  | Directory                  | URL                                          | Method        | Status   | Submitted | Notes                                  |
|----|----------------------------|----------------------------------------------|---------------|----------|-----------|----------------------------------------|
| 1  | PulseMCP                   | https://www.pulsemcp.com/                    | Public form   | ☐ pending |          | High-traffic directory; review ~1 day  |
| 2  | Glama                      | https://glama.ai/mcp/servers                 | GitHub crawl  | ☐ pending |          | Auto-pulls from GitHub — verify        |
| 3  | mcpservers.org             | https://mcpservers.org/                      | GitHub PR     | ☐ pending |          | PR to their listing repo               |
| 4  | mcp.directory              | https://mcp.directory/                       | Public form   | ☐ pending |          |                                        |
| 5  | Claude Directory           | https://www.claudedirectory.org/             | Public form   | ☐ pending |          | Anthropic-aligned                      |
| 6  | awesome-mcp-servers        | https://github.com/punkpeye/awesome-mcp-servers | GitHub PR  | ☐ pending |          | The OG list                            |
| 7  | awesome-remote-mcp-servers | https://github.com/sylviangth/awesome-remote-mcp-servers | GitHub PR | ☐ pending | | Specifically for remote/hosted MCP     |

Update `Status` to ☑ live and fill `Submitted` (YYYY-MM-DD) once each listing is confirmed visible.

---

## Per-directory details

### 1. PulseMCP

- URL: https://www.pulsemcp.com/
- Method: Submit form on the site (look for "Add server" / "Submit").
- Required fields: name, tagline, description, GitHub URL, screenshot, categories.
- Review SLA: typically ~24 h.

---

### 2. Glama

- URL: https://glama.ai/mcp/servers
- Method: Glama auto-discovers MCP servers from GitHub by scanning for the `mcp-server` topic + a `package.json` / config matching MCP shape. **Verify first** — they may also accept manual submission.
- Action: ensure the GitHub repo has topics `mcp`, `mcp-server`, `model-context-protocol`. Wait ~1 week for auto-pickup, then submit manually if not listed.

---

### 3. mcpservers.org

- URL: https://mcpservers.org/
- Method: GitHub PR to their listing repository (markdown table entry).
- Required: add a row in the appropriate category file. Include name, URL, short description, install command.

---

### 4. mcp.directory

- URL: https://mcp.directory/
- Method: Public submission form on the site.
- Required: name, description, GitHub, install method, categories, logo.

---

### 5. Claude Directory

- URL: https://www.claudedirectory.org/
- Method: Public submission form.
- Required: name, description, GitHub, screenshot. Emphasize Claude Desktop compatibility.
- Tip: link to our INSTALL.md section #1 (Claude Desktop) explicitly.

---

### 6. awesome-mcp-servers (punkpeye)

- URL: https://github.com/punkpeye/awesome-mcp-servers
- Method: Fork → add an entry under the right category (likely **Browser Automation** + **Search**) → PR.
- Format: `- [Novada MCP](https://github.com/NovadaLabs/novada-mcp) - Hosted MCP server: search, scrape, extract, crawl, map, headless browser, verify, research, 6 proxy types. 1000 calls/mo free (paid accounts uncapped).`

---

### 7. awesome-remote-mcp-servers (sylviangth)

- URL: https://github.com/sylviangth/awesome-remote-mcp-servers
- Method: GitHub PR. This list is **remote MCP-specific** — we are a perfect fit.
- Highlight: Streamable HTTP transport, zero install, hosted on Cloudflare Workers global edge.

---

## Post-submission

- Track inbound traffic per directory via UTM tags: append `?utm_source=<directory>` to the GitHub repo URL we submit.
- Weekly: spot-check that listings are still live; some directories occasionally re-validate URLs.
- When tools change materially (new tool added / removed), update each listing's description.
