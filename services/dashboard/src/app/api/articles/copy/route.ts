import { NextRequest, NextResponse } from "next/server";
import { parse as parseYaml } from "yaml";
import matter from "gray-matter";
import { marked } from "marked";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { readArticlesFromDb as readArticles } from "@/lib/db/articles";
import {
  readFileContent,
  commitNetworkFiles,
  branchExists,
  createBranch,
  invalidateSiteCaches,
} from "@/lib/github";
import { readFromR2, uploadToR2 } from "@/lib/r2-upload";
import { bulkPutKV, getKVEntry } from "@/lib/cloudflare";
import { getKvNamespaces } from "@/lib/constants";
import { upsertArticlesMeta } from "@/lib/db/articles";

interface CopyRequestBody {
  sourceDomain: string;
  targetDomain: string;
  slugs: string[];
}

interface SkippedArticle {
  slug: string;
  reason: string;
}

interface CopyResponse {
  copied: string[];
  skipped: SkippedArticle[];
  warnings: string[];
}

// --- KV article types (mirrors site-worker/src/lib/kv-schema.ts) ---

interface ArticleIndexEntry {
  slug: string;
  title: string;
  description?: string;
  author: string;
  publishDate: string;
  featuredImage?: string;
  tags: string[];
  type: "listicle" | "how-to" | "review" | "standard";
  status: "draft" | "review" | "approved" | "published";
  featured?: ("hero" | "must-read")[];
  scripts?: unknown[];
  videos?: unknown[];
  topics?: string[];
}

interface ArticleRecord {
  frontmatter: ArticleIndexEntry;
  body: string;
}

/** Extract the image filename from a domain-relative featuredImage path.
 *  e.g. `/assets/images/best-hike.webp` → `best-hike.webp` */
function extractImageFilename(featuredImage: string): string | null {
  const match = featuredImage.match(/\/assets\/images\/([^/]+)$/);
  return match ? match[1]! : null;
}

/** Parse the featuredImage field from raw markdown frontmatter.
 *  Handles quoted, unquoted, and YAML multiline (>- / |-) values. */
function parseFeaturedImage(markdown: string): string | null {
  // Try standard single-line: `featuredImage: /path` or `featuredImage: "/path"`
  const inline = markdown.match(/^featuredImage:\s*["']?([^"'\n>|]+)["']?\s*$/m);
  if (inline) return inline[1]!.trim();

  // Try YAML multiline fold/block: `featuredImage: >-\n  /path` or `featuredImage: |-\n  /path`
  const multiline = markdown.match(/^featuredImage:\s*[>|]-?\s*\n\s+(.+)$/m);
  if (multiline) return multiline[1]!.trim();

  return null;
}

// --- Helpers for building KV entries (mirrors seed-kv logic) ---

function splitFrontmatter(raw: string): { front: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { front: {}, body: raw };
  const front = (parseYaml(match[1] ?? "") as Record<string, unknown> | null) ?? {};
  return { front, body: match[2] ?? "" };
}

