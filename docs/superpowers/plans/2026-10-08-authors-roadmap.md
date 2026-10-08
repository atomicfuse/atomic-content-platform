# Authors — Roadmap (4 independently shippable stages)

**Spec:** `docs/superpowers/specs/2026-10-08-authors-design.md` (approved 2026-10-08).
Each stage gets its own detailed plan (TDD steps with code) written when the previous stage is merged, so it can build on the exact interfaces that shipped. Stage 1 is written: `2026-10-08-authors-stage1-logos.md`.

Facts gathered for all stages (2026-10-08 code map): `/api/generate-logo` is unused (logos come from `actions/wizard.ts`); dashboard has no `openai` dep; the worker article page is `src/pages/[slug]/index.astro` (no ArticleLayout); `ArticleHero.astro` renders the byline; `SEOHead.astro` has no custom JSON-LD prop; the category page uses numbered pagination (load-more exists only on the homepage, hard-coded to `/api/articles`); seed-time config defaults live in `scripts/seed-kv.ts` lines 625–659; `ResolvedConfig` has no author field; the dedicated agent has no per-article topic; topic rotation pattern is `src/stats/topic-rotation.ts`; cost recorders need a `siteDomain`; `gpt-image-*` prices are missing from `src/costs/pricing.ts`.

## Stage 1 — Logos (D9) · dashboard only · ships alone
OpenAI `gpt-image-2.5-sunburst` for site logos with Gemini fallback. Plan: `2026-10-08-authors-stage1-logos.md`.

## Stage 2 — Author data, sync and site pages · shared-types + site-worker + network workflow
Ships with zero visible change until a site has `authors` and an `author:<id>` key exists.
1. Types: `AuthorProfile`, `SiteAuthorAssignment` in shared-types; `ResolvedConfig.authors`; `ArticleIndexEntry.author_id?`.
2. KV: `authorKey(id)`; `site-config.authors` runtime default (`lib/config.ts` `??=`) + seed default (`seed-kv.ts`); `author_id` read into the article index.
3. `scripts/seed-authors.ts` (+ `lib/authors.ts` parse/validate) writing `author:<id>` to prod + staging; `sync-authors.yml` for the network repo (push needs approval).
4. Pure helpers: `resolveByline(articleAuthorName, authorId, siteAuthors, profiles)`, `authorPageModel(...)` incl. `noindex` (< 3 articles).
5. Pages/components: `src/pages/author/[id].astro` (404 unless assigned), byline link in `ArticleHero`, `AboutAuthor.astro` after the body, `SEOHead` gains a `jsonLd?` prop (ProfilePage/Person) and author `url`; load-more parameterised (`LoadMoreButton` endpoint + container props) with `GET /api/author-articles`.
6. Reserved: `author` article slug guard (pipeline `resolveUniqueSlug`) and `authors` site id (wizard clash check).

## Stage 3 — Library, generation and the Authors screens · pipeline + dashboard
1. Pipeline `POST /authors/generate` `{ part, authorId?, siteContext? }` (text via provider chain with bio validator; portrait via `gpt-image-2.5-flare` → WebP 512 → R2 `authors/assets/<id>-<hash>.webp`); add `gpt-image-2.5-flare/-sunburst` to `pricing.ts`; costs recorded under the context site or `authors`.
2. Dashboard data: `authors` Mongo collection + `lib/db/authors.ts` (dual-write); API `GET/POST /api/authors`, `GET/PUT/DELETE /api/authors/[id]`, portrait upload, generate proxy (`getAgentUrl` fallback), "connected sites" via `site_configs` `authors.id`.
3. UI per spec §Dashboard UI: Sidebar item; `/authors` card grid (search, single-select filter chips in the URL, skeletons, empty states, "Generate missing profiles (N)" with progress toast); `/authors/[id]` profile (sticky identity column, per-section regenerate → unsaved, sticky save bar, leave guard, delete confirm naming sites, upload/regenerate/remove portrait). Design: existing tokens/components, refinements listed in the spec; RTL tests incl. badge text not colour-only.
4. Guide page `public/guide/authors.md` registered in `GUIDE_PAGES`.

## Stage 4 — Assignment, pipeline bylines and migration
1. `lib/author-assignment.ts` (shared semantics, tested): topic distribution on save, exclusive guard, auto-pick tiers (AI ranker + keyword fallback) incl. create-new.
2. Content Agent tab: Authors section replacing "Default Author" (`ChipMultiSelect` topics, Add-author popover with fit hint + exclusive confirm, Pick for me preview); `/api/sites/save` + `StagingSiteConfig` gain `authors`; wizard assigns 2 via auto-pick (replaces `generateAuthorName`).
3. Pipeline: `SiteBriefData.authors`; article author by topic (`topicsArray[0]`) else rotation (`site_stats.authorRotation`, pattern from `topic-rotation.ts`); dedicated agent uses `brief.topics` mapping; frontmatter `author_id`.
4. Migration script (idempotent; dry-run first): authors from `site.yaml author` + article frontmatter on main + staging → `authors/<id>.yaml` (Ella → exclusive scoopella) + per-site `authors:`; then seed-authors, re-seed sites, Generate missing profiles.

## Order & gates
Stage 1 → merge/plug. Stage 2 → worker staging → prod deploy → network workflow push. Stage 3 → merge/plug. Stage 4 → merge/plug → migration (review dry-run output first). Each stage: local test + Asaf's approval before commit (standing rule).
