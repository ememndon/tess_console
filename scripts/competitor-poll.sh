#!/usr/bin/env bash
# Competitor content monitor: polls each configured competitor's
# sitemap/RSS and records pages we haven't seen before. The "new publications"
# feed is everything discovered recently (the first crawl seeds the baseline;
# genuinely new pages surface on subsequent days). Deterministic.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "competitor-poll" || { echo "$(date -Is) competitor-poll: paused (jobs monitor), skipping"; exit 0; }
. ./.env
. ./scripts/lib-sitemap.sh
START=$(date +%s%3N)
PSQL() { docker exec tess-db psql -qtA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }
PSQLi() { docker exec -i tess-db psql -qtA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"; }

NEW=0
# One line per (site, competitor) pair.
while IFS='|' read -r SITE COMP; do
  [ -z "${SITE:-}" ] && continue
  TMP=$(mktemp)
  competitor_urls "$COMP" | sort -u > "$TMP"
  COUNT=$(wc -l < "$TMP")
  if [ "$COUNT" -gt 0 ]; then
    BEFORE=$(PSQL -c "SELECT count(*) FROM competitor_pages WHERE site='$SITE' AND competitor='$COMP';")
    {
      echo "INSERT INTO competitor_pages (site,competitor,url) VALUES"
      first=1
      while IFS= read -r URL; do
        [ -z "$URL" ] && continue
        u=${URL//\'/\'\'}
        [ $first -eq 1 ] && first=0 || echo ","
        printf "('%s','%s','%s')" "$SITE" "$COMP" "$u"
      done < "$TMP"
      echo " ON CONFLICT (site,competitor,url) DO NOTHING;"
    } | PSQLi >/dev/null 2>&1
    AFTER=$(PSQL -c "SELECT count(*) FROM competitor_pages WHERE site='$SITE' AND competitor='$COMP';")
    NEW=$((NEW + AFTER - BEFORE))
  fi
  rm -f "$TMP"
done < <(PSQL -c "SELECT key||'|'||c.host FROM sites, jsonb_array_elements_text(competitors) AS c(host);")

DUR=$(( $(date +%s%3N) - START ))
./scripts/report-job.sh "competitor-poll" "ok" "$DUR" "discovered ${NEW} new competitor pages"
echo "$(date -Is) competitor-poll: ${NEW} new pages"
