import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { uploadToR2 } from "@/lib/r2-upload";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { commitNetworkFiles, readFileContent } from "@/lib/github";
import {
  parseFrontmatter,
  buildArticlePath,
  buildImageR2Key,
  buildImageFrontmatterPath,
} from "@/lib/article-upload";
import { upsertArticleMeta } from "@/lib/db/articles";

/** Allowed image MIME types. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Max width for images — matches content-pipeline's image-optimizer. */
const IMG_MAX_WIDTH = 1200;
/** Max acceptable file size after optimization (350 KB). */
const IMG_MAX_SIZE_BYTES = 350 * 1024;
/** Max upload size (10 MB). */
const MAX_IMG_UPLOAD = 10 * 1024 * 1024;

interface RouteParams {
  params: Promise<{ domain: string; slug: string }>;
}

/**
 * POST /api/articles/[domain]/[slug]/image
 * Replace an article's featured image.
 *
 * Expected form data:
 *   - image: File (required) — the image file to upload
 *   - branch: string (optional) — target branch, defaults to staging/<domain>
 *
 * Returns:
 *   - { status: "updated", imagePath, r2Key, branch }
 */
export async function POST(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { domain, slug } = await params;
    const decodedDomain = decodeURIComponent(domain);

    const formData = await req.formData();
    const imageFile = formData.get("image") as File | null;
    let targetBranch = (formData.get("branch") as string) ?? null;

    // --- Validate image file ---
    if (!imageFile) {
      return NextResponse.json({ error: "image file is required" }, { status: 400 });
    }

    if (!IMAGE_TYPES.has(imageFile.type)) {
      return NextResponse.json(
        {
          error: `Unsupported image type: ${imageFile.type}. Allowed: png, jpeg, webp, gif`,
        },
        { status: 400 },
      );
    }

    if (imageFile.size > MAX_IMG_UPLOAD) {
      return NextResponse.json(
        { error: "Image exceeds 10 MB limit" },
        { status: 400 },
      );
    }

    // --- Determine target branch ---
    if (!targetBranch) {
      const index = await readDashboardIndex();
      const site = index.sites?.find((s) => s.domain === decodedDomain);
      targetBranch = site?.staging_branch ?? `staging/${decodedDomain}`;
    }

    // --- Verify article exists ---
    const articlePath = buildArticlePath(decodedDomain, slug);
    const content = await readFileContent(articlePath, targetBranch);
    if (content === null) {
      return NextResponse.json(
        { error: `Article "${slug}" not found on branch ${targetBranch}` },
        { status: 404 },
      );
    }

    // --- Parse existing frontmatter ---
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      return NextResponse.json(
        { error: "Could not parse article frontmatter" },
        { status: 500 },
      );
    }

    // --- Optimize image ---
    const rawBuffer = Buffer.from(await imageFile.arrayBuffer());
    const metadata = await sharp(rawBuffer).metadata();

    let pipeline = sharp(rawBuffer);
    if (metadata.width && metadata.width > IMG_MAX_WIDTH) {
      pipeline = pipeline.resize({ width: IMG_MAX_WIDTH, withoutEnlargement: true });
    }

    let optimized = await pipeline.webp({ quality: 80 }).toBuffer();
    if (optimized.length > IMG_MAX_SIZE_BYTES) {
      pipeline = sharp(rawBuffer);
      if (metadata.width && metadata.width > IMG_MAX_WIDTH) {
        pipeline = pipeline.resize({ width: IMG_MAX_WIDTH, withoutEnlargement: true });
      }
      optimized = await pipeline.webp({ quality: 60 }).toBuffer();
    }

    if (optimized.length > IMG_MAX_SIZE_BYTES) {
      pipeline = sharp(rawBuffer);
      if (metadata.width && metadata.width > IMG_MAX_WIDTH) {
        pipeline = pipeline.resize({ width: IMG_MAX_WIDTH, withoutEnlargement: true });
      }
      optimized = await pipeline.webp({ quality: 40 }).toBuffer();
    }

    console.log(
      `[article-image-replace] Image ${(rawBuffer.length / 1024).toFixed(0)} KB → ${(optimized.length / 1024).toFixed(0)} KB (WebP)`,
    );

    // --- Upload to R2 ---
    const r2Key = buildImageR2Key(decodedDomain, slug, "webp");
    const uploaded = await uploadToR2(r2Key, optimized, "image/webp", decodedDomain);
    if (!uploaded) {
      return NextResponse.json(
        { error: "R2 upload failed" },
        { status: 500 },
      );
    }

    // --- Update frontmatter ---
    const imagePath = buildImageFrontmatterPath(slug, "webp");
    const updatedFrontmatter = { ...parsed.frontmatter };
    updatedFrontmatter.featuredImage = imagePath;

    // Reconstruct markdown
    const { stringify: stringifyYaml } = await import("yaml");
    const yamlStr = stringifyYaml(updatedFrontmatter, { lineWidth: 0 }).trim();
    const updatedContent = `---\n${yamlStr}\n---\n${parsed.body}`;

    // --- Commit to Git ---
    await commitNetworkFiles(
      [{ path: articlePath, content: updatedContent }],
      `fix(content): replace image for ${slug} on ${decodedDomain}`,
      targetBranch,
    );

    // Dual-write to MongoDB (soft-fail)
    await upsertArticleMeta(decodedDomain, slug, targetBranch, { featured_image: imagePath });

    return NextResponse.json(
      {
        status: "updated",
        imagePath,
        r2Key,
        branch: targetBranch,
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Image replacement failed";
    console.error("[article-image-replace]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
