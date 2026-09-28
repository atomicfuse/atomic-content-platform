#!/bin/bash
ROOT=/Users/asafcohen/Desktop/ATL-Content-Network
for NS in f6c35e1fa8c841b8b193509a3a237f7f b258e47065274b8b8af1a0b6d6529c1d; do
for s in coffeeactually dogslabs gadgetskoala hiddenstorydaily; do
  for k in "cond-overrides:$s" "shared-page:$s:about" "shared-page:$s:contact" "shared-page:$s:privacy" "shared-page:$s:terms" "shared-page:$s:dmca" "shared-page:$s:amazon" "site:$s"; do
    a=$(cd $ROOT/atomic-content-platform-parity-base/packages/site-worker && pnpm exec wrangler kv key get "$k" --namespace-id=$NS --local 2>/dev/null)
    b=$(cd $ROOT/atomic-content-platform/packages/site-worker && pnpm exec wrangler kv key get "$k" --namespace-id=$NS --local 2>/dev/null)
    if [ "$a" = "$b" ]; then echo "${NS:0:6} same ($(printf %s "$a" | wc -c | tr -d ' ')B) $k"; else echo "${NS:0:6} DIFF $k"; fi
  done
  # key list parity for this site
  la=$(cd $ROOT/atomic-content-platform-parity-base/packages/site-worker && pnpm exec wrangler kv key list --namespace-id=$NS --local 2>/dev/null | jq -r '.[].name' | grep -E ":$s(:|$)|^site:$s" | sort | shasum)
  lb=$(cd $ROOT/atomic-content-platform/packages/site-worker && pnpm exec wrangler kv key list --namespace-id=$NS --local 2>/dev/null | jq -r '.[].name' | grep -E ":$s(:|$)|^site:$s" | sort | shasum)
  [ "$la" = "$lb" ] && echo "${NS:0:6} keylist same $s" || echo "${NS:0:6} keylist DIFF $s"
done; done
