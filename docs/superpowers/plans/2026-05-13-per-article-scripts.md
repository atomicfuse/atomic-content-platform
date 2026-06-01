# Per-Article Script Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow dashboard users to attach custom scripts to individual articles with position control (head, before/after content, after paragraph N), persisted in article frontmatter and rendered by the site-worker.

**Architecture:** Scripts are stored as a `scripts` array in article YAML frontmatter. The dashboard provides an article detail page (`/sites/[domain]/articles/[slug]`) with a scripts management panel. Two API routes handle read/write. The site-worker's `injectArticleScripts()` function splits scripts by position and injects them into the HTML at render time, following the same `</p>`-counting pattern as `injectInlineAds()`. The `seed-kv.ts` script passes the `scripts` field through to KV.

**Tech Stack:** Next.js 15 App Router, Astro 6 SSR, Cloudflare KV, TypeScript strict, `yaml` package.

**Spec:** `docs/superpowers/specs/2026-05-13-per-article-scripts-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Modify:** `packages/shared-types/src/article.ts` | Add `ArticleScript` interface, `ArticleScriptPosition` type, `scripts?` to `ArticleFrontmatter` |
| **Modify:** `packages/site-worker/src/lib/kv-schema.ts` | Add `scripts?` to `ArticleIndexEntry` |
| **Modify:** `packages/site-worker/scripts/seed-kv.ts` | Pass `scripts` through in the `loadArticles` field whitelist |
| **Create:** `packages/site-worker/src/lib/inject-scripts.ts` | `injectArticleScripts()` — partition by position, inject into HTML |
| **Modify:** `packages/site-worker/src/pages/[slug]/index.astro` | Call `injectArticleScripts()`, inject head scripts via slot |
| **Create:** `services/dashboard/src/app/api/articles/[domain]/[slug]/route.ts` | GET — read article from Git, return frontmatter + body |
| **Create:** `services/dashboard/src/app/api/articles/[domain]/[slug]/scripts/route.ts` | PUT — update scripts array in frontmatter, commit to Git |
| **Create:** `services/dashboard/src/app/sites/[domain]/articles/[slug]/page.tsx` | Article detail page (server component) |
| **Create:** `services/dashboard/src/components/site-detail/ArticleScriptsPanel.tsx` | Scripts management UI (client component) |
| **Modify:** `services/dashboard/src/components/site-detail/ContentTab.tsx` | Make article titles clickable links |

---

## Task 1: Shared types — ArticleScript

**Files:**
- Modify: `packages/shared-types/src/article.ts`

- [ ] **Step 1: Add ArticleScript type and extend ArticleFrontmatter**

At the bottom of `packages/shared-types/src/article.ts`, before the closing of the file, add:

```typescript
export type ArticleScriptPosition =
  | "head"
  | "before-content"
  | "after-content"
  | `after-paragraph-${number}`;

export interface ArticleScript {
  id: string;
  name: string;
  position: ArticleScriptPosition;
  content: string;
}
```

Then add `scripts?` to the existing `ArticleFrontmatter` interface. Find:

```typescript
  quality_note?: string;
}
```

Replace with:

```typescript
  quality_note?: string;
  scripts?: ArticleScript[];
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd packages/shared-types && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/article.ts
git commit -m "feat(shared-types): add ArticleScript type and scripts field to ArticleFrontmatter

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: KV schema + seed-kv passthrough

**Files:**
- Modify: `packages/site-worker/src/lib/kv-schema.ts`
- Modify: `packages/site-worker/scripts/seed-kv.ts`

- [ ] **Step 1: Add scripts to ArticleIndexEntry in kv-schema.ts**

In `packages/site-worker/src/lib/kv-schema.ts`, add the import at the top:

```typescript
import type { ArticleScript } from "@atomic-platform/shared-types";
```

Then add `scripts?` to the `ArticleIndexEntry` interface. Find:

```typescript
  featured?: ('hero' | 'must-read')[];
}
```

Replace with:

```typescript
  featured?: ('hero' | 'must-read')[];
  scripts?: ArticleScript[];
}
```

- [ ] **Step 2: Add scripts to the field whitelist in seed-kv.ts**

