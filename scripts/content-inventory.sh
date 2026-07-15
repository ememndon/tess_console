#!/usr/bin/env bash
# Content inventory crawler: walks each site's sitemap(s) into the
# content_pages registry. Traffic is joined live from analytics at render time;
# indexing/clicks fill in once GSC is connected. Deterministic.
set -u
cd /opt/tess-console || exit 1
. ./scripts/job-gate.sh
job_enabled "content-inventory" || { echo "$(date -Is) content-inventory: paused (jobs monitor), skipping"; exit 0; }
. ./.env
. ./scripts/lib-sitemap.sh
START=$(date +%s%3N)
PSQL() { docker exec tess-db psql -qtA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }
PSQLi() { docker exec -i tess-db psql -qtA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"; }

TOTAL=0
SITES=$(PSQL -c "SELECT key FROM sites ORDER BY key;")
for SITE in $SITES; do
  TMP=$(mktemp)
  while IFS= read -r SM; do
    [ -z "$SM" ] && continue
    sitemap_locs "$SM"
  done < <(PSQL -c "SELECT jsonb_array_elements_text(sitemaps) FROM sites WHERE key='$SITE';") | sort -u | head -5000 > "$TMP"

  COUNT=$(wc -l < "$TMP")
  if [ "$COUNT" -gt 0 ]; then
    {
      echo "INSERT INTO content_pages (site,url,path) VALUES"
      first=1
      while IFS= read -r URL; do
        [ -z "$URL" ] && continue
        rest=${URL#*://}
        if [[ "$rest" == */* ]]; then path="/${rest#*/}"; else path="/"; fi
        u=${URL//\'/\'\'}; p=${path//\'/\'\'}
        [ $first -eq 1 ] && first=0 || echo ","
        printf "('%s','%s','%s')" "$SITE" "$u" "$p"
      done < "$TMP"
      echo " ON CONFLICT (site,url) DO UPDATE SET fetched_at=now();"
    } | PSQLi >/dev/null 2>&1 && TOTAL=$((TOTAL + COUNT))
  fi
  rm -f "$TMP"
done

DUR=$(( $(date +%s%3N) - START ))
./scripts/report-job.sh "content-inventory" "ok" "$DUR" "indexed ${TOTAL} pages across sites"
echo "$(date -Is) content-inventory: ${TOTAL} pages"
