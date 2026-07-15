#!/usr/bin/env bash
# Monthly content feedback loop: re-reads Search Console for past GSC-anchored
# posts, records which pages climbed (so the next plan doubles down on them), and
# notifies the owner. Calls the app's internal route from inside the container
# (localhost, shared-secret header). App-dependent, so it no-ops if the app is down.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "gsc-feedback" || { echo "$(date -Is) gsc-feedback: paused (jobs monitor), skipping"; exit 0; }
OUT=$(docker exec tess-app node -e '
fetch("http://127.0.0.1:3000/api/internal/gsc-feedback", { method: "POST", headers: { "x-internal-key": process.env.INTERNAL_SYNC_KEY } })
  .then(r => r.text()).then(t => { console.log(t); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); })
' 2>&1)
echo "$(date -Is) gsc-feedback: ${OUT:0:300}"