In `packages/site-worker/scripts/seed-kv.ts`, find the `loadArticles` function. Inside it, locate the `ArticleIndexEntry` construction object (around line 199-210). After the `featured` line:

```typescript
      featured: parseFeatured(front.featured),
```

Add:

```typescript
      scripts: Array.isArray(front.scripts) ? (front.scripts as ArticleScript[]) : undefined,
```

Also add the import at the top of `seed-kv.ts`:

```typescript
import type { ArticleScript } from "@atomic-platform/shared-types";
```

- [ ] **Step 3: Verify typecheck**

Run: `cd packages/site-worker && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/site-worker/src/lib/kv-schema.ts packages/site-worker/scripts/seed-kv.ts
git commit -m "feat(site-worker): add scripts field to KV schema and seed-kv passthrough

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Script injection function for site-worker

**Files:**
- Create: `packages/site-worker/src/lib/inject-scripts.ts`

- [ ] **Step 1: Create inject-scripts.ts**

```typescript
// packages/site-worker/src/lib/inject-scripts.ts
import type { ArticleScript } from "@atomic-platform/shared-types";

export interface ScriptInjectionResult {
  headScripts: string;
  bodyHtml: string;
}

/**
 * Inject article-level scripts into the rendered HTML body.
 *
 * - `head` scripts are returned separately for <head> injection.
 * - `before-content` scripts are prepended to the body.
 * - `after-content` scripts are appended to the body.
 * - `after-paragraph-N` scripts are inserted after the Nth </p> tag (1-indexed).
 *   If N exceeds the paragraph count, the script is appended to the end.
 *
 * Uses the same </p>-counting pattern as injectInlineAds().
 */
