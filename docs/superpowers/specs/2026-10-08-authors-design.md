# Authors — library, site assignment, author pages — design

**Status:** design approved in session 2026-10-08 (Asaf); this spec awaits review.
**Scope:** regular (modern) sites. Grid sites credit source sites and show no authors — unchanged.

## Goal
Give every site a credible, human-feeling editorial team: a network-wide **author library** managed in the dashboard,
authors **assigned per site** (with topics), **author pages** on the sites, bylines that link to them, and
**AI generation** of complete profiles — while existing articles and sites keep working untouched until re-synced.

## Decisions (from the brainstorm)
| # | Decision |
|---|----------|
| D1 | A new top-level **Authors** screen (next to Groups): list, create, edit, delete; each author's full profile and the sites they're connected to. |
| D2 | **Exclusive authors:** `exclusive_sites` list. The system never auto-picks an author whose list is non-empty. A human may assign them anywhere — that site joins their exclusive list (with a confirm). |
| D3 | A site has **one or more authors**, each optionally assigned **topics**. Topics left unassigned are split randomly among the site's authors **when the assignment is saved** (persisted, so bylines are stable). |
| D4 | No authors chosen → the system picks **2**: best beat match among non-exclusive authors → else the **closest** match → only if nothing is even close, it **creates a new author with AI**. |
| D5 | Each author on a site gets **their own author page** on that site; bylines link to it; an **"About the author"** box ends each article. |
| D6 | **AI generation:** "Generate everything" in one click **and** a separate regenerate per part (portrait, bio, tagline, beats). |
| D7 | **Migration:** every existing author name becomes a library author linked to its site(s), **non-exclusive — except Ella Hughes, exclusive to scoopella**. |
| D8 | **Portraits:** OpenAI **`gpt-image-2.5-flare`**, one consistent **illustrated editorial style — not photorealistic** (agreed: no fabricated photographs of people who don't exist). Uploading a real photo is always possible; initials are the fallback. Bios are warm and human about the author's beat, with **no invented credentials, degrees or employers**. |
| D9 | **Logos** (separate small part): wizard + "Generate logo" switch from Gemini to OpenAI **`gpt-image-2.5-sunburst`** (precision tier), Gemini kept as fallback. |

Model ids verified against the account's `/v1/models` on 2026-10-08: `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst` (dated variants `…-2026-09-08`).

## Data model

### Author record — network repo `main`, `authors/<id>.yaml` (source of truth) + Mongo `authors` mirror
```yaml
id: ella-hughes                 # slug, unique, immutable
name: Ella Hughes
tagline: Celebrity & royals writer
bio: |                          # 60–120 words, human voice, no invented credentials
  …
beats: [Celebrities, Royals, Reality TV]
portrait:                       # absent → initials
  kind: generated | uploaded
  path: /authors/assets/ella-hughes-<hash>.webp   # content-hashed name → no stale caches
links: { website?: , x?: , instagram?: , linkedin?: }
exclusive_sites: [scoopella]    # empty/absent = may be auto-picked
created_at / updated_at
```
- Every dashboard write follows the dual-write rule: commit `authors/<id>.yaml` to `main` → upsert Mongo `authors` → revalidate.
- Portraits live in R2 `authors/assets/<id>-<hash>.webp`, served by the existing `/<siteId>/assets/*` route. **`authors` becomes a reserved site id** (like `aggregator`); the wizard rejects it.

### Site → authors — `site.yaml` (staging-branch flow, like all site config)
```yaml
authors:
  - id: ella-hughes
    topics: [Celebrities, Royals]
  - id: ben-foster
    topics: [Fashion, Beauty]
```
- The legacy `author:` field stays (read-only fallback) until a site has `authors`.
- **Connected sites** for an author = Mongo `site_configs` whose `authors[].id` contains it (no duplicate list to keep in sync).

### KV (site worker)
- `site-config:<site>` gains `authors: [{ id, topics }]` — KV schema evolution: runtime default `[]` (`??=` in `lib/config.ts`), seed-time default in `resolve.ts`, then re-seed.
- New key family **`author:<id>`** → public profile (name, tagline, bio, beats, portrait, links). Written to prod + staging namespaces **only** by `scripts/seed-authors.ts`, run by a new network-repo workflow `sync-authors.yml` on `authors/**` pushes (and by the migration). Editing a profile therefore re-syncs one small key, never every site.
- The worker treats a missing `author:<id>` as "no profile" → plain-text byline, no page (fail-soft; never 404s an article).

## Behaviour

### Assignment (dashboard + pipeline share `lib/author-assignment.ts` semantics)
1. **Manual:** pick authors; optionally topics per author. On save, unassigned topics are distributed randomly (round-robin over a shuffled author list) and persisted.
2. **Exclusive guard:** adding an author whose `exclusive_sites` doesn't include this site → confirm dialog ("Ella Hughes is exclusive to scoopella. Assigning her here makes her exclusive to this site too.") → on confirm the site is appended to her list.
3. **Auto-pick (D4)** — runs in the wizard for new sites, and on demand ("Pick for me") for a site with none:
   - Candidates: authors with empty `exclusive_sites`, not already on the site.
   - An AI ranker scores each candidate's beats against the site's category, topics and theme: `strong | close | none` (deterministic keyword-overlap fallback if the AI is unavailable).
   - Fill 2 slots from `strong`, then `close`; each remaining slot → **create a new author with AI** for this site (full profile + portrait), added to the library.
   - Never assigns the same author twice; never picks exclusive authors.

### Article author (pipeline)
- New article → the site author whose `topics` contain the article's topic; none → rotate among the site's authors (`site_stats` counter, like topic rotation); site without `authors` → legacy `author`.
- Frontmatter: `author: <name>` (unchanged format) **plus** `author_id: <id>` (new, optional). Existing articles keep their names; bylines resolve name → author by case-insensitive match against the site's authors.

### Site pages (modern template)
- **`/author/<id>`** — exists only for authors assigned to the site (else 404):
  portrait (or initials), name, tagline, bio, beats as links to topic pages, links; the author's articles on that site, newest first, same cards + load-more as category pages. `ProfilePage` + `Person` JSON-LD; canonical; `noindex` while the author has fewer than 3 published articles on the site (avoids thin pages).
- **Byline** `By Ella Hughes` → link to `/author/ella-hughes`. Author JSON-LD on articles gains `url`.
- **About the author** box after the article body: portrait, name, tagline, two-line bio, "More from Ella →".
- Reserved slug: `author` (no article may use it — same rule as `grid`).

## AI generation (content pipeline endpoints, called from the dashboard)
| Part | How |
|---|---|
| name | provider chain (`lib/ai.ts`); unique across the library (re-ask on collision) |
| tagline, bio, beats | provider chain; inputs: site category, topics, theme, tone, content guidelines (so a persona like scoopella's "Ella" stays consistent); bio rules: 60–120 words, first or third person per site tone, no fabricated credentials/employers/awards, no claims of real-world events in the author's life |
| portrait | `gpt-image-2.5-flare`, 1024×1024, house style prompt (illustrated editorial portrait, soft painterly shading, neutral studio background, shoulders-up, varied but plausible looks; not a photograph), → WebP 512px → R2 |
| everything | runs the four in order; each part reports its own status |
- Endpoints: `POST /authors/generate` `{ part: all|name|tagline|bio|beats|portrait, authorId?, siteContext? }` → returns the generated values **without saving**; the dashboard shows them as unsaved changes (D6), the user saves.
- Costs recorded like other AI usage (`recordTextUsage` / image usage with the returned model).

## Dashboard UI

Design direction: **the existing system's language, executed carefully** — same tokens (`--bg-surface`, `--bg-elevated`, `--border-primary`, `text-cyan` accent, `Button`/`Badge`/`Modal`/`Toast`), Heroicons-style 1.5-stroke outline icons, light + dark. Refinements applied from the design skills: calm raised surfaces with hairline borders and a soft tinted shadow on hover, consistent radius scale (cards `rounded-xl`, chips/pills `rounded-full`, portraits `rounded-2xl`), small uppercase eyebrow labels above section titles, one primary action per view, 150–250 ms transitions on `transform`/`opacity` with `cubic-bezier(0.32,0.72,0,1)` and `prefers-reduced-motion` respected, skeletons instead of spinners for anything over 300 ms, 44 px minimum targets for primary controls, visible focus rings, icon-only buttons always labelled. Marketing-scale whitespace, glass effects and decorative motion are deliberately **not** used — this is a work tool.

### 1. Authors list — `/authors` (sidebar item "Authors", after Groups)
```
AUTHORS (eyebrow)
Authors · 57                                   [ Generate missing profiles (41) ]  [ + New author ]
[ Search authors…            ]  ( All ) ( Exclusive ) ( Not on any site ) ( Incomplete profile )   Sort: Recently updated ▾
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│ ◖portrait◗  Ella Hughes   🔒│ │ ◖EH◗ Andrew Bell        │ │ …                    │ │ …                    │
│ Celebrity & royals writer │ │ Pop culture & TV       │ │                      │ │                      │
│ (Celebrities)(Royals)(+1) │ │ (TV)(Movies)           │ │                      │ │                      │
│ ─────────────────────── │ │ ─────────────────────  │ │                      │ │                      │
│ 1 site · scoopella        │ │ 2 sites · popstorylab… │ │ ● Incomplete profile │ │                      │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘ └──────────────────────┘
```
- Responsive card grid (1 / 2 / 3 / 4 columns); the whole card is one link to the profile; hover lifts 1 px.
- Exclusive = lock icon **with** the text "Exclusive" in the badge (never colour alone). "Incomplete profile" = amber dot + text when bio or portrait is missing.
- Filters are single-select chips; search matches name, tagline, beats and site names; state kept in the URL (back button restores it).
- **New author** opens a small modal: *Generate with AI* (optional context: pick a site or type a beat) or *Start blank* → lands on the new profile with generated values as unsaved changes.
- **Generate missing profiles (N)** → confirm modal listing the N authors → runs in the background with a progress toast; cards fill in as they complete.
- Empty / no-results states with a clear next action; skeleton cards while loading.

### 2. Author profile — `/authors/<id>`
```
← Authors
┌────────────────────────────┐   ABOUT                                   [✦ Regenerate]
│  [   portrait 160px   ]    │   Bio  ┌──────────────────────────────────────────┐
│  [✦ Regenerate] [Upload]   │        │ …                                         │ 96 words
│  [Remove]                  │        └──────────────────────────────────────────┘
│                            │   Tagline [ Celebrity & royals writer ]  [✦]
│  Ella Hughes   [edit]      │
│  ella-hughes               │   BEATS                                   [✦ Regenerate]
│  🔒 Exclusive · scoopella  │   (Celebrities ×)(Royals ×)(Reality TV ×) [+ Add]
│                            │
│  [✦ Generate everything]   │   LINKS  Website [   ]  X [   ]  Instagram [   ]
└────────────────────────────┘
                                 SITES
                                 scoopella   Celebrities, Royals         [Open site]
                                 Exclusive to: (scoopella ×) [+ Add site]

                                 DANGER ZONE   [Delete author]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Unsaved changes · bio, portrait                                  [Discard]  [Save author]
```
- Desktop: left identity column is sticky; right column holds sections as separate cards. Mobile: one column, identity first.
- Every regenerate is **local to its section**: that section shows a skeleton while generating, then the new value appears as an unsaved change with a "Undo" link; nothing is saved until **Save author**. "Generate everything" shows a per-part checklist (✓ name ✓ tagline … ⟳ portrait).
- Portrait: Regenerate / Upload (drag-and-drop or picker; cropped square; WebP) / Remove (→ initials). The generated image previews before saving.
- Sticky save bar appears only when dirty; leaving with unsaved changes asks first.
- Delete: confirm modal naming the sites using the author ("Their N articles keep the name as plain text"). Destructive styling, separated at the bottom.

### 3. Site → Content Agent tab → **Authors** section (replaces "Default Author")
```
AUTHORS                                                         [Pick for me]  [+ Add author]
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ ◖EH◗ Ella Hughes · Celebrity & royals writer      Topics: (Celebrities ×)(Royals ×)[+]  [Remove] │
│ ◖BF◗ Ben Foster · Fashion & beauty                 Topics: (Fashion ×)(Beauty ×)[+]      [Remove] │
└─────────────────────────────────────────────────────────────────────────────────────┘
ⓘ "Reality TV" isn't assigned — on save it goes to one of these authors at random.
```
- **Add author** = searchable popover listing library authors with a fit hint ("Good fit · Celebrities") and the exclusive badge; choosing an exclusive author opens the D2 confirm.
- Topic chips use the existing `ChipMultiSelect` (site topics as options).
- **Pick for me** runs D4 and shows the result as unsaved changes before saving (new AI authors are created only on save).
- Saves through the existing site-config save (dual-write).

## Migration (one-off script, idempotent)
1. Collect author names per site from `site.yaml` `author` + article frontmatter on `main` and `staging/<site>`.
2. Create `authors/<id>.yaml` per distinct name (non-exclusive; `ella-hughes` → `exclusive_sites: [scoopella]`). A name used on several sites → one author connected to all of them.
3. Write each site's `authors:` (all its names; topics distributed per D3) on its staging branch; `author:` left in place.
4. Run `seed-authors` + re-seed sites; then **Generate missing profiles** from the UI (or the script's `--generate`).

## Logos (D9)
- `api/generate-logo` and the wizard's logo step call OpenAI Images (`gpt-image-2.5-sunburst`, transparent background, square) with the existing prompt intent; on failure fall back to the current Gemini model. Output path/format unchanged.

## Error handling
| Situation | Behaviour |
|---|---|
| AI text/image generation fails | Section shows the error with Retry; other sections unaffected; nothing saved |
| `author:<id>` missing in KV | Plain-text byline, no About box, `/author/<id>` 404 |
| Author deleted while assigned | Removed from sites' `authors`; articles keep the plain-text name |
| Exclusive conflict on manual add | Confirm dialog (D2); cancel leaves everything unchanged |
| Auto-pick can't reach the AI ranker | Keyword-overlap fallback; still never picks exclusive authors |

## Testing
- Unit: assignment (topic distribution, exclusive guard, auto-pick tiers incl. create-new), article author selection, name→author byline resolution, bio validator (no credential claims), portrait pipeline (WebP, hashed path), seed-authors key writing, KV runtime defaults.
- Dashboard RTL: list filters/search/URL state, card badges (text not colour-only), profile per-section regenerate → unsaved → save/discard, unsaved-changes guard, exclusive confirm, Pick for me preview.
- Worker: author page 200/404 matrix, byline link, About box, noindex threshold, JSON-LD; non-author sites byte-identical until `authors` is set.
- End-to-end on staging with scoopella (Ella exclusive) + one other site; results under `docs/test-results/`.

## Rollout
1. Worker (defaults, author routes) → staging → production; reserve `author` slug and `authors` site id.
2. Pipeline + dashboard via merge + `grid plug`; `sync-authors.yml` pushed to the network repo (needs approval).
3. Migration script → `seed-authors` → re-seed sites → Generate missing profiles.
4. Logos switch ships with step 2.

## Out of scope
Grid-site authors, author analytics, per-author social posting, translating bios.
