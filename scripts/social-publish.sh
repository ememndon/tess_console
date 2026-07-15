#!/usr/bin/env bash
# Triggers the deterministic social publisher from inside the
# container. Publishes due posts to autonomous channels (X, Telegram) and writes
# Meta/LinkedIn handoff files. Runs even when Tess's LLM is paused.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "social-publish" || { echo "$(date -Is) social-publish: paused (jobs monitor), skipping"; exit 0; }
OUT=$(docker exec tess-app node -e '
fetch("http://127.0.0.1:3000/api/internal/publish", { method: "POST", headers: { "x-internal-key": process.env.INTERNAL_SYNC_KEY } })
  .then(r => r.text()).then(t => { console.log(t); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); })
' 2>&1)
echo "$(date -Is) social-publish: ${OUT:0:300}"
