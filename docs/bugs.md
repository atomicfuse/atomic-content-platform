# Bugs

_Last reviewed: 2026-07-16_
_4 open bugs, 1 marked [High]_

Known bugs grouped by what part of the system they affect. Items marked [High] are user-affecting or cause data-integrity problems. Tick the checkbox when fixed.

## Content pipeline

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

### [ ] Renaming a site may leave MongoDB out of sync

**The bug:** The site-rename flow updates git and clears only the old in-memory cache; it's unverified whether the renamed config and branch fields are mirrored into MongoDB, which is what the dashboard actually reads in production.

**Where it happens:** Site rename. (`services/dashboard/src/app/api/sites/rename/route.ts` — calls legacy tree-cache invalidation only.)

**What should happen:** Rename dual-writes the updated config/index entry to MongoDB like other mutations do.

**What actually happens:** Possibly stale name/branch data in the UI after a rename (needs verification — flagged during the 2026-07-16 stale-UI investigation).

**How to fix or work around:** Workaround: run the Mongo backfill/reconcile after a rename. Fix: audit the route against the dual-write pattern.

---

### [ ] Article lists never refresh if the Mongo read flag is turned off

**The bug:** The dashboard's KV article cache is set to never expire (its TTL is literally `Infinity`) and the function that would clear it is never called — so with `USE_MONGO_READS=false`, article lists would stay frozen at whatever was first loaded.

**Where it happens:** Only when running with `USE_MONGO_READS` unset/false (not current production). (`services/dashboard/src/lib/kv-api.ts:27-34` — `KV_CACHE_TTL = Infinity`, `invalidateKVArticleCache` has zero callers.)

**What should happen:** A finite TTL and/or invalidation on writes.

**What actually happens:** Permanent staleness on the fallback read path; also the code comment claims "15min TTL", which is false.

**How to fix or work around:** Workaround: keep `USE_MONGO_READS=true`. Fix: set a real TTL or delete the dead cache.

---
