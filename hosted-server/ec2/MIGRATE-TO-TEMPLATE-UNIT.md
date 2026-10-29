# Migrating the live box from `novada-mcp.service` to `novada-mcp@.service`

Incident fix, 2026-10-29. Background: a single systemd unit makes
`systemctl restart` inherently stop-then-start — the whole endpoint is down
between the stop and the new process becoming healthy, regardless of how
fast in-process drain is (that part is fixed separately, in
`hosted-server/vercel/server.mts`'s `drainServer()`). The only way to avoid
*that* gap is to run two independent instances and restart them one at a
time, so nginx always has one to route to.

This runs the cutover with **zero downtime** — the old unit is never
stopped until the new instances are already proven healthy and already in
nginx's upstream rotation.

Run every command below ON the EC2 box (`ssh novada-mcp`), as the same
operator user used for existing ops tasks (sudo as needed, same as
`deploy-ec2.sh`/`provision-base.sh`).

## Preconditions

- The current release at `/opt/novada-mcp/current` already contains
  `dist/server.mjs` built from a worktree that includes this incident fix
  (the `server.mts` with `createDrainTracker`/`drainServer`,
  `NOVADA_KEEP_ALIVE_TIMEOUT_MS` support) — if not, run `deploy-ec2.sh`
  first against the OLD single-unit setup (it still works unmodified) to get
  a current release with the fix, THEN do this migration.
- `hosted-server/ec2/novada-mcp@.service`, `deploy-ec2.sh`, and
  `restart-rolling.sh` from this worktree are available on the box (scp them
  over). `nginx-novada-mcp.conf` / `nginx-snippet-novada-mcp-proxy.conf` are
  **reference only** for this migration — see step 3's warning. They are
  templates for a FRESH box, not something to `cp` onto this already-live
  one (the live box's nginx config has diverged from the repo template —
  see "Repo template vs. live config" below).

## ⚠️ The live nginx config has already diverged from the repo template — read this before step 3

A live `nginx -T` capture (`.claude/ec2-migration/live-nginx-T-2026-10-29.txt`,
2026-10-29) shows the box already split into **per-domain 443 blocks** with
real Let's Encrypt cert paths for BOTH `mcp.novada.com` and
`mcp-staging.novada.com`, a shared `/etc/nginx/snippets/novada-mcp-proxy.conf`,
a separate `conf.d/novada-mcp-log.conf`, and an ACME HTTP-01 webroot on port
80 — none of which the repo's `nginx-novada-mcp.conf` fully captured before
this round (it still described a pre-split, single-combined-hostname-block
config with no real 443 block for either hostname at all). **`sudo cp`-ing
`hosted-server/ec2/nginx-novada-mcp.conf` over the live
`/etc/nginx/sites-available/novada-mcp` would pass `nginx -t` (the template
is internally valid) and would DELETE the live TLS termination for both
real hostnames** — `nginx -t`/`reload` would both report success while
every real HTTPS request started getting a TLS connection reset from the
`ssl_reject_handshake` catch-all. Step 3 below patches the live files
in place instead, specifically BECAUSE a whole-file copy is unsafe here.

## Steps

1. **Install the template unit (does not touch the running old unit):**
   ```sh
   sudo cp novada-mcp@.service /etc/systemd/system/novada-mcp@.service
   sudo systemctl daemon-reload
   ```

2. **Start the NEW instance on the port nothing is using yet (3001):**
   ```sh
   sudo systemctl enable --now novada-mcp@3001
   curl -fsS http://127.0.0.1:3001/health   # must return {"ok":true,...}
   ```
   If this instance fails to come up healthy, STOP here — nothing public has
   changed yet (nginx is still 100% on the old unit via port 3000), so there
   is zero risk from aborting the migration at this point. Debug via
   `journalctl -u novada-mcp@3001 -n 60 --no-pager`.

3. **Point nginx at BOTH ports (old unit on 3000 + new instance on 3001) —
   patch the LIVE files in place, never `cp` a whole file over them.**
   Two independent live files need the same four-step treatment (backup →
   edit → `nginx -t` → reload), each followed by a real HTTPS check against
   BOTH real hostnames (not just the loopback `/health` checks from steps
   2/5 — see C1's rationale above: those alone would NOT have caught a
   TLS-config break).

   **3a. The `upstream novada_mcp { ... }` block** — add the new instance.
   Edit the REAL file in `sites-available/` (`sites-enabled/novada-mcp` is a
   symlink; `sed -i` on it would replace the link with a copy). Backups go to
   `/root/backups/`, never next to the config: nginx loads EVERY file in
   `sites-enabled/*` (and `conf.d/*.conf`), so a `.bak` there is parsed as live
   config and `nginx -t` fails with a duplicate `upstream`. Capture `TS` ONCE —
   the rollback block below reuses it for both files.
   ```sh
   TS=$(date +%Y%m%d%H%M%S); echo "TS=$TS   # write this down for rollback"
   sudo install -d -m 700 /root/backups
   sudo cp -p /etc/nginx/sites-available/novada-mcp "/root/backups/nginx-site-novada-mcp.bak-$TS"
   sudo cp -p /etc/nginx/snippets/novada-mcp-proxy.conf "/root/backups/nginx-snippet-novada-mcp-proxy.conf.bak-$TS"

   sudo sed -i '/upstream novada_mcp {/,/}/{
     /server 127.0.0.1:3000;/a\
       server 127.0.0.1:3001;
   }' /etc/nginx/sites-available/novada-mcp

   # must show exactly one "3000" line and one "3001" line inside the block
   grep -A3 'upstream novada_mcp' /etc/nginx/sites-available/novada-mcp
   test -L /etc/nginx/sites-enabled/novada-mcp && echo "symlink intact"

   sudo nginx -t
   sudo systemctl reload nginx
   ```

   **3b. The shared snippet** (`/etc/nginx/snippets/novada-mcp-proxy.conf`)
   — add the zero-downtime retry directives inside its `location /` block:
   (both files were already backed up in 3a with the same `$TS`):
   ```sh
   sudo sed -i '/proxy_buffering off;/a\
   \
       proxy_next_upstream error timeout http_502;\
       proxy_next_upstream_tries 2;' /etc/nginx/snippets/novada-mcp-proxy.conf

   grep -A2 'proxy_buffering off;' /etc/nginx/snippets/novada-mcp-proxy.conf

   sudo nginx -t
   sudo systemctl reload nginx
   ```

   **3c. Verify BOTH real hostnames still terminate TLS and serve correctly**
   (this is the check that step-2/5's loopback `/health` calls do NOT cover
   — run it from the box itself against its own public IP, or from any
   machine that can reach the box):
   ```sh
   curl -fsS --resolve mcp.novada.com:443:127.0.0.1 https://mcp.novada.com/health
   curl -fsS --resolve mcp-staging.novada.com:443:127.0.0.1 https://mcp-staging.novada.com/health
   # both must return {"ok":true,...} with no TLS error
   ```

   **Rollback for 3a/3b, if `nginx -t` fails OR the step-3c check fails
   after reload:**
   ```sh
   # TS = the value echoed in 3a (set it again if this is a new shell)
   sudo cp -p "/root/backups/nginx-site-novada-mcp.bak-$TS" /etc/nginx/sites-available/novada-mcp
   sudo cp -p "/root/backups/nginx-snippet-novada-mcp-proxy.conf.bak-$TS" /etc/nginx/snippets/novada-mcp-proxy.conf
   sudo nginx -t && sudo systemctl reload nginx
   # re-run the step-3c curl checks to confirm the rollback itself is good
   ```
   Each reload is graceful (nginx finishes in-flight requests on the old
   config before switching new connections to the new one) — no requests
   are dropped by a successful reload, including the rollback's own reload.
   After 3a succeeds, nginx is already load-balancing between the
   still-running old unit (3000) and the new template instance (3001);
   `proxy_next_upstream` (added in 3b) means even if one of the two is
   briefly unreachable, the other still serves.

4. **Verify both are actually receiving traffic** (watch a couple of
   real requests land on each, e.g. via each instance's own
   `journalctl -u novada-mcp@<port> -f` or the nginx JSON access log), then
   **stop and disable the OLD single unit:**
   ```sh
   sudo systemctl disable --now novada-mcp.service
   ```
   Zero downtime here: 3001 is already up and already in nginx's rotation,
   so nginx simply stops being able to reach 3000 for a moment (handled by
   `proxy_next_upstream`, same as any other single-instance blip) until the
   next step brings 3000 back under the new unit.

5. **Start the NEW template instance on 3000 (replacing the old unit there):**
   ```sh
   sudo systemctl enable --now novada-mcp@3000
   curl -fsS http://127.0.0.1:3000/health   # must return {"ok":true,...}
   ```

6. **Confirm steady state:**
   ```sh
   systemctl is-active novada-mcp@3000 novada-mcp@3001   # both "active"
   systemctl is-enabled novada-mcp@3000 novada-mcp@3001   # both "enabled"
   systemctl is-enabled novada-mcp.service                # "disabled"
   ```

7. **Prove it end-to-end** (optional but recommended right after cutover):
   run a rolling restart under the drill —
   ```sh
   ./drill-zero-downtime.sh https://mcp.novada.com 30 &
   DRILL_PID=$!
   ./restart-rolling.sh
   wait "$DRILL_PID"   # must print "DRILL PASSED" and exit 0
   ```

## Rollback (if step 2/3 reveals a problem before step 4)

Nothing public has changed yet at that point. `sudo systemctl disable --now
novada-mcp@3001`, and if nginx was already patched in step 3a/3b, use the
`/root/backups/*.bak-$TS` files step 3 itself created (NOT the repo template — see the
warning above) to restore the live files, per step 3's own rollback
sub-section. The old unit was never touched, so it is still serving
throughout.

## Repo template vs. live config — remaining intentional differences

Diffed `hosted-server/ec2/nginx-novada-mcp.conf` /
`nginx-snippet-novada-mcp-proxy.conf` against
`.claude/ec2-migration/live-nginx-T-2026-10-29.txt` directly (not eyeballed)
after this round's rewrite. Every remaining difference is one of these,
intentional:

1. **Second upstream server** (`server 127.0.0.1:3001;`) and the
   `proxy_next_upstream*` lines — these are the point of this migration;
   step 3 applies them to the live files, so this difference disappears
   once step 3 has run.
2. **`ssl_certificate_key` is present in the repo template but NOT in the
   live dump** — the live `nginx -T` capture was given to this review with
   private keys stripped (per the coordinator's note), so its absence there
   is a redaction artifact of the dump, not a real live-vs-template
   difference; nginx requires `ssl_certificate_key` to start at all, so the
   live box unquestionably has one. The repo template states the
   conventional certbot-managed path (`.../privkey.pem`) as its own
   placeholder.
3. **Header-comment verbosity** — the repo template's comments explain the
   zero-downtime rationale, the "don't `cp` this" warning, and the fresh-box
   TLS-bootstrap sequence; the live file's comments are shorter (pre-dating
   this migration). Pure prose, no behavioral difference. The live file's
   own top comment is also slightly stale now (still says "reverse proxy to
   the Node server on 127.0.0.1:3000" — singular); not touched by step
   3a/3b (out of scope for an in-place patch of the upstream block/snippet
   only) — low priority, could be fixed in a future one-line comment-only
   patch.
4. **PLACEHOLDER markings on `ssl_certificate*`/`options-ssl-nginx.conf`/
   `ssl_dhparam`** — the repo template calls these out explicitly as
   certbot-managed/not-reproducible-by-provision-base.sh; the live file has
   no such markers since, on the live box, they are simply real, resolved
   paths with real files behind them. Purely a fresh-vs-live framing
   difference, not a config difference (the live PATHS match the template's
   placeholder paths exactly).

Verified via `nginx -t` against both pieces independently: (a) a minimal
sandbox exercising just the patched `upstream novada_mcp { ... }` block
(2 servers) and the `proxy_next_upstream` lines in isolation — passed; (b)
the full repo template (`nginx-novada-mcp.conf` +
`nginx-snippet-novada-mcp-proxy.conf`) assembled with self-signed
placeholder certs standing in for the certbot-managed files — passed (the
only nginx output was a deprecation *warning* for `listen ... http2`, which
is this sandbox's newer nginx 1.31 being pickier than the live box's nginx
1.24 — the live box already runs this exact `listen ... http2` syntax
today, confirmed in `ops-review.md`'s round-1 re-review, so this is not a
real issue). No access to the real box's `nginx -t` from this worktree —
the orchestrator's live reconciliation pass (step 3's own `nginx -t` calls)
is still the authoritative check before any reload actually happens.

## After migration

All future deploys and env-only restarts go through `deploy-ec2.sh` /
`restart-rolling.sh` (both now target `novada-mcp@3000`/`novada-mcp@3001`
exclusively). `novada-mcp.service` (the old unit file) is left in place,
disabled, as a reference — do not delete it (see its own header comment).
