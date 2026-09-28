#!/bin/bash
# usage: seed.sh <side:base|branch>
set -u
SIDE=$1
ROOT=/Users/asafcohen/Desktop/ATL-Content-Network
if [ "$SIDE" = base ]; then P=$ROOT/atomic-content-platform-parity-base; else P=$ROOT/atomic-content-platform; fi
OUT=$ROOT/atomic-content-platform/docs/test-results/grid-real-parity/$SIDE
NET=$ROOT/atomic-labs-network-parity
cd $P/packages/site-worker

for env in staging production; do
  if [ $env = staging ]; then NS=f6c35e1fa8c841b8b193509a3a237f7f; else NS=b258e47065274b8b8af1a0b6d6529c1d; fi
  for s in coffeeactually dogslabs gadgetskoala hiddenstorydaily; do
    D=$OUT/$env/$s; mkdir -p $D
    env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID -u CF_API_TOKEN -u CLOUDFLARE_API_KEY WRANGLER_SEND_METRICS=false \
      NETWORK_DATA_PATH=$NET KV_REMOTE=false R2_REMOTE=false KV_NAMESPACE_ID=$NS \
      pnpm seed:kv $s $s $s.com > $D/seed-log.txt 2>&1
    echo "$SIDE $env $s seed exit=$?"
  done
done
