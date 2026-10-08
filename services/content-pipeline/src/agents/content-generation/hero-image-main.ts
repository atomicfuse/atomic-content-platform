/**
 * Hero images reach production too. Generation publishes articles right away, but the n8n hero
 * image arrives ~40s later and was committed to staging only — production kept the default image
 * until the next publish. After the staging commit, the same image is applied to the published
 * copy on main, touching only the image fields.
 */
import matter from "gray-matter";
import type { Octokit } from "@octokit/rest";
import { clearTreeCache, commitBatch, readFile } from "../../lib/github.js";
import { isGeneralImage } from "../../lib/general-image.js";
import { upsertArticleMeta } from "../../lib/db/articles.js";

/**
 * The published article with the hero image, or null when main needs no change: it already has
 * this image, or it shows a non-default image someone chose (never overwritten).
 */
export function heroImageUpdateForMain(mainRaw: string, imageUrl: string, altText: string): string | null {
  const parsed = matter(mainRaw);
  const current = (parsed.data.featuredImage ?? parsed.data.featured_image) as string | undefined;
  if (current === imageUrl) return null;
  if (!isGeneralImage(current, "")) return null;
  parsed.data["featuredImage"] = imageUrl;
  parsed.data["image_alt"] = altText;
  return matter.stringify(parsed.content, parsed.data);
}

export interface HeroImage { siteDomain: string; slug: string; imageUrl: string; altText: string }

/** Applies hero images to articles already published on main (one commit). Never throws. */
export async function applyHeroImagesToMain(octokit: Octokit, repo: string, images: readonly HeroImage[]): Promise<void> {
  try {
    clearTreeCache("main");
    const files: Array<{ path: string; content: string }> = [];
    const applied: HeroImage[] = [];
    for (const img of images) {
      const path = `sites/${img.siteDomain}/articles/${img.slug}.md`;
      let raw: string;
      try {
        raw = await readFile(octokit, repo, path, "main");
      } catch {
        continue; // not published yet — the next publish carries the image
      }
      const updated = heroImageUpdateForMain(raw, img.imageUrl, img.altText);
      if (updated) { files.push({ path, content: updated }); applied.push(img); }
    }
    if (files.length === 0) return;
    const message = files.length === 1
      ? `feat(image): hero image on production for ${applied[0]!.slug}`
      : `feat(image): hero images on production for ${files.length} articles`;
    await commitBatch(octokit, repo, files, [], message, "main");
    for (const img of applied) {
      await upsertArticleMeta(img.siteDomain, img.slug, "main", { featuredImage: img.imageUrl, image_alt: img.altText });
    }
    console.log(`[n8n-image] Hero image(s) applied to production → ${applied.map((a) => `${a.siteDomain}/${a.slug}`).join(", ")}`);
  } catch (err) {
    console.warn("[n8n-image] Could not apply hero image(s) to production (next publish will):", err instanceof Error ? err.message : err);
  }
}
