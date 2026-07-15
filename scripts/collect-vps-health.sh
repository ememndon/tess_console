#!/usr/bin/env bash
# VPS health collector: gathers CPU/RAM/disk/load/uptime, Docker
# service status, last backup and last security update into a single settings
# snapshot the console renders in plain English. Runs on the host (sees real
# /proc, df, docker). Deterministic. CPU% is averaged since the previous
# run (no sleep) via a small state file.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "vps-health" || { echo "$(date -Is) vps-health: paused (jobs monitor), skipping"; exit 0; }
. ./.env
START=$(date +%s%3N)
PSQL() { docker exec tess-db psql -qtA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }

CORES=$(nproc 2>/dev/null || echo 1)

# CPU% averaged since last run (delta of /proc/stat against a state file).
read -r _ u nicev s idle iow irq sirq steal _ < /proc/stat
TOTAL=$((u + nicev + s + idle + iow + irq + sirq + steal)); IDLE=$((idle + iow))
PREVF=/tmp/tess-cpu-prev; CPU=0
if [ -r "$PREVF" ]; then
  read -r PT PI < "$PREVF" || true
  dt=$((TOTAL - PT)); di=$((IDLE - PI))
  [ "$dt" -gt 0 ] && CPU=$(awk "BEGIN{v=100*(1-${di}/${dt}); if(v<0)v=0; if(v>100)v=100; printf \"%d\", v+0.5}")
fi
echo "$TOTAL $IDLE" > "$PREVF"

# Memory (kB → GB, used% from MemAvailable).
MT=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
MA=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
MEMPCT=$(awk "BEGIN{printf \"%d\", (1-${MA}/${MT})*100+0.5}")
MEMTOTAL=$(awk "BEGIN{printf \"%.1f\", ${MT}/1048576}")

# Disk for / (1k blocks → GB, use%).
read -r DISKPCT DISKTOTAL < <(df -P / | awk 'NR==2{gsub(/%/,"",$5); printf "%d %.1f", $5, $2/1048576}')

# Load + uptime.
read -r L1 L5 L15 _ < /proc/loadavg
UPSEC=$(awk '{printf "%d", $1}' /proc/uptime)

# Docker services.
svc() {
  local n="$1" st h ok=false
  st=$(docker inspect -f '{{.State.Status}}' "$n" 2>/dev/null || echo missing)
  h=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$n" 2>/dev/null || echo none)
  { [ "$st" = "running" ] && { [ "$h" = "healthy" ] || [ "$h" = "none" ]; }; } && ok=true
  printf '{"name":"%s","ok":%s,"status":"%s"}' "$n" "$ok" "$st"
}
SERVICES="$(svc tess-db),$(svc tess-app),$(svc tess-caddy)"

# Last backup (newest dump mtime) and last security update (best-effort).
LASTBK=null
NB=$(ls -1t backups/tessconsole_*.sql.gz 2>/dev/null | head -1 || true)
[ -n "${NB:-}" ] && LASTBK=$(stat -c %Y "$NB" 2>/dev/null || echo null)
LASTSEC=null
for f in /var/log/unattended-upgrades/unattended-upgrades.log /var/lib/apt/periodic/update-success-stamp /var/cache/apt/pkgcache.bin; do
  if [ -e "$f" ]; then LASTSEC=$(stat -c %Y "$f" 2>/dev/null || echo null); break; fi
done

JSON="{\"collectedAt\":\"$(date -Is)\",\"cpuPct\":${CPU},\"cores\":${CORES},\"memUsedPct\":${MEMPCT},\"memTotalGb\":${MEMTOTAL},\"diskUsedPct\":${DISKPCT},\"diskTotalGb\":${DISKTOTAL},\"load\":[${L1},${L5},${L15}],\"uptimeSecs\":${UPSEC},\"services\":[${SERVICES}],\"lastBackupAt\":${LASTBK},\"lastSecurityAt\":${LASTSEC}}"

PSQL -c "INSERT INTO settings (key,value,updated_at) VALUES ('vps_health','$(printf '%s' "$JSON" | sed "s/'/''/g")'::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value=excluded.value, updated_at=now();" >/dev/null
./scripts/report-job.sh "vps-health" "ok" "$(( $(date +%s%3N) - START ))" "cpu ${CPU}% · mem ${MEMPCT}% · disk ${DISKPCT}%"
echo "$(date -Is) vps-health: cpu ${CPU}% mem ${MEMPCT}% disk ${DISKPCT}%"
