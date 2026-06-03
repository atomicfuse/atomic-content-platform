import { extname } from 'node:path';

/**
 * Maps a file extension to a MIME type for R2 uploads.
 *
 * `wrangler r2 object put` does NOT infer content-type from the file —
 * omitting `--content-type` stores the object with no MIME type. The
 * site-worker then serves it via `obj.writeHttpMetadata()` with no
 * `Content-Type` header, so browsers refuse to render logos/images and
 * the R2 dashboard shows "No preview available". This map lets the
 * seeder set an explicit content-type on every asset it uploads.
 *
 * Regression guard: a missing content-type here silently "damages" every
 * site logo on the next sync (see seed-kv `uploadAssetsToR2`).
 */
const R2_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
};

/** Returns the MIME type for a file path, falling back to
 *  `application/octet-stream` for unknown extensions. */
export function contentTypeForFile(path: string): string {
  return R2_CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}
