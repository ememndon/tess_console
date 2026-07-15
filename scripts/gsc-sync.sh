#!/usr/bin/env bash
# Triggers the GSC data sync by calling the app's internal route from
# inside the container (localhost, behind a shared-secret header — never exposed
# through the dev wall). The route runs the sync and records its own Jobs Monitor
# entry. App-dependent (not a safety monitor), so it simply no-ops if app is down.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "gsc-sync" || { echo "$(date -Is) gsc-sync: paused (jobs monitor), skipping"; exit 0; }
OUT=$(docker exec tess-app node -e '
fetch("http://127.0.0.1:3000/api/internal/gsc-sync", { method: "POST", headers: { "x-internal-key": process.env.INTERNAL_SYNC_KEY } })
  .then(r => r.text()).then(t => { console.log(t); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); })
' 2>&1)
echo "$(date -Is) gsc-sync: ${OUT:0:300}"
