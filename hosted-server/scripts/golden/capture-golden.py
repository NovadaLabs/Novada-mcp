#!/usr/bin/env python3
"""
capture-golden.py <base_url> <outdir>

Golden-behavior snapshot for Novada hosted MCP.
SSE/JSON-RPC transport. Key-sorted, volatile-normalized output.
All captured files are deterministic: two identical-behavior runs produce byte-identical output.
"""

import json, re, sys, os, time, urllib.request, concurrent.futures as cf
from pathlib import Path

KEY = os.environ.get("NOVADA_API_KEY") or os.environ.get("NOVADA_MCP_KEY")
if not KEY:
    sys.exit("Set NOVADA_API_KEY (or NOVADA_MCP_KEY) in env — no key is baked into this script.")

# ─── volatile normalization ───────────────────────────────────────────────────
_MONEY_RE   = re.compile(r'\b\d+(?:\.\d+)?\s*(?:USD|credits?|GB|MB)\b', re.I)
_MONEY2_RE  = re.compile(r'(?<=["\s:,\[])(\d+\.\d{2,})(?=["\s,\]\}])')
_TS_RE      = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?')
_DATE_RE    = re.compile(r'\d{4}-\d{2}-\d{2}')
_CRED_RE    = re.compile(r'wss?://[^\s"\'<>]+|[A-Za-z0-9_\-]{16,}(?=["\s])', re.I)
_SESSID_RE  = re.compile(r'session[_-]?id["\s]*[:=]["\s]*[A-Za-z0-9_\-]{8,}', re.I)
_COUNT_RE   = re.compile(r'"(?:total|count|page|remaining|balance)["\s]*:["\s]*\d+', re.I)
# inline prose counts, e.g. "12 results", "3 sources", "5 urls"
_UNIT = r'(sources?|results?|items?|pages?|urls?|records?|links?|matches?|posts?|reviews?)'
_INLINE_COUNT_RE = re.compile(r'\b\d+\s+' + _UNIT + r'\b', re.I)
# parenthetical counts inside headers, e.g. "(8 sources)"
_PAREN_COUNT_RE  = re.compile(r'\(\s*\d+\s+' + _UNIT + r'\s*\)', re.I)

# Proxy cred pattern  user:pass@host
_PROXYCRED_RE = re.compile(r'[A-Za-z0-9_\-]+:[A-Za-z0-9_\-@#$%^&*!]+@[A-Za-z0-9.\-]+')

# Section headers that appear only CONDITIONALLY based on result volume / content
# (not on routing) — these must not enter the golden marker set.
_CONDITIONAL_HEADERS = {
    "agent action",
    "agent notice — under-delivery",
    "agent notice - under-delivery",
    "chainable output",
}

def normalize(text: str) -> str:
    t = _TS_RE.sub('<TS>', text)
    t = _MONEY_RE.sub('<MONEY>', t)
    t = _MONEY2_RE.sub('<MONEY>', t)
    t = _DATE_RE.sub('<DATE>', t)
    t = _PROXYCRED_RE.sub('<CRED>', t)
    t = _SESSID_RE.sub('"session_id":"<CRED>"', t)
    # count/balance numbers (JSON-shaped)
    def _replace_count(m):
        return m.group(0).split(':')[0] + '": <N>'
    t = _COUNT_RE.sub(_replace_count, t)
    # inline prose counts that leak into section headers e.g. "(8 sources)", "12 results"
    t = _INLINE_COUNT_RE.sub(r'<N> \1', t)
    t = _PAREN_COUNT_RE.sub(r'(<N> \1)', t)
    return t

# ─── HTTP helpers ──────────────────────────────────────────────────────────────
def _headers():
    return {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": "Bearer " + KEY,
    }

def _parse_sse(raw: str):
    """Return list of parsed JSON objects from SSE stream."""
    results = []
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("data: "):
            line = line[6:]
        if not line:
            continue
        try:
            results.append(json.loads(line))
        except Exception:
            pass
    return results

