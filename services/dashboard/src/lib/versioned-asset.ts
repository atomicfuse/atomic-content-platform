import { createHash } from "node:crypto";

/**
 * Logos and favicons live in the ONE R2 bucket both staging and production read. Writing a fixed name
 * (`assets/logo.png`) made every staging save live on production instantly. A content-hashed name per
 * version keeps them apart: staging's site.yaml points at the new file, production keeps the old one
 * until publish (old files are never overwritten).
 */
export function versionedAsset(domain: string, name: "logo" | "logo-footer" | "favicon", data: Buffer): { key: string; path: string } {
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 10);
  const path = `/assets/${name}-${hash}.png`;
  return { key: `${domain}${path}`, path };
}
