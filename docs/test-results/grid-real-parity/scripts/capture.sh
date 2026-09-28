#!/bin/bash
# usage: capture.sh <build:staging|production>
set -u
BUILD=$1
OUTR=/Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/docs/test-results/grid-real-parity
for s in coffeeactually dogslabs gadgetskoala hiddenstorydaily; do
  SLUG=$(cat $OUTR/base/$BUILD/$s/newest-slug.txt)
  # category: first /category/ link from baseline homepage
  CAT=$(curl -s "http://localhost:8788/?_atl_site=$s" | grep -o 'href="/category/[^"?]*' | head -1 | sed 's/href="//; s/&#38;/%26/g; s/&amp;/%26/g')
  echo "$s slug=$SLUG cat=$CAT"
  for SIDE in base branch; do
    if [ $SIDE = base ]; then PORT=8788; else PORT=8790; fi
    D=$OUTR/$SIDE/$BUILD/$s/pages; mkdir -p $D
    : > $D/_status.txt
    for pair in "home|/" "article|/$SLUG" "category|$CAT" "about|/about" "search|/search" "api-articles-p2|/api/articles?page=2" "ads.txt|/ads.txt" "robots.txt|/robots.txt"; do
      name=${pair%%|*}; path=${pair#*|}
      case "$path" in *\?*) url="http://localhost:$PORT$path&_atl_site=$s";; *) url="http://localhost:$PORT$path?_atl_site=$s";; esac
      code=$(curl -s -o $D/$name.body -w "%{http_code} %{content_type}" "$url")
      echo "$name $path -> $code" >> $D/_status.txt
    done
    # CSS
    mkdir -p $D/css
    cat $D/*.body | grep -o '/_astro/[^"'"'"' )]*\.css' | sort -u > $D/css/_list.txt
    while read c; do curl -s -o "$D/css/$(basename $c)" "http://localhost:$PORT$c"; done < $D/css/_list.txt
  done
done
