# Article Author — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable per-site author name that is assigned randomly at site creation, editable in the dashboard, used by the content pipeline when generating articles, and rendered as a byline on article pages.

**Architecture:** New `author` field on `SiteConfig` (shared-types). Wizard assigns a random name from a curated list. Dashboard Identity tab exposes it for editing. Content pipeline reads it from site config instead of hardcoding "Editorial Team". Site-worker `ArticleHero` renders "By {author}" above the date. One-time backfill script assigns random names to all existing sites.

**Tech Stack:** TypeScript, Next.js 15, Astro 6, pnpm monorepo, YAML configs.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/shared-types/src/config.ts` | Modify | Add `author?: string` to `SiteConfig` |
| `services/dashboard/src/lib/author-names.ts` | Create | Random author name generator utility |
| `services/dashboard/src/actions/wizard.ts` | Modify | Add `author` to `StagingSiteConfig`, wizard site creation, save handler |
| `services/dashboard/src/app/api/sites/save/route.ts` | Modify | Handle `author` field in config updates |
| `services/dashboard/src/components/site-detail/ContentAgentTab.tsx` | Modify | Add "Default Author" input to Identity tab |
| `services/content-pipeline/src/lib/site-brief.ts` | Modify | Return `author` from `SiteBriefData` |
| `services/content-pipeline/src/agents/content-generation/agent.ts` | Modify | Use site author instead of hardcoded "Editorial Team" |
| `packages/site-worker/src/themes/modern/components/ArticleHero.astro` | Modify | Render author byline |
| `scripts/backfill-authors.ts` | Create | One-time script to assign random authors to existing sites |

---

### Task 1: Add `author` to SiteConfig type

**Files:**
- Modify: `packages/shared-types/src/config.ts:501-574`

- [ ] **Step 1: Add `author` field to `SiteConfig` interface**

In `packages/shared-types/src/config.ts`, add after line 509 (`site_tagline`):

```typescript
  /** Default author name for generated articles. */
  author?: string;
```

The full block around the insertion point:

```typescript
  /** Optional tagline shown in headers / meta tags. */
  site_tagline?: string | null;

  /** Default author name for generated articles. */
  author?: string;

  /**
   * @deprecated Legacy single-group field. Use `groups` array instead.
```

- [ ] **Step 2: Rebuild shared-types**

Run:
```bash
cd packages/shared-types && pnpm build
```

Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/config.ts packages/shared-types/dist/
git commit -m "feat(shared-types): add author field to SiteConfig

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Random author name generator

**Files:**
- Create: `services/dashboard/src/lib/author-names.ts`

- [ ] **Step 1: Create the utility**

Create `services/dashboard/src/lib/author-names.ts`:

```typescript
/**
 * Curated name lists for generating realistic author pen names.
 * ~30 first names x ~30 last names = ~900 unique combinations.
 */
const FIRST_NAMES = [
  "James", "Sarah", "Michael", "Elena", "David",
  "Olivia", "Daniel", "Sophia", "Andrew", "Maya",
  "Nathan", "Rachel", "Marcus", "Ava", "Ethan",
  "Lily", "Ryan", "Chloe", "Lucas", "Emma",
  "Alex", "Zoe", "Ben", "Mia", "Sam",
  "Julia", "Leo", "Hannah", "Max", "Nora",
];

const LAST_NAMES = [
  "Mitchell", "Carter", "Rodriguez", "Chen", "Bennett",
  "Brooks", "Sullivan", "Kim", "Parker", "Hayes",
  "Foster", "Reed", "Morgan", "Torres", "Cooper",
  "Bell", "Ward", "Rivera", "Gray", "Scott",
  "Adams", "Murphy", "Price", "Ross", "Perry",
  "Powell", "Long", "Hughes", "Sanders", "West",
];

