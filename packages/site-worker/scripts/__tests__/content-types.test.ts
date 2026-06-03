import { describe, expect, it } from 'vitest';
import { contentTypeForFile } from '../lib/content-types';

/**
 * Regression guard for the "synced logos damaged" incident: seed-kv's
 * `uploadAssetsToR2` must pass an explicit `--content-type` to
 * `wrangler r2 object put`. Without it, R2 stores assets with no MIME
 * type and the site-worker serves logos that browsers won't render.
 */
describe('contentTypeForFile (R2 asset content-type)', () => {
  it('resolves common image types — the assets seed-kv syncs from git', () => {
    expect(contentTypeForFile('/sites/journeypeaks/assets/logo.png')).toBe('image/png');
    expect(contentTypeForFile('logo.PNG')).toBe('image/png');
    expect(contentTypeForFile('hero.jpg')).toBe('image/jpeg');
    expect(contentTypeForFile('hero.jpeg')).toBe('image/jpeg');
    expect(contentTypeForFile('icon.svg')).toBe('image/svg+xml');
    expect(contentTypeForFile('favicon.ico')).toBe('image/x-icon');
    expect(contentTypeForFile('photo.webp')).toBe('image/webp');
  });

  it('never returns empty — falls back to application/octet-stream', () => {
    expect(contentTypeForFile('mystery.bin')).toBe('application/octet-stream');
    expect(contentTypeForFile('noextension')).toBe('application/octet-stream');
    // The real bug was an absent content-type; the fallback must still be a
    // valid, non-empty MIME string so the upload always sets the header.
    expect(contentTypeForFile('logo.png')).not.toBe('');
  });
});