def rpc(url: str, method: str, params: dict, timeout: int = 70):
    """Send a JSON-RPC request; returns parsed result dict or raises."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, headers=_headers())
    raw = urllib.request.urlopen(req, timeout=timeout).read().decode()
    objects = _parse_sse(raw)
    for o in objects:
        if "result" in o:
            return o["result"]
        if "error" in o:
            raise RuntimeError(json.dumps(o["error"]))
    raise RuntimeError("no result in: " + raw[:200])

def call_tool(url: str, name: str, args: dict, timeout: int = 70):
    """Call tools/call; returns (is_error, text_content)."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": name, "arguments": args}}).encode()
    req = urllib.request.Request(url, data=body, headers=_headers())
    try:
        raw = urllib.request.urlopen(req, timeout=timeout).read().decode()
    except Exception as e:
        return True, f"EXCEPTION: {e}"
    objects = _parse_sse(raw)
    for o in objects:
        r = o.get("result", {})
        if not r and "error" in o:
            return True, json.dumps(o["error"])
        content = r.get("content", [])
        text = content[0].get("text", "") if content else ""
        is_error = bool(r.get("isError", False))
        return is_error, text
    return True, "NO_RESPONSE: " + raw[:200]

# ─── structural extraction ────────────────────────────────────────────────────
def _section_headers(text: str) -> list:
    """Extract markdown section headers (## Foo) in order."""
    return re.findall(r'^#{1,4}\s+(.+)', text, re.MULTILINE)

def _top_keys(text: str) -> list:
    """If text looks like JSON, return sorted top-level keys."""
    stripped = text.strip()
    if stripped.startswith('{'):
        try:
            o = json.loads(stripped)
            return sorted(o.keys())
        except Exception:
            pass
    if stripped.startswith('['):
        try:
            arr = json.loads(stripped)
            if arr and isinstance(arr[0], dict):
                return sorted(arr[0].keys())
        except Exception:
            pass
    return []

# Markers that echo live per-result CONTENT (SERP titles, result rows, query echo)
# must NOT enter the golden set — they change run-to-run with unchanged behavior.
# Keep only the STABLE structural skeleton (fixed section headers).
_RESULT_ROW_RE = re.compile(
    r'^\s*(?:\d+\.\s|\[\d+\]\s|[-*]\s|\d+\)\s)',       # "1. ", "[3] ", "- ", "2) "
    re.I)

def _stable_markers(headers: list) -> list:
    """Keep only the fixed section skeleton, order-preserved.
    Drops: numbered/bulleted live result rows AND content-conditional headers.
    """
    out = []
    for h in headers:
        h = h.strip()
        if _RESULT_ROW_RE.match(h):
            continue                       # numbered/bulleted live result row → volatile
        if h.lower() in _CONDITIONAL_HEADERS:
            continue                       # appears only when result volume triggers it
        out.append(h)
    return out

def _length_band(n: int) -> str:
    """Order-of-magnitude band — stable across content-length drift within a decade."""
    if n == 0:      return "empty"
    if n < 500:     return "xs"       # error/stub envelopes
    if n < 2000:    return "s"
    if n < 10000:   return "m"
    if n < 100000:  return "l"
    return "xl"

def structural_repr(is_error: bool, text: str) -> dict:
    """Normalized structural representation (no volatile content).

    length_band is an order-of-magnitude bucket so live-content length drift
    (SERP text varying by hundreds/thousands of chars) stays in the same band.
    Result-row + content-conditional markers are stripped so only the fixed
    section skeleton survives.
    """
    norm_text = normalize(text)
    length_band = _length_band(len(text))

    headers = _section_headers(norm_text)
    top_keys = _top_keys(norm_text)

    if top_keys:
        structural = "json"
        markers = top_keys
    elif headers:
        structural = "markdown"
        markers = _stable_markers(headers)
    else:
        structural = "other"
        markers = []

    return {
        "status": "err" if is_error else "ok",
        "structural": structural,
        "markers": markers,
        "length_band": length_band,
    }

