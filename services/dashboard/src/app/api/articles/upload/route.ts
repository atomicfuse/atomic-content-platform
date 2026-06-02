import { NextRequest, NextResponse } from "next/server";
import { stringify as stringifyYaml } from "yaml";
import sharp from "sharp";
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

/** Max width for hero images — matches content-pipeline's image-optimizer. */
const IMG_MAX_WIDTH = 1200;
/** Max acceptable file size after optimization (350 KB). */
const IMG_MAX_SIZE_BYTES = 350 * 1024;

const MAX_MD_SIZE = 2 * 1024 * 1024;  // 2 MB
const MAX_IMG_SIZE = 10 * 1024 * 1024; // 10 MB

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
          {
            error: `Unsupported image type: ${imageFile.type}. Allowed: ${Object.keys(IMAGE_TYPES).join(", ")}`,
          },
          { status: 400 },
        );
      }

      // Optimize: resize to max 1200px wide, convert to WebP with quality
      // ladder (80→60→40). Same strategy as content-pipeline image-optimizer.
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
      console.log(`[article-upload] Image ${(rawBuffer.length / 1024).toFixed(0)} KB → ${(optimized.length / 1024).toFixed(0)} KB (WebP)`);

      // Always store as .webp regardless of input format.
      // Upload to atl-assets-prod — the site-worker's ASSET_BUCKET binding
      // points there in both staging and production environments.
      const r2Key = buildImageR2Key(domain, slug, "webp");
      const uploaded = await uploadToR2(r2Key, optimized, "image/webp", domain);
      if (uploaded) {
        imagePath = buildImageFrontmatterPath(slug, "webp");
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
          {
            error: `Article "${slug}" already exists on ${targetBranch}. Use force=true to overwrite.`,
          },
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

    // Inject uploaded image path into frontmatter — always overwrite when user
    // explicitly uploads an image, even if the markdown already had a
    // featuredImage field (it may reference a stale/different name).
    if (imagePath) {
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

    return NextResponse.json(
      {
        status: "created",
        slug,
        path: articlePath,
        branch: targetBranch,
        imagePath: imagePath ?? null,
        warnings: validation.warnings,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[article-upload]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
