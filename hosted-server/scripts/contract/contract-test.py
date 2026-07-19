#!/usr/bin/env python3
"""
contract-test.py <base_url>
contract-test.py --transport=stdio [path/to/npm-package/build/index.js]

Novada MCP contract invariant tests — prevents truthfulness regressions.
stdlib only. Style mirrors scripts/golden/capture-golden.py.

Two transports, one invariant suite:

    http (default) — speaks JSON-RPC over HTTP POST + SSE-framed responses
    against a DEPLOYED URL (mcp.novada.com or a local hosted-server dev
    instance). This is the original, unchanged code path.

    stdio           — speaks JSON-RPC over stdio (newline-delimited JSON, no
    Content-Length framing — see @modelcontextprotocol/sdk's
    shared/stdio.js ReadBuffer) against a SPAWNED `node <build/index.js>`
    process. This is the local surface every `npx novada-mcp` user actually
    runs, and until this transport existed it had zero dynamic contract
    coverage — only the hosted HTTP surface was ever exercised here.

Usage:
    export NOVADA_MCP_KEY=<your-key>   # or NOVADA_API_KEY
    python3 contract-test.py https://mcp.novada.com/mcp

    # Run default (FREE) set only:
    python3 contract-test.py http://localhost:4747/mcp

    # Run full set including billable invariants:
    CONTRACT_FULL=1 python3 contract-test.py http://localhost:4747/mcp

    # Run the FREE set against the LOCAL stdio server (builds must exist —
    # run `npm run build` in npm-package/ first). No real API key required:
    # a dummy test key is used automatically unless NOVADA_MCP_KEY/
    # NOVADA_API_KEY is already set in the environment. CONTRACT_FULL is
    # refused for stdio (see below) — this path never makes a billed call.
    python3 contract-test.py --transport=stdio
    python3 contract-test.py --transport=stdio /path/to/npm-package/build/index.js

Exit codes:
    0  all invariants pass (skipped invariants do NOT fail)
    1  one or more invariants fail, or the transport itself could not start

Invariants — FREE set (run by default in deploy gate; also the stdio set):
    1. VERSION_AGREEMENT     — initialize.serverInfo.version == novada_setup.server_version
                               == novada_discover.server_version
                               [http + stdio — both surfaces read the same VERSION constant]
    4. ADVERTISED_CAPABILITY — every novada:// URI in tool descriptions resolves via
                               resources/list + resources/read; unknown URI returns
                               JSON-RPC top-level error (not result-wrapped)
                               [http + stdio — resources/* handlers are shared code]
    5. COST_VISIBILITY       — novada_discover carries exactly one exempt footer line;
                               no duplicate status lines
                               [http ONLY — buildStatusFooter() lives exclusively in
                               hosted-server/vercel/api/mcp.ts; npm-package/src has no
                               concept of a gateway quota footer. SKIPPED on stdio.]
    7. OAUTH_METADATA        — /.well-known/oauth-authorization-server[/mcp] and
                               /.well-known/oauth-protected-resource[/mcp] serve
                               S256-only public-client metadata rooted at the
                               origin; unauthenticated POST /mcp returns 401 with
                               a WWW-Authenticate header carrying resource_metadata=
                               [http ONLY — stdio has no HTTP surface at all. SKIPPED
                               on stdio.]

Invariants — CONTRACT_FULL=1 only (billable — costs a few cents; http only,
CONTRACT_FULL is refused outright for stdio, see StdioTransport):
    2. NO_SILENT_NOOP        — novada_proxy type=isp with country=de warns country
                               not applied; type=residential with country=de does NOT
                               emit that warning (country IS applied)
    3. NO_LYING_ZERO         — amazon scrape price fields are never 0 when another
                               price field has a real value; null is acceptable
    6. HEALTH_TRUTH          — novada_health (default) has disclaimer + no probe block
                               [FREE part — applies to BOTH http and stdio; verified:
                               novada_health is a hidden alias to novada_account(section=
                               "summary") + HEALTH_PROBE_DISCLAIMER in core.ts, identical
                               code path on both surfaces];
                               novada_health probe=true has render_probe block with
                               attempted:true; probe result agrees with entitlement
                               [CONTRACT_FULL part — billed, http only in practice since
                               CONTRACT_FULL never runs against stdio]
"""

