#!/bin/bash
# Process all staging branches: checkout, run backfill, commit, push.
# v2: Always start from fresh remote HEAD to avoid non-fast-forward errors.
set -euo pipefail

NETWORK_REPO="/Users/michal/Documents/ATL-content-network/atomic-labs-network"
BACKFILL_SCRIPT="/Users/michal/Documents/ATL-content-network/atomic-content-platform/scripts/backfill-topics.mjs"
WORKTREE_BASE="/tmp/atl-staging-backfill"

cd "$NETWORK_REPO"

# Fetch ALL remote refs fresh — critical to avoid stale tracking branches
echo "Fetching latest remote state..."
git fetch origin --prune --quiet

# Clean up any leftover worktrees from previous runs
rm -rf "$WORKTREE_BASE" 2>/dev/null || true
git worktree prune 2>/dev/null || true

# Get all staging branches
branches=$(git branch -r | grep 'origin/staging/' | sed 's|origin/||' | tr -d ' ')

total=0
updated=0
errors=0
skipped=0
failed_branches=""

for branch in $branches; do
  domain=$(echo "$branch" | sed 's|staging/||')
  total=$((total + 1))

  echo "[$total] Processing $branch ($domain)..."

  # Create a temporary worktree ALWAYS from the remote ref (fresh HEAD)
  wt_dir="$WORKTREE_BASE/$domain"
  rm -rf "$wt_dir" 2>/dev/null || true

  # Detached checkout from origin — guaranteed to be at remote HEAD
  if ! git worktree add "$wt_dir" "origin/$branch" --detach --quiet 2>/dev/null; then
    echo "  SKIP — could not create worktree for $branch"
    errors=$((errors + 1))
    continue
  fi

  # Create a local branch at exactly the remote HEAD so we can commit and push
  (cd "$wt_dir" && git checkout -B "$branch" "origin/$branch" --quiet 2>/dev/null) || {
    echo "  SKIP — could not create local branch for $branch"
    git worktree remove "$wt_dir" --force 2>/dev/null || rm -rf "$wt_dir"
    errors=$((errors + 1))
    continue
  }

  # Run backfill in the worktree
  output=$(NETWORK_DATA_PATH="$wt_dir" node "$BACKFILL_SCRIPT" 2>&1) || {
    echo "  ERROR — backfill script failed for $branch"
    echo "  $output" | tail -3
    git worktree remove "$wt_dir" --force 2>/dev/null || rm -rf "$wt_dir"
    errors=$((errors + 1))
    continue
  }
  count=$(echo "$output" | grep "Articles updated:" | grep -o '[0-9]*')

  if [ "${count:-0}" -gt 0 ]; then
    echo "  $count articles updated"
    cd "$wt_dir"
    git add -A
    git commit -m "data: backfill topics for $domain ($count articles)" --quiet

    # Push with one retry — if non-fast-forward, pull --rebase and retry
    if ! git push origin "$branch" --quiet 2>&1; then
      echo "  Push rejected, rebasing..."
      if git pull --rebase origin "$branch" --quiet 2>&1 && git push origin "$branch" --quiet 2>&1; then
        echo "  Push succeeded after rebase"
      else
        echo "  FAILED — push still rejected for $branch"
        failed_branches="$failed_branches $branch"
        cd "$NETWORK_REPO"
        git worktree remove "$wt_dir" --force 2>/dev/null || rm -rf "$wt_dir"
        errors=$((errors + 1))
        continue
      fi
    fi

    cd "$NETWORK_REPO"
    updated=$((updated + 1))
  else
    echo "  No changes needed"
    skipped=$((skipped + 1))
  fi

  # Cleanup worktree
  git worktree remove "$wt_dir" --force 2>/dev/null || rm -rf "$wt_dir"
done

# Final cleanup
rm -rf "$WORKTREE_BASE" 2>/dev/null || true
git worktree prune 2>/dev/null || true

echo ""
echo "=============================="
echo "STAGING BACKFILL COMPLETE"
echo "=============================="
echo "Total branches: $total"
echo "Updated: $updated"
echo "Already done: $skipped"
echo "Errors: $errors"
if [ -n "$failed_branches" ]; then
  echo "Failed branches:$failed_branches"
fi
