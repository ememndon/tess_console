#!/usr/bin/env bash
# Triggers the inbox-sync internal route from inside the container
# (localhost, shared-secret header — never exposed through the dev wall). Plain
# code, app-dependent: no-ops quietly if the app is down. Records its own Jobs run.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "inbox-sync" || { echo "$(date -Is) inbox-sync: paused (jobs monitor), skipping"; exit 0; }
OUT=$(docker exec tess-app node -e '
fetch("http://127.0.0.1:3000/api/internal/inbox-sync", { method: "POST", headers: { "x-internal-key": process.env.INTERNAL_SYNC_KEY } })
  .then(r => r.text()).then(t => { console.log(t); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); })
' 2>&1)
echo "$(date -Is) inbox-sync: ${OUT:0:300}"
