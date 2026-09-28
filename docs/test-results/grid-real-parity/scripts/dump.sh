#!/bin/bash
set -u
ROOT=/Users/asafcohen/Desktop/ATL-Content-Network
OUTR=$ROOT/atomic-content-platform/docs/test-results/grid-real-parity
for SIDE in base branch; do
  if [ "$SIDE" = base ]; then P=$ROOT/atomic-content-platform-parity-base; else P=$ROOT/atomic-content-platform; fi
  cd $P/packages/site-worker
  for env in staging production; do
    if [ $env = staging ]; then NS=f6c35e1fa8c841b8b193509a3a237f7f; else NS=b258e47065274b8b8af1a0b6d6529c1d; fi
    for s in coffeeactually dogslabs gadgetskoala hiddenstorydaily; do
      D=$OUTR/$SIDE/$env/$s
      get() { env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID WRANGLER_SEND_METRICS=false pnpm exec wrangler kv key get "$1" --namespace-id=$NS --local 2>/dev/null; }
      get "site-config:$s" > $D/kv-site-config.raw.json
      get "article-index:$s" > $D/kv-article-index.raw.json
      # newest published slug — computed from baseline index so both sides dump the same key
      if [ $SIDE = base ]; then
        jq -r '[.[] | select(.status=="published")] | sort_by(.publishDate) | last | .slug' $D/kv-article-index.raw.json > $D/newest-slug.txt
        SLUG=$(cat $D/newest-slug.txt)
      else
        SLUG=$(cat $OUTR/base/$env/$s/newest-slug.txt); echo $SLUG > $D/newest-slug.txt
      fi
      get "article:$s:$SLUG" > $D/kv-article.raw.json
      get "site:$s.com" > $D/kv-site-lookup.raw.json 2>/dev/null
      for k in site-config article-index article; do jq -S . $D/kv-$k.raw.json > $D/kv-$k.sorted.json; done
    done
  done
done