import abc
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

KEY = os.environ.get("NOVADA_MCP_KEY") or os.environ.get("NOVADA_API_KEY")

CONTRACT_FULL = os.environ.get("CONTRACT_FULL", "").strip() in ("1", "true", "yes")

# Dummy key used ONLY for the stdio transport when no real key is present in the
# environment. The FREE invariants check self-description structure (version
# strings, resource URIs, disclaimer text) — none of them require a VALID key,
# and the tools under test (novada_setup, novada_discover, novada_health) are
# all written to degrade gracefully (never throw) on an auth rejection or even
# a fully offline network — see setup.ts's validateKey() and health.ts's
# per-product .catch() handlers, both verified empirically against this exact
# dummy key while writing this harness.
STDIO_DUMMY_KEY = "nk_test_dummy_contract_key_stdio_free_invariants"


# ─── helpers ──────────────────────────────────────────────────────────────────

class SkipInvariant(Exception):
    """Raise to mark an invariant as pending implementation, or not applicable
    to the transport under test — does NOT fail the suite."""


def _headers(key: str):
    return {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": "Bearer " + key,
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


def _http_rpc(url: str, key: str, method: str, params: dict, timeout: int = 60):
    """Send a JSON-RPC request over HTTP+SSE; returns parsed result dict or raises.
    UNCHANGED from the original single-transport implementation."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, headers=_headers(key))
    raw = urllib.request.urlopen(req, timeout=timeout).read().decode()
    objects = _parse_sse(raw)
    for o in objects:
        if "result" in o:
            return o["result"]
        if "error" in o:
            raise RuntimeError("JSON-RPC error: " + json.dumps(o["error"]))
    raise RuntimeError("no result in response: " + raw[:200])


def _http_rpc_raw(url: str, key: str, method: str, params: dict, timeout: int = 60):
    """
    Send a JSON-RPC request over HTTP+SSE; returns the raw first parsed SSE object
    (may have "result" or "error" at top level — caller decides).
    Raises only on network/parse failure. UNCHANGED from the original.
    """
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, headers=_headers(key))
    try:
        raw = urllib.request.urlopen(req, timeout=timeout).read().decode()
    except Exception as e:
        raise RuntimeError(f"network error: {e}")
    objects = _parse_sse(raw)
    if not objects:
        raise RuntimeError("no parseable SSE objects in response: " + raw[:300])
    return objects[0], raw


def _http_call_tool(url: str, key: str, name: str, args: dict, timeout: int = 60):
    """Call tools/call over HTTP+SSE; returns (is_error, text_content). UNCHANGED."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": name, "arguments": args}}).encode()
    req = urllib.request.Request(url, data=body, headers=_headers(key))
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
# NOTE: this wrapper is HOSTED-ONLY (hosted-server/vercel/api/mcp.ts). It never
# runs over stdio — see invariant_5_cost_visibility's transport gate below.
_STATUS_LINE_RE = re.compile(r'(?m)^(?:⚠ )?gateway:.*$')


def count_status_lines(text: str) -> list[str]:
    """Return all status footer lines found in text."""
    return _STATUS_LINE_RE.findall(text)


# ─── Transport abstraction ─────────────────────────────────────────────────────
# The invariant functions below only ever call transport.rpc / transport.rpc_raw
# / transport.call_tool — they have no idea whether they're talking to a
# deployed HTTP+SSE endpoint or a spawned local stdio process. This is what
# lets the SAME 7 invariants run against BOTH surfaces without duplicating any
# invariant logic. Two capability flags (has_http_surface, has_gateway_cost_footer)
# let the couple of genuinely HOSTED-ONLY invariants (OAUTH_METADATA,
# COST_VISIBILITY) skip themselves cleanly instead of failing on a surface that
# was never supposed to have them.

class Transport(abc.ABC):
    label: str = "transport"
    has_http_surface: bool = False
    has_gateway_cost_footer: bool = False

    @abc.abstractmethod
    def rpc(self, method: str, params: dict, timeout: int = 60) -> dict:
        """Send a JSON-RPC request; return the parsed `result` dict or raise."""

    @abc.abstractmethod
    def rpc_raw(self, method: str, params: dict, timeout: int = 60):
        """Send a JSON-RPC request; return (raw_top_level_object, raw_text)."""

    @abc.abstractmethod
    def call_tool(self, name: str, args: dict, timeout: int = 60):
        """Call tools/call; return (is_error, text_content)."""

    def close(self) -> None:
        """Release any transport-owned resources (process, connection, ...)."""


