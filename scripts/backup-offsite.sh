#!/usr/bin/env bash
# Offsite backup to Google Drive (resilience). Encrypts the latest DB dump
# with gpg (AES256) BEFORE upload, so Google never sees plaintext, then rclone-copies
# it to Drive and trims the offsite copies to the newest 30. Runs after the nightly
# dump. No-ops quietly until Drive is connected (.rclone.conf present).
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "offsite-backup" || { echo "$(date -Is) offsite-backup: paused (jobs monitor), skipping"; exit 0; }
. ./.env

CONF="/opt/tess-console/.rclone.conf"
REMOTE="${RCLONE_REMOTE:-gdrive}"
DIR="${RCLONE_DIR:-TessConsoleBackups}"
KEEP=30

# Not connected yet → silent success (don't spam the log before setup is done).
[ -f "$CONF" ] || { echo "$(date -Is) offsite: not configured yet (no .rclone.conf) — skipping"; exit 0; }
if [ -z "${BACKUP_GPG_PASSPHRASE:-}" ]; then echo "$(date -Is) offsite: BACKUP_GPG_PASSPHRASE not set"; exit 1; fi

LATEST=$(ls -1t backups/tessconsole_*.sql.gz 2>/dev/null | head -1)
[ -z "$LATEST" ] && { echo "$(date -Is) offsite: no local backup to push"; exit 0; }

START=$(date +%s%3N)
ENC="/tmp/$(basename "$LATEST").gpg"
umask 077
if ! gpg --batch --yes --passphrase "$BACKUP_GPG_PASSPHRASE" -c --cipher-algo AES256 -o "$ENC" "$LATEST"; then
  echo "$(date -Is) offsite: gpg encryption failed"; rm -f "$ENC"
  ./scripts/report-job.sh offsite-backup failed $(( $(date +%s%3N) - START )) "gpg failed"; exit 1
fi

OUT=$(rclone copy "$ENC" "${REMOTE}:${DIR}/" --config "$CONF" --drive-use-trash=false 2>&1); RC=$?
rm -f "$ENC"

if [ "$RC" -ne 0 ]; then
  echo "$(date -Is) offsite: rclone failed: ${OUT:0:200}"
  ./scripts/report-job.sh offsite-backup failed $(( $(date +%s%3N) - START )) "rclone: ${OUT:0:160}"; exit 1
fi

# Prune offsite to newest $KEEP (names sort chronologically by the yyyy-mm-dd stamp).
rclone lsf "${REMOTE}:${DIR}/" --config "$CONF" --files-only 2>/dev/null | sort | head -n "-${KEEP}" | while read -r f; do
  [ -n "$f" ] && rclone delete "${REMOTE}:${DIR}/${f}" --config "$CONF" >/dev/null 2>&1
done

echo "$(date -Is) offsite: pushed $(basename "$ENC") to ${REMOTE}:${DIR}/"
./scripts/report-job.sh offsite-backup ok $(( $(date +%s%3N) - START )) "$(basename "$LATEST") → ${REMOTE}:${DIR}"
