#!/usr/bin/env bash
# Idempotent base provisioning for the novada-mcp EC2 host (Ubuntu 24.04).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# swap 2G (OOM insurance; Prismma Lightsail went down 10-03 without it)
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -q -w vm.swappiness=10; echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf

apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q ca-certificates curl gnupg git nginx certbot python3-certbot-nginx ufw unattended-upgrades jq

# Node 24 (NodeSource)
if ! node -v 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -q nodejs
fi

# service user + dirs (app runs as non-login user, not ubuntu/root)
id novada >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/novada --shell /usr/sbin/nologin novada
install -d -o novada -g novada -m 755 /opt/novada-mcp
install -d -o root -g novada -m 750 /etc/novada-mcp

# firewall: SSH + web only (SG already allows 80/443; ufw is defence in depth)
ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

# patching: security updates install unattended, but never reboot on their own —
# a reboot drops in-flight 300s tool calls; reboot-required is checked during ops review.
cat > /etc/apt/apt.conf.d/52novada-unattended <<'CONF'
Unattended-Upgrade::Automatic-Reboot "false";
CONF

# journald: explicit cap so logs can't fill the 48G root disk
install -d /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=1G\nMaxRetentionSec=30day\n' > /etc/systemd/journald.conf.d/novada.conf
systemctl restart systemd-journald

# no default nginx site answering on :80 with the welcome page
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "node $(node -v) | npm $(npm -v) | nginx $(nginx -v 2>&1 | cut -d/ -f2) | certbot $(certbot --version 2>&1 | cut -d' ' -f2)"
swapon --show; ufw status | head -6
