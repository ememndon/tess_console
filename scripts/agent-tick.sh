#!/usr/bin/env bash
# Tess's autonomous heartbeat — every 30 min. Pokes the agent-tick route
# from inside the container (localhost, shared-secret). The route no-ops when Tess
# is paused or there's nothing to do; the LLM only runs when work is found.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "agent-tick" || { echo "$(date -Is) agent-tick: paused (jobs monitor), skipping"; exit 0; }
OUT=$(docker exec tess-app node -e '
fetch("http://127.0.0.1:3000/api/internal/agent-tick", { method: "POST", headers: { "x-internal-key": process.env.INTERNAL_SYNC_KEY } })
  .then(r => r.text()).then(t => { console.log(t); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); })
' 2>&1)
echo "$(date -Is) agent-tick: ${OUT:0:300}"
