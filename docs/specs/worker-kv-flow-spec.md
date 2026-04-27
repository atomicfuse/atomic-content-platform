# Spec: Worker + KV Build Flow — Step-by-Step Verification

**Project:** Atomic Network — multi-site content platform on Cloudflare Worker + KV
**Author:** Michal
**Purpose:** Verify the end-to-end "what gets built / how long" flow under the new Worker setup, across the most common change types.
**Audience for this spec:** Claude Code (running in the `atomic-labs-network` repo)

---

## Background — the model we're verifying

Under the new Worker setup, **the unit is the single KV key**. Nothing "builds" in the traditional sense — CI writes the specific keys that changed.

- Changes propagate via KV sync (~30s) and are served on the next request.
- The only thing that ever "rebuilds" is the **Worker itself**, and that only happens when Worker code changes — not when content or config changes.
- HTML shells are cached at the edge. Dynamic surfaces (ads, pixels) render in `<AdSlot server:defer />` Server Islands and read fresh config from KV per request.

### Reference table (the model under test)

| # | Change type | What happens | TTL | Rebuild? | HTML shell purge? |
|---|-------------|--------------|-----|----------|------------------|
| 1 | New article | CI writes `article:<siteId>:<slug>` + updates `article-index:<siteId>` | ~30s | No | Yes (homepage + category listing shell) |
| 2 | Ad script / SDK changes | CI syncs `site-config:<siteId>`; Server Island reads new config on next request | ~30s | No | No |
| 3 | Ad placement add/remove/change | CI syncs updated `monetization` block in `site-config:<siteId>` | ~30s | No | No |
| 4 | Monetization rules (CPM, page-type, network priority) | Same as #3 — single KV write | ~30s | No | No |
| 5 | Topics / categories change | CI syncs `site-config:<siteId>`. Purge if categories appear in nav/footer | ~30s + purge | No | Yes if shell-level |
| 6 | Tracking pixels (GA4, GTM, FB, custom) | Same as #2 — config-only, picked up by `PixelLoader` Server Island | ~30s | No | No |
| 7 | Theme template change (BaseLayout, ArticleLayout) | Worker code change → `wrangler deploy` in CI | ~1–2 min | **Yes** | Yes (full purge per hostname) |
| 8 | New page type added | Worker code change + KV schema additions | ~1–2 min | **Yes** | Yes |
| 9 | New site added | KV write only (`site:<hostname>` + `site-config:<siteId>` + articles). DNS/Worker route added | ~30s + DNS | No | N/A (nothing cached yet) |
| 10 | Article content edit | CI rewrites `article:<siteId>:<slug>` | ~30s | No | Yes (just that article's URL) |
| 11 | Org-level / group-level config flip | CI detects affected sites, syncs each `site-config:` in parallel | ~30s | No | Depends — shell change purges; island-only doesn't |
| 12 | Force "rebuild" from dashboard | Becomes a cache purge call to the Cloudflare API | ~5s | No | Yes (manual purge) |

---

## What I want verified

I want Claude Code to walk through each scenario below **end-to-end against the actual codebase**, and for each one fill in the answers section with what really happens, what really gets written, and how long it really takes.

For each scenario, the answer must include:

1. **Trigger** — what user action / CI event kicks this off
2. **What CI does** — exact files/scripts run, exact KV keys written (key name + shape of value)
3. **What the Worker does at request time** — which routes, which KV reads, which Server Islands hydrate
4. **HTML shell purge** — yes/no, which URLs, which mechanism (Cloudflare API call from where)
5. **Worker rebuild** — yes/no (and if yes: what triggers `wrangler deploy`)
6. **Time-to-live** — realistic estimate based on the actual pipeline (KV sync + cache propagation + DNS where relevant)
7. **Confirmation that this matches the model in the table above** — or, if it doesn't, flag the discrepancy clearly

---

## Scenarios to verify

### Scenario 1 — Creating a new site

Walk through the full flow when a new site is added to the network.

- Where is the site declared? (`network.json`? a per-site `site.config.json`? a CLI command? dashboard action?)
- What KV keys get written? Expected: `site:<hostname>`, `site-config:<siteId>`, plus any seed articles.
- DNS / Worker route — what gets configured, by what? (Cloudflare API from CI? manual?)
- Is there a Worker rebuild? (Should be no — adding a site is data only.)
- Time to first successful request on the new hostname?
- Anything cached? (Should be N/A on a brand-new site.)

Map this against table row #9.

---

### Scenario 2 — Inserting new articles

Walk through the flow when one or more new articles are published (e.g. via the content pipeline: RSS → LLM rewrite → markdown → commit).

- Which CI step writes which KV keys? Expected: `article:<siteId>:<slug>` (per article) + updated `article-index:<siteId>`.
- What in the HTML shell needs to reflect the new article? Homepage links? Category listings? Sitemap?
- Which exact URLs get purged from the edge cache, and what makes the purge call?
- Time-to-live: from CI merge to article visible on the live site.

Map this against table row #1.

---

### Scenario 3 — Connecting monetization (ads) to a site

Walk through the flow when ads are first wired up on a site (or an ad script / SDK is swapped — e.g. switching ad networks, updating the loader).

- Where does the ad config live? (`site-config:<siteId>` under a `monetization` block? a separate KV key?)
- Which Server Island reads it at request time (`AdSlot`? something else)?
- Confirm: **no HTML shell purge** is needed because ads render in `<AdSlot server:defer />`, outside the cached shell.
- Confirm: **no Worker rebuild**.
- Time-to-live: ~30s after merge.

Map this against table rows #2 and #3.

---

### Scenario 4 — Changing monetization on a single site

Walk through the flow when monetization rules change on one specific site (e.g. enabling sticky-bottom on article pages, adjusting CPM floor, reordering network priority).

- Which exact field in `site-config:<siteId>` is modified?
- What does CI do? (Should be a single KV write to that one key.)
- Confirm: no shell purge, no Worker rebuild.
- Time-to-live: ~30s.

Map this against table row #4.

---

### Scenario 5 — Changing monetization for a group (2 sites)

**Assumption to verify:** "group" means a set of sites that share a common config layer (e.g. a `group.yaml` or `org.yaml` that multiple sites inherit from).

Walk through the flow when a monetization change is made at the group level for a group containing 2 sites.

- Where is the group config defined? Does it live in the repo (e.g. `groups/<group-name>/config.yaml`) or in KV?
- How does CI detect which sites are affected? (Expected: a script like `detect-changed-sites.ts` resolves the group → list of siteIds.)
- Does CI write 2 separate KV keys (`site-config:<siteId-1>`, `site-config:<siteId-2>`), or 1 group-level key that the Worker reads alongside the site key?
- If it's 2 writes: are they in parallel? What's the realistic wall-clock time?
- Confirm: no shell purge (monetization is island-only), no Worker rebuild.
- Time-to-live: ~30s for both sites.

Map this against table row #11 (specifically the "island-only change" branch — no purge needed).

**If "group" doesn't exist as a concept in the codebase** — flag this clearly and propose the closest equivalent (e.g. just a list of sites tagged together).

---

### Scenario 6 — Changing monetization via an override (3 sites)

**Assumption to verify:** "override" means a per-site override of an org/group default — i.e. the org sets a baseline monetization config, and 3 sites have a site-level override that changes specific fields.

Walk through the flow when the override layer changes for 3 sites.

- Where do overrides live? (Per-site `site.config.json`? A dedicated overrides key in KV? Merged at CI time or at request time?)
- If override is changed at the org level (e.g. the org changes a default that 3 sites override) — what gets re-synced? Just the 3 overriding sites? All sites?
- If override is changed at the site level (e.g. one of the 3 sites edits its override) — confirm only that site's `site-config:<siteId>` is rewritten.
- For the 3-site case: are writes parallelized? Wall-clock time?
- Confirm: no shell purge, no Worker rebuild.
- Time-to-live: ~30s.

Map this against table row #11.

**If "override" is implemented differently from this assumption** — describe the actual mechanism and flag the difference.

---

## Output format I expect from Claude Code

For each of the 6 scenarios above, produce a section in your response file with this structure:

```markdown
## Scenario N — <title>

### What actually happens (step by step)
1. <step>
2. <step>
...

### KV keys written
- `<key-pattern>` — <shape of value> — written by `<file/script>`
- ...

### HTML shell purge
- Required: yes / no
- URLs purged: <list, or "n/a">
- Purge mechanism: <where the Cloudflare API call lives, or "n/a">

### Worker rebuild
- Required: yes / no
- Trigger: <what would cause a rebuild, or "n/a">

### Time-to-live (realistic)
- KV sync: ~Xs
- Cache propagation: ~Xs
- DNS (if applicable): ~Xs
- **Total: ~Xs**

### Matches the model in the table?
- ✅ Matches row #N
- ⚠️ Discrepancy: <description, if any>

### Open questions / assumptions
- <anything that wasn't clear from the codebase>
```

---

## Ground rules for Claude Code

1. **Read the actual code.** Don't infer from the table alone. Open `network.json`, the per-site configs, the CI workflow files, `detect-changed-sites.ts`, the Worker entry, the `AdSlot` and `PixelLoader` islands, and the KV write scripts. The table is the model — your job is to verify whether the code matches it.
2. **If the table is wrong, say so.** This spec exists to find drift between the mental model and reality. Discrepancies are the most valuable output.
3. **Concrete file paths and line numbers.** When you say "CI writes the KV key here," cite the exact file and line.
4. **Realistic time estimates.** "~30s" is the model claim. If the actual KV write step in CI takes 2 minutes because of a slow build before it, say so.
5. **Group and override are assumptions.** If the codebase doesn't have those concepts under those names, find the closest equivalent and document it. Don't invent a feature that doesn't exist.
6. **Follow `dev-audit-trail`.** This is a verification/investigation session — log it under `docs/audit-logs/` with session type "Investigation."

---

## Deliverable

A markdown file at `docs/audit-logs/<timestamp>-worker-kv-flow-verification.md` (per `dev-audit-trail`) containing:

- The 6 scenario sections in the format above
- A summary table at the bottom showing, per scenario: ✅ matches model / ⚠️ discrepancy / ❌ broken
- A "discrepancies & follow-ups" section listing anything that should be fixed in the model, the code, or the docs
- A session summary in `docs/sessions/` per the skill
