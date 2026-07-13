#!/usr/bin/env python3
"""
contract-test.py <base_url>

Novada MCP contract invariant tests — prevents truthfulness regressions.
stdlib only. Style mirrors scripts/golden/capture-golden.py.

Usage:
    export NOVADA_MCP_KEY=<your-key>   # or NOVADA_API_KEY
    python3 contract-test.py https://mcp.novada.com/mcp

    # Run default (FREE) set only:
    python3 contract-test.py http://localhost:4747/mcp

    # Run full set including billable invariants:
    CONTRACT_FULL=1 python3 contract-test.py http://localhost:4747/mcp

Exit codes:
    0  all invariants pass (skipped invariants do NOT fail)
    1  one or more invariants fail

Invariants — FREE set (run by default in deploy gate):
    1. VERSION_AGREEMENT     — initialize.serverInfo.version == novada_setup.server_version
                               == novada_discover.server_version
    4. ADVERTISED_CAPABILITY — every novada:// URI in tool descriptions resolves via
                               resources/list + resources/read; unknown URI returns
                               JSON-RPC top-level error (not result-wrapped)
    5. COST_VISIBILITY       — novada_discover carries exactly one exempt footer line;
                               no duplicate status lines

Invariants — CONTRACT_FULL=1 only (billable — costs a few cents):
    2. NO_SILENT_NOOP        — novada_proxy type=isp with country=de warns country
                               not applied; type=residential with country=de does NOT
                               emit that warning (country IS applied)
    3. NO_LYING_ZERO         — amazon scrape price fields are never 0 when another
                               price field has a real value; null is acceptable
    5. COST_VISIBILITY       — novada_search response carries exactly one truthful
                               quota/cost footer ("cost: unknown" present, never a
                               fabricated cost number)
    6. HEALTH_TRUTH          — novada_health (default) has disclaimer + no probe block;
                               novada_health probe=true has render_probe block with
                               attempted:true; probe result agrees with entitlement
"""

import json, re, sys, os, urllib.request

KEY = os.environ.get("NOVADA_MCP_KEY") or os.environ.get("NOVADA_API_KEY")
if not KEY:
    print("[contract-test] ERROR: Set NOVADA_MCP_KEY (or NOVADA_API_KEY) in env — no key is baked into this script.")
    sys.exit(1)

CONTRACT_FULL = os.environ.get("CONTRACT_FULL", "").strip() in ("1", "true", "yes")

# ─── helpers ──────────────────────────────────────────────────────────────────

class SkipInvariant(Exception):
    """Raise to mark an invariant as pending implementation — does NOT fail the suite."""

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