class HttpSseTransport(Transport):
    """Wraps the original, unmodified HTTP+SSE request functions. Behavior is
    byte-for-byte identical to the pre-refactor single-transport script."""

    has_http_surface = True
    has_gateway_cost_footer = True

    def __init__(self, base_url: str, key: str):
        self.url = base_url.rstrip("/")
        self.origin = self.url.rsplit("/mcp", 1)[0]
        self.key = key
        self.label = f"http+sse ({self.url})"

    def rpc(self, method, params, timeout=60):
        return _http_rpc(self.url, self.key, method, params, timeout)

    def rpc_raw(self, method, params, timeout=60):
        return _http_rpc_raw(self.url, self.key, method, params, timeout)

    def call_tool(self, name, args, timeout=60):
        return _http_call_tool(self.url, self.key, name, args, timeout)

    def get_json(self, url: str):
        """GET url → (parsed_dict, None) on success, (None, reason) on any failure.
        HTTP-only capability used exclusively by invariant 7."""
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        try:
            raw = urllib.request.urlopen(req, timeout=30).read().decode()
        except Exception as e:
            return None, f"GET failed: {e}"
        try:
            parsed = json.loads(raw)
        except Exception:
            return None, f"response is not JSON (first 200 chars): {raw[:200]!r}"
        if not isinstance(parsed, dict):
            return None, f"response JSON is not an object (first 200 chars): {raw[:200]!r}"
        return parsed, None


