#!/usr/bin/env bash
# CheckInvest rate-pipeline watchdog: from outside the site, read the
# "last updated" signal and alert if published rates are stale beyond the
# threshold. Fully configurable (settings.rate_watchdog) — nothing hardcoded.
# Until the owner sets the freshness signal it stays "unconfigured" and never
# false-alarms. Deterministic; reports into the Jobs Monitor.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "rate-watchdog" || { echo "$(date -Is) rate-watchdog: paused (jobs monitor), skipping"; exit 0; }
. ./.env
START=$(date +%s%3N)

PSQL() { docker exec tess-db psql -qtA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }
esc() { printf '%s' "$1" | sed "s/'/''/g"; }
notify() { PSQL -c "INSERT INTO notifications (severity,title,body,module) VALUES ('$1','$(esc "$2")','$(esc "$3")','health');" >/dev/null; }
setmon() { # status detailJson errorSqlExpr
  PSQL -c "UPDATE monitors SET last_status='$1', last_checked_at=now(), detail='$(esc "$2")'::jsonb, last_error=$3 WHERE key='checkinvest-rates';" >/dev/null
}
done_job() { ./scripts/report-job.sh "rate-watchdog" "$1" "$(( $(date +%s%3N) - START ))" "$2"; echo "$(date -Is) rate-watchdog: $2"; }

EN=$(PSQL -c "SELECT (value->>'enabled') FROM settings WHERE key='rate_watchdog';")
URL=$(PSQL -c "SELECT (value->>'url') FROM settings WHERE key='rate_watchdog';")
MODE=$(PSQL -c "SELECT (value->>'mode') FROM settings WHERE key='rate_watchdog';")
PAT=$(PSQL -c "SELECT (value->>'pattern') FROM settings WHERE key='rate_watchdog';")
MAXH=$(PSQL -c "SELECT (value->>'maxAgeHours') FROM settings WHERE key='rate_watchdog';")
MAXH=${MAXH%%.*}; MAXH=${MAXH:-4}
TZCFG=$(PSQL -c "SELECT (value->>'tz') FROM settings WHERE key='rate_watchdog';")

if [ "$EN" != "true" ]; then setmon "unconfigured" '{"note":"disabled"}' "NULL"; done_job ok "disabled"; exit 0; fi
[ -z "$URL" ] && { setmon "unconfigured" '{"note":"no url"}' "'no url set'"; done_job ok "no url"; exit 0; }

# Bypass any CDN edge cache so we read the LIVE page, not a stale snapshot — a
# freshness check must never trust a cached copy (checkinvestng's homepage is
# edge-cached for ~a year). Unique query param + no-cache request hints.
_SEP='?'; case "$URL" in *\?*) _SEP='&';; esac
FETCH_URL="${URL}${_SEP}_cb=$(date +%s%N)"
HTML=$(curl -sS -m 15 -L -A "TessConsole-RateWatchdog/1.0" -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' "$FETCH_URL" 2>/dev/null) || HTML=""
if [ -z "$HTML" ]; then
  setmon "down" '{}' "'$(esc "could not fetch ${URL}")'"
  notify "warning" "⚠️ Rate-pipeline check failed" "Could not fetch ${URL} to verify CheckInvest rate freshness."
  done_job failed "fetch failed"; exit 0
fi

# Extract a timestamp string per the configured mode.
TS=""
case "$MODE" in
  regex) [ -n "$PAT" ] && TS=$(printf '%s' "$HTML" | grep -oiP "$PAT" | head -1) ;;
  json)  [ -n "$PAT" ] && TS=$(printf '%s' "$HTML" | grep -oiP "\"${PAT}\"[[:space:]]*:[[:space:]]*\"?\K[^\",}]+" | head -1) ;;
  *)     # auto: <time datetime>, then any ISO-8601 datetime on the page
    TS=$(printf '%s' "$HTML" | grep -oiP '<time[^>]*datetime="\K[^"]+' | head -1)
    [ -z "$TS" ] && TS=$(printf '%s' "$HTML" | grep -oiP '\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?' | head -1) ;;
esac

if [ -z "$TS" ]; then
  setmon "unconfigured" '{}' "'$(esc "no freshness signal found — set mode/pattern in Settings")'"
  done_job ok "no signal (unconfigured)"; exit 0
fi

# Parse to epoch (accept ISO strings, numeric epoch sec/ms, or a human date).
if printf '%s' "$TS" | grep -qE '^[0-9]{10,13}$'; then
  EP=$TS; [ ${#EP} -ge 13 ] && EP=$((EP / 1000))
else
  # Normalize the human timestamps GNU date is fussy about: drop commas, rewrite
  # a day-first "26 Jun 21:09" to month-first "Jun 26 21:09" (date needs that to
  # assume the current year), and strip a trailing timezone ABBREVIATION (e.g.
  # WAT) date can't resolve — the real zone comes from the configured tz. ISO
  # strings pass through untouched (no comma, not day-first, trailing Z is 1 char).
  CLEAN=$(printf '%s' "$TS" | tr -d ',' \
    | sed -E 's/^([0-9]{1,2}) ([A-Za-z]{3,}) /\2 \1 /; s/[[:space:]]+[A-Za-z]{2,5}$//')
  if [ -n "$TZCFG" ]; then
    EP=$(TZ="$TZCFG" date -d "$CLEAN" +%s 2>/dev/null || true)
  else
    EP=$(date -d "$CLEAN" +%s 2>/dev/null || true)
  fi
fi
if [ -z "${EP:-}" ]; then
  setmon "unconfigured" '{}' "'$(esc "couldn't parse timestamp: ${TS}")'"
  done_job ok "unparseable timestamp"; exit 0
fi

NOW=$(date +%s); AGE_S=$((NOW - EP)); AGE_H=$(awk "BEGIN{printf \"%.1f\", ${AGE_S}/3600}")
DETAIL="{\"updatedAt\":\"$(esc "$TS")\",\"ageHours\":${AGE_H},\"maxAgeHours\":${MAXH}}"

if [ "$AGE_S" -gt $((MAXH * 3600)) ]; then
  setmon "down" "$DETAIL" "'$(esc "stale ${AGE_H}h (max ${MAXH}h)")'"
  RECENT=$(PSQL -c "SELECT 1 FROM notifications WHERE module='health' AND title LIKE '%rate pipeline stale%' AND created_at >= now() - interval '4 hours' LIMIT 1;")
  [ -z "$RECENT" ] && notify "critical" "🔴 CheckInvest rate pipeline stale" "Published rates last updated ${AGE_H}h ago (threshold ${MAXH}h). Check the pipeline."
  done_job ok "STALE ${AGE_H}h"
else
  PREV=$(PSQL -c "SELECT last_status FROM monitors WHERE key='checkinvest-rates';")
  setmon "up" "$DETAIL" "NULL"
  [ "$PREV" = "down" ] && notify "info" "🟢 CheckInvest rate pipeline fresh" "Rates updated ${AGE_H}h ago — back within threshold."
  done_job ok "fresh ${AGE_H}h"
fi
