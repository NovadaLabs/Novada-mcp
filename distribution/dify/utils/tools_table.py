"""
Single source of truth for which Novada hosted-MCP tools this plugin exposes, and
which hosted parameters each one surfaces to the Dify form/LLM.

Design rule (class-not-instance): tool *behavior* is one shared handler
(`utils.tool_handler.invoke_novada_tool`), parameterized by `hosted_name`. The
per-tool files under `tools/*.py` are thin subclasses that exist only because Dify
requires one Python source file per tool entry — they must never grow tool-specific
logic. Adding a new exposed tool or parameter is a new row in `TOOLS` below, not a new
branch anywhere else.

`tests/test_tools_parity.py` loads this table plus a frozen snapshot of the real
hosted `tools/list` response (synced from
`hosted-server/scripts/golden/baseline/toolslist-default.json`) and asserts, for
every tool here:
  - every exposed param exists in the hosted `inputSchema` with a compatible type
  - every hosted-side `required` param is exposed
  - every `options` tuple matches the hosted `enum` exactly (as a set)

Complex hosted types (object/array — e.g. `novada_scrape`'s `params`, `novada_extract`'s
`fields`/array-shaped `url`, `novada_account`'s `products`) are exposed as a Dify
`string` holding JSON, decoded by the shared handler with a clear error on bad JSON —
see `ParamKind.JSON_ARRAY` / `ParamKind.JSON_OBJECT` below.
"""
from __future__ import annotations

from dataclasses import dataclass, field


class ParamKind:
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    SELECT = "select"
    JSON_ARRAY = "json_array"   # Dify string, JSON-decoded into a list for the hosted call
    JSON_OBJECT = "json_object"  # Dify string, JSON-decoded into a dict for the hosted call


# Dify manifest `type:` value for each ParamKind.
_DIFY_TYPE_BY_KIND: dict[str, str] = {
    ParamKind.STRING: "string",
    ParamKind.NUMBER: "number",
    ParamKind.BOOLEAN: "boolean",
    ParamKind.SELECT: "select",
    ParamKind.JSON_ARRAY: "string",
    ParamKind.JSON_OBJECT: "string",
}

# Hosted JSON-Schema `type` values each ParamKind is allowed to map onto. A hosted
# param whose schema uses `anyOf` instead of a single `type` is checked against the
# union of its branches' types (see tests/test_tools_parity.py:_hosted_types).
_COMPATIBLE_HOSTED_TYPES: dict[str, set[str]] = {
    ParamKind.STRING: {"string"},
    ParamKind.NUMBER: {"integer", "number"},
    ParamKind.BOOLEAN: {"boolean"},
    ParamKind.SELECT: {"string"},
    ParamKind.JSON_ARRAY: {"array"},
    ParamKind.JSON_OBJECT: {"object"},
}


@dataclass(frozen=True)
class ParamSpec:
    # Name used identically as the Dify parameter name AND the hosted tool argument
    # name — kept equal everywhere so the handler never needs a rename table.
    name: str
    kind: str
    required: bool = False
    options: tuple[str, ...] = ()  # kind == SELECT only; must equal the hosted enum
    default: object = None
    description_en: str = ""
    description_zh: str = ""

    @property
    def dify_type(self) -> str:
        return _DIFY_TYPE_BY_KIND[self.kind]

    @property
    def compatible_hosted_types(self) -> set[str]:
        return _COMPATIBLE_HOSTED_TYPES[self.kind]

    @property
    def is_json_encoded(self) -> bool:
        return self.kind in (ParamKind.JSON_ARRAY, ParamKind.JSON_OBJECT)


@dataclass(frozen=True)
class ToolSpec:
    hosted_name: str  # exact name on mcp.novada.com, e.g. "novada_search"
    label_en: str
    label_zh: str
    summary_en: str  # one-line, factual, no imperative ("always use...") language
    summary_zh: str
    params: tuple[ParamSpec, ...] = field(default_factory=tuple)

    def param(self, name: str) -> ParamSpec:
        for p in self.params:
            if p.name == name:
                return p
        raise KeyError(f"{self.hosted_name} has no param '{name}'")


