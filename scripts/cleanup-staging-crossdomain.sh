#!/bin/bash
# Remove cross-domain file pollution from staging branches.
# For each staging/<domain> branch, reverts any files outside sites/<domain>/
# back to their main-branch state.
set -euo pipefail

NETWORK_REPO="${NETWORK_REPO:-/Users/michal/Documents/ATL-content-network/atomic-labs-network}"
WORKTREE_BASE="/tmp/atl-staging-cleanup"

cd "$NETWORK_REPO"

echo "Fetching latest remote state..."
git fetch origin --prune --quiet

# Clean up any leftover worktrees
rm -rf "$WORKTREE_BASE" 2>/dev/null || true
git worktree prune 2>/dev/null || true

branches=$(git branch -r | grep 'origin/staging/' | sed 's|origin/||' | tr -d ' ')

total=0
cleaned=0
skipped=0
errors=0

for branch in $branches; do
  domain=$(echo "$branch" | sed 's|staging/||')
  total=$((total + 1))

  # Find cross-domain files (files changed vs main that don't belong to this domain)
  cross_files=$(git diff main...origin/$branch --name-only 2>/dev/null | grep -v "^sites/$domain/" || true)

  if [ -z "$cross_files" ]; then
    echo "[$total] $domain — clean, no cross-domain files"
    skipped=$((skipped + 1))
    continue
  fi

  cross_count=$(echo "$cross_files" | wc -l | tr -d ' ')
  echo "[$total] $domain — $cross_count cross-domain files to revert"

  # Create worktree from remote branch
  wt_dir="$WORKTREE_BASE/$domain"
  rm -rf "$wt_dir" 2>/dev/null || true

  if ! git worktree add "$wt_dir" "origin/$branch" --detach --quiet 2>/dev/null; then
    echo "  SKIP — could not create worktree"
    errors=$((errors + 1))
    continue
  fi

  (cd "$wt_dir" && git checkout -B "$branch" "origin/$branch" --quiet 2>/dev/null) || {
    echo "  SKIP — could not create local branch"
    git worktree remove "$wt_dir" --force 2>/dev/null || rm -rf "$wt_dir"
    errors=$((errors + 1))
    continue
  }

  # Restore cross-domain files from main
  cd "$wt_dir"
  reverted=0
  while IFS= read -r filepath; do
    [ -z "$filepath" ] && continue
    # Try to checkout from main; if file doesn't exist on main, remove it
    if git checkout main -- "$filepath" 2>/dev/null; then
      reverted=$((reverted + 1))
    else
      # File exists on staging but not on main — remove it
      rm -f "$filepath" 2>/dev/null || true
      git rm --quiet "$filepath" 2>/dev/null || true
      reverted=$((reverted + 1))
    fi
  done <<< "$cross_files"

  # Check if anything actually changed
  changes=$(git status --porcelain | wc -l | tr -d ' ')
  if [ "$changes" -gt 0 ]; then
    git add -A
    git commit -m "data: remove cross-domain backfill pollution ($reverted files)" --quiet
    if ! git push origin "$branch" --quiet 2>&1; then
      echo "  Push rejected, rebasing..."
      if git pull --rebase origin "$branch" --quiet 2>&1 && git push origin "$branch" --quiet 2>&1; then
        echo "  Push succeeded after rebase"
      else
        echo "  FAILED — push rejected for $branch"
        cd "$NETWORK_REPO"
        git worktree remove "$wt_dir" --force 2>/dev/null || rm -rf "$wt_dir"
        errors=$((errors + 1))
        continue
      fi
    fi
    echo "  Reverted $reverted files"
    cleaned=$((cleaned + 1))
  else
    echo "  No actual changes after revert"
    skipped=$((skipped + 1))
  fi

  cd "$NETWORK_REPO"
  git worktree remove "$wt_dir" --force 2>/dev/null || rm -rf "$wt_dir"
done

# Final cleanup
rm -rf "$WORKTREE_BASE" 2>/dev/null || true
git worktree prune 2>/dev/null || true

echo ""
echo "=============================="
echo "STAGING CLEANUP COMPLETE"
echo "=============================="
echo "Total branches: $total"
echo "Cleaned: $cleaned"
echo "Already clean: $skipped"
echo "Errors: $errors"
