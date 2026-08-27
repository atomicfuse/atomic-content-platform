# Bugs

_Last reviewed: 2026-08-27 (sync-kv cancellation + image-alert investigation; four bugs found, all fixed)_
_4 open bugs, 2 marked [High]_

Known bugs grouped by what part of the system they affect. Items marked [High] are user-affecting or cause data-integrity problems. Tick the checkbox when fixed.

## Content pipeline

### [x] (2026-08-27) [High] Auto-publish destroyed image commits that landed mid-publish

**The bug:** When the scheduler publishes a site, it copies `sites/<domain>/` from the staging branch to `main` and then force-resets the staging branch. Anything committed to staging *between* the copy and the reset was copied nowhere and then erased. n8n image callbacks commit `featuredImage` to staging about 20 seconds after an article is created — squarely inside that window.

**Where it happens:** `services/content-pipeline/src/queue/scheduler-flow.ts` → `autoPublishSite`. The pre-existing `clearTreeCache` guard fixed stale *caching*, not the *interleaving*.

**What should happen:** Every commit on the staging branch reaches `main`, or is left on staging for the next publish. Nothing is discarded.

**What actually happened:** On 2026-08-27, 12 articles generated and all 12 images succeeded (n8n took 20–24s each). Five nonetheless ended up on `main` with `<site>-general-article.webp`. Two variants: the image lands *before* the reset → destroyed on both branches (permanent); or *after* the reset → staging keeps it, `main` stays stale until the next publish (self-healing but slow). Recurring across at least the 08-23, 08-24 and 08-27 runs — 8 articles restored in total.

**Fix:** Compare-and-swap on the staging ref. Record its SHA before snapshotting; re-read before the reset; if it moved, re-copy (bounded to 3 attempts) and if drift persists skip the reset entirely, because leaving staging ahead loses nothing while resetting destroys commits. Only the first variant is fully prevented; the second now surfaces via the image-timeout alert instead of being silent.

### [x] (2026-08-27) [High] Image-failure alerts were uncorrelated with reality (5 replicas, in-memory state)

**The bug:** The 300s "n8n callback not received" alert decided whether to fire by consulting an in-memory set. The service runs **5 replicas**, and n8n's callback is load-balanced — so the replica holding the timer usually isn't the one that received the callback and recorded success. It then alerted for articles that had images.

**Where it happens:** `services/content-pipeline/src/agents/content-generation/n8n-image.ts` → `trackPendingImage`. `pendingImages`, `successfulImages` and `delayedAlerts` are all per-process.

**What should happen:** Alert when an article lacks its image; stay quiet when it has one.

**What actually happened:** On the 2026-08-27 run, 4 alerts fired and all 4 were false (proved by `SUCCESS — image delivered` and `TIMEOUT` logged for the same slug 4 minutes apart), while 5 articles that genuinely lost their image were silent. Zero of the alerts were correct in either direction.

**Fix:** The timeout now reads the article's actual `featuredImage` from Git (staging, falling back to `main`) and alerts only if it is missing or a general image. Unverifiable reads alert, with the reason saying so — every failure in this subsystem has been a silence, and a false positive is cheaper than a lost image.

### [x] (2026-08-27) Image alerts linked to a URL that could never resolve

**The bug:** The alert body built `https://${site}/articles/${slug}`, where `site` is the siteId (folder name) rather than a hostname, and `/articles/` is not the article route.

**Where it happens:** `services/content-pipeline/src/lib/notifications.ts` → `notifyImageDefaultFallback`.

**What actually happened:** `https://dogslabs/articles/<slug>` — no such host. With the real domain it still 404s; the working form is `https://dogslabs.com/<slug>/`. Every image alert ever sent contained a dead link.

**Fix:** Link the dashboard's general-images page instead — always valid, and where the image gets fixed. `DASHBOARD_PUBLIC_URL` now has a single definition in `lib/config.ts` rather than being re-declared per file.

### [ ] [High] Articles generated while Redis is down are silently lost

**The bug:** When the dashboard can't reach Redis (the job queue), the "Generate" button quietly falls back to a direct HTTP call to the pipeline — and that path generates articles but never saves them to git and never updates the duplicate-tracking index.

**Where it happens:** Any manual "Generate article" click when Redis is unreachable or misconfigured. (`services/dashboard/src/app/api/agent/generate/route.ts:112-125` falling through to `POST /content-generate` in `services/content-pipeline/src/agents/content-generation/index.ts`.)

**What should happen:** Either the generated articles get committed like queue jobs do, or the request fails loudly so the operator knows Redis is down.

**What actually happens:** The run "succeeds", tokens are spent, but nothing lands on the site, and the next run can regenerate the same stories because usage was never recorded.

**How to fix or work around:** Workaround: verify `REDIS_URL` is reachable on both services (see the 2026-07-16 remediation runbook, §5). Real fix: make the HTTP path commit + update the dedup index, or remove the silent fallback.

---

### [ ] Videos from non-YouTube sources vanish from articles that promise them

