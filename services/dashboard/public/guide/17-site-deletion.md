# Deleting a Site

## Overview

Deleting a site removes all associated resources across four storage systems: Git (network repo), Worker KV (both staging and production namespaces), R2 (asset buckets), and Cloudflare Pages (legacy projects). The process is designed to be thorough — no orphaned files, no wasted storage.

## Two-Stage Deletion

Site deletion follows a two-stage model: **soft delete** (move to trash) and **permanent delete** (remove from trash).

```
Active Site ──[Delete]──> Trash ──[Permanently Delete]──> Gone
                            │
                            └──[Restore]──> Active Site (status: Staging)
```

### Soft Delete

When you delete a site from the dashboard, the system performs a full cleanup in order:

| Step | What happens | Storage |
|------|-------------|---------|
| 1. Delete staging branch | Removes `staging/<domain>` branch (all staging files, including override files on that branch) | Git |
| 2. Delete site files + overrides | Removes `sites/<domain>/` AND `overrides/<domain>/` from `main` in a single atomic commit | Git |
| 3. Delete Pages project | Removes the legacy Cloudflare Pages project, if one exists | CF Pages |
| 4a. Delete known KV keys | Removes `site:<hostname>`, `site-config:<domain>`, `article-index:<domain>`, `sync-status:<domain>` | KV |
| 4b. Delete article + shared-page KV | Scans and bulk-deletes all `article:<domain>:*` and `shared-page:<domain>:*` entries, plus `site-config-prev:<domain>` | KV |
| 4c. Delete R2 assets | Lists and deletes all objects under `<domain>/` prefix from both staging and production R2 buckets | R2 |
| 5. Move to trash | Moves the site entry from `sites[]` to `deleted[]` in `dashboard-index.yaml` | Git |

Steps 4a-4c run against **both** the staging and production KV namespaces.

The delete modal shows step-by-step progress with success/failure for each step.

### Permanent Delete

When you permanently delete a site from trash, the system retries all cleanup as a safety net — in case the soft delete partially failed. Every operation is best-effort; failures are silently swallowed so a single stuck resource doesn't block the permanent delete.

The permanent delete also cleans up known KV keys (`site:`, `site-config:`, `article-index:`, `sync-status:`) that the soft delete normally handles, as a fallback.

After cleanup, the entry is removed from the `deleted[]` array in `dashboard-index.yaml`.

### Restore from Trash

Restoring a site moves it back to the active list. Since the staging branch and site files were already deleted during soft delete, the site status resets to **Staging** — it returns to the staging workflow.

## What Gets Deleted — Full Inventory

### Git (Network Repo)

| Path | Branch | When deleted |
|------|--------|-------------|
| `staging/<domain>` (entire branch) | staging | Soft delete, step 1 |
| `sites/<domain>/site.yaml` | main | Soft delete, step 2 |
| `sites/<domain>/articles/*.md` | main | Soft delete, step 2 |
| `sites/<domain>/assets/*` | main | Soft delete, step 2 |
| `overrides/<domain>/*.md` | main | Soft delete, step 2 (same commit as site files) |
| `dashboard-index.yaml` entry | main | Soft delete, step 5 (moved to `deleted[]`) |

### Worker KV (Both Namespaces)

| Key pattern | Content | How deleted |
|-------------|---------|-------------|
| `site:<hostname>` | Hostname-to-siteId lookup | Direct delete (step 4a) |
| `site:<custom_domain>` | Custom domain lookup (if set) | Direct delete (step 4a) |
| `site-config:<domain>` | Full resolved site config | Direct delete (step 4a) |
| `article-index:<domain>` | Article metadata array | Direct delete (step 4a) |
| `sync-status:<domain>` | Last sync audit record | Direct delete (step 4a) |
| `article:<domain>:<slug>` | Full article body (one per article) | Prefix scan + bulk delete (step 4b) |
| `shared-page:<domain>:<name>` | Shared page override HTML | Prefix scan + bulk delete (step 4b) |
| `site-config-prev:<domain>` | Previous config snapshot | Direct delete (step 4b) |

### R2 Buckets

| Bucket | Objects deleted |
|--------|----------------|
| `atl-assets-staging` | All objects with prefix `<domain>/` |
| `atl-assets-prod` | All objects with prefix `<domain>/` |

These are typically site images (logos, article images) uploaded during content generation and KV seeding.

### Cloudflare Pages (Legacy)

If the site has a `pages_project` set in `dashboard-index.yaml`, the corresponding Cloudflare Pages project is deleted. This is a legacy artifact from before the Workers migration — new sites don't have Pages projects.

## Error Handling

All cleanup steps are **best-effort**. If a step fails:

- The error is logged in the step-by-step progress log shown in the delete modal
- The deletion continues to the next step
- The site is still moved to trash (step 5) even if earlier cleanup steps failed
- Permanent delete retries all cleanup, catching anything the soft delete missed

### R2 Credentials

R2 cleanup requires `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` environment variables. If these are not configured, R2 cleanup is skipped with a console warning — all other cleanup still runs normally.

## Eventual Consistency

After deletion, resources may briefly remain visible at the edge:

- **KV entries:** typically propagate within seconds, but edge caches may serve stale values for up to ~60 seconds
- **R2 objects:** same eventual consistency window
- **Worker responses:** sites served from KV will 404 once the `site:<hostname>` lookup is gone, but cached responses may persist for one cache window (`s-maxage=300` for articles, `s-maxage=60` for homepage)

## Recreating a Deleted Domain

If a previously deleted domain is recreated through the wizard, all resources are fresh — new staging branch, new `site.yaml`, new KV entries. Any orphaned KV entries from the old site (unlikely after full cleanup) will be overwritten during KV seeding.
