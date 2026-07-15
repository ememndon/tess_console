#!/usr/bin/env bash
# Internal uptime probe: HTTP-checks the three sites + the console's
# public pulse, maintains each monitor's state, and raises a notification on a
# confirmed down (two consecutive fails) or recovery. Also checks for JS-error
# spikes from the analytics stream. Plain deterministic code — runs even
# when Tess is paused. Reports into the Jobs Monitor.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "uptime-check" || { echo "$(date -Is) uptime-check: paused (jobs monitor), skipping"; exit 0; }
. ./.env
START=$(date +%s%3N)

PSQL() { docker exec tess-db psql -qtA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }
esc() { printf '%s' "$1" | sed "s/'/''/g"; }
notify() { # severity title body
  PSQL -c "INSERT INTO notifications (severity,title,body,module) VALUES ('$1','$(esc "$2")','$(esc "$3")','health');" >/dev/null
}

MONS=$(PSQL -c "SELECT key||'|'||url||'|'||last_status||'|'||label FROM monitors WHERE kind='http' AND enabled;")
CHECKED=0; DOWN=0

while IFS='|' read -r KEY URL PREV LABEL; do
  [ -z "${KEY:-}" ] && continue
  CHECKED=$((CHECKED + 1))

  RES=$(curl -sS -o /dev/null -m 12 -w "%{http_code} %{time_total}" "$URL" 2>/dev/null) || RES="000 0"
  CODE=$(printf '%s' "$RES" | awk '{print $1+0}')
  TT=$(printf '%s' "$RES" | awk '{print $2+0}')
  MS=$(awk "BEGIN{printf \"%d\", ${TT}*1000}")
  if [ "$CODE" -ge 200 ] && [ "$CODE" -lt 400 ]; then OK=true; else OK=false; fi

  PSQL -c "INSERT INTO monitor_checks (monitor_key, ok, latency_ms, code) VALUES ('$KEY', $OK, $MS, $CODE);" >/dev/null
  # Confirmed up if either of the last two checks succeeded; down only on two straight fails.
  NEW=$(PSQL -c "WITH r AS (SELECT ok FROM monitor_checks WHERE monitor_key='$KEY' ORDER BY id DESC LIMIT 2) SELECT CASE WHEN bool_or(ok) THEN 'up' ELSE 'down' END FROM r;")

  if [ "$OK" = "true" ]; then ERRSQL="NULL"; else ERRSQL="'$(esc "HTTP ${CODE}")'"; fi
  PSQL -c "UPDATE monitors SET last_status='$NEW', last_checked_at=now(), last_latency_ms=$MS,
           last_code=$CODE, last_error=$ERRSQL,
           down_since=CASE WHEN '$NEW'='down' THEN coalesce(down_since, now()) ELSE NULL END
           WHERE key='$KEY';" >/dev/null

  [ "$NEW" = "down" ] && DOWN=$((DOWN + 1))
  if [ "$NEW" = "down" ] && [ "$PREV" != "down" ]; then
    notify "critical" "🔴 ${LABEL} is down" "Health check failed (HTTP ${CODE}) at ${URL}."
  elif [ "$NEW" = "up" ] && [ "$PREV" = "down" ]; then
    notify "info" "🟢 ${LABEL} recovered" "Back up — HTTP ${CODE} in ${MS}ms."
  fi
done <<< "$MONS"

# Prune check history to 7 days.
PSQL -c "DELETE FROM monitor_checks WHERE checked_at < now() - interval '7 days';" >/dev/null

# JS-error spike alert (from the analytics stream), deduped to one per window.
EA=$(PSQL -c "SELECT (value->>'enabled')||'|'||(value->>'windowMinutes')||'|'||(value->>'threshold') FROM settings WHERE key='error_alerts';")
IFS='|' read -r EEN EWIN ETHR <<< "$EA"
if [ "${EEN:-false}" = "true" ]; then
  EWIN=${EWIN:-30}; ETHR=${ETHR:-25}
  CNT=$(PSQL -c "SELECT count(*) FROM events WHERE type='error' AND created_at >= now() - make_interval(mins => ${EWIN});")
  if [ "${CNT:-0}" -ge "$ETHR" ]; then
    RECENT=$(PSQL -c "SELECT 1 FROM notifications WHERE module='health' AND title LIKE 'JS error spike%' AND created_at >= now() - make_interval(mins => ${EWIN}) LIMIT 1;")
    [ -z "$RECENT" ] && notify "warning" "JS error spike" "${CNT} JavaScript errors in the last ${EWIN} min (threshold ${ETHR}). See Analytics → Errors."
  fi
fi

DUR=$(( $(date +%s%3N) - START ))
./scripts/report-job.sh "uptime-check" "ok" "$DUR" "checked ${CHECKED}, down ${DOWN}"
echo "$(date -Is) uptime: checked ${CHECKED}, down ${DOWN}"
