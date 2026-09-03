import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client } from "@/lib/cloudflare";

/** The single R2 bucket for all site assets. The site-worker's
 *  ASSET_BUCKET binding points here in both staging and production. */
const R2_BUCKET = "atl-assets-prod";

/**
 * Upload a buffer to R2 (atl-assets-prod). Returns true on success,
 * false if R2 is not configured or the upload fails.
 */
export async function uploadToR2(
  key: string,
  data: Buffer,
  contentType: string,
  domain?: string,
): Promise<boolean> {
  const client = getR2Client(domain);
  if (!client) {
    console.warn("[r2-upload] R2 not configured — skipping upload");
    return false;
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
    console.log(`[r2-upload] Uploaded ${key} (${(data.length / 1024).toFixed(0)} KB)`);
    return true;
  } catch (err) {
    console.error(
      `[r2-upload] Failed to upload ${key}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Read an object from R2 (atl-assets-prod) as a Buffer. Returns null if R2 is
 * not configured or the object doesn't exist. Used to serve site assets
 * (logos/favicons) in the dashboard now that they're R2-native, not in git.
 */
export async function readFromR2(key: string, domain?: string): Promise<Buffer | null> {
  const client = getR2Client(domain);
  if (!client) {
    console.warn("[r2-upload] R2 not configured — cannot read");
    return null;
  }
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    if (!res.Body) return null;
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err) {
    // NoSuchKey / NotFound → treat as missing.
    if ((err as { name?: string }).name === "NoSuchKey" || (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      return null;
    }
    console.error(`[r2-upload] Failed to read ${key}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
