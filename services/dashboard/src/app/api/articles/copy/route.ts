import { NextRequest, NextResponse } from "next/server";
import {
  readDashboardIndex,
  readArticles,
  readFileContent,
  commitNetworkFiles,
  branchExists,
  createBranch,
  invalidateSiteCaches,
} from "@/lib/github";
import { readFromR2, uploadToR2 } from "@/lib/r2-upload";

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
    }

    const response: CopyResponse = { copied, skipped, warnings };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Copy failed";
    console.error("[articles/copy]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