# ─── tool list helpers ────────────────────────────────────────────────────────
def fetch_tools_list(url: str) -> list:
    result = rpc(url, "tools/list", {})
    tools = result.get("tools", [])
    normalized = []
    for t in tools:
        normalized.append({
            "name": t.get("name"),
            "description": t.get("description", ""),
            "inputSchema": t.get("inputSchema", {}),
            "annotations": t.get("annotations", {}),
        })
    return sorted(normalized, key=lambda x: x["name"])

# ─── main capture ─────────────────────────────────────────────────────────────
def capture(base_url: str, outdir: str):
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)

    # URLs
    url_default = base_url
    url_all     = base_url + ("&" if "?" in base_url else "?") + "groups=all"

    def url_group(g):
        return base_url + ("&" if "?" in base_url else "?") + f"groups={g}"

    print(f"[capture] base={base_url}  outdir={outdir}")

    # ── 1. initialize.json + version.txt ──────────────────────────────────────
    print("[1/7] initialize ...")
    init_result = rpc(url_all, "initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "golden-capture", "version": "1.0.0"},
    })
    server_info = init_result.get("serverInfo", {})
    version = server_info.get("version", "unknown")

    # Write version separately
    (out / "version.txt").write_text(version + "\n")

    # Strip version from serverInfo so initialize.json diffs clean
    server_info_clean = {k: (v if k != "version" else "<VERSION>")
                         for k, v in server_info.items()}

    init_payload = {
        "serverInfo": server_info_clean,
        "capabilities": init_result.get("capabilities", {}),
    }
    (out / "initialize.json").write_text(
        json.dumps(init_payload, sort_keys=True, indent=2) + "\n")
    print(f"    serverInfo.name={server_info.get('name')}  version={version}")

    # ── 2. toolslist-default.json ─────────────────────────────────────────────
    print("[2/7] tools/list (default) ...")
    tools_default = fetch_tools_list(url_default)
    (out / "toolslist-default.json").write_text(
        json.dumps(tools_default, sort_keys=True, indent=2) + "\n")
    print(f"    {len(tools_default)} tools (default)")

    # ── 3. toolslist-all.json ─────────────────────────────────────────────────
    print("[3/7] tools/list (all) ...")
    tools_all = fetch_tools_list(url_all)
    (out / "toolslist-all.json").write_text(
        json.dumps(tools_all, sort_keys=True, indent=2) + "\n")
    print(f"    {len(tools_all)} tools (all)")

    # ── 4. toolslist-groups.json ──────────────────────────────────────────────
    print("[4/7] tools/list per group ...")
    KNOWN_GROUPS = ["core", "account", "proxy", "browser", "scraper", "content", "research", "monitor"]
    groups_result = {}
    for g in KNOWN_GROUPS:
        try:
            tl = fetch_tools_list(url_group(g))
            groups_result[g] = sorted([t["name"] for t in tl])
        except Exception as e:
            groups_result[g] = []
            print(f"    group={g} error: {e}")
    (out / "toolslist-groups.json").write_text(
        json.dumps(groups_result, sort_keys=True, indent=2) + "\n")
    non_empty = [g for g, names in groups_result.items() if names]
    print(f"    non-empty groups: {non_empty}")

    # ── 5. dispatch-matrix.json ───────────────────────────────────────────────
    print("[5/7] dispatch matrix (parallel) ...")

    # Visible tools (use ?groups=all to ensure they're reachable)
    VISIBLE_TESTS = [
        ("novada_search",           {"query": "anthropic claude", "num": 2}),
        ("novada_extract",          {"url": "https://example.com"}),
        ("novada_crawl",            {"url": "https://example.com", "max_pages": 2}),
        ("novada_research",         {"question": "what is anthropic"}),
        ("novada_map",              {"url": "https://example.com"}),
        ("novada_scrape",           {"platform": "amazon.com", "operation": "amazon_product_keywords",
                                     "params": {"keyword": "usb cable", "num": 2}}),
        ("novada_browser",          {"actions": [
                                         {"action": "navigate", "url": "https://example.com",
                                          "wait_until": "domcontentloaded"},
                                         {"action": "evaluate", "script": "document.title"}]}),
        ("novada_proxy",            {"type": "residential"}),
        ("novada_discover",         {}),
        ("novada_ai_monitor",       {"brand": "novada"}),
        ("novada_monitor",          {"url": "https://example.com"}),
        ("novada_setup",            {}),
        ("novada_account_summary",  {}),
        ("novada_proxy_account_list", {"product": "1"}),
        # create WITHOUT confirm = dry-run
        ("novada_proxy_account_create", {"product": "1", "account": "goldentest01",
                                          "password": "Testpass12345"}),
    ]

    # Hidden alias probes (the regression guard)
    ALIAS_TESTS = [
        ("novada_health",               {}),
        ("novada_health_all",           {}),
        ("novada_wallet_balance",       {}),
        ("novada_wallet_usage_record",  {}),
        ("novada_plan_balance_all",     {}),
        ("novada_traffic_daily",        {}),
        ("novada_capture_logs",         {}),
        ("novada_account_summary",      {}),  # also in visible — intentional double-probe
        ("novada_verify",               {"claim": "anthropic makes claude"}),
        ("novada_unblock",              {"url": "https://example.com"}),
        ("novada_proxy_residential",    {}),
        ("novada_proxy_isp",            {}),
        ("novada_proxy_datacenter",     {}),
        ("novada_proxy_mobile",         {}),
        ("novada_proxy_static",         {"country": "us", "session_id": "golden-probe-001"}),
        ("novada_proxy_dedicated",      {"session_id": "golden-probe-002"}),
        ("novada_scraper_submit",       {"platform": "amazon.com",
                                          "operation": "amazon_product_keywords",
                                          "params": {"keyword": "test", "num": 1}}),
        ("novada_scraper_status",       {"task_id": "golden-test-task-id"}),
        ("novada_scraper_result",       {"task_id": "golden-test-task-id"}),
    ]

    all_tests = VISIBLE_TESTS + ALIAS_TESTS
    matrix = {}
    NOT_ENABLED_MARKERS = {"tool_not_enabled", "unknown tool", "tool not found",
                           "not found", "is not available"}

    def _run_dispatch(name, args):
        try:
            is_err, text = call_tool(url_all, name, args, timeout=70)
            rep = structural_repr(is_err, text)
            # Check for "not enabled" signals
            low = text.lower()
            if any(m in low for m in NOT_ENABLED_MARKERS):
                rep["not_enabled"] = True
            return name, rep
        except Exception as e:
            return name, {"status": "timeout", "structural": "other",
                          "markers": [], "length_band": "empty",
                          "exception": str(e)[:120]}

    with cf.ThreadPoolExecutor(max_workers=20) as ex:
        futs = {ex.submit(_run_dispatch, n, a): n for n, a in all_tests}
        for fut in cf.as_completed(futs):
            n, rep = fut.result()
            matrix[n] = rep
            flag = " [NOT_ENABLED!]" if rep.get("not_enabled") else ""
            print(f"    {n}: {rep['status']} {rep['structural']} {rep['length_band']}{flag}")

    (out / "dispatch-matrix.json").write_text(
        json.dumps(matrix, sort_keys=True, indent=2) + "\n")

    # ── 5b. refused-set.json ──────────────────────────────────────────────────
    # Firewall regression guard: these tools MUST be refused on the hosted endpoint.
    # If a refactor wrongly EXPOSES one, refused flips to false → breach caught by diff.
    print("[5b] refused-set (firewall guard) ...")
    REFUSED_NAMES = [
        "novada_site_copy",
        "novada_ip_whitelist",
        "novada_static_ip_mgmt",
        "novada_capture_apikey",
        "novada_scraper_task_mgmt",
        "novada_session_stats",
        "novada_search_feedback",
        "novada_browser_flow",
    ]

    def _classify_refusal(name, is_err, text):
        low = text.lower()
        # Extract bracketed error code e.g. [TOOL_NOT_ENABLED] / [NOT_AVAILABLE]
        m = re.search(r'\[([A-Z_]+)\]', text)
        if m:
            code = m.group(1)
        elif "tool_not_enabled" in low:
            code = "TOOL_NOT_ENABLED"
        elif "not available" in low or "not_available" in low:
            code = "NOT_AVAILABLE"
        elif "unknown tool" in low or "not found" in low:
            code = "UNKNOWN_TOOL"
        else:
            code = "other"
        # refused = server rejected the call (error) AND signalled a not-enabled/unavailable code
        refused = bool(is_err) and code in ("TOOL_NOT_ENABLED", "NOT_AVAILABLE", "UNKNOWN_TOOL")
        return {"name": name, "refused": refused, "code": code, "isError": bool(is_err)}

    def _run_refused(name):
        try:
            is_err, text = call_tool(url_all, name, {}, timeout=70)
            return name, _classify_refusal(name, is_err, text)
        except Exception as e:
            return name, {"name": name, "refused": False, "code": "timeout",
                          "isError": True, "exception": str(e)[:120]}

    refused_matrix = {}
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(_run_refused, n): n for n in REFUSED_NAMES}
        for fut in cf.as_completed(futs):
            n, rep = fut.result()
            refused_matrix[n] = rep
            flag = "" if rep["refused"] else "  <-- BREACH! not refused"
            print(f"    {n}: refused={rep['refused']} code={rep['code']}{flag}")

    (out / "refused-set.json").write_text(
        json.dumps(refused_matrix, sort_keys=True, indent=2) + "\n")
    refused_ok = [n for n, r in refused_matrix.items() if r["refused"]]
    refused_breach = [n for n, r in refused_matrix.items() if not r["refused"]]

    # ── 6. error-path.json ────────────────────────────────────────────────────
    print("[6/7] error paths ...")
    error_cases = {}

    # Bad URL
    is_err, text = call_tool(url_all, "novada_extract", {"url": "not-a-valid-url"})
    norm = normalize(text)
    error_cases["extract_bad_url"] = {
        "is_error": is_err,
        "has_agent_instruction": "agent_instruction" in norm.lower(),
        "error_markers": _stable_markers(_section_headers(norm)) or _top_keys(norm),
        "length_band": _length_band(len(text)),
    }

    # Missing required param
    is_err2, text2 = call_tool(url_all, "novada_search", {})
    norm2 = normalize(text2)
    error_cases["search_missing_query"] = {
        "is_error": is_err2,
        "has_agent_instruction": "agent_instruction" in norm2.lower(),
        "error_markers": _stable_markers(_section_headers(norm2)) or _top_keys(norm2),
        "length_band": _length_band(len(text2)),
    }

    (out / "error-path.json").write_text(
        json.dumps(error_cases, sort_keys=True, indent=2) + "\n")
    print(f"    extract_bad_url is_error={error_cases['extract_bad_url']['is_error']}")
    print(f"    search_missing_query is_error={error_cases['search_missing_query']['is_error']}")

    # ── 7. redaction-probe.json ───────────────────────────────────────────────
    print("[7/7] redaction probe ...")

    # Try an invalid country code to trigger a proxy error that might expose creds
    probe_result = {"triggered": False}
    probe_calls = [
        ("novada_proxy", {"type": "residential", "country": "zz"}),
        ("novada_proxy_residential", {"country": "zz"}),
        ("novada_unblock", {"url": "https://this-domain-should-not-exist-golden.invalid"}),
    ]
    for pname, pargs in probe_calls:
        is_err_p, text_p = call_tool(url_all, pname, pargs, timeout=70)
        if is_err_p or text_p:
            probe_result["triggered"] = True
            probe_result["trigger_tool"] = pname
            # Distinguish real credential leaks from expected public endpoint hostnames.
            # proxy.novada.pro is the PUBLIC proxy endpoint (shown to users, masked creds ***).
            # A real leak = unmasked user:pass@host with actual password (not ***).
            real_cred_leak = bool(re.search(
                r'[A-Za-z0-9_]{4,}:[A-Za-z0-9_@#$%^&*!]{6,}@[A-Za-z0-9.\-]+',
                text_p))
            leaked_patterns = {
                # True secret leak: real unmasked password before @host
                "unmasked_user_pass_at_host": real_cred_leak,
                # internal-only hosts (not in public docs)
                "internal_api_m": "api-m.novada.com" in text_p,
                # proxy.novada.pro is public endpoint — flag only if unmasked creds precede it
                "proxy_host_with_unmasked_creds": bool(re.search(
                    r'[A-Za-z0-9_]+:[^*\s]{4,}@proxy\.novada', text_p)),
            }
            leaked = any(leaked_patterns.values())
            probe_result["leaked"] = leaked
            probe_result["leak_checks"] = leaked_patterns
            # Note: proxy.novada.pro hostname appears in normal proxy responses (expected)
            probe_result["note"] = ("proxy.novada.pro hostname appears in response (expected public endpoint). "
                                    "leaked=True only if unmasked credentials precede @host.")
            # Record sample markers from normalized text
            norm_p = normalize(text_p)
            probe_result["sample_markers"] = _section_headers(norm_p)[:5] or _top_keys(norm_p)[:5]
            probe_result["is_error"] = is_err_p
            break

    if not probe_result.get("triggered"):
        probe_result["note"] = "No probe call returned a response that triggered an error condition"

    (out / "redaction-probe.json").write_text(
        json.dumps(probe_result, sort_keys=True, indent=2) + "\n")
    print(f"    triggered={probe_result.get('triggered')}  leaked={probe_result.get('leaked', 'N/A')}")

    # ── Summary stats ──────────────────────────────────────────────────────────
    alias_names = {n for n, _ in ALIAS_TESTS}
    aliases_ok  = [n for n in alias_names if matrix.get(n, {}).get("status") in ("ok", "err")
                   and not matrix.get(n, {}).get("not_enabled")]
    aliases_bad = [n for n in alias_names if matrix.get(n, {}).get("not_enabled") or
                   matrix.get(n, {}).get("status") not in ("ok", "err")]

    print("\n========================================")
    print(f"DONE. Files in {outdir}/")
    print(f"  initialize.json  toolslist-default.json  toolslist-all.json")
    print(f"  toolslist-groups.json  dispatch-matrix.json  refused-set.json")
    print(f"  error-path.json  redaction-probe.json  version.txt")
    print(f"\nVisible tools (default): {len(tools_default)}")
    print(f"Visible tools (all):     {len(tools_all)}")
    print(f"Aliases OK ({len(aliases_ok)}/19):  {sorted(aliases_ok)}")
    if aliases_bad:
        print(f"ALIASES FAILED: {sorted(aliases_bad)}")
    print(f"Refused OK ({len(refused_ok)}/8): {sorted(refused_ok)}")
    if refused_breach:
        print(f"FIREWALL BREACH (not refused): {sorted(refused_breach)}")
    print("========================================\n")

    return {
        "tools_default": len(tools_default),
        "tools_all": len(tools_all),
        "version": version,
        "aliases_ok": aliases_ok,
        "aliases_bad": aliases_bad,
        "refused_ok": refused_ok,
        "refused_breach": refused_breach,
        "probe_triggered": probe_result.get("triggered", False),
        "probe_leaked": probe_result.get("leaked", None),
    }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: capture-golden.py <base_url> <outdir>")
        sys.exit(1)
    base_url = sys.argv[1].rstrip("/")
    outdir   = sys.argv[2]
    stats = capture(base_url, outdir)
    print(json.dumps(stats, indent=2))