class StdioTransport(Transport):
    """
    Speaks MCP JSON-RPC over stdio to a spawned `node <build/index.js>` process.

    Framing: newline-delimited JSON, ONE object per line, no Content-Length
    headers (unlike LSP) — confirmed against @modelcontextprotocol/sdk's
    shared/stdio.js: ReadBuffer.readMessage() splits the buffer on '\\n' and
    serializeMessage() is just `JSON.stringify(message) + '\\n'`.

    Error path (traced, not hand-waved): if `node <entry>` doesn't exist, isn't
    executable, or the server crashes/never responds during the handshake, this
    constructor raises RuntimeError within `spawn_timeout` seconds — it never
    hangs. Every subsequent rpc()/call_tool() call is ALSO bounded by its own
    timeout + a liveness check (`self.proc.poll()`), so a mid-run crash surfaces
    as a clear error (with the process's stderr tail attached) instead of the
    harness hanging on a read that will never arrive.
    """

    has_http_surface = False
    has_gateway_cost_footer = False

    def __init__(self, entry_path: str, api_key: str, spawn_timeout: float = 15.0):
        self.entry_path = entry_path
        self.label = f"stdio (node {entry_path})"
        self._id_counter = 0
        self._id_lock = threading.Lock()
        self._stderr_lines: list[str] = []
        self._EOF = object()

        if not os.path.isfile(entry_path):
            raise RuntimeError(
                f"stdio transport: build entry not found at {entry_path!r}. "
                f"Run `npm run build` in npm-package/ first (this harness never builds "
                f"for you), or pass the correct path as the second CLI argument."
            )

        env = dict(os.environ)
        env["NOVADA_API_KEY"] = api_key
        # Never let a stray operator env var accidentally unlock a billed developer
        # path during the stdio FREE run — the stdio transport is FREE-invariant-only.
        env.pop("NOVADA_DEVELOPER_API_KEY", None)

        try:
            self.proc = subprocess.Popen(
                ["node", entry_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env=env,
            )
        except Exception as e:
            raise RuntimeError(f"stdio transport: failed to spawn `node {entry_path}`: {e}")

        self._out_queue: "queue.Queue" = queue.Queue()
        self._reader = threading.Thread(target=self._read_stdout_loop, daemon=True)
        self._reader.start()
        self._stderr_reader = threading.Thread(target=self._read_stderr_loop, daemon=True)
        self._stderr_reader.start()

        # Handshake: initialize, THEN notifications/initialized (mirrors a real
        # MCP client). The server's Server class has no gate that requires this
        # notification before serving other requests (verified against
        # @modelcontextprotocol/sdk's Server._oninitialize — it is a pure,
        # idempotent function with no session-state side effect), but sending it
        # keeps this harness honest about what a real client does.
        try:
            init_result = self._request("initialize", {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "contract-test-stdio", "version": "1.0.0"},
            }, timeout=spawn_timeout)
        except Exception as e:
            self.close(force=True)
            # `e` already carries a full _death_message() (stderr tail + exit code) when
            # it originates from _request's own timeout/EOF/write-failure paths — don't
            # wrap it a second time (that just duplicates the stderr tail in the output).
            raise RuntimeError(f"server did not complete initialize handshake: {e}")

        if "error" in init_result:
            self.close(force=True)
            raise RuntimeError(
                f"stdio transport: initialize returned a JSON-RPC error: {init_result['error']}"
            )

        self._notify("notifications/initialized", {})
        self._init_result = init_result.get("result", {})

    # ── low-level plumbing ─────────────────────────────────────────────────

    def _next_id(self) -> int:
        with self._id_lock:
            self._id_counter += 1
            return self._id_counter

    def _read_stdout_loop(self) -> None:
        try:
            assert self.proc.stdout is not None
            for line in self.proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                self._out_queue.put(obj)
        except Exception:
            pass
        finally:
            self._out_queue.put(self._EOF)

    def _read_stderr_loop(self) -> None:
        try:
            assert self.proc.stderr is not None
            for line in self.proc.stderr:
                self._stderr_lines.append(line.rstrip("\n"))
                if len(self._stderr_lines) > 200:
                    self._stderr_lines.pop(0)
        except Exception:
            pass

    def _death_message(self, context: str) -> str:
        exit_code = self.proc.poll()
        tail = "\n".join(self._stderr_lines[-20:])
        return (
            f"stdio transport: {context} (process exit code: {exit_code!r})\n"
            f"  stderr tail:\n{tail}"
        )

    def _write(self, obj: dict) -> None:
        assert self.proc.stdin is not None
        line = json.dumps(obj) + "\n"
        try:
            self.proc.stdin.write(line)
            self.proc.stdin.flush()
        except Exception as e:
            raise RuntimeError(self._death_message(f"failed to write to child stdin: {e}"))

    def _notify(self, method: str, params: dict) -> None:
        self._write({"jsonrpc": "2.0", "method": method, "params": params})

    def _request(self, method: str, params: dict, timeout: float = 60) -> dict:
        """Send a request and return the raw top-level JSON-RPC envelope
        (`{"result": ...}` or `{"error": ...}`). Bounded by `timeout` — never
        hangs: polls the response queue in short slices so a dead process is
        noticed promptly rather than only after the full timeout elapses."""
        req_id = self._next_id()
        self._write({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})

        deadline = time.time() + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                if self.proc.poll() is not None:
                    raise RuntimeError(self._death_message(f"process exited while waiting for {method!r}"))
                raise RuntimeError(
                    f"stdio transport: timed out after {timeout}s waiting for response to {method!r} "
                    f"(process still alive — server may be hung)"
                )
            try:
                obj = self._out_queue.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                if self.proc.poll() is not None:
                    raise RuntimeError(self._death_message(f"process exited while waiting for {method!r}"))
                continue
            if obj is self._EOF:
                raise RuntimeError(self._death_message(f"stdout closed while waiting for {method!r}"))
            if obj.get("id") == req_id:
                return obj
            # Notification or a response to a stale/unrelated id — ignore and keep waiting.

    # ── Transport interface ────────────────────────────────────────────────

    def rpc(self, method, params, timeout=60):
        obj = self._request(method, params, timeout)
        if "result" in obj:
            return obj["result"]
        if "error" in obj:
            raise RuntimeError("JSON-RPC error: " + json.dumps(obj["error"]))
        raise RuntimeError(f"no result in response: {json.dumps(obj)[:200]}")

    def rpc_raw(self, method, params, timeout=60):
        obj = self._request(method, params, timeout)
        return obj, json.dumps(obj)

    def call_tool(self, name, args, timeout=60):
        try:
            obj = self._request("tools/call", {"name": name, "arguments": args}, timeout)
        except Exception as e:
            return True, f"EXCEPTION: {e}"
        r = obj.get("result", {})
        if not r and "error" in obj:
            return True, json.dumps(obj["error"])
        content = r.get("content", [])
        text = content[0].get("text", "") if content else ""
        is_error = bool(r.get("isError", False))
        return is_error, text

    def close(self, force: bool = False) -> None:
        proc = getattr(self, "proc", None)
        if proc is None:
            return
        try:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
        except Exception:
            pass


