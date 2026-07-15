#!/usr/bin/env bash
# Shared on/off gate for cron jobs. Source it, then guard the script's work:
#
#     . ./scripts/job-gate.sh
#     job_enabled "<job-name>" || { echo "$(date -Is) <job-name>: paused, skipping"; exit 0; }
#
# Reads jobs.enabled (set from the console's Jobs Monitor) from the DB. This is
# the single point that makes the UI toggle actually take effect on schedule.
#
# FAIL-OPEN by design: any uncertainty — DB unreachable, missing row, parse
# error — returns "enabled", so an infrastructure hiccup can never silently
# switch off a backup or a security monitor. ONLY an explicit 'f' (false) in the
# job's row pauses it.
job_enabled() {
  local name="$1" v=""
  [ -f /opt/tess-console/.env ] && . /opt/tess-console/.env
  v=$(docker exec tess-db psql -qtA -U "${POSTGRES_USER:-}" -d "${POSTGRES_DB:-}" \
        -c "SELECT enabled FROM jobs WHERE name = '${name//\'/\'\'}' LIMIT 1;" 2>/dev/null) || v=""
  v="${v//[[:space:]]/}"
  if [ "$v" = "f" ]; then return 1; fi
  return 0
}
