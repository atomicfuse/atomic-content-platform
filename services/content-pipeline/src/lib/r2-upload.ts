/**
 * Upload assets directly to Cloudflare R2 via S3-compatible API.
 * Used by the content pipeline to store generated article images
 * without committing them to Git.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

let _client: S3Client | null = null;

function getClient(): S3Client | null {
  if (_client) return _client;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accessKeyId || !secretAccessKey || !accountId) {
    return null;
  }
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

/**
 * Build the R2 object key for an article image.
 *
 * @param siteId    Site identifier (domain folder name), e.g. "tvshowbox"
 * @param slug      Article slug (kebab-case), e.g. "my-article-slug"
 * @param ext       File extension without dot, e.g. "webp"
 * @returns         R2 key, e.g. "tvshowbox/assets/images/my-article-slug.webp"
 */
export function buildR2Key(siteId: string, slug: string, ext: string): string {
  return `${siteId}/assets/images/${slug}.${ext}`;
}

/**
 * Upload a buffer to R2. Returns true on success, false if R2 is not
 * configured or the upload fails.
 *
 * @param key   R2 object key, e.g. "coolnews/assets/images/slug.webp"
 * @param data  File contents as a Buffer
 * @param contentType  MIME type, e.g. "image/webp"
 */
export async function uploadToR2(
  key: string,
  data: Buffer,
  contentType: string = "image/webp",
): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.warn("[r2-upload] R2 not configured (missing R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / CLOUDFLARE_ACCOUNT_ID) — skipping upload");
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