export function generateAuthorName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/lib/author-names.ts
git commit -m "feat(dashboard): add random author name generator

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Wire author into wizard, save route, and dashboard UI

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts:188-240` (wizard creation), `:993-1032` (StagingSiteConfig interface), `:1048-1080` (readStagingConfig)
- Modify: `services/dashboard/src/app/api/sites/save/route.ts:66-177`
- Modify: `services/dashboard/src/components/site-detail/ContentAgentTab.tsx:71-93` (state), `:364-395` (saveIdentity), `:459-464` (identityDirty), `:481-530` (identity JSX)

- [ ] **Step 1: Add `author` to `StagingSiteConfig` interface**

In `services/dashboard/src/actions/wizard.ts`, add after line 995 (`siteTagline: string;`):

```typescript
  author?: string;
```

- [ ] **Step 2: Add `author` to wizard site creation**

In `services/dashboard/src/actions/wizard.ts`, add the import at the top (after existing imports around line 39):

```typescript
import { generateAuthorName } from "@/lib/author-names";
```

In the `siteConfig` object (around line 188-191), add `author` after `site_tagline`:

Replace:
```typescript
  const siteConfig = {
    domain: projectName,
    site_name: data.siteName,
    site_tagline: data.siteTagline || null,
    groups: data.groups.length > 0 ? data.groups : ["mock-ads"],
```

With:
```typescript
  const siteConfig = {
    domain: projectName,
    site_name: data.siteName,
    site_tagline: data.siteTagline || null,
    author: generateAuthorName(),
    groups: data.groups.length > 0 ? data.groups : ["mock-ads"],
```

- [ ] **Step 3: Add `author` to `readStagingConfig` return**

In `services/dashboard/src/actions/wizard.ts`, in the `readStagingConfig` function return object (around line 1048-1050), add `author`:

Replace:
```typescript
  return {
    siteName: (config.site_name as string) ?? "",
    siteTagline: (config.site_tagline as string) ?? "",
```

With:
```typescript
  return {
    siteName: (config.site_name as string) ?? "",
    siteTagline: (config.site_tagline as string) ?? "",
    author: (config.author as string) ?? "",
```

- [ ] **Step 4: Handle `author` in save route**

In `services/dashboard/src/app/api/sites/save/route.ts`, add after the `siteTagline` handling (after line 68):

```typescript
      if (configUpdates.author !== undefined) {
        existing.author = configUpdates.author || undefined;
      }
```

The block should read:
```typescript
      if (configUpdates.siteName !== undefined) existing.site_name = configUpdates.siteName;
      if (configUpdates.siteTagline !== undefined) existing.site_tagline = configUpdates.siteTagline || null;
      if (configUpdates.author !== undefined) {
        existing.author = configUpdates.author || undefined;
      }
```

- [ ] **Step 5: Add author state and UI to ContentAgentTab Identity tab**

In `services/dashboard/src/components/site-detail/ContentAgentTab.tsx`:

**5a. Add state** (after line 84, `const [siteTagline, setSiteTagline] = ...`):

```typescript
  const initAuthor = (siteConfig?.author as string) ?? "";
  const [author, setAuthor] = useState(initAuthor);
```

**5b. Add `author` to `saveIdentity` configUpdates** (line 377):

Replace:
```typescript
          configUpdates: { siteName, siteTagline, audiences, audienceIds, tone },
```

With:
```typescript
          configUpdates: { siteName, siteTagline, author, audiences, audienceIds, tone },
```

**5c. Add `author` to `identityDirty` check** (line 459-464):

Replace:
```typescript
  const identityDirty =
    siteName !== initSiteName ||
    siteTagline !== initSiteTagline ||
    tone !== initTone ||
    JSON.stringify(audienceIds) !== JSON.stringify(initAudienceIds) ||
    !!pendingLogo ||
```

With:
```typescript
  const identityDirty =
    siteName !== initSiteName ||
    siteTagline !== initSiteTagline ||
    author !== initAuthor ||
    tone !== initTone ||
    JSON.stringify(audienceIds) !== JSON.stringify(initAudienceIds) ||
    !!pendingLogo ||
```

**5d. Add Input field** in the identity JSX (after line 485, the Tagline input):

After:
```tsx
        <Input label="Tagline" value={siteTagline} onChange={(e): void => setSiteTagline(e.target.value)} />
```

Add:
```tsx
        <Input label="Default Author" value={author} onChange={(e): void => setAuthor(e.target.value)} placeholder="e.g. Sarah Mitchell" />
```

- [ ] **Step 6: Verify dashboard compiles**

Run:
```bash
cd services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add services/dashboard/src/actions/wizard.ts services/dashboard/src/app/api/sites/save/route.ts services/dashboard/src/components/site-detail/ContentAgentTab.tsx
git commit -m "feat(dashboard): wire author field into wizard, save route, and Identity tab

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Content pipeline reads author from site config

**Files:**
- Modify: `services/content-pipeline/src/lib/site-brief.ts:13-18` (SiteBriefData), `:42-47` (return)
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts:378-398` (readLocalSiteBrief), `:614` (author assignment), `:675` (destructure)

- [ ] **Step 1: Add `author` to `SiteBriefData` interface**

In `services/content-pipeline/src/lib/site-brief.ts`, add to the `SiteBriefData` interface (line 13-18):

Replace:
```typescript
export interface SiteBriefData {
  domain: string;
  siteName: string;
  group: string;
  brief: SiteBrief;
}
```

With:
```typescript
export interface SiteBriefData {
  domain: string;
  siteName: string;
  author?: string;
  group: string;
  brief: SiteBrief;
}
```

- [ ] **Step 2: Return `author` from `readSiteBrief`**

In the same file, update the return object (line 42-47):

Replace:
```typescript
  return {
    domain: config.domain,
    siteName: config.site_name,
    group: config.group,
    brief,
  };
```

With:
```typescript
  return {
    domain: config.domain,
    siteName: config.site_name,
    author: config.author,
    group: config.group,
    brief,
  };
```

- [ ] **Step 3: Return `author` from `readLocalSiteBrief`**

In `services/content-pipeline/src/agents/content-generation/agent.ts`, update the return object in `readLocalSiteBrief` (line 396-398):

Replace:
```typescript
  return {
    domain: siteConfig.domain,
    siteName: siteConfig.site_name,
```

With:
```typescript
  return {
    domain: siteConfig.domain,
    siteName: siteConfig.site_name,
    author: siteConfig.author,
```

- [ ] **Step 4: Use author in article frontmatter**

In the same file, update `runContentGeneration` (line 675) to destructure `author`:

Replace:
```typescript
    const { siteName, brief } = await getSiteBrief(config, siteDomain, branch);
```

With:
```typescript
    const { siteName, author: siteAuthor, brief } = await getSiteBrief(config, siteDomain, branch);
```

Then update the author assignment in `processItem`. The `processItem` function is defined inside `runContentGeneration` and has access to the outer scope variables. Update line 614:

Replace:
```typescript
      author: "Editorial Team",
```

With:
```typescript
      author: siteAuthor || "Editorial Team",
```

- [ ] **Step 5: Verify content-pipeline compiles**

Run:
```bash
cd services/content-pipeline && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/lib/site-brief.ts services/content-pipeline/src/agents/content-generation/agent.ts
git commit -m "feat(content-pipeline): use site author instead of hardcoded Editorial Team

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Render author byline in ArticleHero

**Files:**
- Modify: `packages/site-worker/src/themes/modern/components/ArticleHero.astro`

- [ ] **Step 1: Update ArticleHero to show author**

Replace the full contents of `packages/site-worker/src/themes/modern/components/ArticleHero.astro`:

```astro
---
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { article: ArticleIndexEntry; }
const { article } = Astro.props;
const date = new Date(article.publishDate).toLocaleDateString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric',
});
---

<section class="article-hero">
  <div class="article-hero-inner">
    <div class="article-hero-text">
      <h1 class="article-hero-title">{article.title}</h1>
      <p class="article-hero-meta">
        {article.author && (
          <>
            <span class="article-hero-author">By {article.author}</span>
            <span class="article-hero-separator">&middot;</span>
          </>
        )}
        <span class="article-hero-date">{date}</span>
      </p>
    </div>
    {article.featuredImage && (
      <div class="article-hero-image-wrap">
        <img src={article.featuredImage} alt="" />
      </div>
    )}
  </div>
</section>

<style>
  .article-hero {
    background: var(--color-primary, #1a1a2e);
    padding: 4rem 1rem;
  }
  .article-hero-inner {
    max-width: var(--container-max, 1200px);
    margin: 0 auto;
    display: grid;
    grid-template-columns: 1fr;
    gap: 2rem;
    align-items: center;
  }
  @media (min-width: 960px) {
    .article-hero-inner { grid-template-columns: 1fr 1fr; }
  }
  .article-hero-title {
    color: var(--color-article_hero_title, #fff);
    font-size: clamp(1.875rem, 3vw, 3rem);
    line-height: 1.15;
    margin: 0 0 1rem;
  }
  .article-hero-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    color: var(--color-accent, #f4c542);
    font-weight: 600;
  }
  .article-hero-separator {
    opacity: 0.6;
  }
  .article-hero-image-wrap img {
    width: 100%; height: auto;
    border-radius: var(--radius-md, 8px);
  }
</style>
```

Key changes from original:
- `<p class="article-hero-date">` replaced with `<p class="article-hero-meta">` containing author + separator + date
- Author only renders if `article.author` is non-empty
- Flexbox layout for the meta line with gap between elements
- Separator dot between author and date
- Removed the old `.article-hero-date` style, replaced with `.article-hero-meta` (same color/weight)

- [ ] **Step 2: Verify site-worker compiles**

Run:
```bash
cd packages/site-worker && pnpm build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/ArticleHero.astro
git commit -m "feat(site-worker): render author byline in ArticleHero

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Backfill existing sites with random author names

**Files:**
- Create: `scripts/backfill-authors.ts`

This is a one-time script. It reads all sites from the network repo, checks each site's `site.yaml` for an `author` field, and assigns a random name if missing.

- [ ] **Step 1: Create the backfill script**

Create `scripts/backfill-authors.ts`:

```typescript
/**
 * One-time backfill: assign random author names to all existing sites
 * that don't have one.
 *
 * Usage:
 *   GITHUB_TOKEN=<token> npx tsx scripts/backfill-authors.ts
 *
 * Reads dashboard-index.yaml, iterates sites with staging branches,
 * reads site.yaml, adds author if missing, commits to staging branch.
 */

import { Octokit } from "@octokit/rest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const REPO_OWNER = "atomicfuse";
const REPO_NAME = "atomic-labs-network";

// Inline name lists (same as services/dashboard/src/lib/author-names.ts)
const FIRST_NAMES = [
  "James", "Sarah", "Michael", "Elena", "David",
  "Olivia", "Daniel", "Sophia", "Andrew", "Maya",
  "Nathan", "Rachel", "Marcus", "Ava", "Ethan",
  "Lily", "Ryan", "Chloe", "Lucas", "Emma",
  "Alex", "Zoe", "Ben", "Mia", "Sam",
  "Julia", "Leo", "Hannah", "Max", "Nora",
];

const LAST_NAMES = [
  "Mitchell", "Carter", "Rodriguez", "Chen", "Bennett",
  "Brooks", "Sullivan", "Kim", "Parker", "Hayes",
  "Foster", "Reed", "Morgan", "Torres", "Cooper",
  "Bell", "Ward", "Rivera", "Gray", "Scott",
  "Adams", "Murphy", "Price", "Ross", "Perry",
  "Powell", "Long", "Hughes", "Sanders", "West",
];

function generateAuthorName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

interface DashboardIndex {
  sites: Array<{
    domain: string;
    status?: string;
    staging_branch?: string | null;
  }>;
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN env var is required");
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });

  // Read dashboard-index.yaml from main
  const indexRes = await octokit.repos.getContent({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    path: "dashboard-index.yaml",
    ref: "main",
  });

  if (!("content" in indexRes.data)) {
    console.error("Could not read dashboard-index.yaml");
    process.exit(1);
  }

  const indexContent = Buffer.from(indexRes.data.content, "base64").toString("utf-8");
  const index = parseYaml(indexContent) as DashboardIndex;

  const sites = index.sites.filter(
    (s) => s.staging_branch && s.status !== "Deleted",
  );

  console.log(`Found ${sites.length} sites with staging branches`);

  let updated = 0;
  let skipped = 0;

  for (const site of sites) {
    const branch = site.staging_branch!;
    const path = `sites/${site.domain}/site.yaml`;

    try {
      const fileRes = await octokit.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path,
        ref: branch,
      });

      if (!("content" in fileRes.data)) {
        console.log(`  [skip] ${site.domain} — not a file`);
        skipped++;
        continue;
      }

      const yaml = Buffer.from(fileRes.data.content, "base64").toString("utf-8");
      const config = parseYaml(yaml) as Record<string, unknown>;

      if (config.author) {
        console.log(`  [skip] ${site.domain} — already has author: ${config.author}`);
        skipped++;
        continue;
      }

      const authorName = generateAuthorName();
      config.author = authorName;

      const updatedYaml = stringifyYaml(config, { lineWidth: 0 });

      await octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path,
        message: `feat: add default author "${authorName}" to ${site.domain}`,
        content: Buffer.from(updatedYaml).toString("base64"),
        sha: fileRes.data.sha,
        branch,
      });

      console.log(`  [done] ${site.domain} — assigned author: ${authorName}`);
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [error] ${site.domain} — ${msg}`);
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the backfill script**

```bash
GITHUB_TOKEN=$(grep GITHUB_TOKEN services/dashboard/.env.local | cut -d= -f2) npx tsx scripts/backfill-authors.ts
```

Expected: each site without an author gets one assigned. Sites with existing authors are skipped.

- [ ] **Step 3: Verify by spot-checking a site**

Pick any site from the output and verify its `site.yaml` on the staging branch now has an `author` field. Use the GitHub API or check the dashboard Identity tab after reloading.

- [ ] **Step 4: Commit the script**

```bash
git add scripts/backfill-authors.ts
git commit -m "feat: add one-time author backfill script for existing sites

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Sync KV and verify end-to-end

This is a manual verification task — no code changes.

- [ ] **Step 1: Trigger KV sync for a test site**

Pick a site that was updated by the backfill. Trigger sync-kv:

```bash
cd packages/site-worker && CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 pnpm seed:kv <domain>
```

- [ ] **Step 2: Verify article has author in KV**

After seeding, the articles in KV should have their `author` field from the markdown frontmatter. Existing articles will still show "Editorial Team" (the per-article value). Newly generated articles going forward will use the site's author name.

- [ ] **Step 3: Preview the site**

Open the staging Worker preview URL for the test site. Navigate to any article. Verify:
- The byline "By Editorial Team" (or whatever the article's author is) appears between the title and date
- The layout looks correct (author · date format, accent color)

- [ ] **Step 4: Test author editing in dashboard**

1. Go to the site's detail page in the dashboard
2. In Site Settings > Identity tab, the "Default Author" field should show the backfilled name
3. Change the author name, click Save Identity
4. Generate a new article via the Content Brief tab
5. The new article's frontmatter should have the updated author name

- [ ] **Step 5: Test new site creation**

1. Create a new site via the wizard
2. After creation, check the Identity tab — it should show a randomly generated author name
3. Generate an article — it should use that author name
