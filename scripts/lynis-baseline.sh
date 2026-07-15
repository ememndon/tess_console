#!/usr/bin/env bash
# Lynis hardening baseline — RUN THIS WITH sudo:  sudo ./scripts/lynis-baseline.sh
#
# Installs Lynis (the standard open-source hardening auditor) if missing, runs a
# system audit, and saves the log under /opt/tess-console/logs. It only AUDITS —
# it changes nothing. Afterwards, share the "Hardening index" and the warnings/
# suggestions it prints with Tess/Claude and we'll turn them into a prioritized,
# copy-paste action list.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo:  sudo $0" >&2
  exit 1
fi

if ! command -v lynis >/dev/null 2>&1; then
  echo "Installing lynis ..."
  apt-get update -qq
  apt-get install -y -qq lynis
fi

LOG="/opt/tess-console/logs/lynis-$(date +%F).log"
mkdir -p /opt/tess-console/logs
echo "Running lynis audit (this takes a minute) ..."
lynis audit system --quick --no-colors 2>&1 | tee "$LOG"

echo
echo "============================================================"
echo "Saved full output to: $LOG"
echo "Machine-readable report: /var/log/lynis-report.dat"
echo "Key lines to share back: 'Hardening index : NN' and the [WARNING]/[SUGGESTION] lines."
grep -E 'Hardening index|warning|suggestion' -i "$LOG" | tail -20 || true
