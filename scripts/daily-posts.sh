#!/usr/bin/env bash
# Daily content pipeline — fires hourly 00:00–04:00 UTC; the route maps the UTC
# hour to a post slot (0..4) and generates one post per site, saved as Social
# Studio drafts. Pass DRY=1 to preview without writing.
set -u
cd /opt/tess-console || exit 1
Q=""
[ "${DRY:-0}" = "1" ] && Q="?dry=1"
OUT=$(docker exec tess-app node -e '
fetch("http://127.0.0.1:3000/api/internal/daily-posts'"$Q"'", { method: "POST", headers: { "x-internal-key": process.env.INTERNAL_SYNC_KEY } })
  .then(r => r.text()).then(t => { console.log(t); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); })' 2>&1)
echo "$(date -Is) daily-posts: ${OUT:0:600}"
