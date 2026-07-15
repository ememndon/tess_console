#!/usr/bin/env bash
# VPS action runner. Runs on the HOST as emison (the app container has
# no docker/host access). Picks up whitelisted actions Tess enqueued in vps_actions
# and executes them deterministically — the LLM never runs shell. Anything not in
# the case-list below is skipped. Records the result back + a notification.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "vps-runner" || { echo "$(date -Is) vps-runner: paused (jobs monitor), skipping"; exit 0; }
. ./.env

PSQL() { docker exec tess-db psql -qtA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }
esc() { printf '%s' "$1" | sed "s/'/''/g"; }

ROWS=$(PSQL -c "SELECT id||'|'||action||'|'||coalesce(args->>'service','')||'|'||coalesce(args->>'name','') FROM vps_actions WHERE status='pending' ORDER BY created_at LIMIT 10;") || exit 0

while IFS='|' read -r ID ACTION SERVICE NAME; do
  [ -z "${ID:-}" ] && continue
  PSQL -c "UPDATE vps_actions SET status='running' WHERE id='$ID';" >/dev/null
  STATUS="done"; RESULT=""

  case "$ACTION" in
    disk_report)
      RESULT=$(df -h / | tail -1; docker system df 2>/dev/null | head -4)
      ;;
    prune_logs)
      find /opt/tess-console/logs -name '*.log' -size +5M -exec truncate -s 0 {} \; 2>/dev/null
      ls -1t /opt/tess-console/backups/*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
      docker container prune -f >/dev/null 2>&1 || true
      RESULT="Truncated logs >5MB; trimmed backups to newest 14; pruned stopped containers."
      ;;
    run_backup)
      # Cap on-demand backups at once/~20h. The 02:00 nightly cron calls backup-db.sh
      # directly (not via this runner), so it is unaffected; this only throttles the
      # backups Tess enqueues, so she cannot back up more than once a day.
      NEWEST=$(ls -1t /opt/tess-console/backups/tessconsole_*.sql.gz 2>/dev/null | head -1 || true)
      if [ -n "${NEWEST:-}" ] && [ "$(( $(date +%s) - $(stat -c %Y "$NEWEST") ))" -lt 72000 ]; then
        AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$NEWEST") ) / 3600 ))
        STATUS="skipped"; RESULT="Backup skipped: newest dump is ${AGE_H}h old (<20h). Daily backup runs nightly at 02:00; on-demand backups are capped at once per day."
      else
        RESULT=$(/opt/tess-console/scripts/backup-db.sh 2>&1 | tail -2)
      fi
      ;;
    restart_service)
      case "$SERVICE" in
        tess-app|tess-caddy|tess-db)
          RESULT=$(docker restart "$SERVICE" 2>&1 | tail -1)
          ;;
        *) STATUS="skipped"; RESULT="service '$SERVICE' not in whitelist (tess-app|tess-caddy|tess-db)";;
      esac
      ;;
    run_job)
      # On-demand run of a whitelisted host cron job (read-only / idempotent
      # maintenance). Each script self-gates on the Jobs Monitor and reports its run.
      case "$NAME" in
        content-inventory|competitor-poll|security-audit|rate-watchdog) SCRIPT="$NAME";;
        analytics-rollup) SCRIPT="aggregate-analytics";;
        offsite-backup) SCRIPT="backup-offsite";;
        *) SCRIPT="";;
      esac
      if [ -n "$SCRIPT" ] && [ -x "/opt/tess-console/scripts/${SCRIPT}.sh" ]; then
        RESULT=$(/opt/tess-console/scripts/${SCRIPT}.sh 2>&1 | tail -3)
      else
        STATUS="skipped"; RESULT="job '$NAME' not in run_job whitelist (content-inventory|competitor-poll|analytics-rollup|security-audit|rate-watchdog|offsite-backup)"
      fi
      ;;
    *)
      STATUS="skipped"; RESULT="action '$ACTION' not whitelisted"
      ;;
  esac

  PSQL -c "UPDATE vps_actions SET status='$STATUS', result='$(esc "${RESULT:0:1500}")', finished_at=now() WHERE id='$ID';" >/dev/null
  PSQL -c "INSERT INTO notifications (severity,title,body,module) VALUES ('info','🛠 VPS: ${ACTION} ${STATUS}','$(esc "${RESULT:0:400}")','vps');" >/dev/null
  echo "$(date -Is) vps-runner: ${ACTION} ${SERVICE} -> ${STATUS}"
done <<< "$ROWS"
