#!/usr/bin/env bash
# Cap the Docker build cache so repeated image rebuilds don't slowly fill the
# disk. Keeps total build cache under MAX (default 10GB) — only evicts the
# oldest layers beyond the cap, so recent rebuild caches stay warm and fast.
# Runs daily from emison's crontab; logs to /opt/tess-console/logs (emison
# cannot write to /var/log). Docker 29+ flag: --max-used-space (was --keep-storage).
set -u
MAX="${1:-10GB}"
mkdir -p /opt/tess-console/logs
OUT=$(docker builder prune -f --max-used-space "$MAX" 2>&1 | tail -1)
echo "$(date -Is) docker-prune cap=$MAX : ${OUT:-no output}"
