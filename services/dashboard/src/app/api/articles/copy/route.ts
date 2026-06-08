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
 *  Handles both quoted and unquoted YAML values. */
function parseFeaturedImage(markdown: string): string | null {
  const match = markdown.match(/^featuredImage:\s*["']?([^"'\n]+)["']?\s*$/m);
  return match ? match[1]!.trim() : null;
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

    // --- Process each slug ---
    const copied: string[] = [];
    const skipped: SkippedArticle[] = [];
    const warnings: string[] = [];
    const filesToCommit: Array<{ path: string; content: string }> = [];

    for (const slug of slugs) {
      // Check for slug conflict on target
      if (targetSlugs.has(slug)) {
        skipped.push({ slug, reason: "Article with this slug already exists on target site" });
        continue;
      }

      // Read full article markdown from source branch
      const sourcePath = `sites/${sourceDomain}/articles/${slug}.md`;
      const content = await readFileContent(sourcePath, sourceBranch);

      if (content === null) {
        skipped.push({ slug, reason: "Article not found on source site" });
        continue;
      }

      // --- Copy R2 image if present ---
      const featuredImage = parseFeaturedImage(content);
      if (featuredImage) {
        const filename = extractImageFilename(featuredImage);
        if (filename) {
          const sourceR2Key = `${sourceDomain}/assets/images/${filename}`;
          const targetR2Key = `${targetDomain}/assets/images/${filename}`;

          try {
            const imageBuffer = await readFromR2(sourceR2Key);
            if (imageBuffer) {
              // Detect content type from filename extension
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
                warnings.push(
                  `[${slug}] R2 image copy failed for "${filename}" — article copied without image`,
                );
              }
            } else {
              warnings.push(
                `[${slug}] R2 image "${filename}" not found in source — article copied without image`,
              );
            }
          } catch (err) {
            warnings.push(
              `[${slug}] R2 image copy error for "${filename}": ${err instanceof Error ? err.message : "unknown error"} — article copied without image`,
            );
          }
        }
      }

      // Queue article for commit to target branch
      const targetPath = `sites/${targetDomain}/articles/${slug}.md`;
      filesToCommit.push({ path: targetPath, content });
      copied.push(slug);
    }

    // --- Atomic commit all articles to target branch ---
    if (filesToCommit.length > 0) {
      await commitNetworkFiles(
        filesToCommit,
        `feat(content): copy ${filesToCommit.length} article(s) from ${sourceDomain} to ${targetDomain}`,
        targetBranch,
      );

      // Invalidate caches for target domain
      invalidateSiteCaches(targetDomain, targetBranch);
    }

    const response: CopyResponse = { copied, skipped, warnings };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Copy failed";
    console.error("[articles/copy]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