# ─── invariant implementations ────────────────────────────────────────────────
# Every invariant function now takes a `transport: Transport` instead of a raw
# `url: str`, and calls transport.rpc / transport.rpc_raw / transport.call_tool.
# This is the ONLY change to invariants 1/2/3/4/6 — their pass/fail logic is
# untouched. Invariants 5 and 7 gained an early transport-capability check
# (SkipInvariant) because they test a HOSTED-ONLY concept that structurally
# cannot exist on the other surface — see each function's docstring.

def invariant_1_version_agreement(transport: Transport) -> list[str]:
    """
    INVARIANT 1 — VERSION_AGREEMENT [FREE — http + stdio]:
    The version string must be identical on every surface that reports it:
      (a) initialize -> serverInfo.version
      (b) novada_setup output -> 'server_version: <value>' line
      (c) novada_discover output -> '> server_version: <value>' line

    A confident wrong value is worse than no field (principle from owner handoff).
    This invariant catches the specific regression where mcp.ts HOSTED_VERSION and
    the vendored setup.ts VERSION constant diverge after a deploy.

    Applies identically to stdio: setup.ts / discover.ts read
    `process.env.NOVADA_SERVER_VERSION ?? VERSION` and initialize's
    serverInfo.version reads the same VERSION constant (src/config.ts) — no
    NOVADA_SERVER_VERSION override exists in stdio mode, so all three
    necessarily agree unless the build is broken.
    """
    failures = []

    # (a) initialize
    init_result = transport.rpc("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "contract-test", "version": "1.0.0"},
    })
    server_info_version = init_result.get("serverInfo", {}).get("version")
    if not server_info_version:
        failures.append("INVARIANT_1[initialize]: serverInfo.version is missing or empty")
        return failures  # can't compare if canonical is absent

    # (b) novada_setup
    is_err_setup, setup_text = transport.call_tool("novada_setup", {})
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
    is_err_disc, discover_text = transport.call_tool("novada_discover", {})
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


