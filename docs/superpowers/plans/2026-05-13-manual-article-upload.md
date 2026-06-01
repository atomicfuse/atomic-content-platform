# Manual Article Upload (MD + Image) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to upload a markdown file as an article (bypassing AI generation) and optionally attach a custom featured image, directly from the Content Generation panel in the dashboard.

**Architecture:** Two new dashboard API routes handle uploads: one for the markdown article (validates frontmatter, commits to the staging branch via GitHub API) and one for the image (uploads to R2 with the site's asset path convention). The existing `ContentGenerationPanel.tsx` gets a new "Upload Article" section below the existing "Generate N Articles" controls, containing a `.md` file picker, an optional image picker, and an upload button. No content-pipeline changes needed — this is a dashboard-only feature that writes directly to Git + R2.

**Tech Stack:** Next.js App Router API routes (FormData), React file inputs, `yaml` package (frontmatter parsing), `@aws-sdk/client-s3` PutObjectCommand (R2 upload), Octokit via `commitNetworkFiles` (Git commit).

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `services/dashboard/src/components/site-detail/ArticleUploadPanel.tsx` | Client component: MD file picker, image picker, preview, upload button, status feedback |
| **Create:** `services/dashboard/src/app/api/articles/upload/route.ts` | API route: receives FormData (md file + optional image + domain + branch), validates frontmatter, commits article to Git, uploads image to R2 |
| **Create:** `services/dashboard/src/lib/article-upload.ts` | Shared utilities: `parseFrontmatter()`, `validateArticleFrontmatter()`, `slugFromFilename()`, `buildArticlePath()` |
| **Create:** `services/dashboard/src/lib/r2-upload.ts` | R2 PutObject wrapper for dashboard (reuses existing `getR2Client()` pattern from `cloudflare.ts`) |
| **Modify:** `services/dashboard/src/components/site-detail/ContentGenerationPanel.tsx` | Add `<ArticleUploadPanel>` below the generate controls |
| **Modify:** `services/dashboard/src/lib/cloudflare.ts` | Export `getR2Client()` (currently private) |

---

## Task 1: Article frontmatter utilities

**Files:**
- Create: `services/dashboard/src/lib/article-upload.ts`

- [ ] **Step 1: Create `article-upload.ts` with frontmatter parser and validator**

This module parses YAML frontmatter from markdown text and validates required fields.

```typescript
// services/dashboard/src/lib/article-upload.ts
import { parse as parseYaml } from "yaml";

export interface ParsedArticle {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Extract YAML frontmatter and body from a markdown string.
 * Expects `---` delimiters. Returns null if no frontmatter found.
 */
export function parseFrontmatter(markdown: string): ParsedArticle | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  try {
    const frontmatter = parseYaml(match[1]!) as Record<string, unknown>;
    return { frontmatter, body: match[2] ?? "" };
  } catch {
    return null;
  }
}

/** Required frontmatter fields for a valid article. */
const REQUIRED_FIELDS = ["title", "slug"] as const;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that article frontmatter has required fields and sensible values.
 * Fills in defaults for optional fields that are missing.
 */
export function validateArticleFrontmatter(
  fm: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (!fm[field] || (typeof fm[field] === "string" && !(fm[field] as string).trim())) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (fm.slug && typeof fm.slug === "string" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fm.slug)) {
    errors.push("slug must be kebab-case (lowercase letters, numbers, hyphens)");
  }

  if (!fm.status) warnings.push("No status field — will default to 'draft'");
  if (!fm.publishDate) warnings.push("No publishDate — will default to today");
  if (!fm.author) warnings.push("No author — will default to 'Editorial Team'");
  if (!fm.description) warnings.push("No description — recommended for SEO");
  if (!fm.tags || !Array.isArray(fm.tags) || fm.tags.length === 0) {
    warnings.push("No tags — recommended for categorization");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Derive a slug from a filename: strip .md extension, lowercase, replace
 * spaces/underscores with hyphens.
 */
export function slugFromFilename(filename: string): string {
  return filename
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Build the network-repo path for an article. */
export function buildArticlePath(domain: string, slug: string): string {
  return `sites/${domain}/articles/${slug}.md`;
}

/** Build the R2 key for an article image. */
export function buildImageR2Key(domain: string, slug: string, ext: string): string {
  return `${domain}/assets/images/${slug}.${ext}`;
}

/** Build the frontmatter-relative image path. */
export function buildImageFrontmatterPath(slug: string, ext: string): string {
  return `/assets/images/${slug}.${ext}`;
}
```

- [ ] **Step 2: Verify file was created correctly**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors related to `article-upload.ts`

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/lib/article-upload.ts
git commit -m "feat(dashboard): add article frontmatter parsing and validation utilities"
```

---

## Task 2: R2 upload utility for dashboard

**Files:**
- Modify: `services/dashboard/src/lib/cloudflare.ts`
- Create: `services/dashboard/src/lib/r2-upload.ts`

- [ ] **Step 1: Export `getR2Client` from `cloudflare.ts`**

In `services/dashboard/src/lib/cloudflare.ts`, make `getR2Client` public (it's currently a private function):

```diff
-function getR2Client(): S3Client | null {
+export function getR2Client(): S3Client | null {
```

No other changes to `cloudflare.ts` — `PutObjectCommand` will be imported directly from `@aws-sdk/client-s3` in the new `r2-upload.ts` file.

- [ ] **Step 2: Create `r2-upload.ts` — dashboard R2 upload wrapper**

```typescript
// services/dashboard/src/lib/r2-upload.ts
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client } from "@/lib/cloudflare";

/**
 * Upload a buffer to R2. Returns true on success, false if R2 is not
 * configured or the upload fails.
 */
export async function uploadToR2(
  key: string,
  data: Buffer,
  contentType: string,
): Promise<boolean> {
  const client = getR2Client();
  if (!client) {
    console.warn("[r2-upload] R2 not configured — skipping upload");
    return false;
  }

  const bucket = process.env.R2_BUCKET ?? "atl-assets-prod";

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
    console.log(`[r2-upload] Uploaded ${key} (${(data.length / 1024).toFixed(0)} KB) to ${bucket}`);
    return true;
  } catch (err) {
    console.error(
      `[r2-upload] Failed to upload ${key}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/lib/cloudflare.ts services/dashboard/src/lib/r2-upload.ts
git commit -m "feat(dashboard): add R2 upload utility for dashboard-side asset uploads"
```

---

## Task 3: Article upload API route

**Files:**
- Create: `services/dashboard/src/app/api/articles/upload/route.ts`

This route receives `multipart/form-data` with the `.md` file, optional image file, domain, and branch. It validates the markdown, commits the article to Git, and uploads the image to R2.

- [ ] **Step 1: Create the upload route**

```typescript
// services/dashboard/src/app/api/articles/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { stringify as stringifyYaml } from "yaml";
import { commitNetworkFiles, readFileContent } from "@/lib/github";
import { uploadToR2 } from "@/lib/r2-upload";
import {
  parseFrontmatter,
  validateArticleFrontmatter,
  slugFromFilename,
  buildArticlePath,
  buildImageR2Key,
  buildImageFrontmatterPath,
} from "@/lib/article-upload";

/** Allowed image MIME types and their extensions. */
const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MAX_MD_SIZE = 2 * 1024 * 1024;   // 2 MB
const MAX_IMG_SIZE = 10 * 1024 * 1024;  // 10 MB

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData();

    const domain = formData.get("domain") as string | null;
    const branch = formData.get("branch") as string | null;
    const mdFile = formData.get("markdown") as File | null;
    const imageFile = formData.get("image") as File | null;

    // --- Validate required fields ---
    if (!domain) {
      return NextResponse.json({ error: "domain is required" }, { status: 400 });
    }
    if (!mdFile) {
      return NextResponse.json({ error: "markdown file is required" }, { status: 400 });
    }
    if (!mdFile.name.endsWith(".md")) {
      return NextResponse.json({ error: "File must be a .md markdown file" }, { status: 400 });
    }
    if (mdFile.size > MAX_MD_SIZE) {
      return NextResponse.json({ error: "Markdown file exceeds 2 MB limit" }, { status: 400 });
    }

    // --- Parse markdown ---
    const mdText = await mdFile.text();
    const parsed = parseFrontmatter(mdText);

    if (!parsed) {
      return NextResponse.json(
        { error: "Could not parse frontmatter. File must start with --- delimiters." },
        { status: 400 },
      );
    }

    // --- Validate frontmatter ---
    const validation = validateArticleFrontmatter(parsed.frontmatter);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Invalid frontmatter", details: validation.errors },
        { status: 400 },
      );
    }

    const slug = (parsed.frontmatter.slug as string) || slugFromFilename(mdFile.name);
    const targetBranch = branch || `staging/${domain}`;

    // --- Handle image upload ---
    let imagePath: string | null = null;

    if (imageFile) {
      if (imageFile.size > MAX_IMG_SIZE) {
        return NextResponse.json({ error: "Image exceeds 10 MB limit" }, { status: 400 });
      }
      const ext = IMAGE_TYPES[imageFile.type];
      if (!ext) {
        return NextResponse.json(
          { error: `Unsupported image type: ${imageFile.type}. Allowed: ${Object.keys(IMAGE_TYPES).join(", ")}` },
          { status: 400 },
        );
      }

      const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
      const r2Key = buildImageR2Key(domain, slug, ext);
      const uploaded = await uploadToR2(r2Key, imageBuffer, imageFile.type);

      if (uploaded) {
        imagePath = buildImageFrontmatterPath(slug, ext);
      }
      // If R2 upload fails, continue without image (non-blocking)
    }

    // --- Check for duplicate slug ---
    const articlePath = buildArticlePath(domain, slug);
    const force = formData.get("force") === "true";
    if (!force) {
      const existing = await readFileContent(articlePath, targetBranch);
      if (existing !== null) {
        return NextResponse.json(
          { error: `Article "${slug}" already exists on ${targetBranch}. Use force=true to overwrite.` },
          { status: 409 },
        );
      }
    }

    // --- Rebuild markdown with defaults filled in ---
    const fm = { ...parsed.frontmatter };
    if (!fm.status) fm.status = "draft";
    if (!fm.publishDate) fm.publishDate = new Date().toISOString().split("T")[0];
    if (!fm.author) fm.author = "Editorial Team";
    if (!fm.type) fm.type = "standard";
    fm.slug = slug;

    // Inject uploaded image path into frontmatter if provided and not already set
    if (imagePath && !fm.featuredImage) {
      fm.featuredImage = imagePath;
    }

    // Reconstruct the markdown with updated frontmatter
    const yamlStr = stringifyYaml(fm, { lineWidth: 0 }).trim();
    const finalMarkdown = `---\n${yamlStr}\n---\n${parsed.body}`;

    // --- Commit to Git ---
    await commitNetworkFiles(
      [{ path: articlePath, content: finalMarkdown }],
      `feat(content): upload article ${slug} for ${domain}`,
      targetBranch,
    );

    return NextResponse.json({
      status: "created",
      slug,
      path: articlePath,
      branch: targetBranch,
      imagePath: imagePath ?? null,
      warnings: validation.warnings,
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[article-upload]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/articles/upload/route.ts
git commit -m "feat(dashboard): add article upload API route with MD validation and R2 image upload"
```

---

## Task 4: Article Upload Panel UI component

**Files:**
- Create: `services/dashboard/src/components/site-detail/ArticleUploadPanel.tsx`

- [ ] **Step 1: Create the `ArticleUploadPanel` component**

This component renders: a file drop zone for `.md` files, a frontmatter preview after parsing, an optional image file picker, and an Upload button.

```typescript
// services/dashboard/src/components/site-detail/ArticleUploadPanel.tsx
"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface ArticleUploadPanelProps {
  domain: string;
  stagingBranch: string | null;
}

interface ParsedPreview {
  title: string;
  slug: string;
  status: string;
  tags: string[];
  description: string;
  hasBody: boolean;
  wordCount: number;
}

type UploadState = "idle" | "uploading" | "success" | "error";

/** Client-side preview only — uses simple regex extraction for common
 *  single-line YAML values. Multi-line values and inline arrays won't parse.
 *  The server does full YAML parsing via the `yaml` package. */
function parsePreview(text: string): ParsedPreview | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const yaml = match[1] ?? "";
  const body = match[2] ?? "";

  const get = (key: string): string => {
    const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1]!.replace(/^["']|["']$/g, "").trim() : "";
  };

  const tagsMatch = yaml.match(/^tags:\s*\n((?:\s+-\s+.+\n?)*)/m);
  const tags = tagsMatch
    ? tagsMatch[1]!.split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean)
    : [];

  const wordCount = body.split(/\s+/).filter(Boolean).length;

  return {
    title: get("title"),
    slug: get("slug"),
    status: get("status") || "draft",
    tags,
    description: get("description"),
    hasBody: body.trim().length > 0,
    wordCount,
  };
}

export function ArticleUploadPanel({
  domain,
  stagingBranch,
}: ArticleUploadPanelProps): React.ReactElement {
  const [mdFile, setMdFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [result, setResult] = useState<{
    slug: string;
    path: string;
    imagePath: string | null;
    warnings: string[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mdInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleMdSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setMdFile(file);
    setPreview(null);
    setParseError(null);
    setResult(null);
    setErrorMsg(null);
    setUploadState("idle");

    if (!file) return;

    if (!file.name.endsWith(".md")) {
      setParseError("File must be a .md markdown file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev): void => {
      const text = ev.target?.result as string;
      const parsed = parsePreview(text);
      if (!parsed) {
        setParseError("Could not parse frontmatter. File must start with --- delimiters.");
        return;
      }
      if (!parsed.title && !parsed.slug) {
        setParseError("Frontmatter must contain at least a title and slug field.");
        return;
      }
      setPreview(parsed);
    };
    reader.readAsText(file);
  }, []);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setImageFile(e.target.files?.[0] ?? null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!mdFile) return;

    setUploadState("uploading");
    setErrorMsg(null);

    const form = new FormData();
    form.append("markdown", mdFile);
    form.append("domain", domain);
    if (stagingBranch) form.append("branch", stagingBranch);
    if (imageFile) form.append("image", imageFile);

    try {
      const res = await fetch("/api/articles/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();

      if (!res.ok) {
        const msg = data.details
          ? `${data.error}: ${(data.details as string[]).join(", ")}`
          : data.error ?? "Upload failed";
        setUploadState("error");
        setErrorMsg(msg);
        toast(msg, "error");
        return;
      }

      setUploadState("success");
      setResult({
        slug: data.slug,
        path: data.path,
        imagePath: data.imagePath,
        warnings: data.warnings ?? [],
      });
      toast(`Article "${preview?.title || data.slug}" uploaded`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setUploadState("error");
      setErrorMsg(msg);
      toast(msg, "error");
    }
  }, [mdFile, imageFile, domain, stagingBranch, preview, toast]);

  const handleReset = useCallback(() => {
    setMdFile(null);
    setImageFile(null);
    setPreview(null);
    setParseError(null);
    setResult(null);
    setErrorMsg(null);
    setUploadState("idle");
    if (mdInputRef.current) mdInputRef.current.value = "";
    if (imgInputRef.current) imgInputRef.current.value = "";
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Upload Article</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Upload a markdown file directly as an article with optional featured image
          </p>
        </div>
        {(mdFile || result) && (
          <Button variant="ghost" size="sm" onClick={handleReset}>
            Clear
          </Button>
        )}
      </div>

      <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-4">
        {/* Markdown file picker */}
        <div>
          <label className="block text-sm font-medium mb-1.5">Markdown File</label>
          <input
            ref={mdInputRef}
            type="file"
            accept=".md"
            onChange={handleMdSelect}
            disabled={uploadState === "uploading"}
            className="block text-sm text-[var(--text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-cyan/10 file:text-cyan hover:file:bg-cyan/20 disabled:opacity-50"
          />
          {parseError && (
            <p className="text-xs text-red-400 mt-1">{parseError}</p>
          )}
        </div>

        {/* Frontmatter preview */}
        {preview && (
          <div className="rounded-lg bg-[var(--bg-primary)] border border-[var(--border-secondary)] p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{preview.title || "(no title)"}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                preview.status === "published"
                  ? "bg-green-500/10 text-green-400"
                  : preview.status === "review"
                    ? "bg-amber-500/10 text-amber-400"
                    : "bg-zinc-500/10 text-zinc-400"
              }`}>
                {preview.status}
              </span>
            </div>
            <div className="text-xs text-[var(--text-muted)] space-y-1">
              <div>Slug: <code className="text-cyan">{preview.slug || "(missing)"}</code></div>
              {preview.description && <div>Description: {preview.description}</div>}
              <div>Body: {preview.wordCount.toLocaleString()} words</div>
              {preview.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {preview.tags.map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-[10px]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Image file picker */}
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Featured Image <span className="text-[var(--text-muted)] font-normal">(optional)</span>
          </label>
          <input
            ref={imgInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleImageSelect}
            disabled={uploadState === "uploading"}
            className="block text-sm text-[var(--text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-violet-500/10 file:text-violet-400 hover:file:bg-violet-500/20 disabled:opacity-50"
          />
          {imageFile && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {imageFile.name} ({(imageFile.size / 1024).toFixed(0)} KB)
            </p>
          )}
        </div>

        {/* Upload button */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={handleUpload}
            disabled={!mdFile || !preview || uploadState === "uploading"}
          >
            {uploadState === "uploading" ? (
              <>
                <svg className="w-4 h-4 mr-2 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Uploading...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                Upload Article{imageFile ? " + Image" : ""}
              </>
            )}
          </Button>
          <p className="text-xs text-[var(--text-muted)]">
            Commits to{" "}
            <code className="text-cyan text-[10px]">
              {stagingBranch ?? `staging/${domain}`}
            </code>
          </p>
        </div>

        {/* Error */}
        {uploadState === "error" && errorMsg && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {errorMsg}
          </div>
        )}

        {/* Success */}
        {uploadState === "success" && result && (
          <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm text-green-400 font-medium">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Article uploaded
            </div>
            <div className="text-xs text-[var(--text-muted)] space-y-1">
              <div>Path: <code className="text-cyan">{result.path}</code></div>
              {result.imagePath && <div>Image: <code className="text-violet-400">{result.imagePath}</code></div>}
              {result.warnings.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {result.warnings.map((w, i) => (
                    <div key={i} className="text-amber-400">Warning: {w}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/site-detail/ArticleUploadPanel.tsx
git commit -m "feat(dashboard): add ArticleUploadPanel component with MD preview and image picker"
```

---

## Task 5: Integrate upload panel into ContentGenerationPanel

**Files:**
- Modify: `services/dashboard/src/components/site-detail/ContentGenerationPanel.tsx`

- [ ] **Step 1: Add ArticleUploadPanel import and render it below the generate controls**

At the top of `ContentGenerationPanel.tsx`, add the import:

```typescript
import { ArticleUploadPanel } from "./ArticleUploadPanel";
```

Then in the JSX return, add the upload panel after the existing content (after the closing `</div>` of the outer `space-y-6` container's last child, but still inside the container). Find the final return and add the panel just before the closing `</div>`:

The component's return is a `<div className="space-y-6">` that contains:
1. Header section
2. Generation Controls (when idle)
3. Pipeline Progress (when not idle)

Add a divider and the upload panel after all three sections, still inside the outer div — visible regardless of pipeline state:

```tsx
      {/* ─── Divider ─── */}
      <div className="border-t border-[var(--border-primary)]" />

      {/* ─── Upload Article ─── */}
      <ArticleUploadPanel domain={domain} stagingBranch={stagingBranch} />
    </div>
  );
```

This replaces the existing closing `</div>` of the return statement's outer container. The two new blocks go right before it.

- [ ] **Step 2: Verify typecheck and dev build**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/site-detail/ContentGenerationPanel.tsx
git commit -m "feat(dashboard): integrate ArticleUploadPanel into Content Generation section"
```

---

## Task 6: Manual QA checklist

These are manual verification steps to perform in the browser after `cloudgrid dev` or `pnpm dev`.

- [ ] **Step 1: Navigate to a site's Content Brief tab**

Open `http://localhost:3001/sites/<any-domain>` → Site Settings → Content Brief → scroll to Content Generation section.

Verify: "Upload Article" section appears below the existing "Content Generation" section, separated by a divider.

- [ ] **Step 2: Upload a markdown file without an image**

1. Click "Choose File" in the Markdown File input.
2. Select a `.md` file with valid frontmatter (title, slug at minimum).
3. Verify: frontmatter preview appears showing title, slug, status badge, word count, tags.
4. Click "Upload Article".
5. Verify: success message with path and branch.
6. Verify: article appears on the staging branch in the network repo.

- [ ] **Step 3: Upload a markdown file with an image**

1. Select a `.md` file.
2. Select an image (PNG, JPEG, or WebP) in the Featured Image input.
3. Click "Upload Article + Image".
4. Verify: success message shows both path and image path.
5. Verify: image was uploaded to R2 under `<domain>/assets/images/<slug>.<ext>`.
6. Verify: article frontmatter contains `featuredImage: /assets/images/<slug>.<ext>`.

- [ ] **Step 4: Error cases**

1. Try uploading a `.txt` file → should show "File must be a .md markdown file".
2. Try uploading a `.md` file without `---` frontmatter → should show parse error.
3. Try uploading a `.md` missing `title` and `slug` → should show validation error.

- [ ] **Step 5: Commit final state**

If any fixes were needed during QA, commit them:

```bash
git add -p
git commit -m "fix(dashboard): address QA feedback for article upload"
```

---

## Summary

| Task | What it builds |
|------|---------------|
| 1 | Frontmatter parsing + validation utilities |
| 2 | R2 upload wrapper for dashboard |
| 3 | `POST /api/articles/upload` API route (FormData → Git + R2) |
| 4 | `ArticleUploadPanel` client component (file pickers, preview, upload flow) |
| 5 | Integration into `ContentGenerationPanel` |
| 6 | Manual QA verification |
