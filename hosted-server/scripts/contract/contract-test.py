#!/usr/bin/env python3
"""
contract-test.py <base_url>

Novada MCP contract invariant tests — prevents truthfulness regressions.
stdlib only. Style mirrors scripts/golden/capture-golden.py.

Usage:
    export NOVADA_MCP_KEY=<your-key>   # or NOVADA_API_KEY
    python3 contract-test.py https://mcp.novada.com/mcp

Exit codes:
    0  all invariants pass (skipped invariants do NOT fail)
    1  one or more invariants fail

Invariants implemented (FULL):
    1. VERSION_AGREEMENT — initialize.serverInfo.version == novada_setup.server_version
                           == novada_discover.server_version

Invariants stubbed (raise SkipInvariant — pending phase D):
    2. NO_SILENT_NOOP      — country param actually routes through geo-exit-IP
    3. NO_LYING_ZERO       — price/balance fields are not silently zero when real value exists
    4. ADVERTISED_RESOURCE — every novada:// URI named in tool descriptions resolves via resources/read
    5. COST_VISIBILITY     — billable responses carry truthful quota/cost line
    6. HEALTH_TRUTH        — health probe agrees with a real render result
"""

import json, re, sys, os, urllib.request

KEY = os.environ.get("NOVADA_MCP_KEY") or os.environ.get("NOVADA_API_KEY")
if not KEY:
    print("[contract-test] ERROR: Set NOVADA_MCP_KEY (or NOVADA_API_KEY) in env — no key is baked into this script.")
    sys.exit(1)

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

# ─── invariant implementations ────────────────────────────────────────────────

def invariant_1_version_agreement(url: str) -> list[str]:
    """
    INVARIANT 1 — VERSION_AGREEMENT:
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
    INVARIANT 2 — NO_SILENT_NOOP (stub):
    When country=<X> is passed to a proxy tool, the returned proxy URL must
    actually route through an exit IP in that country — the tool must not silently
    accept and then ignore the parameter.

    Full implementation requires a live IP-geolocation probe against the returned
    proxy endpoint, which needs a separate network path outside the contract test.
    Pending phase D.
    """
    raise SkipInvariant("pending phase D")

def invariant_3_no_lying_zero(url: str) -> list[str]:
    """
    INVARIANT 3 — NO_LYING_ZERO (stub):
    Price, balance, and numeric result-count fields in tool responses must not be
    silently zeroed-out when the real upstream value is non-zero.  A zero that the
    upstream actually returned is fine; a zero substituted for a missing parse is not.

    Full implementation requires pairing tool output against a direct upstream API
    call to confirm the real value.  Pending phase D.
    """
    raise SkipInvariant("pending phase D")

def invariant_4_advertised_resource(url: str) -> list[str]:
    """
    INVARIANT 4 — ADVERTISED_RESOURCE (stub):
    Every novada:// URI that appears in any tool description must resolve
    successfully via a resources/read call.  A tool that advertises a URI it cannot
    serve is a lie.

    Full implementation: fetch tools/list, regex-scan descriptions for novada:// URIs,
    call resources/read on each, assert no error.  Pending phase D.
    """
    raise SkipInvariant("pending phase D")

def invariant_5_cost_visibility(url: str) -> list[str]:
    """
    INVARIANT 5 — COST_VISIBILITY (stub):
    Responses from billable tools (novada_search, novada_extract, novada_scrape, …)
    must carry a truthful quota / cost visibility footer so an agent can track spend.
    The footer must not report stale or fabricated numbers.

    Full implementation: call a billable tool, check quota_remaining in _meta,
    cross-validate against a novada_account call before and after.  Pending phase D.
    """
    raise SkipInvariant("pending phase D")

def invariant_6_health_truth(url: str) -> list[str]:
    """
    INVARIANT 6 — HEALTH_TRUTH (stub):
    The result of a novada_account health probe must agree with the observable
    behavior of an actual tool call.  If health says 'web_unblocker: OK', then
    novada_extract with render=render must not immediately fail with a service error.

    Full implementation: call novada_account, extract capability status, then
    cross-validate with matching tool calls.  Pending phase D.
    """
    raise SkipInvariant("pending phase D")

# ─── runner ───────────────────────────────────────────────────────────────────

INVARIANTS = [
    ("VERSION_AGREEMENT",     invariant_1_version_agreement),
    ("NO_SILENT_NOOP",        invariant_2_no_silent_noop),
    ("NO_LYING_ZERO",         invariant_3_no_lying_zero),
    ("ADVERTISED_RESOURCE",   invariant_4_advertised_resource),
    ("COST_VISIBILITY",       invariant_5_cost_visibility),
    ("HEALTH_TRUTH",          invariant_6_health_truth),
]

def run(base_url: str) -> int:
    """
    Run all invariants.  Returns 0 if all pass (or skip), 1 if any fail.
    """
    url = base_url.rstrip("/")

    print(f"\n[contract-test] target: {url}")
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
