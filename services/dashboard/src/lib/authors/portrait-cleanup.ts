import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { deleteR2Objects, getR2Client } from "@/lib/cloudflare";

const BUCKET = "atl-assets-prod";

/** Keys that are this author's portraits (`<id>-<sha10>.webp`); "ann-lee-2-…" is a different author. */
export function portraitKeysOf(id: string, keys: string[]): string[] {
  const re = new RegExp(`^authors/assets/${id}-[0-9a-f]{10}\\.webp$`);
  return keys.filter((k) => re.test(k));
}

/** Remove every portrait (current and earlier regenerations) of a deleted author. Best effort; returns the count. */
export async function deleteAuthorPortraits(id: string): Promise<number> {
  const client = getR2Client();
  if (!client) return 0;
  try {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `authors/assets/${id}-`, ContinuationToken: token }));
      keys.push(...(page.Contents ?? []).map((o) => o.Key ?? ""));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return await deleteR2Objects(BUCKET, portraitKeysOf(id, keys));
  } catch (err) {
    console.warn(`[authors] portrait cleanup for ${id} failed:`, err instanceof Error ? err.message : err);
    return 0;
  }
}
