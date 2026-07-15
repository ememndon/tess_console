#!/usr/bin/env bash
# Nightly analytics rollup: aggregate raw events into daily_stats +
# daily_breakdowns (kept forever, small & fast) and prune raw events past the
# retention window (default 90 days; override via settings.analytics_retention_days).
# Plain deterministic code — keeps running even when Tess is paused.
# Recomputes the trailing 2 UTC days each run so late events and the partial
# current day settle correctly. Reports into the Jobs Monitor.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "analytics-rollup" || { echo "$(date -Is) analytics-rollup: paused (jobs monitor), skipping"; exit 0; }
. ./.env
START=$(date +%s%3N)

read -r -d '' SQL <<'EOSQL'
BEGIN;

-- Per-day site totals (trailing 2 days, recomputed idempotently).
WITH recent AS (
  SELECT site, (created_at AT TIME ZONE 'UTC')::date AS day, type, load_ms, visitor_id
  FROM events
  WHERE created_at >= (now() AT TIME ZONE 'UTC')::date - interval '1 day'
)
INSERT INTO daily_stats (site, day, pageviews, visitors, events, errors, not_found, avg_load_ms)
SELECT site, day,
       count(*) FILTER (WHERE type='pageview'),
       count(DISTINCT visitor_id) FILTER (WHERE type='pageview'),
       count(*) FILTER (WHERE type='event'),
       count(*) FILTER (WHERE type='error'),
       count(*) FILTER (WHERE type='not_found'),
       round(avg(load_ms) FILTER (WHERE type='pageview' AND load_ms IS NOT NULL))::int
FROM recent
GROUP BY site, day
ON CONFLICT (site, day) DO UPDATE SET
  pageviews = excluded.pageviews, visitors = excluded.visitors, events = excluded.events,
  errors = excluded.errors, not_found = excluded.not_found, avg_load_ms = excluded.avg_load_ms;

-- Dimensional breakdowns: clear the window, then rebuild (drops stale keys).
DELETE FROM daily_breakdowns
WHERE day >= (now() AT TIME ZONE 'UTC')::date - interval '1 day';

WITH recent AS (
  SELECT site, (created_at AT TIME ZONE 'UTC')::date AS day, type, path, referrer_host,
         country, device, browser, utm_source, name, visitor_id
  FROM events
  WHERE created_at >= (now() AT TIME ZONE 'UTC')::date - interval '1 day'
)
INSERT INTO daily_breakdowns (site, day, dimension, key, count, visitors)
SELECT site, day, dimension, key, count(*)::int, count(DISTINCT visitor_id)::int
FROM (
  SELECT site, day, 'path'       AS dimension, coalesce(path,'/')        AS key, visitor_id FROM recent WHERE type='pageview'
  UNION ALL
  SELECT site, day, 'referrer',  referrer_host,           visitor_id FROM recent WHERE type='pageview' AND referrer_host IS NOT NULL
  UNION ALL
  SELECT site, day, 'country',   coalesce(country,'Unknown'), visitor_id FROM recent WHERE type='pageview'
  UNION ALL
  SELECT site, day, 'device',    coalesce(device,'unknown'),  visitor_id FROM recent WHERE type='pageview'
  UNION ALL
  SELECT site, day, 'browser',   coalesce(browser,'Other'),   visitor_id FROM recent WHERE type='pageview'
  UNION ALL
  SELECT site, day, 'utm_source', utm_source,             visitor_id FROM recent WHERE utm_source IS NOT NULL
  UNION ALL
  SELECT site, day, 'event',     name,                    visitor_id FROM recent WHERE type='event' AND name IS NOT NULL
) src
GROUP BY site, day, dimension, key;

COMMIT;
EOSQL

OUT=$(printf '%s' "$SQL" | docker exec -i tess-db psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>&1)
RC=$?

# Retention prune of raw events (aggregates are already safe).
RET=$(docker exec tess-db psql -tAc "SELECT (value)::text::int FROM settings WHERE key='analytics_retention_days'" \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>/dev/null | tr -d '[:space:]')
RET=${RET:-90}
PRUNED=$(docker exec tess-db psql -tAc \
      "WITH d AS (DELETE FROM events WHERE created_at < now() - interval '$RET days' RETURNING 1) SELECT count(*) FROM d" \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>/dev/null | tr -d '[:space:]')

DUR=$(( $(date +%s%3N) - START ))
if [ "$RC" -eq 0 ]; then
  ./scripts/report-job.sh "analytics-rollup" "ok" "$DUR" "rollup ok; pruned ${PRUNED:-0} raw events older than ${RET}d"
  echo "$(date -Is) OK rollup; pruned ${PRUNED:-0} (>${RET}d)"
else
  ./scripts/report-job.sh "analytics-rollup" "failed" "$DUR" "$(printf '%s' "$OUT" | head -c 500)"
  echo "$(date -Is) FAILED: $OUT"
  exit 1
fi
