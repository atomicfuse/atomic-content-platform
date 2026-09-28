#!/usr/bin/env bash
# Captures modern-site HTML from a running `pnpm dev:worker` (port 8788) into $1.
set -euo pipefail
OUT="$1"; mkdir -p "$OUT"
BASE=http://localhost:8788
for path in "/" "/best-beaches-in-portugal" "/category/destinations" "/search" "/about"; do
  name=$(echo "$path" | tr '/' '_'); [ "$name" = "_" ] && name=_home
  curl -s "$BASE$path?_atl_site=fixture-travel-a" > "$OUT/$name.html"
done
curl -s "$BASE/api/articles?page=2&_atl_site=fixture-travel-a" > "$OUT/_api_articles.html"
for f in $(grep -oh '/_astro/[^"]*\.css' "$OUT"/*.html | sort -u); do curl -s "$BASE$f" > "$OUT/$(basename "$f")"; done
