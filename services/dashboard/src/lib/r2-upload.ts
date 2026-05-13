import { PutObjectCommand } from "@aws-sdk/client-s3";
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
): Promise<boolean> {
  const client = getR2Client();
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
