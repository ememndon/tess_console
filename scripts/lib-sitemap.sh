#!/usr/bin/env bash
# Shared sitemap/feed parsing for the content-inventory and competitor-poll crons
# Dependency-free (curl + GNU grep -P). Emits one URL per line.

UA="TessConsole-Crawler/1.0 (+https://tessconsole.cloud)"

# sitemap_locs <url> — print every page <loc> for a sitemap, sitemap index (one
# level deep, capped), or RSS/Atom feed. Best-effort: never fails the caller.
sitemap_locs() {
  local url="$1" body
  body=$(curl -sSL -m 25 -A "$UA" "$url" 2>/dev/null) || return 0
  [ -z "$body" ] && return 0

  if printf '%s' "$body" | grep -q '<sitemapindex'; then
    printf '%s' "$body" | grep -oP '(?<=<loc>)[^<]+' | head -12 | while read -r child; do
      curl -sSL -m 25 -A "$UA" "$child" 2>/dev/null | grep -oP '(?<=<loc>)[^<]+'
    done
  elif printf '%s' "$body" | grep -q '<urlset'; then
    printf '%s' "$body" | grep -oP '(?<=<loc>)[^<]+'
  else
    # RSS <link>…</link> and Atom <link href="…">
    printf '%s' "$body" | grep -oP '(?<=<link>)[^<]+'
    printf '%s' "$body" | grep -oP '<link[^>]*href="\K[^"]+'
  fi
}

# competitor_urls <host> — try common sitemap/feed locations until one yields
# URLs; keep only same-host pages.
competitor_urls() {
  local host="$1" base="https://$1" out
  for path in /sitemap.xml /sitemap_index.xml /sitemap-index.xml /sitemap/sitemap.xml /wp-sitemap.xml /feed /feed.xml /rss /atom.xml; do
    out=$(sitemap_locs "${base}${path}")
    if [ -n "$out" ]; then
      printf '%s\n' "$out" | grep -iE "^https?://([a-z0-9.-]*\.)?${host//./\\.}(/|$)" | head -300
      return 0
    fi
  done
}