def invariant_2_no_silent_noop(transport: Transport) -> list[str]:
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
    CONTRACT_FULL never runs against stdio (see StdioTransport / main()), so in
    practice this only ever executes against the http transport, but the logic
    itself is transport-agnostic (novada_proxy exists identically on both surfaces).
    """
    if not CONTRACT_FULL:
        raise SkipInvariant("CONTRACT_FULL=1 not set — billable invariant skipped")

    failures = []

    # ── ISP + country → MUST contain warning ──────────────────────────────────
    is_err_isp, isp_text = transport.call_tool("novada_proxy", {
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
    is_err_res, res_text = transport.call_tool("novada_proxy", {
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


def invariant_3_no_lying_zero(transport: Transport) -> list[str]:
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

    is_err, text = transport.call_tool("novada_scrape", {
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


def invariant_4_advertised_capability(transport: Transport) -> list[str]:
    """
    INVARIANT 4 — ADVERTISED_CAPABILITY [FREE — http + stdio]:

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

    Applies identically to stdio: resources/list + resources/read are handled by
    the SAME src/resources/index.ts code the hosted server vendors — verified
    empirically (6 resources served, unknown URI returns a top-level JSON-RPC
    error, both surfaces).
    """
    failures = []

    # ── Fetch tools/list ────────────────────────────────────────────────────────
    tools_result = transport.rpc("tools/list", {})
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
    resources_result = transport.rpc("resources/list", {})
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
            read_result = transport.rpc("resources/read", {"uri": uri})
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
        obj, raw = transport.rpc_raw("resources/read", {"uri": FAKE_URI})
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


def invariant_5_cost_visibility(transport: Transport) -> list[str]:
    """
    INVARIANT 5 — COST_VISIBILITY [FREE default + CONTRACT_FULL — http ONLY]:

    FREE part:
      novada_discover response must contain exactly ONE status footer line, and that
      line must be the exempt variant:
        "gateway: free call — no quota consumed"
      No duplicate status lines are allowed.

    CONTRACT_FULL part:
      novada_search {query: "test", num: 1} must contain exactly ONE status footer
      line. That line must contain "cost: unknown".  It must NOT contain a fabricated
      cost number (no pattern like "cost: $N.NN" or "cost: 0.00XX").

    HOSTED-ONLY: `buildStatusFooter()` (the sole source of every "gateway: ..."
    line this invariant looks for) is defined exclusively in
    hosted-server/vercel/api/mcp.ts. npm-package/src has zero occurrences of
    "gateway:" or "buildStatusFooter" (grepped) — the stdio surface has no
    concept of a monthly free-call quota or a cost footer at all. Confirmed
    empirically: novada_discover over stdio emits zero "gateway:" lines.
    Skips cleanly on stdio rather than failing on a concept that was never
    supposed to exist there.
    """
    if not transport.has_gateway_cost_footer:
        raise SkipInvariant(
            f"{transport.label}: buildStatusFooter()/gateway cost-footer is a hosted-only "
            f"wrapper (hosted-server/vercel/api/mcp.ts) — SKIP (not applicable, not a gap)"
        )

    failures = []

    # ── FREE: novada_discover → exempt footer, no duplicates ──────────────────
    is_err_disc, discover_text = transport.call_tool("novada_discover", {})
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
        is_err_search, search_text = transport.call_tool("novada_search", {
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


def invariant_6_health_truth(transport: Transport) -> list[str]:
    """
    INVARIANT 6 — HEALTH_TRUTH [FREE default part — http + stdio; CONTRACT_FULL
    probe part — billable, http only in practice]:

    FREE (default):
      novada_health {} must contain the entitlement-only disclaimer
        "does NOT verify live render capability"
      AND must NOT contain a render_probe block (no "render_probe:" line,
      no "attempted: true" line).

    Applies identically to stdio: novada_health is a hidden alias that routes to
    novadaAccount(section="summary") + HEALTH_PROBE_DISCLAIMER in core.ts — the
    SAME dispatch code the hosted server vendors. Verified empirically with a
    dummy key over stdio: the disclaimer renders and no probe block appears,
    because every per-product fetch inside novadaAccount/novadaHealth is wrapped
    in try/catch and degrades to an "error" status row rather than throwing —
    this invariant needs no valid key or reachable network to pass structurally.

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
    is_err_default, default_text = transport.call_tool("novada_health", {})
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
        is_err_probe, probe_text = transport.call_tool("novada_health", {"probe": True}, timeout=90)
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


