#!/usr/bin/env bash
# Seeds the LOCAL wrangler KV/R2 with the Grid fixture network. Never touches remote.
set -euo pipefail
cd "$(dirname "$0")/../.."
export NETWORK_DATA_PATH="$PWD/tests/fixtures/grid-network"
export KV_REMOTE=false R2_REMOTE=false
export KV_NAMESPACE_ID=f6c35e1fa8c841b8b193509a3a237f7f
SITES="${SITES:-fixture-travel-a fixture-travel-b fixture-health-a fixture-grid}"
for s in $SITES; do pnpm seed:kv "$s" "$s"; done
NETWORK_DATA_PATH="$NETWORK_DATA_PATH" pnpm exec tsx scripts/seed-grid.ts --local --all-summaries
