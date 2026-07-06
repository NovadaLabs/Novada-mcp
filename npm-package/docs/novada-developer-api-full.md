
---
<!-- PAGE: getting-started/overview.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/getting-started/overview.md).

# Overview

### Novada Public API

Manage proxies through a consistent interface, scraping, and browser automation. This reference covers authentication, request structure, error handling, and field definitions with examples across all products.

### Authentication

All endpoints in this reference use an **API Key** as a Bearer. Add the following header to every HTTP request:

```http
Authorization: Bearer YOUR_API_KEY
```

{% hint style="info" %}
Create an API Key in [**Dashboard › Account Settings › My account › API Key**](https://dashboard.novada.com/api-key/). See [Authentication ↗](/getting-started/authentication.md) for the full guide.
{% endhint %}

### Product Matrix

This reference covers the API specifications for all Novada products. Billing is settled independently per product.

<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th><th data-hidden data-card-cover data-type="image">Cover image</th></tr></thead><tbody><tr><td><strong>🅟 Proxy APIs</strong></td><td>6 plans: Residential Proxies / Mobile Proxies / Rotating ISP Proxies / Rotating Datacenter Proxies / Static ISP Proxies / Dedicated Datacenter Proxies. Includes traffic queries, IP resource management, and country / state / city / carrier dictionaries.</td><td><a href="/pages/1f21559dc0a7855a789172fac5784d19656997ad">/pages/1f21559dc0a7855a789172fac5784d19656997ad</a></td><td></td></tr><tr><td><strong>🅤 Web Unblocker</strong></td><td>A single <code>POST /request</code> endpoint. Specify <code>target_url</code> and <code>response_format</code> (HTML / PNG) to retrieve page content; supports JS rendering, custom headers / cookies, and country-level egress.</td><td><a href="/pages/c2d3f2cda349e4280386128e7a49b527e48c0026">/pages/c2d3f2cda349e4280386128e7a49b527e48c0026</a></td><td></td></tr><tr><td><strong>🅢 Scraper API</strong></td><td><code>POST /request</code> creates a task in either <strong>sync mode</strong> (results returned directly in the response) or <strong>async mode</strong> (returns a <code>task_id</code> for later polling / download). Use <code>scraper_name</code> to select a platform and <code>scraper_id</code> to select a scenario.</td><td><a href="/pages/H0ro9VHmsF2ibn3IByg6">/pages/H0ro9VHmsF2ibn3IByg6</a></td><td></td></tr><tr><td><strong>🅑 Browser API</strong></td><td>A cloud headless browser accessed via WebDriver / WSS using <code>username:password</code> credentials. Compatible with Puppeteer / Playwright / Selenium. This reference covers 3 HTTP management endpoints (traffic and dictionaries).</td><td><a href="/pages/95a8e39ab93827846d8bbf411b3ece6d0d793d7a">/pages/95a8e39ab93827846d8bbf411b3ece6d0d793d7a</a></td><td></td></tr></tbody></table>

### Request Basics

<table><thead><tr><th width="180">Item</th><th>Description</th></tr></thead><tbody><tr><td>Base Domains</td><td><code>api-m.novada.com</code> — most management endpoints<br><code>scraper.novada.com</code> — Scraper API task creation<br><code>webunlocker.novada.com</code> — Web Unblocker</td></tr><tr><td>Protocol</td><td>HTTPS (both HTTP/1.1 and HTTP/2 supported)</td></tr><tr><td>Default Content-Type</td><td><code>application/json</code> (some endpoints use <code>application/x-www-form-urlencoded</code>; see individual endpoint pages)</td></tr><tr><td>Character Encoding</td><td>UTF-8</td></tr><tr><td>Version Prefix</td><td><code>/v1/</code></td></tr></tbody></table>

### Response Structure

All API Key endpoints return a **unified response envelope**:

```json
{
  "code": 200,
  "data": {},
  "msg": "OK",
  "timestamp": 1779261338036
}
```

{% hint style="info" %}
See  [Error Codes ↗](broken://pages/e5a3d76088b2a0ea19a5efca0667e617069099f5) for `code` values returned on error.
{% endhint %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/getting-started/overview.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: getting-started/quick-start.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/getting-started/quick-start.md).

# Quick Start

Send your first request in three steps: get your Key → add the Authorization header → call the API.

### Three Steps to Get Started

{% stepper %}
{% step %}

### Sign up for Novada and get your API Key

Go to [**Dashboard › Account Settings › My account › API Key**](https://dashboard.novada.com/api-key/) to create an API Key. Each account can create up to 10 keys, individually enabled or disabled, with a maximum validity of 5 years — **and the option to never expire**.
{% endstep %}

{% step %}

### Add Authorization to your HTTP request header

```http
Authorization: Bearer YOUR_API_KEY
```

All API Key based products share the same API Key — no need to use different keys for different products. **One Key, Everywhere.**
{% endstep %}

{% step %}

### Make your first call

The examples below switch by language. Call `GET /v1/wallet/balance` to query your account balance — a response with `code: 0` indicates success.
{% endstep %}
{% endstepper %}

### Example: Query Account Balance

`GET https://api-m.novada.com/v1/wallet/balance`

{% tabs %}
{% tab title="cURL" %}

```bash
curl -X GET https://api-m.novada.com/v1/wallet/balance \
  -H "Authorization: Bearer YOUR_API_KEY"
```

{% endtab %}

{% tab title="Python" %}

```python
import requests

resp = requests.get(
    "https://api-m.novada.com/v1/wallet/balance",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
)
print(resp.json())
```

{% endtab %}

{% tab title="Node.js" %}

```javascript
const res = await fetch("https://api-m.novada.com/v1/wallet/balance", {
  headers: { Authorization: "Bearer YOUR_API_KEY" },
});
console.log(await res.json());
```

{% endtab %}

{% tab title="Go" %}

```go
req, _ := http.NewRequest("GET",
  "https://api-m.novada.com/v1/wallet/balance", nil)
req.Header.Set("Authorization", "Bearer YOUR_API_KEY")

resp, _ := http.DefaultClient.Do(req)
defer resp.Body.Close()
```

{% endtab %}

{% tab title="PHP" %}

```php
$ch = curl_init("https://api-m.novada.com/v1/wallet/balance");
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer YOUR_API_KEY",
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);
```

{% endtab %}
{% endtabs %}

**Successful response:**

```json
{
  "code": 0,
  "data": {
    "balance": 168.1
  },
  "msg": "success",
  "timestamp": 1779677300
}
```

### Credential Modes

Novada uses **direct API Key authentication** as the primary path — simply add `Authorization: Bearer YOUR_API_KEY` to your HTTP header and you're ready to call. No token expiration, no pre-exchange required.

<details>

<summary>Backwards Compatible: Token Exchange Mode (no migration needed for existing users)</summary>

The original Token Exchange mode remains supported for backwards compatibility: call `/v1/oauth2/token` to exchange for an `access_token` (7-day TTL), then use the token to call business endpoints. **No code changes required for existing integrations**, but new projects are recommended to use direct API Key authentication.

```bash
# Method A (recommended): Exchange token using API Key as Bearer
curl -X POST https://api-m.novada.com/v1/oauth2/token \
  -H "Authorization: Bearer YOUR_API_KEY"

# Method B (compatible): Legacy Basic Auth (username:api_key) still works
curl -X POST https://api-m.novada.com/v1/oauth2/token \
  -u "your_username:your_api_key"
```

</details>

{% hint style="info" %}
For full details on credential management and FAQs, see [Authentication ↗](/getting-started/authentication.md).
{% endhint %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/getting-started/quick-start.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: getting-started/authentication.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/getting-started/authentication.md).

# Authentication

### Credential Modes

The primary path is **Direct API Key authentication**. The Token Exchange mode remains **backwards compatible long-term** for existing integrations — no migration required.

{% hint style="success" %}
**Direct API Key (Recommended)**

Single-step call. No token exchange, no expiration to manage.

```bash
curl -X POST https://api-m.novada.com/v1/wallet/balance \
  -H "Authorization: Bearer YOUR_API_KEY"
```

{% endhint %}

<details>

<summary>Backwards Compatible: Token Exchange Mode (no migration needed for existing users)</summary>

Call `/v1/oauth2/token` to exchange for an `access_token` (7-day TTL), then use the token for business endpoints. **No code changes required for existing integrations**, but new projects should use Direct API Key.

```bash
curl -X POST https://api-m.novada.com/v1/oauth2/token \
  -H "Authorization: Bearer YOUR_API_KEY"

# Legacy Basic Auth (username:api_key) remains supported
```

</details>

### How to Generate a New API Key

A default Key is created automatically when you sign up. To create additional Keys (for environment isolation or rotation), follow these steps:

{% stepper %}
{% step %}

### Sign in to the console

Go to [**Dashboard › Account Settings › My account › API Key**](https://dashboard.novada.com/api-key/).
{% endstep %}

{% step %}

### Click "New API Key"

In the top-right corner of the list page. Maximum 10 Keys per account.
{% endstep %}

{% step %}

### Configure the Key

Set a name (e.g. `prod-server`) and validity period (up to 5 years, or never expire).
{% endstep %}

{% step %}

### Copy and save

Store it in a password manager or secret store (avoid committing plaintext to repositories). Keys can be viewed and copied from the Dashboard anytime.
{% endstep %}
{% endstepper %}

### API Key Management

| Item             | Description                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access           | [Dashboard › Account Settings › My account › API Key](https://dashboard.novada.com/api-key/)                                                                                                                                                                                                                                                                                                                                  |
| Limit            | Up to **10** API Keys per account, each can be enabled or disabled independently.                                                                                                                                                                                                                                                                                                                                             |
| Validity         | Never expire by default, up to 5 years if a finite period is preferred. Editable anytime in the API Key list.                                                                                                                                                                                                                                                                                                                 |
| Enable / Disable | Takes effect immediately. Once disabled, all calls return `401 api_key_disabled`.                                                                                                                                                                                                                                                                                                                                             |
| Plan Decoupling  | When a plan expires, calls return `402 product_not_subscribed`, but **the API Key itself remains valid**. Renewing the plan restores access immediately.                                                                                                                                                                                                                                                                      |
| Coverage         | <p>One Key covers all API Key endpoints: open APIs, Scraper API, and Web Unblocker (all HTTP/HTTPS, passed via <code>Authorization: Bearer YOUR\_API\_KEY</code>).<br>⚠️ <strong>Browser API browser-level access</strong> (WebDriver / WSS) uses <code>username:password</code> credentials and is not covered by API Key (see the <a href="https://www.novada.com/products/browser-api/">Browser API product page</a>).</p> |

### FAQ

<details>

<summary>What if my API Key is lost or leaked?</summary>

Treat your API Key as sensitive as your account password. If you suspect a leak (accidentally committed to Git, seen by a colleague, device lost, etc.), immediately go to [**Dashboard › Account Settings › My account › API Key**](https://dashboard.novada.com/api-key/), delete the old Key and create a new one, then replace references in production.

Once deleted, calls using the old Key immediately return `apikey invalid`. We recommend creating the new Key first, completing a gradual rollout, then deleting the old Key.

</details>

<details>

<summary>Can I view existing API Keys in plaintext from the Dashboard?</summary>

Yes. The Novada console lets you view and copy any existing Key anytime — it isn't lost when you close the page. That said, we still recommend saving it to a password manager or secret store at creation time, so multi-user / multi-environment setups can manage Keys centrally.

</details>

<details>

<summary>Can I "refresh" an existing API Key (keep the ID, only change the value)?</summary>

Novada does not currently support "rotate in place". The rotation flow is: **create new → replace references → delete old Key**. Old and new Keys can coexist briefly during rotation for a gradual rollout.

</details>

<details>

<summary>How many API Keys can a single account create?</summary>

Up to **10** API Keys per account, each can be enabled or disabled independently. A common pattern is one Key for each of dev / staging / prod, or one per product line / application — useful for fine-grained usage tracking and isolating the source of leaks.

</details>

<details>

<summary>Do API Keys support permission levels?</summary>

All API Keys currently have equivalent full permissions and can access every endpoint of every product on the account. Keys differ only in: name, validity, enabled status, and usage stats.

Granular permissions (by product / by operation type) are planned for the future — you'll be able to select scopes when creating a Key.

</details>

<details>

<summary>Can I still use my API Key after my plan expires?</summary>

API Keys are decoupled from plans. When a plan expires, but **the API Key itself remains valid**. Renewing restores access immediately — no need to regenerate the Key or modify application code.

</details>

<details>

<summary>Do all products share the same API Key?</summary>

API Key based products (open APIs, Scraper API, Web Unblocker) share **one Key across all endpoints** — just pass `Authorization: Bearer YOUR_API_KEY` in the header.

⚠️ **Browser API browser-level access** (WebDriver / WSS endpoints) and **proxy runtime access** (dialing) use `username:password` credentials and are not part of the API Key system. The 3 HTTP traffic management endpoints for Browser API on `api-m.novada.com` still use API Key.

</details>

### Security Best Practices

| Item            | Recommendation                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Rotation        | Rotate production Keys every 90 days. Old and new Keys can coexist briefly.                    |
| Separation      | Create separate Keys for dev / staging / prod. Never use production Keys in local development. |
| Storage         | Never commit to Git. Use `.env` + secret management (Vault / Doppler / AWS Secrets Manager).   |
| Least Privilege | Granular permissions are coming. All Keys currently have equivalent full permissions.          |


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/getting-started/authentication.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: user.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/user.md).

# User

## POST /v1/proxy\_account/create

> Add  proxy user

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"User"},{"name":"Proxy User Management"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy_account/create":{"post":{"summary":"Add  proxy user","deprecated":false,"description":"","tags":["User","Proxy User Management"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"product":{"type":"string","description":"product:1=Residential，2=Rotating ISP,3=Rotating Datacenter,9=mobile,10=Browser API"},"account":{"type":"string","description":"Account Name"},"password":{"type":"string","description":"Account Password"},"status":{"type":"integer","description":"Account Status: 1=normal, -3=personal disabled"},"remark":{"type":"string","description":"Remark"},"limit_flow":{"type":"string","description":"Data Plans - Dynamic Residential Data Cap(G)"}},"required":["product","account","password","status"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/proxy\_account/list

> List proxy user&#x20;

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"User"},{"name":"Proxy User Management"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy_account/list":{"post":{"summary":"List proxy user ","deprecated":false,"description":"","tags":["User","Proxy User Management"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"product":{"type":"integer","description":"product:1=Residential，2=Rotating ISP,3=Rotating Datacenter,9=mobile,10=Browser API"},"status":{"type":"integer","description":"Status: 1=normal, -3=disabled"},"account":{"type":"string","description":"Account Name"},"page":{"type":"integer","description":"page number"},"limit":{"type":"integer","description":"Number of entries returned per page"}},"required":["product","page","limit"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/proxy\_account/update

> Update proxy user

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"User"},{"name":"Proxy User Management"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy_account/update":{"post":{"summary":"Update proxy user","deprecated":false,"description":"","tags":["User","Proxy User Management"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"id":{"type":"integer","description":"ID：your account id"},"account":{"type":"string","description":"Account Name"},"password":{"type":"string","description":"Account Password"},"status":{"type":"integer","description":"Account Status: 1=normal, -3=disabled"},"remark":{"type":"string","description":"Remark"},"limit_flow":{"type":"string","description":"Data Plans - Dynamic Residential Data Cap(G)"}},"required":["id","account","password"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```

## POST /v1/proxy\_account/consume\_log

> List proxy user traffic consumption

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"User"},{"name":"Proxy User Management"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy_account/consume_log":{"post":{"summary":"List proxy user traffic consumption","deprecated":false,"description":"","tags":["User","Proxy User Management"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"account_id":{"type":"integer","description":"Account ID"},"start_time":{"type":"string","description":"Start Time (datetime)"},"end_time":{"type":"string","description":"End Time (datetime)"},"limit":{"type":"integer","description":"Number of entries returned per page"},"page":{"type":"integer","description":"page number"}},"required":["account_id","limit","page"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/user.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: whitelisted.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/whitelisted.md).

# Whitelisted

## POST /v1/white\_list/add

> Add whitelist ip

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Whitelisted"},{"name":"IP Whitelist Management"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/white_list/add":{"post":{"summary":"Add whitelist ip","deprecated":false,"description":"","tags":["Whitelisted","IP Whitelist Management"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"product":{"type":"integer","description":"Product:1=Residential,5=Static isp
4=Unlimited proxies"},"ip":{"type":"string","description":"IP"},"remark":{"type":"string","description":"Remark"}},"required":["product","ip"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/white\_list/list

> List whitelist ip

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Whitelisted"},{"name":"IP Whitelist Management"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/white_list/list":{"post":{"summary":"List whitelist ip","deprecated":false,"description":"","tags":["Whitelisted","IP Whitelist Management"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"product":{"type":"integer","description":"Product:1=Residential,5=Static product"},"ip":{"type":"string","description":"Ip"},"start_time":{"type":"string","description":"Start Time (datetime)"},"end_time":{"type":"string","description":"End Time (datetime)"},"lock":{"type":"integer","description":"Locked: 0 Unlocked 1 Locked"}},"required":["product"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/white\_list/del

> Delete whitelist ip

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Whitelisted"},{"name":"IP Whitelist Management"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/white_list/del":{"post":{"summary":"Delete whitelist ip","deprecated":false,"description":"","tags":["Whitelisted","IP Whitelist Management"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"product":{"type":"string","description":"Product:1=Residential,5=Static product"},"ips":{"type":"string","description":"ips:multiple use ',' separated"}},"required":["product","ips"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/white\_list/remark

> Remark whitelist ip

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Whitelisted"},{"name":"IP Whitelist Management"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/white_list/remark":{"post":{"summary":"Remark whitelist ip","deprecated":false,"description":"","tags":["Whitelisted","IP Whitelist Management"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"product":{"type":"integer","description":"Product:1=Residential,5=Static product"},"id":{"type":"string","description":"Id of ip"},"remark":{"type":"string","description":"Remark"}},"required":["product","id"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/whitelisted.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: residential-proxies.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/residential-proxies.md).

# Residential Proxies

## POST /v1/proxy/domestic\_dynamic\_area

> List residential proxy countries

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Residential Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy/domestic_dynamic_area":{"post":{"summary":"List residential proxy countries","deprecated":false,"description":"","tags":["Residential Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"search_word":{"type":"string","description":"Country Name"}}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/proxy/city\_by\_code

> List residential proxy states

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Residential Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy/city_by_code":{"post":{"summary":"List residential proxy states","deprecated":false,"description":"","tags":["Residential Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"code":{"type":"string","description":"Country Code"}}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/proxy/region\_by\_city

> List residential proxy cities

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Residential Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy/region_by_city":{"post":{"summary":"List residential proxy cities","deprecated":false,"description":"","tags":["Residential Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"code":{"type":"string","description":"Country Code"},"region":{"type":"string","description":"Continent Name"}},"required":["code","region"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/proxy/city\_isp

> List residential proxy isp

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Residential Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy/city_isp":{"post":{"summary":"List residential proxy isp","deprecated":false,"description":"","tags":["Residential Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"code":{"type":"string","description":"Country Code"}},"required":["code"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/residential\_flow/consume\_log

> List main account traffic consumption

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Residential Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/residential_flow/consume_log":{"post":{"summary":"List main account traffic consumption","deprecated":false,"description":"","tags":["Residential Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"start_time":{"type":"string","description":"Start time"},"end_time":{"type":"string","description":"End time"}},"required":["start_time","end_time"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/residential\_flow/balance

> Show remaining traffic

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Residential Proxies"},{"name":"Browser Api"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/residential_flow/balance":{"post":{"summary":"Show remaining traffic","deprecated":false,"description":"","tags":["Residential Proxies","Browser Api"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{}}}}},"responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"type":"object","properties":{"code":{"type":"integer"},"data":{"type":"object","properties":{"balance":{"type":"integer","description":"Remining traffic(Byte)"},"expire_time":{"type":"integer","description":"Expiretime"}},"required":["balance","expire_time"]},"msg":{"type":"string"},"timestamp":{"type":"integer"}},"required":["code","data","msg","timestamp"]}}},"headers":{}},"404":{"description":"失败","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/residential-proxies.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: mobile-proxies.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/mobile-proxies.md).

# Mobile Proxies

## POST /v1/proxy/mobile\_area

> List mobile proxy countries

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Mobile Proxies"},{"name":"Mobile proxy"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy/mobile_area":{"post":{"summary":"List mobile proxy countries","deprecated":false,"description":"","tags":["Mobile Proxies","Mobile proxy"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```

## POST /v1/mobile\_flow/mobile\_flow\_balance

> Show mobile proxy remaining traffic

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Mobile Proxies"},{"name":"Mobile proxy"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/mobile_flow/mobile_flow_balance":{"post":{"summary":"Show mobile proxy remaining traffic","deprecated":false,"description":"","tags":["Mobile Proxies","Mobile proxy"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{}}}}},"responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}},"404":{"description":"失败","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```

## POST /v1/mobile\_flow/mobile\_flow\_use

> List mobile proxy main account traffic consumption

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Mobile Proxies"},{"name":"Mobile proxy"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/mobile_flow/mobile_flow_use":{"post":{"summary":"List mobile proxy main account traffic consumption","deprecated":false,"description":"","tags":["Mobile Proxies","Mobile proxy"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"start_time":{"type":"string","description":"Start time"},"end_time":{"type":"string","description":"End time"},"day_or_hour":{"type":"string","description":"1-hour 2-day"}},"required":["start_time","end_time","day_or_hour"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/mobile-proxies.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: rotating-isp-proxies.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/rotating-isp-proxies.md).

# Rotating ISP Proxies

## POST /v1/proxy/isp\_data\_area

> List rotating ISP countries

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Rotating ISP Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy/isp_data_area":{"post":{"summary":"List rotating ISP countries","deprecated":false,"description":"","tags":["Rotating ISP Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/isp\_flow/balance

> Show remaining traffic

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Rotating ISP Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/isp_flow/balance":{"post":{"summary":"Show remaining traffic","deprecated":false,"description":"","tags":["Rotating ISP Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{"type":"object","properties":{"code":{"type":"integer"},"data":{"type":"object","properties":{"balance":{"type":"integer","description":"Remining traffic(Byte)"},"expire_time":{"type":"integer","description":"Expiretime"}},"required":["balance","expire_time"]},"msg":{"type":"string"},"timestamp":{"type":"integer"}},"required":["code","data","msg","timestamp"]}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/isp\_flow/consume\_log

> List main account traffic consumption

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Rotating ISP Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/isp_flow/consume_log":{"post":{"summary":"List main account traffic consumption","deprecated":false,"description":"","tags":["Rotating ISP Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"start_time":{"type":"string","description":"Start time"},"end_time":{"type":"string","description":"End time"}},"required":["start_time","end_time"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/rotating-isp-proxies.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: rotating-datacenter-proxies.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/rotating-datacenter-proxies.md).

# Rotating Datacenter Proxies

## POST /v1/proxy/dynamic\_data\_area

> List rotating datacenter countries

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Rotating Datacenter Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy/dynamic_data_area":{"post":{"summary":"List rotating datacenter countries","deprecated":false,"description":"","tags":["Rotating Datacenter Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"search_word":{"type":"string","description":"Country Name"}}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/dc\_flow/consume\_log

> List main account traffic consumption

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Rotating Datacenter Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/dc_flow/consume_log":{"post":{"summary":"List main account traffic consumption","deprecated":false,"description":"","tags":["Rotating Datacenter Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"start_time":{"type":"string","description":"Start time"},"end_time":{"type":"string","description":"End time"}},"required":["start_time","end_time"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/dc\_flow/balance

> Show remaining traffic

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Rotating Datacenter Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/dc_flow/balance":{"post":{"summary":"Show remaining traffic","deprecated":false,"description":"","tags":["Rotating Datacenter Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{"type":"object","properties":{"code":{"type":"integer"},"data":{"type":"object","properties":{"balance":{"type":"integer","description":"Remining traffic(Byte)"},"expire_time":{"type":"integer","description":"Expiretime"}},"required":["balance","expire_time"]},"msg":{"type":"string"},"timestamp":{"type":"integer"}},"required":["code","data","msg","timestamp"]}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/rotating-datacenter-proxies.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: static-isp-proxies.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/static-isp-proxies.md).

# Static ISP Proxies

## POST /v1/static\_house/open

> Open ips of static isp

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Static ISP Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/static_house/open":{"post":{"summary":"Open ips of static isp","deprecated":false,"description":"","tags":["Static ISP Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"ip_type":{"type":"string","description":"ip type: normal=Standard ISP IP,premium=Premium ISP IP"},"region":{"type":"string","description":"area:num"},"duration":{"type":"string","description":"IP activation time:week|month"},"num":{"type":"integer","description":"Number of ips opened"}},"required":["ip_type","region","duration","num"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/static\_house/list

> List ips of static isp

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Static ISP Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/static_house/list":{"post":{"summary":"List ips of static isp","deprecated":false,"description":"","tags":["Static ISP Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"status":{"type":"string","description":"Status: \"\"=ALL, 1=In use, 2=Expired,3=Released"},"region":{"type":"string","description":"Area Code"},"key_word":{"type":"string","description":"Keywords (remarks, order number, ip)"},"is_auto_renew":{"type":"integer","description":"Whether to automatically renew 1 Yes - 1 No (When the input parameter is -1, the return parameter \"auto_renew\" is 0, indicating non-automatic renewal)"},"page":{"type":"integer","description":"page number"},"limit":{"type":"integer","description":"Number of entries per page"}},"required":["page","limit"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{"type":"string"}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/static\_house/export

> Export ips of static isp

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Static ISP Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/static_house/export":{"post":{"summary":"Export ips of static isp","deprecated":false,"description":"","tags":["Static ISP Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"status":{"type":"integer","description":"Status: \"\"=ALL, 1=In use, 2=Expired,3=Released"},"region":{"type":"string","description":"Area Code"},"key_word":{"type":"string","description":"Keywords (remarks, order number, ip)"},"is_auto_renew":{"type":"integer","description":"Whether to automatically renew 1 Yes - 1 No"}}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/static\_house/region

> List regions of static isp

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Static ISP Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/static_house/region":{"post":{"summary":"List regions of static isp","deprecated":false,"description":"","tags":["Static ISP Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"isp_type":{"type":"string","description":"isp type：isp-resi=Static Residential IP ,isp-resi-hq=Premium Residential IP"}},"required":["isp_type"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```

## POST /v1/static\_house/renew

> Renew ips of static isp

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Static ISP Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/static_house/renew":{"post":{"summary":"Renew ips of static isp","deprecated":false,"description":"","tags":["Static ISP Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"renew_ip_list":{"type":"string","description":"Renew IP, multiple use ',' separated"},"duration":{"type":"string","description":"IP activation time:week|month"}},"required":["renew_ip_list","duration"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/static\_house/renew\_setting

> Update renewal setting

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Static ISP Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/static_house/renew_setting":{"post":{"summary":"Update renewal setting","deprecated":false,"description":"","tags":["Static ISP Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"type":{"type":"string","description":"Product type:static_house"},"ids":{"type":"string","description":"Ip's id:multiple use ',' separated"},"package_type":{"type":"string","description":"IP activation time:week|month"},"status":{"type":"integer","description":"Status: -1=disabled, 1=normal"},"renew_type":{"type":"integer","description":"Renewal method: 1 wallet, 2 credit cards"}},"required":["type","ids","package_type","status","renew_type"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/static-isp-proxies.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: dedicated-datacenter-proxies.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/dedicated-datacenter-proxies.md).

# Dedicated Datacenter Proxies

## POST /v1/static/open

> Open ips of dedicated datacenter

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Dedicated Datacenter Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/static/open":{"post":{"summary":"Open ips of dedicated datacenter","deprecated":false,"description":"","tags":["Dedicated Datacenter Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"region":{"type":"string","description":"area:num"},"duration":{"type":"string","description":"IP activation time:week|month"},"num":{"type":"integer","description":"Number of ips opened"}},"required":["region","duration","num"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/static/list

> List ips of dedicated datacenter

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Dedicated Datacenter Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/static/list":{"post":{"summary":"List ips of dedicated datacenter","deprecated":false,"description":"","tags":["Dedicated Datacenter Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"status":{"type":"integer","description":"Status: \"\"=ALL, 1=In use, 2=Expired,3=Released"},"region":{"type":"string","description":"Area Code"},"key_word":{"type":"string","description":"Keywords (remarks, order number, ip)"},"is_auto_renew":{"type":"integer","description":"Whether to automatically renew 1 Yes - 1 No"},"page":{"type":"integer","description":"page number"},"limit":{"type":"integer","description":"Number of entries per page"}},"required":["page","limit"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{"type":"string"}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/static/export

> Export ips of dedicated datacenter

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Dedicated Datacenter Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/static/export":{"post":{"summary":"Export ips of dedicated datacenter","deprecated":false,"description":"","tags":["Dedicated Datacenter Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"status":{"type":"integer","description":"Status: \"\"=ALL, 1=In use, 2=Expired,3=Released"},"region":{"type":"string","description":"Area Code"},"key_word":{"type":"string","description":"Keywords (remarks, order number, ip)"},"is_auto_renew":{"type":"integer","description":"Whether to automatically renew 1 Yes - 1 No"}}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/static/region

> List regions of dedicated datacenter

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Dedicated Datacenter Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/static/region":{"post":{"summary":"List regions of dedicated datacenter","deprecated":false,"description":"","tags":["Dedicated Datacenter Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/static/renew

> Renew ips of dedicated datacenter

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Dedicated Datacenter Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/static/renew":{"post":{"summary":"Renew ips of dedicated datacenter","deprecated":false,"description":"","tags":["Dedicated Datacenter Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"renew_ip_list":{"type":"string","description":"Renew IP, multiple use ',' separated"},"duration":{"type":"string","description":"IP activation time:week|month"}},"required":["renew_ip_list","duration"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/static/renew\_setting

> Update renewal setting

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Dedicated Datacenter Proxies"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/static/renew_setting":{"post":{"summary":"Update renewal setting","deprecated":false,"description":"","tags":["Dedicated Datacenter Proxies"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"type":{"type":"string","description":"Product type:static"},"ids":{"type":"string","description":"Ip's id(multiple use ',' separated)"},"package_type":{"type":"string","description":"IP activation time:week|month"},"status":{"type":"integer","description":"Status: -1=disabled, 1=normal"},"renew_type":{"type":"integer","description":"Renewal method: 1 wallet, 2 credit cards"}},"required":["type","ids","package_type","status","renew_type"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/dedicated-datacenter-proxies.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: scraping-solutions/universal.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/scraping-solutions/universal.md).

# Universal

## POST /v1/capture/get\_balance

> Get the remaining balance

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Universal"},{"name":"爬虫API"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/capture/get_balance":{"post":{"summary":"Get the remaining balance","deprecated":false,"description":"","tags":["Universal","爬虫API"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{}}}}},"responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}},"404":{"description":"失败","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```

## POST /v1/capture/all\_logs

> Capture package consumption statistics

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Universal"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/capture/all_logs":{"post":{"summary":"Capture package consumption statistics","deprecated":false,"description":"","tags":["Universal"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"category":{"description":"Optional values: scraper, unblocker, browser. If not passed, all will be obtained by default","type":"string"},"apikey":{"description":"Can be queried based on apikey","type":"string"},"start_time":{"description":"Start time(2026-06-01 00:00:00)，Starting and ending time on the same day, obtained by hour dimension","type":"string"},"end_time":{"description":"End time(2026-06-01 00:00:00)","type":"string"}},"required":["start_time","end_time"]}}},"required":true},"responses":{"200":{"description":"","content":{"application/json":{"schema":{"type":"object","properties":{"code":{"type":"integer"},"data":{"type":"array","items":{"type":"object","properties":{"date":{"type":"string"},"res":{"type":"integer"},"flow":{"type":"integer"},"amount":{"type":"number"},"success_num":{"type":"integer"},"fail_num":{"type":"integer"},"success_rate":{"type":"number"},"top_10":{"type":"array","items":{"type":"object","properties":{"domain":{"type":"string"},"amount":{"type":"number"}},"required":["domain","amount"]}}},"required":["date","res","flow","amount","success_num","fail_num","success_rate","top_10"]}},"msg":{"type":"string"},"timestamp":{"type":"integer"}},"required":["code","data","msg","timestamp"]}}},"headers":{}}}}}}}
```

## POST /v1/proxy/unblocker\_area

> Get list of countries

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Universal"},{"name":"网页解锁器"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy/unblocker_area":{"post":{"summary":"Get list of countries","deprecated":false,"description":"","tags":["Universal","网页解锁器"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"search_word":{"type":"string"}}}}}},"responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}},"404":{"description":"失败","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```

## POST /v1/proxy/unblocker\_area\_by\_country

> Get list of states

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Universal"},{"name":"网页解锁器"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy/unblocker_area_by_country":{"post":{"summary":"Get list of states","deprecated":false,"description":"","tags":["Universal","网页解锁器"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"code":{"type":"string","description":"country code"}},"required":["code"]}}}},"responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}},"404":{"description":"失败","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```

## POST /v1/proxy/unblocker\_city\_by\_area

> Get city list

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Universal"},{"name":"网页解锁器"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy/unblocker_city_by_area":{"post":{"summary":"Get city list","deprecated":false,"description":"","tags":["Universal","网页解锁器"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"code":{"type":"string","description":"country code"},"region":{"type":"string","description":"State/Province Name"}},"required":["code","region"]}}}},"responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}},"404":{"description":"失败","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```

## POST /v1/proxy/unblocker\_city\_isp

> Get list of carriers

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Universal"},{"name":"网页解锁器"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy/unblocker_city_isp":{"post":{"summary":"Get list of carriers","deprecated":false,"description":"","tags":["Universal","网页解锁器"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"code":{"type":"string","description":"country code"}},"required":["code"]}}}},"responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}},"404":{"description":"失败","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```

## POST /v1/capture/unit

> Get user capture unit price

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Universal"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/capture/unit":{"post":{"summary":"Get user capture unit price","deprecated":false,"description":"","tags":["Universal"],"parameters":[],"responses":{"200":{"description":"","content":{"application/json":{"schema":{"type":"object","properties":{"code":{"type":"integer"},"data":{"type":"object","properties":{"scraper":{"type":"array","items":{"type":"object","properties":{"package":{"type":"string"},"level":{"type":"integer","description":"等级"},"price":{"type":"number","description":"单价"},"available":{"type":"integer"}},"required":["package","level","price","available"]},"description":"scraper api单价"},"unblocker":{"type":"array","items":{"type":"object","properties":{"package":{"type":"string"},"level":{"type":"integer","description":"等级"},"price":{"type":"number","description":"单价"},"available":{"type":"integer"}}},"description":"网页解锁器"}},"required":["scraper","unblocker"]},"msg":{"type":"string"},"timestamp":{"type":"integer"}},"required":["code","data","msg","timestamp"]}}}}}}}}}
```

## POST /v1/capture/request\_log

> Get request logs

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Universal"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/capture/request_log":{"post":{"summary":"Get request logs","deprecated":false,"description":"","tags":["Universal"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"category":{"description":"scraper,unblocker","type":"string"},"apikey":{"description":"Can be queried based on apikey","type":"string"},"limit":{"type":"string"},"page":{"type":"string"}},"required":["category","limit","page"]}}},"required":true},"responses":{"200":{"description":"","content":{"application/json":{"schema":{"type":"object","properties":{"code":{"type":"integer"},"data":{"type":"object","properties":{"count":{"type":"integer"},"list":{"type":"array","items":{"type":"object","properties":{"request_id":{"type":"string"},"request_time":{"type":"string"},"apikey":{"type":"string"},"request_params":{"type":"string"},"http_code":{"type":"integer"},"cost_time":{"type":"integer"},"used_balance":{"type":"string"},"res":{"type":"integer"},"flow":{"type":"integer"}},"required":["request_id","request_time","apikey","request_params","http_code","cost_time","used_balance","res","flow"]}}},"required":["count","list"]},"msg":{"type":"string"},"timestamp":{"type":"integer"}},"required":["code","data","msg","timestamp"]}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/scraping-solutions/universal.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: scraping-solutions/web-unblocker.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/scraping-solutions/web-unblocker.md).

# Web Unblocker

## Web Unblocker request

> url：<https://webunlocker.novada.com>, The value of the token is the user's corresponding API key.

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Web Unblocker"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/request":{"post":{"summary":"Web Unblocker request","deprecated":false,"description":"url：https://webunlocker.novada.com, The value of the token is the user's corresponding API key.","tags":["Web Unblocker"],"parameters":[],"requestBody":{"content":{"application/x-www-form-urlencoded":{"schema":{"type":"object","properties":{"target_url":{"description":"destination address","type":"string"},"response_format":{"description":"The output format of the crawled results only supports HTML and PNG, separated by English commas.","type":"string"},"js_render":{"type":"boolean","description":"JS rendering: true for enabled, false for disabled. Enabling is recommended to capture dynamically rendered, asynchronously loaded, and complex interactive content."},"headers":{"description":"Custom headers are used to access the website.","type":"string"},"cookies":{"description":"Custom cookies are used to access the website.","type":"string"},"country":{"description":"Proxy countries/regions during crawling","type":"string"},"wait_ms":{"type":"integer","description":"Maximum page wait time (milliseconds), maximum value 100000 milliseconds"},"wait_selector":{"description":"Wait for the CSS selector to load in the DOM. If both `wait_selector` and `wait_ms` are used, `wait_selector` takes precedence (overriding the fixed time). Specifies the element to wait for a maximum of 30 seconds, after which the website content will automatically return.","type":"string"},"follow_redirects":{"description":"When a user accesses an expired URL, they are redirected to the new URL.","type":"string"},"block_resources":{"description":"Should we prevent the loading of unnecessary resources such as images, JC files, and videos to improve crawling speed?","type":"string"},"clear":{"description":"Clean up unnecessary JS and CSS content in the crawl results.","type":"string"},"auto_runs":{"type":"integer","description":"Errors caused by proxy failures can be automatically retried by setting the number of retries. The maximum number of retries is 10, and the default is 2."}},"required":["target_url","response_format"]}}},"required":true},"responses":{"200":{"description":"","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}},"404":{"description":"","content":{"application/json":{"schema":{"type":"object","properties":{}}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/scraping-solutions/web-unblocker.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: scraping-solutions/scraper-api.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/scraping-solutions/scraper-api.md).

# Scraper API

### Create task

Api Path：<https://scraper.novada.com/request>

Request method：POST

Content-Type：x-www-form-urlencoded

Authentication：Bearer YOUR\_API\_KEY

> Get Api Key：[Dashboard](https://dashboard.novada.com/cn/overview/scraper/api/?id=25)

#### Request params

<table><thead><tr><th width="219">field</th><th width="109">type</th><th width="116">required</th><th>description</th></tr></thead><tbody><tr><td>scraper_name</td><td>string</td><td>yes</td><td>scraper name</td></tr><tr><td>scraper_id</td><td>number</td><td>yes</td><td>scraper id</td></tr><tr><td>scraper_params</td><td>string</td><td>no</td><td>Capture parameters, required in non search scenarios,Please refer to the <a href="https://developer.novada.com/novada/advanced-proxy-solutions/scraper-api/target-sites-supported-by-scraper-api">API parameter description</a> for specific parameters</td></tr><tr><td>scraper_universal</td><td>string</td><td>no</td><td>youtube video params</td></tr><tr><td>scraper_errors</td><td>boolean</td><td>yes</td><td>whether to return an error</td></tr><tr><td>file_name</td><td>string</td><td>yes</td><td>custom file name</td></tr></tbody></table>

> Request example

```bash
curl -X POST "https://scraper.novada.com/request" ^
  -H "Authorization: Bearer YOUR_API_KEY" ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "scraper_name=amazon.com" ^
  -d "scraper_id=amazon_product_keywords" ^
  -d "scraper_errors=true" ^
  -d "scraper_params=[{\"keyword\":\"Coffer\",\"max_pages\":\"1\",\"min_price\":\"5\",\"max_price\":\"50\"}]"
```

> Return example 200 Response

```json
{
  "code": 0,
  "data": {
    "code": 200,
    "data": {
      "task_id": "330ae83bcff7479b9c97e586dbf93801"
    },
    "msg": "success"
  },
  "msg": "success",
  "timestamp": 1775099126
}
```

### Get task list

Api Path：<https://api-m.novada.com/v1/scraper/task\_list>

Request method：POST

Content-Type：form-data

Authentication：Bearer YOUR\_API\_KEY

> Token acquisition method: [Quick start](https://developer-api.novada.com/)

#### Request params

| field | type   | required | description              |
| ----- | ------ | -------- | ------------------------ |
| limit | string | yes      | page size，max value 100. |
| page  | string | yes      | page                     |

> Request example

```bash
curl -X POST "https://api-m.novada.com/v1/scraper/task_list" ^
  -H "Authorization: Bearer YOUR_API_KEY" ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "limit=10" ^
  -d "page=1"
```

> Return example 200 Response

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "api": "",
        "error_info": "",
        "fail_count": 1,
        "file_size": 0,
        "finish_time": 1774602108275,
        "id": 4537,
        "oss": "https://novada-scraper-1303252866.cos.na-siliconvalley.myqcloud.com/novada/youtube/2026/03/27/e1445fdb67454ca69da1164135679db7/e1445fdb67454ca69da1164135679db7",
        "scene": "",
        "start_time": 1774602050665,
        "status": 2,
        "success_count": 0,
        "success_rate": 0,
        "task_id": "e1445fdb67454ca69da1164135679db7",
        "total": 1,
        "unit_price": 0.0007,
        "unit_type": "flow",
        "used_quota": 0
      }
    ],
    "total": 73
  },
  "msg": "success",
  "timestamp": 1774663721
}
```

### Get the running status of one or more tasks

Api Path：<https://api-m.novada.com/v1/scraper/task\_status>

Request method：POST

Content-Type：form-data

Authentication：Bearer YOUR\_API\_KEY

> Token acquisition method: [Quick start](https://developer-api.novada.com/)

#### Request params

| field     | type   | required | description                                                    |
| --------- | ------ | -------- | -------------------------------------------------------------- |
| task\_ids | string | yes      | Task ID list, separated by commas in English, max 200 task id. |

> Request example

```bash
curl -X POST "https://api-m.novada.com/v1/scraper/task_status" ^
  -H "Authorization: Bearer YOUR_API_KEY" ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "task_ids=330ae83bcff7479b9c97e586dbf93801"
```

> Return example 200 Response

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "status": "Ready",
        "task_id": "caaa5dcca21d4269af26b207b0508482"
      },
      {
        "status": "Failed",
        "task_id": "b6c22dabe35d421cb8c0c88ff6bc0971"
      }
    ]
  },
  "msg": "success",
  "timestamp": 1774663533
}
```

### Get the status of the last task for the current account

Api Path：<https://api-m.novada.com/v1/scraper/last\_task\_status>

Request method：POST

Content-Type：form-data

Authentication：Bearer YOUR\_API\_KEY

> Token acquisition method: [Quick start](https://developer-api.novada.com/)

#### Request params

No need to transmit parameters

> Return example 200 Response

```json
{
  "code": 0,
  "data": {
    "status": "Failed",
    "task_id": "e1445fdb67454ca69da1164135679db7"
  },
  "msg": "success",
  "timestamp": 1774662782
}
```

### Get task result file

Api Path：<https://api-m.novada.com/v1/scraper/task\_download>

Request method：POST

Content-Type：form-data

Authentication：Bearer YOUR\_API\_KEY

> Token acquisition method: [Quick start](https://developer-api.novada.com/)

#### Request params

| field      | type   | required | description                                                    |
| ---------- | ------ | -------- | -------------------------------------------------------------- |
| task\_ids  | string | yes      | Task ID list, separated by commas in English, max 200 task id. |
| file\_type | string | yes      | file type：json，csv, xlsx                                       |

> Request example

```bash
curl -X POST "https://api-m.novada.com/v1/scraper/task_download" ^
  -H "Authorization: Bearer YOUR_API_KEY" ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "task_ids=330ae83bcff7479b9c97e586dbf93801" ^
  -d "file_type=json"
```

> Return example 200 Response

```json
{
  "code": 0,
  "data": [
    {
      "download": "https://novada-scraper-1303252866.cos.na-siliconvalley.myqcloud.com/novada/google_shopping/2026/03/26/32ab51b7fb48480f9f4fdb6e0d797956.json",
      "task_id": "32ab51b7fb48480f9f4fdb6e0d797956"
    },
    {
      "download": "https://novada-scraper-1303252866.cos.na-siliconvalley.myqcloud.com/novada/youtube/2026/03/26/caaa5dcca21d4269af26b207b0508482.json",
      "task_id": "caaa5dcca21d4269af26b207b0508482"
    }
  ],
  "msg": "success",
  "timestamp": 1774664048
}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/scraping-solutions/scraper-api.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: scraping-solutions/browser-api.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/scraping-solutions/browser-api.md).

# Browser API

## POST /v1/proxy\_account/create

> Add  proxy user

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Browser API"},{"name":"Proxy User Management"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/proxy_account/create":{"post":{"summary":"Add  proxy user","deprecated":false,"description":"","tags":["Browser API","Proxy User Management"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"product":{"type":"string","description":"product:10=Browser API"},"account":{"type":"string","description":"Account Name"},"password":{"type":"string","description":"Account Password"},"status":{"type":"integer","description":"Account Status: 1=normal, -3=personal disabled"},"remark":{"type":"string","description":"Remark"},"limit_flow":{"type":"string","description":"Data Plans - Dynamic Residential Data Cap(G)"}},"required":["product","account","password","status"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/scraping-solutions/browser-api.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: resource-management/wallet.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/resource-management/wallet.md).

# Wallet

## POST /v1/wallet/balance

> Show wallet balance

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Wallet"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/wallet/balance":{"post":{"summary":"Show wallet balance","deprecated":false,"description":"","tags":["Wallet"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/wallet/usage\_record

> List usage record

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Wallet"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/wallet/usage_record":{"post":{"summary":"List usage record","deprecated":false,"description":"","tags":["Wallet"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"page":{"type":"integer","description":"Number of entries per page"},"limit":{"type":"integer","description":"page number"}}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/resource-management/wallet.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: resource-management/prohibit-domain.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/resource-management/prohibit-domain.md).

# Prohibit Domain

## POST /v1/prohibit\_domain/add

> Add blocked domain

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Prohibit Domain"},{"name":"Other"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/prohibit_domain/add":{"post":{"summary":"Add blocked domain","deprecated":false,"description":"","tags":["Prohibit Domain","Other"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"address":{"type":"string","description":"Allow access to the address"}},"required":["address"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/prohibit\_domain/list

> List blocked domain

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Prohibit Domain"},{"name":"Other"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/prohibit_domain/list":{"post":{"summary":"List blocked domain","deprecated":false,"description":"","tags":["Prohibit Domain","Other"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{}}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```

## POST /v1/prohibit\_domain/del

> Delete blocked domain

```json
{"openapi":"3.0.1","info":{"title":"默认模块","version":"1.0.0"},"tags":[{"name":"Prohibit Domain"},{"name":"Other"}],"security":[{"bearer":[]}],"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}},"paths":{"/v1/prohibit_domain/del":{"post":{"summary":"Delete blocked domain","deprecated":false,"description":"","tags":["Prohibit Domain","Other"],"parameters":[],"requestBody":{"content":{"multipart/form-data":{"schema":{"type":"object","properties":{"id":{"type":"string","description":"ID"},"is_all":{"type":"string","description":"All: 1 Yes 2 No"}},"required":["id","is_all"]}}}},"responses":{"200":{"description":"Success","content":{"application/json":{"schema":{}}},"headers":{}},"404":{"description":"Fail","content":{"application/json":{"schema":{}}},"headers":{}}}}}}}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/resource-management/prohibit-domain.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

---
<!-- PAGE: reference/error-codes.md -->

> For the complete documentation index, see [llms.txt](https://developer-api.novada.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://developer-api.novada.com/reference/error-codes.md).

# Error Codes

## Error Response Structure

All error responses use the following unified structure:

| Field  | Type     | Description                                                               |
| ------ | -------- | ------------------------------------------------------------------------- |
| `code` | `int`    | Business code: `0` = success; `!= 0` = failure (see the reference below). |
| `data` | `object` | When an error occurs, this field is empty.                                |
| `msg`  | `string` | Human-readable message. English by default, suitable for logging.         |

## Error Code Reference

{% hint style="info" %}
**The HTTP response code is always `200`.** Determine the specific error type by checking the business `code` field, not the HTTP status.
{% endhint %}

| HTTP  | code    | Trigger                              | Suggested Action                                                |
| ----- | ------- | ------------------------------------ | --------------------------------------------------------------- |
| `200` | `50001` | API Key does not exist or is invalid | Check the header and confirm the Key is copied in full.         |
| `200` | `50002` | API Key is disabled                  | Enable the Key in the Dashboard or use a different one.         |
| `200` | `50003` | API Key has expired                  | Renew the Key in the Dashboard or create a new one.             |
| `200` | `500`   | Server-side error                    | Report the issue with the `request_id` to <support@novada.com>. |


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://developer-api.novada.com/reference/error-codes.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

