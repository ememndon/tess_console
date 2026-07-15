#!/usr/bin/env bash
# Tess Console heartbeat — pings healthchecks.io every 5 min ONLY while the
# stack is actually healthy (database healthy + staging site answering).
# If the app dies, pings stop → healthchecks.io alerts the owner externally.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "heartbeat" || { echo "$(date -Is) heartbeat: paused (jobs monitor), skipping"; exit 0; }
. ./.env
[ -n "${HEALTHCHECKS_PING_URL:-}" ] || exit 0
START=$(date +%s%3N)

db=$(docker inspect -f '{{.State.Health.Status}}' tess-db 2>/dev/null)
web=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://staging.tessconsole.cloud/health)

if [ "$db" = "healthy" ] && [ "$web" = "200" ]; then
    curl -fsS -m 10 --retry 3 -o /dev/null "$HEALTHCHECKS_PING_URL"
    ./scripts/report-job.sh heartbeat ok $(( $(date +%s%3N) - START )) "db=healthy web=200 ping=sent"
else
    # Unhealthy: stay silent toward healthchecks.io (that IS the alert),
    # but record the failure locally if the DB is still reachable.
    ./scripts/report-job.sh heartbeat failed $(( $(date +%s%3N) - START )) "db=${db:-down} web=${web}"
fi