def invariant_7_oauth_metadata(transport: Transport) -> list[str]:
    """
    INVARIANT 7 — OAUTH_METADATA [FREE — http ONLY]:

    OAuth 2.0 discovery surface (Firecrawl parity — RFC 8414 + RFC 9728):

    Part A — authorization-server metadata:
      GET <origin>/.well-known/oauth-authorization-server (and the /mcp variant)
      must return JSON where issuer == origin, PKCE is S256-only, only public
      clients are supported (token_endpoint_auth_methods_supported == ["none"]),
      and the authorization/token/registration endpoints are rooted at the issuer.

    Part B — protected-resource metadata:
      GET <origin>/.well-known/oauth-protected-resource (and the /mcp variant)
      must return JSON where authorization_servers == [origin] and resource
      ends with /mcp (both discovery paths must agree on the MCP endpoint).

    Part C — 401 discovery trigger:
      An unauthenticated POST to the MCP endpoint must return 401 with a
      WWW-Authenticate header containing "resource_metadata=" — this is how
      OAuth-capable MCP clients bootstrap discovery.

    On a server where OAuth is not yet deployed, every check fails cleanly
    (reported as failures, never a crash) and the suite verdict is FAIL.

    HOSTED-ONLY: a spawned stdio process has no HTTP listener at all — there is
    no origin, no well-known path, no 401 response to check. Skips cleanly on
    stdio rather than failing on a surface that structurally cannot serve
    OAuth discovery metadata.
    """
    if not transport.has_http_surface:
        raise SkipInvariant(
            f"{transport.label}: no HTTP surface — OAuth discovery (/.well-known/...) is a "
            f"hosted-only concept (stdio has no listening socket at all) — SKIP (not applicable)"
        )

    failures = []
    url = transport.url
    origin = transport.origin

    def get_json(u: str):
        return transport.get_json(u)

    # ── Part A: authorization-server metadata (bare + /mcp variant) ────────────
    for path in ("/.well-known/oauth-authorization-server",
                 "/.well-known/oauth-authorization-server/mcp"):
        meta, err = get_json(origin + path)
        if err:
            failures.append(f"INVARIANT_7[as-metadata {path}]: {err}")
            continue
        issuer = meta.get("issuer")
        if issuer != origin:
            failures.append(
                f"INVARIANT_7[as-metadata {path}]: issuer mismatch.\n"
                f"  reported: {issuer!r}\n"
                f"  expected: {origin!r}  (derived from target URL)"
            )
        if meta.get("code_challenge_methods_supported") != ["S256"]:
            failures.append(
                f"INVARIANT_7[as-metadata {path}]: code_challenge_methods_supported "
                f"must be exactly ['S256'] (PKCE mandatory, no 'plain').\n"
                f"  actual: {meta.get('code_challenge_methods_supported')!r}"
            )
        if meta.get("token_endpoint_auth_methods_supported") != ["none"]:
            failures.append(
                f"INVARIANT_7[as-metadata {path}]: token_endpoint_auth_methods_supported "
                f"must be exactly ['none'] (public clients only).\n"
                f"  actual: {meta.get('token_endpoint_auth_methods_supported')!r}"
            )
        base = issuer if isinstance(issuer, str) and issuer else origin
        for ep in ("authorization_endpoint", "token_endpoint", "registration_endpoint"):
            val = meta.get(ep)
            if not isinstance(val, str) or not val.startswith(base):
                failures.append(
                    f"INVARIANT_7[as-metadata {path}]: {ep} missing or not rooted at issuer.\n"
                    f"  actual: {val!r}\n"
                    f"  issuer: {base!r}"
                )

    # ── Part B: protected-resource metadata (bare + /mcp variant) ──────────────
    for path in ("/.well-known/oauth-protected-resource",
                 "/.well-known/oauth-protected-resource/mcp"):
        meta, err = get_json(origin + path)
        if err:
            failures.append(f"INVARIANT_7[pr-metadata {path}]: {err}")
            continue
        if meta.get("authorization_servers") != [origin]:
            failures.append(
                f"INVARIANT_7[pr-metadata {path}]: authorization_servers must be "
                f"exactly [{origin!r}].\n"
                f"  actual: {meta.get('authorization_servers')!r}"
            )
        resource = meta.get("resource")
        if not isinstance(resource, str) or not resource.endswith("/mcp"):
            failures.append(
                f"INVARIANT_7[pr-metadata {path}]: resource must end with '/mcp' "
                f"(the MCP endpoint IS the resource).\n"
                f"  actual: {resource!r}"
            )

    # ── Part C: unauthenticated 401 carries the discovery pointer ──────────────
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {}}).encode()
    # Deliberately NO Authorization header — the 401 path is the point.
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        failures.append(
            f"INVARIANT_7[401-trigger]: unauthenticated POST returned "
            f"HTTP {resp.status} — expected 401."
        )
    except urllib.error.HTTPError as e:
        if e.code != 401:
            failures.append(
                f"INVARIANT_7[401-trigger]: unauthenticated POST returned "
                f"HTTP {e.code} — expected 401."
            )
        else:
            www_auth = e.headers.get("WWW-Authenticate") or ""
            if "resource_metadata=" not in www_auth:
                failures.append(
                    f"INVARIANT_7[401-trigger]: 401 response is missing the "
                    f"'resource_metadata=' pointer in WWW-Authenticate — OAuth "
                    f"clients cannot bootstrap discovery.\n"
                    f"  WWW-Authenticate: {www_auth!r}"
                )
    except Exception as e:
        failures.append(f"INVARIANT_7[401-trigger]: network error: {e}")

    if not failures:
        print("  [7/PASS] OAUTH_METADATA: AS + PR metadata correct on all 4 discovery "
              "paths; unauthenticated 401 carries resource_metadata= pointer.")
    else:
        print(f"  [7/FAIL] OAUTH_METADATA: {len(failures)} check(s) failed.")

    return failures


# ─── runner ───────────────────────────────────────────────────────────────────

