#!/usr/bin/env bash
# Weekly demo-video scheduler — runs once a day via cron, independent of
# the AI agent so it keeps working while Tess is paused. Pokes the internal route,
# which picks today's site + target (Mon Calc / Tue ResumeHub / Wed CheckInvest /
# Thu-Sat repeat / Sun off), writes a fresh script and enqueues ONE render as a DRAFT.
# Pass DRY=1 to preview what it would enqueue without actually queuing a render.
set -u
cd /opt/tess-console || exit 1
Q=""
[ "${DRY:-0}" = "1" ] && Q="?dry=1"
OUT=$(docker exec tess-app node -e '
fetch("http://127.0.0.1:3000/api/internal/demo/scheduled-run'"$Q"'", { method: "POST", headers: { "x-internal-key": process.env.INTERNAL_SYNC_KEY } })
  .then(r => r.text()).then(t => { console.log(t); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); })
' 2>&1)
echo "$(date -Is) demo-scheduler: ${OUT:0:400}"