TOOLS: tuple[ToolSpec, ...] = (
    ToolSpec(
        hosted_name="novada_search",
        label_en="Search the Web",
        label_zh="网页搜索",
        summary_en="Searches the web and returns ranked titles, URLs, and snippets.",
        summary_zh="搜索网页，返回按相关性排序的标题、链接与摘要。",
        params=(
            ParamSpec("query", ParamKind.STRING, required=True,
                      description_en="The search query text.",
                      description_zh="搜索关键词或问题。"),
            ParamSpec("num", ParamKind.NUMBER,
                      description_en="Number of results to return, 1-20. Default 10.",
                      description_zh="返回结果数量，1-20，默认 10。"),
            ParamSpec("engine", ParamKind.SELECT, options=("google", "duckduckgo", "yandex"),
                      default="google",
                      description_en="Search engine to use. Default google.",
                      description_zh="使用的搜索引擎,默认 google。"),
            ParamSpec("country", ParamKind.STRING,
                      description_en="ISO 3166-1 alpha-2 country code to geo-target results, e.g. us, de.",
                      description_zh="ISO 3166-1 两位国家代码,用于本地化结果,例如 us、de。"),
            ParamSpec("time_range", ParamKind.SELECT, options=("day", "week", "month", "year"),
                      description_en="Restrict results to a recency window.",
                      description_zh="限制结果的时间范围。"),
            ParamSpec("include_domains", ParamKind.JSON_ARRAY,
                      description_en='JSON array of up to 10 domains to restrict results to, e.g. ["github.com"].',
                      description_zh='仅返回这些域名的结果,JSON 数组字符串,最多 10 个,例如 ["github.com"]。'),
            ParamSpec("exclude_domains", ParamKind.JSON_ARRAY,
                      description_en='JSON array of up to 10 domains to exclude from results, e.g. ["reddit.com"].',
                      description_zh='排除这些域名的结果,JSON 数组字符串,最多 10 个,例如 ["reddit.com"]。'),
            ParamSpec("format", ParamKind.SELECT, options=("markdown", "json"), default="markdown",
                      description_en="Response shape. Default markdown.",
                      description_zh="返回格式,默认 markdown。"),
        ),
    ),
    ToolSpec(
        hosted_name="novada_extract",
        label_en="Extract a URL",
        label_zh="网页内容提取",
        summary_en="Extracts readable content from one URL, or a JSON array of up to 10 URLs for batch mode.",
        summary_zh="提取单个网址的正文内容;也可传入最多 10 个网址的 JSON 数组进行批量提取。",
        params=(
            ParamSpec("url", ParamKind.STRING, required=True,
                      description_en='A single URL, or a JSON array of up to 10 URLs for batch mode, e.g. ["https://a","https://b"].',
                      description_zh='单个网址,或最多 10 个网址的 JSON 数组字符串,例如 ["https://a","https://b"]。'),
            ParamSpec("clean", ParamKind.BOOLEAN,
                      description_en="If true, strips navigation/ads/footer and returns only the main content.",
                      description_zh="为 true 时去除导航栏、广告、页脚,仅返回正文内容。"),
            ParamSpec("format", ParamKind.SELECT, options=("text", "markdown", "html", "json"), default="markdown",
                      description_en="Response shape. Default markdown.",
                      description_zh="返回格式,默认 markdown。"),
            ParamSpec("render", ParamKind.SELECT,
                      options=("auto", "static", "render", "js", "browser"), default="auto",
                      description_en="Fetch strategy: auto escalates from static fetch to JS rendering as needed.",
                      description_zh="抓取策略:auto 会按需从静态抓取升级到 JS 渲染。"),
            ParamSpec("max_chars", ParamKind.NUMBER,
                      description_en="Maximum characters to return (1000-100000). Default 25000.",
                      description_zh="返回的最大字符数(1000-100000),默认 25000。"),
            ParamSpec("fields", ParamKind.JSON_ARRAY,
                      description_en='JSON array of specific fields to extract, e.g. ["price","author"].',
                      description_zh='需要提取的具体字段,JSON 数组字符串,例如 ["price","author"]。'),
            ParamSpec("country", ParamKind.STRING,
                      description_en="ISO 3166-1 alpha-2 country code to route the fetch through, e.g. de.",
                      description_zh="用于路由抓取请求的 ISO 两位国家代码,例如 de。"),
            ParamSpec("query", ParamKind.STRING,
                      description_en="Optional relevance context to help focus the extracted content.",
                      description_zh="可选的相关性上下文,用于聚焦提取的内容。"),
            ParamSpec("wait_for", ParamKind.STRING,
                      description_en="CSS selector to wait for before capturing content (render modes only).",
                      description_zh="渲染模式下,等待该 CSS 选择器出现后再截取内容。"),
            ParamSpec("wait_ms", ParamKind.NUMBER,
                      description_en="Fixed milliseconds to wait after load before capturing (render modes only).",
                      description_zh="渲染模式下,加载完成后固定等待的毫秒数。"),
        ),
    ),
    ToolSpec(
        hosted_name="novada_crawl",
        label_en="Crawl a Site",
        label_zh="多页面抓取",
        summary_en="Crawls up to 20 pages from a starting URL (breadth- or depth-first) and extracts each page.",
        summary_zh="从起始网址开始抓取最多 20 个页面(广度或深度优先),并提取每页内容。",
        params=(
            ParamSpec("url", ParamKind.STRING, required=True,
                      description_en="The starting URL to crawl from.",
                      description_zh="开始抓取的起始网址。"),
            ParamSpec("max_pages", ParamKind.NUMBER,
                      description_en="Maximum pages to crawl, 1-20. Default 5.",
                      description_zh="最大抓取页数,1-20,默认 5。"),
            ParamSpec("strategy", ParamKind.SELECT, options=("bfs", "dfs"), default="bfs",
                      description_en="Traversal order: breadth-first (bfs) or depth-first (dfs).",
                      description_zh="遍历顺序:广度优先(bfs)或深度优先(dfs)。"),
            ParamSpec("render", ParamKind.SELECT, options=("auto", "static", "render"), default="auto",
                      description_en="Fetch strategy per page. Default auto.",
                      description_zh="每页的抓取策略,默认 auto。"),
            ParamSpec("select_paths", ParamKind.JSON_ARRAY,
                      description_en='JSON array of glob patterns to restrict crawled paths, e.g. ["/docs/**"].',
                      description_zh='限定抓取路径的 glob 模式,JSON 数组字符串,例如 ["/docs/**"]。'),
            ParamSpec("exclude_paths", ParamKind.JSON_ARRAY,
                      description_en='JSON array of glob patterns to skip, e.g. ["/blog/**"].',
                      description_zh='需要跳过的路径 glob 模式,JSON 数组字符串,例如 ["/blog/**"]。'),
            ParamSpec("format", ParamKind.SELECT, options=("markdown", "json"), default="markdown",
                      description_en="Response shape. Default markdown.",
                      description_zh="返回格式,默认 markdown。"),
            ParamSpec("instructions", ParamKind.STRING,
                      description_en="Natural-language hint for which pages matter; echoed back, does not filter crawl scope by itself.",
                      description_zh="说明哪些页面重要的自然语言提示;会被原样返回,但本身不会过滤抓取范围。"),
        ),
    ),
    ToolSpec(
        hosted_name="novada_map",
        label_en="Map a Site",
        label_zh="网站地图发现",
        summary_en="Discovers up to 100 URLs on a site (sitemap first, then crawl fallback) without fetching content.",
        summary_zh="发现网站上最多 100 个网址(优先读取 sitemap,否则回退爬取),不抓取正文内容。",
        params=(
            ParamSpec("url", ParamKind.STRING, required=True,
                      description_en="The site URL to discover links from.",
                      description_zh="用于发现链接的网站地址。"),
            ParamSpec("search", ParamKind.STRING,
                      description_en="Substring to filter discovered URLs by.",
                      description_zh="用于筛选发现结果的子字符串。"),
            ParamSpec("limit", ParamKind.NUMBER,
                      description_en="Maximum URLs to return, 1-100. Default 50.",
                      description_zh="返回的最大网址数,1-100,默认 50。"),
            ParamSpec("max_depth", ParamKind.NUMBER,
                      description_en="Link-hops from the root to follow, 1-5. Default 2.",
                      description_zh="从根地址开始跟踪的链接跳数,1-5,默认 2。"),
            ParamSpec("include_subdomains", ParamKind.BOOLEAN,
                      description_en="If true, also discover URLs on subdomains. Default false.",
                      description_zh="为 true 时同时发现子域名上的网址,默认 false。"),
        ),
    ),
    ToolSpec(
        hosted_name="novada_research",
        label_en="Deep Research",
        label_zh="深度研究",
        summary_en="Runs several parallel web searches, dedupes, and extracts cited source passages for a question.",
        summary_zh="对一个问题并行执行多次网页搜索、去重并提取带引用的原始资料片段。",
        params=(
            # Hosted schema accepts either `question` or `query` with neither marked
            # schema-required (an either/or constraint JSON Schema can't express).
            # Exposed here as a single required Dify field — stricter than hosted,
            # which is a permitted deviation (see tests/test_tools_parity.py docstring).
            ParamSpec("question", ParamKind.STRING, required=True,
                      description_en="The research question or topic to investigate.",
                      description_zh="需要研究的问题或主题。"),
            ParamSpec("depth", ParamKind.SELECT, options=("quick", "deep", "auto", "comprehensive"),
                      default="auto",
                      description_en="How many parallel searches to run: quick (3), deep (6), comprehensive (8-9), or auto.",
                      description_zh="并行搜索次数档位:quick(3 次)、deep(6 次)、comprehensive(8-9 次)或 auto。"),
            ParamSpec("focus", ParamKind.STRING,
                      description_en="Optional focus area to guide sub-query generation.",
                      description_zh="可选的聚焦方向,用于指导子查询生成。"),
            ParamSpec("time_range", ParamKind.SELECT, options=("day", "week", "month", "year"),
                      description_en="Restrict results to a recency window.",
                      description_zh="限制结果的时间范围。"),
            ParamSpec("start_date", ParamKind.STRING,
                      description_en="ISO date (YYYY-MM-DD); only results on or after this date.",
                      description_zh="ISO 日期(YYYY-MM-DD),仅返回该日期及之后的结果。"),
            ParamSpec("end_date", ParamKind.STRING,
                      description_en="ISO date (YYYY-MM-DD); only results on or before this date.",
                      description_zh="ISO 日期(YYYY-MM-DD),仅返回该日期及之前的结果。"),
        ),
    ),
    ToolSpec(
        hosted_name="novada_scrape",
        label_en="Scrape a Platform",
        label_zh="平台结构化抓取",
        summary_en="Returns structured records for a named platform and operation, instead of raw HTML.",
        summary_zh="按指定平台与操作返回结构化记录,而非原始 HTML。",
        params=(
            ParamSpec("platform", ParamKind.STRING, required=True,
                      description_en='Platform domain, e.g. "amazon.com", "linkedin.com", "google.com".',
                      description_zh='平台域名,例如 "amazon.com"、"linkedin.com"、"google.com"。'),
            ParamSpec("operation", ParamKind.STRING, required=True,
                      description_en='Operation ID for the platform, e.g. "amazon_product_keywords".',
                      description_zh='该平台的操作 ID,例如 "amazon_product_keywords"。'),
            ParamSpec("params", ParamKind.JSON_OBJECT,
                      description_en='JSON object of operation-specific parameters, e.g. {"keyword":"iphone 16","num":5}.',
                      description_zh='操作所需参数,JSON 对象字符串,例如 {"keyword":"iphone 16","num":5}。'),
            ParamSpec("limit", ParamKind.NUMBER,
                      description_en="Maximum records to return, up to 100. Default 20.",
                      description_zh="返回的最大记录数,最多 100,默认 20。"),
            ParamSpec("format", ParamKind.SELECT,
                      options=("json", "csv", "excel", "html", "markdown", "toon"), default="markdown",
                      description_en="Response shape. Default markdown.",
                      description_zh="返回格式,默认 markdown。"),
            ParamSpec("task_id", ParamKind.STRING,
                      description_en="Resume a previous slow task by ID instead of submitting a new one.",
                      description_zh="按 ID 续取先前未完成的任务结果,而非提交新任务。"),
        ),
    ),
    ToolSpec(
        hosted_name="novada_account",
        label_en="Account & Billing",
        label_zh="账户与账单",
        summary_en="Reads wallet balance, plan quotas, usage history, or traffic for the authenticated account.",
        summary_zh="读取当前账户的钱包余额、套餐额度、用量历史或流量数据。",
        params=(
            ParamSpec("section", ParamKind.SELECT,
                      options=("summary", "balance", "usage", "plans", "traffic"), default="summary",
                      description_en="Which account data to fetch. Default summary.",
                      description_zh="要查询的账户数据类型,默认 summary。"),
            ParamSpec("format", ParamKind.SELECT, options=("card", "json"), default="card",
                      description_en="Response shape. Default card (human-readable).",
                      description_zh="返回格式,默认 card(易读格式)。"),
            ParamSpec("start_time", ParamKind.STRING,
                      description_en="Inclusive start date (YYYY-MM-DD); usage/traffic sections only.",
                      description_zh="起始日期(YYYY-MM-DD,含当天),仅用于 usage/traffic。"),
            ParamSpec("end_time", ParamKind.STRING,
                      description_en="Inclusive end date (YYYY-MM-DD); usage/traffic sections only.",
                      description_zh="结束日期(YYYY-MM-DD,含当天),仅用于 usage/traffic。"),
            ParamSpec("products", ParamKind.JSON_ARRAY,
                      description_en='JSON array of products to filter by; plans/traffic sections only, e.g. ["residential","static"].',
                      description_zh='按产品过滤,JSON 数组字符串,仅用于 plans/traffic,例如 ["residential","static"]。'),
            ParamSpec("page", ParamKind.NUMBER,
                      description_en="1-based page index; usage section only.",
                      description_zh="页码(从 1 开始),仅用于 usage。"),
            ParamSpec("page_size", ParamKind.NUMBER,
                      description_en="Page size, up to 200; usage section only.",
                      description_zh="每页大小,最多 200,仅用于 usage。"),
        ),
    ),
)

TOOLS_BY_NAME: dict[str, ToolSpec] = {t.hosted_name: t for t in TOOLS}
