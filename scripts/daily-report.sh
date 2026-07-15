#!/usr/bin/env bash
# Triggers Tess's morning report from inside the container (localhost,
# shared-secret header). Builds the deterministic report and delivers it to the
# owner via email + Telegram. Plain code; no-ops quietly if the app is down.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "daily-report" || { echo "$(date -Is) daily-report: paused (jobs monitor), skipping"; exit 0; }
OUT=$(docker exec tess-app node -e '
fetch("http://127.0.0.1:3000/api/internal/daily-report", { method: "POST", headers: { "x-internal-key": process.env.INTERNAL_SYNC_KEY } })
  .then(r => r.text()).then(t => { console.log(t); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); })
' 2>&1)
echo "$(date -Is) daily-report: ${OUT:0:300}"
