#!/usr/bin/env bash
# Triggers the notify-dispatch internal route from inside the
# container (localhost, shared-secret header). Fans out bell alerts raised by the
# deterministic monitors (health/social/inbox) to Telegram/email. Plain code:
# runs every minute, independent of Tess's pause state. No-ops if the app is down.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "notify-dispatch" || { echo "$(date -Is) notify-dispatch: paused (jobs monitor), skipping"; exit 0; }
OUT=$(docker exec tess-app node -e '
fetch("http://127.0.0.1:3000/api/internal/notify-dispatch", { method: "POST", headers: { "x-internal-key": process.env.INTERNAL_SYNC_KEY } })
  .then(r => r.text()).then(t => { console.log(t); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); })
' 2>&1)
echo "$(date -Is) notify-dispatch: ${OUT:0:200}"