**The bug:** When an article is generated from a video content item, the article text is written assuming the video will be embedded — but the site can only render YouTube embeds, so any other video source is silently dropped.

**Where it happens:** Live article pages for articles generated from non-YouTube video items. (`packages/site-worker/src/lib/inject-videos.ts` is YouTube-only; the pipeline writes any `item.url` into `frontmatter.videos` at `agent.ts` video branch.)

**What should happen:** Either non-YouTube videos render too, or the pipeline skips the embed (and the "video below" phrasing) for unsupported sources.

**What actually happens:** The reader sees text referencing a video that never appears.

**How to fix or work around:** No workaround — needs a code fix (validate the URL at generation time like the dashboard's YouTube regex does, or extend the renderer).

---

## Dashboard

### [ ] [High] Article counts disappear for auto-published sites

**The bug:** Every night, when the scheduler publishes a live site's new articles to production, it moves the site's article records in MongoDB from the "staging" shelf to the "main" shelf and throws away the staging copies. But the dashboard only ever looks at the staging shelf when counting articles — so for these sites it finds nothing.

**Where it happens:** The Sites table Articles column shows "–" and the site's Content tab is empty, for any Live site with nightly auto-publish (wineoceans, decoratingmom, travelswire, etc.). (`services/dashboard/src/lib/db/articles.ts:177-201` and `:153-170` query only `branch = staging_branch`; `services/content-pipeline/src/queue/scheduler-flow.ts:224-279` writes docs under `"main"` and deletes the staging-branch docs.)

**What should happen:** The table and Content tab should show the site's real article count and list, whether the articles are pending on staging or already published.

**What actually happens:** Counts show "–" and the Content tab is empty, even though the site publishes articles daily ("Last Articles: today" stays correct because it reads from a different source — the scheduler's history file in Git). The 2026-07-16 Mongo backfill fixed these sites for less than a day; the next scheduler run wiped the staging docs again.

**How to fix or work around:** Fix implemented 2026-07-19 (dual-branch reads in `services/dashboard/src/lib/db/articles.ts`, +4 tests, suite 311 green) — **uncommitted, awaiting Asaf's local review and deploy**. Tick this off once verified in production (local dev uses the Git read path, so verification happens post-deploy).

---

### [x] (2026-07-19) [High] Unpublished-changes banner hidden on polluted staging branches — fixed operationally: cleanup script + `git merge origin/main` pushed to 8 polluted branches (merge-base advanced, compare now exact). `staging/chaibeseret` + `staging/travelingfoodie2` intentionally skipped (sites slated for deletion). Durable hardening (tree-SHA compare, writer path guard) parked in `notes.md` → "Staging-branch hygiene".

**The bug:** The yellow "You have unpublished changes on staging" banner now decides whether to show by asking GitHub for the list of changed files and keeping only the ones belonging to the site. GitHub only returns the first 300 changed files (alphabetically) — and ten staging branches are cluttered with thousands of leftover files from other sites (from an old topic-backfill batch job), so the site's own files never make it into that first 300 and the banner stays hidden.

**Where it happens:** Site detail page after editing topics, theme, articles, etc., on the affected sites — verified live for staging/hiddenstorydaily (12 commits ahead, no banner), travelingfoodie2 (28 ahead), tvshowsmag, paleobeasts, carsnewsmag, coffeeactually, financenewsbase, gamingnewsalley, muvizzcom, chaibeseret. (`services/dashboard/src/app/api/sites/staging-status/route.ts:42-57`, changed in commit 9f77622; GitHub compare API caps `files` at 300.)

**What should happen:** Any real un-published edit to the site should make the banner appear.

**What actually happens:** On the ten polluted branches, edits pile up invisibly and the operator has no way to see or publish them from the UI. Clean branches still work.

**How to fix or work around:** Workaround: run `scripts/cleanup-staging-crossdomain.sh` to strip the cross-domain files (restores the banner but leaves the check fragile). Real fix: compare the Git tree of `sites/<domain>/` between main and the staging branch (two cheap API calls, immune to the 300-file cap). Related latent risk found during the same investigation: the banner is also gated on the Mongo dashboard-index doc's `status`/`staging_branch`, and `updateDashboardIndexEntry` is a non-upsert `updateOne` — a missing Mongo doc silently disables the banner too.

---

### [ ] Article lists never refresh if the Mongo read flag is turned off

**The bug:** The dashboard's KV article cache is set to never expire (its TTL is literally `Infinity`) and the function that would clear it is never called — so with `USE_MONGO_READS=false`, article lists would stay frozen at whatever was first loaded.

**Where it happens:** Only when running with `USE_MONGO_READS` unset/false (not current production). (`services/dashboard/src/lib/kv-api.ts:27-34` — `KV_CACHE_TTL = Infinity`, `invalidateKVArticleCache` has zero callers.)

**What should happen:** A finite TTL and/or invalidation on writes.

**What actually happens:** Permanent staleness on the fallback read path; also the code comment claims "15min TTL", which is false.

**How to fix or work around:** Workaround: keep `USE_MONGO_READS=true`. Fix: set a real TTL or delete the dead cache.

---
