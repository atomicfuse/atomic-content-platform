/**
 * Every new article starts with the site's default image until its hero image arrives, so that
 * file must exist — 15 of 59 sites had none (renamed sites kept the old file name, or the wizard's
 * one-time generation had failed) and showed broken images in production meanwhile.
 * ensure() checks once per site per process and generates the image when it is missing.
 */
import { generateImageWithGemini } from "./gemini.js";
import { optimizeImage } from "./image-optimizer.js";
import { r2ObjectExists, uploadToR2 } from "./r2-upload.js";

export interface DefaultImageSite { domain: string; siteName: string; vertical?: string; topics: string[] }

export interface DefaultImageDeps {
  /** null = can't tell (R2 not configured). */
  exists(key: string): Promise<boolean | null>;
  /** The image as WebP, or null when generation failed. */
  generate(site: DefaultImageSite): Promise<Buffer | null>;
  upload(key: string, data: Buffer): Promise<boolean>;
}

export function defaultImageKey(domain: string): string {
  return `${domain}/assets/images/${domain}-general-article.webp`;
}

/** Path articles store in frontmatter (seed-kv adds the /<siteId> prefix). */
export function defaultImagePath(domain: string): string {
  return `/assets/images/${domain}-general-article.webp`;
}

export function createDefaultImageGuard(deps: DefaultImageDeps): { ensure(site: DefaultImageSite): Promise<void> } {
  const ok = new Set<string>();
  return {
    async ensure(site) {
      if (ok.has(site.domain)) return;
      const key = defaultImageKey(site.domain);
      try {
        const exists = await deps.exists(key);
        if (exists === null) return; // can't check here — never block an article
        if (exists) { ok.add(site.domain); return; }
        console.warn(`[default-image] ${key} missing — generating it`);
        const image = await deps.generate(site);
        if (!image) { console.warn(`[default-image] generation failed for ${site.domain}; will retry on the next article`); return; }
        if (await deps.upload(key, image)) { ok.add(site.domain); console.log(`[default-image] created ${key}`); }
      } catch (err) {
        console.warn(`[default-image] check failed for ${site.domain}:`, err instanceof Error ? err.message : err);
      }
    },
  };
}

/** Same prompt and format as the dashboard wizard's generateAndUploadDefaultSiteImage. */
async function generateDefaultImage(site: DefaultImageSite): Promise<Buffer | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const prompt = `Create a professional, visually appealing hero image for a website called "${site.siteName}" in the ${site.vertical || "general"} niche`
    + (site.topics.length ? `, covering ${site.topics.slice(0, 4).join(", ")}` : "")
    + `. The image should be a high-quality photograph or illustration suitable as a default article thumbnail. No text overlays, no logos. Clean, modern aesthetic. 1200x630 pixels aspect ratio.`;
  const result = await generateImageWithGemini(apiKey, prompt);
  return result.ok ? optimizeImage(result.data) : null;
}

/** Process-wide guard used by the article generators. */
export const siteDefaultImage = createDefaultImageGuard({
  exists: r2ObjectExists,
  generate: generateDefaultImage,
  upload: (key, data) => uploadToR2(key, data, "image/webp"),
});