function rewriteAssetUrls(html: string, siteId: string): string {
  const prefix = `/${siteId}/assets/`;
  return html
    .replace(/(\bsrc\s*=\s*["'])\/assets\//g, `$1${prefix}`)
    .replace(/(\bhref\s*=\s*["'])\/assets\//g, `$1${prefix}`)
    .replace(/(\()\/assets\//g, `$1${prefix}`);
}

function rewriteFrontmatterUrl(url: string | undefined, siteId: string): string | undefined {
  if (!url) return url;
  if (url.startsWith("/assets/")) return `/${siteId}/assets${url.slice("/assets".length)}`;
  return url;
}

const FEATURED_VALID = new Set(["hero", "must-read"] as const);
function parseFeaturedFlags(raw: unknown): ("hero" | "must-read")[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  const filtered = arr
    .map((v) => String(v).trim())
    .filter((v): v is "hero" | "must-read" => FEATURED_VALID.has(v as "hero" | "must-read"));
  return filtered.length > 0 ? filtered : Array.isArray(raw) && raw.length === 0 ? undefined : [];
}

function markdownToArticleRecord(slug: string, markdown: string, siteId: string): ArticleRecord {
  const { front, body } = splitFrontmatter(markdown);
  const frontmatter: ArticleIndexEntry = {
    slug,
    title: String(front.title ?? slug),
    description: front.description ? String(front.description) : undefined,
    author: String(front.author ?? "Editorial Team"),
    publishDate: new Date(String(front.publishDate ?? Date.now())).toISOString(),
    featuredImage: rewriteFrontmatterUrl(front.featuredImage ? String(front.featuredImage) : undefined, siteId),
    tags: Array.isArray(front.tags) ? front.tags.map(String) : [],
    type: (front.type as ArticleIndexEntry["type"]) ?? "standard",
    status: (front.status as ArticleIndexEntry["status"]) ?? "draft",
    featured: parseFeaturedFlags(front.featured),
    scripts: Array.isArray(front.scripts) ? (front.scripts as unknown[]) : undefined,
    videos: Array.isArray(front.videos) ? (front.videos as unknown[]) : undefined,
    topics: Array.isArray(front.topics) ? front.topics.map(String) : undefined,
  };
  const html = rewriteAssetUrls(marked.parse(body, { async: false }) as string, siteId);
  return { frontmatter, body: html };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // --- Validate request body ---
  if (
    !body ||
    typeof body !== "object" ||
    !("sourceDomain" in body) ||
    !("targetDomain" in body) ||
    !("slugs" in body)
  ) {
    return NextResponse.json(
      { error: "Missing required fields: sourceDomain, targetDomain, slugs" },
      { status: 400 },
    );
  }

  const { sourceDomain, targetDomain, slugs } = body as CopyRequestBody;

  if (typeof sourceDomain !== "string" || !sourceDomain.trim()) {
    return NextResponse.json({ error: "sourceDomain must be a non-empty string" }, { status: 400 });
  }
  if (typeof targetDomain !== "string" || !targetDomain.trim()) {
    return NextResponse.json({ error: "targetDomain must be a non-empty string" }, { status: 400 });
  }
  if (!Array.isArray(slugs) || slugs.length === 0) {
    return NextResponse.json({ error: "slugs must be a non-empty array" }, { status: 400 });
  }
  if (sourceDomain === targetDomain) {
    return NextResponse.json(
      { error: "sourceDomain and targetDomain must be different" },
      { status: 400 },
    );
  }

  try {
    // --- Resolve staging branches from dashboard-index ---
    const index = await readDashboardIndex({ fresh: true });

    const sourceEntry = index.sites.find((s) => s.domain === sourceDomain);
    if (!sourceEntry) {
      return NextResponse.json(
        { error: `Source site "${sourceDomain}" not found in dashboard index` },
        { status: 404 },
      );
    }

    const targetEntry = index.sites.find((s) => s.domain === targetDomain);
    if (!targetEntry) {
      return NextResponse.json(
        { error: `Target site "${targetDomain}" not found in dashboard index` },
        { status: 404 },
      );
    }

    const sourceBranch = sourceEntry.staging_branch ?? `staging/${sourceDomain}`;
    const targetBranch = targetEntry.staging_branch ?? `staging/${targetDomain}`;

    // --- Ensure target staging branch exists ---
    const targetBranchExists = await branchExists(targetBranch);
    if (!targetBranchExists) {
      await createBranch(targetBranch, "main");
      console.log(`[articles/copy] Created branch ${targetBranch} from main`);
    }

    // --- Read existing articles on target to detect slug conflicts ---
    const targetArticles = await readArticles(targetDomain, targetBranch);
    const targetSlugs = new Set(targetArticles.map((a) => a.slug));

    // --- Process each slug (parallel read + image copy) ---
    const copied: string[] = [];
    const skipped: SkippedArticle[] = [];
    const warnings: string[] = [];
    const filesToCommit: Array<{ path: string; content: string }> = [];

    // Separate conflict-skipped slugs from slugs that need fetching
    const slugsToFetch: string[] = [];
    for (const slug of slugs) {
      if (targetSlugs.has(slug)) {
        skipped.push({ slug, reason: "Article with this slug already exists on target site" });
      } else {
        slugsToFetch.push(slug);
      }
    }

    // Fetch all article contents in parallel (batches of 5)
    const BATCH_SIZE = 5;
    const articleContents = new Map<string, string>();

    for (let i = 0; i < slugsToFetch.length; i += BATCH_SIZE) {
      const batch = slugsToFetch.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (slug) => {
          const sourcePath = `sites/${sourceDomain}/articles/${slug}.md`;
          const content = await readFileContent(sourcePath, sourceBranch);
          return { slug, content };
        }),
      );
      for (const { slug, content } of results) {
        if (content === null) {
          skipped.push({ slug, reason: "Article not found on source site" });
        } else {
          articleContents.set(slug, content);
        }
      }
    }

    // Copy R2 images in parallel for all fetched articles
    const imageCopyPromises: Array<Promise<void>> = [];

    for (const [slug, content] of articleContents) {
      const featuredImage = parseFeaturedImage(content);
      if (!featuredImage) continue;

      const filename = extractImageFilename(featuredImage);
      if (!filename) {
        const msg = `[${slug}] Could not extract image filename from featuredImage: "${featuredImage}" — article copied without image`;
        console.warn(`[articles/copy] ${msg}`);
        warnings.push(msg);
        continue;
      }

      const sourceR2Key = `${sourceDomain}/assets/images/${filename}`;
      const targetR2Key = `${targetDomain}/assets/images/${filename}`;

      imageCopyPromises.push(
        (async (): Promise<void> => {
          try {
            const imageBuffer = await readFromR2(sourceR2Key);
            if (imageBuffer) {
              const ext = filename.split(".").pop()?.toLowerCase() ?? "";
              const contentTypeMap: Record<string, string> = {
                webp: "image/webp",
                jpg: "image/jpeg",
                jpeg: "image/jpeg",
                png: "image/png",
                gif: "image/gif",
              };
              const contentType = contentTypeMap[ext] ?? "image/webp";
              const uploaded = await uploadToR2(targetR2Key, imageBuffer, contentType);
              if (!uploaded) {
                const msg = `[${slug}] R2 image copy failed for "${filename}" — article copied without image`;
                console.warn(`[articles/copy] ${msg}`);
                warnings.push(msg);
              }
            } else {
              const msg = `[${slug}] R2 image "${filename}" not found in source — article copied without image`;
              console.warn(`[articles/copy] ${msg}`);
              warnings.push(msg);
            }
          } catch (err) {
            const msg = `[${slug}] R2 image copy error for "${filename}": ${err instanceof Error ? err.message : "unknown error"} — article copied without image`;
            console.warn(`[articles/copy] ${msg}`);
            warnings.push(msg);
          }
        })(),
      );
    }

    // Wait for all image copies to complete
    await Promise.all(imageCopyPromises);

    // Queue all fetched articles for commit
    for (const [slug, content] of articleContents) {
      const targetPath = `sites/${targetDomain}/articles/${slug}.md`;
      filesToCommit.push({ path: targetPath, content });
      copied.push(slug);
    }

    // --- Atomic commit to both staging and main (live) ---
    if (filesToCommit.length > 0) {
      const commitMsg = `feat(content): copy ${filesToCommit.length} article(s) from ${sourceDomain} to ${targetDomain}`;

      // Commit to staging and main in parallel
      await Promise.all([
        commitNetworkFiles(filesToCommit, commitMsg, targetBranch),
        commitNetworkFiles(filesToCommit, commitMsg, "main"),
      ]);

      // Invalidate caches for both branches
      invalidateSiteCaches(targetDomain, targetBranch);
      invalidateSiteCaches(targetDomain, "main");

      // Dual-write to MongoDB (soft-fail) — upsert for both target branches
      const mongoDocs: Array<{ domain: string; slug: string; branch: string; frontmatter: Record<string, unknown> }> = [];
      for (const slug of copied) {
        const markdown = articleContents.get(slug);
        if (!markdown) continue;
        const parsed = matter(markdown);
        const fm = parsed.data;
        const frontmatter: Record<string, unknown> = {
          title: fm.title,
          description: fm.description,
          status: fm.status,
          type: fm.type,
          publish_date: fm.publishDate ?? fm.publish_date,
          author: fm.author,
          tags: fm.tags,
          featured_image: fm.featuredImage ?? fm.featured_image,
          quality_score: fm.quality_score,
          videos: fm.videos,
          scripts: fm.scripts,
          source_url: fm.source_url,
        };
        mongoDocs.push({ domain: targetDomain, slug, branch: targetBranch, frontmatter });
        mongoDocs.push({ domain: targetDomain, slug, branch: "main", frontmatter });
      }
      await upsertArticlesMeta(mongoDocs);
    }

    // --- Write articles directly to KV for immediate live availability ---
    if (copied.length > 0) {
      try {
        const kv = getKvNamespaces(targetDomain);

        // Parse each article into KV format (same logic as seed-kv.ts)
        const kvRecords: ArticleRecord[] = [];
        for (const slug of copied) {
          const markdown = articleContents.get(slug);
          if (!markdown) continue;
          kvRecords.push(markdownToArticleRecord(slug, markdown, targetDomain));
        }

        // Read existing article index from production KV and merge
        const indexRaw = await getKVEntry(kv.prod, `article-index:${targetDomain}`, targetDomain);
        const currentIndex: ArticleIndexEntry[] = indexRaw ? JSON.parse(indexRaw) as ArticleIndexEntry[] : [];
        const indexMap = new Map(currentIndex.map((a) => [a.slug, a]));
        for (const record of kvRecords) {
          indexMap.set(record.frontmatter.slug, record.frontmatter);
        }
        const updatedIndex = Array.from(indexMap.values()).sort(
          (a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime(),
        );

        // Build bulk KV entries: individual articles + updated index
        const kvEntries: Array<{ key: string; value: string }> = [];
        for (const record of kvRecords) {
          kvEntries.push({
            key: `article:${targetDomain}:${record.frontmatter.slug}`,
            value: JSON.stringify(record),
          });
        }
        kvEntries.push({
          key: `article-index:${targetDomain}`,
          value: JSON.stringify(updatedIndex),
        });

        // Write to both production and staging KV in parallel
        await Promise.all([
          bulkPutKV(kv.prod, kvEntries, targetDomain),
          bulkPutKV(kv.staging, kvEntries, targetDomain),
        ]);

        console.log(
          `[articles/copy] Wrote ${kvRecords.length} articles + index to prod+staging KV for ${targetDomain}`,
        );
      } catch (kvErr) {
        const msg = `KV write failed (articles are in Git but may take a few minutes to appear on live site): ${kvErr instanceof Error ? kvErr.message : "unknown error"}`;
        console.error(`[articles/copy] ${msg}`);
        warnings.push(msg);
      }
    }

    const response: CopyResponse = { copied, skipped, warnings };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Copy failed";
    console.error("[articles/copy]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
