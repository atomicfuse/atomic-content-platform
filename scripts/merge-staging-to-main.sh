#!/bin/bash
# Safely merge all staging branch site data to main.
# For each domain: if staging is a superset of main (no files would be deleted),
# does a fast full-directory checkout. Otherwise, copies only staging files
# additively (preserves main-only files).
set -euo pipefail

NETWORK_REPO="/Users/michal/Documents/ATL-content-network/atomic-labs-network"

cd "$NETWORK_REPO"

# Ensure we're on main and up to date
echo "Syncing main to latest..."
git checkout main --quiet
git pull origin main --quiet

# Fetch all remote refs
echo "Fetching latest remote state..."
git fetch origin --prune --quiet

# Get all staging branches
branches=$(git branch -r | grep 'origin/staging/' | sed 's|origin/||' | tr -d ' ')

total=0
updated=0
skipped=0
warnings=0

for branch in $branches; do
  domain=$(echo "$branch" | sed 's|staging/||')
  total=$((total + 1))

  # Check if domain directory exists on staging
  staging_files=$(git ls-tree -r --name-only "origin/$branch" -- "sites/$domain/" 2>/dev/null | sort)

  if [ -z "$staging_files" ]; then
    echo "[$total] $domain — no site dir on staging, skipping"
    skipped=$((skipped + 1))
    continue
  fi

  # Check if domain directory exists on main
  main_files=$(git ls-tree -r --name-only HEAD -- "sites/$domain/" 2>/dev/null | sort)

  # Find files that would be deleted (on main but not on staging)
  deleted=$(comm -23 <(echo "$main_files") <(echo "$staging_files") 2>/dev/null || true)

  if [ -n "$deleted" ]; then
    # Staging is NOT a superset — use additive-only copy
    del_count=$(echo "$deleted" | wc -l | tr -d ' ')
    echo "[$total] $domain — $del_count main-only files preserved, using additive merge"
    warnings=$((warnings + 1))

    # Copy each staging file individually (preserves main-only files)
    while IFS= read -r filepath; do
      [ -z "$filepath" ] && continue
      mkdir -p "$(dirname "$filepath")"
      git show "origin/$branch:$filepath" > "$filepath" 2>/dev/null || true
    done <<< "$staging_files"
  else
    # Staging is a superset — fast full-directory checkout
    git checkout "origin/$branch" -- "sites/$domain/" 2>/dev/null || {
      echo "[$total] $domain — checkout failed, skipping"
      skipped=$((skipped + 1))
      continue
    }
  fi

  # Check if anything actually changed
  domain_changes=$(git diff --name-only -- "sites/$domain/" | wc -l | tr -d ' ')
  domain_new=$(git ls-files --others -- "sites/$domain/" | wc -l | tr -d ' ')
  total_changes=$((domain_changes + domain_new))

  if [ "$total_changes" -gt 0 ]; then
    echo "[$total] $domain — $total_changes files changed/added"
    updated=$((updated + 1))
  else
    echo "[$total] $domain — no changes"
  fi
done

# Check total changes
total_changed=$(git status --porcelain -- sites/ | wc -l | tr -d ' ')

if [ "$total_changed" -gt 0 ]; then
  echo ""
  echo "Staging $total_changed changed files..."
  git add sites/
  echo "Committing..."
  git commit -m "data: merge all staging sites to main (topics + latest content)" --quiet
  echo "Pushing to origin/main..."
  git push origin main --quiet
  echo "Push complete!"
else
  echo ""
  echo "No changes to commit — main is already up to date."
fi

echo ""
echo "=============================="
echo "STAGING → MAIN MERGE COMPLETE"
echo "=============================="
echo "Total staging branches: $total"
echo "Domains updated: $updated"
echo "Skipped: $skipped"
echo "Domains with preserved main-only files: $warnings"