INVARIANTS = [
    ("VERSION_AGREEMENT",     invariant_1_version_agreement),
    ("NO_SILENT_NOOP",        invariant_2_no_silent_noop),
    ("NO_LYING_ZERO",         invariant_3_no_lying_zero),
    ("ADVERTISED_CAPABILITY", invariant_4_advertised_capability),
    ("COST_VISIBILITY",       invariant_5_cost_visibility),
    ("HEALTH_TRUTH",          invariant_6_health_truth),
    ("OAUTH_METADATA",        invariant_7_oauth_metadata),
]


def run_invariants(transport: Transport) -> int:
    """
    Run all invariants against `transport`. Returns 0 if all pass (or skip),
    1 if any fail. Identical driver loop for every transport — this is the
    "one invariant suite, N transports" contract this refactor exists to enforce.
    """
    print(f"\n[contract-test] target: {transport.label}")
    mode = "CONTRACT_FULL" if CONTRACT_FULL else "FREE (default)"
    print(f"[contract-test] mode:   {mode}")
    print( "[contract-test] ─────────────────────────────────────────────────────")

    passed = []
    failed = []
    skipped = []

    for name, fn in INVARIANTS:
        print(f"\n[{name}]")
        try:
            failures = fn(transport)
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


def run(base_url: str) -> int:
    """Backward-compat entry point — original HTTP-only signature, unchanged
    behavior. Still used implicitly whenever no --transport= flag is given."""
    if not KEY:
        print("[contract-test] ERROR: Set NOVADA_MCP_KEY (or NOVADA_API_KEY) in env — no key is baked into this script.")
        sys.exit(1)
    transport = HttpSseTransport(base_url, KEY)
    return run_invariants(transport)


def _default_stdio_entry() -> str:
    """npm-package/build/index.js, resolved relative to this script's location
    (hosted-server/scripts/contract/contract-test.py → repo root is 3 levels up)."""
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(here, "..", "..", ".."))
    return os.path.join(repo_root, "npm-package", "build", "index.js")


def _run_stdio(entry_path: str) -> int:
    if CONTRACT_FULL:
        # CONTRACT_FULL invariants (2/3/6-probe) make real billed calls
        # (proxy credential fetch, a live Amazon scrape, a billed render probe).
        # Refusing this combination outright is safer than silently running
        # billed calls against a local process spun up with a dummy test key —
        # there is no legitimate reason to combine them, and a real key
        # accidentally present in the environment would make CONTRACT_FULL+stdio
        # spend real credits with no corresponding hosted-parity purpose.
        print(
            "[contract-test] ERROR: CONTRACT_FULL=1 is not supported with --transport=stdio "
            "(the stdio harness exists to cover the FREE structural invariants against the "
            "local build; billed invariants stay http+CONTRACT_FULL only). Unset CONTRACT_FULL."
        )
        return 1

    dummy_key = KEY or STDIO_DUMMY_KEY
    spawn_timeout = float(os.environ.get("CONTRACT_STDIO_SPAWN_TIMEOUT", "15"))

    try:
        transport = StdioTransport(entry_path, api_key=dummy_key, spawn_timeout=spawn_timeout)
    except Exception as e:
        print(f"[contract-test] FATAL: could not start stdio transport: {e}")
        return 1

    try:
        return run_invariants(transport)
    finally:
        transport.close()


def main(argv: list[str]) -> int:
    transport_kind = "http"
    positional: list[str] = []
    for a in argv:
        if a.startswith("--transport="):
            transport_kind = a.split("=", 1)[1].strip().lower()
        else:
            positional.append(a)

    if transport_kind == "stdio":
        entry_path = positional[0] if positional else (
            os.environ.get("NOVADA_STDIO_ENTRY") or _default_stdio_entry()
        )
        return _run_stdio(entry_path)

    if transport_kind in ("http", "http+sse", "sse"):
        if not positional:
            print("Usage: contract-test.py <base_url>")
            print("  e.g. contract-test.py https://mcp.novada.com/mcp")
            print("  or:  contract-test.py --transport=stdio [path/to/npm-package/build/index.js]")
            return 1
        return run(positional[0])

    print(f"[contract-test] ERROR: unknown --transport={transport_kind!r}. Valid values: http, stdio.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
