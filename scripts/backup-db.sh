#!/usr/bin/env bash
# Nightly PostgreSQL dump — compressed, dated, newest 14 kept.
# Runs at 02:00 via /etc/cron.d/tess-console; output logged to /opt/tess-console/logs/backup.log.
# Restore procedure: docs/playbooks/restore-from-backup.md
set -euo pipefail
cd /opt/tess-console
. ./scripts/job-gate.sh
job_enabled "nightly-db-backup" || { echo "$(date -Is) nightly-db-backup: paused (jobs monitor), skipping"; exit 0; }
. ./.env
START=$(date +%s%3N)

STAMP=$(date +%F_%H%M)
OUT="backups/tessconsole_${STAMP}.sql.gz"

# Dumps hold customer PII + encrypted-secret ciphertext — keep them owner-only (hardening).
umask 077
mkdir -p backups && chmod 700 backups 2>/dev/null || true

if docker exec tess-db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "${OUT}.tmp"; then
    mv "${OUT}.tmp" "$OUT"
    chmod 600 "$OUT"
    ls -1t backups/tessconsole_*.sql.gz | tail -n +15 | xargs -r rm --
    SIZE=$(du -h "$OUT" | cut -f1)
    ./scripts/report-job.sh nightly-db-backup ok $(( $(date +%s%3N) - START )) "${OUT} (${SIZE})"
    echo "$(date -Is) OK ${OUT} (${SIZE})"
else
    rm -f "${OUT}.tmp"
    ./scripts/report-job.sh nightly-db-backup failed $(( $(date +%s%3N) - START )) "pg_dump failed"
    echo "$(date -Is) FAILED"
    exit 1
fi