export function injectArticleScripts(
  body: string,
  scripts: ArticleScript[] | undefined,
): ScriptInjectionResult {
  if (!scripts || scripts.length === 0) {
    return { headScripts: "", bodyHtml: body };
  }

  const head: string[] = [];
  const before: string[] = [];
  const after: string[] = [];
  const paragraph: Array<{ afterIndex: number; content: string }> = [];

  for (const s of scripts) {
    if (s.position === "head") {
      head.push(s.content);
    } else if (s.position === "before-content") {
      before.push(s.content);
    } else if (s.position === "after-content") {
      after.push(s.content);
    } else {
      const match = /^after-paragraph-(\d+)$/.exec(s.position);
      if (match) {
        const n = Number.parseInt(match[1]!, 10);
        if (Number.isFinite(n) && n > 0) {
          paragraph.push({ afterIndex: n, content: s.content });
        }
      }
    }
  }

  let result = body;

  // Inject paragraph-relative scripts (same algorithm as injectInlineAds)
  if (paragraph.length > 0) {
    const parts = result.split(/(<\/p>)/i);
    let pSeen = 0;
    const out: string[] = [];
    for (const part of parts) {
      out.push(part);
      if (part.toLowerCase() === "</p>") {
        pSeen += 1;
        const matches = paragraph.filter((p) => p.afterIndex === pSeen);
        for (const m of matches) {
          out.push(m.content);
        }
      }
    }
    // Append any paragraph scripts whose index exceeded the count
    const unplaced = paragraph.filter((p) => p.afterIndex > pSeen);
    for (const u of unplaced) {
      out.push(u.content);
    }
    result = out.join("");
  }

  // Prepend before-content, append after-content
  if (before.length > 0) {
    result = before.join("") + result;
  }
  if (after.length > 0) {
    result = result + after.join("");
  }

  return {
    headScripts: head.join("\n"),
    bodyHtml: result,
  };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd packages/site-worker && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/site-worker/src/lib/inject-scripts.ts
git commit -m "feat(site-worker): add injectArticleScripts function for per-article script injection

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Wire script injection into article page

**Files:**
- Modify: `packages/site-worker/src/pages/[slug]/index.astro`

- [ ] **Step 1: Add import and call injectArticleScripts**

In `packages/site-worker/src/pages/[slug]/index.astro`, add the import near the other lib imports (around line 18):

```typescript
import { injectArticleScripts } from '../../lib/inject-scripts';
```

Find the existing `injectInlineAds` call (around line 48-53):

```typescript
const articleBodyWithInlineAds = article
  ? injectInlineAds(
      article.body,
      (config.ads_config?.ad_placements as Array<{ id?: string; position?: string }> | undefined) ?? [],
    )
  : '';
```

Replace with:

```typescript
const articleBodyWithInlineAds = article
  ? injectInlineAds(
      article.body,
      (config.ads_config?.ad_placements as Array<{ id?: string; position?: string }> | undefined) ?? [],
    )
  : '';

const { headScripts: articleHeadScripts, bodyHtml: articleBodyFinal } = article
  ? injectArticleScripts(articleBodyWithInlineAds, article.frontmatter.scripts)
  : { headScripts: '', bodyHtml: articleBodyWithInlineAds };
```

- [ ] **Step 2: Add head scripts Fragment and update body reference**

In the template section, after the existing `<Fragment slot="head">...</Fragment>` block (around line 103-112), add a second head fragment:

Find:

```astro
    <Fragment slot="head">
      <SEOHead
        title={`${article.frontmatter.title} | ${config.site_name}`}
        description={article.frontmatter.description ?? article.frontmatter.title}
        canonicalUrl={`https://${getCanonicalDomain(Astro)}/${slug}`}
        image={article.frontmatter.featuredImage}
        siteName={config.site_name}
        publishDate={article.frontmatter.publishDate}
      />
    </Fragment>
```

Replace with:

```astro
    <Fragment slot="head">
      <SEOHead
        title={`${article.frontmatter.title} | ${config.site_name}`}
        description={article.frontmatter.description ?? article.frontmatter.title}
        canonicalUrl={`https://${getCanonicalDomain(Astro)}/${slug}`}
        image={article.frontmatter.featuredImage}
        siteName={config.site_name}
        publishDate={article.frontmatter.publishDate}
      />
    </Fragment>
    {articleHeadScripts && <Fragment slot="head" set:html={articleHeadScripts} />}
```

Then find the body fragment (around line 120):

```astro
          <Fragment set:html={articleBodyWithInlineAds} />
```

Replace with:

```astro
          <Fragment set:html={articleBodyFinal} />
```

- [ ] **Step 3: Verify typecheck and build**

Run: `cd packages/site-worker && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/site-worker/src/pages/\\[slug\\]/index.astro
git commit -m "feat(site-worker): wire article script injection into article page rendering

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Dashboard API — GET article

**Files:**
- Create: `services/dashboard/src/app/api/articles/[domain]/[slug]/route.ts`

- [ ] **Step 1: Create the GET route**

```typescript
// services/dashboard/src/app/api/articles/[domain]/[slug]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readFileContent, readDashboardIndex } from "@/lib/github";
import { parseFrontmatter, buildArticlePath } from "@/lib/article-upload";

interface RouteParams {
  params: Promise<{ domain: string; slug: string }>;
}

export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { domain, slug } = await params;
  const decodedDomain = decodeURIComponent(domain);

  // Look up staging branch from dashboard index
  const index = await readDashboardIndex();
  const site = index.sites?.find((s) => s.domain === decodedDomain);
  const stagingBranch = site?.staging_branch ?? undefined;

  const articlePath = buildArticlePath(decodedDomain, slug);

  // Try staging branch first, fall back to main
  let content: string | null = null;
  let resolvedBranch = "main";

  if (stagingBranch) {
    content = await readFileContent(articlePath, stagingBranch);
    if (content !== null) resolvedBranch = stagingBranch;
  }
  if (content === null) {
    content = await readFileContent(articlePath);
    resolvedBranch = "main";
  }

  if (content === null) {
    return NextResponse.json(
      { error: `Article "${slug}" not found for ${decodedDomain}` },
      { status: 404 },
    );
  }

  const parsed = parseFrontmatter(content);
  if (!parsed) {
    return NextResponse.json(
      { error: "Could not parse article frontmatter" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    slug,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    branch: resolvedBranch,
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/articles/\\[domain\\]/\\[slug\\]/route.ts
git commit -m "feat(dashboard): add GET /api/articles/[domain]/[slug] for reading article content

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Dashboard API — PUT article scripts

**Files:**
- Create: `services/dashboard/src/app/api/articles/[domain]/[slug]/scripts/route.ts`

- [ ] **Step 1: Create the PUT route**

```typescript
// services/dashboard/src/app/api/articles/[domain]/[slug]/scripts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { stringify as stringifyYaml } from "yaml";
import { readFileContent, readDashboardIndex, commitNetworkFiles } from "@/lib/github";
import { parseFrontmatter, buildArticlePath } from "@/lib/article-upload";

interface RouteParams {
  params: Promise<{ domain: string; slug: string }>;
}

const MAX_SCRIPTS = 20;
const MAX_CONTENT_SIZE = 50 * 1024; // 50 KB
const POSITION_RE = /^(head|before-content|after-content|after-paragraph-\d+)$/;

interface ScriptInput {
  id: string;
  name: string;
  position: string;
  content: string;
}

function validateScripts(scripts: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(scripts)) {
    return { valid: false, errors: ["scripts must be an array"] };
  }
  if (scripts.length > MAX_SCRIPTS) {
    errors.push(`Maximum ${MAX_SCRIPTS} scripts per article`);
  }

  const ids = new Set<string>();
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i] as ScriptInput;
    const prefix = `scripts[${i}]`;

    if (!s.id || typeof s.id !== "string") {
      errors.push(`${prefix}: id is required`);
    } else if (ids.has(s.id)) {
      errors.push(`${prefix}: duplicate id "${s.id}"`);
    } else {
      ids.add(s.id);
    }

    if (!s.name || typeof s.name !== "string") {
      errors.push(`${prefix}: name is required`);
    } else if (s.name.length > 100) {
      errors.push(`${prefix}: name exceeds 100 characters`);
    }

    if (!s.position || typeof s.position !== "string" || !POSITION_RE.test(s.position)) {
      errors.push(`${prefix}: position must be head, before-content, after-content, or after-paragraph-N`);
    }

    if (!s.content || typeof s.content !== "string") {
      errors.push(`${prefix}: content is required`);
    } else {
      if (!/<script/i.test(s.content)) {
        errors.push(`${prefix}: content must contain a <script tag`);
      }
      if (s.content.length > MAX_CONTENT_SIZE) {
        errors.push(`${prefix}: content exceeds 50 KB`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function PUT(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { domain, slug } = await params;
  const decodedDomain = decodeURIComponent(domain);

  let body: { scripts: unknown };
  try {
    body = (await req.json()) as { scripts: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate scripts
  const validation = validateScripts(body.scripts);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 400 },
    );
  }

  // Look up staging branch
  const index = await readDashboardIndex();
  const site = index.sites?.find((s) => s.domain === decodedDomain);
  const stagingBranch = site?.staging_branch;

  if (!stagingBranch) {
    return NextResponse.json(
      { error: `No staging branch found for ${decodedDomain}` },
      { status: 400 },
    );
  }

  // Read current article
  const articlePath = buildArticlePath(decodedDomain, slug);
  const content = await readFileContent(articlePath, stagingBranch);

  if (content === null) {
    return NextResponse.json(
      { error: `Article "${slug}" not found on ${stagingBranch}` },
      { status: 404 },
    );
  }

  const parsed = parseFrontmatter(content);
  if (!parsed) {
    return NextResponse.json(
      { error: "Could not parse article frontmatter" },
      { status: 500 },
    );
  }

  // Update scripts field only
  const fm = { ...parsed.frontmatter };
  const scripts = body.scripts as ScriptInput[];
  if (scripts.length === 0) {
    delete fm.scripts;
  } else {
    fm.scripts = scripts;
  }

  // Reconstruct markdown
  const yamlStr = stringifyYaml(fm, { lineWidth: 0 }).trim();
  const finalMarkdown = `---\n${yamlStr}\n---\n${parsed.body}`;

  // Commit
  await commitNetworkFiles(
    [{ path: articlePath, content: finalMarkdown }],
    `feat(content): update scripts for ${slug} on ${decodedDomain}`,
    stagingBranch,
  );

  return NextResponse.json({
    status: "updated",
    slug,
    scripts: fm.scripts ?? [],
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/articles/\\[domain\\]/\\[slug\\]/scripts/route.ts
git commit -m "feat(dashboard): add PUT /api/articles/[domain]/[slug]/scripts for managing article scripts

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: ArticleScriptsPanel UI component

**Files:**
- Create: `services/dashboard/src/components/site-detail/ArticleScriptsPanel.tsx`

- [ ] **Step 1: Create ArticleScriptsPanel.tsx**

```tsx
// services/dashboard/src/components/site-detail/ArticleScriptsPanel.tsx
"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import type { ArticleScript } from "@atomic-platform/shared-types";

interface ArticleScriptsPanelProps {
  domain: string;
  slug: string;
  stagingBranch: string | null;
  initialScripts: ArticleScript[];
}

type FormMode = { kind: "closed" } | { kind: "add" } | { kind: "edit"; id: string };

const POSITION_OPTIONS = [
  { value: "head", label: "Page Head" },
  { value: "before-content", label: "Before Article" },
  { value: "after-content", label: "After Article" },
  { value: "after-paragraph", label: "After Paragraph..." },
] as const;

function positionLabel(pos: string): string {
  if (pos === "head") return "Head";
  if (pos === "before-content") return "Before Article";
  if (pos === "after-content") return "After Article";
  const match = /^after-paragraph-(\d+)$/.exec(pos);
  if (match) return `After Paragraph ${match[1]}`;
  return pos;
}

function positionColor(pos: string): string {
  if (pos === "head") return "bg-cyan/10 text-cyan";
  if (pos === "before-content" || pos === "after-content") return "bg-violet-500/10 text-violet-400";
  return "bg-amber-500/10 text-amber-400";
}

export function ArticleScriptsPanel({
  domain,
  slug,
  stagingBranch,
  initialScripts,
}: ArticleScriptsPanelProps): React.ReactElement {
  const [scripts, setScripts] = useState<ArticleScript[]>(initialScripts);
  const [formMode, setFormMode] = useState<FormMode>({ kind: "closed" });
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formPositionType, setFormPositionType] = useState("head");
  const [formParagraphN, setFormParagraphN] = useState(1);
  const [formContent, setFormContent] = useState("");

  const { toast } = useToast();

  const resolvedPosition = formPositionType === "after-paragraph"
    ? `after-paragraph-${formParagraphN}`
    : formPositionType;

  const resetForm = useCallback((): void => {
    setFormName("");
    setFormPositionType("head");
    setFormParagraphN(1);
    setFormContent("");
    setFormMode({ kind: "closed" });
  }, []);

  const openAdd = useCallback((): void => {
    resetForm();
    setFormMode({ kind: "add" });
  }, [resetForm]);

  const openEdit = useCallback((script: ArticleScript): void => {
    setFormName(script.name);
    setFormContent(script.content);
    const pMatch = /^after-paragraph-(\d+)$/.exec(script.position);
    if (pMatch) {
      setFormPositionType("after-paragraph");
      setFormParagraphN(Number.parseInt(pMatch[1]!, 10));
    } else {
      setFormPositionType(script.position);
    }
    setFormMode({ kind: "edit", id: script.id });
  }, []);

  const saveScripts = useCallback(async (updated: ArticleScript[]): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch(`/api/articles/${encodeURIComponent(domain)}/${encodeURIComponent(slug)}/scripts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scripts: updated }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.details
          ? `${data.error}: ${(data.details as string[]).join(", ")}`
          : data.error ?? "Save failed";
        toast(msg, "error");
        return false;
      }
      setScripts(updated);
      toast("Scripts saved", "success");
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }, [domain, slug, toast]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!formName.trim() || !formContent.trim()) return;

    const entry: ArticleScript = {
      id: formMode.kind === "edit" ? formMode.id : crypto.randomUUID(),
      name: formName.trim(),
      position: resolvedPosition,
      content: formContent,
    };

    let updated: ArticleScript[];
    if (formMode.kind === "edit") {
      updated = scripts.map((s) => (s.id === formMode.id ? entry : s));
    } else {
      updated = [...scripts, entry];
    }

    const ok = await saveScripts(updated);
    if (ok) resetForm();
  }, [formName, formContent, resolvedPosition, formMode, scripts, saveScripts, resetForm]);

  const handleDelete = useCallback(async (id: string): Promise<void> => {
    const updated = scripts.filter((s) => s.id !== id);
    await saveScripts(updated);
  }, [scripts, saveScripts]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Scripts</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Inject tracking, widgets, or other scripts into this article
          </p>
        </div>
        {formMode.kind === "closed" && (
          <Button variant="ghost" size="sm" onClick={openAdd}>
            + Add Script
          </Button>
        )}
      </div>

      {/* Scripts list */}
      {scripts.length === 0 && formMode.kind === "closed" && (
        <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            No scripts attached to this article.
          </p>
          <Button variant="ghost" size="sm" onClick={openAdd} className="mt-2">
            + Add Script
          </Button>
        </div>
      )}

      {scripts.length > 0 && (
        <div className="space-y-2">
          {scripts.map((s) => (
            <div
              key={s.id}
              className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-4 flex items-start justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{s.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${positionColor(s.position)}`}>
                    {positionLabel(s.position)}
                  </span>
                </div>
                <pre className="text-xs text-[var(--text-muted)] mt-1 truncate font-mono max-w-md">
                  {s.content.slice(0, 80)}{s.content.length > 80 ? "..." : ""}
                </pre>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(): void => openEdit(s)}
                  disabled={saving}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(): void => { void handleDelete(s.id); }}
                  disabled={saving}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit form */}
      {formMode.kind !== "closed" && (
        <div className="rounded-xl bg-[var(--bg-elevated)] border border-cyan/20 p-6 space-y-4">
          <h4 className="text-sm font-semibold">
            {formMode.kind === "add" ? "Add Script" : "Edit Script"}
          </h4>

          <Input
            label="Name"
            value={formName}
            onChange={(e): void => setFormName(e.target.value)}
            placeholder="e.g. Campaign Pixel, Quiz Widget"
            disabled={saving}
          />

          <div>
            <label className="block text-sm font-medium mb-1.5">Position</label>
            <select
              value={formPositionType}
              onChange={(e): void => setFormPositionType(e.target.value)}
              disabled={saving}
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
            >
              {POSITION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {formPositionType === "after-paragraph" && (
            <Input
              label="Paragraph Number"
              type="number"
              min={1}
              value={formParagraphN}
              onChange={(e): void => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 1) setFormParagraphN(val);
              }}
              disabled={saving}
              className="w-24"
            />
          )}

          <div>
            <label className="block text-sm font-medium mb-1.5">Script Content</label>
            <textarea
              value={formContent}
              onChange={(e): void => setFormContent(e.target.value)}
              placeholder={'<script src="https://example.com/widget.js"></script>'}
              disabled={saving}
              rows={6}
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-mono resize-y"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={(): void => { void handleSave(); }}
              disabled={saving || !formName.trim() || !formContent.trim()}
            >
              {saving ? "Saving..." : "Save Script"}
            </Button>
            <Button variant="ghost" onClick={resetForm} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/site-detail/ArticleScriptsPanel.tsx
git commit -m "feat(dashboard): add ArticleScriptsPanel component for managing per-article scripts

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Article detail page

**Files:**
- Create: `services/dashboard/src/app/sites/[domain]/articles/[slug]/page.tsx`

- [ ] **Step 1: Create the article detail page**

```tsx
// services/dashboard/src/app/sites/[domain]/articles/[slug]/page.tsx
import Link from "next/link";
import { readDashboardIndex, readFileContent } from "@/lib/github";
import { parseFrontmatter, buildArticlePath } from "@/lib/article-upload";
import { ArticleScriptsPanel } from "@/components/site-detail/ArticleScriptsPanel";
import { workerPreviewUrl } from "@/lib/constants";
import type { ArticleScript } from "@atomic-platform/shared-types";

interface PageProps {
  params: Promise<{ domain: string; slug: string }>;
}

function statusColor(status: string): string {
  if (status === "published") return "bg-green-500/10 text-green-400";
  if (status === "review") return "bg-amber-500/10 text-amber-400";
  return "bg-zinc-500/10 text-zinc-400";
}

export default async function ArticleDetailPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const { domain, slug } = await params;
  const decodedDomain = decodeURIComponent(domain);

  // Look up site for staging branch
  const index = await readDashboardIndex();
  const site = index.sites?.find((s) => s.domain === decodedDomain);
  const stagingBranch = site?.staging_branch ?? null;

  // Read article
  const articlePath = buildArticlePath(decodedDomain, slug);
  let content: string | null = null;

  if (stagingBranch) {
    content = await readFileContent(articlePath, stagingBranch);
  }
  if (content === null) {
    content = await readFileContent(articlePath);
  }

  if (content === null) {
    return (
      <div className="p-8">
        <Link href={`/sites/${domain}`} className="text-cyan hover:underline text-sm">
          &larr; Back to Site
        </Link>
        <div className="mt-6 text-center text-[var(--text-muted)]">
          Article &ldquo;{slug}&rdquo; not found.
        </div>
      </div>
    );
  }

  const parsed = parseFrontmatter(content);
  const fm = parsed?.frontmatter ?? {};
  const title = (fm.title as string) || slug;
  const status = (fm.status as string) || "draft";
  const type = (fm.type as string) || "standard";
  const author = (fm.author as string) || "Editorial Team";
  const publishDate = (fm.publishDate as string) || "";
  const qualityScore = fm.quality_score as number | undefined;
  const scripts = Array.isArray(fm.scripts) ? (fm.scripts as ArticleScript[]) : [];

  const previewHref = workerPreviewUrl(decodedDomain, `/${slug}`);

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Back link */}
      <Link href={`/sites/${domain}`} className="text-cyan hover:underline text-sm">
        &larr; Back to Site
      </Link>

      {/* Article header */}
      <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-bold">{title}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusColor(status)}`}>
            {status}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
          <span>Type: <span className="text-[var(--text-secondary)]">{type}</span></span>
          <span>Author: <span className="text-[var(--text-secondary)]">{author}</span></span>
          {publishDate && <span>Published: <span className="text-[var(--text-secondary)]">{publishDate}</span></span>}
          {qualityScore != null && <span>Score: <span className="text-[var(--text-secondary)]">{qualityScore}</span></span>}
          <a
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan hover:underline"
          >
            Preview &rarr;
          </a>
        </div>
      </div>

      {/* Scripts panel */}
      <ArticleScriptsPanel
        domain={decodedDomain}
        slug={slug}
        stagingBranch={stagingBranch}
        initialScripts={scripts}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/sites/\\[domain\\]/articles/\\[slug\\]/page.tsx
git commit -m "feat(dashboard): add article detail page with scripts management

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Make article titles clickable in ContentTab

**Files:**
- Modify: `services/dashboard/src/components/site-detail/ContentTab.tsx`

- [ ] **Step 1: Add Link import and wrap article titles**

In `services/dashboard/src/components/site-detail/ContentTab.tsx`, add the import at the top:

```typescript
import Link from "next/link";
```

Find the title cell rendering (around line 253-255):

```tsx
<td className="px-4 py-3 font-medium text-[var(--text-primary)] max-w-xs truncate">
  {article.title}
</td>
```

Replace with:

```tsx
<td className="px-4 py-3 font-medium max-w-xs truncate">
  <Link
    href={`/sites/${domain}/articles/${article.slug}`}
    className="text-[var(--text-primary)] hover:text-cyan hover:underline"
  >
    {article.title}
  </Link>
</td>
```

- [ ] **Step 2: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/site-detail/ContentTab.tsx
git commit -m "feat(dashboard): make article titles clickable links to detail page

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary

| Task | What it builds |
|------|---------------|
| 1 | `ArticleScript` type + `scripts?` field in shared-types |
| 2 | KV schema update + seed-kv passthrough for `scripts` |
| 3 | `injectArticleScripts()` — position-based script injection into HTML |
| 4 | Wire injection into article page rendering (body + head) |
| 5 | `GET /api/articles/[domain]/[slug]` — read article from Git |
| 6 | `PUT /api/articles/[domain]/[slug]/scripts` — update scripts in frontmatter |
| 7 | `ArticleScriptsPanel` — scripts management UI component |
| 8 | Article detail page at `/sites/[domain]/articles/[slug]` |
| 9 | Clickable article titles in ContentTab |
