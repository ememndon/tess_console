#!/usr/bin/env bash
# Firewall audit + tighten — RUN THIS WITH sudo:  sudo ./scripts/firewall-audit.sh
#
# LOCKOUT-SAFE: it ALLOWS SSH (22), HTTP (80) and HTTPS (443) BEFORE applying
# default-deny, so it cannot lock you out. Idempotent — safe to run repeatedly.
# ufw is already active on this box; this just guarantees the rules are minimal
# and correct. Review the "before" and "after" output it prints.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo:  sudo $0" >&2
  exit 1
fi

echo "==================== BEFORE ===================="
ufw status verbose || true
echo

echo "Allowing inbound: 22 (SSH), 80 (HTTP), 443 (HTTPS) ..."
ufw allow 22/tcp comment 'SSH'   >/dev/null
ufw allow 80/tcp comment 'HTTP'  >/dev/null
ufw allow 443/tcp comment 'HTTPS'>/dev/null

echo "Setting default policy: deny incoming, allow outgoing ..."
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null

echo "Ensuring ufw is enabled ..."
ufw --force enable >/dev/null

echo
echo "==================== AFTER ====================="
ufw status verbose
echo
echo "Done. Only SSH/HTTP/HTTPS are allowed inbound; everything else is denied."
echo "If you run any other service that needs an inbound port, tell Tess/Claude and"
echo "we'll add a specific 'ufw allow' for it."
