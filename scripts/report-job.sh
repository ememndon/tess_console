#!/usr/bin/env bash
# Reports a job run into the console's jobs monitor.
# Usage: report-job.sh <job-name> <ok|failed> <duration_ms> [output]
# Deliberately fault-tolerant: if the DB is down, the job itself must not fail.
set -u
cd /opt/tess-console || exit 0
. ./.env
NAME="$1"; STATUS="$2"; DUR="${3:-0}"; OUT="${4:-}"
OUT_ESC=$(printf '%s' "$OUT" | sed "s/'/''/g" | head -c 2000)

docker exec tess-db psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
INSERT INTO job_runs (job_name, started_at, finished_at, status, output)
VALUES ('$NAME', now() - ($DUR * interval '1 millisecond'), now(), '$STATUS', '$OUT_ESC');
UPDATE jobs SET last_run_at = now(), last_status = '$STATUS',
       last_duration_ms = $DUR, last_output = '$OUT_ESC' WHERE name = '$NAME';
DELETE FROM job_runs WHERE job_name = '$NAME' AND id NOT IN
  (SELECT id FROM job_runs WHERE job_name = '$NAME' ORDER BY id DESC LIMIT 50);
" >/dev/null 2>&1 || true