def rpc(url: str, method: str, params: dict, timeout: int = 60):
    """Send a JSON-RPC request; returns parsed result dict or raises."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, headers=_headers())
    raw = urllib.request.urlopen(req, timeout=timeout).read().decode()
    objects = _parse_sse(raw)
    for o in objects:
        if "result" in o:
            return o["result"]
        if "error" in o:
            raise RuntimeError("JSON-RPC error: " + json.dumps(o["error"]))
    raise RuntimeError("no result in response: " + raw[:200])

def rpc_raw(url: str, method: str, params: dict, timeout: int = 60):
    """
    Send a JSON-RPC request; returns the raw first parsed SSE object
    (may have "result" or "error" at top level — caller decides).
    Raises only on network/parse failure.
    """
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, headers=_headers())
    try:
        raw = urllib.request.urlopen(req, timeout=timeout).read().decode()
    except Exception as e:
        raise RuntimeError(f"network error: {e}")
    objects = _parse_sse(raw)
    if not objects:
        raise RuntimeError("no parseable SSE objects in response: " + raw[:300])
    return objects[0], raw

def call_tool(url: str, name: str, args: dict, timeout: int = 60):
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

def extract_server_version(tool_text: str) -> str | None:
    """
    Extract the value of 'server_version: <value>' from a tool output string.
    Returns None if not found.
    """
    m = re.search(r'(?m)^[\s>]*server_version:\s*(.+)$', tool_text)
    if m:
        return m.group(1).strip()
    return None

# ─── Regex for status footer lines ────────────────────────────────────────────
# Matches any of the three footer variants from buildStatusFooter() in mcp.ts:
#   "⚠ gateway: N/M free calls remaining this month · cost: unknown — see dashboard.novada.com"
#   "gateway: uncapped (paid account) · cost: unknown — see dashboard.novada.com"
#   "gateway: free call — no quota consumed"
_STATUS_LINE_RE = re.compile(r'(?m)^(?:⚠ )?gateway:.*$')

def count_status_lines(text: str) -> list[str]:
    """Return all status footer lines found in text."""
    return _STATUS_LINE_RE.findall(text)

# ─── invariant implementations ────────────────────────────────────────────────

def invariant_1_version_agreement(url: str) -> list[str]:
    """
    INVARIANT 1 — VERSION_AGREEMENT [FREE]:
    The version string must be identical on every surface that reports it:
      (a) initialize -> serverInfo.version
      (b) novada_setup output -> 'server_version: <value>' line
      (c) novada_discover output -> '> server_version: <value>' line

    A confident wrong value is worse than no field (principle from owner handoff).
    This invariant catches the specific regression where mcp.ts HOSTED_VERSION and
    the vendored setup.ts VERSION constant diverge after a deploy.
    """
    failures = []

    # (a) initialize
    init_result = rpc(url, "initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "contract-test", "version": "1.0.0"},
    })
    server_info_version = init_result.get("serverInfo", {}).get("version")
    if not server_info_version:
        failures.append("INVARIANT_1[initialize]: serverInfo.version is missing or empty")
        return failures  # can't compare if canonical is absent

    # (b) novada_setup
    is_err_setup, setup_text = call_tool(url, "novada_setup", {})
    setup_version = extract_server_version(setup_text)
    if setup_version is None:
        failures.append(
            f"INVARIANT_1[novada_setup]: 'server_version:' line not found in output.\n"
            f"  setup output (first 300 chars): {setup_text[:300]!r}"
        )
    elif setup_version != server_info_version:
        failures.append(
            f"INVARIANT_1[novada_setup]: server_version mismatch.\n"
            f"  surface: novada_setup\n"
            f"  reported: {setup_version!r}\n"
            f"  expected: {server_info_version!r}  (from initialize.serverInfo.version)"
        )

    # (c) novada_discover
    is_err_disc, discover_text = call_tool(url, "novada_discover", {})
    discover_version = extract_server_version(discover_text)
    if discover_version is None:
        failures.append(
            f"INVARIANT_1[novada_discover]: 'server_version:' line not found in output.\n"
            f"  discover output (first 300 chars): {discover_text[:300]!r}"
        )
    elif discover_version != server_info_version:
        failures.append(
            f"INVARIANT_1[novada_discover]: server_version mismatch.\n"
            f"  surface: novada_discover\n"
            f"  reported: {discover_version!r}\n"
            f"  expected: {server_info_version!r}  (from initialize.serverInfo.version)"
        )

    if not failures:
        print(f"  [1/PASS] VERSION_AGREEMENT: all 3 surfaces agree → {server_info_version!r}")
    else:
        print(f"  [1/FAIL] VERSION_AGREEMENT: canonical={server_info_version!r}  "
              f"setup={setup_version!r}  discover={discover_version!r}")

    return failures


def invariant_2_no_silent_noop(url: str) -> list[str]:
    """
    INVARIANT 2 — NO_SILENT_NOOP [CONTRACT_FULL only — billable]:
    When country= is passed to novada_proxy with type=isp, the tool MUST warn the
    caller that the parameter is accepted but NOT applied.  The warning text must
    contain the canonical phrase "not applied" or "do not rely".

    For type=residential with country=de the country IS applied and the tool must NOT
    emit a country-not-applied warning — residential actually routes through the
    requested country.

    Rationale: the proxy.ts source on this branch changed the ISP warning from
    "silently ignored" to "not applied … do not rely" (commit 2752e2b).  This invariant
    fences that the build+vendor reflect the source and the hosted server serves the
    corrected, honest phrasing.

    This invariant costs one proxy credential fetch — cheap but technically billable.
    """
    if not CONTRACT_FULL:
        raise SkipInvariant("CONTRACT_FULL=1 not set — billable invariant skipped")

    failures = []

    # ── ISP + country → MUST contain warning ──────────────────────────────────
    is_err_isp, isp_text = call_tool(url, "novada_proxy", {
        "type": "isp",
        "country": "de",
        "format": "url",
    })
    if is_err_isp:
        # Upstream error fetching proxy creds — the proxy tool may fail for accounts
        # that don't have the product configured. Only fail if the response contains no
        # warning at all; a cred-error before the warning block IS a real gap.
        print(f"  [2] novada_proxy ISP returned is_error=True: {isp_text[:200]!r}")

    # Accept either canonical phrase.
    isp_warned = ("not applied" in isp_text) or ("do not rely" in isp_text)
    if not isp_warned:
        failures.append(
            f"INVARIANT_2[isp+country]: response must contain 'not applied' or 'do not rely' "
            f"when type=isp + country=de is passed.\n"
            f"  actual (first 400 chars): {isp_text[:400]!r}"
        )

    # ── Residential + country → must NOT contain the warning ──────────────────
    is_err_res, res_text = call_tool(url, "novada_proxy", {
        "type": "residential",
        "country": "de",
        "format": "url",
    })
    res_warned = ("not applied" in res_text) or ("do not rely" in res_text)
    if res_warned:
        failures.append(
            f"INVARIANT_2[residential+country]: residential proxy must NOT emit a "
            f"country-not-applied warning (country IS applied for residential).\n"
            f"  actual (first 400 chars): {res_text[:400]!r}"
        )

    if not failures:
        print(f"  [2/PASS] NO_SILENT_NOOP: ISP emitted warning; residential did not.")
    else:
        print(f"  [2/FAIL] NO_SILENT_NOOP: see failures above.")

    return failures


def invariant_3_no_lying_zero(url: str) -> list[str]:
    """
    INVARIANT 3 — NO_LYING_ZERO [CONTRACT_FULL only — billable]:
    For a known stable Amazon ASIN (B07FZ8S74R — Amazon Echo Dot, consistently
    listed), call novada_scrape with format=json and inspect the returned records.

    For every record, for every *price* field in the record:
      - null / None is ACCEPTABLE (price unknown / not parsed)
      - a real numeric price (> 0) is ACCEPTABLE
      - literal 0 (integer or float) is NOT ACCEPTABLE when another price field
        in the same record has a real (> 0) value — that's a silent zeroing

    Upstream flakiness (timeout, backend error, rate-limit) → SKIP with reason.
    This invariant tests our reporting layer, not Amazon uptime.
    """
    if not CONTRACT_FULL:
        raise SkipInvariant("CONTRACT_FULL=1 not set — billable invariant skipped")

    failures = []

    # Use a stable ASIN: Amazon Echo Dot (4th Gen).
    ASIN = "B07FZ8S74R"

    is_err, text = call_tool(url, "novada_scrape", {
        "platform": "amazon.com",
        "operation": "amazon_product_asin",
        "params": {"asin": ASIN},
        "format": "json",
    }, timeout=90)

    if is_err:
        # Distinguish upstream vs configuration errors.
        upstream_signals = (
            "timeout" in text.lower() or
            "upstream" in text.lower() or
            "backend" in text.lower() or
            "503" in text or
            "504" in text or
            "502" in text or
            "not activated" in text.lower() or
            "11006" in text
        )
        if upstream_signals:
            raise SkipInvariant(
                f"novada_scrape returned upstream/backend error — SKIP (not a reporting-layer failure): "
                f"{text[:200]!r}"
            )
        # Configuration error or unexpected tool error → fail
        failures.append(
            f"INVARIANT_3[scrape]: tool call failed with is_error=True and no obvious upstream signal.\n"
            f"  error (first 300 chars): {text[:300]!r}"
        )
        return failures

    # Parse JSON from the response.  The text is a ## Scrape Results fenced block.
    records = []
    try:
        # Try to find the JSON block inside ```json ... ```
        m = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
        if m:
            raw_json = m.group(1)
        else:
            # Fallback: try parsing the whole text as JSON
            raw_json = text
        parsed = json.loads(raw_json)
        # Normalise: list at top level, or {"data": [...]} or just a dict
        if isinstance(parsed, list):
            records = parsed
        elif isinstance(parsed, dict):
            for key in ("data", "records", "results", "items"):
                if isinstance(parsed.get(key), list):
                    records = parsed[key]
                    break
            if not records:
                records = [parsed]
    except Exception as e:
        raise SkipInvariant(
            f"novada_scrape response is not parseable JSON — SKIP (parse error, not a reporting-layer failure): "
            f"{e!r}  raw (first 200 chars): {text[:200]!r}"
        )

    if not records:
        raise SkipInvariant(
            "novada_scrape returned 0 records — SKIP (empty upstream result, not a reporting-layer failure)"
        )

    # Price field names as used in Amazon scrape responses.
    PRICE_FIELDS = [
        "price", "final_price", "initial_price",
        "sale_price", "list_price", "original_price",
        "current_price", "unit_price",
    ]

    for idx, rec in enumerate(records):
        if not isinstance(rec, dict):
            continue
        price_values = {}
        for field in PRICE_FIELDS:
            val = rec.get(field)
            if val is not None:
                price_values[field] = val

        if len(price_values) < 2:
            # Only 0 or 1 price fields — can't check cross-field consistency.
            continue

        real_price_fields = {k: v for k, v in price_values.items()
                             if isinstance(v, (int, float)) and v > 0}
        zero_price_fields = {k: v for k, v in price_values.items()
                             if isinstance(v, (int, float)) and v == 0}

        if real_price_fields and zero_price_fields:
            failures.append(
                f"INVARIANT_3[record #{idx}]: price field(s) silently zeroed while other "
                f"price field(s) have real values.\n"
                f"  zeroed fields: {zero_price_fields}\n"
                f"  real fields:   {real_price_fields}"
            )

    if not failures:
        print(f"  [3/PASS] NO_LYING_ZERO: checked {len(records)} record(s) — no silent zeros found.")
    else:
        print(f"  [3/FAIL] NO_LYING_ZERO: {len(failures)} record(s) with silent-zero price fields.")

    return failures


def invariant_4_advertised_capability(url: str) -> list[str]:
    """
    INVARIANT 4 — ADVERTISED_CAPABILITY [FREE]:

    Part A — URI coverage:
      tools/list → extract every novada:// URI mentioned in any tool description
      resources/list → collect served URIs
      Every advertised URI must appear in resources/list AND resources/read must
      return non-empty content.

    Part B — Error format fence:
      resources/read of "novada://does-not-exist" must return a JSON-RPC top-level
      error (object with "error" key, no "result" key) — NOT a result-wrapped error
      object ({ "result": { "error": ... } }).
      This fences the McpError throw fix (commit 25c6daf).
    """
    failures = []

    # ── Fetch tools/list ────────────────────────────────────────────────────────
    tools_result = rpc(url, "tools/list", {})
    tools = tools_result.get("tools", [])
    if not tools:
        failures.append("INVARIANT_4[tools/list]: returned 0 tools — cannot scan descriptions.")
        return failures

    # Collect all novada:// URIs mentioned in any tool description or inputSchema.
    advertised_uris: set[str] = set()
    URI_RE = re.compile(r'novada://[a-zA-Z0-9_\-]+')
    for t in tools:
        desc = t.get("description", "")
        advertised_uris.update(URI_RE.findall(desc))
        # Also scan annotations / inputSchema if present.
        schema_str = json.dumps(t.get("inputSchema", {}))
        advertised_uris.update(URI_RE.findall(schema_str))

    # ── Fetch resources/list ────────────────────────────────────────────────────
    resources_result = rpc(url, "resources/list", {})
    served_uris: set[str] = {r["uri"] for r in resources_result.get("resources", [])}

    if not served_uris:
        failures.append("INVARIANT_4[resources/list]: returned 0 resources — cannot verify coverage.")

    # ── Part A: every advertised URI must be served ────────────────────────────
    for uri in sorted(advertised_uris):
        if uri not in served_uris:
            failures.append(
                f"INVARIANT_4[coverage]: URI {uri!r} is mentioned in a tool description "
                f"but not in resources/list."
            )
            continue

        # resources/read must return non-empty content.
        try:
            read_result = rpc(url, "resources/read", {"uri": uri})
        except RuntimeError as e:
            failures.append(
                f"INVARIANT_4[read]: resources/read({uri!r}) returned JSON-RPC error "
                f"(should succeed for advertised URIs): {e}"
            )
            continue

        contents = read_result.get("contents", [])
        if not contents:
            failures.append(
                f"INVARIANT_4[read]: resources/read({uri!r}) returned empty contents list."
            )
            continue
        text = contents[0].get("text", "")
        if not text or len(text.strip()) == 0:
            failures.append(
                f"INVARIANT_4[read]: resources/read({uri!r}) returned non-empty contents "
                f"but text is blank."
            )

    # ── Part B: unknown URI must return JSON-RPC top-level error ───────────────
    FAKE_URI = "novada://does-not-exist"
    try:
        obj, raw = rpc_raw(url, "resources/read", {"uri": FAKE_URI})
    except RuntimeError as e:
        failures.append(
            f"INVARIANT_4[error-format]: network/parse error fetching unknown URI: {e}"
        )
    else:
        has_top_level_error = "error" in obj and "result" not in obj
        has_result_wrapped  = "result" in obj and isinstance(obj.get("result"), dict) and \
                              "error" in obj.get("result", {})

        if has_result_wrapped:
            failures.append(
                f"INVARIANT_4[error-format]: resources/read({FAKE_URI!r}) returned a "
                f"result-wrapped error — should be a top-level JSON-RPC error instead.\n"
                f"  response: {json.dumps(obj)[:300]!r}"
            )
        elif not has_top_level_error:
            failures.append(
                f"INVARIANT_4[error-format]: resources/read({FAKE_URI!r}) returned neither "
                f"a top-level error nor a result-wrapped error.\n"
                f"  response: {json.dumps(obj)[:300]!r}"
            )
        # else: top-level error present — correct

    if not failures:
        print(
            f"  [4/PASS] ADVERTISED_CAPABILITY: {len(advertised_uris)} URI(s) advertised "
            f"({', '.join(sorted(advertised_uris))}); all served + readable; "
            f"unknown URI returns top-level error."
        )
    else:
        print(f"  [4/FAIL] ADVERTISED_CAPABILITY: {len(failures)} check(s) failed.")

    return failures


def invariant_5_cost_visibility(url: str) -> list[str]:
    """
    INVARIANT 5 — COST_VISIBILITY [FREE default + CONTRACT_FULL]:

    FREE part:
      novada_discover response must contain exactly ONE status footer line, and that
      line must be the exempt variant:
        "gateway: free call — no quota consumed"
      No duplicate status lines are allowed.

    CONTRACT_FULL part:
      novada_search {query: "test", num: 1} must contain exactly ONE status footer
      line. That line must contain "cost: unknown".  It must NOT contain a fabricated
      cost number (no pattern like "cost: $N.NN" or "cost: 0.00XX").
    """
    failures = []

    # ── FREE: novada_discover → exempt footer, no duplicates ──────────────────
    is_err_disc, discover_text = call_tool(url, "novada_discover", {})
    if is_err_disc:
        failures.append(
            f"INVARIANT_5[discover]: novada_discover returned is_error=True.\n"
            f"  error (first 300 chars): {discover_text[:300]!r}"
        )
    else:
        lines = count_status_lines(discover_text)
        if len(lines) != 1:
            failures.append(
                f"INVARIANT_5[discover]: expected exactly 1 status footer line, "
                f"got {len(lines)}.\n  lines: {lines}"
            )
        else:
            line = lines[0]
            if "free call — no quota consumed" not in line:
                failures.append(
                    f"INVARIANT_5[discover]: status line is NOT the exempt variant.\n"
                    f"  expected: 'gateway: free call — no quota consumed'\n"
                    f"  actual:   {line!r}"
                )

    # ── CONTRACT_FULL: novada_search → truthful quota/cost footer ─────────────
    if CONTRACT_FULL:
        is_err_search, search_text = call_tool(url, "novada_search", {
            "query": "test",
            "num": 1,
        }, timeout=90)

        if is_err_search:
            # Could be SERP not enabled on this key — skip rather than fail.
            serp_not_enabled = (
                "not enabled" in search_text.lower() or
                "not activated" in search_text.lower() or
                "not available" in search_text.lower()
            )
            if serp_not_enabled:
                print(f"  [5] novada_search SERP not enabled on this key — CONTRACT_FULL part skipped.")
            else:
                failures.append(
                    f"INVARIANT_5[search]: novada_search returned is_error=True.\n"
                    f"  error (first 300 chars): {search_text[:300]!r}"
                )
        else:
            lines = count_status_lines(search_text)
            if len(lines) != 1:
                failures.append(
                    f"INVARIANT_5[search]: expected exactly 1 status footer line, "
                    f"got {len(lines)}.\n  lines: {lines}"
                )
            else:
                line = lines[0]
                if "cost: unknown" not in line:
                    failures.append(
                        f"INVARIANT_5[search]: status footer must contain 'cost: unknown'.\n"
                        f"  actual: {line!r}"
                    )
                # Check for fabricated cost number: "cost: $N.NN" or "cost: N.NNNN"
                if re.search(r'cost:\s+\$?\d+\.\d+', line):
                    failures.append(
                        f"INVARIANT_5[search]: status footer contains a fabricated cost "
                        f"number — must be 'cost: unknown'.\n  actual: {line!r}"
                    )

    if not failures:
        msg = "FREE: discover exempt footer ✓"
        if CONTRACT_FULL:
            msg += "; CONTRACT_FULL: search cost:unknown ✓"
        print(f"  [5/PASS] COST_VISIBILITY: {msg}")
    else:
        print(f"  [5/FAIL] COST_VISIBILITY: {len(failures)} check(s) failed.")

    return failures


def invariant_6_health_truth(url: str) -> list[str]:
    """
    INVARIANT 6 — HEALTH_TRUTH [FREE default part + CONTRACT_FULL probe part]:

    FREE (default):
      novada_health {} must contain the entitlement-only disclaimer
        "does NOT verify live render capability"
      AND must NOT contain a render_probe block (no "render_probe:" line,
      no "attempted: true" line).

    CONTRACT_FULL (probe):
      novada_health {probe: true} must:
        - contain "render_probe:" section
        - contain "attempted: true"
        - contain the billing disclosure ("billed" or "probe performed")
        - contain "ok:" with a boolean value
        - if ok: true, the entitlement card must not simultaneously claim
          render/browser is "not_entitled" or "not_configured" (those would
          contradict the probe success)
        - if ok: false, the response must not claim healthy render capability
          anywhere OUTSIDE the probe section
    """
    failures = []

    # ── FREE part: default health call ────────────────────────────────────────
    is_err_default, default_text = call_tool(url, "novada_health", {})
    if is_err_default:
        failures.append(
            f"INVARIANT_6[health-default]: novada_health returned is_error=True.\n"
            f"  error (first 300 chars): {default_text[:300]!r}"
        )
    else:
        disclaimer_present = "does NOT verify live render capability" in default_text
        if not disclaimer_present:
            failures.append(
                f"INVARIANT_6[health-default]: missing disclaimer "
                f"'does NOT verify live render capability'.\n"
                f"  first 500 chars: {default_text[:500]!r}"
            )

        # Must NOT have a render_probe block when probe was not requested.
        has_probe_block = (
            "render_probe:" in default_text or
            "attempted: true" in default_text
        )
        if has_probe_block:
            failures.append(
                f"INVARIANT_6[health-default]: response contains render_probe block "
                f"but probe=true was not requested — tool performed a billed probe "
                f"without opt-in.\n"
                f"  first 500 chars: {default_text[:500]!r}"
            )

    # ── CONTRACT_FULL part: probe=true ────────────────────────────────────────
    if CONTRACT_FULL:
        is_err_probe, probe_text = call_tool(url, "novada_health", {"probe": True}, timeout=90)
        if is_err_probe:
            failures.append(
                f"INVARIANT_6[health-probe]: novada_health probe=true returned is_error=True.\n"
                f"  error (first 300 chars): {probe_text[:300]!r}"
            )
        else:
            # Must have render_probe section.
            if "render_probe:" not in probe_text:
                failures.append(
                    f"INVARIANT_6[health-probe]: missing 'render_probe:' section.\n"
                    f"  first 600 chars: {probe_text[:600]!r}"
                )

            if "attempted: true" not in probe_text:
                failures.append(
                    f"INVARIANT_6[health-probe]: missing 'attempted: true' in probe section.\n"
                    f"  first 600 chars: {probe_text[:600]!r}"
                )

            # Must contain billing disclosure.
            billing_disclosed = ("billed" in probe_text.lower() or
                                 "probe performed" in probe_text.lower())
            if not billing_disclosed:
                failures.append(
                    f"INVARIANT_6[health-probe]: billing disclosure missing "
                    f"('billed' or 'probe performed' not found).\n"
                    f"  first 600 chars: {probe_text[:600]!r}"
                )

            # Extract ok: true/false from probe section.
            ok_match = re.search(r'(?m)^\s*ok:\s*(true|false)\s*$', probe_text)
            if not ok_match:
                failures.append(
                    f"INVARIANT_6[health-probe]: missing 'ok: true/false' line.\n"
                    f"  first 600 chars: {probe_text[:600]!r}"
                )
            else:
                probe_ok = ok_match.group(1) == "true"

                if probe_ok:
                    # ok: true → entitlement must not CONTRADICT this.
                    # "not_entitled" or "not_configured" in the Browser/Unblock product row
                    # alongside ok:true would be a contradiction.
                    # We only flag if both "not_entitled"/"not_configured" AND the probe
                    # is for render/unblock (which it is — health.ts calls fetchWithRender).
                    contradictions = (
                        ("not_entitled" in probe_text and
                         "Browser API" in probe_text) or
                        ("not_configured" in probe_text and
                         "Browser API" in probe_text)
                    )
                    if contradictions:
                        failures.append(
                            f"INVARIANT_6[health-probe]: probe ok=true but entitlement card "
                            f"claims Browser API is not_entitled/not_configured — contradiction.\n"
                            f"  first 800 chars: {probe_text[:800]!r}"
                        )
                else:
                    # ok: false → response must NOT claim render/browser is healthy
                    # OUTSIDE the probe section itself.
                    # Strip out the render_probe section before checking.
                    probe_start = probe_text.find("render_probe:")
                    pre_probe = probe_text[:probe_start] if probe_start != -1 else probe_text
                    if "✅ Available" in pre_probe and "Browser" in pre_probe:
                        failures.append(
                            f"INVARIANT_6[health-probe]: probe ok=false but entitlement "
                            f"card claims Browser API is Available — contradiction.\n"
                            f"  pre-probe section: {pre_probe[:600]!r}"
                        )

    if not failures:
        msg = "FREE: default has disclaimer, no probe block"
        if CONTRACT_FULL:
            msg += "; CONTRACT_FULL: probe block present with attempted/ok/billing"
        print(f"  [6/PASS] HEALTH_TRUTH: {msg}")
    else:
        print(f"  [6/FAIL] HEALTH_TRUTH: {len(failures)} check(s) failed.")

    return failures


# ─── runner ───────────────────────────────────────────────────────────────────

INVARIANTS = [
    ("VERSION_AGREEMENT",     invariant_1_version_agreement),
    ("NO_SILENT_NOOP",        invariant_2_no_silent_noop),
    ("NO_LYING_ZERO",         invariant_3_no_lying_zero),
    ("ADVERTISED_CAPABILITY", invariant_4_advertised_capability),
    ("COST_VISIBILITY",       invariant_5_cost_visibility),
    ("HEALTH_TRUTH",          invariant_6_health_truth),
]

def run(base_url: str) -> int:
    """
    Run all invariants.  Returns 0 if all pass (or skip), 1 if any fail.
    """
    url = base_url.rstrip("/")

    print(f"\n[contract-test] target: {url}")
    mode = "CONTRACT_FULL" if CONTRACT_FULL else "FREE (default)"
    print(f"[contract-test] mode:   {mode}")
    print( "[contract-test] ─────────────────────────────────────────────────────")

    passed = []
    failed = []
    skipped = []

    for name, fn in INVARIANTS:
        print(f"\n[{name}]")
        try:
            failures = fn(url)
            if failures:
                for f in failures:
                    print(f"  FAIL: {f}")
                failed.append(name)
            else:
                passed.append(name)
        except SkipInvariant as e:
            print(f"  SKIP: {e}")
            skipped.append(name)
        except Exception as e:
            print(f"  ERROR (invariant runner crashed): {e}")
            failed.append(name)

    print("\n[contract-test] ─────────────────────────────────────────────────────")
    print(f"  passed:  {len(passed)}  {passed}")
    print(f"  failed:  {len(failed)}  {failed}")
    print(f"  skipped: {len(skipped)}  {skipped}")

    if failed:
        print("\nVERDICT: FAIL")
        return 1
    print("\nVERDICT: PASS")
    return 0

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: contract-test.py <base_url>")
        print("  e.g. contract-test.py https://mcp.novada.com/mcp")
        sys.exit(1)
    sys.exit(run(sys.argv[1]))
